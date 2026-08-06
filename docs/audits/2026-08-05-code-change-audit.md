# Code-change audit, 5 August 2026

The audit found three logical defects in the code merged on 5 August. All three have local fixes and regression tests.

## Scope

- Base: `e574dc690fcb01da0a4adf55231a8196a88bada9`
- Audited head: `29d33b432dd9b7c9b98224842d4e941fa8e51ac5`
- First-parent changes: 16
- Introduced commits: 30
- Changed paths: 53
- Handwritten production and test files: read directly
- Generated bundles and maps: checked by rebuilding and `check:stale-dist`

The repository local day was used as the boundary. This includes PR #869, merged at 00:08 local time but 23:08 UTC on the previous date.

## Method

The final cumulative source was read by subsystem. Each contributing commit remained visible through `git log` and range diffs. Tests were checked for the condition they proved, not only their exit status.

The review covered:

- compaction validation, repair and emergency rotation;
- attempt finalisation and recovery classification;
- tool-call admission, completed execution budgets, tool ceilings and restoration;
- abort provenance, restart handling, Dream first-response grace and the progress watchdog;
- MCP configuration loading, quarantine, credential hydration and status reporting;
- web message selection, terminal persistence, deferred follow-ups, thread lineage and markers;
- model/thinking settings affinity;
- CI, release, E2E and maintenance workflow contracts;
- every changed test and generated web output.

## Defect 1: automatic tool-budget continuation lost its lineage

### Code path

`runtime/src/channels/web/handlers/agent.ts`, `processChat()` error finalisation.

### Trigger

A healthy turn reaches the completed tool budget, produces a durable terminal error or recovered draft, and schedules its one permitted automatic continuation.

### Previous result

The idempotency key used the source thread, but the queued item used `thread_id: null`. Materialisation could create a new root. A later tool-budget stop then had a different key and could schedule another continuation. The reservation was also written before terminal outcome persistence and was not released if queue persistence threw.

### Expected result

The continuation stays on the source thread. One lineage gets at most one automatic continuation. No reservation survives a failed queue write or consumes the one-shot allowance before terminal output is durable.

### Fix

- Resolve the root row ID and use it for both the ledger key and queued `threadId`.
- Persist the terminal outcome before reserving and enqueueing.
- Release the reservation when enqueue fails.
- Do not enqueue if a numeric lineage row cannot be resolved.

### Evidence

`runtime/test/channels/web/web-channel.test.ts` now checks:

- durable materialisation on the original thread;
- reservation release after simulated queue persistence failure;
- one continuation across two tool-budget stops in the same lineage.

Focused result: 3 passed, 0 failed.

## Defect 2: abort provenance could label a later turn

### Code path

`runtime/src/agent-pool/abort-provenance.ts` and `runtime/src/agent-pool/run-agent-orchestrator.ts`.

### Trigger

A control abort records a chat-scoped cause when no prompt is active, or orchestration exits through its outer exception path before attempt finalisation consumes the cause.

### Previous result

The map retained the first cause by chat. The outer exception logger read it without deleting it. A later turn on the same chat could inherit `user_command` or `service_shutdown` even though that abort did not end the later turn.

### Expected result

Abort provenance belongs to one active run. A new run starts without stale provenance. Every terminal path consumes its recorded cause.

### Fix

- Clear stale provenance at `runAgentPrompt()` entry.
- Consume, rather than read, provenance in the outer exception path.

### Evidence

`runtime/test/agent-pool/run-agent-orchestrator.test.ts` now checks stale-entry clearing and exceptional-exit consumption. Focused result: 2 passed, 0 failed.

## Defect 3: length repair could repeat the same effective output cap

### Code path

`runtime/src/extensions/smart-compaction/progressive.ts`, `completeCompactionPrompt()`.

### Trigger

A progressive chunk or merge ends with `stopReason=length` while the model context constrains the safe output below the operator-requested cap.

### Previous result

The retry requested half of the original requested cap. `getSafeCompactionMaxTokens()` could reduce both attempts to the same context-limited effective cap. The repair text asked for a smaller answer, but the provider limit was unchanged.

### Expected result

The one repair attempt must be materially smaller than the first provider request.

### Fix

- Store the effective `safeOutput.maxTokens` on validation failure.
- Use half of that effective cap for length repair, with the 512-token minimum.

### Evidence

The smart-compaction test now uses a constrained 10,000-token context and asserts that the second provider cap is exactly half of the first effective cap. Focused result: 1 passed, 0 failed.

## Reviewed areas without another proven defect

### Compaction and recovery

The emergency rotation paths replace both `activeSession` and `activeSessionCtrl`. Recovery resumes with a neutral continuation after persisted input or tool activity. Failed or insufficient recovery compaction cannot retry the same oversized session without a successful rotation.

The three skipped pre-prompt compaction tests are not counted as passing evidence. They pre-date these fixes and remain visible in the affected suite result.

### Tool state

Protected recovery replaces `setActiveToolsByName` for the whole attempt and restores the original method and tool set in `finally`. Ordinary turns restore the configured default only when the inherited active set is empty and no explicit ceiling applies. Completed parallel admissions may settle, but no new call is admitted after the completed execution budget is reached.

### Restart, Dream and watchdog

Abort causes are recorded before prompt timeout, stale-progress abort, context-pressure abort and planned shutdown abort. Dream receives extra grace only before its first provider event. Streaming and tool phases use the normal watchdog timeout.

### MCP startup

The adapter receives one prepared configuration. Invalid optional servers are disabled individually. Valid keychain credentials remain available. Duplicate environment targets, missing secrets and unresolved environment references are quarantined and exposed through `/agent/status` without exposing secret values.

### Web persistence and status

Terminal output is persisted before the inflight cursor is completed. Deferred follow-ups materialise into ordinary persisted user messages and retain their thread ID. Failed materialisation is retried and then dropped after the bounded limit. Error markers carry recovery, tool-budget and abort fields.

### CI and generated files

`scripts/check-actions-workflows.ts` fixes the intended routing contract: main/PR fast CI, exact-SHA release integration, UX-only prerelease tags, no cancellation for release tag work, and three E2E shards with the same spec set.

Generated classic web bundles are not treated as independent source. They must match a clean `build:web` result and pass `check:stale-dist`.

## Validation before merge

Completed locally:

- `bun run check:actions-workflows`
- `bun run typecheck`
- `bun run lint`
- `git diff --check`
- affected tests: 409 passed, 3 skipped, 0 failed across 14 files

Required before this audit is complete:

- clean web rebuild and `check:stale-dist`;
- `make ci-fast` on the final branch;
- pull request review and merge;
- exact final `main` CI success.
