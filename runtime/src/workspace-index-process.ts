import { spawn, type ChildProcess, type SpawnOptions } from "node:child_process";
import { resolve } from "node:path";

import { closeDatabase, openWorkspaceIndexDatabase, getDb } from "./db/connection.js";
import {
  AGGRESSIVE_WORKSPACE_INDEX_MEMORY_ENV,
  getWorkspaceIndexStatus,
  refreshWorkspaceIndex,
  type WorkspaceIndexProcessParams,
} from "./workspace-index-core.js";
import { createLogger, debugSuppressedError } from "./utils/logger.js";
import { workspaceIndexAccess,WorkspaceIndexAccessDenied } from './core/workspace-index-access.js';
import { getStoreDir,getDataDir } from './core/config-context.js';
import { registerPreShutdownHook } from './runtime/shutdown-registry.js';

import { captureNoteIndexBinding, NoteIndexDenied } from "./note-retrieval/access.js";
import { noteIndexStatus, runNoteIndexPhase } from "./note-retrieval/coordinator.js";
import { NOTE_LIMITS } from "./note-retrieval/files.js";
import { withExecutionIdentity } from "./core/execution-context.js";

const log = createLogger("workspace-index-process");
const INDEXING_STALE_MS = 5 * 60 * 1000;
const ENTRY_PATH = resolve(import.meta.dir, "./workspace-index-process.ts");
export const DISABLE_BACKGROUND_WORKSPACE_INDEX_ENV = "PICLAW_DISABLE_BACKGROUND_WORKSPACE_INDEX";
export { AGGRESSIVE_WORKSPACE_INDEX_MEMORY_ENV };

type WorkspaceIndexSpawn = (command: string, args: string[], options: SpawnOptions) => ChildProcess;

let spawnWorkspaceIndexProcessImpl: WorkspaceIndexSpawn = (command, args, options) => spawn(command, args, options);
let activeWorkspaceIndexChild: ChildProcess | null = null;
let activeWorkspaceIndexCompletion: Promise<void> | null = null;
let finalizeWorkspaceIndexProcessImpl: () => void | Promise<void> = finalizeWorkspaceIndexProcess;
async function finalizeWorkspaceIndexProcess(): Promise<void> {
  await closeDatabase();

  try {
    const gc = (globalThis as typeof globalThis & { gc?: () => void }).gc;
    if (typeof gc === "function") gc();
  } catch (error) {
    debugSuppressedError(log, "Failed to trigger runtime GC during workspace-index cleanup.", error, {
      operation: "workspace_index_process.finalize.gc",
    });
  }

  try {
    const bunGc = (globalThis as typeof globalThis & { Bun?: { gc?: (force?: boolean) => void } }).Bun?.gc;
    if (typeof bunGc === "function") bunGc(true);
  } catch (error) {
    debugSuppressedError(log, "Failed to trigger Bun GC during workspace-index cleanup.", error, {
      operation: "workspace_index_process.finalize.bun_gc",
    });
  }
}

function isIndexStateFresh(updatedAt: string | null | undefined): boolean {
  if (!updatedAt) return false;
  const updatedMs = Date.parse(updatedAt);
  if (!Number.isFinite(updatedMs)) return false;
  return Date.now() - updatedMs < INDEXING_STALE_MS;
}

function isChildStillActive(child: ChildProcess | null): boolean {
  if (!child) return false;
  return child.exitCode === null && !child.killed;
}

function buildArgs(params: WorkspaceIndexProcessParams): string[] {
  const args = [ENTRY_PATH];
  const scope = typeof params.scope === "string" && params.scope.trim() ? params.scope.trim() : "all";
  args.push("--scope", scope);
  if (typeof params.max_kb === "number" && Number.isFinite(params.max_kb)) {
    args.push("--max-kb", String(Math.trunc(params.max_kb)));
  }
  if (params.note_binding === true) args.push('--note-binding-fd', '3');
  return args;
}

function parseArgs(args: string[]): WorkspaceIndexProcessParams {
  const parsed: WorkspaceIndexProcessParams = {};
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--scope") {
      parsed.scope = args[i + 1];
      i += 1;
      continue;
    }
    if (arg.startsWith("--scope=")) {
      parsed.scope = arg.slice("--scope=".length);
      continue;
    }
    if (arg === "--max-kb") {
      const value = Number(args[i + 1]);
      if (Number.isFinite(value)) parsed.max_kb = value;
      i += 1;
      continue;
    }
    if (arg.startsWith("--max-kb=")) {
      const value = Number(arg.slice("--max-kb=".length));
      if (Number.isFinite(value)) parsed.max_kb = value;
    }
    if (arg === '--note-binding-fd' && args[i + 1] === '3') { parsed.note_binding = true; i += 1; }
  }
  return parsed;
}

export function shouldLaunchWorkspaceIndexProcess(params: WorkspaceIndexProcessParams = {}): boolean {
  workspaceIndexAccess();
  if (process.env[DISABLE_BACKGROUND_WORKSPACE_INDEX_ENV] === "1") return false;
  if (isChildStillActive(activeWorkspaceIndexChild)) return false;

  const status = getWorkspaceIndexStatus({ scope: params.scope });
  const fileDatabase = (getDb().query("PRAGMA database_list").get() as {file?:string})?.file;
  const noteDue = Boolean(fileDatabase) && readNotePhaseDue(params);
  if (status.state === "ready" && !noteDue) return false;
  if (status.state === "indexing" && isIndexStateFresh(status.updated_at)) return false;
  return true;
}

function readNotePhaseDue(params: WorkspaceIndexProcessParams): boolean {
  if (params.scope === "skills" || workspaceIndexAccess().mode !== "single-user") return false;
  return noteIndexStatus().state !== "ready";
}

export function launchWorkspaceIndexProcess(params: WorkspaceIndexProcessParams = {}): boolean {
  const access=workspaceIndexAccess();
  if (!shouldLaunchWorkspaceIndexProcess(params)) return false;
  const fileDatabase = (getDb().query("PRAGMA database_list").get() as {file?:string})?.file;
  const binding = access.mode === "single-user" && fileDatabase && readNotePhaseDue(params) ? captureNoteIndexBinding() : null;
  const args=[...buildArgs({...params,note_binding:Boolean(binding)}),'--expected-mode',access.mode],env={...process.env,[AGGRESSIVE_WORKSPACE_INDEX_MEMORY_ENV]:"1",
    PICLAW_WORKSPACE:access.workspace,PICLAW_STORE:getStoreDir(),PICLAW_DATA:getDataDir()};
  access.validate();
  const child = spawnWorkspaceIndexProcessImpl(process.execPath, args, {
    cwd: process.cwd(),
    env,
    stdio: binding ? ["ignore", "ignore", "ignore", "pipe"] : "ignore",
  });

  if (binding) {
    const pipe = child.stdio?.[3] as import("node:stream").Writable | null;
    if (!pipe) { child.kill(); throw new WorkspaceIndexAccessDenied(); }
    pipe.on("error", () => child.kill());
    pipe.end(JSON.stringify(binding));
  }
  activeWorkspaceIndexChild = child;
  activeWorkspaceIndexCompletion = new Promise<void>((resolveCompletion) => {
    child.once("exit", () => resolveCompletion());
    child.once("error", () => resolveCompletion());
  });
  child.once("exit", () => {
    if (activeWorkspaceIndexChild === child) {
      activeWorkspaceIndexChild = null;
    }
  });
  child.once("error", (error) => {
    log.warn("Workspace index process failed", {
      operation: "workspace_index_process.spawn",
      err: error,
    });
    if (activeWorkspaceIndexChild === child) {
      activeWorkspaceIndexChild = null;
    }
  });
  child.unref();

  log.info("Launched background workspace index process", {
    operation: "workspace_index_process.launch",
    pid: child.pid,
    scope: typeof params.scope === "string" && params.scope.trim() ? params.scope.trim() : "all",
    maxKb: params.max_kb ?? null,
  });
  return true;
}

export async function waitForWorkspaceIndexProcess(): Promise<void> {
  await activeWorkspaceIndexCompletion;
}

export async function runWorkspaceIndexProcessFromArgs(args = process.argv.slice(2)): Promise<void> {
  const access=workspaceIndexAccess();
  const expectedIndex=args.indexOf('--expected-mode');
  if(expectedIndex<0||args.lastIndexOf('--expected-mode')!==expectedIndex||args[expectedIndex+1]!==access.mode||args.some(arg=>arg.startsWith('--expected-mode=')))throw new WorkspaceIndexAccessDenied();
  const params = parseArgs(args);
  access.validate();
  // The executable worker admits its note phase through inherited fd3 before DB open.
  // Direct legacy helper invocations do not grant note-store writer authority.
  const noteBindingIndices=args.flatMap((arg,index)=>arg==='--note-binding-fd'?[index]:[]);
  const notePhase = import.meta.main && access.mode === "single-user" && params.scope !== "skills" && noteBindingIndices.length===1 && args[noteBindingIndices[0]+1]==='3';
  if(args.some(arg=>arg.startsWith('--note-binding-fd='))||noteBindingIndices.some(index=>index+1>=args.length||args[index+1]!=='3'))throw new WorkspaceIndexAccessDenied();
  if (notePhase) {
    try { await runNoteIndexPhase(); }
    catch (error) {
      if (error instanceof WorkspaceIndexAccessDenied || error instanceof NoteIndexDenied) throw error;
      log.warn("Note chunk indexing failed; preserving the existing file index refresh.", { operation: "note_index_process.phase", err: error });
    }
    access.validate();
  }
  openWorkspaceIndexDatabase(undefined, access.validate);
  try {
    access.validate();
    await refreshWorkspaceIndex({ scope: params.scope, max_kb: params.max_kb });
  } finally {
    await finalizeWorkspaceIndexProcessImpl();
  }
}

let reconciliationTimer: ReturnType<typeof setInterval> | null = null;
let reconciliationShutdownRegistered = false;
export function startWorkspaceIndexReconciliation(): () => void {
  if (!reconciliationTimer) {
    const tick = () => {
      try { withExecutionIdentity(null, () => { if (workspaceIndexAccess().mode === "single-user") launchWorkspaceIndexProcess({scope:"notes"}); }); }
      catch (error) { debugSuppressedError(log, "Note reconciliation unavailable", error); }
    };
    reconciliationTimer = setInterval(tick, NOTE_LIMITS.reconcileMs);
    reconciliationTimer.unref?.();
    if (!reconciliationShutdownRegistered) {
      reconciliationShutdownRegistered = true;
      registerPreShutdownHook(() => { if (reconciliationTimer) clearInterval(reconciliationTimer); reconciliationTimer = null; });
    }
  }
  return () => { if(reconciliationTimer)clearInterval(reconciliationTimer); reconciliationTimer=null; };
}

export function setWorkspaceIndexSpawnForTests(factory: WorkspaceIndexSpawn | null): void {
  spawnWorkspaceIndexProcessImpl = factory ?? ((command, args, options) => spawn(command, args, options));
}

export function setWorkspaceIndexProcessFinalizeForTests(finalizer: (() => void | Promise<void>) | null): void {
  finalizeWorkspaceIndexProcessImpl = finalizer ?? finalizeWorkspaceIndexProcess;
}

export function resetWorkspaceIndexLauncherForTests(): void {
  activeWorkspaceIndexChild = null;
  activeWorkspaceIndexCompletion = null;
  if (reconciliationTimer) clearInterval(reconciliationTimer);
  reconciliationTimer = null;
  spawnWorkspaceIndexProcessImpl = (command, args, options) => spawn(command, args, options);
  setWorkspaceIndexProcessFinalizeForTests(null);
}

if (import.meta.main) {
  runWorkspaceIndexProcessFromArgs().catch((error) => {
    log.error("Workspace index process failed", {
      operation: "workspace_index_process.run",
      err: error,
    });
    process.exitCode = 1;
  });
}
