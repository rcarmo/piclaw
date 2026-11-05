# Native queue ownership

Native web input goes directly to pi-durable 1.4 public submission APIs. The SDK owns busy handling, inbox placement, model/tool execution and terminal results. Root stores the accepted message and source correlation. AgentPool activity flags, host lanes, legacy queue JSON and host operation settlement do not choose native placement.

## Admission and receipts

`AgentPool.isDurableRuntime()` identifies the backend. Ordinary native input requires source admission, the atomic message writer and the direct SDK dispatcher. Optional text preparation retains its invocation-local authority fence. Missing or revoked source, owner, target or caller authority fails closed; no legacy prompt or pending-observer fallback runs.

- Ordinary input and `/queue <text>` submit with `whenBusy: "followUp"`. An idle SDK conversation can place them immediately.
- `/steer <text>` and compose steering submit with `whenBusy: "steer"`. The SDK decides whether they enter its inbox or the current conversation.
- Nested slash commands in `/queue` or `/steer` are rejected before acceptance. `/queue-all` remains unsupported; global SDK delivery settings are not silently applied as per-chat controls.
- `persist_steer` cannot select another storage or execution path. Attachment-only input retains its source/media/structured metadata and does not require fabricated visible text.

A successful native HTTP receipt includes `created`, `row_id`, `submission_id` and `thread_id`. `row_id` identifies the accepted Root message; `submission_id` identifies the SDK input. `thread_id` can refer to an existing thread and must not be used as the new message ID. `queued: "followup" | "steer"` reports the observed SDK inbox state. Queued responses do not fabricate a placed `user_message`.

Source/frontier/polling-cursor writes are optional acknowledgements after SDK acceptance. If they fail, the dispatcher returns success only after re-proving the exact retained SDK input and current source/route/owner. Correlation repair does not resubmit accepted work. Result observation remains attached to the original SDK input.

An unconfirmed handoff still returns503 with `accepted: true` for its committed source. It publishes no speculative timeline post. Both compose skins retain the saved-source receipt without restoring it as an unsent draft or retrying it automatically. They preserve independently typed next drafts. This receipt does not prove SDK placement or completion.

## Queue actions and historical data

Native queue state comes from the SDK inbox. Preserved legacy queue JSON is retained as history and is not projected as executable native work.

A native queue action uses the exact SDK submission ID and explicit target chat. Steering changes only the public mutable inbox mode; accepted submission bytes remain unchanged. The item stays visible until actual SDK placement/removal. Removal uses the public SDK abort operation. Wrong-branch IDs cannot adopt, remove or steer another chat's input.

An ID shared with a preserved legacy row is ambiguous and returns409 unchanged. A preserved row without an SDK submission also returns409 unchanged. Native actions do not fall through to legacy materialisation or withdrawal. Historical schema and source records remain intact.

Write authority is captured before request-body awaits and rechecked at the guarded mutation. Native watches publish queue changes, placement, status and retained replies. The compatibility worker performs only a direct admission handoff: it does not advance native cursors, materialise old queue rows, publish synthetic run status, wait for a host terminal or schedule another host wake.

## Producer paths and verification

Peer HTTP relay, direct chat-tool relay and `enqueueAgentMessage` use the same source/message/SDK path. They retain source/target and reply descriptors, media links, structured blocks and explicit thread lineage. Runtime-message adapters preserve `created`, source-row and SDK IDs without manufacturing a timeline message.

Actual SDK qualification is in `native-peer-input.test.ts`, `native-web-queue-contract.test.ts`, `native-http-input.test.ts` and `native-source-cursor-ack.test.ts` under `qualification/pi-durable-130`. It covers stale host activity, before/after-source starting races, stream ending before submission, metadata, branch controls, ambiguous IDs, optional ACK faults and reopen without replay. Host import/transaction tests separately check required ports, caller revocation, cancellation and absence of legacy lifecycle dependencies.

These checks do not certify every model-side multimodal payload, reconnect scenario or latency claim. Native admission does not consult financial expense limits. Passive token/context/provider-cost observation and explicit Goal token limits remain separate contracts. Historical replay reports remain in the non-executable [queue audit archive](../archive/legacy-queue-audit/README.md).
