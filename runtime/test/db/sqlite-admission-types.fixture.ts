// Compile-only: never execute these declaration-backed calls.
import type { Database } from 'bun:sqlite';
import { admitSqliteWrite } from '../../src/db/sqlite-async-admission.js';
import { withExtensionKvAuthority, type ExtensionKvAuthority, type ExtensionKvStore } from '../../src/extension-kv-registry.js';
import type { BunSqliteDatabase } from '../../../runtime/durable-engine/src/bun-sqlite.js';
import type { createHostOperationAuthority } from '../../../runtime/durable-engine/src/host-operation-authority.js';
import type { createHostGoalTools } from '../../../runtime/durable-engine/src/host-goal-tools.js';
import type { createHostPlanTool } from '../../../runtime/durable-engine/src/host-plan-tool.js';
import type { CodeReviewNativeExports } from '../../../runtime/durable-engine/src/host-code-review-tool.js';
import type { CodexArtifactBinding } from '../../../runtime/durable-engine/src/host-codex-artifacts.js';
import type { HostRegretsBindingOptions } from '../../../runtime/durable-engine/src/host-regrets-bindings.js';

declare const database: Database;
const number: Promise<number> = admitSqliteWrite(database, () => 3);
const nothing: Promise<void> = admitSqliteWrite(database, () => {});
const record: Promise<{ n: number }> = admitSqliteWrite(database, () => ({ n: 3 }));
// @ts-expect-error host SQL callbacks cannot be async
admitSqliteWrite(database, async () => 3);
// @ts-expect-error void-returning async callbacks are asynchronous too
admitSqliteWrite(database, async () => {});
// @ts-expect-error returning a native Promise is asynchronous
admitSqliteWrite(database, () => Promise.resolve(3));
// @ts-expect-error mixed result types cannot hide an asynchronous branch
admitSqliteWrite(database, () => Math.random() ? 3 : Promise.resolve(3));
// @ts-expect-error structural PromiseLike results are excluded
admitSqliteWrite(database, () => ({ then: Promise.resolve(3).then.bind(Promise.resolve(3)) }));

// @ts-expect-error JavaScript thenables need not return another PromiseLike
admitSqliteWrite(database, () => ({ then(resolve: (value: number) => void) { resolve(3); } }));

declare const operation: ReturnType<typeof createHostOperationAuthority>;
// @ts-expect-error operation authority must retain the synchronous callback contract
operation.admitWrite(async () => {});
declare const kv: ExtensionKvStore;
// @ts-expect-error the KV admission router must not erase the contract
kv.write!('fixture', async () => {});
declare const authority: ExtensionKvAuthority;
// @ts-expect-error the private KV authority must not erase the contract
authority.admitWrite!(async () => {});
declare const goal: NonNullable<Parameters<Parameters<typeof createHostGoalTools>[0]>[1]>;
// @ts-expect-error Goal admission must not erase the contract
goal.write(async () => {});
declare const plan: Parameters<Parameters<typeof createHostPlanTool>[1]['createTool']>[0];
// @ts-expect-error Plan admission must not erase the contract
plan(async () => {});
declare const review: Parameters<CodeReviewNativeExports['setReviewDatabaseSource']>[0];
// @ts-expect-error Code Review admission must not erase the contract
review.admitWrite!(async () => {});
declare const artifact: CodexArtifactBinding;
// @ts-expect-error artifact publication must prepare asynchronously before SQL admission
artifact.write(async () => {});
declare const regrets: HostRegretsBindingOptions<unknown>;
// @ts-expect-error Regrets SQL admission must not erase the contract
regrets.transactionalWrite(async () => {});

// Async scopes and the separately owned SDK SQL executor remain supported.
const scoped: Promise<number> = withExtensionKvAuthority(authority, async () => 3);
declare const sdk: BunSqliteDatabase;
const sdkResult: Promise<number> = sdk.transaction(async tx => {
  await tx.run('INSERT INTO fixture VALUES(?)', 3);
  return 3;
});
void [number, nothing, record, scoped, sdkResult];
