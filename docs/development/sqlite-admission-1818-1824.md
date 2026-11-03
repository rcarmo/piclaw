# SQLite admission and retired Root mutation paths

Refs: #1818, #1824. This delivery uses the 2 November 2026 requirements. The older requirement to repair legacy Dream cleanup was superseded by deletion-first retirement; PR #1906 removed that executor while retaining historical data and readers.

## Connection and transaction ownership

| Connection | Owner and policy | Mutation boundary |
|---|---|---|
| Root | `db/connection.ts`; zero busy timeout, WAL, FULL durability, original FK policy | Existing `admitSqliteWrite` for live synchronous SQL bodies; schema and startup maintenance run before readiness/models |
| SDK | `BunSqliteDatabase`; separate owned handle, same Root file/inode, zero timeout, FULL/FK ON | Existing separately qualified asynchronous SDK transaction interface; shared contention classifier/pause |
| Scheduler | Separate file handle bound to Root identity; memory mode borrows the exact primary and restores FK policy | Scheduled-run store admission and `scheduledSourceWrite` for source correlation |
| Index child | Existing-file-only handle; inherited fd3 authority, captured roots/inode, zero timeout | Workspace-index writes and all six note-index phases use the existing admitted primitive |
| Checkpoint worker | One existing group per canonical WAL identity; zero timeout, FULL, PASSIVE | No user/provider callback; SQL-close acknowledgement precedes release |
| Rehearsal/backup | Exclusively inactive rehearsal copy or read-only verified backup | Separate offline ownership; unchanged |

`sqlite-role-policy.ts` owns connection setup. Ordinary work/outbox store constructors do not reset connection policy. Admission rejects an external nonzero timeout without changing it or entering its body. Trusted callers can still issue arbitrary SQL; this is a connection-policy contract, not an SQL sandbox.

The five-second observation deadline and shared 25 ms acquisition pause are unchanged. Cancellation can reject before or while acquiring the writer. Once a callback has entered, contention, commit failure or an uncertain result cannot authorise another invocation. Declared async callbacks are rejected before entry; a thenable return rolls back its synchronous prefix. Nested compensation is rejected before entry, including an outer transaction introduced during acquisition backoff.

Root WAL setup makes one verified attempt before readiness. A conflict fails preparation promptly. The blocking WAL retry module and admission timeout restoration are deleted. No schema, SDK, tool or provider callback is retried to make opening succeed.

## Checkpoint close and recovery

The worker clears its timer and closes SQLite before acknowledging closure. Its existing parent group remains registered until that acknowledgement and rejects replacement while closing. SDK, scheduler and Root close paths await the resource they release.

Root unpublishes its singleton immediately. Pending cleanup prevents reopening. A failed worker close retains the actual Root handle, the group and the terminal cleanup error; repeated close returns the same failure. Constructor cleanup retains its original error as well. A failed close requires operator review; it does not authorise another execution or automatic adoption.

The native routing/reopen fixture reproduced `SQLITE_BUSY` after the old termination-only handoff. A controlled fixture also held a real SQLite writer until explicit closure confirmation. Both pass after the ownership fix.

## Removed paths and retained consumers

| Before | After |
|---|---|
| Legacy address rename, merge, purge, restore hydration and JSONL fork executors, with cache/disposal/filesystem tails | Executors and their map/callback plumbing removed. Public native unsupported-operation boundaries remain fail-closed. Supported handle/archive/root metadata and native restore use admitted operations |
| Sync branch registration during resident inventory | Read-only inventory, including volatile resident entries; no registration write |
| Three admitted UI setter wrappers, two sync setters, private KV setter and legacy JSON theme writer | One atomic preference update/readback; legacy theme data remains a read-only startup fallback |
| Repeated message/queue/post DB binding implementations | One verifier in the existing connection owner; row/source/principal checks stay in their domains |
| Raw default-DB delete-response facade | Existing post mutation operation owns admission and publishes deletion after commit |
| Two environment writers and a persistence forwarder | One admitted SQL operation; process state and restore bookkeeping follow known commit |
| Pool SSH metadata operations invoking a global legacy transport | Admitted metadata operations; legacy transport mutation tails removed; existing APIs/readers retained |
| Raw Keychain/OOBE writes | Existing domain operations use admission, captured authority and cancellation |
| Six raw note-index transactions | Existing primitive; async batch flushes are awaited; cleanup retains separate authority/cancellation semantics |

Explicit legacy resident capture and historical seed readers remain for inspection. `prune-archived-branches.ts` still consumes artifact preview/apply helpers. Neither consumer requires the removed application branch executors. Native empty/bound compositions never construct the legacy session manager, binder or tool factory.

Host authentication, media, UI preferences, channel ingress, add-on KV and filesystem checkpoint integration remain product responsibilities. The public SDK does not own those host tables or certify the checkpoint worker's SQLite teardown. Removal requires a supported replacement for the concrete consumer; this delivery adds no library patch, private export or execution-owner framework.

General identity/configuration JSON fields keep their existing independent ordering. A mixed General request can partially apply those fields if UI admission fails. Combined SQLite UI preferences are atomic; unrelated JSON configuration and SQLite are not a distributed transaction. Theme JSON dual-writing is removed. Fallible General response/widget-token preparation finishes before the preference commit.

OOBE history inference retains sticky instance completion through the existing admitted completion operation. Removing the last message does not reset completion. Both model-options and UI snapshot handlers await the Boolean result and capture request authority before other asynchronous work.

## Focused qualification

Production source: `a77d05c8255f960f8d134c97d1d795acee35e3df`, based on `175b4f3cc49da2e99b7576efdf9846bb0070aa84`. Documentation-only commits can follow without changing the qualified production bytes.

- 409 passing host tests across 32 explicitly selected files, 2,774 assertions.
- Six actual default-application SDK scenarios: public conversations, native routing/reopen, queued routing race, Goal, Dream tools and process exit: 6 tests, 423 assertions.
- Total: **415 tests, 3,197 assertions**, plus runtime, private engine and qualification typechecks.
- Circular dependency check: 498 reachable files, no cycles. Silent-swallow checks: all zero. Changed-file hashes match before and after the run.
- Bun 1.4.4, TypeScript 7.0.2, public SDK 1.4.0, separate frozen private-engine dependencies. The installed profile and unused dev-only glob installation were not upgraded or qualified as a new deployment.

Counterexamples cover real WAL holds shorter and longer than five seconds, timer responsiveness, cancellation, extended BUSY/LOCKED codes, commit/rollback failure, callback non-replay, thenable prefix rollback, file/profile/request replacement, known-commit observer failures, cascade/media rollback and uncertain cleanup retention. The test files under `runtime/test/db`, `runtime/test/channels/web`, `runtime/test/agent-pool` and the selected default-factory cases retain these assertions.

Tests use Nice19, the central filesystem-isolating launcher, disposable SQLite and synthetic credentials/providers. Full/native-wide/hosted qualification, installed/live browser acceptance and rollout are separate operations. No install, restart, live DB/credential mutation, external provider/peer probe, retention change or financial-owner change was performed.

## Reduction and delivery

Against the base above, handwritten production changes add 495 and delete 930 physical lines: **−435 physical / −379 nonblank**. Tests add 1,284 and delete 1,060 physical lines: **+224 physical / +243 nonblank**. Documentation is separate. Earlier merged retirements receive no repeat credit.

The connection-policy owner and resource-owner counts are unchanged. The WAL helper/loop, mutable timeout wrapper state, obsolete executors and forwarding stages are deleted. Extra checkpoint completion state belongs to the existing owners and is required by the reproduced close/reopen and retention failures.

Source review was split by affected domain on 6.1-sol; reported blockers were fixed and re-reviewed. Focused source qualification does not itself merge the PR or close the issues. After explicit merge approval, verify the merged tree and fresh witnesses, reconcile both issue criteria, then close them. Deployment remains separately authorised.
