# Native host composition

Core constructs one public pi-durable application over its owned SQLite database. The SDK owns conversation execution, task and input ordering, context, compaction, results and recovery. Core binds authenticated product input, timeline identity, tools, credentials, channels and workspace resources to that application.

## Construction and services

[`prepareDefaultApplicationBackend`](../../runtime/src/runtime/bootstrap.ts) loads the qualified private engine after checking its dependencies. [`createApplicationBootstrapBundle`](../../runtime/durable-engine/src/application-bootstrap.ts) validates the application manifest and branch bindings, borrows the existing runtime owner and opens the SDK storage against the same physical database. The owner is acquired before this path can write.

[`createAgentPoolServices`](../../runtime/src/agent-pool/service-factory.ts) requires a callable `getDurableSession`. An empty lookup remains native; a missing lookup rejects construction. There is no legacy session-manager, binder, tool-factory, prewarm controller or idle-eviction timer. Passing the retired `legacyCapture` option to AgentPool is rejected. No resident capture composition remains.

The retained services provide model/authentication controls, attachments, branch metadata and MCP configuration inspection. [`DurableSessionPositionPort`](../../runtime/src/agent-pool/durable-runtime-adapter.ts) is an internal structural boundary for those product operations and committed projections. It does not construct an AgentSession, admit arbitrary prompts or own a second scheduler.

## Source and storage boundaries

The [application input port](../../runtime/durable-engine/src/host-application-input.ts) validates authenticated product ingress. SDK submissions and Core correlation use the shared [Bun SQLite adapter](../../runtime/durable-engine/src/bun-sqlite.ts); source and ownership checks run inside the write boundary. Retry is restricted to transaction acquisition, never an entered effect or callback.

Core's accepted-source, delivery and credential records retain their product purpose. They do not replace the SDK's execution history or task outcomes. Historical records and uncertain outcomes remain readable without recreating a legacy runner or replaying effects. See [operation binding](native-operation-binding.md) and [input retirement](native-input-retirement-review.md).

## Lifecycle and MCP

[`createRecoverableRuntimeBackend`](../../runtime/src/runtime/bootstrap.ts) retains one current backend and rebinds product readers only after the qualified recovery sequence. Close joins actual owned resources; uncertain cleanup retains ownership and propagates failure.

[Application features](../../runtime/durable-engine/src/application-optimizer-mcp.ts) attach outbound MCP, recall and independent optimisation/oversight to the executing SDK Harness. The [MCP runtime](../../runtime/durable-engine/src/mcp/runtime.ts) uses public `McpClient` and supports deferred tools, resources and templates over HTTP or stdio. Operator Settings save reference-only metadata; revision, grant and credential checks fence both sends and result publication. Discovery may retry setup, never tool effects. Cleanup joins transports under the current owner; a failed close stays rejected. There is no executable legacy outbound fallback or new inbound control server.

Agent-driven process exit uses [native process controls](../../runtime/durable-engine/src/host-process-controls.ts): a singleton accepted tool operation, committed terminal notice, fresh global idle check and confirmed SDK cleanup. A persisted old receipt cannot authorise another exit.

## Offline history and terminal fallback

Resident capture, cutover and conversion were removed in [#2017](session-import-retirement-2017.md). The explicit `session-import` CLI reads bounded v3 JSONL input into a fresh, separate SQLite destination. It refuses an existing destination and neither opens a live store nor schedules imported effects. This offline reader does not establish a second runtime mode.

The user retained standalone `pi` as the JSONL-backed terminal fallback. Core execution remains SQLite-only. Future durable terminal work is tracked separately in #2038.

## Qualification

Current boundaries have named cases in [`native-control-bootstrap`](../../qualification/native/native-control-bootstrap.test.ts), [`native-core-consumers`](../../qualification/native/native-core-consumers.test.ts), [`single-database`](../../qualification/native/single-database.test.ts), [`host-process-controls`](../../qualification/native/host-process-controls.test.ts), [`host-recovery`](../../qualification/native/host-recovery.test.ts) and [`session-history-import`](../../qualification/native/session-history-import.test.ts).

These are source and disposable-fixture qualifications. The [#1650 acceptance record](epic1650-acceptance.md) separately records the observed live provider and server checks, recovered startup and real-work latency, and forward-recovery limits. The [historical review](epic1650-final-review.md) retains its original source and accounting ranges.
