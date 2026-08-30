# Earendil-native effector contracts

Historical Harness baseline: exported types and semantics in the `0.84.1` Earendil family. Current-loop runtime: coherent `0.84.4`, which retains the released-v2 unsupported Harness shape. Target design: Harness v3 [`harness.md`](https://github.com/earendil-works/pi/blob/5f7195c51eac43cdf329f813a7ef020d7bd74527/packages/agent/docs/harness.md), with current draft implementation evidence in PR #8076 at `fd389abc4677b4e0fa5dc9b2bbd2e63418f079b4`. Version-specific v2 details below are baseline evidence and must be replaced by direct v3 contracts when one coherent tagged Harness implementation is selected.

## Rule

Piclaw must not define a parallel execution abstraction over Earendil. Production execution code should use Earendil's exported types and method semantics directly. Piclaw-specific types are limited to service-plane concerns absent from Earendil: accepted input, Piclaw operation correlation, timeline/media settlement, external delivery and web projection.

Allowed composition uses TypeScript's standard `Pick`, `Omit`, generics and declaration merging over Earendil exports. It must not rename a harness method, wrap a tagged harness error in a second error taxonomy, or replace Earendil `Result`/session/tool semantics with a Piclaw equivalent.

## Supported imports

The following block is the historical verified `0.84.1` import baseline; current `0.84.4` compatibility probes exercise the corresponding public assignments. Harness v3 draft PR #8076 changes this surface substantially (`AgentHarnessConstructor`, generic harness/options/tools, `Storage`/register types, typed events/hooks, `NextRunResult`, `LaneLastResult`). At the pinned draft head `AgentHarnessConstructor` is still interface-only. Production must regenerate the import list from one selected tagged v3 release and delete this block.

Use public package exports:

```typescript
import {
  AgentHarness,
  type AgentHarnessOptions,
  type AgentLane,
  type RunResult,
  type CompactionResult,
  type NavigationResult,
  type ResumeResult,
  type QueueResult,
  type CancelQueuedResult,
  type AbortResult,
  type SuspendedOperation,
  type LaneSnapshot,
  type SessionSnapshot,
  type ActionInfo,
  type Hooks,
  type Events,
  type WatchHandle,
  type HarnessTool,
  type AgentHarnessTool,
  type AgentHarnessToolContextSource,
  type AgentToolResult,
  type AgentToolUpdateCallback,
  type ExecutionEnv,
  type FileSystem,
  type Shell,
  type FileError,
  type ExecutionError,
  type Result,
  type Session,
  type SessionRepo,
  type SessionStorage,
  type SessionMetadata,
  type SessionTree,
  type Entry,
  type JsonlSessionMetadata,
  type JsonlSessionRepoFileSystem,
  type Resources,
  type StreamOptions,
  type Skill,
  type PromptTemplate,
  type CompactionSettings,
  type TelemetryContext,
  JsonlSessionRepo,
  InMemorySessionRepo,
  createReadTool,
  createWriteTool,
  createEditTool,
  createBashTool,
  loadSourcedSkills,
  loadSourcedPromptTemplates,
  HARNESS_TELEMETRY_SCHEMA,
} from "@earendil-works/pi-agent-core";

import { NodeExecutionEnv } from "@earendil-works/pi-agent-core/node";
import { createSessionBackendConformance } from "@earendil-works/pi-agent-core/session/testing";

import type {
  Api,
  Model,
  Models,
  CredentialStore,
  AssistantMessage,
  DeferredHandle,
  Usage,
} from "@earendil-works/pi-ai";

import { ModelRuntime } from "@earendil-works/pi-coding-agent";
```

The installed coding-agent package contains `dist/server/create-harness.js`, but its export map does not expose that path. Piclaw must not use this private deep import. Build from public lower-level agent-core exports at the selected version. Do not require or preserve a coding-agent factory shape.

For the Harness v3 target, additionally require the selected public equivalents of `AgentHarnessConstructor`, `Storage`, `Transaction`, `Register`, `UsageRow`, `HarnessEvent`, `HookMap`, `NextRunResult` and `LaneLastResult` as specified in [`earendil-harness-v3-assessment.md`](earendil-harness-v3-assessment.md).

## Direct harness boundary

Do not add `HarnessExecutionPort`, `AgentHarnessLike`, `PromptHarnessRun`, `HarnessRunHandle` or renamed queue/abort result types.

The runtime registry stores actual selected-version Earendil objects. The shown binding uses `0.84.1` names; Harness v3 declares construction through `AgentHarnessConstructor`, whose concrete public implementation is still absent at the pinned draft head:

```typescript
interface PiclawHarnessBinding {
  readonly harness: AgentHarness;
  readonly lane: AgentLane;
  readonly suspendedAtOpen: readonly SuspendedOperation[];
  readonly piclawOperationId: string;
  readonly sessionId: string;
  readonly laneName: string;
  harnessOperationId: string | null; // public name is runId
}
```

`PiclawHarnessBinding` is a service correlation record. It does not change harness behaviour. Calls and results remain exact:

```typescript
const run: RunResult = await binding.lane.prompt(promptMessages);
const queued: QueueResult = await binding.lane.steer(steerMessage);
const followUp: QueueResult = await binding.lane.followUp(followUpMessage);
const compacted: CompactionResult = await binding.lane.compact({ customInstructions });
const aborted: AbortResult = await binding.lane.abort();
const resumed: ResumeResult = await binding.lane.resume();
```

Expected rejection uses the selected Earendil tagged `Result` errors (`LaneBusy`, `NoActiveRun`, `NoActiveOperation`, `MissingIdentities`, `NothingToResume`, `Closed`, and related tags). Piclaw matches `_tag` or exported predicates and does not convert expected rejection into a second generic exception. Harness v3 also returns accepted failed/aborted/suspended outcomes and exposes `lane.lastResult` after terminal settlement.

Unexpected implementation faults may throw `HarnessFault`, `HarnessClosed` or another `Error`; these are faults, not ordinary result branches.

## Direct session persistence

Earendil owns transcript/session mutation. In released `0.84.1` this uses `SessionRepo`, `Session`, `SessionStorage`, entries and operation records. Harness v3 replaces that storage contract with `Storage.commit(Transaction)`, immutable `Entry`, mutable typed `Register`, append-only `UsageRow`, `Session` and `SessionRepo`; Piclaw should adopt the selected v3 surface directly.

For released-v2 fixture work, the exported `JsonlSessionRepo` is available and its filesystem dependency is typed as:

```typescript
type JsonlSessionRepoFileSystem = Pick<
  FileSystem,
  | "absolutePath"
  | "joinPath"
  | "readTextFile"
  | "writeFile"
  | "appendFile"
  | "renameFile"
  | "fileInfo"
  | "listDir"
  | "exists"
  | "createDir"
  | "remove"
>;
```

This v2 repository evidence does not select its unfinished format 4 for production. Harness v3 explicitly replaces the current implementation/storage shape. Piclaw chat/operation correlation remains in Piclaw's database and cannot become Earendil session state.

A selected Harness v3 backend implements that version's `Storage`, `Session` and `SessionRepo` contracts and passes its conformance suite unchanged. Piclaw does not wrap it in another transcript repository interface.

The installed v2 files contain `reduceLaneState()` and `validateRecordLog()`, but `0.84.1` does not package-export them. Harness v3 intentionally eliminates orchestration-history reduction: current total state lives in registers and restore performs bounded point reads/hydration. Piclaw must neither deep-import the v2 reducer nor implement a second reducer. PR #7784's generic v2 `findRecords()` proposal is not a v3 requirement. Production uses the selected public `AgentHarnessConstructor`, snapshots, `getLastResult()`, `SessionReader`, `Session` and storage contracts.

## Direct model and credential contracts

Piclaw's installed `ModelRuntime` already implements the released `Models` contract. Pass it directly if it satisfies the selected Harness v3 `Models` surface; otherwise update the concrete runtime rather than wrapping it. Harness v3 target construction is:

```typescript
interface PiclawToolContext {
  env: ExecutionEnv;
  chatJid: string;
  operationId: string;
}

const options: AgentHarnessOptions<PiclawToolContext> = {
  session,
  models: modelRuntime,
  model: selectedModel,
  toolContext: resolvePiclawToolContext,
  tools,
  // ...
};
```

There is no `PiclawModelEffector` or stream wrapper. Earendil calls `Models.streamSimple`, `fetchDeferred` and `cancelDeferred` with its exact semantics.

Piclaw's `FileCredentialStore` already implements Earendil `CredentialStore`. Keep that direct contract. `CredentialStore.modify()` remains the only serialized write path; no alternate keychain credential interface is introduced at the harness boundary.

Piclaw may continue using `ModelRuntime`-specific registration/status methods outside the harness, since `ModelRuntime` is the concrete `Models` implementation. Harness construction accepts it as `Models`.

## Direct `ExecutionEnv` contract

Filesystem and shell effects use Earendil `ExecutionEnv`, which is exactly `FileSystem & Shell`.

Important semantics:

- all `FileSystem` operation methods resolve `Result<T, FileError>` and must never throw/reject;
- `Shell.exec()` resolves `Result<{stdout, stderr, exitCode}, ExecutionError>`;
- `FileError.code` and `ExecutionError.code` are the selected version's error taxonomy;
- `cleanup()` is best effort and must not throw/reject;
- paths are relative to `env.cwd` unless absolute;
- symlinks are not followed implicitly; `canonicalPath()` is explicit;
- abort is supplied through the method's `AbortSignal`/`ShellExecOptions.abortSignal`.

For ordinary local tools, prefer the public `NodeExecutionEnv` directly if it meets Piclaw's process/security requirements.

Piclaw needs a custom `ExecutionEnv` implementation only for semantics the public environment does not provide, principally:

- keychain-backed shell environment resolution;
- session-scoped SSH filesystem/shell routing;
- Piclaw process tracking/observability requirements.

That implementation must still expose Earendil methods and `Result` errors exactly. It can delegate to `NodeExecutionEnv` locally and a remote backend for SSH. It must not expose a Piclaw-specific filesystem or shell interface to the harness.

At released `0.84.1`, a per-turn environment snapshot must be closure-bound because `AgentHarnessOptions.tools` erases contextual tool types. Harness v3 directly defines generic `AgentHarness<TContext>`, `AgentHarnessOptions<TContext>` and `AgentHarnessTool<TContext>[]`; it resolves `toolContext` once per live/restored tool batch. Target implementation should use those v3 types directly and delete the v2 binder.

The following binder is only a `0.84.1` fixture/baseline technique, not the Harness v3 target:

```typescript
const contextSource: AgentHarnessToolContextSource<PiclawToolContext> = async () => ({
  env: await resolveExecutionEnv(chatJid),
  chatJid,
  operationId,
});

const contextual: AgentHarnessTool<PiclawToolContext, typeof schema, Details> = createTool();
const bound: HarnessTool = {
  ...contextual,
  async execute(id, params, signal, onUpdate) {
    const context = typeof contextSource === "function" ? await contextSource() : contextSource;
    return contextual.execute(id, params, signal, onUpdate, context);
  },
};
```

This binding preserves the `0.84.1` tool types and result semantics. It must be deleted when adopting Harness v3 generic contextual tools. `chatJid` and Piclaw operation ID remain application metadata in Piclaw's selected context type; built-in tools need only `{ env }`.

## Direct built-in tool contracts

Use Earendil's built-in tools rather than wrapping Piclaw's legacy read/write/edit/bash definitions. The following `0.84.1` binding illustrates baseline composition; Harness v3 should receive `AgentHarnessTool<TContext>[]` directly:

```typescript
import type { Static, TSchema } from "typebox";

function bindTool<TContext extends object | undefined, TSchemaValue extends TSchema, TDetails>(
  tool: AgentHarnessTool<TContext, TSchemaValue, TDetails>,
  contextSource: AgentHarnessToolContextSource<TContext>,
  replay: "safe" | "never",
): HarnessTool {
  return {
    ...tool,
    replay,
    async execute(id, params, signal, onUpdate) {
      const context = typeof contextSource === "function"
        ? await contextSource()
        : contextSource;
      // HarnessTool erases TSchema to unknown at 0.84.1; the harness has
      // already validated params against tool.parameters before this call.
      return tool.execute(id, params as Static<TSchemaValue>, signal, onUpdate, context);
    },
  };
}

const tools: HarnessTool[] = [
  bindTool(createReadTool<PiclawToolContext>(), contextSource, "safe"),
  bindTool(createWriteTool<PiclawToolContext>(), contextSource, "never"),
  bindTool(createEditTool<PiclawToolContext>(), contextSource, "never"),
  bindTool(createBashTool<PiclawToolContext>({ prepare }), contextSource, "never"),
];
```

This generic is required only because `0.84.1` `HarnessTool` erases the schema parameter. Harness v3's generic options/tools remove that widening and resolve one context per batch. No v2 compatibility binder should remain in the selected v3 production path.

The built-ins already implement:

- Earendil `AgentHarnessTool` execution signatures;
- `ExecutionEnv` access;
- path handling and file-mutation serialization;
- abort propagation;
- read/bash output truncation;
- streamed bash updates;
- exact edit validation/diff details;
- tool errors as thrown errors at the tool boundary.

Released v2 persists replay in `ToolStartedRecord`; Harness v3 persists effective arguments and replay state in `op.tool_args`/`op.state` around `effect_pending`. Piclaw should set `replay` explicitly even though v3 omission defaults to `never`.

Do not add a separate `PiclawToolEffect` interface. A target Piclaw-specific tool is a Harness v3 `AgentHarnessTool<PiclawToolContext>` directly. The following is the released-v2 fixture shape only:

```typescript
const tool: HarnessTool = {
  name: "example",
  label: "example",
  description: "...",
  parameters: schema,
  replay: "never",
  async execute(toolCallId, params, signal, onUpdate) {
    // return AgentToolResult; throw on failure
  },
};
```

Harness v3 directly accepts `AgentHarnessTool<PiclawToolContext>[]` and resolves context per batch; use that selected exact execute signature. Do not rename `AgentToolResult`, update callbacks, `executionMode`, `terminate`, `usage`, `addedToolNames` or `replay`.

## Harness-owned effect execution

Earendil's manual-drive `ActionInfo` already defines the execution effects. Piclaw must not create duplicate effectors for these actions.

| `ActionInfo.kind` | Earendil contract that performs it | Piclaw role |
|---|---|---|
| `commit` / entry/register/usage writes | Harness v3 `Storage.commit(Transaction)` through `Session` | Observe through typed events/instrumented test storage; never duplicate writes |
| lane/config/fact mutation | Harness v3 lane/session mutation line and register writes | Maintain Piclaw correlation/projection only |
| `stream_assistant` | `Models.streamSimple()` with `Model`, stream options and retry policy | Supply concrete `Models`/model; do not wrap stream semantics |
| `execute_tool` | exact Harness v3 `AgentHarnessTool<TContext>.execute()` | Supply direct tool definitions/context/environment |
| `fetch_deferred` | `Models.fetchDeferred()` | Supply `Models`; project status only |
| `cancel_deferred` | `Models.cancelDeferred()` | Piclaw cancellation fence precedes harness action |
| `hook` | `Hooks.on()` registrations | Register supported direct hooks |
| `sleep` | harness retry scheduler | Observe progress/deadline; no second retry timer |
| queue/write checkpoint actions | Harness v3 `pending.entry`, lane/operation state and placement transactions | Reconcile Piclaw accepted source to snapshot/current state |
| terminal transaction | Harness v3 register cleanup plus `lane.lastResult` | Use typed result/`getLastResult()` as Piclaw terminal candidate; Piclaw still commits service disposition |

Piclaw effectors begin outside this table: service acceptance, timeline/media transaction, external delivery, notifications and web projection. Session storage, model calls, tools, hooks and harness retry/compaction are Earendil-owned effects.

The candidate Harness v3 `EffectGate` is also Earendil-owned. Its process-local `assertOpen()` orders abort against hook/provider/tool/timer admission, but it is not a durable effect-start record. Piclaw must not wrap it or infer `not_applied` after a crash. Durable intent, external admission and durable settlement remain distinct fault boundaries.

## Direct replay policy

Earendil supports exactly `"never" | "safe"` replay. Harness v3 puts this on `AgentTool`, defaults omission to `never`, and persists the effective state/arguments needed for recovery. Piclaw adds no third replay state.

| Class | Earendil replay value | Examples |
|---|---|---|
| Deterministic read/query with no external mutation | `safe` | read, list, search, status, bounded introspection |
| General filesystem/process/network mutation | `never` | write, edit, bash, delete, send, remote workflow |
| Idempotent application mutation | `safe` only after reviewed exact-key reconciliation | compare-and-set/outbox operation with stable idempotency key |
| Unknown add-on tool | `never` | default until metadata and recovery are reviewed |

An unresolved `never` call follows Earendil suspended/recovery semantics and Piclaw containment policy. Piclaw does not silently reinterpret it as safe.

## Direct resources

Harness resources use Earendil `Resources`, `Skill` and `PromptTemplate` directly. Loaders can use `loadSourcedSkills()` and `loadSourcedPromptTemplates()` with an `ExecutionEnv`; Piclaw provenance can be preserved in the generic source value and mapped to an extended `Skill`/`PromptTemplate` type.

```typescript
const resources: Resources = {
  skills,
  promptTemplates,
};
```

Commands are not an Earendil harness resource. Piclaw slash commands stay in the Piclaw service plane and call exact `AgentLane`/`AgentHarness` methods or Piclaw service operations after authorization.

The installed `createCodingAgentHarness()` helper is a private deep module, not a package export. At `0.84.1`, use public agent-core composition only for fixture evidence. The selected Harness v3 production path must use its public lower-level construction/types and must not retain the v2 helper shape.

## Direct compaction and retry semantics

Use Earendil's:

- Harness v3 `CompactionSettings` in options/current harness settings;
- Harness v3 `RetryPolicy` in options/current harness settings;
- `AgentHarnessStreamOptions` and patches, with harness-owned signal/lifecycle callbacks excluded;
- `AgentLane.compact()` and `CompactionResult`;
- Harness v3 structural operation state with `manual | threshold | overflow` compaction reasons;
- selected-version compaction outcomes/errors;
- suspended/resume outcomes.

Piclaw may choose product defaults and deadlines before constructing/configuring the harness. It does not wrap compaction in a second Piclaw single-flight/retry/rotation state machine.

## Direct hooks, events and watchers

Use `Hooks`, `Events`, `WatchHandle<LaneSnapshot>` and `WatchHandle<SessionSnapshot>` directly.

Released `0.84.1` declarations type hook/event payloads as `unknown`; Harness v3 specifies typed `HookMap` and `HarnessEvent` unions plus snapshot-first buffered watches. Target Piclaw must:

- adopt the selected v3 hook/event types directly;
- register only selected-version hook names;
- treat passive events as projection input rather than standalone authority;
- use `LaneSnapshot`, `SessionSnapshot`, operation results and `lane.lastResult` for authority/recovery;
- avoid defining an alternative authoritative harness event union.

Piclaw may define a separate **web projection DTO** after narrowing/redaction. That DTO is not a harness event type and cannot drive execution state.

Manual execution uses Earendil `ActionInfo` directly from `peekAction()`/`executeAction()`. The test fixture must produce the exact action union; it does not define renamed action commands.

## Direct telemetry

Pass Piclaw's `TelemetryContext` through the selected Harness v3 `telemetryContext` option (named `context` in released v2) and use the selected Earendil harness/AI telemetry schemas directly.

The schema already covers run, compaction, navigation, checkpoint, turn, step, tool, hook, sleep, event handler and session write spans. Piclaw adds an external parent/service span for accepted-source and terminal-settlement work; it does not duplicate harness spans under Piclaw names.

Tool arguments/results and secrets remain absent from telemetry. Piclaw correlation may be carried in its service parent span/baggage where the telemetry implementation supports it; Earendil's `pi.operation.id` continues to mean the harness durable operation ID.

## Exact error semantics

| Boundary | Expected failure mechanism |
|---|---|
| Harness operation methods | Earendil `Result<T, TaggedErrorUnion>` |
| Harness programming/runtime fault | thrown `HarnessFault`, `HarnessClosed` or `Error` |
| Filesystem operation | resolved `Result<T, FileError>`; never throw/reject |
| Shell execution | resolved `Result<T, ExecutionError>` |
| Session storage/repository | rejected `SessionError` with the selected version's code |
| Tool execution | throw on failure; harness converts to tool-result error semantics |
| Models request | stream/final assistant error semantics; `ModelsError` for auth/catalog operations as documented |
| Compaction helper | `Result<T, CompactionError>` |

Piclaw service-plane stores may use Earendil's generic `Result<T, TError>` and `TaggedError()` utility, but their error tags remain explicitly Piclaw service errors. They must not masquerade as harness errors.

## What remains Piclaw-specific

Only service-plane effects need Piclaw contracts:

- accepted-source transaction and sequence;
- Piclaw operation claim/version/disposition;
- operation-to-session/lane/run correlation;
- timeline/media terminal transaction;
- external delivery outbox and run log;
- scheduler claim/next-run policy;
- web/SSE projection DTOs;
- notification delivery;
- service restart/reconciliation coordination.

These contracts can use Earendil's generic `Result`/`TaggedError` utilities, but they are not added to Harness v3 options/lane/storage/environment/tool contracts.

## Implementation checks

- imports come from public package exports only;
- `ModelRuntime satisfies Models` and Piclaw credential storage satisfies `CredentialStore` at compile time;
- local/SSH execution environments satisfy `ExecutionEnv` and its no-throw `Result` contract;
- all tools satisfy selected Harness v3 `AgentHarnessTool<TContext>` with explicit replay metadata;
- selected Harness v3 backend passes its public conformance suite unchanged, including transaction, migration and concurrent-rewrite requirements;
- no private reducer import is used in production;
- fixture actions satisfy `ActionInfo` and operation results retain exact Earendil result types;
- no `HarnessExecutionPort`, `AgentHarnessLike`, `PiclawToolEffect`, custom filesystem/shell result or duplicate harness error taxonomy exists;
- projection DTOs are named Piclaw/web projections and never treated as harness authority.
