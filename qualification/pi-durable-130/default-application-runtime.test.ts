import { admitSqliteWrite } from "../../runtime/src/db/sqlite-async-admission.js";
import { Database } from 'bun:sqlite';
import { modelRequestAccounting } from '../../runtime/src/budget/model-request-accounting.js';
import type { BudgetRequestBinding, BudgetRequestReservation } from '../../runtime/src/db/budget-request-reservations.js';
import { resolveRequestPrincipal } from "../../runtime/src/channels/web/auth/principal.js";
import "./src/test-guard.js";
import { hydrateMcpKeychainCredentials } from "../../runtime/src/secure/mcp-keychain.js";
import { getConfigPath, getDataDir } from "../../runtime/src/core/config-context.js";
import { delegateImages } from "./delegate-image-fixtures.ts";
import { installGoalFixture } from "./goal-fixture.ts";
import { expect, test, spyOn } from "bun:test";
import { strict as assert } from "node:assert";
import { createTestCredentialStore } from "../../runtime/test/model-services-fixture.js";
import type { Api, Model, JsonObject } from "../../node_modules/@earendil-works/pi-ai";
import type { SqliteExecutor } from "../../runtime/durable-engine/qualification/sqlite.ts";
import { SessionManager, SettingsManager, ModelRuntime, ModelRegistry } from "../../node_modules/@earendil-works/pi-coding-agent";
import { getPiclawAgentDir } from "../../runtime/src/core/agent-dir.js";
import { BunSqliteDatabase } from "../../runtime/durable-engine/src/bun-sqlite.js";
import { AgentPool } from "../../runtime/src/agent-pool.js";
import { WebChannel } from "../../runtime/src/channels/web.js";
import { createRuntimeBaseServices } from "../../runtime/src/runtime/composition.js";
import { RuntimeStartupCleanupError } from "../../runtime/src/runtime/startup-cleanup-error.js";
import { main } from "../../runtime/src/runtime.js";
import { createDefaultRuntimeBootstrapDeps } from "../../runtime/src/runtime/bootstrap.js";
import { storeChatMetadata, storeMessage } from "../../runtime/src/db.js";
import { existsSync, mkdirSync, writeFileSync, readFileSync, copyFileSync, symlinkSync, cpSync, renameSync, rmSync,linkSync,chmodSync } from "node:fs";
import { createHash } from "node:crypto";
import * as hostFs from "node:fs";
import { extensionKvSet, extensionKvGet } from "../../runtime/src/db/extension-kv.js";
import { join, resolve } from "node:path";
import { initDatabase, getDb, closeDatabase } from "../../runtime/src/db/connection.js";
import { acquireRuntimeLock } from "../../runtime/src/runtime/single-instance.js";
import { createDefaultApplicationRuntime, assertFreshApplicationHistory } from "../../runtime/durable-engine/src/default-application-runtime.js";
import { createAssistantMessageEventStream } from "../../node_modules/@earendil-works/pi-ai";
import type { RuntimeModelServices } from "../../runtime/src/agent-pool/model-services.js";
import { ensureTestFilesystemIsolation } from "../../runtime/scripts/test-filesystem-isolation.js";
import { Harness, AgentDoc, InboxDoc, configure, createRegistry, defineTask, defineExtension, type ConversationId } from "../../runtime/durable-engine/qualification/durable.ts";
import { SqliteStorage } from "../../runtime/durable-engine/qualification/sqlite.ts";
import { awaitWithContext, withAbortSignal, BACKGROUND_CONTEXT as context } from "../../runtime/durable-engine/qualification/context.ts";
import { reserveHostRequest } from "../../runtime/durable-engine/src/host-request-accounting.ts";
import { withTaskModelRequestScope,taskModelRequestScope } from "../../runtime/durable-engine/src/task-model-boundary-shim.ts";
import { createHostModels, type HostModelEventObserver } from "../../runtime/durable-engine/src/host-models.js";
import * as hostModelBridge from "../../runtime/durable-engine/src/host-models.js";
import { createHostBuiltinTools } from "../../runtime/durable-engine/src/host-builtins.js";
import { HostConversationRuntime } from "../../runtime/durable-engine/src/host-runtime.js";
import { createCurrentPiclawScheduledRunStore } from "../../runtime/src/service-effects/current-piclaw/scheduled-run-store.js";
import { createTask } from "../../runtime/src/db/tasks.js";
import { saveBudgetCap, setBudgetCapEnabled } from "../../runtime/src/db/budget-limits.js";
import { pollScheduledRunsOnce, stopSchedulerLoop } from "../../runtime/src/task-scheduler.js";
import { createPlanKvAuthority } from "../../runtime/durable-engine/src/host-plan-tool.js";
import { installCodeReviewFixture } from "./code-review-fixture.ts";
import { qualifyNativeRecoveryUnitFixture } from "./native-recovery-unit-fixture.ts";
import { installOfficeViewerFixture } from "./office-viewer-fixture.ts";
import { installEditableTableFixture } from "./editable-table-fixture.ts";
import { installDrawioFixture } from "./drawio-fixture.ts";
import { withAddonLocalDispatch, bindAddonLocalDispatchRequest, getAddonLocalDispatchBlock, bindAddonLocalMessage, verifyAddonLocalMessage } from "../../runtime/src/addons/local-dispatch.js";
import { admitAddonLocalRequest, withAddonLocalRequest } from "../../runtime/src/addons/local-context.js";

function factoryTest(scenario: string, name: string, body: () => Promise<void>) {
  const selected = process.env.PICLAW_DEFAULT_FACTORY_CASE;
  if (selected && selected !== scenario) return;
  test(name, async () => {
    if (selected) return body();
    // Each cold start owns its process-global registries and entire SDK root.
    // Never reset shared fixture history to manufacture an empty application.
    const env = { ...process.env };
    delete env.PICLAW_TEST_FS_ISOLATION_ACTIVE;
    delete env.PICLAW_TEST_FS_ISOLATION_ROOT;
    const isolation = ensureTestFilesystemIsolation(env);
    try {
      // The nested cold-start case needs its own completion artifact too;
      // a premature successful child exit cannot certify its parent case.
      const child = Bun.spawn([process.execPath, resolve(import.meta.dir, '../../runtime/scripts/local-test-priority.ts'), '--cwd', import.meta.dir, '--', process.execPath, 'test', import.meta.path], {
        cwd: import.meta.dir, env: { ...env, PICLAW_DEFAULT_FACTORY_CASE: scenario }, stdout: "pipe", stderr: "pipe",
      });
      const [code, out, err] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
      if (code !== 0) throw Error(`Isolated default factory ${scenario}:\n${out}\n${err}`);
      expect(code).toBe(0);
    } finally { isolation.cleanup(); }
  }, 30_000);
}

for(const mode of ['completed','provider','provider-hold','unsafe-tool'] as const)factoryTest('native-background-process-'+mode,'native background accepted identity survives OS process restart: '+mode,async()=>{
  const scenario=mode==='completed'?'native-dream-runner':mode==='provider'?'native-dream-runner-held-provider':mode==='provider-hold'?'native-dream-runner-held-provider-accounted':'native-dream-runner-unsafe-result';
  const results:{phase:string;pid:number;sourceId:string;submissionId:number;providerCalls:number;unresolvedHolds:number}[]=[];
  for(const phase of ['write','read']){
    const child=Bun.spawn([process.execPath,resolve(import.meta.dir,'../../runtime/scripts/local-test-priority.ts'),'--cwd',import.meta.dir,'--',process.execPath,'test',import.meta.path,'-t','^default factory prepares and reopens'],{
      cwd:import.meta.dir,env:{...process.env,PICLAW_DEFAULT_FACTORY_CASE:scenario,PICLAW_NATIVE_RESTART_PHASE:phase},stdout:'pipe',stderr:'pipe'});
    const[exit,out,err]=await Promise.all([child.exited,new Response(child.stdout).text(),new Response(child.stderr).text()]);
    if(exit!==0)throw Error('Native process restart '+mode+'/'+phase+':\n'+out+'\n'+err);
    const line=out.split('\n').find(line=>line.startsWith('NATIVE_RESTART '));expect(line).toBeDefined();results.push(JSON.parse(line!.slice('NATIVE_RESTART '.length)));
  }
  expect(results[0]!.pid).not.toBe(results[1]!.pid);expect(results[1]!.sourceId).toBe(results[0]!.sourceId);expect(results[1]!.submissionId).toBe(results[0]!.submissionId);expect(results[1]!.providerCalls).toBe(0);expect(results[1]!.unresolvedHolds).toBe(mode==='provider-hold'?1:0);
  expect(()=>process.kill(results[0]!.pid,0)).toThrow();console.log('NATIVE_PROCESS_RESTART '+JSON.stringify({mode,results}));
});

const reviewLifecyclePhases = ["fresh", "present", "disabled", "reinstalled", "uninstalled"] as const;
const reviewLifecycleCase = reviewLifecyclePhases.map(phase => `native-code-review-lifecycle-${phase}`)
  .find(phase => phase === process.env.PICLAW_DEFAULT_FACTORY_CASE);
factoryTest("native-code-review-lifecycle", "default factory Code Review persistence survives real process boundaries", async () => {
  const workspace = process.env.PICLAW_WORKSPACE!;
  const pkg = join(workspace, ".pi/extensions/node_modules/@rcarmo/piclaw-addon-code-review");
  const parked = join(workspace, "disabled-code-review-fixture");
  for (const phase of reviewLifecyclePhases) {
    if (phase === "present") installCodeReviewFixture(workspace);
    if (phase === "disabled") renameSync(pkg, parked);
    if (phase === "reinstalled") renameSync(parked, pkg);
    if (phase === "uninstalled") rmSync(pkg, { recursive: true });
    // Share this parent's disposable filesystem, never loader/module caches.
    // The native source gate requires a real process boundary for source removal.
    const child = Bun.spawn([process.execPath, resolve(import.meta.dir, "../../runtime/scripts/local-test-priority.ts"), "--cwd", import.meta.dir, "--", process.execPath,
      "test", import.meta.path, "-t", "^default factory prepares and reopens"], {
      cwd: import.meta.dir, env: { ...process.env, PICLAW_DEFAULT_FACTORY_CASE: `native-code-review-lifecycle-${phase}` }, stdout: "pipe", stderr: "pipe",
    });
    const [code, out, err] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
    if (code !== 0) throw Error(`Code Review lifecycle ${phase}:\n${out}\n${err}`);
    expect(code).toBe(0);
  }
});

for (const uncertain of [false, true]) factoryTest(`cleanup-${uncertain}`, `actual preparation → bootstrap → main retains owner only for uncertain close=${uncertain}`, async () => {
  process.env.PICLAW_DB_IN_MEMORY = "0";
  initDatabase();
  const workspace = process.env.PICLAW_WORKSPACE!;
  const acquire = () => acquireRuntimeLock({ lockPath: join(workspace, "preparation-owner.lock"), strictOwnership: true, disabled: false });
  const owner = acquire();
  const primary = Error("storage initialization failed"), cleanup = Error("application close failed before close");
  const model = { provider: "synthetic", id: "approved", name: "Approved", api: "openai-completions", baseUrl: "https://invalid.invalid", input: ["text"], reasoning: false, contextWindow: 10000, maxTokens: 1000, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } };
  const services = { modelRuntime: { getPhysicalModel: () => model }, modelRegistry: { getAvailable: () => [model] } } as unknown as RuntimeModelServices;
  const originalClose = BunSqliteDatabase.prototype.close;
  let captured: BunSqliteDatabase | undefined;
  const close = spyOn(BunSqliteDatabase.prototype, "close").mockImplementation(function (this: BunSqliteDatabase) {
    captured = this;
    return uncertain ? Promise.reject(cleanup) : originalClose.call(this);
  });
  const transaction = spyOn(BunSqliteDatabase.prototype, "transaction").mockRejectedValue(primary);
  const deps = createDefaultRuntimeBootstrapDeps({ queue: {}, state: {} } as any,
    actual => createDefaultApplicationRuntime(actual, async () => services));
  deps.initializeRuntimeEnvironment = () => {};
  const pool = spyOn(deps, "createAgentPool").mockRejectedValue(Error("must not construct pool"));
  try {
    let thrown: unknown;
    try { await main({ acquireLock: () => owner, createBootstrapDeps: () => deps }); } catch (error) { thrown = error; }
    expect(captured).toBeDefined();
    expect(pool).not.toHaveBeenCalled();
    if (uncertain) {
      expect(thrown).toBeInstanceOf(RuntimeStartupCleanupError);
      expect((thrown as AggregateError).errors).toEqual([primary, cleanup]);
      expect((thrown as AggregateError).errors[0]).toBe(primary);
      expect((thrown as AggregateError).errors[1]).toBe(cleanup);
      owner.assertCurrentOwner(); expect(acquire).toThrow("refuses existing lock");
    } else {
      expect(thrown).toBe(primary);
      acquire().release();
    }
  } finally {
    transaction.mockRestore(); close.mockRestore(); pool.mockRestore();
    if (captured) await originalClose.call(captured);
    owner.release(); closeDatabase();
  }
});

const explicitDelegateCases: Record<string, { id: string; model: string | number; denied?: boolean; exclude?: "model" | "provider" }> = {
  "native-delegate-explicit": { id: "gpt-5-mini", model: "synthetic/gpt-5-mini" },
  "native-delegate-explicit-parent": { id: "gpt-5-mini", model: "synthetic/gpt-6.1-sol" },
  "native-delegate-explicit-slash": { id: "openai/gpt-6-astra", model: "synthetic/openai/gpt-6-astra" },
  "native-delegate-explicit-higher": { id: "gpt-5-pro", model: "synthetic/gpt-5-pro" },
  "native-delegate-explicit-unavailable": { id: "gpt-5-mini", model: "synthetic/gpt-5-pro", denied: true },
  "native-delegate-explicit-unclassified": { id: "approved-b", model: "synthetic/approved-b", denied: true },
  "native-delegate-explicit-excluded-model": { id: "gpt-5-mini", model: "synthetic/gpt-5-mini", denied: true, exclude: "model" },
  "native-delegate-explicit-excluded-provider": { id: "gpt-5-mini", model: "synthetic/gpt-5-mini", denied: true, exclude: "provider" },
  "native-delegate-explicit-short": { id: "gpt-5-mini", model: "gpt-5-mini", denied: true },
  "native-delegate-explicit-empty": { id: "gpt-5-mini", model: "synthetic/", denied: true },
  "native-delegate-explicit-type": { id: "gpt-5-mini", model: 42, denied: true },
  "native-delegate-explicit-fuzzy": { id: "gpt-5-mini", model: "synthetic/GPT-5-mini", denied: true },
  "native-delegate-explicit-virtual": { id: "gpt-5-mini", model: "synthetic/virtual", denied: true },
};
for (const scenario of [...(reviewLifecycleCase ? [reviewLifecycleCase] : []), "native-recovery-unit", "native-retention-unit", "native-runner-denial", "native-scheduled-lease-free", "native-nonweb-admission", "native-addon-admission", "native-addon-admission-rollback", "native-addon-admission-overlap", "native-addon-admission-rejected", "native-addon-admission-alias", "native-addon-admission-model-revoked", "native-addon-admission-public-model-revoked", "native-addon-execution", "native-addon-execution-accounting", "native-addon-execution-accounting-unknown", "native-addon-execution-accounting-capped", "native-addon-execution-accounting-capped-daily", "native-addon-execution-accounting-capped-exact", "native-addon-execution-accounting-capped-denied", "native-addon-execution-accounting-capped-initial-denied", "native-addon-execution-accounting-capped-auth-denied", "native-addon-execution-accounting-capped-unknown", "native-addon-execution-accounting-capped-missing-account", "native-addon-execution-accounting-capped-account-changed", "native-addon-execution-accounting-capped-tool-race", "native-addon-execution-accounting-capped-pricing-changed", "native-addon-execution-accounting-capped-small-output", "native-addon-execution-accounting-capped-cleanup-failed", "native-addon-execution-no-account-auth-cap", "native-addon-execution-revoked", "native-addon-execution-auth-revoked", "native-addon-execution-cancelled", "native-addon-execution-deadline", "native-addon-execution-quota", "native-addon-execution-ceiling", "native-addon-execution-large-result", "native-addon-execution-live-input", "native-addon-execution-recovery-terminal", "native-addon-execution-recovery-cancel-requested", "native-addon-execution-recovery-unknown", "native-addon-execution-recovery-cancelled", "native-addon-execution-recovery-unsafe", "native-addon-execution-recovery-input-ack", "native-addon-execution-recovery-budget-blocked", "native-addon-execution-recovery-owned", "native-addon-execution-recovery-no-source", "native-addon-service-execution", "native-addon-service-budget-resume", "native-addon-service-continuation", "native-addon-service-continuation-budget-gap", "native-addon-service-continuation-interrupted", "native-addon-service-continuation-staged", "native-addon-service-continuation-compaction", "native-addon-service-continuation-compaction-background", "native-addon-service-continuation-compaction-auth-revoked", "native-addon-service-continuation-compaction-auth-budget", "native-addon-service-continuation-compaction-unknown", "native-addon-service-continuation-compaction-background-held", "native-dream-runner", "native-dream-runner-model", "native-dream-runner-tools", "native-dream-runner-held-provider", "native-dream-runner-held-tool", "native-dream-runner-lock-revoked", "native-dream-runner-accounted", "native-dream-runner-budget-denied", "native-dream-runner-deadline", "native-dream-runner-original-time", "native-dream-runner-accounted-unknown", "native-dream-runner-unsafe-result", "native-dream-runner-held-provider-accounted", "native-dream-runner-recovery-unit", "native-dream-runner-scheduled-model", "native-dream-runner-scheduled-budget", "native-dream-runner-scheduled-lease-revoked", "native-dream-runner-scheduled-token-revoked", "native-dream-runner-scheduled-tool-revoked", "native-dream-runner-scheduled-reclaim", "native-dream-runner-scheduled-budget-denied", "native-dream-runner-scheduled-unknown", "native-dream-runner-scheduled-final-revoked", "native-dream-runner-scheduled-index-revoked", "native-routing-bash-active", "native-routing-control-race", "native-routing-queued-race", "native-routing-side-race", "native-routing-create-race", "native-routing-policy", "native-routing-initial-rollback", "native-routing-initial-ack", "native-usage-projection", "native-scheduler-definition", "native-plan-clear", "native-plan-initial-empty", "native-shutdown-stop-recover", "native-shutdown-close-recover", "native-process-exit", "native-process-exit-accounting", "native-process-exit-accounting-close-fail", "native-process-exit-queue-busy", "native-process-exit-shell-lease", "native-process-status", "native-compaction-accounting-auto", "native-compaction-accounting-auto-pending", "native-compaction-accounting-background", "native-events", "native-web-cursor-ack", "native-infrastructure", "native-goal", "native-goal-local-denial", "native-goal-critical-denial", "native-goal-budget", "native-codemode-plan-goal", "native-compaction-accounting-close-fail", "native-compaction-accounting-recover", "native-compaction-accounting-side-provenance", "native-compaction-accounting-side-dispatch", "native-compaction-accounting-unknown", "native-compaction-accounting", "native-scheduler-accounting-unknown", "native-scheduler-accounting", "native-delegate-accounting-unknown", "native-delegate-accounting", "native-parent-accounting-event-fence", "native-parent-accounting-held-writer", "native-parent-accounting-two-turns", "native-parent-accounting-close-work-fail", "native-parent-accounting-storage-fail", "native-parent-accounting-rotate", "native-parent-accounting-auth-deny", "native-parent-accounting-late-unpriced", "native-parent-accounting-late-no-account", "native-parent-accounting-unknown", "native-parent-accounting", "public-shim-compaction", "source-filter-subset", "public-admission-row-mismatch", "public-admission-chat-mismatch", "public-archived-admission", "public-thinking-reasoning", "native-mcp-cleanup-fail", "native-mcp-disconnect", "native-mcp-catalog-change", "native-mcp-error", "native-parent-budget-cap", "native-parent-budget-auth-cap", "native-mcp-concurrent", "native-mcp-config-change", "native-mcp-codemode", "native-mcp-codemode-cancel", "native-mcp-http-deny", "native-codemode-drawio", "native-codemode-drawio-cancel", "native-codemode-editable-table", "native-codemode-editable-table-cancel", "native-codemode-office-viewer", "native-codemode-office-viewer-cancel", "native-codemode-plan", "native-codemode-plan-cancel", "native-codemode-reopen", "native-codemode-cancel", "native-codemode-binding-revoked", "native-drawio", "native-drawio-cancel", "native-drawio-missing-opener", "native-drawio-prepare-held", "public-conversations", "custom-subset", "pending-host", "native-office-viewer", "native-office-viewer-cancel", "native-editable-table", "native-editable-table-missing-publisher", "native-editable-table-revoked", "native-editable-table-closed-publisher", "native-editable-table-nonweb", "native-editable-table-branch", "native-editable-table-archived", "native-editable-table-binding-revoked", "native-code-review", "native-codemode-code-review", "native-codemode-code-review-cancel", "native-plan", "native-scheduler", "native-delegate", "native-delegate-standard", "native-delegate-readonly-deny", "native-delegate-standard-revoke", "native-delegate-files", "native-delegate-images", "native-delegate-timeout", "native-delegate-denied", "native-delegate-revoke-cap", "native-delegate-revoke-provider", ...Object.keys(explicitDelegateCases)] as const) factoryTest(scenario, scenario === "native-infrastructure" ? "production factory: native infrastructure installed sources, public admission, terminal receipt and reopen" : scenario.startsWith("native-mcp-") ? `configured default factory: ${scenario}` : scenario === "custom-subset"
  ? "default factory preserves persisted custom read subset and all metadata/history/identity on reopen"
  : scenario === "pending-host"
    ? "default factory recovers pending host work without upgrading persisted tools"
    : "default factory prepares and reopens real startup-known public conversations; refuses legacy before models", async () => {
  process.env.PICLAW_DB_IN_MEMORY = "0";
  const workspace = process.env.PICLAW_WORKSPACE!;
  const owner = acquireRuntimeLock({ lockPath: join(workspace, "default-owner.lock"), strictOwnership: true, disabled: false });
  initDatabase();
  let root = getDb(); root.exec("PRAGMA foreign_keys=ON");
  // These fixtures revoke request/tool authority, not a canonical operator cancellation.
  // A committed SDK model_error now terminates once with a private-data-free notice.
  // Genuine lost harness authority and live/reopened work must remain pending.
  const expectedFailedTurn = new Set<string>([
    "native-parent-accounting-storage-fail", "native-parent-accounting-rotate", "native-parent-accounting-auth-deny", "native-parent-accounting-unknown",
    "native-parent-budget-cap", "native-parent-budget-auth-cap", "native-mcp-codemode-cancel", "native-codemode-plan-cancel", "native-codemode-cancel",
    "native-codemode-drawio-cancel", "native-drawio-cancel", "native-codemode-office-viewer-cancel", "native-office-viewer-cancel",
    "native-codemode-editable-table-cancel", "native-editable-table-revoked", "native-codemode-code-review-cancel",
    "native-delegate-standard-revoke", "native-delegate-revoke-cap",
  ]).has(scenario);
  const assertFailedTurn = () => {
    const source = root.query("SELECT chat_jid,source_seq,state FROM service_effect_s01_sources WHERE source_id='factory-input'").get() as {chat_jid:string;source_seq:number;state:string};
    expect(source.state).toBe("consumed");
    const operation = root.query("SELECT operation_id,phase,terminal_disposition,terminal_error_code FROM service_effect_s01_operations WHERE chat_jid=? AND primary_source_seq=?").get(source.chat_jid,source.source_seq) as {operation_id:string};
    expect(operation).toMatchObject({phase:"terminal",terminal_disposition:"failed",terminal_error_code:"model_error"});
    expect(root.query("SELECT disposition FROM service_effect_s02_commits WHERE operation_id=?").all(operation.operation_id)).toEqual([{disposition:"failed"}]);
    expect(root.query("SELECT active_operation_id FROM service_effect_s01_chats WHERE chat_jid=?").get(source.chat_jid)).toEqual({active_operation_id:null});
    const notices = root.query("SELECT content FROM messages WHERE chat_jid=? AND is_bot_message=1").all(source.chat_jid) as {content:string}[];
    expect(notices).toHaveLength(1);
    expect(notices[0]!.content).toStartWith("**Turn failed**");
    expect(notices[0]!.content).toContain("will not be retried automatically");
  };

  let calls = 0;
  let terminalWriter: Database | undefined, terminalPulse: ReturnType<typeof setInterval> | undefined;
  let terminalRelease: ReturnType<typeof setTimeout> | undefined, terminalStarted = 0, terminalTicks = 0;
  let originalPaidTerminal: unknown;
  let terminalFenceCalls = 0, terminalFenceObservedReceipt = false, terminalObserverCalls = 0;
  let onProviderResponse: (() => void) | undefined;
  let onCredentialResolve: (() => Promise<void>) | undefined;
  let originalParentReservation: unknown;
  const customSubset = scenario === "custom-subset" || scenario === "source-filter-subset";
  const sourceFilter = scenario === "source-filter-subset";
  const reasoningThinking = scenario === "public-thinking-reasoning";
  const delegateAccounting = scenario.startsWith("native-delegate-accounting");
  const delegateAccountingUnknown = scenario === "native-delegate-accounting-unknown";
  const scheduledAccounting = scenario.startsWith("native-scheduler-accounting");
  const scheduledAccountingUnknown = scenario === "native-scheduler-accounting-unknown";
  const definitionScheduler = scenario === "native-scheduler-definition";
  const nativeScheduler = scenario === "native-scheduler" || scheduledAccounting || definitionScheduler;
  const compactionAccounting = scenario.startsWith("native-compaction-accounting");
  const compactionAccountingUnknown = scenario === "native-compaction-accounting-unknown";
  const compactionCloseFailure = scenario === "native-compaction-accounting-close-fail";
  const compactionAutoPending = scenario === 'native-compaction-accounting-auto-pending';
  let inManualSummary = false;
  let privateCompactionSignal:AbortSignal|undefined,privateCompactionAuthChanged=false;
  const heldPrivateSummary=scenario==='native-addon-service-continuation-compaction-background-held';
  const privateSummaryEntered=Promise.withResolvers<void>(),privateSummaryReleased=Promise.withResolvers<void>(),privateMainSettled=Promise.withResolvers<void>();
  let heldSummarySignal:AbortSignal|undefined;
  const dreamWorkEntered=Promise.withResolvers<void>(),dreamWorkReleased=Promise.withResolvers<void>();
  let dreamWorkSignal:AbortSignal|undefined;
  let checkpointHold: { entered(): void; signal?: AbortSignal } | undefined;
  const processAccounting = scenario.startsWith("native-process-exit-accounting");
  const processAccountingCloseFailure = scenario === "native-process-exit-accounting-close-fail";
  const usageProjection = scenario === "native-usage-projection";
  const serviceBudgetResume=scenario==='native-addon-service-budget-resume',serviceContinuation=scenario.startsWith('native-addon-service-continuation'),serviceBudgetGap=scenario==='native-addon-service-continuation-budget-gap';
  const addonServiceCase=scenario.startsWith('native-addon-service-'),addonRecovery=scenario.startsWith('native-addon-execution-recovery-'),addonCompaction=scenario.startsWith('native-addon-service-continuation-compaction');
  const parentAccounting = usageProjection || processAccounting || scenario.startsWith("native-parent-accounting") || delegateAccounting || scheduledAccounting || compactionAccounting || scenario.startsWith('native-addon-execution-accounting') || serviceBudgetResume || serviceBudgetGap || addonRecovery || addonCompaction || scenario.startsWith('native-dream-runner-accounted') || scenario==='native-dream-runner-budget-denied' || scenario==='native-dream-runner-held-provider-accounted' || scenario.startsWith('native-dream-runner-scheduled-budget') || scenario==='native-dream-runner-scheduled-unknown';
  const accountingTwoTurns = scenario === "native-parent-accounting-two-turns";
  const accountingAuthDenied = scenario === "native-parent-accounting-auth-deny";
  const lateUnaccounted = scenario === 'native-parent-accounting-late-unpriced' || scenario === 'native-parent-accounting-late-no-account';
  let lateSibling: { id: string; settle(): Promise<void> } | undefined;
  const accountingRotate = scenario === "native-parent-accounting-rotate";
  const accountingCloseFailure = processAccountingCloseFailure || scenario === "native-parent-accounting-close-work-fail";
  const accountingStorageFailure = scenario === "native-parent-accounting-storage-fail";
  const accountingUnknown = scenario==='native-dream-runner-scheduled-unknown' || scenario==='native-dream-runner-held-provider-accounted' || scenario==='native-dream-runner-accounted-unknown' || scenario === "native-parent-accounting-unknown" || scenario.startsWith('native-addon-execution-accounting')&&scenario.endsWith('-unknown');
  const model = { provider: parentAccounting ? "openai-codex" : "synthetic", id: "approved", name: "Approved", api: "openai-completions", baseUrl: "https://invalid.invalid", input: ["text"], reasoning: reasoningThinking, contextWindow: 10000, maxTokens: 1000, cost: { input: parentAccounting ? 1 : 0, output: parentAccounting ? 1 : 0, cacheRead: 0, cacheWrite: 0 } };
  if(scenario==='native-addon-execution-accounting-capped-small-output')model.cost.output=10000;
  if (parentAccounting) {
    mkdirSync(getPiclawAgentDir(), { recursive: true });
    writeFileSync(join(getPiclawAgentDir(), "auth.json"), JSON.stringify({ "openai-codex": { type: "oauth", access: "synthetic-access", refresh: "synthetic-refresh", accountId: "synthetic-account", expires: Date.now() + 60000 } }), { mode: 0o600 });
    onCredentialResolve = async () => {
      if (delegateAccounting || scheduledAccounting || compactionAccounting) expect((root.query("SELECT COUNT(*) AS n FROM budget_request_reservations WHERE state='reserved'").get() as { n: number }).n).toBeGreaterThan(0);
      else expect(root.query("SELECT state FROM budget_request_reservations ORDER BY rowid").all()).toEqual([...(accountingTwoTurns && calls > 0 ? [{ state: "settled" }] : []), { state: "reserved" }]);
      if (!delegateAccounting && !scheduledAccounting && !compactionAccounting) originalParentReservation = root.query("SELECT id,work_id,account_ref,binding_sha256,amount_microusd FROM budget_request_reservations ORDER BY rowid DESC LIMIT 1").get();
      if (compactionAutoPending && root.query("SELECT 1 FROM budget_request_reservations WHERE state='reserved' AND json_extract(model_invocation_json,'$.taskKind')='pi.compaction'").get()) root.exec(`CREATE TRIGGER IF NOT EXISTS compaction_pending_close BEFORE UPDATE ON budget_work WHEN NEW.status='completed'
        AND EXISTS(SELECT 1 FROM budget_request_reservations r WHERE r.work_id=NEW.id AND json_extract(r.model_invocation_json,'$.taskKind')='pi.compaction')
        BEGIN SELECT RAISE(ABORT,'compaction accounting status pending'); END`);
      if (accountingAuthDenied) throw Error("Synthetic auth denial");
      if (accountingCloseFailure) root.exec("CREATE TRIGGER accounting_work_close_fail BEFORE UPDATE ON budget_work WHEN OLD.parent_work_id IS NULL AND NEW.status='completed' BEGIN SELECT RAISE(ABORT, 'synthetic operation work close failure'); END");
      if (accountingStorageFailure) root.exec("CREATE TRIGGER accounting_usage_fail BEFORE INSERT ON token_usage BEGIN SELECT RAISE(ABORT, 'synthetic usage write failure'); END");
      if (accountingRotate) writeFileSync(join(getPiclawAgentDir(), "auth.json"), JSON.stringify({ "openai-codex": { type: "oauth", access: "rotated-access", refresh: "rotated-refresh", accountId: "rotated-account", expires: Date.now() + 60000 } }), { mode: 0o600 });
    };
  }
  if (lateUnaccounted) {
    if (scenario.endsWith('unpriced')) model.cost = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
    else writeFileSync(join(getPiclawAgentDir(), 'auth.json'), '{}');
    onCredentialResolve = async () => {
      const operation = root.query("SELECT operation_id,chat_jid FROM service_effect_s01_operations WHERE phase='executing'").get() as { operation_id: string; chat_jid: string } | null;
      if (!operation) return; // Initial authenticated-catalog refresh is not a send.
      expect(lateSibling).toBeUndefined();
      expect(root.query('SELECT count(*) n FROM budget_request_reservations').get()).toEqual({ n: 0 });
      const authPath = join(workspace, 'late-sibling-auth.json');
      writeFileSync(authPath, JSON.stringify({ 'openai-codex': { type: 'oauth', access: 'synthetic', refresh: 'synthetic', accountId: 'late-sibling', expires: Date.now() + 60000 } }));
      const paidModel = { ...model, cost: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0 } } as Model<Api>;
      const pending = (await reserveHostRequest({ database: root, operationId: operation.operation_id, chatJid: operation.chat_jid, authPath, model: paidModel,
        signal: new AbortController().signal, assertCurrent: () => owner.assertCurrentOwner(), terminalOwner: { signal: new AbortController().signal, assertCurrent: () => owner.assertCurrentOwner() } }))!;
      await pending.dispatch();
      const terminal = { role: 'assistant' as const, provider: model.provider, model: model.id, api: model.api, timestamp: 123, stopReason: 'stop' as const,
        content: [{ type: 'text' as const, text: 'synthetic paid sibling fact' }], usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2,
          cost: { input: 0.00003, output: 0.00001, cacheRead: 0, cacheWrite: 0, total: 0.00004 } } };
      await pending.retainTerminal(terminal);
      lateSibling = { id: pending.id, settle: () => pending.settle(terminal) };
    };
  }
  const requested: string[] = [];
  const planRequests: string[] = [];
  const requestToolNames:string[][]=[];
  let toolSequence: { name: string; arguments: JsonObject | (() => JsonObject) }[] | undefined;
  const nativeInfrastructure = scenario === "native-infrastructure";
  if (nativeInfrastructure) {
    const source = process.env.DURABLE_ADDONS_ROOT;
    assert(source, "DURABLE_ADDONS_ROOT required; never use live installed packages");
    for (const kind of ["proxmox", "portainer", "imap"]) {
      const pkg = join(workspace, ".pi/extensions/node_modules/@rcarmo/piclaw-addon-" + kind);
      cpSync(join(source, "addons", kind), pkg, { recursive: true, filter: path => !path.split("/").includes("node_modules") });
      symlinkSync(join(import.meta.dir, "../../node_modules"), join(pkg, "node_modules"));
    }
    toolSequence = [
      { name: "proxmox", arguments: { action: "contract" } },
      { name: "portainer", arguments: { action: "capabilities" } },
      { name: "imap", arguments: { action: "list_accounts" } },
    ];
  }
  if (accountingTwoTurns) toolSequence = [{ name: "read", arguments: { path: "accounting-two-turns.txt" } }];
  if (accountingTwoTurns) writeFileSync(join(workspace, "accounting-two-turns.txt"), "accounted tool turn");
  if(scenario.startsWith('native-addon-execution')||addonServiceCase)toolSequence=[
    {name:'write',arguments:{path:join(workspace,'native-addon-result.txt'),content:'ADMITTED_NATIVE_ADDON'}},
    scenario==='native-addon-execution-quota'?{name:'write',arguments:{path:join(workspace,'native-addon-result.txt'),content:'FORBIDDEN_AFTER_QUOTA'}}:{name:'read',arguments:{path:join(workspace,'native-addon-result.txt')}},
  ];
  if(serviceContinuation)toolSequence=toolSequence!.slice(0,1);
  if(scenario.startsWith('native-dream-runner'))toolSequence=[...(scenario==='native-dream-runner-tools'?[{name:'messages',arguments:{action:'search',query:'bounded-native-dream',chat_jid:'*',limit:1}},{name:'search_workspace',arguments:{query:'bounded-native-dream',scope:'notes',limit:1}}]:[]),{name:'write',arguments:{path:join(workspace,'notes/memory/native-dream-marker.md'),content:'ADMITTED_NATIVE_DREAM'}},{name:'read',arguments:{path:join(workspace,'notes/memory/native-dream-marker.md')}}];
  const nativeMcp = scenario.startsWith("native-mcp-");
  const mcpDisconnected = scenario === "native-mcp-disconnect";
  const mcpCatalogChanged = scenario === "native-mcp-catalog-change";
  const mcpError = scenario === "native-mcp-error";
  const mcpCancelled = scenario === "native-mcp-codemode-cancel";
  const mcpConcurrent = scenario === "native-mcp-concurrent";
  const mcpConfigChanged = scenario === "native-mcp-config-change";
  const mcpMarker = join(workspace, "mcp-calls"), mcpPid = join(workspace, "mcp-pid");
  if (nativeMcp) {
    mkdirSync(join(workspace, ".pi"), { recursive: true });
    writeFileSync(getConfigPath(), JSON.stringify({ domains: { mcp: { engine: "native", codemode: "on" } } }), { mode: 0o600 });
    writeFileSync(join(workspace, ".pi/mcp.json"), JSON.stringify({ mcpServers: { fixture: scenario === "native-mcp-http-deny" ? { url: "https://invalid.invalid/mcp" } : { command: process.execPath, args: [join(import.meta.dir, "mcp-stdio-fixture.ts"), mcpMarker, mcpPid] } } }));
    await hydrateMcpKeychainCredentials(workspace, async () => { throw Error("No keychain access allowed"); });
    toolSequence = [{ name: "codemode", arguments: { code: mcpDisconnected
      ? 'try { await tools.mcp__fixture__echo({message:"MCP_DISCONNECT"}); } catch {} store("revoked-sentinel","MUST_NOT_PERSIST");'
      : mcpCatalogChanged
      ? 'try { await tools.mcp__fixture__echo({message:"MCP_CATALOG_CHANGED"}); } catch {} try { await tools.mcp__fixture__echo({message:"FORBIDDEN_AFTER_CHANGE"}); } catch {} store("revoked-sentinel","MUST_NOT_PERSIST");'
      : mcpError
      ? 'const result = await tools.mcp__fixture__echo({message:"MCP_ERROR_SENTINEL"}); if (result.isError !== true) throw Error("MCP error flag lost"); console.log(result);'
      : mcpConcurrent
      ? 'const results = await Promise.all([tools.mcp__fixture__echo({message:"MCP_FIRST"}), tools.mcp__fixture__echo({message:"MCP_SECOND"})]); if (!JSON.stringify(results[0]).includes("MCP_FIRST") || !JSON.stringify(results[1]).includes("MCP_SECOND")) throw Error("MCP response correlation lost"); return results;'
      : mcpCancelled || mcpConfigChanged
      ? 'try { await tools.mcp__fixture__echo({message:"FORBIDDEN"}); } catch {} store("revoked-sentinel","MUST_NOT_PERSIST");'
      : 'console.log(await tools.mcp__fixture__echo({message:"OWNED_MCP_SENTINEL"}));' } }];
  }
  const codemodeReview = scenario === "native-codemode-code-review" || scenario === "native-codemode-code-review-cancel";
  const codemodeReviewCancelled = scenario === "native-codemode-code-review-cancel";
  const nativeReview = scenario === "native-code-review" || codemodeReview;
  const reviewPackage = nativeReview ? installCodeReviewFixture(workspace) : undefined;
  const recoveryPackage = scenario === "native-recovery-unit" || scenario === "native-retention-unit" ? installCodeReviewFixture(workspace) : undefined;
  if ((scenario === "native-codemode-cancel" || scenario === "native-codemode-binding-revoked")) toolSequence = [{ name: "codemode", arguments: {
    code: 'try { await tools.write({path:"codemode-forbidden.txt",content:"FORBIDDEN"}); } catch {} store("revoked-sentinel", {secret:"MUST_NOT_PERSIST"}); console.log("done");',
  } }];
  const codemodeReadPath = join(workspace, "codemode-reopen-read.txt");
  const codemodeMarker = join(workspace, "codemode-reopen-entered");
  const codemodePid = join(workspace, "codemode-reopen-pid");
  if (scenario === "native-codemode-reopen") {
    writeFileSync(codemodeReadPath, "NATIVE_CODEMODE_FIRST_READ");
    toolSequence = [{ name: "codemode", arguments: { code: `const first = await tools.read({path:${JSON.stringify(codemodeReadPath)}}); try { await tools.bash({command:${JSON.stringify(`printf x >> '${codemodeMarker}'; printf '%s' $$ > '${codemodePid}'; exec sleep 1000`)}}); } catch {} console.log(first);` } }];
  }
  const codemodeDrawio = scenario === "native-codemode-drawio" || scenario === "native-codemode-drawio-cancel";
  const nativeDrawio = scenario.startsWith("native-drawio") || codemodeDrawio;
  const drawioCancelled = scenario === "native-drawio-cancel" || scenario === "native-codemode-drawio-cancel";
  const drawioPath = codemodeDrawio ? "codemode-diagrams/new.drawio" : "nested/new.drawio";
  let drawioNestedCaptures = 0, drawioCreates = 0;
  let drawioDefaultXml: string | undefined;
  const drawioRequests: string[] = [];
  const drawioMissingOpener = scenario === "native-drawio-missing-opener";
  if (nativeDrawio) {
    const drawioPackage = await installDrawioFixture(workspace);
    if (codemodeDrawio) drawioDefaultXml = (await import(join(drawioPackage, "tool.ts"))).DEFAULT_DRAWIO_XML;
    writeFileSync(join(workspace, "existing.drawio"), "PRESERVED_DRAWIO");
    toolSequence = codemodeDrawio ? [{ name: "codemode", arguments: { code: drawioCancelled
      ? `try { await tools.open_drawio_editor({path:'codemode-diagrams/new.drawio'}); } catch {} store('revoked-drawio','MUST_NOT_PERSIST'); console.log('done');`
      : `const result=await tools.open_drawio_editor({path:'codemode-diagrams/new.drawio'}); if(typeof result!=="string") throw Error("Expected native tool output string"); console.log(result); const existing=await tools.open_drawio_editor({path:'existing.drawio'}); if(typeof existing!=="string") throw Error("Expected native tool output string"); console.log(existing);` } }]
      : [{ name: "open_drawio_editor", arguments: { path: "nested/new.drawio" } }, { name: "open_drawio_editor", arguments: { path: "existing.drawio" } }];
  }
  const codemodeOffice = scenario === "native-codemode-office-viewer" || scenario === "native-codemode-office-viewer-cancel";
  const nativeOffice = scenario.startsWith("native-office-viewer") || codemodeOffice;
  const officeCancelled = scenario === "native-office-viewer-cancel" || scenario === "native-codemode-office-viewer-cancel";
  const officePath = codemodeOffice ? "office-fixture.csv" : "office.csv";
  let officeNestedCaptures = 0;
  if (nativeOffice) {
    installOfficeViewerFixture(workspace);
    writeFileSync(join(workspace, officePath), "name,value\nfixture,1650\n");
    writeFileSync(join(workspace, "office.txt"), "unsupported");
    toolSequence = codemodeOffice ? [{ name: "codemode", arguments: () => ({ code: officeCancelled
      ? `try { await tools.open_office_viewer(${JSON.stringify({ path: officePath })}); } catch {} store("revoked-office", "MUST_NOT_PERSIST"); console.log("done");`
      : `const result = await tools.open_office_viewer(${JSON.stringify({ path: officePath })}); if (typeof result !== "string") throw Error("Expected native tool output string"); console.log(result);` }) }]
      : [{ name: "open_office_viewer", arguments: { path: "@office.csv" } },
        ...["office.txt", "missing.docx", "/tmp/outside-office.csv"].map(path => ({ name: "open_office_viewer", arguments: { path } }))];
  }
  const codemodeTable = scenario === "native-codemode-editable-table" || scenario === "native-codemode-editable-table-cancel";
  const codemodeTableCancelled = scenario === "native-codemode-editable-table-cancel";
  const nativeTable = scenario.startsWith("native-editable-table") || codemodeTable;
  let tableNestedCaptures = 0;
  if (nativeTable) {
    installEditableTableFixture(workspace);
    const tableArgs: JsonObject = { markdown: "Name | Role\n--- | ---\nRui | User", title: codemodeTable ? " Nested table " : " People " };
    toolSequence = codemodeTable ? [{ name: "codemode", arguments: { code: codemodeTableCancelled
      ? `try { await tools.editable_table(${JSON.stringify(tableArgs)}); } catch {} store('revoked-table','MUST_NOT_PERSIST'); console.log('done');`
      : `const output=await tools.editable_table(${JSON.stringify(tableArgs)});console.log(output);` } }]
      : [{ name: "editable_table", arguments: tableArgs }];
  }
  const codemodePlan = scenario.startsWith("native-codemode-plan");
  const codemodePlanCancelled = scenario === "native-codemode-plan-cancel";
  const nativeGoal = scenario === "native-goal" || scenario === "native-goal-local-denial" || scenario === "native-goal-critical-denial" || scenario === "native-goal-budget" || scenario === "native-codemode-plan-goal";
  const planClear = scenario === "native-plan-clear";
  const planInitiallyEmpty = scenario === "native-plan-initial-empty";
  const nativePlan = scenario.startsWith("native-plan") || nativeGoal || codemodePlan;
  if (nativeGoal) installGoalFixture(workspace);
  const defaultPlanStep = "Update this plan thoroughly with ongoing work";
  const planStep = planClear ? defaultPlanStep : codemodePlan ? "CODEMODE_PLAN_OWNED" : "NATIVE_PLAN_NEW";
  const expectedPlanMarkdown = planClear ? "" : `- [-] ${planStep}`;
  if (nativePlan) {
    const source = process.env.DURABLE_ADDONS_ROOT;
    if (!source) throw Error("DURABLE_ADDONS_ROOT required");
    const pkg = join(workspace, ".pi/extensions/node_modules/@rcarmo/piclaw-addon-plan-sidebar");
    mkdirSync(join(pkg, "compat"), { recursive: true });
    for (const [file, hash] of Object.entries({
      "index.ts": "303b6a270cdb0dfbdf0ffbce5ac02ee16574ea0da7e43d503f116137a1ee6579",
      "compat/chat-context.ts": "8cfa6c16f0a27308ecc665f80ba107064d4fa8ac34122676ff0d1cb46e719da5",
      "compat/extension-kv.ts": "02ae106a2d7ceee64286cac755943d53ed2fe725ef666640a889b6d63315324c",
    })) {
      const path = join(source, "addons/plan-sidebar", file);
      expect(createHash("sha256").update(readFileSync(path)).digest("hex")).toBe(hash);
      copyFileSync(path, join(pkg, file));
    }
    symlinkSync(join(import.meta.dir, "../../node_modules"), join(pkg, "node_modules"));
    writeFileSync(join(pkg, "package.json"), JSON.stringify({ name: "@rcarmo/piclaw-addon-plan-sidebar", version: "0.1.27", type: "module", pi: { extensions: ["./index.ts"] } }));
    extensionKvSet("plan-sidebar", "plan", { chat_jid: "web:default", markdown: planInitiallyEmpty ? "" : "- [ ] NATIVE_PLAN_OLD", updated_at: "2026-01-01" }, "chat", "web:default");
    toolSequence = planClear ? [{ name: "plan", arguments: { action: "write", markdown: "" } }] : codemodePlan ? [{ name: "codemode", arguments: { code: codemodePlanCancelled
      ? 'try { await tools.plan({action:"update",plan:[{step:"CODEMODE_PLAN_OWNED",status:"in_progress"}]}); } catch {} store("revoked-sentinel", {secret:"MUST_NOT_PERSIST"}); console.log("done");'
      : 'const r=await tools.plan({action:"update",plan:[{step:"CODEMODE_PLAN_OWNED",status:"in_progress"}]});console.log(r)' } }]
      : [{ name: "plan", arguments: { action: "update", plan: [{ step: planStep, status: "in_progress" }] } }];
  }
  if (scenario === "native-goal-budget" || scenario === "native-goal-local-denial" || scenario === "native-goal-critical-denial") toolSequence = undefined; // No tool round in these policy-boundary cases.
  const standardDelegate = scenario === "native-delegate-standard" || scenario === "native-delegate-standard-revoke";
  const readonlyDeny = scenario === "native-delegate-readonly-deny";
  const writeDelegate = standardDelegate || readonlyDeny;
  const revokeDelegate = scenario === "native-delegate-revoke-cap" || scenario === "native-delegate-revoke-provider" || scenario === "native-delegate-standard-revoke";
  const timeoutDelegate = scenario === "native-delegate-timeout";
  const explicitDelegate = explicitDelegateCases[scenario];
  const delegateImagesCase = scenario === "native-delegate-images";
  const delegateFiles = scenario === "native-delegate-files" || delegateImagesCase;
  if (delegateFiles) writeFileSync(join(workspace, "delegate-task"), delegateImagesCase ? Buffer.from(delegateImages.png, "base64") : "NATIVE_FILE_BYTES\r\n\t");
  const nativeDelegate = delegateAccounting || writeDelegate || delegateFiles || scenario === "native-delegate" || scenario === "native-delegate-denied" || revokeDelegate || timeoutDelegate || !!explicitDelegate;
  const delegateAllowed = writeDelegate || delegateFiles || scenario === "native-delegate" || timeoutDelegate || (!!explicitDelegate && !explicitDelegate.denied);
  const realTimer = globalThis.setTimeout;
  let expireDelegate: (() => void) | undefined;
  let deadlineRegistered!: () => void;
  const deadlineRegistration = new Promise<void>(resolve => { deadlineRegistered = resolve; });
  let timeoutProviderAborted = false;
  const deadlineSpy = timeoutDelegate ? spyOn(globalThis, "setTimeout").mockImplementation(((callback: () => void, ms?: number, ...args: unknown[]) => {
    if (ms !== undefined && ms >= 9000 && ms <= 10000) { expireDelegate = callback; deadlineRegistered(); return realTimer(() => {}, 60_000); }
    return realTimer(callback, ms, ...args);
  }) as typeof setTimeout) : undefined;
  const sentinel = "PRIVATE_NATIVE_DELEGATE_READ_SENTINEL";
  const childReadPath = join(workspace, "delegate-private-read.txt");
  if (revokeDelegate) writeFileSync(childReadPath, sentinel);
  const childWritePath = (id: string) => join(workspace, `delegate-write-${id}.txt`);
  if (writeDelegate) for (const id of ["A", "B"]) writeFileSync(childWritePath(id), "OLD");
  if (nativeDelegate) {
    const source = process.env.DURABLE_ADDONS_ROOT;
    if (!source) throw Error("DURABLE_ADDONS_ROOT required");
    const pkg = join(workspace, ".pi/extensions/node_modules/@rcarmo/piclaw-addon-delegate");
    mkdirSync(join(pkg, "compat"), { recursive: true });
    for (const [file, hash] of Object.entries({
      "index.ts": "73563d26795cbab5cd92e8d5f8dabe3d7477fa11dff35e0ed8b21d9ec3f5ab51",
      "delegate.ts": "b0e3fd1d2edcd95cecedff84ac3204fba8bfdadaa70854e6009713e44ba8a402",
      "compat/extension-kv.ts": "3e86c21a9bf94d43151311fe29a3de1778d7a0a2ae32b81bb634e9fd1b2de4ab",
    })) {
      const path = join(source, "addons/delegate", file);
      expect(createHash("sha256").update(readFileSync(path)).digest("hex")).toBe(hash);
      copyFileSync(path, join(pkg, file));
    }
    symlinkSync(join(import.meta.dir, "../../node_modules"), join(pkg, "node_modules"));
    const manifest = JSON.parse(readFileSync(join(source, "addons/delegate/package.json"), "utf8"));
    expect(manifest.name).toBe("@rcarmo/piclaw-addon-delegate"); expect(manifest.version).toBe("0.2.21");
    writeFileSync(join(pkg, "package.json"), JSON.stringify(manifest));
    model.id = "gpt-6.1-sol";
    extensionKvSet("delegate", "config", { searchable_providers: scenario !== "native-delegate-denied" ? [model.provider] : [],
      excluded_providers: explicitDelegate?.exclude === "provider" ? [model.provider] : [],
      excluded_models: explicitDelegate?.exclude === "model" ? [String(explicitDelegate.model)] : [] }, "global");
  }
  let childRequests = 0;
  let releaseChildren!: () => void;
  const bothChildren = new Promise<void>(resolve => { releaseChildren = resolve; });
  // Leave room for the real built-in schemas and idle-model framing reserve.
  model.contextWindow = 100000;
  const modelB = { ...model, input: delegateImagesCase ? ["text", "image"] : model.input, id: delegateImagesCase ? "gpt-5-mini" : explicitDelegate?.id ?? (revokeDelegate ? "gpt-5-mini" : nativeScheduler ? "approved/b" : "approved-b"), contextWindow: 200000 };
  const childModels: string[] = [];
  const observedResults = new Map<string, { toolName: string; isError?: boolean; content: unknown }>();
  const stream = (physical: typeof model, input: { messages: { role: string; toolCallId?: string; toolName?: string; isError?: boolean; content: unknown;toolsAdded?:{name:string}[] }[] }, options?: { signal?: AbortSignal }) => {
    requestToolNames.push(input.messages.flatMap(message=>message.role==='system'?message.toolsAdded?.map(tool=>tool.name)??[]:[]));
    for (const result of input.messages) if (result.role === "toolResult" && result.toolCallId && result.toolName)
      observedResults.set(result.toolCallId, { toolName: result.toolName, isError: result.isError, content: result.content });
    if (definitionScheduler) {
      expect(JSON.stringify(input.messages)).toContain("scheduled real consumer");
      expect(JSON.stringify(input.messages)).not.toContain("MUTABLE CACHE MUST NEVER EXECUTE");
    }
    requested.push(physical.id);
    planRequests.push(JSON.stringify(input));
    calls++; const stream = createAssistantMessageEventStream();
    if (checkpointHold) {
      checkpointHold.signal = options?.signal;
      checkpointHold.entered();
      void awaitWithContext(new Promise<void>(() => {}), withAbortSignal(options!.signal!, context)).catch(() => {
        const error = { role: "assistant" as const, content: [], api: physical.api, provider: physical.provider, model: physical.id,
          timestamp: 1, stopReason: "aborted" as const, usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } };
        stream.push({ type: "error", reason: "aborted", error }); stream.end(error);
      });
      return stream;
    }
    if (parentAccounting && !delegateAccounting && !scheduledAccounting && !compactionAccounting && !addonCompaction) {
      const settled=scenario.startsWith('native-addon-execution-accounting')||serviceBudgetResume||serviceBudgetGap||addonRecovery||scenario==='native-dream-runner-accounted'||scenario==='native-dream-runner-scheduled-budget'?calls-1:accountingTwoTurns&&calls>1?1:0;
      expect(root.query("SELECT state FROM budget_request_reservations ORDER BY rowid").all()).toEqual([...Array.from({length:settled},()=>({state:'settled'})), { state: "dispatched" }]);
    }
    const child = nativeDelegate && JSON.stringify(input.messages.findLast(message => message.role === "user")?.content).includes("NATIVE_DELEGATE_CHILD");
    if (delegateImagesCase && !child) expect(JSON.stringify(input)).not.toContain('"type":"image"');
    const firstDelegate = nativeDelegate && !child && !input.messages.some(message => message.role === "toolResult");
    if (child) {
      childRequests++;
      childModels.push(physical.id);
      if (delegateFiles) {
        const user = JSON.stringify(input.messages.findLast(message => message.role === "user")?.content);
        if (delegateImagesCase) {
          expect(user.includes('"type":"image"')).toBe(user.includes("CHILD_B"));
          expect(physical.id).toBe(user.includes("CHILD_B") ? modelB.id : model.id);
          if (user.includes("CHILD_B")) expect(user).toContain(delegateImages.png);
        } else expect(user.includes("NATIVE_FILE_BYTES")).toBe(user.includes("CHILD_B"));
        expect(user).not.toContain(join(workspace, "delegate-task"));
      }
      expect(JSON.stringify(input)).not.toContain("hello factory");
      expect(JSON.stringify(input)).not.toContain('"name":"delegate"');
      expect(JSON.stringify(input)).not.toContain('"name":"plan"');
      expect(JSON.stringify(input)).not.toContain('"name":"code_review"');
      if (childRequests === (revokeDelegate ? 1 : 2)) {
        releaseChildren();
        if (timeoutDelegate) void deadlineRegistration.then(() => { expireDelegate!(); });
      }
    }
    const childId = JSON.stringify(input.messages.findLast(message => message.role === "user")?.content).includes("CHILD_B") ? "B" : "A";
    const childWrite = child && writeDelegate && !input.messages.some(message => message.role === "toolResult");
    const privateSummary=addonCompaction&&JSON.stringify(input).includes('You are a context summarization assistant.');
    const repeatedInitial=serviceBudgetResume&&calls===2&&JSON.stringify(input.messages.findLast(message=>message.role==='user')?.content).includes('Admit a private operation without legacy context');
    const step = privateSummary?undefined:repeatedInitial?{name:'write',arguments:{path:join(workspace,'native-addon-result.txt'),content:'UNSAFE_ORIGINAL_REPLAY'}}:childWrite ? { name: "write", arguments: { path: childWritePath(childId), content: `WRITTEN_${childId}` } } : toolSequence?.shift();
    const scheduledRequest = JSON.stringify(input.messages).includes("scheduled real consumer");
    const pricedResponse = parentAccounting && !accountingUnknown && !(delegateAccountingUnknown && child) && !(scheduledAccountingUnknown && scheduledRequest) && !(compactionAccountingUnknown && inManualSummary) && !(privateSummary&&scenario.endsWith('-unknown'));
    const message = { role: "assistant" as const, api: "openai-completions" as const, provider: physical.provider, model: physical.id,
      content: nativeInfrastructure && step ? [step, ...toolSequence!.splice(0)].map((item, index) => ({ type: "toolCall" as const, id: `infrastructure-${index}`, name: item.name, arguments: typeof item.arguments === "function" ? item.arguments() : item.arguments })) : firstDelegate ? (revokeDelegate ? ["A"] : ["A", "B"]).map(id => ({ type: "toolCall" as const, id, name: "delegate", arguments: { prompt: `NATIVE_DELEGATE_CHILD_${id}`, tools: standardDelegate ? "standard" : "read_only", task_category: "reason", ...(delegateImagesCase && id === "B" ? { model: `${modelB.provider}/${modelB.id}` } : {}), ...(explicitDelegate && (explicitDelegate.denied || id === "B") ? { model: explicitDelegate.model } : revokeDelegate ? { model: `${modelB.provider}/${modelB.id}` } : {}), ...(timeoutDelegate && id === "A" ? { timeout_sec: 10 } : {}), ...(delegateFiles && id === "B" ? { files: ["delegate-task"] } : {}) } })) : child && revokeDelegate && !writeDelegate && !input.messages.some(message => message.role === "toolResult") ? [{ type: "toolCall" as const, id: "child-private-read", name: "read", arguments: { path: childReadPath } }] : step ? [{ type: "toolCall" as const, id: `factory-tool-${calls}`, name: step.name, arguments: typeof step.arguments === "function" ? step.arguments() : step.arguments }]
        : [{ type: "text" as const, text: privateSummary?'PRIVATE_NATIVE_COMPACTION_SUMMARY':scenario==='native-addon-execution-large-result'?'é'.repeat(70_000):"factory synthetic reply" }], stopReason: step || firstDelegate || (child && revokeDelegate && !input.messages.some(message => message.role === "toolResult")) ? "toolUse" as const : "stop" as const, timestamp: Date.now(),
      usage: scenario==='native-addon-execution-accounting-capped-small-output'?{input:5000,output:1000,cacheRead:0,cacheWrite:0,totalTokens:6000,cost:{input:0.005,output:10,cacheRead:0,cacheWrite:0,total:10.005}}:{ ...(usageProjection ? { providerCost: 0, reasoningTokens: 2, cacheReadReported: true } : {}), input: 5, output: 5, cacheRead: 0, cacheWrite: 0, totalTokens: 10, cost: { input: pricedResponse ? 0.000005 : 0, output: pricedResponse ? 0.000005 : 0, cacheRead: 0, cacheWrite: 0, total: pricedResponse ? 0.00001 : 0 } } };
    onProviderResponse?.();
    void (async () => {
      if(scenario.startsWith('native-dream-runner-held-provider')&&process.env.PICLAW_NATIVE_RESTART_PHASE!=='read'&&calls===1){dreamWorkSignal=options?.signal;dreamWorkEntered.resolve();await dreamWorkReleased.promise;}
      if(privateSummary&&heldPrivateSummary){heldSummarySignal=options?.signal;privateSummaryEntered.resolve();await privateSummaryReleased.promise;}
      if (child) await bothChildren;
      if (child && timeoutDelegate && JSON.stringify(input.messages.findLast(m => m.role === "user")?.content).includes("CHILD_A")) {
        try {
          await awaitWithContext(new Promise<void>(() => {}), options?.signal ? withAbortSignal(options.signal, context) : context);
        } catch (error) {
          timeoutProviderAborted = true;
          const aborted = { ...message, content: [], stopReason: "aborted" as const, errorMessage: String(error) };
          stream.push({ type: "error", reason: "aborted", error: aborted }); stream.end(aborted); return;
        }
      }
      if (scenario === "native-parent-accounting-held-writer") {
        expect(calls).toBe(1);
        terminalStarted = performance.now();
        const path = (root.query("SELECT file FROM pragma_database_list WHERE name='main'").get() as { file: string }).file;
        terminalWriter = new Database(path); terminalWriter.exec('BEGIN IMMEDIATE');
        terminalPulse = setInterval(() => { terminalTicks++; }, 10);
        terminalRelease = setTimeout(() => { terminalWriter!.exec('COMMIT'); terminalWriter!.close(); terminalWriter = undefined; clearInterval(terminalPulse); }, 5200);
      }
      if (scenario === "native-compaction-accounting-side-dispatch") stream.push({ type: "text_delta", contentIndex: 0, delta: "factory synthetic reply", partial: message });
      stream.push({ type: "done", reason: message.stopReason, message }); stream.end(message);
      // The public event stream adds its own duration synchronously on push.
      // Capture that actual SDK-visible terminal, before the consumer resumes.
      if (scenario === 'native-parent-accounting-held-writer' || scenario === 'native-parent-accounting-event-fence') originalPaidTerminal = structuredClone(message);
    })(); return stream;
  };
  const credentialStore = createTestCredentialStore({ [model.provider]: { type: "api_key", key: "synthetic-only" } });
  const runtime = await ModelRuntime.create({ modelsPath: null, modelsStore: { read: async () => undefined, write: async () => {}, delete: async () => {} },
    credentials: credentialStore,
    allowModelNetwork: false, refreshOnCreate: false });
  runtime.registerNativeProvider({ id: model.provider, name: "Synthetic", getModels: () => [model, modelB] as any,
    auth: { apiKey: { name: "Synthetic", check: async () => ({ type: "api_key" }), resolve: async () => { await onCredentialResolve?.(); return { auth: { apiKey: "synthetic-only" }, source: "synthetic" }; } } },
    stream: stream as any, streamSimple: stream as any });
  // Native registration starts an asynchronous refresh; finish it before
  // reading the synchronous authenticated catalog on a genuinely cold start.
  await runtime.refresh({ allowNetwork: false });
  const modelRegistry = new ModelRegistry(runtime);
  await runtime.getAvailable();
  const services = { modelRuntime: runtime, modelRegistry } as RuntimeModelServices;
  const settings = SettingsManager.create(workspace, getPiclawAgentDir());
  settings.setDefaultModelAndProvider(model.provider, model.id);
  await settings.flush();
  expect(settings.drainErrors()).toEqual([]);
  expect(modelRegistry.getAvailable().map(m => [m.provider, m.id])).toEqual([[model.provider, model.id], [modelB.provider, modelB.id]]);
  expect(SettingsManager.create(workspace, getPiclawAgentDir()).getDefaultModel()).toBe(model.id);
  const sdkSpies = [spyOn(SessionManager, "create"), spyOn(SessionManager, "open"), spyOn(SessionManager, "inMemory")];
  if (scenario === "native-parent-budget-auth-cap") onCredentialResolve = async () => {
    saveBudgetCap({ scope: "instance_daily", metric: "api_usd_micros", amount: 0, timezone: "UTC" }, root);
  };
  let automaticCaptureSpy: { mockRestore(): void } | undefined;
  let compactionPolicySpy: { mockRestore(): void } | undefined;
  if (scenario === "public-shim-compaction" || compactionAccounting) {
    const open = Harness.open;
    compactionPolicySpy = spyOn(Harness, "open").mockImplementation((storage, options, ctx) => open.call(Harness, storage, { ...options,
      settings: { ...options.settings, compaction: { enabled: false, keepRecentTokens: 1 } } }, ctx));
  }
  if (scenario === "native-compaction-accounting-auto" || scenario === "native-compaction-accounting-background") {
    const capture = HostConversationRuntime.prototype.captureAutomaticCompaction;
    const spy = spyOn(HostConversationRuntime.prototype, "captureAutomaticCompaction").mockImplementation(async function (this: HostConversationRuntime, scope, binding) {
      expect(() => capture.call(this, { ...scope, phase: "select" }, binding)).toThrow("Exact automatic compaction required");
      expect(() => capture.call(this, scope, { ...binding, chatJid: "web:forged" })).toThrow();
      expect(() => capture.call(this, { ...scope, signal: AbortSignal.abort() }, binding)).toThrow();
      await expect(capture.call(this, { ...scope, taskId: -1 }, binding)).rejects.toThrow("Exact automatic compaction task required");
      return capture.call(this, scope, binding);
    });
    // The assertion closure is restored with the other capture spies below.
    automaticCaptureSpy = spy;
  }
  let realRunCaptures = 0, realToolCaptures = 0, pendingAdmissionCaptures = 0;
  const pendingAdmissionCalls:string[]=[];
  let expectedToolSource = "factory-input";
  const captureSpies: { mockRestore(): void }[] = [];
  if(scenario==='native-dream-runner-held-tool'){
    const capture=HostConversationRuntime.prototype.captureToolSource;
    captureSpies.push(spyOn(HostConversationRuntime.prototype,'captureToolSource').mockImplementation(async function(this:HostConversationRuntime,...args:Parameters<typeof capture>){
      const source=await capture.apply(this,args);dreamWorkEntered.resolve();await dreamWorkReleased.promise;return source;
    }));
  }
  if(addonCompaction){
    if(heldPrivateSummary){
      const wait=HostConversationRuntime.prototype.wait;
      captureSpies.push(spyOn(HostConversationRuntime.prototype,'wait').mockImplementation(async function(this:HostConversationRuntime,...args:Parameters<typeof wait>){await wait.apply(this,args);if(heldSummarySignal)privateMainSettled.resolve();}));
    }
    const capture=HostConversationRuntime.prototype.captureAutomaticCompaction;
    captureSpies.push(spyOn(HostConversationRuntime.prototype,'captureAutomaticCompaction').mockImplementation(async function(this:HostConversationRuntime,scope,binding){
      const captured=await capture.call(this,scope,binding);privateCompactionSignal=scope.signal;return captured;
    }));
  }
  if(scenario==='native-addon-execution-accounting-capped-small-output'){
    const open=Harness.open;captureSpies.push(spyOn(Harness,'open').mockImplementation((storage,options,ctx)=>{
      assert(options.models);const models=typeof options.models==='function'?options.models():options.models;
      return open.call(Harness,storage,{...options,models:new Proxy(models,{get(target,key){
        if(key==='streamSimple')return(...args:Parameters<typeof models.streamSimple>)=>models.streamSimple(args[0],args[1],{...args[2],maxTokens:1});
        return Reflect.get(target,key);
      }})},ctx);
    }));
  }
  if (nativePlan) {
    const capturePending = HostConversationRuntime.prototype.capturePendingToolSource;
    captureSpies.push(spyOn(HostConversationRuntime.prototype, "capturePendingToolSource").mockImplementation(async function(this:HostConversationRuntime,...args:Parameters<typeof capturePending>){
      const captured=await capturePending.apply(this,args);
      pendingAdmissionCaptures++;pendingAdmissionCalls.push(args[2]);
      expect(captured.inputs[0]?.sourceId).toBe(expectedToolSource);
      expect(captured.operation.chatJid).toBe("web:default");
      expect(captured.runTaskId).toBeDefined();
      return captured;
    }));
    const captureRun = HostConversationRuntime.prototype.captureRunSource;
    captureSpies.push(spyOn(HostConversationRuntime.prototype, "captureRunSource").mockImplementation(async function (this: HostConversationRuntime, ...args) {
      const captured = await captureRun.apply(this, args);
      realRunCaptures++;
      expect(captured.operation.chatJid).toBe("web:default");
      const readonly = createPlanKvAuthority(root, captured, () => owner.assertCurrentOwner(), true);
      readonly.assertCurrent();
      expect(() => readonly.write(() => {})).toThrow("Read-only host operation authority");
      await expect(captureRun.call(this, args[0], -1 as never)).rejects.toThrow("Exact host tool run required");
      return captured;
    }));
    const captureTool = HostConversationRuntime.prototype.captureToolSource;
    captureSpies.push(spyOn(HostConversationRuntime.prototype, "captureToolSource").mockImplementation(async function (this: HostConversationRuntime, ...args) {
      const captured = await captureTool.apply(this, args);
      realToolCaptures++;
      expect(captured.inputs[0]?.sourceId).toBe(expectedToolSource);
      const authority = createPlanKvAuthority(root, captured, () => owner.assertCurrentOwner());
      authority.assertCurrent();
      const revoked = createPlanKvAuthority(root, captured, () => { throw Error("Owner lost"); });
      expect(() => revoked.write(() => {})).toThrow("Owner lost");
      const rollback = Error("rollback cancellation probe");
      expect(() => root.transaction(() => {
        root.query("UPDATE service_effect_s01_operations SET phase='cancelling' WHERE operation_id=?").run(captured.operation.operationId);
        expect(() => authority.write(() => {})).toThrow("Stale host operation authority");
        throw rollback;
      })()).toThrow(rollback);
      authority.assertCurrent();
      if (codemodePlan && args[2].includes("/")) {
        codemodeNestedCaptures++;
        if (codemodePlanCancelled) root.query("UPDATE service_effect_s01_operations SET phase='cancelling' WHERE operation_id=?").run(captured.operation.operationId);
      }
      return captured;
    }));
  }
  if (codemodeDrawio) {
    const actualOpen = hostFs.openSync;
    captureSpies.push(spyOn(hostFs, "openSync").mockImplementation(((path: unknown, ...args: unknown[]) => {
      if (String(path) === join(workspace, drawioPath)) drawioCreates++;
      return (actualOpen as Function)(path, ...args);
    }) as typeof hostFs.openSync));
  }
  let codemodeReads = 0;
  if (scenario === "native-codemode-reopen") {
    const actualRead = hostFs.readFileSync;
    captureSpies.push(spyOn(hostFs, "readFileSync").mockImplementation(((path: unknown, ...args: unknown[]) => {
      if (String(path) === codemodeReadPath) codemodeReads++;
      return (actualRead as Function)(path, ...args);
    }) as typeof hostFs.readFileSync));
    expect(readFileSync(codemodeReadPath, "utf8")).toBe("NATIVE_CODEMODE_FIRST_READ");
    expect(codemodeReads).toBe(1); codemodeReads = 0;
  }
  let codemodeNestedCaptures = 0;
  if ((mcpCancelled || mcpConfigChanged || scenario === "native-codemode-cancel" || scenario === "native-codemode-binding-revoked")) {
    const captureTool = HostConversationRuntime.prototype.captureToolSource;
    captureSpies.push(spyOn(HostConversationRuntime.prototype, "captureToolSource").mockImplementation(async function (this: HostConversationRuntime, ...args) {
      const captured = await captureTool.apply(this, args);
      if (args[2].includes("/")) {
        codemodeNestedCaptures++;
        if (mcpConfigChanged) writeFileSync(join(workspace, ".pi/mcp.json"), JSON.stringify({ mcpServers: {} }));
        else if (scenario === "native-codemode-binding-revoked") root.query("UPDATE service_effect_s01_operations SET harness_session_id=harness_session_id||'-revoked' WHERE operation_id=?").run(captured.operation.operationId);
        else root.query("UPDATE service_effect_s01_operations SET phase='cancelling' WHERE operation_id=?").run(captured.operation.operationId);
      }
      return captured;
    }));
  }
  let childSourceCaptures = 0;
  let sentinelReads = 0;
  if (revokeDelegate) {
    const actualRead = hostFs.readFileSync;
    captureSpies.push(spyOn(hostFs, "readFileSync").mockImplementation(((path: unknown, ...args: unknown[]) => {
      if (String(path) === childReadPath) sentinelReads++;
      return (actualRead as Function)(path, ...args);
    }) as typeof hostFs.readFileSync));
    // Prove the spy observes the same static fs binding used by host-builtins.
    expect(readFileSync(childReadPath, "utf8")).toBe(sentinel);
    expect(sentinelReads).toBe(1);
    sentinelReads = 0;
    const captureTool = HostConversationRuntime.prototype.captureToolSource;
    captureSpies.push(spyOn(HostConversationRuntime.prototype, "captureToolSource").mockImplementation(async function (this: HostConversationRuntime, ...args) {
      const captured = await captureTool.apply(this, args);
      if (captured.delegateModel) {
        expect(args[2]).toBe(standardDelegate ? `factory-tool-${calls}` : "child-private-read");
        expect(captured.delegateModel).toMatchObject({ provider: modelB.provider, modelId: modelB.id });
        childSourceCaptures++;
        // The real capture has already admitted this model. Revoke across its
        // await boundary, before the default factory returns its effect guard.
        if (scenario === "native-delegate-revoke-cap" || standardDelegate) saveBudgetCap({ scope: "instance_daily", metric: "api_usd_micros", amount: 0, timezone: "UTC" }, root);
        else extensionKvSet("delegate", "config", { searchable_providers: [], excluded_providers: [], excluded_models: [] }, "global");
      }
      return captured;
    }));
  }
  if (nativeTable || nativeOffice || nativeDrawio) {
    const captureTool = HostConversationRuntime.prototype.captureToolSource;
    captureSpies.push(spyOn(HostConversationRuntime.prototype, "captureToolSource").mockImplementation(async function (this: HostConversationRuntime, ...args) {
      const captured = await captureTool.apply(this, args);
      realToolCaptures++;
      expect(captured.inputs[0]?.sourceId).toBe("factory-input");
      if (codemodeTable && args[2].includes("/")) {
        tableNestedCaptures++;
        expect(captured.operation.chatJid).toBe("web:default");
        expect(captured.operation.harness).toBeDefined();
        expect(captured.delegateModel).toBeUndefined();
        if (codemodeTableCancelled) root.query("UPDATE service_effect_s01_operations SET phase='cancelling' WHERE operation_id=?").run(captured.operation.operationId);
      }
      if (codemodeOffice) {
        expect(captured.operation.chatJid).toBe("web:default");
        expect(captured.operation.harness).toBeDefined();
        if (args[2].includes("/")) officeNestedCaptures++;
      }
      if (codemodeDrawio && args[2].includes("/")) {
        drawioNestedCaptures++;
        expect(captured.operation.chatJid).toBe("web:default");
        expect(captured.operation.harness).toBeDefined();
        expect(captured.delegateModel).toBeUndefined();
      }
      if ((officeCancelled && (!codemodeOffice || args[2].includes("/"))) || (drawioCancelled && (!codemodeDrawio || args[2].includes("/")))) root.query("UPDATE service_effect_s01_operations SET phase='cancelling' WHERE operation_id=?").run(captured.operation.operationId);
      if (scenario === "native-editable-table-closed-publisher") backend.stop();
      if (scenario === "native-editable-table-revoked") root.query("UPDATE service_effect_s01_operations SET phase='cancelling' WHERE operation_id=?").run(captured.operation.operationId);
      // Host-owned SQL changes actual binding/route authority after capture.
      // Neither stale captured capability may publish.
      if (scenario === "native-editable-table-archived") root.query("UPDATE chat_branches SET archived_at=? WHERE chat_jid=? AND branch_id=?").run(new Date().toISOString(), captured.inputs[0]!.chatJid, captured.inputs[0]!.branchId);
      if (scenario === "native-editable-table-binding-revoked") root.query("UPDATE service_effect_s01_operations SET harness_operation_id=harness_operation_id||'-revoked' WHERE operation_id=?").run(captured.operation.operationId);
      return captured;
    }));
  }
  const recoveryBarrier=recoveryPackage ? (()=>{
    let enter!:()=>void, release!:()=>void;
    const entered=new Promise<void>(resolve=>{enter=resolve;}), held=new Promise<void>(resolve=>{release=resolve;});
    const original=HostConversationRuntime.prototype.wait;let firstWait=true;
    const hook=spyOn(HostConversationRuntime.prototype,"wait").mockImplementation(async function(this:HostConversationRuntime,...args:Parameters<typeof original>){
      await original.apply(this,args);
      if(firstWait){firstWait=false;enter();await held;}
    });
    captureSpies.push(hook);return {entered,release,hook};
  })():undefined;
  if (scenario === "native-mcp-http-deny") {
    await expect(createDefaultApplicationRuntime(owner, async () => { throw Error("Must reject before models"); })).rejects.toThrow();
    expect(existsSync(mcpPid)).toBe(false);
    expect(existsSync(mcpMarker)).toBe(false);
    for (const spy of [...captureSpies, ...sdkSpies]) spy.mockRestore();
    owner.release(); closeDatabase(); return;
  }
  if (scenario === "native-routing-initial-rollback" || scenario === "native-routing-initial-ack") {
    const actual = BunSqliteDatabase.prototype.transaction;
    let failures = 0;
    const published = () => !!root.query("SELECT 1 FROM sqlite_schema WHERE name='documents'").get()
      && !!root.query("SELECT 1 FROM documents WHERE kind='\"app.application-conversations\"' AND owner_id=1").get()
      && (root.query("SELECT count(*) n FROM conversations").get() as { n: number }).n > 1;
    const fault = spyOn(BunSqliteDatabase.prototype, "transaction").mockImplementation(async function<T>(this: BunSqliteDatabase, callback: (tx: SqliteExecutor) => Promise<T>): Promise<T> {
      const value = await actual.call<BunSqliteDatabase, [(tx: SqliteExecutor) => Promise<T>], Promise<T>>(this, async tx => {
        const value = await callback(tx);
        // Read the candidate executor: the separate host connection cannot see
        // uncommitted SDK writes and would inject into a later transaction.
        const candidateSchema = await tx.get("SELECT 1 FROM sqlite_schema WHERE name='conversations'");
        const candidatePublished = candidateSchema ? await tx.get<{ n: number }>("SELECT count(*) n FROM conversations") : undefined;
        if (!failures && scenario.endsWith("rollback") && (candidatePublished?.n ?? 0) > 1) { failures++; throw Error("initial publication rollback"); }
        return value;
      });
      if (!failures && scenario.endsWith("ack") && published()) { failures++; throw Error("initial publication ACK lost"); }
      return value;
    });
    try { await expect(createDefaultApplicationRuntime(owner, async () => services)).rejects.toThrow("initial publication"); }
    finally { fault.mockRestore(); }
    expect(failures).toBe(1); expect(calls).toBe(0);
    expect(root.query("SELECT id FROM tasks").all()).toEqual([]);
    if (scenario.endsWith("rollback")) {
      expect(root.query("SELECT id FROM conversations").all()).toEqual([]);
      expect(root.query("SELECT id FROM documents").all()).toEqual([]);
      // The SDK schema prefix has no published domain. Never guess/reset/adopt
      // it on restart; an explicit matching checkpoint is required.
      await expect(createDefaultApplicationRuntime(owner, async () => { throw Error("must reject before models"); })).rejects.toThrow("manifest");
    } else {
      const identities = root.query("SELECT id,record FROM conversations ORDER BY id").all();
      const anchors = root.query("SELECT r.* FROM documents d JOIN document_revisions r ON r.document_id=d.id WHERE d.kind IN ('\"app.application-conversations\"','\"app.application-identity\"') ORDER BY r.document_id,r.seq").all();
      const reopened = await createDefaultApplicationRuntime(owner, async () => services);
      expect(reopened.sessionOptions.getDurableSession!("web:default")).toBeDefined();
      expect(root.query("SELECT id,record FROM conversations ORDER BY id").all()).toEqual(identities);
      expect(root.query("SELECT r.* FROM documents d JOIN document_revisions r ON r.document_id=d.id WHERE d.kind IN ('\"app.application-conversations\"','\"app.application-identity\"') ORDER BY r.document_id,r.seq").all()).toEqual(anchors);
      expect(calls).toBe(0); reopened.stop(); await reopened.close();
    }
    for (const spy of [...captureSpies, ...sdkSpies]) spy.mockRestore();
    closeDatabase(); owner.release(); return;
  }
  const capturedEventObservers: HostModelEventObserver[] = [];
  const originalModelFactory = hostModelBridge.createHostModels;
  const observerPolicySpy = scenario === "native-compaction-accounting-side-dispatch"
    ? spyOn(hostModelBridge, "createHostModels").mockImplementation((host, approved, policy) => {
      const capture = policy.captureEventObserver;
      return originalModelFactory(host, approved, { ...policy, captureEventObserver(signal) {
        const observer = capture?.call(policy, signal);
        if (observer) capturedEventObservers.push(observer);
        return observer;
      } });
    }) : undefined;
  const terminalFenceSpy = scenario === 'native-parent-accounting-event-fence'
    ? spyOn(hostModelBridge, 'createHostModels').mockImplementation((host, approved, policy) => {
      let capturedSource: (() => void) | undefined;
      return originalModelFactory(host, approved, { ...policy,
        async captureSourceGuard(signal) {
          capturedSource = await policy.captureSourceGuard?.(signal);
          if (!capturedSource) throw Error('Fixture requires the real source guard');
          return capturedSource;
        },
        captureEventObserver(signal) {
          const original = policy.captureEventObserver?.(signal);
          return {
            assertCurrent() {
              original?.assertCurrent(); capturedSource!(); terminalFenceCalls++;
              terminalFenceObservedReceipt = !!(root.query('SELECT terminal_receipt_json FROM budget_request_reservations ORDER BY rowid DESC LIMIT 1').get() as { terminal_receipt_json: string | null }).terminal_receipt_json;
              throw Error('Synthetic mandatory terminal fence failure');
            },
            onEvent(event) { terminalObserverCalls++; original?.onEvent(event); },
          };
        },
      });
    }) : undefined;
  let backend: Awaited<ReturnType<typeof createDefaultApplicationRuntime>>;
  if (scenario === "native-drawio-prepare-held") {
    let entered!: () => void, release!: () => void;
    const inside = new Promise<void>(resolve => { entered = resolve; });
    const hold = new Promise<void>(resolve => { release = resolve; });
    const extract = Bun.Archive.prototype.extract;
    const gate = spyOn(Bun.Archive.prototype, "extract").mockImplementation(async function (this: Bun.Archive, ...args) {
      entered(); await hold; return extract.apply(this, args);
    });
    let modelCalls = 0, finished = false;
    const primary = Error("model construction failed after vendor preparation");
    const pending = createDefaultApplicationRuntime(owner, async () => { modelCalls++; throw primary; })
      .then(() => { finished = true; return undefined; }, error => { finished = true; return error; });
    try {
      await inside;
      await new Promise(resolve => setTimeout(resolve, 10));
      expect(finished).toBe(false); expect(modelCalls).toBe(0); expect(calls).toBe(0);
      release(); expect(await pending).toBe(primary); expect(modelCalls).toBe(1);
      const pkg = join(workspace, ".pi/extensions/node_modules/@rcarmo/piclaw-addon-drawio-editor/index.ts");
      const addon = await import(pkg);
      expect((await addon.handleRoute(new Request("http://fixture/drawio/index.html"), "/drawio/index.html")).status).toBe(503);
    } finally { release(); await pending; gate.mockRestore(); }
    backend = await createDefaultApplicationRuntime(owner, async () => { modelCalls++; return services; });
    expect(modelCalls).toBe(2);
  } else backend = await createDefaultApplicationRuntime(owner, async () => services);
  const nativeEvents: any[] = [];
  if (scenario === "native-events") backend.attachChannel!({ broadcastEvent(type, data) { if (type === "new_post") nativeEvents.push(data); } });
  expect(!!backend.sessionOptions.getDurableSession?.("web:default")).toBe(true);
  const first = backend.sessionOptions.getDurableSession?.("web:default");
  expect(first).toBeDefined(); expect(calls).toBe(0);
  const base = createRuntimeBaseServices({ dataDir: workspace });
  const pool = new AgentPool({ credentialStore, modelRuntime: runtime, modelRegistry, ...backend.sessionOptions });
  const bound = backend.bind({ queue: base.queue, agentPool: pool });
  const channel = new WebChannel(bound);
  if(recoveryPackage) backend.attachChannel!({broadcastEvent(){}});
  if(scenario==='native-scheduled-lease-free'){
    const {runScheduledTask,getSchedulerMetrics}=await import('../../runtime/src/task-scheduler.js');let reads=0;
    const denied=new Proxy({},{get(){reads++;throw Error('Unsupported task/options inspected');}}),snapshot=()=>['scheduled_tasks','task_run_logs','service_effect_s07_occurrences','service_effect_s01_sources','budget_work','entries','documents'].map(table=>root.query(`SELECT * FROM ${table} ORDER BY rowid`).all()),before=snapshot(),metrics=getSchedulerMetrics();
    try{expect(await runScheduledTask(denied as never,{agentPool:pool,queue:base.queue,sendMessage:async()=>{}},denied)).toEqual({status:'skipped',result:null,error:'Native scheduled execution requires an admitted occurrence',durationMs:0,taskRunLogId:null});expect(reads).toBe(0);expect(calls).toBe(0);expect(snapshot()).toEqual(before);expect(getSchedulerMetrics()).toEqual(metrics);expect(sdkSpies.every(spy=>spy.mock.calls.length===0)).toBe(true);}
    finally{for(const spy of sdkSpies)spy.mockRestore();backend.stop();await backend.close();await base.queue.shutdown();await pool.shutdown();closeDatabase();owner.release();}return;
  }
  if(scenario.startsWith('native-dream-runner')){
    const {runDreamAgentTurn}=await import('../../runtime/src/dream.js'),index=await import('../../runtime/src/workspace-index-process.js');
    const configured=existsSync(getConfigPath())?JSON.parse(readFileSync(getConfigPath(),'utf8')):{};configured.domains??={};configured.domains.dream={...configured.domains.dream,model:''};writeFileSync(getConfigPath(),JSON.stringify(configured),{mode:0o600});
    const originalDreamDispatch=pool.dispatchDreamOperation.bind(pool),dreamDispatch=spyOn(pool,'dispatchDreamOperation');
    if(scenario==='native-dream-runner-original-time')dreamDispatch.mockImplementation(async request=>{await Bun.sleep(25);return originalDreamDispatch(request);});
    const modelControl=spyOn(pool,'applyControlCommand'),launch=spyOn(index,'launchWorkspaceIndexProcess').mockReturnValue(false),wait=spyOn(index,'waitForWorkspaceIndexProcess').mockResolvedValue(undefined);
    const publicRows=()=>['chats','chat_branches','messages','chat_cursors'].map(table=>root.query(`SELECT * FROM ${table} ORDER BY rowid`).all()),before=publicRows();
    let reopenedDream:Awaited<ReturnType<typeof createDefaultApplicationRuntime>>|undefined;
    let dreamClock:{mockRestore():void}|undefined,dreamAuths=0;
    const lockFile=join(workspace,'notes/memory/.dream.lock'),movedLock=lockFile+'.prior-fixture';
    if(scenario==='native-dream-runner-lock-revoked')onCredentialResolve=async()=>{renameSync(lockFile,movedLock);writeFileSync(lockFile,'REPLACEMENT_DREAM_LOCK',{mode:0o600});};
    const {withBudgetWorkContext}=await import('../../runtime/src/budget/context.js');
    const {ensureBudgetWork}=await import('../../runtime/src/db/budget-limits.js');
    if(scenario.startsWith('native-dream-runner-accounted')||scenario==='native-dream-runner-budget-denied'){
      ensureBudgetWork({id:'native-dream-parent',chatJid:'web:default',executionKind:'interactive'},root);saveBudgetCap({scope:'task',workId:'native-dream-parent',metric:'api_usd_micros',amount:scenario.endsWith('-budget-denied')?0:1000000},root);
      onCredentialResolve=async()=>{dreamAuths++;expect(root.query('SELECT state FROM budget_request_reservations ORDER BY rowid DESC LIMIT 1').get()).toEqual({state:'reserved'});};
    }
    if(scenario==='native-dream-runner-deadline')onCredentialResolve=async()=>{
      dreamAuths++;const source=root.query("SELECT source_id FROM piclaw_durable_bindings_v1 WHERE chat_jid LIKE 'dream:%'").get() as {source_id:string};
      const payload=JSON.parse(readFileSync(join(getDataDir(),'durable-answers',createHash('sha256').update(source.source_id).digest('hex')),'utf8'));
      dreamClock=spyOn(Date,'now').mockReturnValue(Date.parse(payload.policy.expiresAt)+1);
    };
    const restartPhase=process.env.PICLAW_NATIVE_RESTART_PHASE,artifactPath=join(workspace,'native-process-restart.json');
    const captureRestart=()=>{
      const bindings=root.query("SELECT * FROM piclaw_durable_bindings_v1 WHERE chat_jid LIKE 'dream:%'").all() as {conversation_id:number;source_id:string;submission_id:number}[];expect(bindings).toHaveLength(1);
      const binding=bindings[0]!,request=dreamDispatch.mock.calls[0]![0],{assertCurrent:_guard,...data}=request;
      const artifact={pid:process.pid,request:data,bindings,sources:root.query("SELECT source_id,source_seq,payload_ref,provenance_ref,state FROM service_effect_s01_sources WHERE chat_jid LIKE 'dream:%'").all(),entries:root.query('SELECT * FROM entries WHERE conversation_id=? ORDER BY id').all(binding.conversation_id),tasks:root.query('SELECT id,kind FROM tasks WHERE conversation_id=? ORDER BY id').all(binding.conversation_id),publicRows:publicRows(),reservations:root.query('SELECT * FROM budget_request_reservations ORDER BY rowid').all(),budgetWork:root.query('SELECT * FROM budget_work ORDER BY rowid').all(),marker:existsSync(join(workspace,'notes/memory/native-dream-marker.md'))?readFileSync(join(workspace,'notes/memory/native-dream-marker.md'),'utf8'):null};
      writeFileSync(artifactPath,JSON.stringify(artifact),{mode:0o600});console.log('NATIVE_RESTART '+JSON.stringify({phase:'write',pid:process.pid,sourceId:binding.source_id,submissionId:binding.submission_id,providerCalls:calls,unresolvedHolds:(root.query("SELECT count(*) AS n FROM budget_request_reservations WHERE state='unresolved'").get() as {n:number}).n}));
    };
    if(scenario.startsWith('native-dream-runner-scheduled-budget')||scenario==='native-dream-runner-scheduled-unknown')onCredentialResolve=async()=>{dreamAuths++;expect(root.query('SELECT state FROM budget_request_reservations ORDER BY rowid DESC LIMIT 1').get()).toEqual({state:'reserved'});};
    const revokeScheduled=()=>root.query("UPDATE service_effect_s07_tasks SET status='paused' WHERE task_id='builtin-dream-midnight'").run();
    if(scenario==='native-dream-runner-scheduled-lease-revoked')onCredentialResolve=async()=>{revokeScheduled();};
    if(scenario==='native-dream-runner-scheduled-token-revoked')onCredentialResolve=async()=>{root.query("UPDATE service_effect_s07_occurrences SET lease_token_hash=? WHERE task_id='builtin-dream-midnight'").run('f'.repeat(64));};
    if(scenario==='native-dream-runner-scheduled-tool-revoked')onProviderResponse=()=>{revokeScheduled();};
    if(scenario==='native-dream-runner-scheduled-final-revoked')onProviderResponse=()=>{if(calls===3)revokeScheduled();};
    if(scenario==='native-dream-runner-scheduled-index-revoked'){
      const fs=(await import('node:fs/promises')).default,read=fs.readdir;
      captureSpies.push(spyOn(fs,'readdir').mockImplementation((async(...args:Parameters<typeof read>)=>{const result=await read(...args);if(calls===3&&String(args[0])===join(workspace,'notes'))revokeScheduled();return result;}) as typeof read));
    }
    try{
      if(restartPhase==='read'){
        const artifact=JSON.parse(readFileSync(artifactPath,'utf8')),binding=artifact.bindings[0];expect(artifact.pid).not.toBe(process.pid);
        expect(root.query("SELECT * FROM piclaw_durable_bindings_v1 WHERE chat_jid LIKE 'dream:%'").all()).toEqual(artifact.bindings);
        expect(root.query("SELECT source_id,source_seq,payload_ref,provenance_ref,state FROM service_effect_s01_sources WHERE chat_jid LIKE 'dream:%'").all()).toEqual(artifact.sources);
        expect(root.query('SELECT * FROM entries WHERE conversation_id=? ORDER BY id').all(binding.conversation_id)).toEqual(artifact.entries);
        expect(root.query('SELECT id,kind FROM tasks WHERE conversation_id=? ORDER BY id').all(binding.conversation_id)).toEqual(artifact.tasks);
        expect(root.query('SELECT * FROM budget_request_reservations ORDER BY rowid').all()).toEqual(artifact.reservations);expect(root.query('SELECT * FROM budget_work ORDER BY rowid').all()).toEqual(artifact.budgetWork);
        if(scenario==='native-dream-runner-unsafe-result'){
          const task=JSON.parse((root.query(`SELECT record FROM tasks WHERE conversation_id=? AND kind='"pi.tool"'`).get(binding.conversation_id) as {record:string}).record);
          expect(task.state).toMatchObject({status:'pending',checkpoint:{phase:'execute',replay:'unsafe'}});expect(task.restarts).toBe(1);
        }
        const replay=pool.dispatchDreamOperation({...artifact.request,assertCurrent(){}}).then(result=>{console.log('NATIVE_REPLAY_ACCEPTED '+JSON.stringify({sourceId:binding.source_id,providerCalls:calls,marker:existsSync(join(workspace,'notes/memory/native-dream-marker.md'))}));return result;});
        await expect(replay).rejects.toThrow('Dream invocation already accepted');expect(calls).toBe(0);
        expect(existsSync(join(workspace,'notes/memory/native-dream-marker.md'))?readFileSync(join(workspace,'notes/memory/native-dream-marker.md'),'utf8'):null).toBe(artifact.marker);expect(publicRows()).toEqual(artifact.publicRows);
        expect(sdkSpies.every(spy=>spy.mock.calls.length===0)).toBe(true);console.log('NATIVE_RESTART '+JSON.stringify({phase:'read',pid:process.pid,sourceId:binding.source_id,submissionId:binding.submission_id,providerCalls:calls,unresolvedHolds:(root.query("SELECT count(*) AS n FROM budget_request_reservations WHERE state='unresolved'").get() as {n:number}).n}));return;
      }
      if(scenario==='native-dream-runner-unsafe-result')root.exec(`CREATE TRIGGER native_dream_result_fault BEFORE INSERT ON entries WHEN json_extract(NEW.record,'$.kind')='pi.tool-result' BEGIN SELECT RAISE(ABORT,'synthetic Dream result commit failure'); END`);
      const invoke=async()=>{
        if(scenario.startsWith('native-dream-runner-scheduled')){
          const {DREAM_TASK_ID}=await import('../../runtime/src/dream.js'),due=new Date(Date.now()-1000).toISOString();
          createTask({id:DREAM_TASK_ID,chat_jid:'web:default',task_kind:'internal',model:modelB.provider+'/'+modelB.id,prompt:'dream',schedule_type:'once',schedule_value:due,next_run:due,status:'active',notify_on_complete:false,created_at:due});
          const store=createCurrentPiclawScheduledRunStore(root,{hitFault:()=>false,recordTrace(){}});assert(store.ok);
          if(scenario.startsWith('native-dream-runner-scheduled-budget')||scenario==='native-dream-runner-scheduled-unknown')saveBudgetCap({scope:'scheduled_run',scheduledTaskId:DREAM_TASK_ID,metric:'api_usd_micros',amount:scenario.endsWith('-denied')?0:1000000},root);
          if(scenario==='native-dream-runner-scheduled-reclaim')root.exec("CREATE TRIGGER scheduled_dream_completion_fault BEFORE UPDATE ON service_effect_s07_occurrences WHEN NEW.state='completed' BEGIN SELECT RAISE(ABORT,'synthetic lost scheduled Dream completion'); END");
          const idle=Promise.withResolvers<void>(),off=base.queue.onLaneIdle(lane=>{if(lane==='chat:web:default')idle.resolve();});
          const timer=setTimeout(()=>idle.reject(Error('Scheduled Dream did not join its queue lane')),5000);
          try{await pollScheduledRunsOnce({queue:base.queue,agentPool:pool,sendMessage:async()=>{}},store.value);await idle.promise;}finally{clearTimeout(timer);off();}
          if(scenario.endsWith('-revoked'))return{mode:'auto' as const,skipped:false,result:'scheduled authority revoked'};
          if(scenario==='native-dream-runner-scheduled-reclaim'){
            root.exec('DROP TRIGGER scheduled_dream_completion_fault');const beforeReplay=['service_effect_s07_occurrences','piclaw_durable_bindings_v1','service_effect_s01_sources','budget_work'].map(table=>root.query(`SELECT * FROM ${table} ORDER BY rowid`).all()),beforeCalls=calls;
            const RealDate=Date,FutureDate=new Proxy(RealDate,{construct(target,args,newTarget){return Reflect.construct(target,args.length?args:[RealDate.now()+120000],newTarget);},get(target,key,receiver){return key==='now'?()=>RealDate.now()+120000:Reflect.get(target,key,receiver);}});globalThis.Date=FutureDate;
            try{await pollScheduledRunsOnce({queue:base.queue,agentPool:pool,sendMessage:async()=>{}},store.value);await Bun.sleep(25);}finally{globalThis.Date=RealDate;}
            expect(calls).toBe(beforeCalls);expect(['service_effect_s07_occurrences','piclaw_durable_bindings_v1','service_effect_s01_sources','budget_work'].map(table=>root.query(`SELECT * FROM ${table} ORDER BY rowid`).all())).toEqual(beforeReplay);
            expect(root.query('SELECT count(*) AS n FROM task_run_logs WHERE task_id=?').get(DREAM_TASK_ID)).toEqual({n:0});return{mode:'auto' as const,skipped:false,result:'factory synthetic reply'};
          }
          const run=root.query('SELECT status,result FROM task_run_logs WHERE task_id=?').get(DREAM_TASK_ID) as {status:string;result:string};expect(run?.status).toBe('success');return{mode:'auto' as const,skipped:false,result:run.result};
        }
        return runDreamAgentTurn({chatJid:'web:default',days:2,mode:'manual',model:scenario.endsWith('-model')?modelB.provider+'/'+modelB.id:null,agentPool:pool});
      };
      const pending=(scenario.startsWith('native-dream-runner-accounted')||scenario==='native-dream-runner-budget-denied')?withBudgetWorkContext({workId:'native-dream-parent',chatJid:'web:default',kind:'interactive'},invoke):invoke();
      if(scenario==='native-dream-runner-unsafe-result'){
        expect(await pending.then(()=>null,error=>error)).toBeInstanceOf(Error);root.exec('DROP TRIGGER native_dream_result_fault');
        expect(calls).toBe(1);expect(readFileSync(join(workspace,'notes/memory/native-dream-marker.md'),'utf8')).toBe('ADMITTED_NATIVE_DREAM');expect(existsSync(lockFile)).toBe(false);
        backend.stop();await backend.close();if(restartPhase==='write'){captureRestart();return;}
        reopenedDream=await createDefaultApplicationRuntime(owner,async()=>services);await expect(reopenedDream.sessionOptions.dispatchDreamOperation!({...dreamDispatch.mock.calls[0]![0],assertCurrent(){}})).rejects.toThrow('Dream invocation already accepted');expect(calls).toBe(1);return;
      }
      if(scenario==='native-dream-runner-lock-revoked'){
        expect(await pending.then(()=>null,error=>error)).toBeInstanceOf(Error);expect(calls).toBe(0);expect(readFileSync(lockFile,'utf8')).toBe('REPLACEMENT_DREAM_LOCK');
        expect(existsSync(join(workspace,'notes/memory/native-dream-marker.md'))).toBe(false);expect(existsSync(join(workspace,'notes/memory/current-state.md'))).toBe(false);expect(publicRows()).toEqual(before);expect('runAgent' in pool).toBe(false);return;
      }
      if(scenario.includes('-held-')){
        let ended=false;const observed=pending.then(()=>{ended=true;return null;},error=>{ended=true;return error;});
        await dreamWorkEntered.promise;expect(existsSync(join(workspace,'notes/memory/.dream.lock'))).toBe(true);
        const closing=backend.close();await Bun.sleep(50);
        expect(ended).toBe(false);expect(existsSync(join(workspace,'notes/memory/.dream.lock'))).toBe(true);expect(existsSync(join(workspace,'notes/memory/current-state.md'))).toBe(false);
        if(dreamWorkSignal)expect(dreamWorkSignal.aborted).toBe(true);
        dreamWorkReleased.resolve();await closing;expect(await observed).toBeInstanceOf(Error);
        expect(existsSync(join(workspace,'notes/memory/.dream.lock'))).toBe(false);expect(existsSync(join(workspace,'notes/memory/native-dream-marker.md'))).toBe(false);expect(publicRows()).toEqual(before);
        expect('runAgent' in pool).toBe(false);expect(modelControl.mock.calls).toHaveLength(0);
        if(restartPhase==='write'){captureRestart();return;}
        const sourceRows=root.query("SELECT * FROM piclaw_durable_bindings_v1 WHERE chat_jid LIKE 'dream:%'").all(),callsBefore=calls;
        reopenedDream=await createDefaultApplicationRuntime(owner,async()=>services);
        await expect(reopenedDream.sessionOptions.dispatchDreamOperation!({...dreamDispatch.mock.calls[0]![0],assertCurrent(){}})).rejects.toThrow('Dream invocation already accepted');
        expect(calls).toBe(callsBefore);expect(root.query("SELECT * FROM piclaw_durable_bindings_v1 WHERE chat_jid LIKE 'dream:%'").all()).toEqual(sourceRows);return;
      }
      const result=await pending;
      if(scenario==='native-dream-runner-scheduled-budget-denied'||scenario==='native-dream-runner-scheduled-unknown'){
        const unknown=scenario.endsWith('-unknown');expect(result.result).toContain('model pass failed; deterministic refresh completed');expect(calls).toBe(unknown?1:0);expect(dreamAuths).toBe(unknown?1:0);expect(existsSync(lockFile)).toBe(false);expect(existsSync(join(workspace,'notes/memory/native-dream-marker.md'))).toBe(false);expect(existsSync(join(workspace,'notes/memory/current-state.md'))).toBe(true);
        expect(root.query('SELECT state,amount_microusd FROM budget_request_reservations').all()).toEqual(unknown?[{state:'unresolved',amount_microusd:201000}]:[]);expect(root.query('SELECT count(*) AS n FROM token_usage').get()).toEqual({n:0});
        const occurrence=root.query("SELECT run_id,state FROM service_effect_s07_occurrences WHERE task_id='builtin-dream-midnight'").get() as {run_id:string;state:string};expect(occurrence.state).toBe('completed');expect(root.query('SELECT status FROM budget_work WHERE id=?').get('scheduled:'+occurrence.run_id)).toEqual({status:unknown?'active':'completed'});expect(modelControl.mock.calls).toHaveLength(0);return;
      }
      if(scenario.startsWith('native-dream-runner-scheduled')&&scenario.endsWith('-revoked')){
        const committedBeforeRevocation=scenario.includes('-final-')||scenario.includes('-index-');
        expect(calls).toBe(committedBeforeRevocation?3:scenario.includes('-tool-')?1:0);expect(modelControl.mock.calls).toHaveLength(0);expect('runAgent' in pool).toBe(false);expect(existsSync(lockFile)).toBe(false);expect(existsSync(join(workspace,'notes/memory/native-dream-marker.md'))).toBe(committedBeforeRevocation);expect(existsSync(join(workspace,'notes/memory/current-state.md'))).toBe(scenario.includes('-index-'));expect(publicRows()).toEqual(before);
        if(scenario.includes('-index-'))expect(root.query("SELECT path FROM workspace_files WHERE path='notes/memory/native-dream-marker.md'").all()).toEqual([]);
        expect(root.query("SELECT state FROM service_effect_s07_occurrences WHERE task_id='builtin-dream-midnight'").get()).toEqual({state:'claimed'});return;
      }
      if(scenario==='native-dream-runner-accounted-unknown'){
        expect(result.result).toContain('model pass failed; deterministic refresh completed');expect(calls).toBe(1);expect(dreamAuths).toBe(1);expect(existsSync(lockFile)).toBe(false);expect(existsSync(join(workspace,'notes/memory/native-dream-marker.md'))).toBe(false);
        expect(root.query('SELECT state,amount_microusd FROM budget_request_reservations').all()).toEqual([{state:'unresolved',amount_microusd:101000}]);expect(root.query('SELECT count(*) AS n FROM token_usage').get()).toEqual({n:0});
        expect(root.query("SELECT status FROM budget_work WHERE execution_kind='background' AND parent_work_id='native-dream-parent'").all()).toEqual([{status:'active'}]);expect(publicRows()).toEqual(before);return;
      }
      if(scenario==='native-dream-runner-budget-denied'||scenario==='native-dream-runner-deadline'){
        expect(result.result).toContain('model pass failed; deterministic refresh completed');expect(calls).toBe(0);expect(dreamAuths).toBe(scenario.endsWith('-deadline')?1:0);
        expect(existsSync(join(workspace,'notes/memory/current-state.md'))).toBe(true);expect(existsSync(lockFile)).toBe(false);expect(existsSync(join(workspace,'notes/memory/native-dream-marker.md'))).toBe(false);
        expect(root.query('SELECT count(*) AS n FROM token_usage').get()).toEqual({n:0});expect(root.query('SELECT count(*) AS n FROM budget_request_reservations').get()).toEqual({n:0});expect(publicRows()).toEqual(before);expect('runAgent' in pool).toBe(false);return;
      }
      expect('runAgent' in pool).toBe(false);expect(modelControl.mock.calls).toHaveLength(0);expect(result.skipped).toBe(false);expect(result.result).toContain('factory synthetic reply');
      expect(calls).toBe(scenario==='native-dream-runner-tools'?5:3);expect(requested).toEqual(Array(calls).fill(scenario.endsWith('-model')||scenario.startsWith('native-dream-runner-scheduled')?modelB.id:model.id));
      expect(requestToolNames[0]!.slice().sort()).toEqual(['read','edit','write','grep','find','ls','messages','search_workspace'].sort());
      expect(readFileSync(join(workspace,'notes/memory/native-dream-marker.md'),'utf8')).toBe('ADMITTED_NATIVE_DREAM');
      expect(publicRows()).toEqual(before);expect(existsSync(join(workspace,'notes/memory/.dream.lock'))).toBe(false);expect(sdkSpies.every(spy=>spy.mock.calls.length===0)).toBe(true);
      if(scenario==='native-dream-runner-tools'){expect([...observedResults.values()].map(result=>result.toolName)).toContain('messages');expect([...observedResults.values()].map(result=>result.toolName)).toContain('search_workspace');expect([...observedResults.values()].every(result=>!result.isError)).toBe(true);}
      if(scenario==='native-dream-runner-accounted'){
        expect(root.query('SELECT state FROM budget_request_reservations ORDER BY rowid').all()).toEqual([{state:'settled'},{state:'settled'},{state:'settled'}]);
        expect(root.query("SELECT SUM(api_equivalent_cost_microusd) AS cost FROM token_usage").get()).toEqual({cost:30});
        expect(root.query("SELECT status FROM budget_work WHERE execution_kind='background' AND parent_work_id='native-dream-parent'").all()).toEqual([{status:'completed'}]);
        expect(root.query("SELECT DISTINCT w.execution_kind FROM budget_request_reservations r JOIN budget_work w ON w.id=r.work_id").all()).toEqual([{execution_kind:'background'}]);
      }
      const privateRows=root.query("SELECT conversation_id,source_id FROM piclaw_durable_bindings_v1 WHERE chat_jid LIKE 'dream:%'").all() as {conversation_id:number;source_id:string}[];expect(privateRows).toHaveLength(1);
      const privateHistory=root.query('SELECT * FROM entries WHERE conversation_id=? ORDER BY id').all(privateRows[0]!.conversation_id),callsBefore=calls;
      const payload=JSON.parse(readFileSync(join(getDataDir(),'durable-answers',createHash('sha256').update(privateRows[0]!.source_id).digest('hex')),'utf8')),request=dreamDispatch.mock.calls[0]![0];
      if(scenario.startsWith('native-dream-runner-scheduled')){
        const occurrence=root.query("SELECT run_id FROM service_effect_s07_occurrences WHERE task_id='builtin-dream-midnight'").get() as {run_id:string};expect(payload.policy.parentWorkId).toBe('scheduled:'+occurrence.run_id);
        const hex=createHash('sha256').update('scheduled-dream:'+occurrence.run_id).digest('hex').slice(0,32);expect(request.invocationId).toBe([hex.slice(0,8),hex.slice(8,12),hex.slice(12,16),hex.slice(16,20),hex.slice(20)].join('-'));
        expect(root.query('SELECT status FROM budget_work WHERE id=?').get('scheduled:'+occurrence.run_id)).toEqual({status:scenario.endsWith('-reclaim')?'active':'completed'});
        if(scenario.endsWith('-budget')){expect(dreamAuths).toBe(3);expect(root.query('SELECT state FROM budget_request_reservations ORDER BY rowid').all()).toEqual([{state:'settled'},{state:'settled'},{state:'settled'}]);expect(root.query('SELECT SUM(api_equivalent_cost_microusd) AS cost FROM token_usage').get()).toEqual({cost:30});}
      }
      expect(payload.policy.acceptedAt).toBe(request.acceptedAt);expect(payload.policy.origin.invocationId).toBe(request.invocationId);expect(Date.parse(payload.policy.expiresAt)-Date.parse(payload.policy.acceptedAt)).toBe(request.timeoutMs);
      const {storedBackgroundDocument}=await import('../../runtime/durable-engine/src/host-background-context.js');
      const publicDoc=root.query(`SELECT id FROM documents WHERE owner_id=1 AND kind='"pi.agent"' AND retired_at IS NULL`).get() as {id:number},publicAgent=storedBackgroundDocument(root,publicDoc.id);
      expect(publicAgent.tools).toContain('read');expect(publicAgent.tools).not.toContain('messages');expect(publicAgent.tools).not.toContain('search_workspace');
      backend.stop();await backend.close();if(restartPhase==='write'){captureRestart();return;}reopenedDream=await createDefaultApplicationRuntime(owner,async()=>services);
      expect(calls).toBe(callsBefore);expect(root.query('SELECT * FROM entries WHERE conversation_id=? ORDER BY id').all(privateRows[0]!.conversation_id)).toEqual(privateHistory);expect(publicRows()).toEqual(before);
      await expect(reopenedDream.sessionOptions.dispatchDreamOperation!({...request,assertCurrent(){}})).rejects.toThrow('Dream invocation already accepted');expect(calls).toBe(callsBefore);
      if(scenario==='native-dream-runner-recovery-unit'){
        reopenedDream.stop();await reopenedDream.close();
        await(await import('./background-admission-recovery-fixture.ts')).backgroundAdmissionRecoveryFixture(root,workspace,getDataDir(),getConfigPath(),true,1,1,'084d229bc038a2bdd01301f9f87135911685f88a');
      }
    }finally{if(scenario==='native-dream-runner-scheduled-reclaim')root.exec('DROP TRIGGER IF EXISTS scheduled_dream_completion_fault');if(scenario==='native-dream-runner-unsafe-result')root.exec('DROP TRIGGER IF EXISTS native_dream_result_fault');dreamClock?.mockRestore();dreamWorkReleased.resolve();if(scenario==='native-dream-runner-lock-revoked'){rmSync(lockFile,{force:true});rmSync(movedLock,{force:true});}for(const spy of[modelControl,dreamDispatch,launch,wait,...captureSpies,...sdkSpies])spy.mockRestore();reopenedDream?.stop();await reopenedDream?.close();backend.stop();await backend.close();await base.queue.shutdown();await pool.shutdown();closeDatabase();owner.release();}return;
  }
  if (scenario.startsWith("native-code-review-lifecycle-")) {
    const phase = scenario.slice("native-code-review-lifecycle-".length);
    const objects = () => root.query("SELECT type,name,tbl_name,sql FROM sqlite_master WHERE name GLOB 'addon_code_review_*' ORDER BY name").all();
    const rows = () => (root.query("SELECT name FROM sqlite_master WHERE type='table' AND name GLOB 'addon_code_review_*' ORDER BY name").all() as { name: string }[])
      .map(({ name }) => ({ name, rows: root.query(`SELECT * FROM ${name} ORDER BY rowid`).all() }));
    const snapshot = () => ({ objects: objects(), rows: rows(), hostVersion: root.query("PRAGMA user_version").get() });
    const savedPath = join(workspace, "review-lifecycle-snapshot.json");
    const close = async () => { backend.stop(); await backend.close(); };
    try {
      if (phase === "fresh") {
        expect(rows()).toEqual([]);
        await close();
        const path = (root.query("PRAGMA database_list").all() as { name: string; file: string }[]).find(row => row.name === "main")!.file;
        const models = createHostModels(runtime, [model, modelB].map(({ provider, id }) => ({ provider, id })), {
          signal: new AbortController().signal, async authorize() { owner.assertCurrentOwner(); }, assertCurrent() { owner.assertCurrentOwner(); },
        });
        const h = await Harness.open(await SqliteStorage.open(new BunSqliteDatabase(path, { root, assertOwner: () => owner.assertCurrentOwner(), fenceTransactions: true })),
          { models, registry: createRegistry() }, context);
        try {
          await h.commit(async tx => {
            for (const { id } of root.query("SELECT id FROM conversations").all() as { id: number }[])
              await configure(tx, id as ConversationId, { tools: createHostBuiltinTools({ cwd: workspace, names: ["read"], authority: { assertAllowed() { owner.assertCurrentOwner(); } } }) });
          }, context);
        } finally { await h.close(context); }
      } else if (phase === "present" || phase === "reinstalled") {
        expect(rows()).toHaveLength(16);
        expect(objects().filter((row: any) => row.type === "index")).toHaveLength(6);
        const api = await import(join(workspace, ".pi/extensions/node_modules/@rcarmo/piclaw-addon-code-review/runtime.ts"));
        const service = api.reviewService();
        expect(service.database.db).toBe(root);
        const who = { ownerId: "default", actorId: "default", kind: "operator", workspaceId: "lifecycle" };
        const target = { chatId: "web:default", incarnation: "lifecycle", label: "Default" };
        const input = { title: "Retained review", focusPath: "gone.ts", target };
        const source = { workspaceId: "lifecycle", worktreeId: "tree", mode: "source", base: null, head: null, capturedAt: "2026-01-01T00:00:00Z",
          files: [{ oldPath: null, newPath: "gone.ts", oldText: null, newText: "saved without a working file\n", change: "source" }] };
        const request = { requestId: "lifecycle-create" };
        const review = service.createFromCapture(who, input, source, request);
        if (phase === "present") {
          service.createThread(who, review.reviewId, { fileId: review.files[0], side: "source", body: "retained discussion" }, { requestId: "lifecycle-thread" });
          writeFileSync(savedPath, JSON.stringify(snapshot()));
        } else expect(service.readFile(who, review.reviewId, review.files[0]).newText).toBe("saved without a working file\n");
        const saved = JSON.parse(readFileSync(savedPath, "utf8"));
        await close();
        expect(() => service.listReviews(who)).toThrow("closed");
        expect(snapshot()).toEqual(saved);
      } else expect(snapshot()).toEqual(JSON.parse(readFileSync(savedPath, "utf8")));
      expect(root.query("PRAGMA foreign_key_check").all()).toEqual([]);
      expect(calls).toBe(0);
      expect(sdkSpies.every(spy => spy.mock.calls.length === 0)).toBe(true);
    } finally {
      await close(); await channel.stop(); await base.queue.shutdown(); await pool.shutdown();
      for (const spy of [...captureSpies, ...sdkSpies]) spy.mockRestore();
      owner.release(); closeDatabase();
    }
    return;
  }
  if(scenario==='native-addon-admission'||scenario==='native-addon-admission-rollback'||scenario==='native-addon-admission-overlap'||scenario==='native-addon-admission-rejected'||scenario==='native-addon-admission-alias'||scenario==='native-addon-admission-model-revoked'||scenario==='native-addon-admission-public-model-revoked'||scenario.startsWith('native-addon-execution')||addonServiceCase){
    const operations=await import('../../runtime/src/db/addon-operations.js');
    const configuration=getConfigPath(),saved=existsSync(configuration)?readFileSync(configuration,'utf8'):undefined;
    const configured=saved?JSON.parse(saved):{};configured.domains??={};
    const grant={revision:'native-r1',target:'fixture',allowedTools:scenario==='native-addon-execution-ceiling'?['read']:['read','write'],timeoutMs:scenario==='native-addon-execution-deadline'?200:60_000,maxToolCalls:scenario==='native-addon-execution-quota'?1:2,parentWorkId:'native-addon-parent'};
    configured.domains.operations={enabled:true,grants:[{addonId:'native-fixture',principalId:'operator',...grant,enabled:true,approvalRequired:false}]};
    mkdirSync(join(workspace,'.piclaw'),{recursive:true});writeFileSync(configuration,JSON.stringify(configured),{mode:0o600});
    const {ensureBudgetWork}=await import('../../runtime/src/db/budget-limits.js');ensureBudgetWork({id:grant.parentWorkId,chatJid:'web:default',executionKind:'interactive'});
    const text='Admit a private operation without legacy context',id='native-addon-fixture',at=new Date().toISOString();
    if(!addonServiceCase)operations.admitAddonOperation({id,addonId:'native-fixture',principalId:'operator',idempotencyKey:'native-admission',inputHash:createHash('sha256').update(JSON.stringify([grant.target,text])).digest('hex'),text,target:grant.target,grant,
      chatJid:'operation:'+id,workId:'operation:'+id,status:'queued',sequence:1,createdAt:at,updatedAt:at,output:null,reason:null});
    if(!addonServiceCase)operations.transitionAddonOperation(id,['queued'],'working');
    let fixedClock=scenario==='native-addon-execution-deadline'?Date.parse(operations.readAddonOperation(id)!.updatedAt):undefined;
    const deadlineClock=fixedClock===undefined?undefined:spyOn(Date,'now').mockImplementation(()=>fixedClock!);
    let expireBackgroundDeadline:(()=>void)|undefined;
    const backgroundDeadlineTimer=fixedClock===undefined?undefined:spyOn(globalThis,'setTimeout').mockImplementation(((callback:()=>void,ms?:number,...args:unknown[])=>{
      if(callback.name==='expireNativeBackgroundDeadline'){expect(ms).toBe(grant.timeoutMs);expireBackgroundDeadline=callback;return realTimer(()=>{},60_000);}
      return realTimer(callback,ms,...args);
    }) as typeof setTimeout);
    let reopened:Awaited<ReturnType<typeof createDefaultApplicationRuntime>>|undefined,reopenedBase:ReturnType<typeof createRuntimeBaseServices>|undefined,reopenedPool:AgentPool|undefined;
    try{
      const publicRows=()=>['chats','chat_branches','messages','chat_cursors'].map(table=>root.query(`SELECT * FROM ${table} ORDER BY rowid`).all());
      const before=publicRows(),ordinary=(await pool.getDurableSessionMetadata('web:default'));
      if(serviceBudgetResume||serviceContinuation){
        const {AddonOperationService}=await import('../../runtime/src/addons/operation-service.js'),{createOperationHost}=await import('../../runtime/src/addons/operation-host.js');
        const contextModule=await import('../../runtime/durable-engine/src/host-background-context.js');
        const principal={addonId:'native-fixture',principalId:'operator'};
        let cap=serviceBudgetResume?saveBudgetCap({scope:'task',workId:grant.parentWorkId,metric:'api_usd_micros',amount:101000},root):undefined;
        let writes=0;const actualWrite=hostFs.writeFileSync;
        captureSpies.push(spyOn(hostFs,'writeFileSync').mockImplementation(((path:unknown,...args:unknown[])=>{if(String(path)===join(workspace,'native-addon-result.txt'))writes++;return(actualWrite as Function)(path,...args);}) as typeof hostFs.writeFileSync));
        if(serviceBudgetResume||serviceBudgetGap||addonCompaction)onCredentialResolve=async()=>{
          if(addonCompaction){
            expect((root.query("SELECT count(*) AS n FROM budget_request_reservations WHERE state='reserved'").get() as {n:number}).n).toBeGreaterThan(0);
            if(privateCompactionSignal&&taskModelRequestScope(privateCompactionSignal)?.taskKind==='pi.compaction'){
              if(scenario.endsWith('-auth-revoked')){configured.domains.operations.enabled=false;writeFileSync(configuration,JSON.stringify(configured));privateCompactionAuthChanged=true;}
              if(scenario.endsWith('-auth-budget')){assert(cap);saveBudgetCap({id:cap.id,scope:'task',workId:grant.parentWorkId,metric:'api_usd_micros',amount:0},root);privateCompactionAuthChanged=true;}
            }
          }else expect(root.query('SELECT state FROM budget_request_reservations ORDER BY rowid DESC LIMIT 1').get()).toEqual({state:'reserved'});
        };
        const nativeHost=createOperationHost(pool);
        const firstHost=serviceContinuation?{...nativeHost,async execute(input:Parameters<typeof nativeHost.execute>[0]){const result=await nativeHost.execute(input);expect(result.status).toBe('completed');return{status:'input_required' as const,output:result.output,reason:'continuation_required'};}}:nativeHost;
        const firstService=new AddonOperationService(firstHost),firstClient=firstService.bind(principal);
        let nextService:InstanceType<typeof AddonOperationService>|undefined,damagedEntry:{id:number;record:string}|undefined;
        let stagedFailure:unknown,publicationFailed!:()=>void,continueAfterReopen!:()=>void;
        const publicationReady=new Promise<void>(resolve=>{publicationFailed=resolve;}),reopenReady=new Promise<void>(resolve=>{continueAfterReopen=resolve;});
        try{
          const receipt=await firstClient.admit({target:'fixture',idempotencyKey:'native-lifecycle',text});await firstService.waitForIdle();
          expect(receipt.created).toBe(true);const operationId=receipt.operation!.id;
          expect((await firstClient.get(operationId)).status).toBe(serviceBudgetResume?'budget_blocked':'input_required');expect(writes).toBe(1);
          expect(calls).toBe(serviceBudgetResume?1:2);
          const oldBindings=root.query('SELECT source_id,conversation_id,source_seq,operation_id FROM piclaw_durable_bindings_v1 WHERE chat_jid=?').all('operation:'+operationId) as {source_id:string;conversation_id:number;source_seq:number;operation_id:string}[];
          expect(oldBindings).toHaveLength(1);const original=oldBindings[0]!;
          const originalDocId=(root.query('SELECT id FROM documents WHERE kind=\'"app.background-policy"\' AND owner_id=? AND key_value=?').get(original.conversation_id,JSON.stringify(original.source_id)) as {id:number}).id;
          const oldPolicy=contextModule.storedBackgroundDocument(root,originalDocId),oldPayloadPath=join(getDataDir(),'durable-answers',createHash('sha256').update(original.source_id).digest('hex')),oldPayload=readFileSync(oldPayloadPath);
          const conversations=root.query('SELECT id FROM conversations ORDER BY id').all(),oldEntries=root.query('SELECT * FROM entries ORDER BY id').all() as {id:number}[];
          firstService.shutdown();await firstService.waitForIdle();backend.stop();await backend.close();
          if(scenario==='native-addon-service-continuation-interrupted'){
            damagedEntry=root.query('SELECT id,record FROM entries WHERE conversation_id=? AND json_extract(record,\'$.kind\')=\'pi.tool-result\' ORDER BY id LIMIT 1').get(original.conversation_id) as {id:number;record:string};
            const changed=JSON.parse(damagedEntry.record);changed.data.diagnostics=[{severity:'error',code:'interrupted',message:'Synthetic unknown prior write outcome'}];changed.model[0].isError=true;
            root.query('UPDATE entries SET record=? WHERE id=?').run(JSON.stringify(changed),damagedEntry.id);
          }
          settings.setDefaultModelAndProvider(modelB.provider,modelB.id);await settings.flush();
          if(cap)cap=saveBudgetCap({id:cap.id,scope:'task',workId:grant.parentWorkId,metric:'api_usd_micros',amount:1000000},root);
          if(addonCompaction){
            cap=saveBudgetCap({scope:'task',workId:grant.parentWorkId,metric:'api_usd_micros',amount:1000000},root);
            const open=Harness.open,background=scenario.includes('-compaction-background');captureSpies.push(spyOn(Harness,'open').mockImplementation((storage,options,ctx)=>open.call(Harness,storage,{...options,settings:{...options.settings,compaction:{enabled:true,keepRecentTokens:1,reserveTokens:background?1000:99999,backgroundTokens:background?99000:0}}},ctx)));
          }
          reopened=await createDefaultApplicationRuntime(owner,async()=>services);reopenedBase=createRuntimeBaseServices({dataDir:workspace});
          reopenedPool=new AgentPool({credentialStore,modelRuntime:runtime,modelRegistry,...reopened.sessionOptions});reopened.bind({queue:reopenedBase.queue,agentPool:reopenedPool});
          if(serviceBudgetGap)cap=saveBudgetCap({scope:'task',workId:grant.parentWorkId,metric:'api_usd_micros',amount:1000000},root);
          const nextHost=createOperationHost(reopenedPool);let blockNext=serviceBudgetGap;
          const stagedHost={...nextHost,async execute(input:Parameters<typeof nextHost.execute>[0]){
            try{await reopenedPool!.prepareAddonOperation(input.operationId,input.signal);throw Error('Expected staged publication fault');}
            catch(error){stagedFailure=error;publicationFailed();expect(String(error)).toContain('synthetic next-input binding fault');}
            await awaitWithContext(reopenReady,withAbortSignal(input.signal,context));return createOperationHost(reopenedPool!).execute(input);
          }};
          nextService=new AddonOperationService(scenario==='native-addon-service-continuation-staged'?stagedHost:serviceBudgetGap?{...nextHost,async execute(input){if(blockNext){blockNext=false;assert(cap);saveBudgetCap({id:cap.id,scope:'task',workId:grant.parentWorkId,metric:'api_usd_micros',amount:0},root);}return nextHost.execute(input);}}:nextHost);
          if(scenario==='native-addon-service-continuation-staged')root.exec("CREATE TEMP TRIGGER fail_next_background_binding BEFORE INSERT ON piclaw_durable_bindings_v1 WHEN NEW.source_id LIKE 'background:%' AND NEW.source_seq>1 BEGIN SELECT RAISE(ABORT,'synthetic next-input binding fault'); END");
          const client=nextService.bind(principal),newText='Continue with only this newly accepted input';
          if(serviceContinuation)toolSequence=[{name:'write',arguments:{path:join(workspace,'native-addon-continuation.txt'),content:'NEW_INPUT_ONLY'}}];
          const attempts=await Promise.all(serviceBudgetResume?[client.resume(operationId),client.resume(operationId)]:serviceBudgetGap?[client.continue(operationId,newText)]:[client.continue(operationId,newText),client.continue(operationId,newText)]);
          expect(attempts.filter(result=>result.resumed)).toHaveLength(1);
          if(scenario==='native-addon-service-continuation-staged'){
            await publicationReady;const stagedSnapshot=()=>['service_effect_s01_sources','service_effect_s01_operations','piclaw_durable_bindings_v1','budget_work','documents','document_revisions'].map(table=>root.query(`SELECT * FROM ${table} ORDER BY rowid`).all());
            const staged=stagedSnapshot();expect(calls).toBe(2);expect(root.query('SELECT count(*) AS n FROM piclaw_durable_bindings_v1 WHERE chat_jid=?').get('operation:'+operationId)).toEqual({n:1});
            expect(root.query('SELECT count(*) AS n FROM documents WHERE owner_id=? AND kind=\'"app.background-policy"\'').get(original.conversation_id)).toEqual({n:2});
            await expect(reopenedPool.prepareAddonOperation(operationId)).rejects.toBe(stagedFailure);expect(stagedSnapshot()).toEqual(staged);
            root.exec('DROP TRIGGER fail_next_background_binding');reopened.stop();await reopened.close();await reopenedBase.queue.shutdown();await reopenedPool.shutdown();
            reopened=await createDefaultApplicationRuntime(owner,async()=>services);reopenedBase=createRuntimeBaseServices({dataDir:workspace});reopenedPool=new AgentPool({credentialStore,modelRuntime:runtime,modelRegistry,...reopened.sessionOptions});reopened.bind({queue:reopenedBase.queue,agentPool:reopenedPool});
            continueAfterReopen();
          }
          if(heldPrivateSummary){
            await privateSummaryEntered.promise;await privateMainSettled.promise;
            let idle=false;const joining=nextService.waitForIdle().then(()=>{idle=true;});
            expect(operations.readAddonOperation(operationId)!.status).toBe('working');expect(idle).toBe(false);
            expect(root.query("SELECT phase FROM service_effect_s01_operations WHERE chat_jid=? ORDER BY rowid DESC LIMIT 1").get('operation:'+operationId)).toEqual({phase:'executing'});
            expect((await client.cancel(operationId)).outcome).toBe('requested');
            const abortDeadline=Date.now()+1000;while(!heldSummarySignal?.aborted&&Date.now()<abortDeadline)await Bun.sleep(5);
            expect(heldSummarySignal?.aborted).toBe(true);expect(idle).toBe(false);
            expect(operations.readAddonOperation(operationId)!.status).toBe('cancel_requested');
            privateSummaryReleased.resolve();await joining;
          }else await nextService.waitForIdle();
          if(serviceBudgetGap){
            expect((await client.get(operationId)).status).toBe('budget_blocked');expect(operations.readAddonOperation(operationId)!.text).toBe(newText);expect(calls).toBe(2);
            expect(root.query('SELECT count(*) AS n FROM piclaw_durable_bindings_v1 WHERE chat_jid=?').get('operation:'+operationId)).toEqual({n:1});
            assert(cap);saveBudgetCap({id:cap.id,scope:'task',workId:grant.parentWorkId,metric:'api_usd_micros',amount:1000000},root);
            expect((await client.resume(operationId)).resumed).toBe(true);await nextService.waitForIdle();
          }
          if(addonCompaction&&scenario.includes('-auth-')){
            expect(privateCompactionAuthChanged).toBe(true);expect(operations.readAddonOperation(operationId)!.status).toBe(scenario.endsWith('-auth-budget')?'budget_blocked':'failed');
            expect(calls).toBe(2);expect(writes).toBe(1);expect(existsSync(join(workspace,'native-addon-continuation.txt'))).toBe(false);expect(publicRows()).toEqual(before);
            expect(root.query("SELECT count(*) AS n FROM token_usage WHERE usage_source='compaction'").get()).toEqual({n:0});
            expect(root.query("SELECT state FROM budget_request_reservations ORDER BY rowid").all()).toEqual([{state:'settled'},{state:'settled'},{state:'released'}]);
            expect(root.query('SELECT id FROM conversations ORDER BY id').all()).toEqual(conversations);expect(contextModule.storedBackgroundDocument(root,originalDocId)).toEqual(oldPolicy);return;
          }
          const final=await client.get(operationId);
          if(addonCompaction&&scenario.endsWith('-unknown')){
            expect(final.status).toBe('failed');expect(calls).toBe(3);expect(writes).toBe(1);expect(existsSync(join(workspace,'native-addon-continuation.txt'))).toBe(false);expect(publicRows()).toEqual(before);
            expect(root.query("SELECT state FROM budget_request_reservations ORDER BY rowid").all()).toEqual([{state:'settled'},{state:'settled'},{state:'unresolved'}]);
            const current=root.query('SELECT operation_id FROM piclaw_durable_bindings_v1 WHERE chat_jid=? ORDER BY source_seq DESC LIMIT 1').get('operation:'+operationId) as {operation_id:string};
            expect(root.query("SELECT status FROM budget_work WHERE id=?").get('durable-operation:'+current.operation_id)).toEqual({status:'active'});
            expect(root.query("SELECT w.execution_kind,w.parent_work_id FROM budget_request_reservations r JOIN budget_work w ON w.id=r.work_id WHERE r.state='unresolved'").all()).toEqual([{execution_kind:'background',parent_work_id:'durable-operation:'+current.operation_id}]);
            expect(root.query("SELECT t.usage_source FROM token_usage t JOIN budget_work w ON w.id=t.work_id WHERE w.parent_work_id=?").all('durable-operation:'+current.operation_id)).toEqual([]);
            expect(root.query("SELECT amount_microusd FROM budget_request_reservations WHERE state='unresolved'").get()).toEqual({amount_microusd:101000});
            expect(root.query("SELECT count(*) AS n FROM entries WHERE conversation_id=? AND json_extract(record,'$.kind')='pi.compaction'").get(original.conversation_id)).toEqual({n:0});
            expect(root.query('SELECT id FROM conversations ORDER BY id').all()).toEqual(conversations);expect(contextModule.storedBackgroundDocument(root,originalDocId)).toEqual(oldPolicy);return;
          }
          if(scenario==='native-addon-service-continuation-interrupted'){
            expect(final.status).toBe('failed');expect(calls).toBe(2);expect(writes).toBe(1);
            expect(root.query('SELECT count(*) AS n FROM piclaw_durable_bindings_v1 WHERE chat_jid=?').get('operation:'+operationId)).toEqual({n:1});
            expect(root.query('SELECT id FROM conversations ORDER BY id').all()).toEqual(conversations);expect(contextModule.storedBackgroundDocument(root,originalDocId)).toEqual(oldPolicy);return;
          }
          expect(final.status).toBe('completed');expect(final.output).toBe('factory synthetic reply');expect(writes).toBe(1);
          const bindings=root.query('SELECT source_id,conversation_id,source_seq,operation_id FROM piclaw_durable_bindings_v1 WHERE chat_jid=? ORDER BY source_seq').all('operation:'+operationId) as typeof oldBindings;
          expect(bindings).toHaveLength(2);expect(bindings[0]).toEqual(original);expect(bindings[1]!.conversation_id).toBe(original.conversation_id);expect(bindings[1]!.source_id).not.toBe(original.source_id);
          expect(root.query('SELECT id FROM conversations ORDER BY id').all()).toEqual(conversations);expect(contextModule.storedBackgroundDocument(root,originalDocId)).toEqual(oldPolicy);expect(readFileSync(oldPayloadPath)).toEqual(oldPayload);
          expect(root.query('SELECT * FROM entries WHERE id<=? ORDER BY id').all(oldEntries.at(-1)!.id)).toEqual(oldEntries);
          const sources=root.query('SELECT state FROM service_effect_s01_sources WHERE chat_jid=? ORDER BY source_seq').all('operation:'+operationId);expect(sources).toEqual([{state:'consumed'},{state:'consumed'}]);
          const newPayload=JSON.parse(readFileSync(join(getDataDir(),'durable-answers',createHash('sha256').update(bindings[1]!.source_id).digest('hex')),'utf8'));
          expect(newPayload.prompt).toBe(serviceBudgetResume?'Continue the current operation from the input already in this session. Do not repeat completed actions.':newText);
          expect(newPayload.policy.model.modelId).toBe(model.id);expect(requested.every(id=>id===model.id)).toBe(true);expect(writes).toBe(1);
          if(addonCompaction){
            const summaries=(root.query("SELECT count(*) AS n FROM entries WHERE conversation_id=? AND json_extract(record,'$.kind')='pi.compaction'").get(original.conversation_id) as {n:number}).n;
            if(heldPrivateSummary){expect(summaries).toBe(0);expect(heldSummarySignal?.aborted).toBe(true);}
            else{expect(summaries).toBeGreaterThan(0);expect(planRequests.at(-1)).toContain('PRIVATE_NATIVE_COMPACTION_SUMMARY');}
            expect((root.query("SELECT count(*) AS n FROM token_usage WHERE usage_source='compaction'").get() as {n:number}).n).toBeGreaterThan(0);
            expect(root.query("SELECT DISTINCT w.execution_kind,w.parent_work_id FROM budget_request_reservations r JOIN budget_work w ON w.id=r.work_id WHERE r.state<>'settled'").all()).toEqual([]);
            expect(root.query("SELECT DISTINCT w.execution_kind,w.parent_work_id FROM token_usage t JOIN budget_work w ON w.id=t.work_id WHERE t.usage_source='compaction'").all()).toEqual([{execution_kind:'background',parent_work_id:'durable-operation:'+bindings[1]!.operation_id}]);
            expect(root.query("SELECT count(*) AS n FROM tasks WHERE conversation_id=? AND kind='\"pi.compaction\"' AND status<>'terminal'").get(original.conversation_id)).toEqual({n:0});
            expect(root.query("SELECT count(*) AS n FROM budget_work WHERE execution_kind='side_prompt'").get()).toEqual({n:0});
            expect(root.query('SELECT count(*) AS n FROM budget_request_reservations').get()).toEqual({n:calls});
          }else{expect(planRequests.at(-1)!.split(text)).toHaveLength(2);expect(planRequests.at(-1)!.split(newPayload.prompt)).toHaveLength(2);}
          if(!addonCompaction)expect(calls).toBe(serviceBudgetResume?3:4);expect(publicRows()).toEqual(before);expect(root.query("SELECT count(*) AS n FROM submissions WHERE conversation_id=? AND json_extract(record,'$.type')='input'").get(original.conversation_id)).toEqual({n:2});
          expect(sdkSpies.every(spy=>spy.mock.calls.length===0)).toBe(true);
          nextService.shutdown();await nextService.waitForIdle();reopened.stop();await reopened.close();
          await (await import('./background-admission-recovery-fixture.ts')).backgroundAdmissionRecoveryFixture(root,workspace,getDataDir(),configuration,true,2,serviceBudgetResume?1:2);
        }finally{
          privateSummaryReleased.resolve();
          firstService.shutdown();await firstService.waitForIdle();nextService?.shutdown();await nextService?.waitForIdle();
          if(scenario==='native-addon-service-continuation-staged')root.exec('DROP TRIGGER IF EXISTS fail_next_background_binding');
          if(damagedEntry){reopened?.stop();await reopened?.close();root.query('UPDATE entries SET record=? WHERE id=?').run(damagedEntry.record,damagedEntry.id);}
        }return;
      }
      if(scenario==='native-addon-service-execution'){
        const {AddonOperationService}=await import('../../runtime/src/addons/operation-service.js'),{createOperationHost}=await import('../../runtime/src/addons/operation-host.js');
        const service=new AddonOperationService(createOperationHost(pool)),client=service.bind({addonId:'native-fixture',principalId:'operator'});
        try{
          const request={target:'fixture',idempotencyKey:'actual-native-service',text};
          const receipt=await client.admit(request);expect(receipt.created).toBe(true);await service.waitForIdle();
          const snapshot=await client.get(receipt.operation!.id);expect(snapshot.status).toBe('completed');expect(snapshot.output).toBe('factory synthetic reply');
          expect(calls).toBe(3);expect(readFileSync(join(workspace,'native-addon-result.txt'),'utf8')).toBe('ADMITTED_NATIVE_ADDON');expect(publicRows()).toEqual(before);
          const bindings=root.query('SELECT operation_id,conversation_id FROM piclaw_durable_bindings_v1 WHERE chat_jid=?').all('operation:'+snapshot.id) as {operation_id:string;conversation_id:number}[];
          expect(bindings).toHaveLength(1);expect(root.query('SELECT phase,terminal_disposition FROM service_effect_s01_operations WHERE operation_id=?').get(bindings[0]!.operation_id)).toEqual({phase:'terminal',terminal_disposition:'completed'});
          const again=await client.admit(request);expect(again.created).toBe(false);expect(again.operation).toEqual(snapshot);await service.waitForIdle();expect(calls).toBe(3);
          expect(root.query('SELECT count(*) AS n FROM submissions WHERE conversation_id=?').get(bindings[0]!.conversation_id)).toEqual({n:1});
          expect(sdkSpies.every(spy=>spy.mock.calls.length===0)).toBe(true);
        }finally{service.shutdown();await service.waitForIdle();}return;
      }
      if(scenario==='native-addon-admission-rejected'){
        const snapshot=()=>['conversations','documents','document_revisions','service_effect_s01_sources','service_effect_s01_operations','piclaw_durable_bindings_v1','budget_work'].map(table=>root.query(`SELECT * FROM ${table} ORDER BY rowid`).all());
        configured.domains.operations.enabled=false;writeFileSync(configuration,JSON.stringify(configured));const owned=snapshot();
        await expect(pool.prepareAddonOperation(id)).rejects.toThrow('grant changed');expect(snapshot()).toEqual(owned);expect(publicRows()).toEqual(before);expect(calls).toBe(0);expect(sdkSpies.every(spy=>spy.mock.calls.length===0)).toBe(true);return;
      }
      if(scenario==='native-addon-admission-overlap'){
        const chat='operation:'+id;storeChatMetadata(chat,at);await bound.prepareInputSourceAdmission!(chat);
        const snapshot=()=>['chats','chat_branches','conversations','documents','document_revisions','service_effect_s01_sources','service_effect_s01_operations','piclaw_durable_bindings_v1','budget_work'].map(table=>root.query(`SELECT * FROM ${table} ORDER BY rowid`).all());
        const owned=snapshot();await expect(pool.prepareAddonOperation(id)).rejects.toThrow('already bound to a public/imported context');
        expect(snapshot()).toEqual(owned);expect(calls).toBe(0);expect(sdkSpies.every(spy=>spy.mock.calls.length===0)).toBe(true);return;
      }
      if(scenario==='native-addon-admission-rollback'){
        const ownedRows=()=>['service_effect_s01_chats','service_effect_s01_sources','service_effect_s01_operations','service_effect_s01_operation_sources','piclaw_durable_bindings_v1','budget_work'].map(table=>root.query(`SELECT * FROM ${table} ORDER BY rowid`).all());
        const untouched=ownedRows();root.exec("CREATE TEMP TRIGGER fail_background_binding BEFORE INSERT ON piclaw_durable_bindings_v1 WHEN NEW.source_id LIKE 'background:%' BEGIN SELECT RAISE(ABORT,'background binding fault'); END");
        try{await expect(pool.prepareAddonOperation(id)).rejects.toThrow('background binding fault');}
        finally{root.exec('DROP TRIGGER fail_background_binding');}
        expect(ownedRows()).toEqual(untouched);expect(publicRows()).toEqual(before);expect(calls).toBe(0);
        const contexts=root.query('SELECT id FROM conversations').all();
        backend.stop();await backend.close();
        await (await import('./background-admission-recovery-fixture.ts')).backgroundAdmissionRecoveryFixture(root,workspace,getDataDir(),configuration);
        reopened=await createDefaultApplicationRuntime(owner,async()=>services);reopenedBase=createRuntimeBaseServices({dataDir:workspace});
        reopenedPool=new AgentPool({credentialStore,modelRuntime:runtime,modelRegistry,...reopened.sessionOptions});reopened.bind({queue:reopenedBase.queue,agentPool:reopenedPool});
        const recovered=await reopenedPool.prepareAddonOperation(id);expect(recovered.sourceSeq).toBe(1);expect(root.query('SELECT id FROM conversations').all()).toEqual(contexts);
        expect(await reopenedPool.prepareAddonOperation(id)).toEqual(recovered);expect(calls).toBe(0);expect(sdkSpies.every(spy=>spy.mock.calls.length===0)).toBe(true);expect(root.query('PRAGMA foreign_key_check').all()).toEqual([]);
        return;
      }
      const cap=scenario.startsWith('native-addon-execution-accounting-capped')?saveBudgetCap(scenario.endsWith('-daily')?{scope:'instance_daily',timezone:'UTC',metric:'api_usd_micros',amount:1000000}:{scope:'task',workId:grant.parentWorkId,metric:'api_usd_micros',amount:scenario.endsWith('-initial-denied')?0:scenario.endsWith('-cleanup-failed')?1:scenario.endsWith('-small-output')?110000:scenario.endsWith('-denied')&&!scenario.endsWith('-auth-denied')?1:scenario.endsWith('-exact')?101000:1000000},root):undefined;
      if(scenario==='native-addon-execution-accounting-capped-initial-denied'){
        const snapshot=()=>['conversations','documents','document_revisions','service_effect_s01_sources','service_effect_s01_operations','piclaw_durable_bindings_v1','budget_work','budget_request_reservations'].map(table=>root.query(`SELECT * FROM ${table} ORDER BY rowid`).all());
        const owned=snapshot(),host=(await import('../../runtime/src/addons/operation-host.js')).createOperationHost(pool);
        expect(await host.execute({operationId:id,chatJid:'operation:'+id,workId:'operation:'+id,text,principal:{addonId:'native-fixture',principalId:'operator'},grant,signal:new AbortController().signal})).toEqual({status:'budget_blocked',reason:'budget_boundary'});
        expect(snapshot()).toEqual(owned);expect(calls).toBe(0);expect(sdkSpies.every(spy=>spy.mock.calls.length===0)).toBe(true);return;
      }
      if(addonRecovery)onCredentialResolve=async()=>{expect(root.query('SELECT state FROM budget_request_reservations ORDER BY rowid DESC LIMIT 1').get()).toEqual({state:'reserved'});};
      if(scenario==='native-addon-execution-recovery-no-source'){
        const {AddonOperationService}=await import('../../runtime/src/addons/operation-service.js'),{createOperationHost}=await import('../../runtime/src/addons/operation-host.js');
        const snapshot=()=>['conversations','documents','document_revisions','entries','tasks','submissions','piclaw_durable_bindings_v1','service_effect_s01_sources','service_effect_s01_operations'].map(table=>root.query(`SELECT * FROM ${table} ORDER BY rowid`).all()),before=snapshot();
        const service=new AddonOperationService(createOperationHost(pool));try{
          expect(service.recover()).toBe(1);await service.waitForIdle();expect(operations.readAddonOperation(id)).toMatchObject({status:'failed',reason:'interrupted_execution_unknown'});expect(snapshot()).toEqual(before);expect(calls).toBe(0);
        }finally{service.shutdown();await service.waitForIdle();}return;
      }
      const admitted=await pool.prepareAddonOperation(id);
      if(addonRecovery){
        const {AddonOperationService}=await import('../../runtime/src/addons/operation-service.js'),{createOperationHost}=await import('../../runtime/src/addons/operation-host.js');
        const controller=new AbortController();let service:InstanceType<typeof AddonOperationService>|undefined,clock:ReturnType<typeof spyOn>|undefined;
        try{
          if(scenario.endsWith('-recovery-owned')){
            let entered!:()=>void;const ready=new Promise<void>(resolve=>{entered=resolve;});checkpointHold={entered};
            const pending=pool.dispatchAddonOperation(id,controller.signal,1);await ready;
            service=new AddonOperationService(createOperationHost(pool));expect(service.recover()).toBe(1);let joined=false;const idle=service.waitForIdle().then(()=>{joined=true;});
            await Bun.sleep(0);expect(joined).toBe(false);expect(calls).toBe(1);
            controller.abort();expect((await pending).failureCategory).toBe('aborted');await idle;
            expect(operations.readAddonOperation(id)!.status).toBe('cancelled');expect(calls).toBe(1);expect(root.query('SELECT state FROM budget_request_reservations').all()).toEqual([{state:'unresolved'}]);checkpointHold=undefined;return;
          }
          const knownCancelled=scenario.endsWith('-recovery-cancelled'),budgetDenied=scenario.endsWith('-recovery-budget-blocked'),unsafe=scenario.endsWith('-recovery-unsafe'),uncertain=scenario.endsWith('-unknown')||unsafe;
          if(budgetDenied){
            saveBudgetCap({scope:'task',workId:grant.parentWorkId,metric:'api_usd_micros',amount:1},root);
            expect((await pool.dispatchAddonOperation(id,controller.signal,1)).failureCategory).toBe('provider_budget');backend.stop();await backend.close();
          }else if(unsafe){
            root.exec("CREATE TRIGGER fail_recovered_tool_result BEFORE INSERT ON entries WHEN json_extract(NEW.record,'$.kind')='pi.tool-result' BEGIN SELECT RAISE(ABORT,'synthetic unsafe tool result lost acknowledgement'); END");
            try{
              const result=await pool.dispatchAddonOperation(id,controller.signal,1).then(value=>({value}),error=>({error}));
              if('value' in result)expect(result.value.status).toBe('error');else expect(result.error).toBeInstanceOf(Error);
            }finally{root.exec('DROP TRIGGER fail_recovered_tool_result');}
            backend.stop();await backend.close();expect(readFileSync(join(workspace,'native-addon-result.txt'),'utf8')).toBe('ADMITTED_NATIVE_ADDON');
          }else if(uncertain||knownCancelled){
            let entered!:()=>void;const ready=new Promise<void>(resolve=>{entered=resolve;});checkpointHold={entered};
            const pending=pool.dispatchAddonOperation(id,controller.signal,1).then(value=>value,error=>error);await ready;
            if(knownCancelled){operations.transitionAddonOperation(id,['working'],'cancel_requested');controller.abort();expect((await pending).failureCategory).toBe('aborted');}
            backend.stop();await backend.close();await pending;checkpointHold=undefined;
          }else{
            root.exec("CREATE TEMP TRIGGER fail_recovered_terminal BEFORE INSERT ON service_effect_s02_commits WHEN NEW.chat_jid LIKE 'operation:%' BEGIN SELECT RAISE(ABORT,'synthetic lost terminal acknowledgement'); END");
            try{await expect(pool.dispatchAddonOperation(id,controller.signal,1)).rejects.toThrow();}finally{root.exec('DROP TRIGGER fail_recovered_terminal');}
            if(scenario.endsWith('-cancel-requested'))operations.transitionAddonOperation(id,['working'],'cancel_requested');
            backend.stop();await backend.close();
          }
          const missingAck=scenario.endsWith('-recovery-input-ack');
          const originalAck=(root.query('SELECT submission_id FROM piclaw_durable_bindings_v1 WHERE operation_id=?').get(admitted.operationId) as {submission_id:number}).submission_id;
          if(missingAck){expect(originalAck).toBeGreaterThan(0);root.query('UPDATE piclaw_durable_bindings_v1 SET submission_id=NULL WHERE operation_id=?').run(admitted.operationId);}
          const attempts=calls,sdk=()=>['entries','tasks','submissions','documents','document_revisions','piclaw_durable_bindings_v1'].map(table=>root.query(`SELECT * FROM ${table} ORDER BY rowid`).all()),beforeSdk=sdk();
          const holds=root.query('SELECT * FROM budget_request_reservations ORDER BY rowid').all();
          if(!uncertain){
            configured.domains.operations.enabled=false;writeFileSync(configuration,JSON.stringify(configured));
            const payload=JSON.parse(readFileSync(join(getDataDir(),'durable-answers',createHash('sha256').update(admitted.sourceId).digest('hex')),'utf8'));
            clock=spyOn(Date,'now').mockReturnValue(Date.parse(payload.policy.expiresAt)+1);
          }
          reopened=await createDefaultApplicationRuntime(owner,async()=>services);reopenedBase=createRuntimeBaseServices({dataDir:workspace});reopenedPool=new AgentPool({credentialStore,modelRuntime:runtime,modelRegistry,...reopened.sessionOptions});reopened.bind({queue:reopenedBase.queue,agentPool:reopenedPool});
          const restoredSdk=sdk();
          if(unsafe){
            expect(restoredSdk.filter((_,index)=>index!==1)).toEqual(beforeSdk.filter((_,index)=>index!==1));
            expect((restoredSdk[1] as {id:number}[]).map(task=>task.id)).toEqual((beforeSdk[1] as {id:number}[]).map(task=>task.id));
            const task=JSON.parse((root.query('SELECT record FROM tasks WHERE conversation_id=? AND kind=\'"pi.tool"\'').get(admitted.conversationId) as {record:string}).record);
            expect(task.state).toMatchObject({status:'pending',checkpoint:{phase:'execute',replay:'unsafe'}});expect(task.restarts).toBe(1);
          }else expect(restoredSdk).toEqual(beforeSdk);
          service=new AddonOperationService(createOperationHost(reopenedPool));expect(service.recover()).toBe(1);await service.waitForIdle();
          const record=operations.readAddonOperation(id)!;
          expect(record.status).toBe(uncertain?'failed':knownCancelled?'cancelled':budgetDenied?'budget_blocked':'completed');expect(record.reason).toBe(uncertain?'interrupted_execution_unknown':knownCancelled?'executor_cancelled':budgetDenied?'budget_boundary':null);
          expect(record.output).toBe(uncertain||knownCancelled||budgetDenied?null:'factory synthetic reply');
          expect(calls).toBe(attempts);expect(attempts).toBe(budgetDenied?0:uncertain||knownCancelled?1:3);const expectedSdk=restoredSdk.map((rows,index)=>index===5?rows.map(row=>(row as {operation_id:string}).operation_id===admitted.operationId?{...(row as Record<string,unknown>),submission_id:originalAck}:row):rows);
          expect(sdk()).toEqual(missingAck?expectedSdk:restoredSdk);expect(root.query('SELECT * FROM budget_request_reservations ORDER BY rowid').all()).toEqual(holds);
          if(uncertain||knownCancelled){
            expect(root.query('SELECT state FROM budget_request_reservations').all()).toEqual([{state:unsafe?'settled':'unresolved'}]);expect(root.query('SELECT status FROM budget_work WHERE id=?').get('durable-operation:'+admitted.operationId)).toEqual({status:'active'});
          }
          if(unsafe)expect(readFileSync(join(workspace,'native-addon-result.txt'),'utf8')).toBe('ADMITTED_NATIVE_ADDON');
          expect(service.recover()).toBe(0);expect(sdkSpies.every(spy=>spy.mock.calls.length===0)).toBe(true);
        }finally{clock?.mockRestore();controller.abort();service?.shutdown();await service?.waitForIdle();}return;
      }
      if(scenario==='native-addon-execution-live-input'){
        const controller=new AbortController();let entered!:()=>void;const ready=new Promise<void>(resolve=>{entered=resolve;});checkpointHold={entered};
        const running=pool.dispatchAddonOperation(id,controller.signal,1);
        try{
          await ready;operations.transitionAddonOperation(id,['working'],'input_required');operations.appendOperationInput(id,'A newer owner input');operations.transitionAddonOperation(id,['queued'],'working');
          const snapshot=()=>['conversations','documents','document_revisions','service_effect_s01_sources','service_effect_s01_operations','piclaw_durable_bindings_v1','budget_work'].map(table=>root.query(`SELECT * FROM ${table} ORDER BY rowid`).all());
          const held=snapshot();await expect(pool.prepareAddonOperation(id)).rejects.toThrow('Previous background operation is still accepted');expect(snapshot()).toEqual(held);
          await expect(pool.dispatchAddonOperation(id,new AbortController().signal,1)).rejects.toThrow('dispatch input epoch changed');expect(snapshot()).toEqual(held);expect(calls).toBe(1);
        }finally{controller.abort();expect((await running).failureCategory).toBe('aborted');checkpointHold=undefined;}
        expect(operations.readAddonOperation(id)!.text).toBe('A newer owner input');expect(operations.readAddonOperation(id)!.status).toBe('working');expect(calls).toBe(1);
        expect(root.query('SELECT terminal_disposition FROM service_effect_s01_operations WHERE operation_id=?').get(admitted.operationId)).toEqual({terminal_disposition:'cancelled'});return;
      }
      if(scenario.startsWith('native-addon-execution')){
        const payload=JSON.parse(readFileSync(join(getDataDir(),'durable-answers',createHash('sha256').update(admitted.sourceId).digest('hex')),'utf8'));
        expect(payload.policy.acceptedAt).toBe(operations.readAddonOperation(id)!.updatedAt);
        expect(Date.parse(payload.policy.expiresAt)-Date.parse(payload.policy.acceptedAt)).toBe(grant.timeoutMs);
        const host=(await import('../../runtime/src/addons/operation-host.js')).createOperationHost(pool),controller=new AbortController();let authRequests=0;
        const execution={operationId:id,chatJid:'operation:'+id,workId:'operation:'+id,text,principal:{addonId:'native-fixture',principalId:'operator'},grant,signal:controller.signal};
        if(scenario==='native-addon-execution-accounting-capped-missing-account')writeFileSync(join(getPiclawAgentDir(),'auth.json'),'{}');
        if(scenario==='native-addon-execution-accounting-capped-cleanup-failed')root.exec("CREATE TEMP TRIGGER fail_budget_rejection_cleanup BEFORE UPDATE ON budget_work WHEN NEW.last_boundary='request_budget_blocked' BEGIN SELECT RAISE(ABORT,'synthetic budget cleanup fault'); END");
        let toolRace=false,pricingChanged=false;
        if(scenario==='native-addon-execution-accounting-capped-pricing-changed'){
          const physical=runtime.getPhysicalModel.bind(runtime);captureSpies.push(spyOn(runtime,'getPhysicalModel').mockImplementation(((provider:string,id:string)=>{
            const model=physical(provider,id);return pricingChanged&&model?{...model,cost:{...model.cost,input:10,output:10}}:model;
          }) as typeof runtime.getPhysicalModel));
        }
        if(scenario==='native-addon-execution-accounting-capped-tool-race'){
          const mkdir=hostFs.mkdirSync;captureSpies.push(spyOn(hostFs,'mkdirSync').mockImplementation(((path:unknown,...args:unknown[])=>{
            if(String(path)===workspace&&!toolRace){toolRace=true;assert(cap);saveBudgetCap({id:cap.id,scope:'task',workId:grant.parentWorkId,metric:'api_usd_micros',amount:0},root);}
            return (mkdir as Function)(path,...args);
          }) as typeof hostFs.mkdirSync));
        }
        if(scenario==='native-addon-execution-no-account-auth-cap')onCredentialResolve=async()=>{authRequests++;saveBudgetCap({scope:'task',workId:grant.parentWorkId,metric:'api_usd_micros',amount:0},root);};
        if(scenario==='native-addon-execution-revoked')onProviderResponse=()=>{configured.domains.operations.enabled=false;writeFileSync(configuration,JSON.stringify(configured));};
        if(scenario==='native-addon-execution-cancelled')onProviderResponse=()=>{operations.transitionAddonOperation(id,['working'],'cancel_requested');controller.abort();};
        if(scenario==='native-addon-execution-deadline')onCredentialResolve=async()=>{
          fixedClock=Date.parse(payload.policy.expiresAt)+1;expect(expireBackgroundDeadline).toBeDefined();expireBackgroundDeadline!();await Bun.sleep(0);
        };
        if(scenario==='native-addon-execution-auth-revoked')onCredentialResolve=async()=>{configured.domains.operations.enabled=false;writeFileSync(configuration,JSON.stringify(configured));};
        if(scenario.startsWith('native-addon-execution-accounting'))onCredentialResolve=async()=>{
          authRequests++;
          expect(root.query('SELECT state FROM budget_request_reservations ORDER BY rowid DESC LIMIT 1').get()).toEqual({state:'reserved'});
          const row=root.query('SELECT w.execution_kind,w.parent_work_id FROM budget_request_reservations r JOIN budget_work w ON w.id=r.work_id ORDER BY r.rowid DESC LIMIT 1').get();
          expect(row).toEqual({execution_kind:'background',parent_work_id:'durable-operation:'+admitted.operationId});
          if(scenario==='native-addon-execution-accounting-capped-auth-denied'){assert(cap);saveBudgetCap({id:cap.id,scope:'task',workId:grant.parentWorkId,metric:'api_usd_micros',amount:0},root);}
          if(scenario==='native-addon-execution-accounting-capped-pricing-changed')pricingChanged=true;
          if(scenario==='native-addon-execution-accounting-capped-account-changed')writeFileSync(join(getPiclawAgentDir(),'auth.json'),JSON.stringify({'openai-codex':{type:'oauth',access:'synthetic',refresh:'synthetic',accountId:'changed-account',expires:Date.now()+60000}}));
        };
        const finalText=scenario==='native-addon-execution-large-result'?'é'.repeat(70_000):'factory synthetic reply';
        const budgetBlocked=['native-addon-execution-accounting-capped-denied','native-addon-execution-accounting-capped-exact','native-addon-execution-accounting-capped-auth-denied','native-addon-execution-accounting-capped-missing-account','native-addon-execution-accounting-capped-tool-race','native-addon-execution-accounting-capped-pricing-changed','native-addon-execution-accounting-capped-small-output','native-addon-execution-no-account-auth-cap'].includes(scenario);
        const oneCappedRequest=scenario.endsWith('-capped-exact')||scenario.endsWith('-capped-tool-race');
        const accountChanged=scenario==='native-addon-execution-accounting-capped-account-changed';
        const cleanupFailed=scenario==='native-addon-execution-accounting-capped-cleanup-failed';
        const unknown=scenario.startsWith('native-addon-execution-accounting')&&scenario.endsWith('-unknown');
        const output=await host.execute(execution),failed=budgetBlocked||unknown||accountChanged||cleanupFailed||['native-addon-execution-revoked','native-addon-execution-auth-revoked','native-addon-execution-cancelled','native-addon-execution-deadline'].includes(scenario);
        if(scenario==='native-addon-execution-accounting-capped-small-output')expect(root.query('SELECT COALESCE(SUM(api_equivalent_cost_microusd),0) AS amount FROM token_usage').get()).toEqual({amount:0});
        expect(output).toEqual(budgetBlocked?{status:'budget_blocked',reason:'budget_boundary'}:failed?{status:scenario==='native-addon-execution-cancelled'?'cancelled':'failed',reason:scenario==='native-addon-execution-cancelled'?'executor_cancelled':scenario==='native-addon-execution-deadline'?'execution_timeout':'execution_failed'}:{status:'completed',output:finalText});
        const noWrite=failed&&scenario!=='native-addon-execution-accounting-capped-exact'||scenario==='native-addon-execution-ceiling';
        expect(existsSync(join(workspace,'native-addon-result.txt'))).toBe(!noWrite);
        if(!noWrite)expect(readFileSync(join(workspace,'native-addon-result.txt'),'utf8')).toBe('ADMITTED_NATIVE_ADDON');
        expect(calls).toBe(scenario==='native-addon-execution-deadline'||scenario==='native-addon-execution-auth-revoked'||accountChanged||cleanupFailed||budgetBlocked&&!oneCappedRequest?0:failed?1:3);expect(publicRows()).toEqual(before);
        const disposition=scenario==='native-addon-execution-cancelled'||scenario==='native-addon-execution-deadline'?'cancelled':failed?'failed':'completed';
        expect(root.query('SELECT phase,terminal_disposition FROM service_effect_s01_operations WHERE operation_id=?').get(admitted.operationId)).toEqual({phase:'terminal',terminal_disposition:disposition});
        expect(root.query('SELECT disposition,message_row_id,outbox_count,media_count FROM service_effect_s02_commits WHERE operation_id=?').get(admitted.operationId)).toEqual({disposition,message_row_id:null,outbox_count:0,media_count:0});
        expect(root.query('SELECT count(*) AS n FROM submissions WHERE conversation_id=?').get(admitted.conversationId)).toEqual({n:1});
        const policyDoc=(await import('../../runtime/durable-engine/src/host-background-context.js')).storedBackgroundDocument(root,
          (root.query('SELECT id FROM documents WHERE kind=\'"app.background-policy"\' AND owner_id=?').get(admitted.conversationId) as {id:number}).id);
        const quota=oneCappedRequest?1:failed?0:scenario==='native-addon-execution-ceiling'||scenario==='native-addon-execution-quota'?1:2;
        expect(policyDoc.calls).toHaveLength(quota);expect(new Set(policyDoc.calls.map((call:{taskId:number})=>call.taskId)).size).toBe(quota);
        if(cleanupFailed){
          expect(root.query('SELECT count(*) AS n FROM budget_request_reservations').get()).toEqual({n:0});
          expect(root.query("SELECT count(*) AS n FROM budget_work WHERE id LIKE 'durable-request:%' AND status='active'").get()).toEqual({n:1});
          const dir=join(getDataDir(),'diagnostics/model-failures'),files=hostFs.readdirSync(dir);expect(files).toHaveLength(1);
          const evidence=JSON.parse(readFileSync(join(dir,files[0]!), 'utf8'));
          expect(evidence.errors.error.message).toBe('Background budget rejection cleanup is uncertain');expect(evidence.errors.error.cause.code).toBe('budget_denied');
          expect(evidence.errors.error.errors[1].message).toContain('synthetic budget cleanup fault');expect(authRequests).toBe(0);
        }
        if(unknown){
          expect(root.query('SELECT state FROM budget_request_reservations').all()).toEqual([{state:'unresolved'}]);
          expect(root.query('SELECT count(*) AS n FROM token_usage').get()).toEqual({n:0});
          expect(root.query('SELECT status FROM budget_work WHERE id=?').get('durable-operation:'+admitted.operationId)).toEqual({status:'active'});
          if(cap){
            const {AddonOperationService}=await import('../../runtime/src/addons/operation-service.js');
            const service=new AddonOperationService(host),client=service.bind(execution.principal);
            const held=()=>['budget_work','service_effect_s01_sources','conversations'].map(table=>root.query(`SELECT count(*) AS n FROM ${table}`).get());
            const before=held();try{
              expect(await client.admit({target:'fixture',idempotencyKey:'must-not-evade-unknown',text:'A new operation cannot evade this parent hold'})).toEqual({created:false,admission:'budget_blocked',operation:null});
              await service.waitForIdle();expect(held()).toEqual(before);expect(calls).toBe(1);
            }finally{service.shutdown();await service.waitForIdle();}
          }
        }
        if(cap&&budgetBlocked||accountChanged||scenario==='native-addon-execution-no-account-auth-cap'){
          const states=oneCappedRequest?[{state:'settled'}]:scenario.endsWith('-auth-denied')||scenario.endsWith('-pricing-changed')||accountChanged?[{state:'released'}]:[];
          expect(root.query('SELECT state FROM budget_request_reservations ORDER BY rowid').all()).toEqual(states);
          expect(authRequests).toBe(oneCappedRequest||scenario.endsWith('-auth-denied')||scenario.endsWith('-pricing-changed')||accountChanged||scenario==='native-addon-execution-no-account-auth-cap'?1:0);
          if(scenario.endsWith('-tool-race'))expect(toolRace).toBe(true);
          expect(root.query("SELECT count(*) AS n FROM budget_work WHERE id LIKE 'durable-request:%' AND status='active'").get()).toEqual({n:0});
          expect(root.query('SELECT count(*) AS n FROM token_usage').get()).toEqual({n:oneCappedRequest?1:0});
        }
        if(scenario==='native-addon-execution-accounting'||scenario==='native-addon-execution-accounting-capped'||scenario==='native-addon-execution-accounting-capped-daily'){
          expect(root.query('SELECT state FROM budget_request_reservations ORDER BY rowid').all()).toEqual([{state:'settled'},{state:'settled'},{state:'settled'}]);
          expect(root.query('SELECT w.execution_kind,t.api_equivalent_cost_microusd FROM token_usage t JOIN budget_work w ON w.id=t.work_id ORDER BY t.id').all()).toEqual(Array.from({length:3},()=>({execution_kind:'background',api_equivalent_cost_microusd:10})));
          expect(root.query('SELECT execution_kind,parent_work_id FROM budget_work WHERE id=?').get('durable-operation:'+admitted.operationId)).toEqual({execution_kind:'background',parent_work_id:'operation:'+id});
        }
        {
          const snapshot=()=>['entries','tasks','submissions','documents','document_revisions','service_effect_s01_sources','service_effect_s01_operations','service_effect_s02_commits','piclaw_durable_bindings_v1','budget_work','budget_request_reservations','token_usage'].map(table=>root.query(`SELECT * FROM ${table} ORDER BY rowid`).all());
          const settled=snapshot(),attempts=calls;expect(await host.execute(execution)).toEqual(output);expect(calls).toBe(attempts);expect(snapshot()).toEqual(settled);
          backend.stop();await backend.close();
          if(scenario==='native-addon-execution')await (await import('./background-admission-recovery-fixture.ts')).backgroundAdmissionRecoveryFixture(root,workspace,getDataDir(),configuration,true);
          reopened=await createDefaultApplicationRuntime(owner,async()=>services);reopenedBase=createRuntimeBaseServices({dataDir:workspace});
          reopenedPool=new AgentPool({credentialStore,modelRuntime:runtime,modelRegistry,...reopened.sessionOptions});const resumedBindings=reopened.bind({queue:reopenedBase.queue,agentPool:reopenedPool});
          const recoveredHost=(await import('../../runtime/src/addons/operation-host.js')).createOperationHost(reopenedPool);
          expect(await recoveredHost.execute({...execution,signal:new AbortController().signal})).toEqual(output);expect(calls).toBe(attempts);expect(snapshot()).toEqual(settled);expect(publicRows()).toEqual(before);
          if(scenario==='native-addon-execution-accounting-capped'){
            let ordinaryCredentials=0;onCredentialResolve=async()=>{ordinaryCredentials++;};
            const message={id:'ordinary-with-background-cap',chat_jid:'web:default',sender:'user',sender_name:'User',content:'Ordinary requests must not inherit the private budget admission',timestamp:new Date().toISOString(),is_from_me:false,is_bot_message:false};
            const rowId=root.transaction(()=>{const rowId=storeMessage(message);resumedBindings.getInputSourceAdmission!('web:default')!({message,rowId,database:root});return rowId;}).immediate();
            expect(await resumedBindings.dispatchAcceptedInput!('web:default',message.id,rowId)!()).toBe('settled');expect(calls).toBe(attempts);expect(ordinaryCredentials).toBe(0);
            expect(root.query('SELECT o.terminal_disposition FROM service_effect_s01_operations o JOIN service_effect_s01_sources s ON s.chat_jid=o.chat_jid AND s.source_seq=o.primary_source_seq WHERE s.source_id=?').get(message.id)).toEqual({terminal_disposition:'failed'});
          }
        }
        expect(sdkSpies.every(spy=>spy.mock.calls.length===0)).toBe(true);expect(root.query('PRAGMA foreign_key_check').all()).toEqual([]);return;
      }
      if(scenario==='native-addon-admission-model-revoked'||scenario==='native-addon-admission-public-model-revoked'){
        backend.stop();await backend.close();
        const file=(root.query('PRAGMA database_list').all() as {name:string;file:string}[]).find(row=>row.name==='main')!.file;
        const storage=new BunSqliteDatabase(file,{root,assertOwner:()=>owner.assertCurrentOwner(),fenceTransactions:true});
        const maintenance=await Harness.open(await SqliteStorage.open(storage),{
          models:createHostModels(runtime,[model,modelB].map(entry=>({provider:entry.provider,id:entry.id})),{
            signal:new AbortController().signal,async authorize(){throw Error('Offline fixture cannot dispatch');},assertCurrent(){throw Error('Offline fixture cannot dispatch');},
          }),registry:createRegistry(),
        },context);
        try{
          const publicIds=(root.query('SELECT id FROM conversations WHERE id<>?').all(admitted.conversationId) as {id:number}[]).map(row=>row.id as ConversationId);
          // Use public SDK configuration for the ordinary/root contexts only.
          // Revocation must not rewrite or renew the private input's choice.
          await maintenance.commit(async tx=>{for(const id of publicIds){
            if(scenario==='native-addon-admission-public-model-revoked'&&id!==1)continue;
            await configure(tx,id,{model:{provider:modelB.provider,modelId:modelB.id}});
          }},context);
        }finally{await maintenance.close(context);await storage.close();}
        settings.setDefaultModelAndProvider(modelB.provider,modelB.id);await settings.flush();expect(settings.drainErrors()).toEqual([]);
        const privateRows=()=>[
          root.query('SELECT * FROM conversations WHERE id=?').all(admitted.conversationId),
          root.query('SELECT * FROM documents WHERE owner_id=? AND scope_kind=\'conversation\' ORDER BY id').all(admitted.conversationId),
          root.query('SELECT r.* FROM document_revisions r JOIN documents d ON d.id=r.document_id WHERE d.owner_id=? AND d.scope_kind=\'conversation\' ORDER BY r.document_id,r.seq').all(admitted.conversationId),
          root.query('SELECT * FROM service_effect_s01_operations WHERE operation_id=?').all(admitted.operationId),
          root.query('SELECT * FROM piclaw_durable_bindings_v1 WHERE operation_id=?').all(admitted.operationId),
        ];
        const privateBefore=privateRows(),catalog=spyOn(modelRegistry,'getAvailable').mockReturnValue([modelB] as any);
        try{
          if(scenario==='native-addon-admission-public-model-revoked'){
            const before=root.serialize();
            const startup=createDefaultApplicationRuntime(owner,async()=>services).then(candidate=>{reopened=candidate;return candidate;});
            await expect(startup).rejects.toThrow('Persisted host model not approved');
            expect(root.serialize()).toEqual(before);expect(privateRows()).toEqual(privateBefore);expect(calls).toBe(0);
            expect(sdkSpies.every(spy=>spy.mock.calls.length===0)).toBe(true);owner.assertCurrentOwner();return;
          }
          reopened=await createDefaultApplicationRuntime(owner,async()=>services);reopenedBase=createRuntimeBaseServices({dataDir:workspace});
          reopenedPool=new AgentPool({credentialStore,modelRuntime:runtime,modelRegistry,...reopened.sessionOptions});const reopenedBound=reopened.bind({queue:reopenedBase.queue,agentPool:reopenedPool});
          expect(privateRows()).toEqual(privateBefore);expect(calls).toBe(0);
          await expect(reopenedPool.prepareAddonOperation(id)).rejects.toThrow('Host model not approved');
          expect(privateRows()).toEqual(privateBefore);expect(calls).toBe(0);
          const message={id:'ordinary-after-private-model-revocation',chat_jid:'web:default',sender:'user',sender_name:'User',content:'Use the still-approved ordinary model',timestamp:new Date().toISOString(),is_from_me:false,is_bot_message:false};
          const rowId=root.transaction(()=>{const rowId=storeMessage(message);reopenedBound.getInputSourceAdmission!('web:default')!({message,rowId,database:root});return rowId;}).immediate();
          expect(await reopenedBound.dispatchAcceptedInput!('web:default',message.id,rowId)!()).toBe('settled');
          expect(calls).toBe(1);expect(requested).toEqual([modelB.id]);expect(privateRows()).toEqual(privateBefore);
          expect(sdkSpies.every(spy=>spy.mock.calls.length===0)).toBe(true);expect(root.query('PRAGMA foreign_key_check').all()).toEqual([]);
        }finally{catalog.mockRestore();}
        return;
      }
      if(scenario==='native-addon-admission-alias'){
        const file=join(getDataDir(),'durable-answers',createHash('sha256').update(admitted.sourceId).digest('hex')),held=file+'.owned';
        const snapshot=()=>['conversations','documents','document_revisions','service_effect_s01_sources','service_effect_s01_operations','piclaw_durable_bindings_v1','budget_work'].map(table=>root.query(`SELECT * FROM ${table} ORDER BY rowid`).all());
        const owned=snapshot();renameSync(file,held);symlinkSync(held,file);
        try{await expect(pool.prepareAddonOperation(id)).rejects.toThrow('Invalid private background payload file');expect(snapshot()).toEqual(owned);}finally{rmSync(file);}
        linkSync(held,file);try{await expect(pool.prepareAddonOperation(id)).rejects.toThrow('Invalid private background payload file');expect(snapshot()).toEqual(owned);}finally{rmSync(file);renameSync(held,file);}
        chmodSync(file,0o644);try{await expect(pool.prepareAddonOperation(id)).rejects.toThrow('Invalid private background payload file');expect(snapshot()).toEqual(owned);}finally{chmodSync(file,0o600);}
        expect(await pool.prepareAddonOperation(id)).toEqual(admitted);expect(calls).toBe(0);expect(sdkSpies.every(spy=>spy.mock.calls.length===0)).toBe(true);return;
      }
      expect(admitted.chatJid).toBe('operation:'+id);expect(admitted.sourceId).toStartWith('background:');
      expect(publicRows()).toEqual(before);expect(backend.sessionOptions.getDurableSession?.(admitted.chatJid)).toBeUndefined();expect(await pool.getDurableSessionMetadata(admitted.chatJid)).toBeNull();
      expect(()=>bound.getInputSourceAdmission!(admitted.chatJid)).toThrow('Unbound application conversation');
      expect(await pool.getDurableSessionMetadata('web:default')).toEqual(ordinary);
      expect(root.query('SELECT submission_id FROM piclaw_durable_bindings_v1 WHERE operation_id=?').get(admitted.operationId)).toEqual({submission_id:null});
      expect(root.query('SELECT phase FROM service_effect_s01_operations WHERE operation_id=?').get(admitted.operationId)).toEqual({phase:'claimed'});
      expect(root.query('SELECT execution_kind,parent_work_id FROM budget_work WHERE id=?').get('durable-operation:'+admitted.operationId)).toEqual({execution_kind:'background',parent_work_id:'operation:'+id});
      operations.markAddonOperationInputCommitted(id); // Mutable compatibility marker is not native payload authority.
      expect(await pool.prepareAddonOperation(id)).toEqual(admitted);expect(calls).toBe(0);expect(root.query('SELECT count(*) AS n FROM submissions').get()).toEqual({n:0});
      backend.stop();await backend.close();
      await (await import('./background-admission-recovery-fixture.ts')).backgroundAdmissionRecoveryFixture(root,workspace,getDataDir(),configuration);
      configured.domains.operations.enabled=false;writeFileSync(configuration,JSON.stringify(configured));
      reopened=await createDefaultApplicationRuntime(owner,async()=>services);reopenedBase=createRuntimeBaseServices({dataDir:workspace});
      reopenedPool=new AgentPool({credentialStore,modelRuntime:runtime,modelRegistry,...reopened.sessionOptions});const reopenedBound=reopened.bind({queue:reopenedBase.queue,agentPool:reopenedPool});
      await expect(reopenedPool.prepareAddonOperation(id)).rejects.toThrow('grant changed'); // Revocation did not prevent passive cold recovery.
      configured.domains.operations.enabled=true;writeFileSync(configuration,JSON.stringify(configured));
      expect(await reopenedPool.prepareAddonOperation(id)).toEqual(admitted);expect(calls).toBe(0);expect(publicRows()).toEqual(before);
      const privateRows=()=>['conversations','documents','document_revisions','service_effect_s01_sources','service_effect_s01_operations','piclaw_durable_bindings_v1','budget_work'].map(table=>root.query(`SELECT * FROM ${table} ORDER BY rowid`).all());
      root.query('UPDATE budget_work SET parent_work_id=? WHERE id=?').run(grant.parentWorkId,'durable-operation:'+admitted.operationId);
      const cutAncestry=privateRows();await expect(reopenedPool.prepareAddonOperation(id)).rejects.toThrow('budget ancestry unavailable');expect(privateRows()).toEqual(cutAncestry);
      root.query('UPDATE budget_work SET parent_work_id=? WHERE id=?').run('operation:'+id,'durable-operation:'+admitted.operationId);
      expect(await reopenedPool.prepareAddonOperation(id)).toEqual(admitted); // Read-only refusal did not create an uncertain write.
      const accepted=privateRows();configured.domains.operations.enabled=false;writeFileSync(configuration,JSON.stringify(configured));
      await expect(reopenedPool.prepareAddonOperation(id)).rejects.toThrow('grant changed');expect(privateRows()).toEqual(accepted);
      const ordinaryMessage={id:'ordinary-after-background-revocation',chat_jid:'web:default',sender:'user',sender_name:'User',content:'An unrelated ordinary input must still run',timestamp:new Date().toISOString(),is_from_me:false,is_bot_message:false};
      const ordinaryRow=root.transaction(()=>{const rowId=storeMessage(ordinaryMessage);reopenedBound.getInputSourceAdmission!('web:default')!({message:ordinaryMessage,rowId,database:root});return rowId;}).immediate();
      expect(await reopenedBound.dispatchAcceptedInput!('web:default',ordinaryMessage.id,ordinaryRow)!()).toBe('settled');expect(calls).toBe(1);
      expect(root.query('SELECT phase FROM service_effect_s01_operations WHERE operation_id=?').get(admitted.operationId)).toEqual({phase:'claimed'});
      expect(sdkSpies.every(spy=>spy.mock.calls.length===0)).toBe(true);expect(root.query('PRAGMA foreign_key_check').all()).toEqual([]);
    }finally{
      if(scenario==='native-addon-execution-accounting-capped-cleanup-failed')root.exec('DROP TRIGGER IF EXISTS fail_budget_rejection_cleanup');
      backgroundDeadlineTimer?.mockRestore();deadlineClock?.mockRestore();
      if(saved===undefined)rmSync(configuration,{force:true});else writeFileSync(configuration,saved);
      reopened?.stop();await reopened?.close();await reopenedBase?.queue.shutdown();await reopenedPool?.shutdown();
      backend.stop();await backend.close();await channel.stop();await base.queue.shutdown();await pool.shutdown();
      for(const spy of [...captureSpies,...sdkSpies])spy.mockRestore();owner.release();closeDatabase();
    }
    return;
  }
  if (scenario === "native-nonweb-admission") {
    const messageLoop=await import('../../runtime/src/runtime/message-loop.js');
    const {startRuntimeLoop}=await import('../../runtime/src/runtime/coordinator.js');
    const {RuntimeState}=await import('../../runtime/src/runtime/state.js');
    const state=new RuntimeState(workspace);
    const control=spyOn(pool,'applyControlCommand'),slash=spyOn(pool,'applySlashCommand');
    const saves=spyOn(state,'saveTimestamps'),marked=spyOn(state,'markCommandProcessed');
    const tables=['budget_work','budget_request_reservations','service_effect_s01_chats','service_effect_s01_sources','service_effect_s01_operations','messages','chat_cursors',
      'conversations','entries','tasks','submissions','documents','document_revisions','router_state'];
    const snapshot=()=>tables.map(table=>root.query(`SELECT * FROM ${table} ORDER BY rowid`).all());
    try {
      for(const [index,text] of ['@Pi ordinary pending input','@Pi /model fixture/unavailable','@Pi /help'].entries()) {
        const chat=`custom:native-unbound:${index}`;storeChatMetadata(chat,new Date().toISOString());state.chatJids.add(chat);
        storeMessage({id:`unadmitted-nonweb-${index}`,chat_jid:chat,sender:'user',sender_name:'User',content:text,timestamp:`2026-01-01T00:00:0${index}.000Z`,is_from_me:false,is_bot_message:false});
        const before=snapshot();
        expect(messageLoop).not.toHaveProperty('processMessages');
        const stopOne=new AbortController(),cancelOne=setTimeout(()=>stopOne.abort(),0);
        try{await startRuntimeLoop({state,assistantName:'Pi',pollIntervalMs:60000,signal:stopOne.signal});}
        finally{clearTimeout(cancelOne);stopOne.abort();}
        expect(snapshot()).toEqual(before);
      }
      const beforePoll=snapshot(),stop=new AbortController();
      const cancel=setTimeout(()=>stop.abort(),0);
      try{await startRuntimeLoop({state,assistantName:'Pi',pollIntervalMs:60_000,signal:stop.signal});}
      finally{clearTimeout(cancel);stop.abort();}
      expect(state.lastTimestamp).toBe('');expect(base.queue.getMetrics().enqueued).toBe(0);expect(snapshot()).toEqual(beforePoll);
      expect(state.lastAgentTimestamp).toEqual({});expect(pool).not.toHaveProperty('runAgent');expect(control).not.toHaveBeenCalled();expect(slash).not.toHaveBeenCalled();
      expect(saves).not.toHaveBeenCalled();expect(marked).not.toHaveBeenCalled();expect(calls).toBe(0);expect(sdkSpies.every(spy=>spy.mock.calls.length===0)).toBe(true);
    } finally {
      for(const spy of [control,slash,saves,marked])spy.mockRestore();
      backend.stop();await backend.close();await channel.stop();await base.queue.shutdown();await pool.shutdown();
      for(const spy of [...captureSpies,...sdkSpies])spy.mockRestore();owner.release();closeDatabase();
    }
    return;
  }
  if (scenario === "native-runner-denial") {
    const rows = () => ["budget_work", "budget_request_reservations", "service_effect_s01_chats", "service_effect_s01_operations",
      "service_effect_s01_sources", "conversations", "entries", "tasks", "submissions", "documents", "document_revisions", "messages", "chat_cursors"]
      .map(table => root.query(`SELECT * FROM ${table}`).all());
    const before = rows();
    try {
      expect('runAgent' in pool).toBe(false);
      expect(rows()).toEqual(before);expect(calls).toBe(0);
      expect(sdkSpies.every(spy => spy.mock.calls.length === 0)).toBe(true);
    } finally {
      backend.stop(); await backend.close(); await channel.stop(); await base.queue.shutdown(); await pool.shutdown();
      for (const spy of [...captureSpies, ...sdkSpies]) spy.mockRestore();
      owner.release(); closeDatabase();
    }
    return;
  }
  if (scenario.startsWith("native-shutdown-")) {
    const { admitWebUserMessage } = await import("../../runtime/src/channels/web/messaging/message-store.js");
    const marker = join(workspace, "shutdown-tool-once.txt");
    let entered!: () => void;
    const held = new Promise<void>(resolve => { entered = resolve; });
    toolSequence = [{ name: "bash", arguments: { command: `printf X >> '${marker}'` } }];
    onProviderResponse = () => { if (calls === 1) checkpointHold = { entered }; };
    try {
      const stored = await admitWebUserMessage(channel, { chatJid: "web:default", content: "Complete one tool before restart", isBot: false,
        mediaIds: [], agentId: "default", agentName: "Fixture" }, { acceptSource: bound.getInputSourceAdmission!("web:default") },
        () => owner.assertCurrentOwner(), new AbortController().signal);
      assert(stored);
      const source = root.query("SELECT rowid,id FROM messages WHERE rowid=?").get(stored.id) as { rowid: number; id: string };
      const running = bound.dispatchAcceptedInput!("web:default", source.id, source.rowid)!().catch(error => error);
      await held;
      expect(readFileSync(marker, "utf8")).toBe("X");
      expect(calls).toBe(2);
      const submission = root.query("SELECT id FROM submissions ORDER BY id DESC LIMIT 1").get();
      const completedTools = root.query("SELECT id,record FROM tasks WHERE kind=json_quote('pi.tool') AND status='terminal' ORDER BY id").all();
      expect(completedTools.length).toBeGreaterThan(0);
      const signal = checkpointHold!.signal!;
      if (scenario === "native-shutdown-stop-recover") {
        backend.stop();
        await Bun.sleep(10);
        expect(signal.aborted).toBe(false); // Producer stop must not manufacture a provider failure.
      }
      await backend.close();
      await running;
      expect(signal.aborted).toBe(true); // The SDK, not dependency teardown, interrupted the request.
      expect(root.query("SELECT state FROM service_effect_s01_sources WHERE source_id=?").get(source.id)).toEqual({ state: "claimed" });
      expect(root.query("SELECT phase FROM service_effect_s01_operations WHERE chat_jid='web:default'").get()).toEqual({ phase: "executing" });
      expect(root.query("SELECT content FROM messages WHERE is_bot_message=1").all()).toEqual([]);
      expect(root.query("SELECT id,record FROM tasks WHERE kind=json_quote('pi.tool') AND status='terminal' ORDER BY id").all()).toEqual(completedTools);
      checkpointHold = undefined; onProviderResponse = undefined;
      backend = await createDefaultApplicationRuntime(owner, async () => services);
      const reopened = backend.bind({ queue: base.queue, agentPool: pool });
      expect(await reopened.dispatchAcceptedInput!("web:default", source.id, source.rowid)!()).toBe("settled");
      expect(root.query("SELECT id FROM submissions ORDER BY id DESC LIMIT 1").get()).toEqual(submission);
      expect(root.query("SELECT state FROM service_effect_s01_sources WHERE source_id=?").get(source.id)).toEqual({ state: "consumed" });
      expect(root.query("SELECT terminal_disposition FROM service_effect_s01_operations WHERE chat_jid='web:default'").get()).toEqual({ terminal_disposition: "completed" });
      expect(root.query("SELECT content FROM messages WHERE is_bot_message=1").all()).toEqual([{ content: "factory synthetic reply" }]);
      expect(root.query("SELECT id,record FROM tasks WHERE kind=json_quote('pi.tool') AND status='terminal' ORDER BY id").all()).toEqual(completedTools);
      expect(readFileSync(marker, "utf8")).toBe("X");
      expect(calls).toBe(3);
    } finally {
      checkpointHold = undefined; onProviderResponse = undefined;
      await backend.close(); await channel.stop(); await base.queue.shutdown(); await pool.shutdown();
      for (const spy of [...captureSpies, ...sdkSpies]) spy.mockRestore();
      owner.release(); closeDatabase();
    }
    return;
  }
  if (scenario.startsWith("native-process-")) {
    const { admitWebUserMessage } = await import("../../runtime/src/channels/web/messaging/message-store.js");
    const { nativeExitNotice } = await import("../../runtime/durable-engine/src/host-process-receipt.js");
    const { createScheduledTaskAuthority } = await import("../../runtime/src/service-effects/current-piclaw/scheduled-task-authority.js");
    const reason = "production factory qualified exit";
    let shutdowns = 0, releaseHeld!: () => void;
    const hold = new Promise<void>(resolve => { releaseHeld = resolve; });
    const globals = globalThis as { __PICLAW_EXIT_SCHEDULER__?: () => void };
    const priorScheduler = globals.__PICLAW_EXIT_SCHEDULER__;
    globals.__PICLAW_EXIT_SCHEDULER__ = () => {
      expect(root.query("SELECT id FROM tasks WHERE status<>'terminal'").all()).toEqual([]);
      expect(root.query("SELECT disposition FROM service_effect_s02_commits").all()).toEqual([{ disposition: "completed" }]);
      expect(root.query("SELECT content FROM messages WHERE is_bot_message=1").all()).toEqual([{ content: nativeExitNotice(reason) }]);
      if (processAccounting) {
        expect(root.query("SELECT state FROM budget_request_reservations").all()).toEqual([{ state: "settled" }]);
        expect(root.query("SELECT DISTINCT status FROM budget_work").all()).toEqual([{ status: "completed" }]);
      }
      shutdowns++;
    };
    backend.attachChannel!({ broadcastEvent() {} });
    try {
      if (scenario === "native-process-exit-queue-busy")
        base.queue.enqueue(async () => hold, "held-shell", "scheduled-shell:web:default");
      if (scenario === "native-process-exit-shell-lease") {
        createScheduledTaskAuthority(root).create({ taskId: "process-exit-held-shell", chatJid: "web:default", kind: "shell", payloadRef: "shell:held",
          modelLabel: null, scheduleType: "interval", scheduleValue: "60000", timezone: "UTC", notifyOnComplete: false, muted: true,
          cwd: null, timeoutSec: null, internalTask: null, redactionClass: "private", executionRepeatability: "repeatable",
          nextRunAt: "2026-10-23T00:00:00.000Z", authoredAt: "2026-10-22T00:00:00.000Z" });
        const scheduled = createCurrentPiclawScheduledRunStore(root, { hitFault: () => false, recordTrace() {} });
        assert(scheduled.ok);
        const leases = await scheduled.value.claimDue({ now: "2026-10-23T00:00:01.000Z", limit: 1, workerId: "held-worker",
          leaseTokenPrefix: "held-shell-token", leaseDurationMs: 60000, reclaimAuthorities: [] });
        expect(leases.ok && leases.value.length).toBe(1); // No shell is executed in this test.
      }
      toolSequence = [{ name: scenario === "native-process-status" ? "session_status" : "exit_process", arguments: scenario === "native-process-status" ? { action: "check" } : { reason } }];
      const stored = await admitWebUserMessage(channel, { chatJid: "web:default", content: "Approve the native restart", isBot: false,
        mediaIds: [], agentId: "default", agentName: "Fixture" }, { acceptSource: bound.getInputSourceAdmission!("web:default") },
        () => owner.assertCurrentOwner(), new AbortController().signal);
      assert(stored);
      const source = root.query("SELECT rowid,id FROM messages WHERE rowid=?").get(stored.id) as { rowid: number; id: string };
      const dispatch = bound.dispatchAcceptedInput!("web:default", source.id, source.rowid)!;
      await new Promise<void>((resolve, reject) => {
        base.queue.enqueue(async () => {
          try { expect(await dispatch()).toBe(processAccountingCloseFailure ? "pending" : "settled"); resolve(); } catch (error) { reject(error); }
        }, `chat:web:default:${source.rowid}`, "chat:web:default");
      });
      if (processAccountingCloseFailure) {
        expect(calls).toBe(1); expect(shutdowns).toBe(0);
        expect(root.query("SELECT state FROM budget_request_reservations").all()).toEqual([{ state: "settled" }]);
        expect(root.query("SELECT status FROM budget_work WHERE parent_work_id IS NULL").all()).toEqual([{ status: "active" }]);
        expect(() => base.queue.enqueue(async () => {}, "no-accounting-bypass")).toThrow("sealed");
      } else if (scenario === "native-process-exit" || processAccounting) {
        expect(calls).toBe(1);
        const deadline = Date.now() + 5000;
        while (!shutdowns && Date.now() < deadline) await Bun.sleep(10);
        expect(shutdowns).toBe(1);
        expect(() => base.queue.enqueue(async () => {}, "forbidden-new-work")).toThrow("sealed");
      } else {
        expect(calls).toBe(2); expect(shutdowns).toBe(0);
        const result = observedResults.get("factory-tool-1")!;
        expect(result.toolName).toBe(scenario === "native-process-status" ? "session_status" : "exit_process");
        if (scenario === "native-process-status") {
          expect(result.isError).not.toBe(true);
          expect(JSON.parse((result.content as { text: string }[])[0]!.text).safe_to_restart).toBe(true);
        } else expect(result.isError).toBe(true);
      }
    } finally {
      releaseHeld(); globals.__PICLAW_EXIT_SCHEDULER__ = priorScheduler;
      await base.queue.shutdown(); await pool.shutdown(); await channel.stop(); backend.stop(); await backend.close();
      for (const spy of [...captureSpies, ...sdkSpies]) spy.mockRestore();
      closeDatabase(); owner.release();
    }
    return;
  }
  if (scenario === "native-goal-budget") {
    const freshChat = "web:goal-created-after-start";
    storeChatMetadata(freshChat, new Date().toISOString());
    await bound.prepareInputSourceAdmission!(freshChat);
    const prepared = bound.prepareInputText!(freshChat, "A fresh ordinary input");
    expect(prepared.text).toBe("A fresh ordinary input");
    expect(() => prepared.assertCurrent()).not.toThrow();
    const { getDeferredQueuedFollowups } = await import("../../runtime/src/db.js");
    const { storeWebMessage, admitWebUserMessage } = await import("../../runtime/src/channels/web/messaging/message-store.js");
    const { handleRegisteredAddonConfigApiRequest } = await import("../../runtime/src/channels/web/handlers/addon-config-api.js");
    backend.attachChannel!({ broadcastEvent() {}, resumePendingChats() { expect(getDb().inTransaction).toBe(false); } });
    expect(await pool.applySlashCommand("web:default", "/goal Budget wrap-up")).toMatchObject({ status: "success" });
    const settingsRequest = new Request("http://fixture/agent/addons/api/goal/goal?chat_jid=web:default", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token_budget: 5 }),
    });
    admitAddonLocalRequest(settingsRequest, resolveRequestPrincipal(settingsRequest,
      { mode: "single-user", authEnabled: false }, { getSession: () => null, getUser: () => null, getLocalDisplayName: () => "Fixture owner" })!, () => !settingsRequest.signal.aborted);
    const settings = await handleRegisteredAddonConfigApiRequest(settingsRequest, "goal", "goal", (body, status = 200) => Response.json(body, { status }));
    expect(settings!.status, await settings!.clone().text()).toBe(200);
    expect(await settings!.json()).toMatchObject({ continuationQueued: false });
    const initial = getDeferredQueuedFollowups("web:default")[0]!;
    const firstMessage = storeWebMessage(channel, { chatJid: "web:default", content: initial.queuedContent,
      mediaIds: [], isBot: false, agentId: "default", agentName: "Fixture" }, {
      consumeDeferredFollowupRowId: initial.rowId, materializeQueuedSource: bound.getQueuedInputMaterialization!("web:default"),
    })!;
    const human = await admitWebUserMessage(channel, { chatJid: "web:default", content: "Ordinary human input before budget wrap-up",
      mediaIds: [], isBot: false, agentId: "default", agentName: "Fixture" },
      { acceptSource: bound.getInputSourceAdmission!("web:default") }, () => owner.assertCurrentOwner(), new AbortController().signal);
    expect(human).not.toBeNull();
    const humanId = (root.query("SELECT id FROM messages WHERE rowid=?").get(human!.id) as { id: string }).id;
    expect(await bound.dispatchAcceptedInput!("web:default", initial.source_id!, firstMessage.id)!()).toBe("settled");
    expect(calls).toBe(1);
    expect(extensionKvGet("goal", "thread-goal", "chat", "web:default")).toMatchObject({ status: "budget_limited", tokens_used: 10,
      lifecycle_generation: 2, budget_limit_reported: true, no_progress_turns: 0 });
    const queued = getDeferredQueuedFollowups("web:default");
    expect(queued).toHaveLength(1);
    expect(queued[0]!.queuedContent).toStartWith("🎯 Goal budget reached: Budget wrap-up");
    expect(queued[0]!.source_id).toStartWith("goal-budget:");
    const sourceText = (root.query("SELECT content FROM messages WHERE rowid=?").get(firstMessage.id) as { content: string }).content;
    root.query("UPDATE messages SET content=? WHERE rowid=?").run(sourceText + "tampered", firstMessage.id);
    expect(() => assertFreshApplicationHistory(root, join(workspace, "absent-legacy-sessions"))).not.toThrow();
    root.query("UPDATE messages SET content=? WHERE rowid=?").run(sourceText, firstMessage.id);
    expect(() => assertFreshApplicationHistory(root, join(workspace, "absent-legacy-sessions"))).not.toThrow();
    // Reopen the actual default application with the human input and exactly one
    // admitted budget wrap-up still pending. No provider is replayed at startup.
    await pool.shutdown(); backend.stop(); await backend.close(); closeDatabase();
    initDatabase(); root = getDb();
    backend = await createDefaultApplicationRuntime(owner, async () => services);
    const reopenedPool = new AgentPool({ credentialStore, modelRuntime: runtime, modelRegistry, ...backend.sessionOptions });
    const reopened = backend.bind({ queue: base.queue, agentPool: reopenedPool });
    const reopenedChannel = new WebChannel(reopened);
    backend.attachChannel!({ broadcastEvent() {}, resumePendingChats() { expect(getDb().inTransaction).toBe(false); } });
    expect(calls).toBe(1);
    expect(getDeferredQueuedFollowups("web:default")).toEqual(queued);
    const wrap = queued[0]!;
    const wrapMessage = storeWebMessage(reopenedChannel, { chatJid: "web:default", content: wrap.queuedContent,
      mediaIds: [], isBot: false, agentId: "default", agentName: "Fixture" }, {
      consumeDeferredFollowupRowId: wrap.rowId, materializeQueuedSource: reopened.getQueuedInputMaterialization!("web:default"),
    })!;
    const dispatchWrap = reopened.dispatchAcceptedInput!("web:default", wrap.source_id!, wrapMessage.id)!;
    expect(await dispatchWrap()).toBe("pending"); // The older human source owns the next frontier.
    expect(calls).toBe(1);
    toolSequence = [{ name: "plan", arguments: { action: "read" } }];
    expectedToolSource = humanId;
    expect(await reopened.dispatchAcceptedInput!("web:default", humanId, human!.id)!()).toBe("settled");
    expect(calls).toBe(3);
    expect(observedResults.get("factory-tool-2")?.toolName).toBe("plan");
    expect(observedResults.get("factory-tool-2")?.isError).not.toBe(true);
    expect(JSON.stringify(observedResults.get("factory-tool-2")?.content)).toContain("NATIVE_PLAN_OLD");
    expect(planRequests[1]).not.toContain("has reached its token budget");
    expect(extensionKvGet("goal", "thread-goal", "chat", "web:default")).toMatchObject({ tokens_used: 10 });
    expect(await dispatchWrap()).toBe("settled");
    expect(calls).toBe(4);
    expect(planRequests[3]).toContain("has reached its token budget");
    expect(await dispatchWrap()).toBe("settled");
    expect(calls).toBe(4);
    expect(extensionKvGet("goal", "thread-goal", "chat", "web:default")).toMatchObject({ status: "budget_limited", tokens_used: 20,
      lifecycle_generation: 2, budget_limit_reported: true });
    expect(getDeferredQueuedFollowups("web:default")).toHaveLength(0);
    for (const spy of sdkSpies) expect(spy).not.toHaveBeenCalled();
    await reopenedPool.shutdown(); backend.stop(); await backend.close(); closeDatabase(); owner.release();
    return;
  }
  if (scenario === "native-goal-local-denial" || scenario === "native-goal-critical-denial") {
    const critical = scenario === "native-goal-critical-denial";
    const fatal = Error("Synthetic Goal context integrity failure");
    const criticalSpy = critical ? spyOn(HostConversationRuntime.prototype, "prepareGoalContext").mockImplementation(async () => { throw fatal; }) : undefined;
    try {
      expect(await pool.applySlashCommand("web:default", "/goal Deny only this revoked generation")).toMatchObject({ status: "success" });
      const { getDeferredQueuedFollowups } = await import("../../runtime/src/db.js");
      const control = getDeferredQueuedFollowups("web:default")[0]!;
      // It was valid when materialised, then revoked before its SDK request.
      // This intentionally crosses the later execution fence, not queue expiry.
      const materialized = channel.storeMessage("web:default", control.queuedContent, false, [], { consumeDeferredFollowupRowId: control.rowId });
      expect(materialized).not.toBeNull();
      if (!critical) expect(await pool.applySlashCommand("web:default", "/goal pause")).toMatchObject({ status: "success" });
      expect(await bound.dispatchAcceptedInput!("web:default", control.source_id!, materialized!.id)!()).toBe("settled");
      expect(calls).toBe(0);
      expect(root.query("SELECT o.terminal_disposition FROM service_effect_s01_operations o JOIN service_effect_s01_sources s ON s.chat_jid=o.chat_jid AND s.source_seq=o.primary_source_seq WHERE s.source_id=?").get(control.source_id!)).toEqual({ terminal_disposition: "failed" });
      if (critical) {
        expect(criticalSpy!.mock.calls).toHaveLength(1);
        await expect(pool.applySlashCommand("web:default", "/goal status")).rejects.toThrow(fatal.message);
        expect(calls).toBe(0);
        return; // Unexpected integrity/ownership errors keep the global fence.
      }
      // Old code aborted the whole application lifetime here. The same live
      // backend must still accept control inspection and an ordinary SDK turn.
      expect(await pool.applySlashCommand("web:default", "/goal status")).toMatchObject({ status: "success" });
      const ordinary = { id: "after-goal-local-denial", chat_jid: "web:default", sender: "user", sender_name: "User",
        content: "Ordinary user request after Goal revocation", timestamp: new Date().toISOString(), is_from_me: false, is_bot_message: false };
      const rowId = root.transaction(() => {
        const row = storeMessage(ordinary);
        bound.getInputSourceAdmission!(ordinary.chat_jid)!({ message: ordinary, rowId: row, database: root });
        return row;
      }).immediate();
      expect(await bound.dispatchAcceptedInput!(ordinary.chat_jid, ordinary.id, rowId)!()).toBe("settled");
      expect(calls).toBe(1);
      expect(root.query("SELECT o.terminal_disposition FROM service_effect_s01_operations o JOIN service_effect_s01_sources s ON s.chat_jid=o.chat_jid AND s.source_seq=o.primary_source_seq WHERE s.source_id=?").get(ordinary.id)).toEqual({ terminal_disposition: "completed" });
      expect(extensionKvGet("goal", "thread-goal", "chat", "web:default")).toMatchObject({ status: "paused", lifecycle_generation: 2 });
      expect(getDeferredQueuedFollowups("web:default")).toEqual([]);
      expect(sdkSpies.every(spy => spy.mock.calls.length === 0)).toBe(true);
    } finally {
      criticalSpy?.mockRestore();
      await channel.stop(); await base.queue.shutdown(); await pool.shutdown(); backend.stop(); await backend.close();
      for (const spy of [...captureSpies, ...sdkSpies]) spy.mockRestore();
      closeDatabase(); owner.release();
    }
    return;
  }
  if (scenario === "native-goal") {
    const wakes: string[] = [];
    let failWake = false;
    backend.attachChannel!({ broadcastEvent() {}, resumePendingChats(chat) { expect(getDb().inTransaction).toBe(false); if (failWake) throw Error("wake unavailable"); wakes.push(chat!); } });
    expect(await pool.applySlashCommand("web:default", "/goal Implement native Goal")).toMatchObject({ status: "success", message: "Goal active — continuation queued" });
    const { getDeferredQueuedFollowups } = await import("../../runtime/src/db.js");
    const queued = getDeferredQueuedFollowups("web:default");
    expect(queued).toHaveLength(1);
    expect(wakes).toEqual(["web:default"]);
    expect(queued[0]!.source_accepted).toBe(true);
    expect(queued[0]!.queuedContent).toContain("<piclaw_goal_input>");
    const { storeWebMessage } = await import("../../runtime/src/channels/web/messaging/message-store.js");
    const item = queued[0]!;
    const stored = storeWebMessage(channel, { chatJid: "web:default", content: item.queuedContent, mediaIds: [], isBot: false, agentId: "default", agentName: "Fixture" }, {
      consumeDeferredFollowupRowId: item.rowId, materializeQueuedSource: bound.getQueuedInputMaterialization!("web:default"),
    });
    expect(stored).not.toBeNull();
    expectedToolSource = item.source_id!;
    const dispatchResult = await bound.dispatchAcceptedInput!("web:default", item.source_id!, stored!.id)!();
    expect(dispatchResult).toBe("settled");
    expect(wakes).toEqual(["web:default", "web:default", "web:default"]);
    expect(calls).toBeGreaterThan(0);
    expect(getDeferredQueuedFollowups("web:default")).toHaveLength(1);
    expect(extensionKvGet("goal", "thread-goal", "chat", "web:default")).toMatchObject({ status: "active", no_progress_turns: 1 });
    const { handleRegisteredAddonConfigApiRequest } = await import("../../runtime/src/channels/web/handlers/addon-config-api.js");
    const settingsRequest = new Request("http://fixture/agent/addons/api/goal/goal?chat_jid=web:default", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ objective: "Updated through native Settings" }),
    });
    admitAddonLocalRequest(settingsRequest, resolveRequestPrincipal(settingsRequest,
      { mode: "single-user", authEnabled: false }, { getSession: () => null, getUser: () => null, getLocalDisplayName: () => "Fixture owner" })!, () => !settingsRequest.signal.aborted);
    const settings = await handleRegisteredAddonConfigApiRequest(settingsRequest, "goal", "goal", (body, status = 200) => Response.json(body, { status }));
    expect(settings!.status, await settings!.clone().text()).toBe(200);
    expect(await settings!.json()).toMatchObject({ continuationQueued: true, continuationReason: "objective_updated" });
    expect(extensionKvGet("goal", "thread-goal", "chat", "web:default")).toMatchObject({ objective: "Updated through native Settings" });
    expect(getDeferredQueuedFollowups("web:default")).toHaveLength(2);
    failWake = true; // Optional wake failure cannot reject an already committed command.
    expect(await pool.applySlashCommand("web:default", "/goal pause")).toMatchObject({ status: "success", message: "Goal paused" });
    // Both old host controls were accepted before this lifecycle transition.
    // The real channel must retire them, not submit a doomed SDK generation.
    const expired = getDeferredQueuedFollowups("web:default");
    expect(expired).toHaveLength(2);
    const pausedGoal = extensionKvGet("goal", "thread-goal", "chat", "web:default");
    const callsBeforeExpiry = calls;
    const submissionsBeforeExpiry = root.query("SELECT * FROM submissions ORDER BY id").all();
    const messagesBeforeExpiry = root.query("SELECT * FROM messages ORDER BY rowid").all();
    const { materializeDeferredFollowups } = await import("../../runtime/src/channels/web/runtime/process-chat-control-runtime.js");
    expect(typeof channel.expireQueuedInput).toBe("function");
    expect((await materializeDeferredFollowups({ channel, chatJid: "web:default", agentId: "default" })).status).toBe("drained");
    expect(getDeferredQueuedFollowups("web:default")).toEqual([]);
    for (const item of expired) expect(root.query("SELECT state FROM service_effect_s01_sources WHERE chat_jid=? AND source_id=?").get("web:default", item.source_id!)).toEqual({ state: "disposed" });
    expect(root.query("SELECT * FROM submissions ORDER BY id").all()).toEqual(submissionsBeforeExpiry);
    expect(root.query("SELECT * FROM messages ORDER BY rowid").all()).toEqual(messagesBeforeExpiry);
    expect(calls).toBe(callsBeforeExpiry);
    expect(extensionKvGet("goal", "thread-goal", "chat", "web:default")).toEqual(pausedGoal);
    await channel.stop(); await base.queue.shutdown(); await pool.shutdown(); backend.stop(); await backend.close();
    closeDatabase(); initDatabase(); root = getDb();
    backend = await createDefaultApplicationRuntime(owner, async () => services);
    const reopenedBase = createRuntimeBaseServices({ dataDir: workspace });
    const reopenedPool = new AgentPool({ credentialStore, modelRuntime: runtime, modelRegistry, ...backend.sessionOptions });
    const reopenedChannel = new WebChannel(backend.bind({ queue: reopenedBase.queue, agentPool: reopenedPool }));
    try {
      expect(typeof reopenedChannel.expireQueuedInput).toBe("function");
      expect((await materializeDeferredFollowups({ channel: reopenedChannel, chatJid: "web:default", agentId: "default" })).status).toBe("none");
      expect(getDeferredQueuedFollowups("web:default")).toEqual([]);
      expect(root.query("SELECT * FROM submissions ORDER BY id").all()).toEqual(submissionsBeforeExpiry);
      expect(extensionKvGet("goal", "thread-goal", "chat", "web:default")).toEqual(pausedGoal);
      expect(calls).toBe(callsBeforeExpiry);
      for (const item of expired) expect(root.query("SELECT state FROM service_effect_s01_sources WHERE chat_jid=? AND source_id=?").get("web:default", item.source_id!)).toEqual({ state: "disposed" });
    } finally { await reopenedChannel.stop(); await reopenedBase.queue.shutdown(); await reopenedPool.shutdown(); backend.stop(); await backend.close(); }
    closeDatabase(); owner.release();
    return;
  }
  const widgetEvents: { event: string; data: unknown }[] = [];
  const broadcast = channel.broadcastEvent.bind(channel);
  channel.broadcastEvent = (event, data) => { if (event === "extension_ui_widget") widgetEvents.push({ event, data }); broadcast(event, data); };
  const tableChat = scenario === "native-editable-table-nonweb" ? "whatsapp:fixture" : scenario === "native-editable-table-branch" ? "web:table-branch" : "web:default";
  let sseText = "";
  let sseReader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  let sseDrain: Promise<void> | undefined;
  if (nativeTable || nativeDrawio) {
    if (scenario !== "native-editable-table-missing-publisher") {
      const attached = drawioMissingOpener ? { broadcastEvent: channel.broadcastEvent.bind(channel) } : channel;
      backend.attachChannel!(attached);
      expect(() => backend.attachChannel!(attached)).toThrow("already attached");
    }
    const response = await channel.handleRequest(new Request(`http://fixture/sse/stream?chat_jid=${encodeURIComponent(tableChat)}`));
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/event-stream");
    sseReader = response.body!.getReader();
    sseDrain = (async () => {
      const replied = new Set<string>();
      for (;;) {
        const chunk = await sseReader!.read(); if (chunk.done) return;
        sseText += new TextDecoder().decode(chunk.value);
        if (nativeDrawio) for (const line of sseText.split("\n")) {
          if (!line.startsWith("data: ")) continue;
          let payload: any; try { payload = JSON.parse(line.slice(6)); } catch { continue; }
          if (payload.kind !== "custom" || !payload.request_id || replied.has(payload.request_id)) continue;
          replied.add(payload.request_id);
          drawioRequests.push(payload.request_id);
          expect(payload).toMatchObject({ chat_jid: "web:default", options: { action: "open_workspace_file", target: "tab" } });
          const reply = await channel.handleRequest(new Request("http://fixture/agent/respond", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ request_id: payload.request_id, chat_jid: payload.chat_jid, outcome: { ok: true, opened: true, target: "tab" } }) }));
          expect(await reply.json()).toMatchObject({ status: "ok" });
        }
      }
    })();

  }
  if (nativeScheduler) {
    const prohibited = [spyOn(pool, "saveSessionPosition"), spyOn(pool, "getCurrentModelLabel")];
    prohibited.forEach(spy => spy.mockImplementation(() => { throw Error("legacy scheduler path"); }));
    const delivered: string[] = [];
    const scheduledStore = createCurrentPiclawScheduledRunStore(root, { hitFault: () => false, recordTrace() {} });
    if (!scheduledStore.ok) throw Error("Scheduled store unavailable");
      if (scheduledAccountingUnknown) {
        const id = "native-schedule-unknown", due = new Date(0).toISOString();
        createTask({ id, chat_jid: "web:default", prompt: "scheduled real consumer", schedule_type: "once", schedule_value: due, next_run: due, status: "active", notify_on_complete: false, created_at: due });
        const before = calls;
        await pollScheduledRunsOnce({ queue: base.queue, agentPool: pool, sendMessage: async (_jid, text) => { delivered.push(text); } }, scheduledStore.value);
        const deadline = Date.now() + 5000;
        while (!root.query("SELECT 1 FROM task_run_logs WHERE task_id=?").get(id) && Date.now() < deadline) await Bun.sleep(10);
        expect(calls).toBe(before + 1);
        expect(root.query("SELECT r.state FROM budget_request_reservations r JOIN budget_work w ON w.id=r.work_id WHERE w.execution_kind='scheduled'").all()).toEqual([{ state: "unresolved" }]);
        expect(root.query("SELECT status,scheduled_task_id FROM budget_work WHERE parent_work_id IS NULL AND execution_kind='scheduled'").all()).toEqual([{ status: "active", scheduled_task_id: id }]);
        expect(root.query("SELECT t.invocation_id FROM token_usage t JOIN budget_work w ON w.id=t.work_id WHERE w.execution_kind='scheduled'").all()).toHaveLength(0);
        expect(delivered.join(" ")).not.toContain("factory synthetic reply");
        await channel.stop(); await base.queue.shutdown(); await pool.shutdown(); backend.stop(); await backend.close();
        closeDatabase(); initDatabase(); root = getDb();
        expect(root.query("SELECT r.state FROM budget_request_reservations r JOIN budget_work w ON w.id=r.work_id WHERE w.execution_kind='scheduled'").all()).toEqual([{ state: "unresolved" }]);
        expect(root.query("SELECT status FROM budget_work WHERE parent_work_id IS NULL AND execution_kind='scheduled'").all()).toEqual([{ status: "active" }]);
        for (const spy of [...captureSpies, ...sdkSpies]) spy.mockRestore();
        closeDatabase(); owner.release(); return;
      }
    try {
      if (!definitionScheduler) {
        storeChatMetadata("web:scheduled-dynamic", new Date().toISOString());
        await bound.prepareInputSourceAdmission!("web:scheduled-dynamic");
      }
      for (const [index, chat] of (definitionScheduler ? ["web:default"] : ["web:default", "web:scheduled-dynamic", "web:default"]).entries()) {
        if (index === 2) {
          const message = { id: "scheduler-main-seed", chat_jid: chat, sender: "user", sender_name: "User", content: "main history", timestamp: new Date().toISOString(), is_from_me: false, is_bot_message: false };
          const row = root.transaction(() => { const id = storeMessage(message); const admit = bound.getInputSourceAdmission!(chat); assert(admit); admit({ message, rowId: id, database: root }); return id; })();
          expect(await bound.dispatchAcceptedInput!(chat, message.id, row!)!()).toBe("settled");
        }
        const port = backend.sessionOptions.getDurableSession!(chat)!;
        const position = await port.readPosition();
        expect(await port.readModel!()).toBe(`${model.provider}/${model.id}`);
        const before = JSON.stringify(root.query("SELECT * FROM entries WHERE conversation_id=(SELECT conversation_id FROM piclaw_durable_bindings_v1 WHERE source_id='scheduler-main-seed') ORDER BY id").all());
        const due = new Date(Date.now() - 1000).toISOString(), id = `native-schedule-${index}`;
        createTask({ id, chat_jid: chat, model: `${modelB.provider}/${modelB.id}`, prompt: "scheduled real consumer", schedule_type: "once", schedule_value: due, next_run: due, status: "active", notify_on_complete: false, created_at: due });
        if (definitionScheduler) root.query(`UPDATE scheduled_tasks SET prompt='MUTABLE CACHE MUST NEVER EXECUTE',
          model='wrong/model',chat_jid='web:wrong',revision=999,status='completed',next_run=NULL WHERE id=?`).run(id);
        await pollScheduledRunsOnce({ queue: base.queue, agentPool: pool, sendMessage: async (_chat, text) => { delivered.push(text); } }, scheduledStore.value);
        const deadline = Date.now() + 5000;
        while (!root.query("SELECT 1 FROM service_effect_s07_occurrences WHERE task_id=? AND state='completed'").get(id) && Date.now() < deadline) await Bun.sleep(10);
        expect(root.query("SELECT state FROM service_effect_s07_occurrences WHERE task_id=?").get(id)).toEqual({ state: "completed" });
        expect(await port.readPosition()).toBe(position);
        expect(await port.readModel!()).toBe(`${model.provider}/${model.id}`);
        expect(requested.at(-1)).toBe(modelB.id);
        expect(JSON.stringify(root.query("SELECT * FROM entries WHERE conversation_id=(SELECT conversation_id FROM piclaw_durable_bindings_v1 WHERE source_id='scheduler-main-seed') ORDER BY id").all())).toBe(before);
        if (!delivered.at(-1)) throw Error(JSON.stringify(root.query("SELECT * FROM task_run_logs WHERE task_id=?").all(id)));
        expect(delivered.at(-1)).toBe("factory synthetic reply");
      }
      if (definitionScheduler) {
        expect(delivered).toEqual(["factory synthetic reply"]);
        expect(calls).toBe(1);
        expect(root.query("SELECT prompt,revision,status,next_run FROM scheduled_tasks WHERE id='native-schedule-0'").get())
          .toEqual({ prompt: "scheduled real consumer", revision: 1, status: "completed", next_run: null });
        const definitions = root.query("SELECT * FROM host_scheduled_task_definitions ORDER BY task_id,revision").all();
        const revisions = root.query("SELECT * FROM service_effect_s07_task_revisions ORDER BY task_id,revision").all();
        prohibited.forEach(spy => expect(spy).not.toHaveBeenCalled());
        sdkSpies.forEach(spy => expect(spy).not.toHaveBeenCalled());
        await channel.stop(); await base.queue.shutdown(); await pool.shutdown(); backend.stop(); await backend.close();
        closeDatabase(); initDatabase(); root = getDb();
        backend = await createDefaultApplicationRuntime(owner, async () => services);
        expect(root.query("SELECT * FROM host_scheduled_task_definitions ORDER BY task_id,revision").all()).toEqual(definitions);
        expect(root.query("SELECT * FROM service_effect_s07_task_revisions ORDER BY task_id,revision").all()).toEqual(revisions);
        expect(root.query("SELECT prompt,status,next_run FROM scheduled_tasks WHERE id='native-schedule-0'").get())
          .toEqual({ prompt: "scheduled real consumer", status: "completed", next_run: null });
        expect(calls).toBe(1); // Cold reopen never resubmits the completed occurrence.
        return;
      }
      expect(delivered).toHaveLength(3);
    if (scheduledAccounting) {
      expect(root.query("SELECT r.state, COUNT(*) AS n FROM budget_request_reservations r JOIN budget_work w ON w.id=r.work_id WHERE w.execution_kind='scheduled' GROUP BY r.state").all()).toEqual([{ state: "settled", n: 3 }]);
      expect(root.query("SELECT COUNT(*) AS n FROM budget_work WHERE parent_work_id IS NULL AND execution_kind='scheduled' AND scheduled_task_id LIKE 'native-schedule-%' AND status='completed'").get()).toEqual({ n: 3 });
      expect(root.query("SELECT COUNT(*) AS n FROM budget_work WHERE parent_work_id IS NOT NULL AND execution_kind='scheduled' AND status='completed'").get()).toEqual({ n: 3 });
      expect(root.query("SELECT SUM(t.api_equivalent_cost_microusd) AS amount FROM token_usage t JOIN budget_work w ON w.id=t.work_id WHERE t.invocation_id IS NOT NULL AND w.execution_kind='scheduled'").get()).toEqual({ amount: 30 });
      await channel.stop(); await base.queue.shutdown(); await pool.shutdown(); backend.stop(); await backend.close();
      for (const spy of [...captureSpies, ...sdkSpies]) spy.mockRestore();
      closeDatabase(); owner.release(); return;
    }
      expect(root.query("SELECT COUNT(*) AS n FROM task_run_logs WHERE task_id LIKE 'native-schedule-%' AND status='success'").get()).toEqual({ n: 3 });
      for (const [index, label] of ["unknown/model", "synthetic/", "synthetic", "/approved", "synthetic/virtual"].entries()) {
        const due = new Date(Date.now() - 1000).toISOString(), id = `native-model-denied-${index}`;
        const beforeCalls = calls, beforeForks = root.query("SELECT COUNT(*) AS n FROM conversations").get();
        createTask({ id, chat_jid: "web:default", model: label, prompt: "must not dispatch", schedule_type: "once", schedule_value: due, next_run: due, status: "active", notify_on_complete: false, created_at: due });
        await pollScheduledRunsOnce({ queue: base.queue, agentPool: pool, sendMessage: async () => {} }, scheduledStore.value);
        const deadline = Date.now() + 5000;
        while (!root.query("SELECT 1 FROM task_run_logs WHERE task_id=?").get(id) && Date.now() < deadline) await Bun.sleep(10);
        expect(root.query("SELECT status FROM task_run_logs WHERE task_id=?").get(id)).toEqual({ status: "error" });
        expect(calls).toBe(beforeCalls);
        expect(root.query("SELECT COUNT(*) AS n FROM conversations").get()).toEqual(beforeForks);
      }
      // Exercise the actual scheduler/AgentPool consumer, not a budget stub.
      // Even a positive allowance is unqualified without per-request binding.
      for (const [index, amount] of [0, 1_000_000].entries()) {
        const due = new Date(Date.now() - 1000).toISOString(), id = `native-budget-denied-${index}`;
        const cap = saveBudgetCap({ scope: "scheduled_run", metric: "api_usd_micros", amount, scheduledTaskId: id }, root);
        const beforeCalls = calls, beforeForks = root.query("SELECT COUNT(*) AS n FROM conversations").get();
        createTask({ id, chat_jid: "web:default", prompt: "must not dispatch", schedule_type: "once", schedule_value: due, next_run: due, status: "active", notify_on_complete: false, created_at: due });
        await pollScheduledRunsOnce({ queue: base.queue, agentPool: pool, sendMessage: async (_chat, text) => { delivered.push(text); } }, scheduledStore.value);
        const deadline = Date.now() + 5000;
        while (!root.query("SELECT 1 FROM task_run_logs WHERE task_id=?").get(id) && Date.now() < deadline) await Bun.sleep(10);
        expect(root.query("SELECT status,error FROM task_run_logs WHERE task_id=?").get(id)).toEqual({ status: "error", error: "Native scheduled budget admission unavailable" });
        expect(calls).toBe(beforeCalls);
        expect(root.query("SELECT COUNT(*) AS n FROM conversations").get()).toEqual(beforeForks);
        expect(delivered).toHaveLength(3);
        setBudgetCapEnabled(cap.id, false, root);
      }
      // Enable a real cap after the first admitted provider effect. Neither the
      // returned write nor the next provider request may use the stale grant.
      const midrunId = "native-budget-midrun", target = join(workspace, "scheduled-budget-must-not-write.txt");
      const cap = saveBudgetCap({ scope: "scheduled_run", metric: "api_usd_micros", amount: 1_000_000, scheduledTaskId: midrunId }, root);
      setBudgetCapEnabled(cap.id, false, root);
      toolSequence = [{ name: "write", arguments: { path: target, content: "forbidden" } }];
      const beforeMidrun = calls;
      onProviderResponse = () => { onProviderResponse = undefined; setBudgetCapEnabled(cap.id, true, root); };
      const due = new Date(Date.now() - 1000).toISOString();
      createTask({ id: midrunId, chat_jid: "web:default", prompt: "write then reply", schedule_type: "once", schedule_value: due, next_run: due, status: "active", notify_on_complete: false, created_at: due });
      await pollScheduledRunsOnce({ queue: base.queue, agentPool: pool, sendMessage: async (_chat, text) => { delivered.push(text); } }, scheduledStore.value);
      const deadline = Date.now() + 5000;
      while (!root.query("SELECT 1 FROM task_run_logs WHERE task_id=?").get(midrunId) && Date.now() < deadline) await Bun.sleep(10);
      expect(calls).toBe(beforeMidrun + 1);
      expect(existsSync(target)).toBe(false);
      expect(delivered).toHaveLength(3);
      expect(root.query("SELECT status FROM task_run_logs WHERE task_id=?").get(midrunId)).toEqual({ status: "error" });
      setBudgetCapEnabled(cap.id, false, root);
      // Credential resolution awaits after source capture: the post-auth fence
      // must reject a newly enabled cap before the synthetic provider is called.
      const credentialId = "native-budget-credentials";
      const credentialCap = saveBudgetCap({ scope: "scheduled_run", metric: "api_usd_micros", amount: 1_000_000, scheduledTaskId: credentialId }, root);
      setBudgetCapEnabled(credentialCap.id, false, root);
      let credentialBarrierHit = false;
      onCredentialResolve = async () => {
        onCredentialResolve = undefined;
        await Bun.sleep(0);
        credentialBarrierHit = true;
        setBudgetCapEnabled(credentialCap.id, true, root);
      };
      const beforeCredentials = calls, credentialDue = new Date(Date.now() - 1000).toISOString();
      createTask({ id: credentialId, chat_jid: "web:default", prompt: "must not send after auth", schedule_type: "once", schedule_value: credentialDue, next_run: credentialDue, status: "active", notify_on_complete: false, created_at: credentialDue });
      await pollScheduledRunsOnce({ queue: base.queue, agentPool: pool, sendMessage: async (_chat, text) => { delivered.push(text); } }, scheduledStore.value);
      const credentialDeadline = Date.now() + 5000;
      while (!root.query("SELECT 1 FROM task_run_logs WHERE task_id=?").get(credentialId) && Date.now() < credentialDeadline) await Bun.sleep(10);
      expect(credentialBarrierHit).toBe(true);
      expect(calls).toBe(beforeCredentials);
      expect(delivered).toHaveLength(3);
      expect(root.query("SELECT status FROM task_run_logs WHERE task_id=?").get(credentialId)).toEqual({ status: "error" });
      setBudgetCapEnabled(credentialCap.id, false, root);
      // Only the ordinary seed message publishes through EF-S02; scheduled delivery
      // belongs to EF-S07 and must not create a second timeline answer.
      expect(root.query("SELECT COUNT(*) AS n FROM messages WHERE is_bot_message=1").get()).toEqual({ n: 1 });
      await channel.stop(); await base.queue.shutdown(); await pool.shutdown(); backend.stop(); await backend.close();
      backend = await createDefaultApplicationRuntime(owner, async () => services);
      const reopenedBase = createRuntimeBaseServices({ dataDir: workspace });
      const reopenedPool = new AgentPool({ credentialStore, modelRuntime: runtime, modelRegistry, ...backend.sessionOptions });
      const reopened = backend.bind({ queue: reopenedBase.queue, agentPool: reopenedPool });
      try {
        const message = { id: "scheduler-after-reopen", chat_jid: "web:default", sender: "user", sender_name: "User", content: "ordinary message after scheduled forks", timestamp: new Date().toISOString(), is_from_me: false, is_bot_message: false };
        const row = root.transaction(() => { const id = storeMessage(message); const admit = reopened.getInputSourceAdmission!(message.chat_jid); assert(admit); admit({ message, rowId: id, database: root }); return id; })();
        expect(await reopened.dispatchAcceptedInput!(message.chat_jid, message.id, row!)!()).toBe("settled");
        expect(root.query("SELECT COUNT(*) AS n FROM messages WHERE is_bot_message=1").get()).toEqual({ n: 2 });
        expect(requested.at(-1)).toBe(model.id);
        expect(await backend.sessionOptions.getDurableSession!("web:default")!.readModel!()).toBe(`${model.provider}/${model.id}`);
      } finally { await reopenedBase.queue.shutdown(); await reopenedPool.shutdown(); }
      prohibited.forEach(spy => expect(spy).not.toHaveBeenCalled());
      sdkSpies.forEach(spy => expect(spy).not.toHaveBeenCalled());
    } finally {
      stopSchedulerLoop(); prohibited.forEach(spy => spy.mockRestore());
      await channel.stop(); await base.queue.shutdown(); await pool.shutdown(); backend.stop(); await backend.close();
      sdkSpies.forEach(spy => spy.mockRestore()); owner.release(); closeDatabase();
    }
    return;
  }
  const assertContext = async (contextWindow: number, empty = false) => {
    const before = calls;
    const native = await first!.readContextUsage!();
    expect(native.contextWindow).toBe(contextWindow);
    expect(native.tokens).toBeNumber();
    expect(native.tokens!).toBeGreaterThanOrEqual(0);
    if (empty) expect(native.tokens).toBe(0);
    root.query("INSERT INTO router_state(key,value) VALUES('last_agent_timestamp_web',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(JSON.stringify({contextUsages:{'web:default':{tokens:999,contextWindow:10000,percent:9.99,sessionGeneration:first!.sessionId}}}));
    const response = await channel.handleRequest(new Request("http://fixture/agent/context?chat_jid=web%3Adefault"));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ tokens: native.tokens, contextWindow,
      percent: native.tokens! / contextWindow * 100, sessionGeneration: first!.sessionId });
    expect(calls).toBe(before);
    expect(sdkSpies.every(spy => spy.mock.calls.length === 0)).toBe(true);
  };
  await assertContext(100000, true);
  await expect(pool.getContextUsageForChat("web:unbound-context")).rejects.toThrow("Durable application does not construct legacy sessions");
  expect(() => bound.getInputSourceAdmission!("web:newcomer")).toThrow("Unbound");
  const message = { id: "factory-input", chat_jid: "web:default", sender: "user", sender_name: "User", content: "hello factory", timestamp: new Date().toISOString(), is_from_me: false, is_bot_message: false };
  if (lateUnaccounted) {
    try {
      const row = root.transaction(() => { const id = storeMessage(message); bound.getInputSourceAdmission!(message.chat_jid)!({ message, rowId: id, database: root }); return id; })();
      expect(await bound.dispatchAcceptedInput!(message.chat_jid, message.id, row)!()).toBe('pending');
      expect(lateSibling).toBeDefined(); expect(calls).toBe(0);
      const held = root.query('SELECT * FROM budget_request_reservations').get() as BudgetRequestReservation;
      expect(held.id).toBe(lateSibling!.id); expect(held.state).toBe('dispatched'); expect(held.terminal_receipt_json).not.toBeNull();
      expect(root.query('SELECT * FROM service_effect_s02_commits').all()).toEqual([]);
      expect(root.query("SELECT state FROM service_effect_s01_sources WHERE source_id='factory-input'").get()).toEqual({ state: 'claimed' });
      const tasks = root.query('SELECT * FROM tasks ORDER BY id').all();
      onCredentialResolve = undefined; await lateSibling!.settle();
      expect(await bound.dispatchAcceptedInput!(message.chat_jid, message.id, row)!()).toBe('settled');
      expect(calls).toBe(0); expect(root.query('SELECT * FROM tasks ORDER BY id').all()).toEqual(tasks);
      expect(root.query('SELECT count(*) n FROM token_usage').get()).toEqual({ n: 1 });
    } finally {
      await channel.stop(); await base.queue.shutdown(); await pool.shutdown(); backend.stop(); await backend.close();
      sdkSpies.forEach(spy => spy.mockRestore()); owner.release(); closeDatabase();
    }
    return;
  }
  if (nativeInfrastructure) {
    const denyHttp = () => { throw Error("Infrastructure proof must not use HTTP"); };
    const noHttp = spyOn(globalThis, "fetch").mockImplementation(Object.assign(denyHttp, { preconnect: denyHttp }));
    try {
      const row = root.transaction(() => {
        const rowId = storeMessage(message);
        const admit = bound.getInputSourceAdmission!(message.chat_jid); assert(admit);
        admit({ message, rowId, database: root }); return rowId;
      })();
      expect(await bound.dispatchAcceptedInput!(message.chat_jid, message.id, row!)!()).toBe("settled");
      expect(toolSequence).toEqual([]);
      expect(calls).toBe(2);
      // Policy and skill assertions exercise the actual public model request,
      // not callbacks loaded into a standalone component harness.
      for (const [kind, getter] of [["proxmox", "getProxmoxPrompt"], ["portainer", "getPortainerPrompt"]]) {
        const pkg = join(workspace, ".pi/extensions/node_modules/@rcarmo/piclaw-addon-" + kind);
        const native = await import(join(pkg, "index.ts"));
        expect(planRequests[0]).toContain(JSON.stringify(native[getter!]()).slice(1, -1));
        expect(planRequests[0]).toContain(kind + "-");
      }
      for (const name of ["proxmox", "portainer", "imap"]) {
        const result = [...observedResults.values()].find(value => value.toolName === name);
        expect(result).toBeDefined(); if (name !== "imap") assert(result!.isError !== true, JSON.stringify(result));
      }
      expect(JSON.stringify([...observedResults.values()])).toContain("contract");
      expect(JSON.stringify([...observedResults.values()])).toContain("capabilities");
      expect(root.query("SELECT state FROM service_effect_s01_sources WHERE source_id=?").get(message.id)).toEqual({ state: "consumed" });
      expect(root.query("SELECT phase, terminal_disposition FROM service_effect_s01_operations WHERE chat_jid=?").all(message.chat_jid)).toEqual([{ phase: "terminal", terminal_disposition: "completed" }]);
      const messages = JSON.stringify(root.query("SELECT * FROM messages").all());
      expect(messages).toContain("hello factory"); expect(messages).toContain("factory synthetic reply");
      expect(noHttp).not.toHaveBeenCalled();
      const identity = first!.sessionId;
      await channel.stop(); await base.queue.shutdown(); await pool.shutdown(); backend.stop(); await backend.close();
      backend = await createDefaultApplicationRuntime(owner, async () => services);
      expect(backend.sessionOptions.getDurableSession!("web:default")!.sessionId).toBe(identity);
      owner.assertCurrentOwner();
      const imapResult = [...observedResults.values()].find(value => value.toolName === "imap")!;
      assert(imapResult.isError !== true, JSON.stringify(imapResult));
      backend.stop(); await backend.close();
      for (const spy of sdkSpies) { expect(spy).not.toHaveBeenCalled(); spy.mockRestore(); }
    } finally {
      await channel.stop(); await base.queue.shutdown(); await pool.shutdown(); backend.stop(); await backend.close();
      noHttp.mockRestore(); closeDatabase(); owner.release();
    }
    return;
  }
  if (reviewPackage) {
    const api = await import(join(reviewPackage, "runtime.ts"));
    const service = api.reviewService();
    expect(service.database.db).toBe(root);
    const { handleRegisteredAddonConfigApiRequest } = await import("../../runtime/src/channels/web/handlers/addon-config-api.js");
    let review: any, thread: any;
    writeFileSync(join(workspace, "review-source.ts"), "const saved = true;\n");
    const invoke = async (body: unknown) => {
      const request = new Request("http://fixture/agent/addons/api/code-review/action", {method:"POST",body:JSON.stringify(body)});
      admitAddonLocalRequest(request, {userId:"default",mode:"single-user"} as any, () => !request.signal.aborted);
      const response = await handleRegisteredAddonConfigApiRequest(request,"code-review","action",(body,status=200)=>Response.json(body,{status}));
      expect(response).not.toBeNull();
      const receipt = await response!.json() as {ok:boolean;result:any};
      expect(receipt.ok, JSON.stringify(receipt)).toBe(true); return receipt.result;
    };
    review = await invoke({ action: "create", path: "review-source.ts", title: "Native review", target: { chatId: "web:default" }, requestId: "review-create" });
    thread = await invoke({ action: "comment", reviewId: review.reviewId, fileId: review.files[0], side: "source", body: "NATIVE_SAVED_REVIEW_THREAD", requestId: "review-comment" });
    const target = { chatId: "web:default", incarnation: first!.branchId, label: "Default" };
    const who = { ownerId: "default", actorId: "default", kind: "operator", workspaceId: createHash("sha256").update(workspace).digest("hex") };
    const submitted = service.submit(who, review.reviewId, { target, items: [{ threadId: thread.threadId, version: 1 }] }, { requestId: "review-send" });
    let row!: number;
    await service.deliver(who, submitted.dispatchId, { async enqueue(input: any) {
      message.content = input.content;
      await withAddonLocalDispatch({ chatJid: target.chatId, incarnation: target.incarnation }, input.content, input.reference, async () => {
        const req = new Request("http://fixture/internal"); bindAddonLocalDispatchRequest(req, target.chatId, input.content);
        const marked = { ...message, content_blocks: [getAddonLocalDispatchBlock(req, target.chatId, input.content)!] };
        row = await admitSqliteWrite(root, () => { const id = storeMessage(marked); bindAddonLocalMessage(target.chatId, marked, root); const admit = bound.getInputSourceAdmission!(target.chatId); assert(admit); admit({ message: marked, rowId: id, database: root }); return id; });
        expect((await verifyAddonLocalMessage(target.chatId, marked))?.reference?.intentId).toBe(submitted.dispatchId);
      });
      return { status: "accepted", rowId: row };
    } });
    storeChatMetadata("web:review-other", new Date().toISOString());
    await bound.prepareInputSourceAdmission!("web:review-other");
    const otherTarget = { chatId: "web:review-other", incarnation: backend.sessionOptions.getDurableSession!("web:review-other")!.branchId, label: "Other" };
    const secret = "SECRET_OTHER_CHAT_REVIEW";
    const otherReview = service.createFromCapture(who, { title: "Other review", focusPath: "other.ts", target: otherTarget }, {
      workspaceId: who.workspaceId, worktreeId: "other-tree", mode: "source", base: null, head: null, capturedAt: new Date().toISOString(),
      files: [{ oldPath: null, newPath: "other.ts", oldText: null, newText: secret, change: "source", fileIdentity: "other-inode" }],
    }, { requestId: "other-create" });
    const otherThread = service.createThread(who, otherReview.reviewId, { fileId: otherReview.files[0], side: "source", body: secret }, { requestId: "other-comment" });
    const otherDispatch = service.submit(who, otherReview.reviewId, { target: otherTarget, items: [{ threadId: otherThread.threadId, version: 1 }] }, { requestId: "other-send" });
    expect(service.inspectDispatch(who, otherDispatch.dispatchId)).toBeDefined();
    if (codemodeReview) {
      const beforeThread = service.getThread(who, thread.threadId);
      const beforeOther = service.getThread(who, otherThread.threadId);
      const beforeDispatch = service.inspectDispatch(who, submitted.dispatchId);
      const beforeKv = root.query("SELECT * FROM extension_kv").all();
      const captureTool = HostConversationRuntime.prototype.captureToolSource;
      captureSpies.push(spyOn(HostConversationRuntime.prototype, "captureToolSource").mockImplementation(async function (this: HostConversationRuntime, ...args) {
        const captured = await captureTool.apply(this, args);
        expect(captured.inputs[0]?.sourceId).toBe(message.id);
        expect(captured.operation.chatJid).toBe(target.chatId);
        expect(captured.operation.harness).toBeDefined();
        if (args[2].includes("/")) {
          codemodeNestedCaptures++;
          if (codemodeReviewCancelled) root.query("UPDATE service_effect_s01_operations SET phase='cancelling' WHERE operation_id=?").run(captured.operation.operationId);
        }
        return captured;
      }));
      const reply: JsonObject = { action: "reply", threadId: thread.threadId, body: "NATIVE_CODEMODE_REPLY", requestId: "native-codemode-reply", expectedVersion: beforeThread.version, assignmentEpoch: beforeThread.assignment_epoch };
      const ownRead = JSON.stringify({ action: "thread", threadId: thread.threadId });
      const otherRead = JSON.stringify({ action: "thread", threadId: otherThread.threadId });
      toolSequence = [{ name: "codemode", arguments: { code: codemodeReviewCancelled
        ? `try { await tools.code_review(${JSON.stringify(reply)}); } catch {} store("revoked-review", {secret:"MUST_NOT_PERSIST"}); console.log("done");`
        : `const thread = await tools.code_review(${ownRead}); const reply = await tools.code_review(${JSON.stringify(reply)}); let denied = false; try { await tools.code_review(${otherRead}); } catch { denied = true; } console.log({thread:JSON.parse(thread).messages.map(m=>m.body),reply:JSON.parse(reply),denied});` } }];
      try {
        expect(await bound.dispatchAcceptedInput!(message.chat_jid, message.id, row)!()).toBe("settled");
        if (codemodeReviewCancelled) assertFailedTurn();
        expect(calls).toBe(codemodeReviewCancelled ? 1 : 2);
        expect(toolSequence).toEqual([]);
        expect(codemodeNestedCaptures).toBe(codemodeReviewCancelled ? 1 : 3);
        expect(service.getThread(who, otherThread.threadId)).toEqual(beforeOther);
        expect(root.query("SELECT * FROM extension_kv").all()).toEqual(beforeKv);
        expect(readFileSync(join(workspace, "review-source.ts"), "utf8")).toBe("const saved = true;\n");
        expect(existsSync(join(workspace, "codemode-forbidden.txt"))).toBe(false);
        if (codemodeReviewCancelled) {
          expect(service.getThread(who, thread.threadId)).toEqual(beforeThread);
          expect(service.getThread(who, thread.threadId).messages).toHaveLength(1);
          expect(service.inspectDispatch(who, submitted.dispatchId)).toEqual(beforeDispatch);
          expect(root.query("SELECT * FROM service_effect_s02_commits").all()).toHaveLength(1);
          expect(root.query("SELECT state FROM service_effect_s01_sources WHERE source_id='factory-input'").get()).toEqual({ state: "consumed" });
          assertFailedTurn();
          expect(root.query("SELECT id FROM messages WHERE is_bot_message=1").all()).toHaveLength(1);
          expect(observedResults.size).toBe(0);
        } else {
          const result = observedResults.get("factory-tool-1");
          expect(result).toMatchObject({ toolName: "codemode" });
          expect(result?.isError, JSON.stringify(result)).not.toBe(true);
          expect(JSON.stringify(result)).toContain("NATIVE_SAVED_REVIEW_THREAD");
          expect(JSON.stringify(result)).toContain('\\"version\\":2');
          expect(JSON.stringify(result)).toContain('\\"denied\\":true');
          expect(service.getThread(who, thread.threadId).messages).toHaveLength(2);
          expect(JSON.stringify(service.getThread(who, thread.threadId).messages)).toContain("NATIVE_CODEMODE_REPLY");
          expect(root.query("SELECT state FROM service_effect_s01_sources WHERE source_id='factory-input'").get()).toEqual({ state: "consumed" });
          expect(root.query("SELECT id FROM messages WHERE is_bot_message=1").all()).toHaveLength(1);
        }
        const storeRevisions = root.query(`SELECT r.content FROM document_revisions r JOIN documents d ON d.id=r.document_id WHERE d.kind='"pi.codemode.store"'`).all();
        expect(JSON.stringify(storeRevisions)).not.toContain("revoked-review");
        expect(JSON.stringify(storeRevisions)).not.toContain("MUST_NOT_PERSIST");
        for (const text of [JSON.stringify([...observedResults.values()]), JSON.stringify(root.query("SELECT * FROM entries").all()), planRequests.join("\n"), JSON.stringify(root.query("SELECT content FROM messages WHERE is_bot_message=1").all())]) expect(text).not.toContain(secret);
        expect(sdkSpies.every(spy => spy.mock.calls.length === 0)).toBe(true);
      } finally {
        await channel.stop(); await base.queue.shutdown(); await pool.shutdown(); backend.stop(); await backend.close();
        for (const spy of [...captureSpies, ...sdkSpies]) spy.mockRestore();
        owner.release(); closeDatabase();
      }
      return;
    }
    const workBody = () => ({ action: "work", dispatchId: submitted.dispatchId, threadId: thread.threadId, state: "in_progress", itemVersion: service.inspectDispatch(who, submitted.dispatchId).items[0].version, threadVersion: service.getThread(who, thread.threadId).version, assignmentEpoch: service.getThread(who, thread.threadId).assignment_epoch });
    toolSequence = [
      { name: "code_review", arguments: { action: "thread", threadId: thread.threadId } },
      { name: "code_review", arguments: { action: "thread", threadId: otherThread.threadId } },
      { name: "code_review", arguments: { action: "reply", threadId: thread.threadId, body: "NATIVE_REPLY", requestId: "native-reply", expectedVersion: 1, assignmentEpoch: service.getThread(who, thread.threadId).assignment_epoch } },
      { name: "code_review", arguments: { action: "reply", threadId: thread.threadId, body: "NATIVE_REPLY", requestId: "native-reply", expectedVersion: 1, assignmentEpoch: service.getThread(who, thread.threadId).assignment_epoch } },
      { name: "code_review", arguments: { action: "reply", threadId: thread.threadId, body: "STALE_MUST_NOT_WRITE", requestId: "native-stale", expectedVersion: 1, assignmentEpoch: service.getThread(who, thread.threadId).assignment_epoch } },
      { name: "code_review", arguments: { action: "reply", threadId: otherThread.threadId, body: "CROSS_CHAT_MUST_NOT_WRITE", requestId: "native-cross", expectedVersion: 1, assignmentEpoch: service.getThread(who, otherThread.threadId).assignment_epoch } },
      { name: "code_review", arguments: () => ({ action: "edit", messageId: service.getThread(who, thread.threadId).messages.at(-1).id, body: "NATIVE_EDIT", requestId: "native-edit", expectedVersion: 1, assignmentEpoch: service.getThread(who, thread.threadId).assignment_epoch }) },
      { name: "code_review", arguments: () => ({ action: "deleteMessage", messageId: service.getThread(who, thread.threadId).messages.at(-1).id, confirm: true, requestId: "native-delete", expectedVersion: 2, assignmentEpoch: service.getThread(who, thread.threadId).assignment_epoch }) },
      { name: "code_review", arguments: () => ({ ...workBody(), requestId: "native-progress" }) },
      { name: "code_review", arguments: () => {
        expect(service.inspectDispatch(who, submitted.dispatchId).items[0].work_state).toBe("in_progress");
        return { ...workBody(), itemVersion: 1, requestId: "native-work-stale" };
      } },
      { name: "code_review", arguments: () => ({ ...workBody(), dispatchId: otherDispatch.dispatchId, threadId: otherThread.threadId, requestId: "native-work-cross" }) },
      { name: "code_review", arguments: () => ({ action: "resolve", threadId: thread.threadId, fileId: review.files[0], explanation: "NATIVE_RESOLUTION", evidence: ["local test"], requestId: "native-resolve", expectedVersion: service.getThread(who, thread.threadId).version, assignmentEpoch: service.getThread(who, thread.threadId).assignment_epoch }) },
      { name: "code_review", arguments: () => ({ action: "work", dispatchId: submitted.dispatchId, threadId: thread.threadId, state: "completed", itemVersion: service.inspectDispatch(who, submitted.dispatchId).items[0].version, threadVersion: service.getThread(who, thread.threadId).version, assignmentEpoch: service.getThread(who, thread.threadId).assignment_epoch, requestId: "native-completed" }) },
    ];
    expect(await bound.dispatchAcceptedInput!(message.chat_jid, message.id, row)!()).toBe("settled");
    expect(observedResults.get("factory-tool-1")).toMatchObject({ toolName: "code_review" });
    expect(JSON.stringify(observedResults.get("factory-tool-1"))).toContain("NATIVE_SAVED_REVIEW_THREAD");
    expect(observedResults.get("factory-tool-2")).toMatchObject({ isError: true });
    expect(JSON.stringify(observedResults.get("factory-tool-2"))).not.toContain(secret);
    for (const id of [3, 4, 7, 8, 9, 12, 13]) expect(observedResults.get(`factory-tool-${id}`)?.isError).not.toBe(true);
    expect(observedResults.get("factory-tool-3")?.content).toEqual(observedResults.get("factory-tool-4")?.content);
    for (const id of [5, 6, 10, 11]) expect(observedResults.get(`factory-tool-${id}`)).toMatchObject({ isError: true });
    expect(service.inspectDispatch(who, submitted.dispatchId).items[0].work_state).toBe("completed");
    expect(JSON.stringify(observedResults.get("factory-tool-11"))).not.toContain(secret);
    expect(service.getThread(who, thread.threadId)).toMatchObject({ state: "resolved", version: 5 });
    expect(service.getThread(who, thread.threadId).messages).toHaveLength(3);
    expect(JSON.stringify(service.getThread(who, thread.threadId).messages)).not.toContain("MUST_NOT_WRITE");
    expect(service.getThread(who, otherThread.threadId).messages).toHaveLength(1);
    for (const text of [JSON.stringify(root.query("SELECT * FROM entries").all()), planRequests.join("\n"), JSON.stringify(root.query("SELECT content FROM messages WHERE is_bot_message=1").all())]) {
      expect(text).not.toContain(secret);
    }
    await channel.stop(); await base.queue.shutdown(); await pool.shutdown(); backend.stop(); await backend.close();
    expect(() => service.database.get("SELECT 1")).toThrow("closed");
    const oldRoot = root;
    const pragmas = ["foreign_keys", "journal_mode"].map(name => root.query(`PRAGMA ${name}`).get());
    closeDatabase(); initDatabase(); root = getDb();
    expect(root).not.toBe(oldRoot);
    expect(() => oldRoot.query("SELECT 1").get()).toThrow();
    backend = await createDefaultApplicationRuntime(owner, async () => services);
    const reopenedService = api.reviewService();
    expect(reopenedService).not.toBe(service);
    expect(reopenedService.database.db).toBe(root);
    expect(reopenedService.inspectDispatch(who, submitted.dispatchId).items[0].work_state).toBe("completed");
    expect(reopenedService.getThread(who, thread.threadId).messages).toHaveLength(3);
    expect(["foreign_keys", "journal_mode"].map(name => root.query(`PRAGMA ${name}`).get())).toEqual(pragmas);
    const reopenedBase = createRuntimeBaseServices({ dataDir: workspace });
    const reopenedPool = new AgentPool({ credentialStore, modelRuntime: runtime, modelRegistry, ...backend.sessionOptions });
    const reopened = backend.bind({ queue: reopenedBase.queue, agentPool: reopenedPool });
    const reopenedChannel = new WebChannel(reopened); reopenedChannel.broadcastEvent = () => {};
    try {
      const freshReview = reopenedService.createFromCapture(who, { title: "Reopened review", focusPath: "fresh.ts", target }, {
        workspaceId: who.workspaceId, worktreeId: "fresh-tree", mode: "source", base: null, head: null, capturedAt: new Date().toISOString(),
        files: [{ oldPath: null, newPath: "fresh.ts", oldText: null, newText: "fresh saved\n", change: "source", fileIdentity: "fresh-inode" }],
      }, { requestId: "fresh-create" });
      const freshThread = reopenedService.createThread(who, freshReview.reviewId, { fileId: freshReview.files[0], side: "source", body: "NATIVE_REOPENED_THREAD" }, { requestId: "fresh-comment" });
      const freshDispatch = reopenedService.submit(who, freshReview.reviewId, { target, items: [{ threadId: freshThread.threadId, version: 1 }] }, { requestId: "fresh-send" });
      const freshMessage = { ...message, id: "factory-review-reopened" };
      let freshRow!: number;
      await reopenedService.deliver(who, freshDispatch.dispatchId, { async enqueue(input: any) {
        freshMessage.content = input.content;
        await withAddonLocalDispatch({ chatJid: target.chatId, incarnation: target.incarnation }, input.content, input.reference, async () => {
          const req = new Request("http://fixture/internal"); bindAddonLocalDispatchRequest(req, target.chatId, input.content);
          const marked = { ...freshMessage, content_blocks: [getAddonLocalDispatchBlock(req, target.chatId, input.content)!] };
          freshRow = await admitSqliteWrite(root, () => { const id = storeMessage(marked); bindAddonLocalMessage(target.chatId, marked, root); const admit = reopened.getInputSourceAdmission!(target.chatId); assert(admit); admit({ message: marked, rowId: id, database: root }); return id; });
          expect((await verifyAddonLocalMessage(target.chatId, marked))?.reference?.intentId).toBe(freshDispatch.dispatchId);
        });
        return { status: "accepted", rowId: freshRow };
      } });
      observedResults.clear();
      toolSequence = [{ name: "code_review", arguments: { action: "thread", threadId: freshThread.threadId } }];
      expect(await reopened.dispatchAcceptedInput!(target.chatId, freshMessage.id, freshRow)!()).toBe("settled");
      expect([...observedResults.values()].some(result => result.toolName === "code_review" && !result.isError && JSON.stringify(result.content).includes("NATIVE_REOPENED_THREAD"))).toBe(true);
      expect(reopenedService.getThread(who, thread.threadId).messages).toHaveLength(3);
      expect(Array.from(new Bun.Glob("**/reviews.db").scanSync({ cwd: workspace, dot: true, onlyFiles: true }))).toEqual([]);
    } finally {
      await reopenedChannel.stop(); await reopenedBase.queue.shutdown(); await reopenedPool.shutdown(); backend.stop(); await backend.close();
    }
    expect(sdkSpies.every(spy => spy.mock.calls.length === 0)).toBe(true);
    sdkSpies.forEach(spy => spy.mockRestore()); owner.release(); closeDatabase(); return;
  }
  if (nativeTable && tableChat !== "web:default") {
    storeChatMetadata(tableChat, new Date().toISOString());
    await bound.prepareInputSourceAdmission!(tableChat);
    if (scenario === "native-editable-table-branch") root.query("UPDATE chat_branches SET root_chat_jid='web:default', parent_branch_id=? WHERE chat_jid=?").run(first!.branchId, tableChat);
    message.chat_jid = tableChat;
  }
  if (scenario === "public-admission-row-mismatch") {
    const admission = bound.getInputSourceAdmission!(message.chat_jid)!;
    const bytes = root.serialize();
    for (const kind of ["other-message", "bot", "absent"] as const) {
      expect(() => root.transaction(() => {
        const rowId = kind === "absent" ? 999999 : storeMessage({ ...message, id: kind === "other-message" ? "other-row-id" : message.id, is_bot_message: kind === "bot" });
        admission({ message, rowId, database: root });
      })()).toThrow("Input admission message row mismatch");
      expect(root.serialize()).toEqual(bytes);
    }
    expect(root.query("SELECT source_id FROM service_effect_s01_sources WHERE source_id=?").get(message.id)).toBeNull();
    expect(calls).toBe(0);
    backend.stop(); await backend.close();
    for (const spy of [...captureSpies, ...sdkSpies]) spy.mockRestore();
    closeDatabase(); owner.release(); return;
  }
  if (scenario === "public-admission-chat-mismatch") {
    const otherChat = "web:wrong-admission";
    storeChatMetadata(otherChat, new Date().toISOString());
    await bound.prepareInputSourceAdmission!(otherChat);
    const admission = bound.getInputSourceAdmission!(message.chat_jid)!;
    const bytes = root.serialize();
    expect(() => root.transaction(() => {
      const wrong = { ...message, chat_jid: otherChat };
      const rowId = storeMessage(wrong);
      admission({ message: wrong, rowId, database: root });
    })()).toThrow("Input admission chat mismatch");
    expect(root.serialize()).toEqual(bytes);
    expect(root.query("SELECT source_id FROM service_effect_s01_sources WHERE source_id=?").get(message.id)).toBeNull();
    expect(calls).toBe(0);
    backend.stop(); await backend.close();
    for (const spy of [...captureSpies, ...sdkSpies]) spy.mockRestore();
    closeDatabase(); owner.release(); return;
  }
  if (scenario === "public-archived-admission") {
    const archivedChat = "web:archive-admission";
    storeChatMetadata(archivedChat, new Date().toISOString());
    await bound.prepareInputSourceAdmission!(archivedChat);
    message.chat_jid = archivedChat;
    const admission = bound.getInputSourceAdmission!(message.chat_jid)!;
    expect(admission).toBeDefined();
    root.query("UPDATE chat_branches SET archived_at=? WHERE chat_jid=?").run(new Date().toISOString(), message.chat_jid);
    const bytes = root.serialize();
    expect(() => root.transaction(() => {
      const rowId = storeMessage(message);
      admission({ message, rowId, database: root });
    })()).toThrow("Unbound application conversation");
    expect(root.serialize()).toEqual(bytes);
    expect(() => bound.getInputSourceAdmission!(message.chat_jid)).toThrow("Unbound application conversation");
    expect(root.query("SELECT id FROM messages WHERE id=?").get(message.id)).toBeNull();
    expect(root.query("SELECT source_id FROM service_effect_s01_sources WHERE source_id=?").get(message.id)).toBeNull();
    expect(calls).toBe(0);
    backend.stop(); await backend.close();
    for (const spy of [...captureSpies, ...sdkSpies]) spy.mockRestore();
    closeDatabase(); owner.release(); return;
  }
  const rowId = root.transaction(() => {
    const rowId = storeMessage(message);
    const admit = bound.getInputSourceAdmission!(message.chat_jid); assert(admit);
    admit({ message, rowId, database: root });
    return rowId;
  })();
  const dispatch = bound.dispatchAcceptedInput!(message.chat_jid, message.id, rowId!);
  const tableCancelled = codemodeTableCancelled || scenario === "native-editable-table-revoked" || scenario === "native-editable-table-closed-publisher" || scenario === "native-editable-table-archived" || scenario === "native-editable-table-binding-revoked";
  expect(dispatch).toBeDefined();
  if (scenario === "native-codemode-reopen") {
    let pending: Promise<unknown> | undefined;
    let childPid: number | undefined;
    let reopenedBase: ReturnType<typeof createRuntimeBaseServices> | undefined;
    let reopenedPool: AgentPool | undefined;
    try {
      pending = dispatch!();
      const deadline = Date.now() + 2000;
      while (!existsSync(codemodePid) && Date.now() < deadline) await Bun.sleep(5);
      expect(existsSync(codemodePid)).toBe(true);
      childPid = Number(readFileSync(codemodePid, "utf8"));
      expect(childPid).toBeGreaterThan(0);
      expect(codemodeReads).toBe(1);
      expect(readFileSync(codemodeMarker, "utf8")).toBe("x");
      const binding = root.query("SELECT * FROM piclaw_durable_bindings_v1").all();
      expect(binding).toHaveLength(1);
      expect(root.query("SELECT state FROM service_effect_s01_sources WHERE source_id='factory-input'").get()).toEqual({ state: "claimed" });
      expect(root.query("SELECT id FROM messages WHERE is_bot_message=1").all()).toHaveLength(0);
      backend.stop(); await backend.close();
      expect(await pending).toBe("pending");
      expect(() => process.kill(childPid!, 0)).toThrow();
      await channel.stop(); await base.queue.shutdown(); await pool.shutdown();
      const oldRoot = root;
      closeDatabase(); initDatabase(); root = getDb();
      expect(root).not.toBe(oldRoot);
      expect(() => oldRoot.query("SELECT 1").get()).toThrow();
      owner.assertCurrentOwner();
      backend = await createDefaultApplicationRuntime(owner, async () => services);
      expect(backend.sessionOptions.getDurableSession!("web:default")?.sessionId).toBe(first!.sessionId);
      reopenedBase = createRuntimeBaseServices({ dataDir: workspace });
      reopenedPool = new AgentPool({ credentialStore, modelRuntime: runtime, modelRegistry, ...backend.sessionOptions });
      const reopened = backend.bind({ queue: reopenedBase.queue, agentPool: reopenedPool });
      // Recover the original accepted row/binding, never submit a fresh request.
      expect(await reopened.dispatchAcceptedInput!(message.chat_jid, message.id, rowId!)!()).toBe("settled");
      expect(root.query("SELECT * FROM piclaw_durable_bindings_v1").all()).toEqual(binding);
      expect(codemodeReads).toBe(1);
      expect(readFileSync(codemodeMarker, "utf8")).toBe("x");
      const result = [...observedResults.values()].find(result => result.toolName === "codemode");
      expect(result).toBeDefined(); expect(result!.isError).not.toBe(true);
      expect(JSON.stringify(result!.content)).toContain("NATIVE_CODEMODE_FIRST_READ");
      expect(root.query("SELECT state FROM service_effect_s01_sources WHERE source_id='factory-input'").get()).toEqual({ state: "consumed" });
      expect(root.query("SELECT id FROM messages WHERE is_bot_message=1").all()).toHaveLength(1);
      expect(root.query("SELECT * FROM service_effect_s02_commits").all()).toHaveLength(1);
      expect(sdkSpies.every(spy => spy.mock.calls.length === 0)).toBe(true);
    } finally {
      backend.stop(); await backend.close(); await pending;
      if (childPid) { try { process.kill(childPid, "SIGKILL"); } catch {} }
      await channel.stop(); await base.queue.shutdown(); await pool.shutdown();
      await reopenedBase?.queue.shutdown(); await reopenedPool?.shutdown();
      for (const spy of [...captureSpies, ...sdkSpies]) spy.mockRestore();
      closeDatabase(); owner.release();
    }
    return;
  }
  if (scenario === "native-parent-budget-cap") saveBudgetCap({ scope: "instance_daily", metric: "api_usd_micros", amount: 0, timezone: "UTC" }, root);
  let dispatchOutcome: Awaited<ReturnType<NonNullable<typeof dispatch>>>;
  if(recoveryPackage) {
    const pending=dispatch!();
    try {
      await recoveryBarrier!.entered;
      const {QueuedFollowupLifecycleService}=await import("../../runtime/src/channels/web/runtime/queued-followup-lifecycle-service.js");
      const followups=new QueuedFollowupLifecycleService();
      const queued=root.transaction(()=>followups.enqueueAcceptedFollowupOnce("recovery-attached-input","web:default","recovery accepted steer",new Date().toISOString(),{source:"user"},bound.getQueuedInputSourceAdmission!("web:default")!)).immediate();
      expect(queued).not.toBeNull();
      const steering=bound.getAcceptedQueuedSteering!("web:default")!;expect(steering).toBeDefined();
      const accepted=await steering.accept(queued!);await accepted.dispatch();
    } finally {recoveryBarrier!.hook.mockRestore();recoveryBarrier!.release();}
    dispatchOutcome=await pending;
  } else dispatchOutcome = await dispatch!();
  if (recoveryPackage) {
    try {
      expect(dispatchOutcome).toBe("settled"); expect(calls).toBe(2);
      expect(root.query("SELECT submission_id FROM piclaw_durable_intent_bindings_v1").all()).toHaveLength(1);
      expect((await pool.runSidePrompt("web:default","recovery side input",{budgetWorkId:"fixture-recovery-side"})).status).toBe("success");
      expect(calls).toBe(3);
      const service = (await import(join(recoveryPackage,"runtime.ts"))).reviewService();
      const branch = (root.query("SELECT branch_id FROM chat_branches WHERE chat_jid='web:default'").get() as {branch_id:string}).branch_id;
      service.createFromCapture({ownerId:"default",actorId:"default",kind:"operator",workspaceId:"recovery"},
        {title:"Recovery review",focusPath:"saved.ts",target:{chatId:"web:default",incarnation:branch,label:"Default"}},
        {workspaceId:"recovery",worktreeId:"fixture",mode:"source",base:null,head:null,capturedAt:"2026-01-01T00:00:00Z",
          files:[{oldPath:null,newPath:"saved.ts",oldText:null,newText:"saved recovery source\n",change:"source"}]}, {requestId:"recovery-review"});
      backend.stop(); await backend.close();
      await qualifyNativeRecoveryUnitFixture(root,workspace,getDataDir(),scenario==="native-retention-unit");
      expect(calls).toBe(3); expect(sdkSpies.every(spy=>spy.mock.calls.length===0)).toBe(true);
    } finally {
      backend.stop(); await backend.close(); await channel.stop(); await base.queue.shutdown(); await pool.shutdown();
      for (const spy of [...captureSpies,...sdkSpies]) spy.mockRestore();
      owner.release(); closeDatabase();
    }
    return;
  }
  if (expectedFailedTurn) { expect(dispatchOutcome).toBe("settled"); assertFailedTurn(); }
  if (scenario === "native-web-cursor-ack") {
    expect(dispatchOutcome).toBe("settled"); expect(calls).toBe(1);
    // Native terminal publication is committed, but polling cursor ACK is lost.
    // Fresh native storage contains no recovery markers to reset or replay.
    root.query("INSERT INTO chat_cursors(chat_jid,cursor_ts) VALUES(?,'')").run(message.chat_jid);
    const execution = () => ["piclaw_durable_bindings_v1", "service_effect_s01_sources", "service_effect_s01_operations", "service_effect_s02_commits", "entries", "tasks", "submissions", "record_ids"]
      .map(table => root.query(`SELECT * FROM ${table} ORDER BY rowid`).all());
    const preserved = execution(), posts = root.query("SELECT * FROM messages ORDER BY rowid").all();
    const cursorColumns = () => (root.query("PRAGMA main.table_info(chat_cursors)").all() as {name:string}[]).map(row=>row.name);
    const expectedColumns = ["chat_jid","cursor_ts","queued_followups_json"];
    root.exec("CREATE TRIGGER refuse_cursor_ack BEFORE UPDATE OF cursor_ts ON chat_cursors BEGIN SELECT RAISE(ABORT,'cursor ACK lost'); END");
    let nextBase: ReturnType<typeof createRuntimeBaseServices> | undefined, nextPool: AgentPool | undefined, nextChannel: WebChannel | undefined;
    try {
      await expect(channel.processChat(message.chat_jid, "default")).rejects.toThrow("cursor ACK lost");
      expect(root.query("SELECT cursor_ts FROM chat_cursors WHERE chat_jid=?").get(message.chat_jid)).toEqual({ cursor_ts: "" });
      expect(execution()).toEqual(preserved); expect(cursorColumns()).toEqual(expectedColumns);
      expect(root.query("SELECT * FROM messages ORDER BY rowid").all()).toEqual(posts);
      expect(calls).toBe(1);
      root.exec("DROP TRIGGER refuse_cursor_ack");
      backend.stop(); await backend.close(); await channel.stop(); await base.queue.shutdown(); await pool.shutdown();
      closeDatabase(); initDatabase(); root = getDb();
      backend = await createDefaultApplicationRuntime(owner, async () => services);
      expect(backend.sessionOptions.getDurableSession!(message.chat_jid)?.sessionId).toBe(first!.sessionId);
      nextBase = createRuntimeBaseServices({ dataDir: workspace });
      nextPool = new AgentPool({ credentialStore, modelRuntime: runtime, modelRegistry, ...backend.sessionOptions });
      nextChannel = new WebChannel(backend.bind({ queue: nextBase.queue, agentPool: nextPool }));
      const { runWebStartupRecoveryBootstrap } = await import("../../runtime/src/runtime/startup.js");
      const resumes: (() => void)[] = [];
      runWebStartupRecoveryBootstrap(nextChannel, undefined, resume => resumes.push(resume));
      expect(resumes).toHaveLength(1); expect(cursorColumns()).toEqual(expectedColumns);
      resumes[0](); resumes[0](); // Repeated startup wakeups share one queue key.
      const until = Date.now() + 5000;
      while (Date.now() < until && (root.query("SELECT cursor_ts FROM chat_cursors WHERE chat_jid=?").get(message.chat_jid) as {cursor_ts:string}).cursor_ts !== message.timestamp) await Bun.sleep(10);
      expect(root.query("SELECT cursor_ts FROM chat_cursors WHERE chat_jid=?").get(message.chat_jid)).toEqual({ cursor_ts: message.timestamp });
      await nextBase.queue.shutdown();
      expect(calls).toBe(1); expect(execution()).toEqual(preserved);
      expect(cursorColumns()).toEqual(expectedColumns);
      expect(root.query("SELECT * FROM messages ORDER BY rowid").all()).toEqual(posts);
      expect(sdkSpies.every(spy => spy.mock.calls.length === 0)).toBe(true);
    } finally {
      root.exec("DROP TRIGGER IF EXISTS refuse_cursor_ack");
      backend.stop(); await backend.close();
      await nextChannel?.stop(); await nextBase?.queue.shutdown(); await nextPool?.shutdown();
      await channel.stop(); await base.queue.shutdown(); await pool.shutdown();
      for (const spy of [...captureSpies, ...sdkSpies]) spy.mockRestore();
      closeDatabase(); owner.release();
    }
    return;
  }
  if (scenario === "native-events") {
    expect(dispatchOutcome).toBe("settled");
    expect(nativeEvents).toHaveLength(1);
    expect(nativeEvents[0].chat_jid).toBe("web:default");
    expect(nativeEvents[0].data.type).toBe("agent_response");
    expect(nativeEvents[0].id).toBeGreaterThan(0);
  }
  if (delegateAccountingUnknown) {
    expect(dispatchOutcome).toBe("settled");
    expect(calls).toBe(4);
    expect(root.query("SELECT state, COUNT(*) AS n FROM budget_request_reservations GROUP BY state ORDER BY state").all()).toEqual([{ state: "settled", n: 2 }, { state: "unresolved", n: 2 }]);
    expect(root.query("SELECT status FROM budget_work WHERE parent_work_id IS NULL").all()).toEqual([{ status: "active" }]);
    expect(root.query("SELECT SUM(api_equivalent_cost_microusd) AS amount FROM token_usage WHERE invocation_id IS NOT NULL").get()).toEqual({ amount: 20 });
    for (const id of ["A", "B"]) expect(observedResults.get(id)).toMatchObject({ toolName: "delegate", isError: true });
    backend.stop(); await backend.close();
    closeDatabase(); initDatabase(); root = getDb();
    expect(root.query("SELECT state FROM budget_request_reservations WHERE state='unresolved'").all()).toHaveLength(2);
    expect(root.query("SELECT status FROM budget_work WHERE parent_work_id IS NULL").all()).toEqual([{ status: "active" }]);
    for (const spy of [...captureSpies, ...sdkSpies]) spy.mockRestore();
    closeDatabase(); owner.release(); return;
  }
  if (delegateAccounting) {
    expect(dispatchOutcome).toBe("settled");
    expect(calls).toBe(4);
    expect(childRequests).toBe(2);
    expect(root.query("SELECT COUNT(*) AS n FROM budget_request_reservations WHERE state='settled'").get()).toEqual({ n: 4 });
    expect(root.query("SELECT execution_kind, COUNT(*) AS n FROM budget_work WHERE parent_work_id IS NOT NULL GROUP BY execution_kind ORDER BY execution_kind").all()).toEqual([{ execution_kind: "delegate", n: 2 }, { execution_kind: "interactive", n: 2 }]);
    expect(root.query("SELECT COUNT(*) AS n FROM budget_work WHERE status='completed'").get()).toEqual({ n: 5 });
    expect(root.query("SELECT SUM(api_equivalent_cost_microusd) AS amount FROM token_usage WHERE invocation_id IS NOT NULL").get()).toEqual({ amount: 40 });
    expect(observedResults.size).toBe(2);
    expect(root.query("SELECT id FROM messages WHERE is_bot_message=1").all()).toHaveLength(1);
    backend.stop(); await backend.close();
    for (const spy of [...captureSpies, ...sdkSpies]) spy.mockRestore();
    closeDatabase(); owner.release(); return;
  }
  if (scenario === "native-routing-bash-active" || scenario === "native-routing-control-race") {
    expect(dispatchOutcome).toBe("settled"); expect(calls).toBe(1);
    const branches = await import("../../runtime/src/db/chat-branches.js");
    const created = await pool.createRootChatSession("routing-native-command");
    await bound.prepareInputSourceAdmission!(created.chat_jid);
    const port = backend.sessionOptions.getDurableSession!(created.chat_jid)!;
    const marker = join(workspace, "native-routing-bash-marker");
    const sourceRows = root.query("SELECT * FROM service_effect_s01_sources ORDER BY chat_jid,source_seq").all();
    if (scenario === "native-routing-control-race") {
      const running = port.runBash!(`printf ready > '${marker}'`);
      expect(() => branches.archiveChatBranch(created.chat_jid)).toThrow("active native controls");
      expect(branches.getChatBranchByChatJid(created.chat_jid)?.archived_at).toBeNull();
      // Force the late policy change in this isolated fixture: normal archive
      // must be fenced separately while command preparation owns the target.
      root.query("UPDATE chat_branches SET archived_at=? WHERE chat_jid=?").run(new Date().toISOString(), created.chat_jid);
      await expect(running).rejects.toThrow("Unbound conversation");
      expect(existsSync(marker)).toBe(false);
    } else {
      const unrelated = await pool.createRootChatSession("routing-other-command");
      await bound.prepareInputSourceAdmission!(unrelated.chat_jid);
      const running = port.runBash!(`printf ready > '${marker}'; sleep 1`);
      try {
        const until = Date.now() + 3000;
        while (!existsSync(marker) && Date.now() < until) await Bun.sleep(10);
        expect(existsSync(marker)).toBe(true);
        expect(branches.archiveChatBranch(unrelated.chat_jid).archived_at).not.toBeNull();
        expect(() => branches.archiveChatBranch(created.chat_jid)).toThrow("active native controls");
        expect(branches.getChatBranchByChatJid(created.chat_jid)?.archived_at).toBeNull();
        expect(backend.sessionOptions.getDurableSession!(created.chat_jid)).toBeDefined();
        expect(await port.abortBash!()).toBe(true);
        expect((await running).cancelled).toBe(true);
      } finally { await running.catch(() => {}); }
      const controlGate = Promise.withResolvers<void>();
      const control = port.runOwnedControl!(() => controlGate.promise);
      try {
        expect(() => branches.archiveChatBranch(created.chat_jid)).toThrow("active native controls");
        expect(branches.getChatBranchByChatJid(created.chat_jid)?.archived_at).toBeNull();
      } finally { controlGate.resolve(); await control; }
      expect(branches.archiveChatBranch(created.chat_jid).archived_at).not.toBeNull();
      branches.restoreChatBranchIdentity({ chat_jid: created.chat_jid });
    }
    expect(root.query("SELECT * FROM service_effect_s01_sources ORDER BY chat_jid,source_seq").all()).toEqual(sourceRows);
    expect(calls).toBe(1);
    backend.stop(); await backend.close(); await pool.shutdown(); await base.queue.shutdown(); await channel.stop();
    if (scenario === "native-routing-bash-active") expect(() => branches.archiveChatBranch(created.chat_jid)).toThrow("Native routing owner unavailable");
    for (const spy of [...captureSpies, ...sdkSpies]) spy.mockRestore();
    closeDatabase(); owner.release(); return;
  }
  if (scenario === "native-routing-queued-race" || scenario === "native-routing-side-race") {
    expect(dispatchOutcome).toBe("settled"); expect(calls).toBe(1);
    const branches = await import("../../runtime/src/db/chat-branches.js");
    const created = await pool.createRootChatSession("routing-admission-race");
    await bound.prepareInputSourceAdmission!(created.chat_jid);
    const input = { ...message, id: "routing-admission-history", chat_jid: created.chat_jid, content: "establish exact side history" };
    const rowId = root.transaction(() => { const id = storeMessage(input); bound.getInputSourceAdmission!(created.chat_jid)!({ message: input, rowId: id, database: root }); return id; })();
    expect(await bound.dispatchAcceptedInput!(created.chat_jid, input.id, rowId)!()).toBe("settled"); expect(calls).toBe(2);
    const sources = root.query("SELECT * FROM service_effect_s01_sources ORDER BY chat_jid,source_seq").all();
    const operations = root.query("SELECT * FROM service_effect_s01_operations ORDER BY operation_id").all();
    const budgetWork = root.query("SELECT * FROM budget_work ORDER BY id").all();
    const conversations = root.query("SELECT id,record FROM conversations ORDER BY id").all();
    const { getDeferredQueuedFollowups } = await import("../../runtime/src/db.js");
    if (scenario === "native-routing-queued-race") {
      const cached = bound.getQueuedInputSourceAdmission!(created.chat_jid)!;
      branches.archiveChatBranch(created.chat_jid);
      const { QueuedFollowupLifecycleService } = await import("../../runtime/src/channels/web/runtime/queued-followup-lifecycle-service.js");
      const followups = new QueuedFollowupLifecycleService();
      expect(() => root.transaction(() => followups.enqueueAcceptedFollowupOnce("routing-stale-queue", created.chat_jid,
        "must not admit after archive", new Date().toISOString(), { source: "user" }, cached)).immediate()).toThrow("Unbound queued input chat");
    } else {
      const prompt = "routing side payload written before archive";
      const original = hostFs.writeFileSync; let archived = 0;
      const gate = spyOn(hostFs, "writeFileSync").mockImplementation((...args: Parameters<typeof hostFs.writeFileSync>) => {
        const result = original(...args);
        if (args[1] === prompt) { branches.archiveChatBranch(created.chat_jid); archived++; }
        return result;
      });
      try { await expect(backend.sessionOptions.dispatchSidePrompt!(created.chat_jid, prompt, {})).rejects.toThrow(); }
      finally { gate.mockRestore(); }
      expect(archived).toBe(1);
    }
    expect(branches.getChatBranchByChatJid(created.chat_jid)?.archived_at).not.toBeNull();
    expect(root.query("SELECT * FROM service_effect_s01_sources ORDER BY chat_jid,source_seq").all()).toEqual(sources);
    expect(root.query("SELECT * FROM service_effect_s01_operations ORDER BY operation_id").all()).toEqual(operations);
    expect(root.query("SELECT * FROM budget_work ORDER BY id").all()).toEqual(budgetWork);
    expect(root.query("SELECT id,record FROM conversations ORDER BY id").all()).toEqual(conversations);
    expect(getDeferredQueuedFollowups(created.chat_jid)).toEqual([]); expect(calls).toBe(2);
    backend.stop(); await backend.close(); await pool.shutdown(); await base.queue.shutdown(); await channel.stop();
    for (const spy of [...captureSpies, ...sdkSpies]) spy.mockRestore();
    closeDatabase(); owner.release(); return;
  }
  if (scenario === "native-routing-create-race") {
    expect(dispatchOutcome).toBe("settled"); expect(calls).toBe(1);
    const branches = await import("../../runtime/src/db/chat-branches.js");
    const chat = "web:archive-before-publication";
    storeChatMetadata(chat, new Date().toISOString());
    const before = root.query("SELECT id FROM conversations ORDER BY id").all();
    let entered!: () => void, release!: () => void, armed = true;
    const ready = new Promise<void>(resolve => { entered = resolve; }), held = new Promise<void>(resolve => { release = resolve; });
    const actual = BunSqliteDatabase.prototype.transaction;
    const fault = spyOn(BunSqliteDatabase.prototype, "transaction").mockImplementation(async function<T>(this: BunSqliteDatabase, callback: (tx: SqliteExecutor) => Promise<T>): Promise<T> {
      if (armed) { armed = false; entered(); await held; }
      return actual.call<BunSqliteDatabase, [(tx: SqliteExecutor) => Promise<T>], Promise<T>>(this, callback);
    });
    const pending = bound.prepareInputSourceAdmission!(chat); void pending.catch(() => {});
    try {
      await ready;
      expect(branches.archiveChatBranch(chat).archived_at).not.toBeNull();
      release(); await expect(pending).rejects.toThrow("Root branch changed");
      expect(root.query("SELECT id FROM conversations ORDER BY id").all()).toEqual(before);
      expect(backend.sessionOptions.getDurableSession!(chat)).toBeUndefined();
      branches.restoreChatBranchIdentity({ chat_jid: chat });
      // The commit attempt boundary was crossed. Even this proven fixture
      // refusal does not authorise the runtime to guess/reallocate without reopen.
      await expect(bound.prepareInputSourceAdmission!(chat)).rejects.toThrow();
      expect(root.query("SELECT id FROM conversations ORDER BY id").all()).toEqual(before);
    } finally { release(); await pending.catch(() => {}); fault.mockRestore(); }
    backend.stop(); await backend.close(); await pool.shutdown(); await base.queue.shutdown(); await channel.stop();
    backend = await createDefaultApplicationRuntime(owner, async () => services);
    const reopenedBase = createRuntimeBaseServices({ dataDir: workspace });
    const reopenedPool = new AgentPool({ credentialStore, modelRuntime: runtime, modelRegistry, ...backend.sessionOptions });
    const reopened = backend.bind({ queue: reopenedBase.queue, agentPool: reopenedPool });
    await reopened.prepareInputSourceAdmission!(chat);
    expect(backend.sessionOptions.getDurableSession!(chat)).toBeDefined();
    expect(root.query("SELECT id FROM conversations ORDER BY id").all()).toHaveLength(before.length + 1);
    // Lookup 1 is assertConversationAvailable; callback fences are lookups 2/3.
    // Keep the early refusal and also revoke AFTER the publisher stages metadata.
    const allocationRows = () => ["durable_metadata", "record_ids", "conversations", "entries", "tasks", "submissions", "documents", "document_revisions"]
      .map(table => root.query(`SELECT * FROM ${table}`).all());
    for (const revokeAt of [2, 3]) {
      const deniedChat = `web:model-revoked-on-check-${revokeAt}`;
      storeChatMetadata(deniedChat, new Date().toISOString());
      const allocationBefore = allocationRows();
      const availableModels = modelRegistry.getAvailable.bind(modelRegistry);
      let availabilityChecks = 0;
      const revoke = spyOn(modelRegistry, "getAvailable").mockImplementation(() => ++availabilityChecks < revokeAt ? availableModels() : []);
      try {
        await expect(reopened.prepareInputSourceAdmission!(deniedChat)).rejects.toThrow("Host model no longer available");
        expect(availabilityChecks).toBe(revokeAt);
      } finally { revoke.mockRestore(); }
      expect(allocationRows()).toEqual(allocationBefore);
      expect(backend.sessionOptions.getDurableSession!(deniedChat)).toBeUndefined();
    }
    expect(calls).toBe(1);
    backend.stop(); await backend.close(); await reopenedPool.shutdown(); await reopenedBase.queue.shutdown();
    for (const spy of [...captureSpies, ...sdkSpies]) spy.mockRestore();
    closeDatabase(); owner.release(); return;
  }
  if (scenario === "native-routing-policy") {
    expect(dispatchOutcome).toBe("settled"); expect(calls).toBe(1);
    const branches = await import("../../runtime/src/db/chat-branches.js");
    const created = await pool.createRootChatSession("routing-metadata");
    await bound.prepareInputSourceAdmission!(created.chat_jid);
    const position = backend.sessionOptions.getDurableSession!(created.chat_jid)!;
    const identity = { sessionId: position.sessionId, branchId: position.branchId };
    const input = { ...message, id: "routing-history", chat_jid: created.chat_jid, content: "retain native routing history" };
    const rowId = root.transaction(() => { const id = storeMessage(input); bound.getInputSourceAdmission!(created.chat_jid)!({ message: input, rowId: id, database: root }); return id; })();
    expect(() => branches.archiveChatBranch(created.chat_jid)).toThrow("accepted, queued or uncertain work");
    expect(branches.getChatBranchByChatJid(created.chat_jid)?.archived_at).toBeNull();
    expect(await bound.dispatchAcceptedInput!(created.chat_jid, input.id, rowId)!()).toBe("settled");
    expect(calls).toBe(2);
    const anchorsSql = "SELECT d.kind,d.owner_id,r.* FROM documents d JOIN document_revisions r ON r.document_id=d.id WHERE d.kind IN ('\"app.application-conversations\"','\"app.application-identity\"') ORDER BY r.document_id,r.seq";
    const anchors = root.query(anchorsSql).all();
    const nativeInputs = root.query("SELECT * FROM piclaw_durable_bindings_v1 ORDER BY conversation_id,source_seq").all();
    const history = root.query("SELECT * FROM entries ORDER BY id").all();
    expect((await pool.renameChatBranch(created.chat_jid, { agentName: "native-friendly" })).branch_id).toBe(created.branch_id);
    expect(backend.sessionOptions.getDurableSession!(created.chat_jid)).toMatchObject(identity);
    await expect(pool.renameChatJid(created.chat_jid, "web:must-not-move")).rejects.toThrow("Durable chat identity rename unavailable");
    await expect(pool.createForkedChatBranch(created.chat_jid)).rejects.toThrow("Native routing identities are immutable");
    expect(root.query(anchorsSql).all()).toEqual(anchors);
    expect((await pool.pruneChatBranch(created.chat_jid)).archived_at).not.toBeNull();
    await expect(pool.permanentPurgeChatBranch(created.chat_jid)).rejects.toThrow("Native routing identities are immutable");
    storeChatMetadata(created.chat_jid, new Date().toISOString());
    expect(branches.getChatBranchByChatJid(created.chat_jid)?.archived_at).not.toBeNull();
    expect(backend.sessionOptions.getDurableSession!(created.chat_jid)).toBeUndefined();
    expect(() => bound.getInputSourceAdmission!(created.chat_jid)).toThrow("Unbound application conversation");
    await expect(bound.prepareInputSourceAdmission!(created.chat_jid)).rejects.toThrow("archived");
    backend.stop(); await backend.close(); await pool.shutdown(); await base.queue.shutdown(); await channel.stop();
    closeDatabase(); initDatabase(); root = getDb();
    backend = await createDefaultApplicationRuntime(owner, async () => services);
    expect(backend.sessionOptions.getDurableSession!(created.chat_jid)).toBeUndefined();
    expect(root.query(anchorsSql).all()).toEqual(anchors);
    expect(root.query("SELECT * FROM piclaw_durable_bindings_v1 ORDER BY conversation_id,source_seq").all()).toEqual(nativeInputs);
    expect(root.query("SELECT * FROM entries ORDER BY id").all()).toEqual(history);
    const restoredPool = new AgentPool({ credentialStore, modelRuntime: runtime, modelRegistry, ...backend.sessionOptions });
    expect((await restoredPool.restoreChatBranch(created.chat_jid)).agent_name).toBe("native-friendly");
    expect(backend.sessionOptions.getDurableSession!(created.chat_jid)).toMatchObject(identity);
    expect(root.query(anchorsSql).all()).toEqual(anchors); expect(calls).toBe(2);
    const unmapped = "web:unpublished-restore";
    storeChatMetadata(unmapped, new Date().toISOString()); branches.archiveChatBranch(unmapped);
    const priorPolicy = branches.getChatBranchByChatJid(unmapped);
    await expect(restoredPool.restoreChatBranch(unmapped)).rejects.toThrow("Exact native restore binding unavailable");
    expect(branches.getChatBranchByChatJid(unmapped)).toEqual(priorPolicy);
    expect(root.query(anchorsSql).all()).toEqual(anchors);
    await restoredPool.shutdown(); backend.stop(); await backend.close();
    const anchor = root.query("SELECT r.document_id,r.seq,r.content FROM documents d JOIN document_revisions r ON r.document_id=d.id WHERE d.kind='\"app.application-identity\"' AND d.owner_id=(SELECT conversation_id FROM piclaw_durable_bindings_v1 WHERE chat_jid=? LIMIT 1)").get(created.chat_jid) as { document_id: number; seq: number; content: string };
    root.query("UPDATE document_revisions SET content=? WHERE document_id=? AND seq=?").run(JSON.stringify({ ...JSON.parse(anchor.content), branchId: "forged" }), anchor.document_id, anchor.seq);
    let modelLookups = 0;
    await expect(createDefaultApplicationRuntime(owner, async () => { modelLookups++; return services; })).rejects.toThrow("identity");
    expect(modelLookups).toBe(0); expect(calls).toBe(2);
    for (const spy of [...captureSpies, ...sdkSpies]) spy.mockRestore();
    closeDatabase(); owner.release(); return;
  }
  if (accountingCloseFailure) {
    expect(calls).toBe(1);
    expect(root.query("SELECT state FROM budget_request_reservations").all()).toEqual([{ state: "settled" }]);
    expect(root.query("SELECT status FROM budget_work WHERE parent_work_id IS NULL").all()).toEqual([{ status: "active" }]);
    expect(root.query("SELECT operation_id FROM service_effect_s02_commits").all()).toHaveLength(1);
    root.exec("DROP TRIGGER accounting_work_close_fail");
    backend.stop(); await backend.close();
    backend = await createDefaultApplicationRuntime(owner, async () => services);
    expect(root.query("SELECT status FROM budget_work WHERE parent_work_id IS NULL").all()).toEqual([{ status: "completed" }]);
    expect(root.query("SELECT api_equivalent_cost_microusd FROM token_usage WHERE invocation_id IS NOT NULL").all()).toEqual([{ api_equivalent_cost_microusd: 10 }]);
    expect(calls).toBe(1);
    backend.stop(); await backend.close();
    for (const spy of [...captureSpies, ...sdkSpies]) spy.mockRestore();
    closeDatabase(); owner.release(); return;
  }
  if (parentAccounting && (accountingAuthDenied || accountingUnknown || accountingRotate || accountingStorageFailure)) {
    expect(dispatchOutcome).toBe(expectedFailedTurn ? "settled" : "pending");
    expect(calls).toBe(accountingUnknown || accountingStorageFailure ? 1 : 0);
    // Cleanup classifies the original reservation; never rebind to rotated auth
    // or replace a held expense with a free fallback request.
    expect(root.query("SELECT id,work_id,account_ref,binding_sha256,amount_microusd FROM budget_request_reservations").all()).toEqual([originalParentReservation]);
    if (accountingUnknown || accountingStorageFailure) expect((originalParentReservation as { amount_microusd: number }).amount_microusd).toBeGreaterThan(0);
    expect(root.query("SELECT state FROM budget_request_reservations").all()).toEqual([{ state: accountingUnknown || accountingStorageFailure ? "unresolved" : "released" }]);
    expect(root.query("SELECT status FROM budget_work WHERE parent_work_id IS NULL").all()).toEqual([{ status: accountingUnknown || accountingStorageFailure ? "active" : "completed" }]);
    expect(root.query("SELECT id FROM messages WHERE is_bot_message=1").all()).toHaveLength(expectedFailedTurn ? 1 : 0);
    expect(root.query("SELECT source_id FROM service_effect_s01_sources WHERE state='claimed'").all()).toHaveLength(expectedFailedTurn ? 0 : 1);
    if (accountingStorageFailure) expect(root.query("SELECT invocation_id FROM token_usage WHERE invocation_id IS NOT NULL").all()).toHaveLength(0);
    backend.stop(); await backend.close();
    if (accountingStorageFailure) {
      closeDatabase(); initDatabase(); root = getDb();
      expect(root.query("SELECT state FROM budget_request_reservations").all()).toEqual([{ state: "unresolved" }]);
      expect(root.query("SELECT status FROM budget_work WHERE parent_work_id IS NULL").all()).toEqual([{ status: accountingUnknown || accountingStorageFailure ? "active" : "completed" }]);
      expect(root.query("SELECT invocation_id FROM token_usage WHERE invocation_id IS NOT NULL").all()).toHaveLength(0);
    }
    for (const spy of [...captureSpies, ...sdkSpies]) spy.mockRestore();
    closeDatabase(); owner.release(); return;
  }
  if (accountingTwoTurns) {
    expect(dispatchOutcome).toBe("settled");
    expect(calls).toBe(2);
    expect(root.query("SELECT COUNT(DISTINCT id) AS n, COUNT(DISTINCT work_id) AS works FROM budget_request_reservations WHERE state='settled'").get()).toEqual({ n: 2, works: 2 });
    expect(root.query("SELECT COUNT(DISTINCT parent_work_id) AS n FROM budget_work WHERE parent_work_id IS NOT NULL").get()).toEqual({ n: 1 });
    expect(root.query("SELECT COUNT(*) AS n FROM budget_work WHERE status='completed'").get()).toEqual({ n: 3 });
    expect(root.query("SELECT SUM(api_equivalent_cost_microusd) AS amount FROM token_usage WHERE invocation_id IS NOT NULL").get()).toEqual({ amount: 20 });
    expect(observedResults.get("factory-tool-1")).toMatchObject({ toolName: "read", isError: false });
    expect(root.query("SELECT id FROM messages WHERE is_bot_message=1").all()).toHaveLength(1);
    backend.stop(); await backend.close();
    for (const spy of [...captureSpies, ...sdkSpies]) spy.mockRestore();
    closeDatabase(); owner.release(); return;
  }
  if (usageProjection) {
    expect(dispatchOutcome).toBe("settled"); expect(calls).toBe(1);
    const projection = await import("../../runtime/src/db/usage-report-projection.js");
    const event = root.query("SELECT * FROM budget_usage_events").get() as import("../../runtime/src/db/usage-report-projection.js").UsageProjectionEvent;
    expect(projection.decodeUsageReport(event)?.origin.kind).toBe("host_request");
    expect(root.query("SELECT COUNT(*) n FROM budget_usage_events").get()).toEqual({ n: 1 });
    expect(root.query("SELECT provider_cost_total,catalogue_cost_total,cost_total,cost_provenance,reasoning_tokens,cache_read_reported FROM token_usage").all())
      .toEqual([{ provider_cost_total: 0, catalogue_cost_total: 0.00001, cost_total: 0, cost_provenance: "provider_reported", reasoning_tokens: 2, cache_read_reported: 1 }]);
    const report = root.query("SELECT * FROM token_usage").all();
    const reservations = root.query("SELECT * FROM budget_request_reservations").all();
    const receipt = root.query("SELECT * FROM piclaw_schema_migrations WHERE owner='host.usage-reports'").get();
    root.exec("UPDATE token_usage SET input_tokens=999,cost_total=99,provider_cost_total=99,api_equivalent_cost_microusd=0");
    expect(projection.reconcileUsageReports(root)).toEqual({ projected: 1, unavailable: 0, next: null });
    expect(root.query("SELECT * FROM token_usage").all()).toEqual(report);
    expect(root.query("SELECT * FROM budget_usage_events").all()).toEqual([event]);
    expect(root.query("SELECT * FROM budget_request_reservations").all()).toEqual(reservations);
    backend.stop(); await backend.close(); closeDatabase(); initDatabase(); root = getDb();
    backend = await createDefaultApplicationRuntime(owner, async () => services);
    expect(root.query("SELECT * FROM token_usage").all()).toEqual(report);
    expect(root.query("SELECT * FROM budget_usage_events").all()).toEqual([event]);
    expect(root.query("SELECT * FROM budget_request_reservations").all()).toEqual(reservations);
    expect(root.query("SELECT * FROM piclaw_schema_migrations WHERE owner='host.usage-reports'").get()).toEqual(receipt);
    expect(calls).toBe(1);
    backend.stop(); await backend.close();
    for (const spy of [...captureSpies, ...sdkSpies]) spy.mockRestore();
    closeDatabase(); owner.release(); return;
  }
  if (scenario === 'native-parent-accounting-event-fence') {
    try {
      expect(dispatchOutcome).toBe('pending'); expect(calls).toBe(1);
      expect(terminalFenceCalls).toBe(1); expect(terminalFenceObservedReceipt).toBe(true); expect(terminalObserverCalls).toBe(0);
      const row = root.query('SELECT * FROM budget_request_reservations').get() as BudgetRequestReservation;
      expect(row.state).toBe('unresolved'); expect(row.terminal_receipt_json).not.toBeNull();
      expect(JSON.parse(row.terminal_receipt_json!).projectedOutcome).toEqual(originalPaidTerminal);
      expect(root.query('SELECT count(*) n FROM token_usage').get()).toEqual({ n: 0 });
      const tasks = root.query('SELECT * FROM tasks ORDER BY id').all(), terminals = root.query('SELECT * FROM service_effect_s02_commits').all();
      expect(root.query("SELECT state FROM service_effect_s01_sources WHERE source_id='factory-input'").get()).toEqual({ state: 'claimed' });
      expect(terminals).toEqual([]); expect(root.query('SELECT content FROM messages WHERE is_bot_message=1').all()).toEqual([]);
      expect(JSON.stringify(root.query("SELECT record FROM entries WHERE json_extract(record,'$.kind')='pi.assistant'").all())).toContain('phase=source');
      const binding: BudgetRequestBinding = { id: row.id, workId: row.work_id, chatJid: row.chat_jid,
        providerId: row.provider_id, modelId: row.model_id, accountRef: row.account_ref, amountMicros: row.amount_microusd,
        ...(row.model_invocation_json ? { modelInvocation: JSON.parse(row.model_invocation_json) } : {}) };
      const accounting = modelRequestAccounting({ authorise() { throw Error('Failed execution authority must not be used for paid-fact recovery'); }, documentedFree: false }, root);
      const factOwner = { signal: new AbortController().signal, assertCurrent() { owner.assertCurrentOwner(); } };
      const recovered = await accounting.settleRetainedRequest(binding, factOwner);
      expect(recovered.state).toBe('settled'); expect(await accounting.settleRetainedRequest(binding, factOwner)).toEqual(recovered);
      expect(recovered.terminal_receipt_json).toBe(row.terminal_receipt_json); expect(recovered.terminal_received_at).toBe(row.terminal_received_at);
      expect(root.query('SELECT count(*) n FROM token_usage').get()).toEqual({ n: 1 });
      expect(root.query('SELECT count(*) n FROM budget_usage_events').get()).toEqual({ n: 1 });
      expect(root.query('SELECT * FROM tasks ORDER BY id').all()).toEqual(tasks);
      expect(root.query('SELECT * FROM service_effect_s02_commits').all()).toEqual(terminals); expect(calls).toBe(1);
      // Only observational terminal reconciliation can now consume the input;
      // the mandatory source failure and original SDK task are never revived.
      expect(await dispatch!()).toBe('settled');
      expect(root.query("SELECT state FROM service_effect_s01_sources WHERE source_id='factory-input'").get()).toEqual({ state: 'consumed' });
      expect(JSON.stringify(root.query('SELECT content FROM messages WHERE is_bot_message=1').all())).toContain('Turn failed');
      expect(root.query('SELECT * FROM service_effect_s02_commits').all()).toHaveLength(1);
      expect(root.query('SELECT * FROM tasks ORDER BY id').all()).toEqual(tasks); expect(calls).toBe(1);
    } finally {
      terminalFenceSpy?.mockRestore(); backend.stop(); await backend.close();
      for (const spy of [...captureSpies, ...sdkSpies]) spy.mockRestore();
      closeDatabase(); owner.release();
    }
    return;
  }
  if (parentAccounting && !compactionAccounting) {
    try {
      expect(dispatchOutcome).toBe("settled");
      expect(calls).toBe(1);
      expect(root.query("SELECT state FROM budget_request_reservations").all()).toEqual([{ state: "settled" }]);
      expect(root.query("SELECT status, last_boundary FROM budget_work ORDER BY id").all()).toEqual([
        { status: "completed", last_boundary: "operation_settled" }, { status: "completed", last_boundary: "request_settled" },
      ]);
      expect(root.query("SELECT api_equivalent_cost_microusd FROM token_usage WHERE invocation_id IS NOT NULL").all()).toEqual([{ api_equivalent_cost_microusd: 10 }]);
      const retained = root.query('SELECT id,binding_sha256,terminal_receipt_json,terminal_receipt_sha256,terminal_received_at FROM budget_request_reservations').get() as {
        id: string; binding_sha256: string; terminal_receipt_json: string; terminal_receipt_sha256: string; terminal_received_at: string };
      expect(JSON.parse(retained.terminal_receipt_json)).toMatchObject({ version: 1, requestId: retained.id, requestBindingSha256: retained.binding_sha256,
        projectedOutcome: { role: 'assistant', provider: model.provider, model: model.id, stopReason: 'stop', usage: { totalTokens: 10 } } });
      expect(createHash('sha256').update(retained.terminal_receipt_json).digest('hex')).toBe(retained.terminal_receipt_sha256);
      expect(retained.terminal_received_at.slice(0, 10)).toBe(new Date().toISOString().slice(0, 10));
      if (scenario === 'native-parent-accounting-held-writer') {
        expect(performance.now() - terminalStarted).toBeGreaterThanOrEqual(5000); expect(terminalTicks).toBeGreaterThan(20);
        expect(JSON.parse(retained.terminal_receipt_json).projectedOutcome).toEqual(originalPaidTerminal);
        expect(root.query('SELECT count(*) n FROM token_usage').get()).toEqual({ n: 1 });
        expect(root.query('SELECT count(*) n FROM budget_usage_events').get()).toEqual({ n: 1 });
        expect(root.query("SELECT content FROM messages WHERE is_bot_message=1").all()).toEqual([{ content: 'factory synthetic reply' }]);
      }
    } finally {
      clearTimeout(terminalRelease); clearInterval(terminalPulse);
      if (terminalWriter?.inTransaction) terminalWriter.exec('ROLLBACK'); terminalWriter?.close();
      backend.stop(); await backend.close();
      for (const spy of [...captureSpies, ...sdkSpies]) spy.mockRestore();
      closeDatabase(); owner.release();
    }
    return;
  }
  if (scenario === "native-parent-budget-cap" || scenario === "native-parent-budget-auth-cap") {
    expect(dispatchOutcome).toBe(expectedFailedTurn ? "settled" : "pending");
    expect(root.query("SELECT state FROM service_effect_s01_sources WHERE source_id='factory-input'").get()).toEqual({ state: expectedFailedTurn ? "consumed" : "claimed" });
    expect(root.query("SELECT id FROM messages WHERE is_bot_message=1").all()).toHaveLength(expectedFailedTurn ? 1 : 0);
    expect(calls).toBe(0);
    expect(observedResults.size).toBe(0);
    expect(root.query("SELECT 1 FROM budget_caps WHERE enabled=1").get()).not.toBeNull();
    expect(sdkSpies.every(spy => spy.mock.calls.length === 0)).toBe(true);
    backend.stop(); await backend.close();
    for (const spy of [...captureSpies, ...sdkSpies]) spy.mockRestore();
    closeDatabase(); owner.release(); return;
  }
  if (codemodePlanCancelled || mcpCancelled || mcpConfigChanged || mcpCatalogChanged || mcpDisconnected || scenario === "native-codemode-cancel" || scenario === "native-codemode-binding-revoked") {
    if (mcpCancelled || mcpConfigChanged) expect(existsSync(mcpMarker)).toBe(false);
    expect(dispatchOutcome).toBe(expectedFailedTurn || mcpConfigChanged || mcpCatalogChanged || mcpDisconnected ? "settled" : "pending");
    expect(codemodeNestedCaptures).toBe(mcpCatalogChanged || mcpDisconnected ? 0 : 1);
    if (mcpCatalogChanged || mcpDisconnected) expect(readFileSync(mcpMarker, "utf8")).toBe("call\n");
    if (codemodePlanCancelled) {
      expect(calls).toBe(1);
      expect(realToolCaptures).toBe(2);
      expect(extensionKvGet("plan-sidebar", "plan", "chat", "web:default")).toMatchObject({ markdown: "- [ ] NATIVE_PLAN_OLD" });
      expect(root.query("SELECT scope_key FROM extension_kv WHERE extension_id='plan-sidebar'").all()).toEqual([{ scope_key: "web:default" }]);
      expect(root.query("SELECT * FROM service_effect_s02_commits").all()).toHaveLength(expectedFailedTurn ? 1 : 0);
      expect(sdkSpies.every(spy => spy.mock.calls.length === 0)).toBe(true);
    }
    expect(existsSync(join(workspace, "codemode-forbidden.txt"))).toBe(false);
    // Read-only SDK forensics: no base or delta may retain the revoked write.
    const storeRevisions = root.query(`SELECT r.content FROM document_revisions r JOIN documents d ON d.id=r.document_id WHERE d.kind='"pi.codemode.store"'`).all();
    expect(JSON.stringify(storeRevisions)).not.toContain("revoked-sentinel");
    expect(JSON.stringify(storeRevisions)).not.toContain("MUST_NOT_PERSIST");
    if (mcpConfigChanged || mcpCatalogChanged || mcpDisconnected) {
      // Configuration invalidation is a tool failure, not operation cancellation.
      expect(JSON.stringify([...observedResults.values()])).not.toContain("OWNED_MCP_SENTINEL");
      if (mcpCatalogChanged) expect(JSON.stringify([...observedResults.values()])).not.toContain("MCP_CATALOG_CHANGED");
    } else {
      expect(root.query("SELECT state FROM service_effect_s01_sources WHERE source_id='factory-input'").get()).toEqual({ state: expectedFailedTurn ? "consumed" : "claimed" });
      if (expectedFailedTurn) assertFailedTurn(); else expect(root.query("SELECT phase FROM service_effect_s01_operations WHERE operation_id=(SELECT active_operation_id FROM service_effect_s01_chats WHERE chat_jid='web:default')").get()).toEqual({ phase: scenario === "native-codemode-binding-revoked" ? "executing" : "cancelling" });
      expect(root.query("SELECT id FROM messages WHERE is_bot_message=1").all()).toHaveLength(expectedFailedTurn ? 1 : 0);
      expect(observedResults.size).toBe(0);
    }
    backend.stop(); await backend.close();
    if (mcpCancelled || mcpConfigChanged || mcpCatalogChanged || mcpDisconnected) expect(() => process.kill(Number(readFileSync(mcpPid, "utf8")), 0)).toThrow();
    for (const spy of [...captureSpies, ...sdkSpies]) spy.mockRestore();
    closeDatabase(); owner.release(); return;
  }
  if (nativeMcp) {
    expect(dispatchOutcome).toBe("settled");
    expect(readFileSync(mcpMarker, "utf8")).toBe(mcpConcurrent ? "call\ncall\n" : "call\n");
    const results = JSON.stringify([...observedResults.values()]);
    expect(results).toContain(mcpError ? "MCP_ERROR_SENTINEL" : mcpConcurrent ? "MCP_FIRST" : "OWNED_MCP_SENTINEL");
    if (mcpConcurrent) expect(results).toContain("MCP_SECOND");
    if (mcpError) {
      const records = root.query("SELECT record FROM entries").all().map(row => JSON.parse((row as { record: string }).record));
      const codemodeResult = records.filter(record => record.kind === "pi.tool-result").flatMap(record => record.model ?? []).find(message => message.toolName === "codemode");
      expect(codemodeResult).toBeDefined();
      expect(codemodeResult.details.calls).toMatchObject([{ name: "mcp__fixture__echo", status: "error" }]);
      // Schema-backed error data remains readable by scripts; the outer script succeeds.
      expect(codemodeResult.isError).toBe(false);
    }
    expect(sdkSpies.every(spy => spy.mock.calls.length === 0)).toBe(true);
    if (scenario === "native-mcp-cleanup-fail") {
      const { McpClient } = await import("../../node_modules/@earendil-works/pi-mcp");
      const { CodemodeSandbox } = await import("../../runtime/durable-engine/node_modules/@earendil-works/pi-codemode");
      const mcpFault = Error("MCP_CLOSE_FAULT"), sandboxFault = Error("SANDBOX_CLOSE_FAULT");
      const clientClose = spyOn(McpClient.prototype, "close").mockRejectedValue(mcpFault);
      const sandboxClose = spyOn(CodemodeSandbox.prototype, "close").mockRejectedValue(sandboxFault);
      const runtimeClose = spyOn(HostConversationRuntime.prototype, "close");
      let failure: unknown;
      try { await backend.close(); } catch (error) { failure = error; }
      expect(failure).toBeInstanceOf(AggregateError);
      expect((failure as AggregateError).errors).toContain(sandboxFault);
      expect(((failure as AggregateError).errors[0] as AggregateError).errors).toContain(mcpFault);
      expect(clientClose).toHaveBeenCalledTimes(1);
      expect(sandboxClose).toHaveBeenCalledTimes(1);
      expect(runtimeClose).toHaveBeenCalledTimes(1);
      expect(() => owner.assertCurrentOwner()).not.toThrow();
      clientClose.mockRestore(); sandboxClose.mockRestore(); runtimeClose.mockRestore();
      expect(() => process.kill(Number(readFileSync(mcpPid, "utf8")), 0)).toThrow();
      for (const spy of [...captureSpies, ...sdkSpies]) spy.mockRestore();
      closeDatabase(); owner.release(); return;
    }
    backend.stop(); await backend.close();
    const pid = Number(readFileSync(mcpPid, "utf8"));
    expect(() => process.kill(pid, 0)).toThrow();
    for (const spy of [...captureSpies, ...sdkSpies]) spy.mockRestore();
    closeDatabase(); owner.release(); return;
  }
  if (tableCancelled) expect(widgetEvents).toHaveLength(0);
  expect(dispatchOutcome).toBe(!expectedFailedTurn && (tableCancelled || officeCancelled || drawioCancelled || scenario === "native-delegate-revoke-cap" || scenario === "native-delegate-standard-revoke") ? "pending" : "settled");
  if (nativeDrawio) {
    expect(realToolCaptures).toBe(codemodeDrawio ? drawioCancelled ? 2 : 3 : drawioCancelled ? 1 : 2);
    if (codemodeDrawio) {
      expect(drawioNestedCaptures).toBe(drawioCancelled ? 1 : 2);
      expect(drawioCreates).toBe(drawioCancelled ? 0 : 1);
      expect(drawioRequests).toHaveLength(drawioCancelled ? 0 : 2);
      expect(calls).toBe(drawioCancelled ? 1 : 2);
      expect(toolSequence).toEqual([]);
      expect(sdkSpies.every(spy => spy.mock.calls.length === 0)).toBe(true);
    }
    expect(readFileSync(join(workspace, "existing.drawio"), "utf8")).toBe("PRESERVED_DRAWIO");
    if (drawioCancelled) {
      expect(existsSync(join(workspace, drawioPath))).toBe(false);
      if (codemodeDrawio) {
        if (expectedFailedTurn) assertFailedTurn(); else expect(root.query("SELECT phase FROM service_effect_s01_operations WHERE operation_id=(SELECT active_operation_id FROM service_effect_s01_chats WHERE chat_jid='web:default')").get()).toEqual({ phase: "cancelling" });
        expect(root.query("SELECT * FROM service_effect_s02_commits").all()).toHaveLength(expectedFailedTurn ? 1 : 0);
        const stores = root.query(`SELECT r.content FROM document_revisions r JOIN documents d ON d.id=r.document_id WHERE d.kind='"pi.codemode.store"'`).all();
        expect(JSON.stringify(stores)).not.toContain("revoked-drawio");
        expect(JSON.stringify(stores)).not.toContain("MUST_NOT_PERSIST");
      }
      expect(observedResults.size).toBe(0);
      expect(root.query("SELECT state FROM service_effect_s01_sources WHERE source_id='factory-input'").get()).toEqual({ state: expectedFailedTurn ? "consumed" : "claimed" });
      expect(root.query("SELECT id FROM messages WHERE is_bot_message=1").all()).toHaveLength(expectedFailedTurn ? 1 : 0);
    } else {
      expect(readFileSync(join(workspace, drawioPath), "utf8")).toContain("<mxfile");
      expect(observedResults.get("factory-tool-1")?.isError).not.toBe(true);
      if (codemodeDrawio) {
        expect(readFileSync(join(workspace, drawioPath), "utf8")).toBe(drawioDefaultXml!);
        expect(observedResults.size).toBe(1);
        const result = observedResults.get("factory-tool-1")!;
        expect(result.toolName).toBe("codemode");
        const text = (result.content as { text: string }[]).map(block => block.text).join("\n");
        expect(text).toContain("Opened codemode-diagrams/new.drawio in the Draw.io editor pane.");
        expect(text).toContain("Opened existing.drawio in the Draw.io editor pane.");
        expect(text.length).toBeLessThan(4096);
        for (const hidden of ["editorUrl", "/drawio/edit", "<mxfile", "request_id", "open_workspace_file", ...drawioRequests]) {
          expect(text).not.toContain(hidden);
          expect(planRequests[1]).not.toContain(hidden);
        }
        expect(root.query("SELECT state FROM service_effect_s01_sources WHERE source_id='factory-input'").get()).toEqual({ state: "consumed" });
        expect(root.query("SELECT id FROM messages WHERE is_bot_message=1").all()).toHaveLength(1);
        expect(root.query("SELECT * FROM service_effect_s02_commits").all()).toHaveLength(1);
      }
    }
    if (drawioCancelled || drawioMissingOpener) expect(sseText).not.toContain("extension_ui_request");
    else expect(sseText).toContain("extension_ui_request");
    if (drawioMissingOpener) {
      const result = JSON.stringify(observedResults.get("factory-tool-1")?.content);
      expect(result).toContain("Fallback URL: /drawio/edit?path=nested%2Fnew.drawio");
      expect(result).toContain("Draw.io channel opener unavailable");
      expect(result).not.toContain("Opened nested/new.drawio");
    }
    const route = await channel.handleRequest(new Request("http://fixture/drawio/index.html"));
    expect(route.status).toBe(200); expect(await route.text()).toBe("DRAWIO_NATIVE_FIXTURE");
    await sseReader!.cancel(); await sseDrain;
    captureSpies.forEach(spy => spy.mockRestore());
    backend.stop();
    // stop seals scheduling, but execution dependencies remain until SDK close.
    expect((await channel.handleRequest(new Request("http://fixture/drawio/index.html"))).status).toBe(200);
    await channel.stop(); await base.queue.shutdown(); await pool.shutdown(); await backend.close();
    const sealed = await channel.handleRequest(new Request("http://fixture/drawio/index.html"));
    expect(sealed.status).toBe(503);
    sdkSpies.forEach(spy => spy.mockRestore()); owner.release(); closeDatabase(); return;
  }
  if (nativeOffice) {
    expect(realToolCaptures).toBe(codemodeOffice ? 2 : officeCancelled ? 1 : 4);
    expect(readFileSync(join(workspace, officePath), "utf8")).toBe("name,value\nfixture,1650\n");
    if (codemodeOffice) {
      expect(officeNestedCaptures).toBe(1);
      expect(calls).toBe(officeCancelled ? 1 : 2);
      expect(toolSequence).toEqual([]);
      expect(sdkSpies.every(spy => spy.mock.calls.length === 0)).toBe(true);
    }
    const records = JSON.stringify(root.query("SELECT * FROM entries").all());
    if (officeCancelled) {
      expect(observedResults.size).toBe(0);
      expect(records).not.toContain("Office viewer URL:");
      expect(root.query("SELECT id FROM messages WHERE is_bot_message=1").all()).toHaveLength(expectedFailedTurn ? 1 : 0);
      if (codemodeOffice) {
        expect(root.query("SELECT state FROM service_effect_s01_sources WHERE source_id='factory-input'").get()).toEqual({ state: expectedFailedTurn ? "consumed" : "claimed" });
        if (expectedFailedTurn) assertFailedTurn(); else expect(root.query("SELECT phase FROM service_effect_s01_operations WHERE operation_id=(SELECT active_operation_id FROM service_effect_s01_chats WHERE chat_jid='web:default')").get()).toEqual({ phase: "cancelling" });
        expect(root.query("SELECT * FROM service_effect_s02_commits").all()).toHaveLength(expectedFailedTurn ? 1 : 0);
        const stores = root.query(`SELECT r.content FROM document_revisions r JOIN documents d ON d.id=r.document_id WHERE d.kind='"pi.codemode.store"'`).all();
        expect(JSON.stringify(stores)).not.toContain("revoked-office");
        expect(JSON.stringify(stores)).not.toContain("MUST_NOT_PERSIST");
      }
    } else {
      const result = observedResults.get("factory-tool-1");
      expect(result?.isError).not.toBe(true);
      const text = (result!.content as { text: string }[]).map(block => block.text).join("\n");
      assert(text.includes("Office viewer URL: "), text);
      const viewer = new URL(codemodeOffice ? text.match(/Office viewer URL: (\S+)/)![1]! : text.split("\n")[0]!.replace("Office viewer URL: ", ""), "http://fixture");
      expect(viewer.pathname).toBe("/office-viewer/");
      const raw = new URL(viewer.searchParams.get("url")!, "http://fixture");
      expect(raw.pathname).toBe("/workspace/raw");
      expect(raw.searchParams.get("path")).toBe(join(workspace, officePath));
      const response = await channel.handleRequest(new Request(raw));
      expect(response.status).toBe(200);
      expect(await response.text()).toBe("name,value\nfixture,1650\n");
      if (!codemodeOffice) expect(records).toContain("viewerUrl");
      if (codemodeOffice) {
        expect(observedResults.size).toBe(1);
        expect(result?.toolName).toBe("codemode");
        expect(text.length).toBeLessThan(4096);
        for (const hidden of ["viewerUrl", "fileName", "fileType", "name,value", "fixture,1650"]) {
          expect(text).not.toContain(hidden);
          expect(planRequests[1]).not.toContain(hidden);
        }
        expect(root.query("SELECT id FROM messages WHERE is_bot_message=1").all()).toHaveLength(1);
      } else for (const id of [2, 3, 4]) {
        expect(observedResults.get(`factory-tool-${id}`)?.isError).toBe(true);
        expect(JSON.stringify(observedResults.get(`factory-tool-${id}`))).toContain("Host tool execution failed");
      }
    }
    captureSpies.forEach(spy => spy.mockRestore());
    await channel.stop(); await base.queue.shutdown(); await pool.shutdown(); backend.stop(); await backend.close(); owner.release(); closeDatabase();
    sdkSpies.forEach(spy => spy.mockRestore());
    return;
  }
  if (nativeDelegate) {
    if (writeDelegate) {
      for (const id of revokeDelegate ? ["A"] : ["A", "B"]) expect(readFileSync(childWritePath(id), "utf8")).toBe(standardDelegate && !revokeDelegate ? `WRITTEN_${id}` : "OLD");
      expect(childRequests).toBe(revokeDelegate ? 1 : 4);
      if (revokeDelegate) {
        expect(calls).toBe(2);
        expect(root.query("SELECT id FROM messages WHERE is_bot_message=1").all()).toHaveLength(expectedFailedTurn ? 1 : 0);
        expect(root.query("SELECT state FROM service_effect_s01_sources WHERE source_id='factory-input'").get()).toEqual({ state: expectedFailedTurn ? "consumed" : "claimed" });
      }
      const writes = [...observedResults.values()].filter(result => result.toolName === "write");
      expect(writes).toHaveLength(revokeDelegate ? 0 : 2);
      expect(writes.every(result => !!result.isError === (readonlyDeny || revokeDelegate))).toBe(true);
      const childIds = root.query("SELECT id FROM conversations WHERE owner_task_id IS NOT NULL").all() as { id: number }[];
      expect(childIds).toHaveLength(revokeDelegate ? 1 : 2);
      for (const child of childIds) {
        const records = root.query("SELECT record FROM entries WHERE conversation_id=?").all(child.id) as { record: string }[];
        const exposed = records.flatMap(row => JSON.parse(row.record).model ?? []).flatMap((message: { toolsAdded?: { name: string }[] }) => message.toolsAdded ?? []).map((tool: { name: string }) => tool.name).sort();
        expect(exposed).toEqual((standardDelegate ? ["read", "bash", "edit", "write", "find", "ls", "grep"] : ["read", "grep", "find", "ls"]).sort());
      }
      if (revokeDelegate) expect(childSourceCaptures).toBe(1);
      captureSpies.forEach(spy => spy.mockRestore());
      await channel.stop(); await base.queue.shutdown(); await pool.shutdown(); backend.stop(); await backend.close(); owner.release(); closeDatabase();
      sdkSpies.forEach(spy => spy.mockRestore()); return;
    }
    if (revokeDelegate) {
      expect(childSourceCaptures).toBe(1);
      const capped = scenario === "native-delegate-revoke-cap";
      expect(childRequests).toBe(1);
      expect(calls).toBe(capped ? 2 : 3);
      expect(sentinelReads).toBe(0);
      expect(requested).toEqual(capped ? [model.id, modelB.id] : [model.id, modelB.id, model.id]);
      expect(root.query("SELECT id FROM conversations WHERE owner_task_id IS NOT NULL").all()).toHaveLength(1);
      const entries = JSON.stringify(root.query("SELECT * FROM entries").all());
      expect(entries).not.toContain(sentinel);
      expect(planRequests.join("\n")).not.toContain(sentinel);
      if (capped) {
        expect(observedResults.size).toBe(0);
        expect(root.query("SELECT id FROM messages WHERE is_bot_message=1").all()).toHaveLength(expectedFailedTurn ? 1 : 0);
        expect(root.query("SELECT state FROM service_effect_s01_sources WHERE source_id='factory-input'").get()).toEqual({ state: expectedFailedTurn ? "consumed" : "claimed" });
        captureSpies.forEach(spy => spy.mockRestore());
        await channel.stop(); await base.queue.shutdown(); await pool.shutdown(); backend.stop(); await backend.close(); owner.release(); closeDatabase();
        sdkSpies.forEach(spy => spy.mockRestore()); return;
      }
      // The revoked child cannot make a follow-up model request to observe its
      // tool result. Only the parent's Delegate policy failure is delivered.
      expect(observedResults.size).toBe(1);
      expect(observedResults.has("child-private-read")).toBe(false);
      expect(observedResults.get("A")).toMatchObject({ toolName: "delegate", isError: true });
      expect(JSON.stringify(observedResults.get("A"))).not.toContain(sentinel);
      expect(JSON.stringify(observedResults.get("A"))).toContain("Native Delegate model not approved");
      expect(JSON.stringify(root.query("SELECT content FROM messages WHERE is_bot_message=1").all())).not.toContain(sentinel);
      expect(sdkSpies.every(spy => spy.mock.calls.length === 0)).toBe(true);
      captureSpies.forEach(spy => spy.mockRestore());
      await channel.stop(); await base.queue.shutdown(); await pool.shutdown(); backend.stop(); await backend.close(); owner.release(); closeDatabase();
      sdkSpies.forEach(spy => spy.mockRestore());
      return;
    }
    expect(childRequests).toBe(delegateAllowed ? 2 : 0);
    expect(calls).toBe(delegateAllowed ? 4 : 2);
    const children = root.query("SELECT id, owner_task_id FROM conversations WHERE owner_task_id IS NOT NULL").all();
    expect(children).toHaveLength(delegateAllowed ? 2 : 0);
    if (explicitDelegate && delegateAllowed) {
      const explicitId = String(explicitDelegate.model).slice(model.provider.length + 1);
      expect(childModels.sort()).toEqual([model.id, explicitId].sort());
      expect(requested[0]).toBe(model.id); expect(requested.at(-1)).toBe(model.id);
      expect(await first!.readModel!()).toBe(`${model.provider}/${model.id}`);
    }
    expect(observedResults.size).toBe(2);
    if (delegateFiles) {
      expect(await first!.readModel!()).toBe(`${model.provider}/${model.id}`);
      expect(JSON.stringify(observedResults.get("A"))).not.toContain("NATIVE_FILE_BYTES");
      expect(JSON.stringify(observedResults.get("B"))).not.toContain("NATIVE_FILE_BYTES");
    }
    if (timeoutDelegate) {
      expect(timeoutProviderAborted).toBe(true);
      expect(observedResults.get("A")).toMatchObject({ toolName: "delegate", isError: true });
      expect(JSON.stringify(observedResults.get("A"))).toContain("timed out after 10s");
      expect(!!observedResults.get("B")?.isError).toBe(false);
      expect(sdkSpies.every(spy => spy.mock.calls.length === 0)).toBe(true);
      deadlineSpy!.mockRestore();
    } else for (const result of observedResults.values()) expect(!!result.isError).toBe(!delegateAllowed);
    await channel.stop(); await base.queue.shutdown(); await pool.shutdown(); backend.stop(); await backend.close(); owner.release(); closeDatabase();
    sdkSpies.forEach(spy => spy.mockRestore());
    return;
  }
  if (nativeTable) {
    expect(calls).toBe(tableCancelled ? 1 : 2);
    const denied = codemodeTable ? codemodeTableCancelled : !["native-editable-table", "native-editable-table-branch"].includes(scenario);
    expect(realToolCaptures).toBe(codemodeTable ? 2 : 1);
    if (codemodeTable) {
      expect(tableNestedCaptures).toBe(1);
      expect(toolSequence).toEqual([]);
    }
    expect(widgetEvents).toHaveLength(denied ? 0 : 1);
    if (!denied) expect(widgetEvents[0]).toMatchObject({ event: "extension_ui_widget", data: { chat_jid: tableChat, content: ["| Name | Role |\n| --- | --- |\n| Rui | User |"], options: { extension: "editable-table", surface: "floating-widget", title: codemodeTable ? "Nested table" : "People", headers: ["Name", "Role"], rows: [["Rui", "User"]] } } });
    if (tableCancelled) {
      expect(observedResults.size).toBe(0);
      if (codemodeTableCancelled) {
        expect(root.query("SELECT state FROM service_effect_s01_sources WHERE source_id='factory-input'").get()).toEqual({ state: expectedFailedTurn ? "consumed" : "claimed" });
        if (expectedFailedTurn) assertFailedTurn(); else expect(root.query("SELECT phase FROM service_effect_s01_operations WHERE operation_id=(SELECT active_operation_id FROM service_effect_s01_chats WHERE chat_jid='web:default')").get()).toEqual({ phase: "cancelling" });
        expect(root.query("SELECT * FROM service_effect_s02_commits").all()).toHaveLength(expectedFailedTurn ? 1 : 0);
        const stores = JSON.stringify(root.query(`SELECT r.content FROM document_revisions r JOIN documents d ON d.id=r.document_id WHERE d.kind='"pi.codemode.store"'`).all());
        expect(stores).not.toContain("revoked-table");
        expect(stores).not.toContain("MUST_NOT_PERSIST");
      }
      expect(root.query("SELECT operation_id FROM service_effect_s01_operations WHERE chat_jid=? AND terminal_disposition='completed'").all(tableChat)).toHaveLength(0);
      expect(root.query("SELECT id FROM messages WHERE chat_jid=? AND is_bot_message=1").all(tableChat)).toHaveLength(expectedFailedTurn ? 1 : 0);
    } else expect(!!observedResults.get("factory-tool-1")?.isError).toBe(denied);
    if (!denied) {
      if (codemodeTable) {
        expect(observedResults.size).toBe(1);
        expect(observedResults.get("factory-tool-1")).toMatchObject({ toolName: "codemode" });
        const result = JSON.stringify(observedResults.get("factory-tool-1")?.content);
        expect(result.length).toBeLessThan(4096);
        expect(result).toContain("Opened the editable table widget.");
        expect(result).not.toContain("markdown_table");
        expect(result).not.toContain("floating-widget");
        expect(root.query("SELECT * FROM service_effect_s02_commits").all()).toHaveLength(1);
        expect(root.query("SELECT state FROM service_effect_s01_sources WHERE source_id='factory-input'").get()).toEqual({ state: "consumed" });
      }
      const editedMarkdown = "| Name | Role |\n| --- | --- |\n| Rui | Editor |";
      const response = await channel.handleRequest(new Request(`http://fixture/agent/default/message?chat_jid=${encodeURIComponent(tableChat)}`, {
        method: "POST", headers: { "Content-Type": "application/json", Origin: "http://fixture" }, body: JSON.stringify({ content: editedMarkdown }),
      }));
      expect(response.status).toBe(201);
      for (let n = 0; n < 200 && !planRequests.at(-1)?.includes("Editor"); n++) await Bun.sleep(10);
      expect(planRequests.at(-1)).toContain(editedMarkdown.replaceAll("\n", "\\n"));
      expect(root.query("SELECT content FROM messages WHERE chat_jid=? AND content=? AND is_bot_message=0").get(tableChat, editedMarkdown)).toBeDefined();
      const completed = () => (root.query("SELECT count(*) AS n FROM service_effect_s01_operations WHERE chat_jid=? AND phase='terminal' AND terminal_disposition='completed'").get(tableChat) as { n: number }).n;
      for (let n = 0; n < 200 && completed() !== 2; n++) await Bun.sleep(10);
      expect(completed()).toBe(2);
      if (codemodeTable) {
        expect(root.query("SELECT * FROM service_effect_s02_commits").all()).toHaveLength(2);
        expect(root.query("SELECT state FROM service_effect_s01_sources WHERE chat_jid=? ORDER BY source_seq").all(tableChat)).toEqual([{ state: "consumed" }, { state: "consumed" }]);
        expect(calls).toBe(3);
      }
    }
    await sseReader!.cancel(); await sseDrain;
    expect(sseText.match(/event: extension_ui_widget\n/g) ?? []).toHaveLength(denied ? 0 : 1);
    if (!denied) {
      expect(sseText).toContain(`"chat_jid":"${tableChat}"`);
      if (codemodeTable) {
        const payloads = sseText.split("\n\n").filter(frame => frame.includes("event: extension_ui_widget\n")).map(frame => JSON.parse(frame.split("\n").find(line => line.startsWith("data: "))!.slice(6)));
        expect(payloads).toHaveLength(1);
        expect(payloads[0]).toMatchObject({ chat_jid: tableChat, options: { title: "Nested table", headers: ["Name", "Role"], rows: [["Rui", "User"]] } });
      }
    }
    if (codemodeTable) expect(sdkSpies.every(spy => spy.mock.calls.length === 0)).toBe(true);
    captureSpies.forEach(spy => spy.mockRestore());
    await channel.stop(); await base.queue.shutdown(); await pool.shutdown(); backend.stop(); await backend.close(); owner.release(); closeDatabase();
    sdkSpies.forEach(spy => spy.mockRestore());
    return;
  }
  if (nativePlan) {
    expect(calls).toBe(2);
    // Two model source captures + two plan snapshots, plus the real pending
    // beforeTool admission added by the native background-policy hook. Goal
    // adds request snapshots and its terminal fence at both model/nested tools.
    // None may use a legacy session owner; exact call IDs distinguish the hooks.
    expect(pendingAdmissionCaptures).toBe(codemodePlan ? nativeGoal ? 4 : 2 : 1);
    expect(pendingAdmissionCalls).toEqual(codemodePlan ? nativeGoal
      ? ["factory-tool-1","factory-tool-1","factory-tool-1/c1","factory-tool-1/c1"]
      : ["factory-tool-1","factory-tool-1/c1"] : ["factory-tool-1"]);
    expect(realRunCaptures).toBe(scenario === "native-codemode-plan-goal" ? 8 : 5); expect(realToolCaptures).toBe(codemodePlan ? 2 : 1);
    if (codemodePlan) expect(codemodeNestedCaptures).toBe(1);
    captureSpies.forEach(spy => spy.mockRestore());
    expect(planRequests[0]).toContain(planInitiallyEmpty ? defaultPlanStep : "NATIVE_PLAN_OLD");
    expect(planRequests[1]).toContain(planStep);
    const contextBefore = JSON.parse(planRequests[0]!) as { messages: { role: string }[] };
    const contextAfter = JSON.parse(planRequests[1]!) as typeof contextBefore;
    const dialogueBefore = contextBefore.messages.filter(message => message.role !== "system");
    const dialogueAfter = contextAfter.messages.filter(message => message.role !== "system");
    expect(JSON.stringify(dialogueAfter.slice(0, dialogueBefore.length))).toBe(JSON.stringify(dialogueBefore));
    expect(contextAfter.messages.filter(message => message.role === "system"))
      .toEqual(contextBefore.messages.filter(message => message.role === "system"));
    for (const [index, request] of planRequests.entries()) {
      expect(request.match(/Current Plan Sidebar checklist/g)).toHaveLength(index + 1);
      expect(request.match(/## Plan Sidebar/g)).toHaveLength(1);
    }
    const storedSnapshots = (root.query("SELECT record FROM entries WHERE json_extract(record, '$.kind')='host.plan-context' ORDER BY id").all() as { record: string }[])
      .map(row => JSON.parse(row.record));
    expect(storedSnapshots).toHaveLength(2);
    expect(JSON.stringify(storedSnapshots[0])).toContain(planInitiallyEmpty ? defaultPlanStep : "NATIVE_PLAN_OLD");
    expect(JSON.stringify(storedSnapshots[1])).toContain(planStep);
    expect(JSON.stringify(await first!.readTree!())).not.toContain("Current Plan Sidebar checklist");
    if (codemodePlan) {
      expect(observedResults.get("factory-tool-1")?.toolName).toBe("codemode");
      expect(observedResults.get("factory-tool-1")?.isError).not.toBe(true);
      expect(JSON.stringify(observedResults.get("factory-tool-1")?.content)).toContain("Plan updated.");
    } else expect(observedResults.get("factory-tool-1")).toMatchObject({ toolName: "plan", content: [{ type: "text", text: planClear ? "Updated plan for web:default." : "Plan updated." }] });
    expect(extensionKvGet("plan-sidebar", "plan", "chat", "web:default")).toMatchObject({ markdown: expectedPlanMarkdown });
    expect(root.query("SELECT scope_key FROM extension_kv WHERE extension_id='plan-sidebar'").all()).toEqual([{ scope_key: "web:default" }]);
    expect(root.query("SELECT content FROM messages WHERE chat_jid='web:default' AND is_bot_message=1").all()).toEqual([{ content: "factory synthetic reply" }]);
    expect(root.query("SELECT state FROM service_effect_s01_sources WHERE source_id=?").get(message.id)).toEqual({ state: "consumed" });
    expect(sdkSpies.every(spy => spy.mock.calls.length === 0)).toBe(true);
    await channel.stop(); await base.queue.shutdown(); await pool.shutdown(); backend.stop(); await backend.close();
    closeDatabase(); initDatabase();
    expect(extensionKvGet("plan-sidebar", "plan", "chat", "web:default")).toMatchObject({ markdown: expectedPlanMarkdown });
    backend = await createDefaultApplicationRuntime(owner, async () => services);
    expect(backend.sessionOptions.getDurableSession!("web:default")).toBeDefined();
    backend.stop(); await backend.close();
    sdkSpies.forEach(spy => spy.mockRestore()); owner.release(); closeDatabase();
    return;
  }
  expect(calls).toBe(1);
  expect(await pool.applyControlCommand("web:default", { type: "abort", raw: "/abort" }))
    .toMatchObject({ status: "success", message: "No active durable operation." });
  expect(sdkSpies.every(spy => spy.mock.calls.length === 0)).toBe(true);
  const persistedModel = await first!.readModel!();
  expect((await pool.getAvailableModels("web:default", { includeProviderUsage: false, includeProviderDiagnostics: false })).thinking_level).toBe(await first!.readThinkingLevel!());
  expect(await pool.applyControlCommand("web:default", { type: "thinking", raw: "/thinking" })).toMatchObject({ status: "success", thinking_level: await first!.readThinkingLevel!() });
  const thinkingDefault = settings.getDefaultThinkingLevel();
  const thinkingModel = await first!.readModel!();
  const thinkingIdentity = first!.sessionId;
  const reasoningHistory = root.query("SELECT * FROM entries ORDER BY id").all();
  expect(await pool.applyControlCommand("web:default", { type: "thinking", level: "high", raw: "/thinking high" })).toMatchObject({ status: reasoningThinking ? "success" : "error" });
  if (reasoningThinking) {
    expect(await first!.readThinkingLevel!()).toBe("high");
    expect((await pool.getAvailableModels("web:default", { includeProviderUsage: false, includeProviderDiagnostics: false })).thinking_level).toBe("high");
    expect(await pool.applyControlCommand("web:default", { type: "thinking", raw: "/thinking" })).toMatchObject({ thinking_level: "high" });
    expect(await first!.readModel!()).toBe(thinkingModel);
    expect(first!.sessionId).toBe(thinkingIdentity);
    expect(settings.getDefaultThinkingLevel()).toBe(thinkingDefault);
    expect(root.query("SELECT * FROM entries ORDER BY id").all()).toEqual(reasoningHistory);
  }
  const thinkingHistory = root.query("SELECT * FROM entries ORDER BY id").all();
  expect(await pool.applyControlCommand("web:default", { type: "thinking", level: "off", raw: "/thinking off" })).toMatchObject({ status: "success", thinking_level: "off" });
  expect(await first!.readThinkingLevel!()).toBe("off");
  expect(root.query("SELECT * FROM entries ORDER BY id").all()).toEqual(thinkingHistory);
  const modelQuery = await pool.applyControlCommand("web:default", { type: "model", raw: "/model" });
  expect(modelQuery.status).toBe("success");
  expect(modelQuery.message).toContain(`${model.provider}/${model.id} (current)`);
  expect(modelQuery.message).toContain(`${modelB.provider}/${modelB.id}`);
  expect(await first!.readModel!()).toBe(persistedModel);
  expect(calls).toBe(1);
  if (scenario === "public-shim-compaction" || compactionAccounting) {
    const beforeCalls = calls;
    const beforeModel = await first!.readModel!();
    const identity = first!.sessionId;
    inManualSummary = true;
    if (scenario === "native-compaction-accounting-auto" || scenario === "native-compaction-accounting-background" || compactionAutoPending) {
      backend.stop(); await backend.close(); compactionPolicySpy!.mockRestore();
      const open = Harness.open;
      const background = scenario.endsWith("background");
      compactionPolicySpy = spyOn(Harness, "open").mockImplementation((storage, options, ctx) => open.call(Harness, storage, { ...options,
        settings: { ...options.settings, compaction: { enabled: true, keepRecentTokens: 1,
          reserveTokens: background ? 1000 : 99999, backgroundTokens: background ? 99000 : 0 } } }, ctx));
      backend = await createDefaultApplicationRuntime(owner, async () => services);
      const automaticBound = backend.bind({ queue: base.queue, agentPool: pool });
      const next = { ...message, id: "factory-automatic-compaction", content: "continue after automatic compaction" };
      const row = root.transaction(() => { const rowId = storeMessage(next);
        automaticBound.getInputSourceAdmission!(next.chat_jid)!({ message: next, rowId, database: root }); return rowId; })();
      const automaticResult = await automaticBound.dispatchAcceptedInput!(next.chat_jid, next.id, row!)!();
      if (compactionAutoPending) {
        expect(automaticResult).toBe('pending'); expect(calls).toBe(beforeCalls + 1);
        const pending = root.query("SELECT r.*,w.parent_work_id AS maintenance_id FROM budget_request_reservations r JOIN budget_work w ON w.id=r.work_id WHERE json_extract(r.model_invocation_json,'$.taskKind')='pi.compaction'").get() as BudgetRequestReservation & { maintenance_id: string };
        expect(pending.state).toBe('unresolved'); expect(pending.terminal_receipt_json).not.toBeNull();
        const operation = root.query('SELECT operation_id,phase FROM service_effect_s01_operations ORDER BY rowid DESC LIMIT 1').get() as { operation_id: string; phase: string };
        expect(operation.phase).toBe('executing');
        expect(root.query('SELECT parent_work_id FROM budget_work WHERE id=?').get(pending.maintenance_id)).toEqual({ parent_work_id: `durable-operation:${operation.operation_id}` });
        expect(root.query('SELECT 1 FROM service_effect_s02_commits WHERE operation_id=?').get(operation.operation_id)).toBeNull();
        expect(root.query('SELECT state FROM service_effect_s01_sources WHERE source_id=?').get(next.id)).toEqual({ state: 'claimed' });
        expect(root.query('SELECT count(*) n FROM token_usage WHERE invocation_id=?').get(pending.id)).toEqual({ n: 0 });
        root.exec('DROP TRIGGER compaction_pending_close');
        automaticCaptureSpy?.mockRestore(); backend.stop(); await backend.close(); compactionPolicySpy.mockRestore();
        for (const spy of [...captureSpies, ...sdkSpies]) spy.mockRestore(); closeDatabase(); owner.release(); return;
      }
      expect(automaticResult).toBe('settled');
      const deadline = Date.now() + 3000;
      while (!root.query("SELECT id FROM entries WHERE json_extract(record, '$.kind')='pi.compaction'").get() && Date.now() < deadline) await Bun.sleep(10);
      expect(root.query("SELECT id FROM entries WHERE json_extract(record, '$.kind')='pi.compaction'").all()).toHaveLength(1);
      expect(calls).toBe(beforeCalls + 2);
      expect(root.query("SELECT terminal_disposition FROM service_effect_s01_operations ORDER BY rowid DESC LIMIT 1").get()).toEqual({ terminal_disposition: "completed" });
      expect(root.query("SELECT state FROM service_effect_s01_sources WHERE source_id=?").get(next.id)).toEqual({ state: "consumed" });
      expect(root.query("SELECT r.state FROM budget_request_reservations r JOIN budget_work w ON w.id=r.work_id WHERE w.execution_kind='side_prompt'").all()).toEqual([{ state: "settled" }]);
      const maintenance = root.query("SELECT id,parent_work_id FROM budget_work WHERE id LIKE 'durable-maintenance:%'").get() as { id: string; parent_work_id: string | null };
      const operation = root.query('SELECT operation_id FROM service_effect_s01_operations ORDER BY rowid DESC LIMIT 1').get() as { operation_id: string };
      expect(maintenance.parent_work_id).toBe(background ? null : `durable-operation:${operation.operation_id}`);
      const closureDeadline = Date.now() + 3000;
      while (root.query("SELECT 1 FROM budget_work WHERE id=? AND status='active'").get(maintenance.id) && Date.now() < closureDeadline) await Bun.sleep(10);
      expect(root.query('SELECT status FROM budget_work WHERE id=?').get(maintenance.id)).toEqual({ status: 'completed' });
      automaticCaptureSpy?.mockRestore();
      backend.stop(); await backend.close(); compactionPolicySpy.mockRestore();
      for (const spy of [...captureSpies, ...sdkSpies]) spy.mockRestore();
      closeDatabase(); owner.release(); return;
    }
    if (scenario === "native-compaction-accounting-side-dispatch") {
      const historyBefore = root.query("SELECT * FROM entries ORDER BY id").all();
      const callsBefore = calls;
      const { ensureBudgetWork } = await import("../../runtime/src/db/budget-limits.js");
      const { withBudgetWorkContext } = await import("../../runtime/src/budget/context.js");
      ensureBudgetWork({ id: "native-side-parent", chatJid: "web:default", executionKind: "interactive" }, root);
      const sideEvents: string[] = [], sideText: string[] = [];
      const result = await withBudgetWorkContext({ workId: "native-side-parent", chatJid: "web:default", kind: "interactive" }, () => pool.runSidePrompt("web:default", "native isolated side prompt", {
        budgetWorkId: "stable-side-retry", systemPrompt: "SIDE_SYSTEM_PREFIX", onEvent(event) { sideEvents.push(event.type); }, onTextDelta(delta) { sideText.push(delta); },
      }));
      expect(result).toMatchObject({ status: "success", result: "factory synthetic reply", model: "openai-codex/approved" });
      expect(calls).toBe(callsBefore + 1);
      expect(sideEvents).toContain("done");
      expect(sideEvents).toContain("text_delta");
      expect(sideText.join("")).toBe("factory synthetic reply");
      expect(planRequests.at(-1)).toContain("SIDE_SYSTEM_PREFIX\\n\\nnative isolated side prompt");
      expect(first!.sessionId).toBe(identity);
      expect(await first!.readModel!()).toBe(beforeModel);
      const sideSource = root.query("SELECT source_id FROM service_effect_s01_sources WHERE kind='internal'").get() as { source_id: string };
      expect(sideSource.source_id).toMatch(/^side-prompt:/);
      expect(root.query(`SELECT r.state,w.execution_kind FROM budget_request_reservations r JOIN budget_work w ON w.id=r.work_id WHERE w.execution_kind='side_prompt'`).all()).toEqual([{ state: "settled", execution_kind: "side_prompt" }]);
      expect(root.query("SELECT status,parent_work_id FROM budget_work WHERE execution_kind='side_prompt' AND id LIKE 'durable-operation:%'").all()).toEqual([{ status: "completed", parent_work_id: "stable-side-retry" }]);
      expect(root.query("SELECT status,parent_work_id,execution_kind FROM budget_work WHERE id='stable-side-retry'").get()).toEqual({ status: "completed", parent_work_id: "native-side-parent", execution_kind: "side_prompt" });
      expect(root.query("SELECT status FROM budget_work WHERE id='native-side-parent'").get()).toEqual({ status: "active" });
      const debugResponse = await channel.handleRequest(new Request("http://fixture/agent/debug?chat_jid=web%3Adefault"));
      expect(debugResponse.status).toBe(200);
      const nativeDebug = await debugResponse.json() as { backend: string; tools: { name: string }[] };
      expect(nativeDebug.backend).toBe("durable");
      expect(nativeDebug.tools.map(tool => tool.name)).toContain("read");
      const nativeCommandsResponse = await channel.handleRequest(new Request("http://fixture/agent/commands?chat_jid=web%3Adefault"));
      expect(nativeCommandsResponse.status).toBe(200);
      const nativeCommands = await nativeCommandsResponse.json() as { backend: string; commands: { name: string }[] };
      expect(nativeCommands.backend).toBe("durable");
      expect(nativeCommands.commands.map(command => command.name)).toContain("/model");
      expect(nativeCommands.commands.map(command => command.name)).toContain("/passkeys");
      expect(sdkSpies.every(spy => spy.mock.calls.length === 0)).toBe(true);
      const callsBeforeReplay = calls;
      const replayed = await pool.runSidePrompt("web:default", "native isolated side prompt", { budgetWorkId: "stable-side-retry", budgetParentWorkId: "native-side-parent", systemPrompt: "SIDE_SYSTEM_PREFIX" });
      expect(replayed).toEqual(result);
      expect(calls).toBe(callsBeforeReplay);
      expect((await pool.runSidePrompt("web:default", "changed input", { budgetWorkId: "stable-side-retry", budgetParentWorkId: "native-side-parent" })).status).toBe("error");
      expect((await pool.runSidePrompt("web:default", "native isolated side prompt", { budgetWorkId: "stable-side-retry", systemPrompt: "SIDE_SYSTEM_PREFIX" })).status).toBe("error");
      expect(calls).toBe(callsBeforeReplay);
      const foreignContext = await withBudgetWorkContext({ workId: "foreign", chatJid: "web:foreign", kind: "interactive" }, () => pool.runSidePrompt("web:default", "native isolated side prompt", { budgetWorkId: "stable-side-retry", budgetParentWorkId: "native-side-parent", systemPrompt: "SIDE_SYSTEM_PREFIX" }));
      expect(foreignContext.status).toBe("error");
      expect(calls).toBe(callsBeforeReplay);
      const sourceCountBeforeParentDenial = root.query("SELECT count(*) AS n FROM service_effect_s01_sources").get();
      expect((await pool.runSidePrompt("web:default", "unknown parent", { budgetParentWorkId: "missing-parent" })).status).toBe("error");
      expect(root.query("SELECT count(*) AS n FROM service_effect_s01_sources").get()).toEqual(sourceCountBeforeParentDenial);
      expect(root.query("SELECT SUM(t.api_equivalent_cost_microusd) AS amount FROM token_usage t JOIN budget_work w ON w.id=t.work_id WHERE w.execution_kind='side_prompt'").get()).toEqual({ amount: 10 });
      expect(root.query("SELECT message_row_id FROM service_effect_s02_commits WHERE operation_id IN (SELECT operation_id FROM service_effect_s01_operations WHERE primary_source_seq=(SELECT source_seq FROM service_effect_s01_sources WHERE source_id=?))").get(sideSource.source_id)).toEqual({ message_row_id: null });
      expect(root.query("SELECT * FROM entries WHERE id <= ? ORDER BY id").all((historyBefore.at(-1) as { id: number }).id)).toEqual(historyBefore);
      expect(sdkSpies.every(spy => spy.mock.calls.length === 0)).toBe(true);
      let mutationEvents = 0;
      const mutationText: string[] = [];
      const mutation = await pool.runSidePrompt("web:default", "mutating observer", { onEvent(event) {
        mutationEvents++;
        if (event.type === "done") { event.message.content = []; event.message.usage.cost.total = 999; }
        if (event.type === "text_delta") event.delta = "MUTATED";
      }, onTextDelta(delta) { mutationText.push(delta); } });
      expect(mutation.status).toBe("success");
      expect(mutation.result).toBe("factory synthetic reply");
      expect(mutationText.join("")).toBe("factory synthetic reply");
      const eventsBeforeFailure = mutationEvents;
      let throwingCalls = 0;
      const throwing = await pool.runSidePrompt("web:default", "throwing observer", { onEvent() { throwingCalls++; throw Error("private callback failure"); } });
      expect(throwing.status).toBe("success");
      expect(throwingCalls).toBe(1);
      expect(mutationEvents).toBe(eventsBeforeFailure);
      expect(root.query("SELECT SUM(t.api_equivalent_cost_microusd) AS amount FROM token_usage t JOIN budget_work w ON w.id=t.work_id WHERE w.execution_kind='side_prompt'").get()).toEqual({ amount: 30 });
      expect(root.query("SELECT state FROM budget_request_reservations r JOIN budget_work w ON w.id=r.work_id WHERE w.execution_kind='side_prompt'").all()).toEqual([{ state: "settled" }, { state: "settled" }, { state: "settled" }]);
      const abortSide = new AbortController();
      let entered!: () => void;
      const ready = new Promise<void>(resolve => { entered = resolve; });
      checkpointHold = { entered };
      let cancelledEvents = 0;
      const cancelled = pool.runSidePrompt("web:default", "cancel owned side", { budgetWorkId: "stable-cancelled-side", signal: abortSide.signal, onEvent() { cancelledEvents++; } });
      await ready;
      const providerSignal = checkpointHold.signal;
      abortSide.abort();
      expect(await cancelled).toMatchObject({ status: "error", error: "Side prompt cancelled" });
      expect(providerSignal?.aborted).toBe(true);
      expect(cancelledEvents).toBe(0);
      expect(root.query("SELECT status FROM budget_work WHERE id='stable-cancelled-side'").get()).toEqual({ status: "active" });
      checkpointHold = undefined;
      expect(root.query("SELECT state FROM service_effect_s01_sources WHERE chat_jid='web:default' AND state NOT IN ('consumed','disposed')").all()).toEqual([]);
      expect(root.query("SELECT state FROM budget_request_reservations r JOIN budget_work w ON w.id=r.work_id WHERE w.execution_kind='side_prompt' ORDER BY r.rowid").all()).toEqual([{ state: "settled" }, { state: "settled" }, { state: "settled" }, { state: "unresolved" }]);
      expect(root.query("SELECT SUM(t.api_equivalent_cost_microusd) AS amount FROM token_usage t JOIN budget_work w ON w.id=t.work_id WHERE w.execution_kind='side_prompt'").get()).toEqual({ amount: 30 });
      const afterCancel = await pool.runSidePrompt("web:default", "after cancellation");
      expect(afterCancel.status).toBe("success");
      const toolRoot = (await first!.readPosition());
      const callsBeforeTool = calls;
      const toolHistory = root.query("SELECT * FROM entries ORDER BY id").all();
      writeFileSync(join(workspace, "native-side-read.txt"), "NATIVE_SIDE_READ_PROVENANCE");
      toolSequence = [{ name: "read", arguments: { path: "native-side-read.txt" } }];
      const toolRequestId = `factory-tool-${calls + 1}`;
      const toolSide = await pool.runSidePrompt("web:default", "read native-side-read.txt in isolated context");
      expect(toolSide.status).toBe("success");
      expect(calls).toBe(callsBeforeTool + 2);
      expect(observedResults.get(toolRequestId)).toMatchObject({ toolName: "read", isError: false });
      expect(JSON.stringify(observedResults.get(toolRequestId)?.content)).toContain("NATIVE_SIDE_READ_PROVENANCE");
      expect(await first!.readPosition()).toBe(toolRoot);
      expect(root.query("SELECT * FROM entries WHERE id <= ? ORDER BY id").all((toolHistory.at(-1) as { id: number }).id)).toEqual(toolHistory);
      toolSequence = undefined;
      expect(root.query("SELECT state FROM budget_request_reservations r JOIN budget_work w ON w.id=r.work_id WHERE w.execution_kind='side_prompt' AND r.state='unresolved'").all()).toHaveLength(1);
      expect(root.query("SELECT SUM(t.api_equivalent_cost_microusd) AS amount FROM token_usage t JOIN budget_work w ON w.id=t.work_id WHERE w.execution_kind='side_prompt'").get()).toEqual({ amount: 60 });
      const eventsBeforeHttp = sideEvents.length;
      const timelineBeforeHttp = root.query("SELECT * FROM messages WHERE chat_jid='web:default' ORDER BY rowid").all();
      const httpSide = await channel.handleRequest(new Request("http://fixture/agent/side-prompt/stream?chat_jid=web%3Adefault", {
        method: "POST", headers: { "Content-Type": "application/json", Origin: "http://fixture" },
        body: JSON.stringify({ prompt: "actual card stream consumer" }),
      }));
      expect(httpSide.status).toBe(200);
      expect(httpSide.headers.get("content-type")).toContain("text/event-stream");
      const sse = await httpSide.text();
      expect(sse).toContain('event: side_prompt_start');
      expect(sse).toContain('event: side_prompt_text_delta\ndata: {"delta":"factory synthetic reply"}');
      expect(sse).toContain('event: side_prompt_done\ndata: {"status":"success","result":"factory synthetic reply"');
      expect(sse).not.toContain('event: side_prompt_error');
      expect(sideEvents.length).toBe(eventsBeforeHttp);
      expect(root.query("SELECT * FROM messages WHERE chat_jid='web:default' ORDER BY rowid").all()).toEqual(timelineBeforeHttp);
      expect(sdkSpies.every(spy => spy.mock.calls.length === 0)).toBe(true);
      const { getAgentRuntimeConfig } = await import("../../runtime/src/core/config.js");
      const timeoutMs = getAgentRuntimeConfig().timeoutMs;
      const nativeSetTimeout = globalThis.setTimeout;
      let expireSide: (() => void) | undefined;
      const timerSpy = spyOn(globalThis, "setTimeout").mockImplementation(((callback: () => void, ms?: number, ...args: unknown[]) => {
        if (ms === timeoutMs) { expireSide = callback; return nativeSetTimeout(() => {}, timeoutMs); }
        return nativeSetTimeout(callback, ms, ...args);
      }) as typeof setTimeout);
      try {
        let timeoutEntered!: () => void;
        const timeoutReady = new Promise<void>(resolve => { timeoutEntered = resolve; });
        checkpointHold = { entered: timeoutEntered };
        const timed = pool.runSidePrompt("web:default", "configured side timeout");
        await timeoutReady;
        expect(expireSide).toBeDefined();
        const timeoutSignal = checkpointHold.signal;
        expireSide!();
        expect(await timed).toMatchObject({ status: "error", stopReason: "aborted" });
        expect(timeoutSignal?.aborted).toBe(true);
      } finally { timerSpy.mockRestore(); checkpointHold = undefined; }
      expect(root.query("SELECT state FROM service_effect_s01_sources WHERE chat_jid='web:default' AND state NOT IN ('consumed','disposed')").all()).toEqual([]);
      let disconnectEntered!: () => void;
      const disconnectReady = new Promise<void>(resolve => { disconnectEntered = resolve; });
      checkpointHold = { entered: disconnectEntered };
      const disconnect = new AbortController();
      const httpDisconnect = await channel.handleRequest(new Request("http://fixture/agent/side-prompt/stream?chat_jid=web%3Adefault", {
        method: "POST", headers: { "Content-Type": "application/json", Origin: "http://fixture" }, signal: disconnect.signal,
        body: JSON.stringify({ prompt: "disconnect card stream" }),
      }));
      const disconnectedBody = httpDisconnect.text();
      await disconnectReady;
      const disconnectedProvider = checkpointHold.signal;
      disconnect.abort();
      expect(await disconnectedBody).toContain("event: side_prompt_start");
      const disconnectDeadline = Date.now() + 2000;
      while (root.query("SELECT 1 FROM service_effect_s01_chats WHERE chat_jid='web:default' AND active_operation_id IS NOT NULL").get() && Date.now() < disconnectDeadline) await Bun.sleep(10);
      expect(disconnectedProvider?.aborted).toBe(true);
      expect(root.query("SELECT state FROM service_effect_s01_sources WHERE chat_jid='web:default' AND state NOT IN ('consumed','disposed')").all()).toEqual([]);
      expect(root.query("SELECT active_operation_id FROM service_effect_s01_chats WHERE chat_jid='web:default'").get()).toEqual({ active_operation_id: null });
      checkpointHold = undefined;
      const observerChargeBefore = root.query("SELECT SUM(t.api_equivalent_cost_microusd) AS amount,COUNT(*) AS n FROM token_usage t JOIN budget_work w ON w.id=t.work_id WHERE w.execution_kind='side_prompt'").get() as { amount: number; n: number };
      const callsBeforeAsyncObservers = calls;
      for (const kind of ["event", "text"] as const) {
        let observed = 0;
        const rejectObserver = async () => { observed++; throw Error("PRIVATE_ASYNC_OBSERVER_FAILURE"); };
        const reply = await pool.runSidePrompt("web:default", `asynchronous ${kind} observer`, kind === "event" ? { onEvent: rejectObserver } : { onTextDelta: rejectObserver });
        await Bun.sleep(0);
        expect(reply.status).toBe("success"); expect(reply.result).toBe("factory synthetic reply");
        expect(observed).toBe(1);
      }
      expect(calls).toBe(callsBeforeAsyncObservers + 2);
      expect(root.query("SELECT SUM(t.api_equivalent_cost_microusd) AS amount,COUNT(*) AS n FROM token_usage t JOIN budget_work w ON w.id=t.work_id WHERE w.execution_kind='side_prompt'").get()).toEqual({ amount: observerChargeBefore.amount + 20, n: observerChargeBefore.n + 2 });
      expect(capturedEventObservers.length).toBeGreaterThan(0);
      // Actual factory callback, after the source retired and optional observer unregistered.
      // Removing UI observation must not turn its captured authority fence into a no-op.
      const ownerFailure = Error("owned observer fixture lease revoked");
      const deniedOwner = spyOn(owner, "assertCurrentOwner").mockImplementation(() => { throw ownerFailure; });
      try { expect(() => capturedEventObservers.at(-1)!.assertCurrent()).toThrow(ownerFailure.message); }
      finally { deniedOwner.mockRestore(); }
      await channel.stop(); await base.queue.shutdown(); await pool.shutdown(); backend.stop(); await backend.close();
      const callsBeforeRestartReplay = calls;
      backend = await createDefaultApplicationRuntime(owner, async () => services);
      expect(await backend.sessionOptions.dispatchSidePrompt!("web:default", "native isolated side prompt", {
        budgetWorkId: "stable-side-retry", budgetParentWorkId: "native-side-parent", systemPrompt: "SIDE_SYSTEM_PREFIX",
      })).toEqual(result);
      expect(calls).toBe(callsBeforeRestartReplay);
      expect(root.query("SELECT status FROM budget_work WHERE id='native-side-parent'").get()).toEqual({ status: "active" });
      root.query("UPDATE budget_work SET status='completed' WHERE id='native-side-parent'").run();
      expect(await backend.sessionOptions.dispatchSidePrompt!("web:default", "native isolated side prompt", { budgetWorkId: "stable-side-retry", budgetParentWorkId: "native-side-parent", systemPrompt: "SIDE_SYSTEM_PREFIX" })).toEqual(result);
      expect(calls).toBe(callsBeforeRestartReplay);
      backend.stop(); await backend.close();
      observerPolicySpy?.mockRestore();
      compactionPolicySpy?.mockRestore();
      for (const spy of [...captureSpies, ...sdkSpies]) spy.mockRestore();
      closeDatabase(); owner.release(); return;
    }
    if (scenario === "native-compaction-accounting-side-provenance") {
      backend.stop(); await backend.close();
      const { createCurrentPiclawServiceWorkStore } = await import("../../runtime/src/service-effects/current-piclaw/service-work-store.js");
      const { value, sealed, effect } = await import("./src/host-handoff.js");
      const { hashCanonicalRequest } = await import("../../runtime/src/service-effects/contracts/common.js");
      const work = value(createCurrentPiclawServiceWorkStore(root, { hitFault: () => false, recordTrace() {} }));
      const id = `side-prompt:${crypto.randomUUID()}`, prompt = "side provenance fixture";
      const source = value(await work.acceptSource(sealed({ effect: effect(id), chatJid: "web:default", sourceId: id, kind: "internal" as const,
        payloadRef: id, targetOperationId: null, parentSourceSeq: null, acceptedAt: new Date().toISOString(), createWakeIntent: false })));
      const frontier = value(await work.getChatFrontier("web:default"));
      const claim = value(await work.claimNext(sealed({ effect: effect(`claim:${id}`), chatJid: "web:default",
        expectedFrontier: frontier.consumedThroughSourceSeq, newOperationId: crypto.randomUUID(), claimedAt: new Date().toISOString() })))!;
      const parentBinding = root.query("SELECT incarnation,conversation_id,branch_id FROM piclaw_durable_bindings_v1 WHERE chat_jid='web:default' LIMIT 1").get() as { incarnation: string; conversation_id: number; branch_id: string };
      const path = (root.query("PRAGMA database_list").all() as { name: string; file: string }[]).find(row => row.name === "main")!.file;
      const models = createHostModels(runtime, [model, modelB].map(({ provider, id }) => ({ provider, id })), {
        signal: new AbortController().signal, async authorize() { owner.assertCurrentOwner(); }, assertCurrent() { owner.assertCurrentOwner(); },
      });
      const h = await Harness.open(await SqliteStorage.open(new BunSqliteDatabase(path, { root, assertOwner: () => owner.assertCurrentOwner(), fenceTransactions: true })),
        { models, registry: createRegistry() }, context);
      const parent = (await h.conversation(parentBinding.conversation_id as ConversationId, context))!;
      const head = await parent.commit(tx => tx.appendEntry(parent.id, { kind: "pi.user", model: [{ role: "user", content: "side provenance history", timestamp: 1 }] }), context);
      const fork = await h.commit(async tx => {
        const child = await tx.forkConversation(parent.id, head.id, { ownership: { kind: "ownerless" } });
        const original = await tx.doc(AgentDoc, parent.id), copied = await tx.doc(AgentDoc, child.id);
        Object.assign(copied, JSON.parse(JSON.stringify(original))); return child;
      }, context);
      await h.close(context);
      // Seed terminal correlation: execution/recovery are covered separately.
      root.transaction(() => {
        root.query("INSERT INTO piclaw_durable_bindings_v1 VALUES (?,?,?,?,?,?,?,?,?,?,?,NULL)").run(parentBinding.incarnation, parentBinding.incarnation,
          fork.id, "web:default", parentBinding.branch_id, claim.operation.operationId, source.sourceSeq, id, id, id,
          hashCanonicalRequest({ type: "input", requestId: id, content: prompt }));
        root.query("UPDATE service_effect_s01_sources SET state='disposed' WHERE source_id=?").run(id);
        root.query("UPDATE service_effect_s01_operations SET phase='terminal' WHERE operation_id=?").run(claim.operation.operationId);
        root.query("UPDATE service_effect_s01_chats SET active_operation_id=NULL,consumed_through_source_seq=? WHERE chat_jid='web:default'").run(source.sourceSeq);
      }).immediate();
      backend = await createDefaultApplicationRuntime(owner, async () => services);
      expect(backend.sessionOptions.getDurableSession!("web:default")!.sessionId).toBe(identity);
      expect(calls).toBe(beforeCalls);
      backend.stop(); await backend.close();
      root.query("UPDATE piclaw_durable_bindings_v1 SET request_id='forged-side-request' WHERE source_id=?").run(id);
      await expect(createDefaultApplicationRuntime(owner, async () => services)).rejects.toThrow("Invalid durable application routing provenance");
      expect(calls).toBe(beforeCalls);
      compactionPolicySpy?.mockRestore();
      for (const spy of [...captureSpies, ...sdkSpies]) spy.mockRestore();
      closeDatabase(); owner.release(); return;
    }
    if (scenario === "native-compaction-accounting-recover") {
      // Seed a genuine paused SDK checkpoint, then reopen the actual application.
      // Host close joins maintenance, so this is not a host process-crash fixture.
      backend.stop(); await backend.close();
      const path = (root.query("PRAGMA database_list").all() as { name: string; file: string }[]).find(row => row.name === "main")!.file;
      const modelPort = createHostModels(runtime, [model, modelB].map(({ provider, id }) => ({ provider, id })), {
        signal: new AbortController().signal, async authorize() { owner.assertCurrentOwner(); }, assertCurrent() { owner.assertCurrentOwner(); },
      });
      const h = await Harness.open(await SqliteStorage.open(new BunSqliteDatabase(path, { root, assertOwner: () => owner.assertCurrentOwner(), fenceTransactions: true })),
        { models: modelPort, registry: withTaskModelRequestScope(createRegistry()) }, context);
      const row = root.query("SELECT incarnation,conversation_id FROM piclaw_durable_bindings_v1 WHERE chat_jid='web:default' LIMIT 1").get() as { incarnation: string; conversation_id: number };
      const conversation = (await h.conversation(row.conversation_id as ConversationId, context))!;
      await conversation.commit(async tx => {
        for (let i = 0; i < 4; i++) await tx.appendEntry(conversation.id, { kind: "pi.user", model: [{ role: "user", content: `checkpoint history ${i}`, timestamp: i }] });
      }, context);
      let entered!: () => void;
      const ready = new Promise<void>(resolve => { entered = resolve; });
      checkpointHold = { entered };
      const taskId = await conversation.compact("Retain the accepted decision", context);
      // Historical unscoped hold represents a dispatched attempt whose result
      // was lost. It cannot identify this checkpoint or authorise another send.
      const request = await reserveHostRequest({ database: root, operationId: "", chatJid: "web:default", authPath: join(getPiclawAgentDir(), "auth.json"), model: model as Model<Api>,
        executionKind: "side_prompt", maintenanceWorkId: `durable-maintenance:${row.incarnation}:${taskId}`,
        terminalOwner: { signal: new AbortController().signal, assertCurrent: () => owner.assertCurrentOwner() },
        signal: new AbortController().signal, assertCurrent: () => owner.assertCurrentOwner() });
      expect(request).toBeDefined();
      h.resume();
      await Promise.race([ready, h.waitForTask(taskId, context).then(task => { throw Error(`Checkpoint did not request summary: ${JSON.stringify(task.state.outcome)}`); })]);
      await request!.dispatch();
      await h.close(context); await request!.abandon(); checkpointHold = undefined;
      expect(root.query("SELECT state FROM budget_request_reservations WHERE work_id LIKE 'durable-request:%' AND state='unresolved'").all()).toHaveLength(1);
      const originalUnknown = root.query('SELECT * FROM budget_request_reservations WHERE id=?').get(request!.id);
      backend = await createDefaultApplicationRuntime(owner, async () => services);
      let recovered = backend.sessionOptions.getDurableSession!("web:default")!;
      expect(recovered.sessionId).toBe(identity);
      expect(await recovered.readModel!()).toBe(beforeModel);
      const callsBeforeStop = calls;
      root.query("INSERT INTO service_effect_s01_chats(chat_jid,active_operation_id) VALUES ('web:pending-recovery',NULL)").run();
      root.query("UPDATE service_effect_s01_chats SET next_source_seq=2 WHERE chat_jid='web:pending-recovery'").run();
      root.query("INSERT INTO service_effect_s01_sources VALUES ('web:pending-recovery',1,'pending-recovery',?,'message','pending','payload',NULL,NULL,'now',NULL,'provenance',0)").run("a".repeat(64));
      // Exact receipt recovery is qualified separately across close/SIGKILL.
      // This legacy hold has no attempt proof: deny resend, preserve it, and
      // retain the SDK's failed result without consuming unrelated accepted work.
      await expect(recovered.reconcileMaintenance!()).rejects.toThrow('Compaction did not complete');
      expect(calls).toBe(beforeCalls + 1); // Only the original held attempt.
      expect(calls).toBe(callsBeforeStop);
      expect(root.query('SELECT * FROM budget_request_reservations WHERE id=?').get(request!.id)).toEqual(originalUnknown);
      const failedTask = root.query('SELECT * FROM tasks WHERE id=?').get(taskId);
      expect(JSON.stringify(failedTask)).toContain('category=budget');
      expect(JSON.stringify(failedTask)).toContain('failed');
      expect(root.query("SELECT state FROM service_effect_s01_sources WHERE source_id='pending-recovery'").get()).toEqual({ state: "pending" });
      const callsAfterMaintenance = calls;
      backend.stop();
      expect(() => recovered.reconcileMaintenance!()).toThrow("Application closing");
      expect(calls).toBe(callsAfterMaintenance);
      await backend.close();
      root.query("UPDATE service_effect_s01_sources SET state='disposed' WHERE source_id='pending-recovery'").run();
      backend = await createDefaultApplicationRuntime(owner, async () => services);
      recovered = backend.sessionOptions.getDurableSession!("web:default")!;
      const callsBeforeResume = calls;
      await recovered.reconcileMaintenance!();
      expect(calls).toBe(callsBeforeResume); // Failed maintenance is not revived.
      expect(root.query('SELECT * FROM tasks WHERE id=?').get(taskId)).toEqual(failedTask);
      expect(root.query('SELECT * FROM budget_request_reservations WHERE id=?').get(request!.id)).toEqual(originalUnknown);
      expect(root.query("SELECT state FROM budget_request_reservations r JOIN budget_work w ON w.id=r.work_id WHERE w.execution_kind='side_prompt' ORDER BY r.rowid").all()).toEqual([{ state: "unresolved" }]);
      expect(root.query("SELECT status FROM budget_work WHERE parent_work_id IS NULL AND execution_kind='side_prompt'").all()).toEqual([{ status: "active" }]);
      expect(root.query("SELECT id FROM entries WHERE json_extract(record, '$.kind')='pi.compaction'").all()).toHaveLength(0);
      expect(root.query("SELECT COUNT(*) AS n FROM token_usage t JOIN budget_work w ON w.id=t.work_id WHERE w.execution_kind='side_prompt'").get()).toEqual({ n: 0 });
      backend.stop(); await backend.close(); compactionPolicySpy?.mockRestore();
      for (const spy of [...captureSpies, ...sdkSpies]) spy.mockRestore();
      closeDatabase(); owner.release(); return;
    }
    if (compactionAccountingUnknown) {
      await expect(first!.compact!("Retain the accepted decision")).rejects.toThrow("did not complete");
      expect(calls).toBe(beforeCalls + 1);
      expect(root.query("SELECT r.state FROM budget_request_reservations r JOIN budget_work w ON w.id=r.work_id WHERE w.execution_kind='side_prompt'").all()).toEqual([{ state: "unresolved" }]);
      expect(root.query("SELECT status FROM budget_work WHERE parent_work_id IS NULL AND execution_kind='side_prompt'").all()).toEqual([{ status: "active" }]);
      expect(root.query("SELECT id FROM entries WHERE json_extract(record, '$.kind')='pi.compaction'").all()).toHaveLength(0);
      expect(root.query("SELECT t.invocation_id FROM token_usage t JOIN budget_work w ON w.id=t.work_id WHERE w.execution_kind='side_prompt'").all()).toHaveLength(0);
      backend.stop(); await backend.close(); compactionPolicySpy?.mockRestore();
      closeDatabase(); initDatabase(); root = getDb();
      backend = await createDefaultApplicationRuntime(owner, async () => services);
      expect(root.query("SELECT r.state FROM budget_request_reservations r JOIN budget_work w ON w.id=r.work_id WHERE w.execution_kind='side_prompt'").all()).toEqual([{ state: "unresolved" }]);
      expect(root.query("SELECT status FROM budget_work WHERE parent_work_id IS NULL AND execution_kind='side_prompt'").all()).toEqual([{ status: "active" }]);
      expect(calls).toBe(beforeCalls + 1);
      backend.stop(); await backend.close();
      for (const spy of [...captureSpies, ...sdkSpies]) spy.mockRestore();
      closeDatabase(); owner.release(); return;
    }
    if (compactionCloseFailure) {
      root.exec("CREATE TRIGGER maintenance_close_fail BEFORE UPDATE ON budget_work WHEN OLD.parent_work_id IS NULL AND OLD.execution_kind='side_prompt' AND NEW.status='completed' BEGIN SELECT RAISE(ABORT, 'synthetic maintenance close fault'); END");
      const compacting = first!.compact!("Retain the accepted decision");
      const deadline = Date.now() + 2000;
      while (!root.query("SELECT 1 FROM entries WHERE json_extract(record, '$.kind')='pi.compaction'").get() && Date.now() < deadline) await Bun.sleep(10);
      expect(calls).toBe(beforeCalls + 1);
      expect(root.query("SELECT id FROM entries WHERE json_extract(record, '$.kind')='pi.compaction'").all()).toHaveLength(1);
      expect(root.query("SELECT status FROM budget_work WHERE parent_work_id IS NULL AND execution_kind='side_prompt'").all()).toEqual([{ status: "active" }]);
      root.exec("DROP TRIGGER maintenance_close_fail");
      await first!.reconcileMaintenance!();
      expect(await compacting).toEqual({ compacted: true });
      // Simulate a process stopping after the SDK commit but before its work
      // closure acknowledgement. Startup must repair from the existing task.
      root.query("UPDATE budget_work SET status='active',closed_at=NULL,chat_jid='web:unrelated' WHERE parent_work_id IS NULL AND execution_kind='side_prompt'").run();
      backend.stop(); await backend.close();
      backend = await createDefaultApplicationRuntime(owner, async () => services);
      expect(root.query("SELECT status FROM budget_work WHERE parent_work_id IS NULL AND execution_kind='side_prompt'").all()).toEqual([{ status: "active" }]);
      backend.stop(); await backend.close();
      root.query("UPDATE budget_work SET chat_jid='web:default' WHERE parent_work_id IS NULL AND execution_kind='side_prompt'").run();
      backend = await createDefaultApplicationRuntime(owner, async () => services);
      expect(root.query("SELECT status FROM budget_work WHERE parent_work_id IS NULL AND execution_kind='side_prompt'").all()).toEqual([{ status: "completed" }]);
      expect(calls).toBe(beforeCalls + 1);
      expect(root.query("SELECT SUM(t.api_equivalent_cost_microusd) AS amount FROM token_usage t JOIN budget_work w ON w.id=t.work_id WHERE w.execution_kind='side_prompt'").get()).toEqual({ amount: 10 });
      backend.stop(); await backend.close(); compactionPolicySpy?.mockRestore();
      for (const spy of [...captureSpies, ...sdkSpies]) spy.mockRestore();
      closeDatabase(); owner.release(); return;
    }
    const result = await first!.compact!("Retain the accepted decision");
    expect(result).toEqual({ compacted: true });
    expect(calls).toBe(beforeCalls + 1);
    expect(root.query("SELECT id FROM entries WHERE json_extract(record, '$.kind')='pi.compaction'").all()).toHaveLength(1);
    expect(await first!.readModel!()).toBe(beforeModel);
    expect(first!.sessionId).toBe(identity);
    if (compactionAccounting) {
      expect(root.query("SELECT t.usage_source FROM token_usage t JOIN budget_work w ON w.id=t.work_id WHERE w.execution_kind='side_prompt'").all()).toEqual([{ usage_source: "compaction" }]);
      expect(root.query("SELECT r.state FROM budget_request_reservations r JOIN budget_work w ON w.id=r.work_id WHERE w.execution_kind='side_prompt'").all()).toEqual([{ state: "settled" }]);
      expect(root.query("SELECT status,last_boundary FROM budget_work WHERE parent_work_id IS NULL AND execution_kind='side_prompt'").all()).toEqual([{ status: "completed", last_boundary: "maintenance_settled" }]);
      expect(root.query("SELECT SUM(t.api_equivalent_cost_microusd) AS amount FROM token_usage t JOIN budget_work w ON w.id=t.work_id WHERE w.execution_kind='side_prompt'").get()).toEqual({ amount: 10 });
    }
    backend.stop(); await backend.close(); compactionPolicySpy?.mockRestore();
    for (const spy of [...captureSpies, ...sdkSpies]) spy.mockRestore();
    closeDatabase(); owner.release(); return;
  }
  // Tiny history is correctly below the public compaction policy's retained window.
  expect(await first!.compact!("Summarize")).toEqual({ compacted: false });
  expect(calls).toBe(1);
  await assertContext(100000);
  expect(await pool.applyControlCommand("web:default", { type: "model", provider: modelB.provider, modelId: modelB.id, raw: `/model ${modelB.provider}/${modelB.id}` })).toMatchObject({ status: "success" });
  await assertContext(200000);
  expect(await pool.applyControlCommand("web:default", { type: "model", provider: model.provider, modelId: model.id, raw: `/model ${model.provider}/${model.id}` })).toMatchObject({ status: "success" });
  await assertContext(100000);
  const newcomer = "web:newcomer";
  storeChatMetadata(newcomer, new Date().toISOString());
  storeChatMetadata("web:rejected", new Date().toISOString());
  const snapshot = root.serialize();
  const failedAdmission = spyOn(modelRegistry, "getAvailable").mockReturnValue([]);
  try { await expect(bound.prepareInputSourceAdmission!("web:rejected")).rejects.toThrow("Host model no longer available"); }
  finally { failedAdmission.mockRestore(); }
  expect(root.serialize()).toEqual(snapshot);
  expect(backend.sessionOptions.getDurableSession!("web:rejected")).toBeUndefined();
  const beforeRetry = (root.query("SELECT count(*) AS n FROM conversations").get() as { n: number }).n;
  await bound.prepareInputSourceAdmission!("web:rejected");
  const retried = backend.sessionOptions.getDurableSession!("web:rejected")!;
  expect(retried).toBeDefined();
  expect(await retried.readPosition()).toBeNull();
  await bound.prepareInputSourceAdmission!("web:rejected");
  expect((root.query("SELECT count(*) AS n FROM conversations").get() as { n: number }).n).toBe(beforeRetry + 1);
  const post = (chat: string, content: string) => channel.handleRequest(new Request(`http://fixture/agent/default/message?chat_jid=${encodeURIComponent(chat)}`, {
    method: "POST", headers: { "Content-Type": "application/json", Origin: "http://fixture" }, body: JSON.stringify({ content }),
  }));
  const httpChat = "web:actual-http";
  storeChatMetadata(httpChat, new Date().toISOString());
  const beforeHttp = root.serialize();
  expect((await channel.handleRequest(new Request(`http://fixture/agent/default/message?chat_jid=${encodeURIComponent(httpChat)}`, {
    method: "POST", headers: { "Content-Type": "application/json", Origin: "http://fixture" }, body: "{",
  }))).status).toBe(400);
  expect((await post(httpChat, "")).status).toBe(400);
  expect((await post(httpChat, "/settings")).status).toBe(503);
  expect(root.serialize()).toEqual(beforeHttp);
  const auth = spyOn(channel.authGateway, "isAuthEnabled").mockReturnValue(true);
  const principal = spyOn(channel.authGateway, "getPrincipal").mockReturnValue(null);
  try { expect((await post(httpChat, "unauthorized")).status).toBeGreaterThanOrEqual(400); }
  finally { principal.mockRestore(); auth.mockRestore(); }
  expect(root.serialize()).toEqual(beforeHttp);
  const beforeConcurrent = (root.query("SELECT count(*) AS n FROM conversations").get() as { n: number }).n;
  const queueBefore = base.queue.getMetrics();
  const callsBeforeHttp = calls;
  const responses = await Promise.all([post(httpChat, "normal HTTP input one"), post(httpChat, "normal HTTP input two")]);
  expect(responses.map(response => response.status)).toEqual([201, 201]);
  for (let i = 0; i < 500 && (base.queue.isLaneBusy(`chat:${httpChat}`) || base.queue.isLaneBusy(httpChat)); i++) await Bun.sleep(10);
  base.queue.assertLegacyCaptureDrained();
  expect(root.query("SELECT content FROM messages WHERE chat_jid=? AND is_bot_message=1").all(httpChat)).toEqual([{ content: "factory synthetic reply" }, { content: "factory synthetic reply" }]);
  const sources = root.query("SELECT source_id, state FROM service_effect_s01_sources WHERE chat_jid=? ORDER BY source_seq").all(httpChat) as { source_id: string; state: string }[];
  expect(sources).toHaveLength(2);
  expect(new Set(sources.map(source => source.source_id)).size).toBe(2);
  expect(sources.map(source => source.state)).toEqual(["consumed", "consumed"]);
  expect(root.query("SELECT id FROM messages WHERE chat_jid=? AND is_bot_message=0 ORDER BY rowid").all(httpChat)).toEqual(sources.map(source => ({ id: source.source_id })));
  expect((root.query("SELECT count(*) AS n FROM conversations").get() as { n: number }).n).toBe(beforeConcurrent + 1);
  expect(calls - callsBeforeHttp).toBe(2);
  // The normal processChat finalizer also schedules one empty backlog drain.
  expect(base.queue.getMetrics().enqueued - queueBefore.enqueued).toBe(3);
  expect(base.queue.getMetrics().started - queueBefore.started).toBe(3);
  expect(base.queue.getMetrics().succeeded - queueBefore.succeeded).toBe(3);
  expect(base.queue.getMetrics().retriesScheduled - queueBefore.retriesScheduled).toBe(0);
  expect(backend.sessionOptions.getDurableSession!(httpChat)).toBeDefined();
  const before = (root.query("SELECT count(*) AS n FROM conversations").get() as { n: number }).n;
  await Promise.all([bound.prepareInputSourceAdmission!(newcomer), bound.prepareInputSourceAdmission!(newcomer)]);
  const newPort = backend.sessionOptions.getDurableSession!(newcomer)!;
  expect(newPort).toBeDefined();
  expect((root.query("SELECT count(*) AS n FROM conversations").get() as { n: number }).n).toBe(before + 1);
  const newMessage = { ...message, id: "newcomer-first", chat_jid: newcomer };
  const newRow = root.transaction(() => { const rowId = storeMessage(newMessage); const admit = bound.getInputSourceAdmission!(newcomer); assert(admit); admit({ message: newMessage, rowId, database: root }); return rowId; })();
  expect(await bound.dispatchAcceptedInput!(newcomer, newMessage.id, newRow!)!()).toBe("settled");
  expect(await newPort.readPosition()).not.toBeNull();
  expect(root.query("SELECT content FROM messages WHERE chat_jid=? AND is_bot_message=1").get(newcomer)).toEqual({ content: "factory synthetic reply" });
  await expect(bound.prepareInputSourceAdmission!("web:missing-root")).rejects.toThrow("Existing root branch required");
  const originalDoc = root.query("SELECT content FROM document_revisions WHERE document_id IN (SELECT id FROM documents WHERE kind='\"app.application-conversations\"') ORDER BY seq DESC LIMIT 1").get() as { content: string };
  if (scenario === "pending-host") {
    // A real accepted host source, deliberately not dispatched or consumed.
    const pending = { ...message, id: "pending-tool-upgrade", content: "must remain pending" };
    root.transaction(() => {
      const rowId = storeMessage(pending);
      const admit = bound.getInputSourceAdmission!(pending.chat_jid); assert(admit);
      admit({ message: pending, rowId, database: root });
    })();
    expect(root.query("SELECT state FROM service_effect_s01_sources WHERE source_id=?").get(pending.id)).toEqual({ state: "pending" });
  }
  await channel.stop(); await base.queue.shutdown(); await pool.shutdown();
  backend.stop(); await backend.close();
  // Successful SDK initialization followed by a failed close must also retain
  // main's owner while bootstrap still has no backend to clean up.
  const closeFault = Error("initialized harness close uncertain");
  const captured = new Set<BunSqliteDatabase>();
  const actualClose = BunSqliteDatabase.prototype.close;
  const closeSpy = spyOn(BunSqliteDatabase.prototype, "close").mockImplementation(function (this: BunSqliteDatabase) {
    captured.add(this); return Promise.reject(closeFault);
  });
  try {
    const deps = createDefaultRuntimeBootstrapDeps({ queue: {}, state: {} } as any,
      actual => createDefaultApplicationRuntime(actual, async () => services));
    deps.initializeRuntimeEnvironment = () => {};
    let failure: unknown;
    try { await main({ acquireLock: () => owner, createBootstrapDeps: () => deps }); } catch (error) { failure = error; }
    expect(failure).toBeInstanceOf(RuntimeStartupCleanupError);
    expect((failure as AggregateError).errors).toEqual([closeFault]);
    expect((failure as AggregateError).errors[0]).toBe(closeFault);
    expect(captured.size).toBe(1);
    owner.assertCurrentOwner();
    expect(() => acquireRuntimeLock({ lockPath: join(workspace, "default-owner.lock"), strictOwnership: true, disabled: false })).toThrow("refuses existing lock");
  } finally {
    closeSpy.mockRestore();
    for (const resource of captured) await actualClose.call(resource);
  }
  // Seed the GENUINE old factory selection through public configure before
  // reopening the new factory. Merely closing/reopening a six-tool fixture
  // would not exercise persisted-tool convergence at all.
  const path = (root.query("PRAGMA database_list").all() as { name: string; file: string }[]).find(row => row.name === "main")!.file;
  const modelPort = createHostModels(runtime, [model, modelB].map(({ provider, id }) => ({ provider, id })), {
    signal: new AbortController().signal,
    async authorize() { owner.assertCurrentOwner(); }, assertCurrent() { owner.assertCurrentOwner(); },
  });
  const inspectStored = async (seed: boolean) => {
    const harness = await Harness.open(await SqliteStorage.open(new BunSqliteDatabase(path, { root, assertOwner: () => owner.assertCurrentOwner(), fenceTransactions: true })),
      { models: modelPort, registry: createRegistry() }, context);
    try {
      const app = await harness.root(context);
      return await app.commit(async tx => {
        const states = new Map<number, unknown>();
        for (const { id } of root.query("SELECT id FROM conversations ORDER BY id").all() as { id: number }[]) {
          if (seed) await configure(tx, id as ConversationId, { tools: createHostBuiltinTools({ cwd: workspace, names: customSubset ? ["read"] : ["bash"], authority: { assertAllowed() { owner.assertCurrentOwner(); } } }),
            thinkingLevel: "low", instructions: "preserve these instructions", extensions: sourceFilter ? { add: [defineExtension({ name: "app.host-builtins" })], remove: [defineExtension({ name: "app.host-scheduled-source" })] } : [defineExtension({ name: "app.host-builtins" })] });
          states.set(id, JSON.parse(JSON.stringify(await tx.doc(AgentDoc, id as ConversationId))));
        }
        return states;
      }, context);
    } finally { await harness.close(context); }
  };
  const seeded = await inspectStored(true);
  for (const state of seeded.values()) expect(state).toMatchObject({ tools: [customSubset ? "read" : "bash"], model: { provider: model.provider, modelId: model.id },
    thinkingLevel: "low", instructions: "preserve these instructions" });
  if (scenario === "pending-host") {
    // Recovery uses the persisted configuration while host work is pending;
    // no tool/instruction revisions may be upgraded underneath it.
    const agentBytes = JSON.stringify(root.query(`SELECT * FROM document_revisions WHERE document_id IN (SELECT id FROM documents WHERE kind='"pi.agent"') ORDER BY document_id, seq`).all());
    const callsBefore = calls;
    const timelineBefore = root.query("SELECT id,chat_jid,content FROM messages ORDER BY id").all();
    const pending = await createDefaultApplicationRuntime(owner, async () => services);
    expect(JSON.stringify(root.query(`SELECT * FROM document_revisions WHERE document_id IN (SELECT id FROM documents WHERE kind='"pi.agent"') ORDER BY document_id, seq`).all())).toBe(agentBytes);
    assert.deepEqual(root.query("SELECT state FROM service_effect_s01_sources WHERE source_id='pending-tool-upgrade'").get(), { state: "pending" });
    assert.deepEqual(root.query("SELECT id,chat_jid,content FROM messages ORDER BY id").all(), timelineBefore);
    assert.equal(calls, callsBefore);
    for (const spy of sdkSpies) spy.mockRestore();
    await pending.close(); owner.release(); closeDatabase(); return;
  }

  const historyBeforeUpgrade = root.query("SELECT * FROM entries ORDER BY id").all();
  const identitiesBeforeUpgrade = root.query(`SELECT * FROM document_revisions WHERE document_id IN (SELECT id FROM documents WHERE kind='"app.application-identity"') ORDER BY document_id, seq`).all();
  const callsBeforeUpgrade = calls;
  settings.setDefaultModelAndProvider(modelB.provider, modelB.id);
  await settings.flush();
  backend = await createDefaultApplicationRuntime(owner, async () => services);
  expect(calls).toBe(callsBeforeUpgrade);
  expect(root.query("SELECT * FROM entries ORDER BY id").all()).toEqual(historyBeforeUpgrade);
  expect(root.query(`SELECT * FROM document_revisions WHERE document_id IN (SELECT id FROM documents WHERE kind='"app.application-identity"') ORDER BY document_id, seq`).all()).toEqual(identitiesBeforeUpgrade);
  if (customSubset) {
    expect(await backend.sessionOptions.getDurableSession!("web:default")!.readThinkingLevel!()).toBe("low");
    const thinkingPool = new AgentPool({ credentialStore, modelRuntime: runtime, modelRegistry, ...backend.sessionOptions });
    expect((await thinkingPool.getAvailableModels("web:default", { includeProviderUsage: false, includeProviderDiagnostics: false })).thinking_level).toBe("low");
    expect(await thinkingPool.applyControlCommand("web:default", { type: "thinking", raw: "/thinking" })).toMatchObject({ status: "success", thinking_level: "low" });
    await thinkingPool.shutdown();
    expect(backend.sessionOptions.getDurableSession!("web:default")?.sessionId).toBe(first?.sessionId);
    expect(backend.sessionOptions.getDurableSession!(newcomer)).toMatchObject({ sessionId: newPort.sessionId, branchId: newPort.branchId });
    backend.stop(); await backend.close();
    const preserved = await inspectStored(false);
    for (const [id, state] of seeded) expect(preserved.get(id)).toEqual(state); // Source authority no longer changes explicit extension selections.
    expect(root.query("SELECT * FROM entries ORDER BY id").all()).toEqual(historyBeforeUpgrade);
    expect(root.query(`SELECT * FROM document_revisions WHERE document_id IN (SELECT id FROM documents WHERE kind='"app.application-identity"') ORDER BY document_id, seq`).all()).toEqual(identitiesBeforeUpgrade);
    expect(calls).toBe(callsBeforeUpgrade);
    for (const spy of sdkSpies) { expect(spy).not.toHaveBeenCalled(); spy.mockRestore(); }
    closeDatabase(); owner.release(); return;
  }
  // Read public stored state only after the active controller is closed below;
  // model-visible success for all six tools is exercised through this backend.
  expect(!!backend.sessionOptions.getDurableSession?.("web:default")).toBe(true);
  expect(backend.sessionOptions.getDurableSession?.("web:default")?.sessionId).toBe(first?.sessionId);
  expect(backend.sessionOptions.getDurableSession!(newcomer)?.sessionId).toBe(newPort.sessionId);
  expect(backend.sessionOptions.getDurableSession!(newcomer)?.branchId).toBe(newPort.branchId);
  const rebound = backend.bind({ queue: {}, agentPool: {} } as Parameters<typeof backend.bind>[0]);
  const next = { ...message, id: "factory-input-after-default-change", content: "continue A" };
  const nextRow = root.transaction(() => {
    const rowId = storeMessage(next);
    const admit = rebound.getInputSourceAdmission!(next.chat_jid); assert(admit);
    admit({ message: next, rowId, database: root });
    return rowId;
  })();
  expect(await rebound.dispatchAcceptedInput!(next.chat_jid, next.id, nextRow!)!()).toBe("settled");
  expect(requested).toEqual([model.id, model.id, model.id, model.id, model.id]);
  // Normal accepted input through the actual default factory, not a standalone
  // tool harness: the synthetic provider requests existing host builtin calls.
  writeFileSync(join(workspace, "factory-tool-input.txt"), "before");
  const fetchSpy = spyOn(globalThis, "fetch").mockImplementation(Object.assign(async (input: RequestInfo | URL) => {
    expect(String(input)).toBe("https://codemode-fetch.invalid/data");
    return Response.json({ value: "FETCH_USEFUL_SENTINEL" });
  }, { preconnect() {} }));
  toolSequence = [
    { name: "read", arguments: { path: "factory-tool-input.txt" } },
    { name: "edit", arguments: { path: "factory-tool-input.txt", edits: [{ oldText: "before", newText: "after" }] } },
    { name: "write", arguments: { path: "factory-tool-output.txt", content: "written by host tool" } },
    { name: "find", arguments: { pattern: "factory-tool-*.txt" } },
    { name: "ls", arguments: { path: "." } },
    { name: "grep", arguments: { pattern: "after", path: "factory-tool-input.txt" } },
    { name: "bash", arguments: { command: "printf factory-tool-bash" } },
    { name: "codemode", arguments: { code: `await tools.write({path:"codemode-useful.txt",content:"before"}); await tools.edit({path:"codemode-useful.txt",edits:[{oldText:"before",newText:"after"}]}); console.log(await tools.read({path:"codemode-useful.txt"})); console.log(await tools.find({pattern:"codemode-useful.txt"})); console.log(await tools.grep({pattern:"after",path:"codemode-useful.txt"})); const response = await tools.fetch({url:"https://codemode-fetch.invalid/data"}); console.log(JSON.parse(response.body).value); console.log("CAPABILITIES",typeof process,typeof fetch,typeof models);` } },
  ];
  const toolInput = { ...message, id: "factory-tool-input", content: "Run the synthetic host tool sequence" };
  const toolRow = root.transaction(() => {
    const rowId = storeMessage(toolInput);
    const admit = rebound.getInputSourceAdmission!(toolInput.chat_jid); assert(admit);
    admit({ message: toolInput, rowId, database: root });
    return rowId;
  })();
  expect(await rebound.dispatchAcceptedInput!(toolInput.chat_jid, toolInput.id, toolRow!)!()).toBe("settled");
  fetchSpy.mockRestore();
  expect(readFileSync(join(workspace, "codemode-useful.txt"), "utf8")).toBe("after");
  expect(toolSequence).toEqual([]); toolSequence = undefined;
  expect(readFileSync(join(workspace, "factory-tool-input.txt"), "utf8")).toBe("after");
  expect(readFileSync(join(workspace, "factory-tool-output.txt"), "utf8")).toBe("written by host tool");
  const toolEntries = JSON.stringify(root.query("SELECT * FROM entries").all());
  expect(toolEntries).toContain("factory-tool-bash");
  expect(toolEntries).toContain("Successfully wrote");
  expect(toolEntries).toContain("factory-tool-output.txt");
  // Inspect results delivered back to the actual public model adapter: merely
  // draining the call queue would also succeed when a requested tool is absent.
  for (const name of ["read", "edit", "write", "find", "ls", "bash", "grep", "codemode"]) {
    const result = [...observedResults.values()].find(result => result.toolName === name);
    expect(result).toBeDefined(); expect(result!.isError).not.toBe(true);
    if (name === "codemode") {
      expect(JSON.stringify(result!.content)).toContain("after");
      expect(JSON.stringify(result!.content)).toContain("CAPABILITIES undefined undefined undefined");
      expect(JSON.stringify(result!.content)).toContain("FETCH_USEFUL_SENTINEL");
    }
    if (name === "grep") expect(JSON.stringify(result!.content)).toContain("factory-tool-input.txt:1: after");
    if (name === "find" || name === "ls") expect(JSON.stringify(result!.content)).toContain("factory-tool-output.txt");
  }
  // Lose the provider acknowledgement AFTER the real public transaction commits.
  // No partial route is published and a retry cannot create another identity.
  const uncertainChat = "web:lost-create-ack";
  storeChatMetadata(uncertainChat, new Date().toISOString());
  const beforeUncertain = (root.query("SELECT count(*) AS n FROM conversations").get() as { n: number }).n;
  const actualTransaction = BunSqliteDatabase.prototype.transaction;
  const lostAck = Error("lost create commit acknowledgement");
  let lostAcknowledgements = 0;
  const fault = spyOn(BunSqliteDatabase.prototype, "transaction").mockImplementation(async function <T>(this: BunSqliteDatabase, callback: (tx: SqliteExecutor) => Promise<T>): Promise<T> {
    const result = await actualTransaction.call<BunSqliteDatabase, [(tx: SqliteExecutor) => Promise<T>], Promise<T>>(this, callback);
    if ((root.query("SELECT count(*) AS n FROM conversations").get() as { n: number }).n > beforeUncertain) {
      lostAcknowledgements++; throw lostAck;
    }
    return result;
  });
  try {
    await expect(rebound.prepareInputSourceAdmission!(uncertainChat)).rejects.toThrow();
    await expect(rebound.prepareInputSourceAdmission!(uncertainChat)).rejects.toThrow();
    expect(lostAcknowledgements).toBe(1);
    expect(backend.sessionOptions.getDurableSession!(uncertainChat)).toBeUndefined();
    expect((root.query("SELECT count(*) AS n FROM conversations").get() as { n: number }).n).toBe(beforeUncertain + 1);
  } finally { fault.mockRestore(); }
  backend.stop(); await backend.close();
  const upgraded = await inspectStored(false);
  for (const [id, state] of seeded) expect(upgraded.get(id)).toEqual({ ...(state as object), tools: ["read", "bash", "edit", "write", "find", "ls", "grep", "session_status", "exit_process", "list_models", "get_model_state", "set_model", "switch_model", "switch_thinking", "fetch", "codemode"] });
  backend = await createDefaultApplicationRuntime(owner, async () => services);
  const recoveredCreate = backend.sessionOptions.getDurableSession!(uncertainChat)!;
  expect(recoveredCreate).toBeDefined();
  const recoveredIdentity = { sessionId: recoveredCreate.sessionId, branchId: recoveredCreate.branchId };
  backend.stop(); await backend.close();
  backend = await createDefaultApplicationRuntime(owner, async () => services);
  expect(backend.sessionOptions.getDurableSession!(uncertainChat)).toMatchObject(recoveredIdentity);
  expect((root.query("SELECT count(*) AS n FROM conversations").get() as { n: number }).n).toBe(beforeUncertain + 1);
  backend.stop(); await backend.close();
  // Hold the real adapter's public SDK transaction callback, not a model lookup
  // (the latter is synchronous). Stop/close must fence it before it can publish.
  for (const shutdown of ["stop", "close"] as const) {
    backend = await createDefaultApplicationRuntime(owner, async () => services);
    const raceChat = `web:prepare-${shutdown}`;
    storeChatMetadata(raceChat, new Date().toISOString());
    const raceBound = backend.bind({ queue: base.queue, agentPool: pool });
    const raceChannel = new WebChannel(raceBound);
    raceChannel.broadcastEvent = () => {};
    const beforeRace = root.serialize();
    let entered!: () => void, release!: () => void;
    const inside = new Promise<void>(resolve => { entered = resolve; });
    const hold = new Promise<void>(resolve => { release = resolve; });
    const gate = spyOn(BunSqliteDatabase.prototype, "transaction").mockImplementationOnce(function <T>(this: BunSqliteDatabase, callback: (tx: SqliteExecutor) => Promise<T>): Promise<T> {
      return actualTransaction.call<BunSqliteDatabase, [(tx: SqliteExecutor) => Promise<T>], Promise<T>>(this, async tx => { entered(); await hold; return callback(tx); });
    });
    const pending = raceBound.prepareInputSourceAdmission!(raceChat).then(() => null, error => error);
    await inside;
    let closed = false;
    let closing: Promise<void> | undefined;
    if (shutdown === "stop") backend.stop();
    else closing = backend.close().then(() => { closed = true; });
    await Bun.sleep(0);
    expect(closed).toBe(false);
    expect(backend.sessionOptions.getDurableSession!(raceChat)).toBeUndefined();
    release();
    try {
      expect(await pending).toBeInstanceOf(Error);
      await (closing ?? backend.close());
    } finally { gate.mockRestore(); }
    expect(backend.sessionOptions.getDurableSession!(raceChat)).toBeUndefined();
    expect(root.serialize()).toEqual(beforeRace);
    const response = await raceChannel.handleRequest(new Request(`http://fixture/agent/default/message?chat_jid=${encodeURIComponent(raceChat)}`, {
      method: "POST", headers: { "Content-Type": "application/json", Origin: "http://fixture" }, body: JSON.stringify({ content: "after shutdown" }),
    }));
    expect(response.status).toBe(503);
    expect(root.serialize()).toEqual(beforeRace);
    await raceChannel.stop();
  }
  const beforeUnapproved = root.serialize();
  const catalog = spyOn(modelRegistry, "getAvailable").mockReturnValue([modelB] as any);
  try {
    await expect(createDefaultApplicationRuntime(owner, async () => services)).rejects.toThrow("Persisted host model not approved");
    expect(root.serialize()).toEqual(beforeUnapproved);
    owner.assertCurrentOwner();
  } finally { catalog.mockRestore(); }
  const docId = (root.query("SELECT id FROM documents WHERE kind='\"app.application-conversations\"'").get() as { id: number }).id;
  const revision = root.query("SELECT seq, content FROM document_revisions WHERE document_id=? ORDER BY seq DESC LIMIT 1").get(docId) as { seq: number; content: string };
  for (const bad of ["", "wrong-domain"]) {
    const delta = JSON.parse(originalDoc.content); delta[0][2] = bad;
    root.query("UPDATE document_revisions SET content=? WHERE document_id=? AND seq=?").run(JSON.stringify(delta), docId, revision.seq);
    let realized = false;
    await expect(createDefaultApplicationRuntime(owner, async () => { realized = true; return services; })).rejects.toThrow();
    expect(realized).toBe(false);
  }
  root.query("UPDATE document_revisions SET content=? WHERE document_id=? AND seq=?").run(revision.content, docId, revision.seq);
  for (const spy of sdkSpies) { expect(spy).not.toHaveBeenCalled(); spy.mockRestore(); }
  // Use canonical config path, not a fixture's guessed layout.
  const { SESSIONS_DIR } = await import("../../runtime/src/core/config.js");
  mkdirSync(SESSIONS_DIR, { recursive: true });
  const file = join(SESSIONS_DIR, "legacy.jsonl"); writeFileSync(file, "preserve legacy bytes\n");
  let realized = false;
  await expect(createDefaultApplicationRuntime(owner, async () => { realized = true; return services; })).rejects.toThrow("migration");
  expect(realized).toBe(false); expect(readFileSync(file, "utf8")).toBe("preserve legacy bytes\n");
  closeDatabase(); owner.release();
});

factoryTest("deferred-mcp-maintenance", "deferred MCP preserves SDK selections and restores exact fetch factory default", async () => {
  process.env.PICLAW_DB_IN_MEMORY = "0"; initDatabase();
  const workspace = process.env.PICLAW_WORKSPACE!;
  const owner = acquireRuntimeLock({ lockPath: join(workspace, "deferred-owner.lock"), strictOwnership: true, disabled: false });
  const model = { provider: "synthetic", id: "approved", name: "Approved", api: "openai-completions", baseUrl: "https://invalid.invalid", input: ["text"], reasoning: false, contextWindow: 10000, maxTokens: 1000, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } } as Model<"openai-completions">;
  const runtime = await ModelRuntime.create({ modelsPath: null, modelsStore: { read: async () => undefined, write: async () => {}, delete: async () => {} }, credentials: createTestCredentialStore({ synthetic: { type: "api_key", key: "synthetic-only" } }), allowModelNetwork: false, refreshOnCreate: false });
  runtime.registerNativeProvider({ id: model.provider, name: "Synthetic", getModels: () => [model], auth: { apiKey: { name: "Synthetic", resolve: async () => ({ auth: { apiKey: "synthetic-only" }, source: "fixture" }) } }, stream: () => { throw Error("No generation"); }, streamSimple: () => { throw Error("No generation"); } });
  await runtime.refresh({ allowNetwork: false });
  const services = { modelRuntime: runtime, modelRegistry: new ModelRegistry(runtime) } as RuntimeModelServices;
  const root = getDb();
  const pid = join(workspace, "deferred-mcp-pid");
  mkdirSync(join(workspace, ".pi"), { recursive: true });
  writeFileSync(getConfigPath(), JSON.stringify({ domains: { mcp: { engine: "native", codemode: "on" } } }), { mode: 0o600 });
  writeFileSync(join(workspace, ".pi/mcp.json"), JSON.stringify({ mcpServers: { fixture: { command: process.execPath, args: [join(import.meta.dir, "mcp-stdio-fixture.ts"), join(workspace, "deferred-calls"), pid] } } }));
  await hydrateMcpKeychainCredentials(workspace, async () => { throw Error("No keychain access allowed"); });
  storeChatMetadata("web:default", new Date().toISOString());
  storeMessage({ id: "deferred-old-row", chat_jid: "web:default", sender: "user", sender_name: "User", content: "synthetic legacy content", timestamp: new Date().toISOString(), is_from_me: false, is_bot_message: false });
  writeFileSync(join(workspace, "AGENTS.md"), "DEFERRED_POLICY_ONE");
  const bridge = await import("../../runtime/src/secure/mcp-keychain.js");
  const { McpClient } = await import("../../node_modules/@earendil-works/pi-mcp");
  const leaseSpy = spyOn(bridge, "acquireMcpSessionBridge");
  const connectSpy = spyOn(McpClient.prototype, "connect");
  let backend: Awaited<ReturnType<typeof createDefaultApplicationRuntime>> | undefined;
  const inspect = async (selection?: string[]) => {
    const path = (root.query("PRAGMA database_list").all() as {name:string;file:string}[]).find(row => row.name === "main")!.file;
    const models = createHostModels(runtime, [model], { signal: new AbortController().signal, async authorize() {}, assertCurrent() { owner.assertCurrentOwner(); } });
    const harness = await Harness.open(await SqliteStorage.open(new BunSqliteDatabase(path, { root, assertOwner: () => owner.assertCurrentOwner(), fenceTransactions: true })), { models, registry: createRegistry() }, context);
    try {
      const app = await harness.root(context);
      return await app.commit(async tx => {
        const doc = await tx.doc(AgentDoc, app.id);
        if (selection !== undefined) doc.tools = selection;
        return JSON.parse(JSON.stringify(doc.tools)) as string[];
      }, context);
    } finally { await harness.close(context); }
  };
  try {
    backend = await createDefaultApplicationRuntime(owner, async () => services, { offlineMaintenance: true });
    expect(existsSync(pid)).toBe(false);
    expect(leaseSpy).toHaveBeenCalledTimes(0);
    expect(connectSpy).toHaveBeenCalledTimes(0);
    expect(() => backend!.bind({} as never)).toThrow("Offline maintenance");
    await backend.close(); backend = undefined;
    const factory = await inspect();
    expect(factory).toContain("fetch"); expect(factory.some(name => name.startsWith("mcp__"))).toBe(false);
    writeFileSync(join(workspace, "AGENTS.md"), "DEFERRED_POLICY_TWO");
    backend = await createDefaultApplicationRuntime(owner, async () => services);
    expect(existsSync(pid)).toBe(true);
    expect(leaseSpy).toHaveBeenCalledTimes(1);
    expect(connectSpy).toHaveBeenCalledTimes(1);
    await backend.close(); backend = undefined;
    expect(JSON.stringify(root.query("SELECT content FROM document_revisions").all())).toContain("DEFERRED_POLICY_TWO");
    expect((await inspect()).sort()).toEqual([...factory, "mcp__fixture__echo"].sort());
    for (const selection of [[], ["read"], ["mcp__fixture__echo"]]) {
      await inspect(selection);
      backend = await createDefaultApplicationRuntime(owner, async () => services, { offlineMaintenance: true });
      await backend.close(); backend = undefined;
      expect(await inspect()).toEqual(selection);
      backend = await createDefaultApplicationRuntime(owner, async () => services);
      await backend.close(); backend = undefined;
      expect(await inspect()).toEqual(selection);
    }
    // Unknown historical names remain byte-for-byte selected during maintenance;
    // normal startup still validates availability rather than silently dropping them.
    await inspect(["mcp_x"]);
    backend = await createDefaultApplicationRuntime(owner, async () => services, { offlineMaintenance: true });
    await backend.close(); backend = undefined;
    expect(await inspect()).toEqual(["mcp_x"]);
    await expect(createDefaultApplicationRuntime(owner, async () => services)).rejects.toThrow("Persisted host tool not available");
    const leasesBefore = leaseSpy.mock.calls.length, connectsBefore = connectSpy.mock.calls.length;
    writeFileSync(join(workspace, ".pi/mcp.json"), JSON.stringify({ mcpServers: { fixture: { url: "https://invalid.invalid/mcp" } } }));
    await hydrateMcpKeychainCredentials(workspace, async () => { throw Error("No keychain access allowed"); });
    await expect(createDefaultApplicationRuntime(owner, async () => { throw Error("Must reject metadata before models"); }, { offlineMaintenance: true })).rejects.toThrow("Durable MCP");
    expect(leaseSpy).toHaveBeenCalledTimes(leasesBefore);
    expect(connectSpy).toHaveBeenCalledTimes(connectsBefore);
  } finally { await backend?.close(); leaseSpy.mockRestore(); connectSpy.mockRestore(); owner.release(); closeDatabase(); }
});
