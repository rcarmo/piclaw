# Dream → pi-durable mapping review

Dream now maps private execution directly to public pi-durable submission, result and abort APIs. Fresh Dream execution has no S01 operation, host execution binding or S02 completion gate. This is source qualification, with no installation or live Dream run.

## Execution and authority

| Stage | Source | Ownership |
| --- | --- | --- |
| Manual/IPC/startup trigger | `runtime/src/runtime/wiring.ts` | Existing domain task delivery; no conversation execution queue is added. |
| Scheduled occurrence | `runtime/src/task-scheduler.ts` | S07 recurrence/lease identity supplies the stable invocation UUID and revocable caller guard. |
| Domain preparation/finalisation | `runtime/src/dream.ts` | Access/AutoDream eligibility, FD lock, backup, daily-note preparation and deterministic memory/index refresh remain. |
| Private context | `host-background-context.ts` | Public SDK create/configure and immutable source/policy metadata. No Core chat or public route is created. |
| Submission and result | `HostConversationRuntime.runDreamConversation` | `Conversation.submit({whenBusy:"reject", requestId, entry:{kind:"app.dream-input",…}})`, `Submission.wait()` and the actual SDK assistant entry. |
| Provider/tool authority | `qualifyDreamSource`, `captureDreamSource` | Actual SDK task, live run/slot, immutable input, assistant/model provenance, stored configuration and current domain lease. Credential awaits and effects retain synchronous guards. |
| Compaction | `qualifyDreamSource` | Actual summarise checkpoint, live compaction slot and exact generation owner, or genuine background-threshold task. No host maintenance operation is created. |
| Cleanup | `runDreamConversation` | Absolute deadline and exact private `Conversation.abort(...,{background:true})`; shutdown joins SDK closure before releasing the caller lease. |

The invocation promise set only joins shutdown. Source maps retain immutable SDK/source lookup; the domain-owner map retains caller leases. They store no placement, run status, retry or terminal state.

Nonfinancial model/tool ceilings, quota integrity and source/deadline guards remain. Codex uses the SDK source identity for account/routing/artifact attribution and retires its routing hint when the invocation ends. Token/provider-cost reporting remains passive. Failed optional usage or artifact projection does not replace a confirmed SDK success; current caller/ownership checks still apply.

## Accepted-input uncertainty and history

A lost submit or completion return triggers lookup and observation of the same accepted SDK submission. It does not grant cancellation or another submit. Explicit deadline/shutdown cleanup uses the captured private SDK scope. A repeated invocation with existing SDK work is rejected without resubmission.

Historical S01/S02, payload and SDK records remain unchanged. Startup refuses unfinished private work without its live caller lease before scheduling; it does not fabricate settlement, clear holds or replay accepted input. Completed private history remains readable on reopen.

## Focused evidence

The final isolated run passed all 25 selected native files: 183 terminal parent/component tests, with no failed files or timeouts. Nested child assertions are not counted again. Its Dream-specific cases cover:

- A real source-bound write, parent isolation and zero fresh Dream S01/S02/messages/chats/host bindings. Old host `submit`, `wait`, `settle` and `reconcile` are poisoned and never called.
- Caller and physical-model revocation across credential preparation, preventing provider execution.
- Deadline abort/join and caller-lease retention through a held SDK model during shutdown.
- Independent side-source admission alongside SDK-only Dream.
- Lost submit and completion acknowledgements, with one SDK submit and no provider replay on reopen.
- Automatic compaction through the actual private SDK task/input.
- Actual Codex request conversion, restricted tools, source-bound write, account/routing scope, passive usage, optional-reporting faults and reopen without replay.

Core focused checks passed 130 tests/844 assertions across 12 files. The unchanged Dream domain/lock/cleanup/all-chat tests passed 28 tests/135 assertions in four files. Root and both private type projects and `make build-ts` passed. The first combined Core run hit the unchanged five-second entry-point-audit deadline; the standalone check and exact unchanged combined repeat passed. The original failure is retained, with no causal claim or deadline change.

Evidence is retained under `tmp/piclaw/runs/pr1966-review/`: `dream-final-native.log`, `dream-final-core-r2.log`, `dream-final-*-types.log` and the earlier failure/diagnostic receipts. The original review observed one S01 and one S02 row before conversion; `dream-mapping-review.log` remains historical evidence and is not relabelled.

No full-suite, deployment, live latency, provider-authentication rollout or complete epic acceptance is claimed.
