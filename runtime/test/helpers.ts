/**
 * test/helpers.ts – Shared test utilities and fixtures.
 *
 * Provides createTempWorkspace() for isolated temp directories,
 * getTestWorkspace() for a shared workspace across tests, and
 * setEnv() for temporarily overriding environment variables.
 *
 * Imported by nearly every test file as a setup side-effect.
 */

import { mkdtempSync, rmSync, mkdirSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { isOverlayAvailable, createOverlayWorkspace, type OverlayWorkspace } from "./overlay-workspace";

/** Shape of an isolated temp workspace: paths and cleanup callback. */
export interface TempWorkspace {
  base: string;
  workspace: string;
  store: string;
  data: string;
  cleanup: () => void;
}

let sharedWorkspace: TempWorkspace | null = null;
let sharedWorkspaceCleanupHooksRegistered = false;

/** Create an isolated temp directory with workspace, store, and data subdirs. */
export function createTempWorkspace(prefix = "piclaw-test-"): TempWorkspace {
  const base = mkdtempSync(join(tmpdir(), prefix));
  const workspace = base;
  const store = join(base, "store");
  const data = join(base, "data");
  mkdirSync(store, { recursive: true });
  mkdirSync(data, { recursive: true });
  return {
    base,
    workspace,
    store,
    data,
    cleanup: () => {
      rmSync(base, { recursive: true, force: true });
    },
  };
}

function applySharedWorkspaceEnv(workspace: TempWorkspace): void {
  process.env.PICLAW_WORKSPACE = workspace.workspace;
  process.env.PICLAW_STORE = workspace.store;
  process.env.PICLAW_DATA = workspace.data;
}

export function cleanupSharedTestWorkspace(): void {
  if (!sharedWorkspace) return;
  sharedWorkspace.cleanup();
  sharedWorkspace = null;
}

function ensureSharedWorkspaceCleanupHooks(): void {
  if (sharedWorkspaceCleanupHooksRegistered) return;
  sharedWorkspaceCleanupHooksRegistered = true;
  process.once("exit", cleanupSharedTestWorkspace);
}

/** Return the shared temp workspace, creating it on first call. */
export function getTestWorkspace(): TempWorkspace {
  if (!sharedWorkspace) {
    sharedWorkspace = createTempWorkspace("piclaw-shared-test-");
  }
  ensureSharedWorkspaceCleanupHooks();
  applySharedWorkspaceEnv(sharedWorkspace);
  return sharedWorkspace;
}

const ENFORCED_TEST_ENV: Readonly<Record<string, string>> = {
  PICLAW_DB_IN_MEMORY: "1",
};

getTestWorkspace();
for (const [key, value] of Object.entries(ENFORCED_TEST_ENV)) {
  process.env[key] = value;
}

/**
 * Temporarily override env vars; returns a restore function.
 *
 * Tests always enforce an in-memory database fixture.
 */
export function setEnv(vars: Record<string, string | undefined>): () => void {
  const requested: Record<string, string | undefined> = {
    ...vars,
    ...ENFORCED_TEST_ENV,
  };

  const previous: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(requested)) {
    previous[key] = process.env[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }

  return () => {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    for (const [key, value] of Object.entries(ENFORCED_TEST_ENV)) {
      process.env[key] = value;
    }
  };
}

/** Run a callback with an isolated temp workspace wired into PICLAW_* env vars. */
export async function withTempWorkspaceEnv<T>(
  prefix: string,
  vars: Record<string, string | undefined>,
  run: (workspace: TempWorkspace) => Promise<T> | T,
): Promise<T> {
  const workspace = createTempWorkspace(prefix);
  const restore = setEnv({
    PICLAW_WORKSPACE: workspace.workspace,
    PICLAW_STORE: workspace.store,
    PICLAW_DATA: workspace.data,
    ...vars,
  });

  try {
    return await run(workspace);
  } finally {
    restore();
    workspace.cleanup();
  }
}

/** Import a module with a cache-busting suffix to bypass Bun's module cache. */
export async function importFresh<T = any>(modulePath: string): Promise<T> {
  const suffix = `?t=${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return import(`${modulePath}${suffix}`) as Promise<T>;
}

/** Poll a predicate until it returns true, or throw after timeoutMs. */
export async function waitFor(predicate: () => boolean, timeoutMs = 5000, intervalMs = 50): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (predicate()) return;
    await Bun.sleep(intervalMs);
  }
  throw new Error("Timed out waiting for condition");
}

export function closeDbQuietly(db: { getDb: () => { close: () => void } } | null | undefined): boolean {
  if (!db) return false;
  try {
    db.getDb().close();
    return true;
  } catch (_error) {
    return false;
  }
}

export async function resetWebTotpSecretIfLoaded(): Promise<boolean> {
  try {
    const config = await import("../src/core/config.js");
    config.setWebTotpSecret("");
    return true;
  } catch (_error) {
    return false;
  }
}

export function tryRun<T>(run: () => T): { ok: true; value: T } | { ok: false } {
  try {
    return { ok: true, value: run() };
  } catch (_error) {
    return { ok: false };
  }
}

export async function probeHttpOk(url: string): Promise<boolean> {
  try {
    const response = await fetch(url);
    return response.ok;
  } catch (_error) {
    return false;
  }
}

export async function stopQuietly(stop: (() => Promise<unknown>) | null | undefined): Promise<boolean> {
  if (!stop) return false;
  try {
    await stop();
    return true;
  } catch (_error) {
    return false;
  }
}

// ── OverlayFS-backed workspace isolation ─────────────────────

/** Whether overlayfs is usable in this environment. Cached probe. */
export const OVERLAY_AVAILABLE = isOverlayAvailable();

/**
 * Run a test callback inside an overlayfs-isolated workspace.
 * All filesystem changes are captured in an upper layer and discarded on cleanup.
 * Falls back to a plain temp workspace when overlayfs is not available.
 *
 * Usage:
 *   test("my destructive test", () => withOverlayIsolation("/workspace", async (ws) => {
 *       // ws.merged is the isolated root; original /workspace is untouched
 *   }));
 */
export async function withOverlayIsolation<T>(
  baseDir: string,
  run: (overlay: OverlayWorkspace & { store: string; data: string }) => Promise<T> | T,
): Promise<T> {
  const overlay = createOverlayWorkspace(baseDir, "piclaw-isolated-");
  const store = join(overlay.merged, ".piclaw", "store");
  const data = join(overlay.merged, ".piclaw", "data");
  try { mkdirSync(store, { recursive: true }); } catch (e) { void e; }
  try { mkdirSync(data, { recursive: true }); } catch (e) { void e; }

  const prev = {
    PICLAW_WORKSPACE: process.env.PICLAW_WORKSPACE,
    PICLAW_STORE: process.env.PICLAW_STORE,
    PICLAW_DATA: process.env.PICLAW_DATA,
    PICLAW_DB_IN_MEMORY: process.env.PICLAW_DB_IN_MEMORY,
  };
  process.env.PICLAW_WORKSPACE = overlay.merged;
  process.env.PICLAW_STORE = store;
  process.env.PICLAW_DATA = data;
  process.env.PICLAW_DB_IN_MEMORY = "1";

  try {
    return await run({ ...overlay, store, data });
  } finally {
    for (const [k, v] of Object.entries(prev)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    overlay.cleanup();
  }
}
