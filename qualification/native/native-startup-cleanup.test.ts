import "./src/test-guard.js";
import {expect,spyOn} from "bun:test";
import {join} from "node:path";
import {isolatedApplicationTest} from "./src/isolated-application-test.js";
import {initDatabase,closeDatabase} from "../../runtime/src/db/connection.js";
import {acquireRuntimeLock} from "../../runtime/src/runtime/single-instance.js";
import {RuntimeStartupCleanupError} from "../../runtime/src/runtime/startup-cleanup-error.js";
import {RuntimePreparationError} from "../../runtime/src/runtime/preparation-error.js";
import {HostEffectError} from "../../runtime/durable-engine/src/host-effects.js";
import type {RuntimeModelServices} from "../../runtime/src/agent-pool/model-services.js";
import {BunSqliteDatabase} from "../../runtime/durable-engine/src/bun-sqlite.js";
import * as addonConfigApi from "../../runtime/src/channels/web/handlers/addon-config-api.js";
import {createDefaultRuntimeBootstrapDeps} from "../../runtime/src/runtime/bootstrap.js";
import {createDefaultApplicationRuntime} from "../../runtime/durable-engine/src/default-application-runtime.js";
import {main} from "../../runtime/src/runtime.js";
const applicationTest=isolatedApplicationTest(import.meta.url);

for (const failureKind of ['ordinary', 'sqlite-busy', 'store-busy', 'unknown-certainty', 'nested-uncertainty'] as const)
for (const uncertain of [false, true, 'synchronous'] as const) applicationTest(`actual preparation → bootstrap → main retains owner only for uncertain close=${uncertain}, failure=${failureKind}`, async () => {
  process.env.PICLAW_DB_IN_MEMORY = "0";
  initDatabase();
  const workspace = process.env.PICLAW_WORKSPACE!;
  const acquire = () => acquireRuntimeLock({ lockPath: join(workspace, "preparation-owner.lock"), strictOwnership: true, disabled: false });
  const owner = acquire();
  const primary = failureKind === 'nested-uncertainty' ? new RuntimeStartupCleanupError([Error('inner disposal unconfirmed')])
    : failureKind === 'sqlite-busy' ? Object.assign(Error('database is locked'), { code: 'SQLITE_BUSY' })
    : failureKind === 'store-busy' || failureKind === 'unknown-certainty' ? new HostEffectError({ _tag: 'storage_unavailable', certainty: failureKind === 'store-busy' ? 'not_applied' : 'unknown', retryable: true })
    : Error("storage initialization failed");
  const cleanup = Error("application close failed before close");
  const model = { provider: "synthetic", id: "approved", name: "Approved", api: "openai-completions", baseUrl: "https://invalid.invalid", input: ["text"], reasoning: false, contextWindow: 10000, maxTokens: 1000, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } };
  const services = { modelRuntime: { getPhysicalModel: () => model }, modelRegistry: { getAvailable: () => [model] } } as unknown as RuntimeModelServices;
  const originalClose = BunSqliteDatabase.prototype.close;
  let captured: BunSqliteDatabase | undefined;
  const close = spyOn(BunSqliteDatabase.prototype, "close").mockImplementation(function (this: BunSqliteDatabase) {
    captured = this;
    return uncertain === true ? Promise.reject(cleanup) : originalClose.call(this);
  });
  const originalRegister = addonConfigApi.registerAddonConfigKvAuthority;
  const registration = uncertain === 'synchronous' ? spyOn(addonConfigApi, 'registerAddonConfigKvAuthority').mockImplementation((...args) => {
    const release = originalRegister(...args);
    return () => { release(); throw cleanup; };
  }) : undefined;
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
    } else if (failureKind === 'nested-uncertainty') {
      expect(thrown).toBe(primary);
      owner.assertCurrentOwner(); expect(acquire).toThrow('refuses existing lock');
    } else {
      expect(thrown).toBeInstanceOf(RuntimePreparationError);
      expect((thrown as Error).cause).toBe(primary);
      expect((thrown as RuntimePreparationError).retryableStorage).toBe(failureKind === 'sqlite-busy' || failureKind === 'store-busy');
      acquire().release();
    }
  } finally {
    transaction.mockRestore(); close.mockRestore(); pool.mockRestore(); registration?.mockRestore();
    if (captured) await originalClose.call(captured);
    owner.release(); await closeDatabase();
  }
});
