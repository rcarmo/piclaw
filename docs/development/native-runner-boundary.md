# Native input and execution boundary

The shipped AgentPool has no `runAgent()` compatibility runner or resident legacy session constructor. Current execution enters the native application through an explicitly admitted source. Supplying old budget IDs, session objects or capture options cannot manufacture that authority.

## Qualified entry points

| Product operation | Current boundary | Execution owner |
| --- | --- | --- |
| Accepted conversation input | Authenticated application ingress and exact native conversation/source binding | Public SDK submission and task lifecycle |
| Scheduled agent occurrence | `dispatchScheduledAgent`, with current occurrence lease, model and accepted-source proof | Public SDK conversation; Core retains schedule/delivery authority |
| Dream | `dispatchDreamOperation`, private context and exact current operation/model | Public SDK submission, result and joined cancellation |
| Bound side prompt | `dispatchSidePrompt`, exact request/source identity and approved context | Public SDK; no generic unbound background runner |
| Host command and controls | Current source and qualified command policy; captured operation/submission scope | Existing SDK controls and Core product boundary |

The ports are exposed by [`RuntimeBackend.sessionOptions`](../../runtime/src/runtime/bootstrap.ts) and assembled in [`application-bootstrap.ts`](../../runtime/durable-engine/src/application-bootstrap.ts). [`createApplicationHostInput`](../../runtime/durable-engine/src/host-application-input.ts) handles product input admission. The [structural adapter](../../runtime/src/agent-pool/durable-runtime-adapter.ts) does not create conversations, select an engine, poll a second queue or grant work merely from caller-supplied fields.

## Controls, recovery and private work

Controls capture their operator target before touching the SDK. A stale cancellation cannot expand to a later submission. Committed outcomes retain exact task/source correlation; missing or uncertain external outcomes are not reclassified as safe to replay.

Dream, Regrets and scheduled work use their qualified private-context or occurrence bindings. Private context publication and policy checks do not themselves dispatch a model. Cancellation and shutdown join admitted SDK work before product resources can be released. Historical recovery reads verify already-accepted source and submission evidence; they do not create a new prompt from an old record.

Native process exit is separately guarded by [`host-process-controls.ts`](../../runtime/durable-engine/src/host-process-controls.ts). Other active, queued or uncertain native work refuses the request. There is no `resume_message` or recovered restart queue.

## Retired and retained surfaces

- `runAgent`, resident capture managers and automatic cutover/conversion are removed. A retired `legacyCapture` option is rejected; it selects no executable compatibility mode.
- Historical source, schema and outcome readers preserve supported data. The [offline importer](session-import-retirement-2017.md) accepts read-only JSONL input only into a fresh separate SQLite destination.
- The standalone `pi` CLI remains the user-approved JSONL terminal fallback. It is separate from Core's SQLite-only runtime.
- Transport support depends on the actual qualified admission port. This document supplies no universal non-web, external-provider, fleet or uncooperative-effect guarantee.

## Qualification

See [`native-core-consumers`](../../qualification/native/native-core-consumers.test.ts), [`accepted-steer-recovery`](../../qualification/native/accepted-steer-recovery.test.ts), [`host-recovery`](../../qualification/native/host-recovery.test.ts), [`scheduler-production-lifetime`](../../qualification/native/scheduler-production-lifetime.test.ts) and [`host-process-controls`](../../qualification/native/host-process-controls.test.ts). Each test retains its exact fixture and contract scope.

The broader review, retained public-SDK/product boundaries and unproved live acceptance are recorded in [the #1650 review](epic1650-final-review.md).
