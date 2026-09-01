# Direct Earendil type audit

This audit checks that the ADR uses Earendil's execution type system directly and defines Piclaw types only for Piclaw service responsibilities. The original compile probe covered then-installed `0.84.1`; current compatibility probes cover installed `0.84.4`. Harness v3 `dev`/draft PR #8963 at `d14d6b22327d545d6a253f932165b63e48d7f9c8` supersedes several v2 type families as noted below.

## Earendil-owned type families

| Family | Direct exported types/values | ADR treatment |
|---|---|---|
| Harness | v3 generic `AgentHarness<TContext>`, `AgentHarnessConstructor`, `AgentHarnessOptions<TContext>`, `AgentLane`, `Hooks`, `Events`, `WatchHandle` | Use directly; no Piclaw execution port/interface; `AgentHarness.create` is concrete on the pinned source |
| Operation results | v3 `OperationResultRecord`, `RunResult`, `CompactionResult`, `NavigationResult`, `ResumeResult`, `QueueResult`, `CancelQueuedResult`, `AbortResult`, `DriveResult`, `AbortRequestResult` | Preserve selected exact tagged `Result`/outcome unions |
| Harness errors | v3 `LaneBusy`, `InvalidMessage`, `InvalidNavigation`, `NoActiveOperation`, `NothingToResume`, `OperationMismatch`, `Closed`, related tags, `HarnessFault`, `HarnessClosed` | Match direct tags/classes; no second error taxonomy |
| Drive/snapshots | `OperationRequest`, `OperationAdmissionResult`, `DriveResult`, `LaneSnapshot`, `SessionSnapshot`, `OpenOperation`, `SuspendedRun` | Deterministic gated-drive fixtures and reconciliation use selected exact shapes |
| Session/storage | `Storage`, `Write`, `Entry`, `Value`, `ValueList`, `UsageRow`, `SessionReader`, `SessionMutation`, `SessionMutator`, `SessionRepo`, `Session`, `Branch`, metadata/errors | Harness v3 target; backend passes selected conformance, migration, ownership and fork suites |
| Released v2 recovery reducer | `reduceLaneState`, `validateRecordLog`, `RecordLogCorruption` from the historical baseline | Historical evidence only; Harness v3 uses total current values/state and bounded restore, with no reducer/history |
| Models/auth | `Models`, `Model`, `CredentialStore`, `ModelsError`; concrete `ModelRuntime implements Models` | Pass directly in `AgentHarnessOptions` |
| Tools | Harness v3 `AgentTool.replay`, generic `AgentHarnessTool<TContext>`, `AgentToolResult`, update callback/mode | Use directly; explicit `safe`/`never`; no v2 widening binder in target |
| Environment | `ExecutionEnv`, `FileSystem`, `Shell`, `FileError`, `ExecutionError`, `NodeExecutionEnv` | Implement/delegate exact no-throw `Result` contract |
| Generic result/error | `Result`, `TaggedError`, `matchError` | May also be used by Piclaw service ports without pretending service errors are harness errors |
| Events/hooks/resources | v3 `HarnessEvent`, `HookMap`, `Resources`, `Skill`, `PromptTemplate`, sourced loaders | Use directly; Piclaw redacts/projects events and keeps commands service-side |
| Compaction/retry | `CompactionSettings`, `RetryPolicy`, `CompactionError`, helper results | Harness owns execution semantics |
| Live execution admission | one lane-owned Drive, `Gate.admit()`, stable tool invocation and operation `AbortSignal` | Harness-owned execution; never Piclaw durable authority or proof of effect outcome |
| Telemetry | `TelemetryContext`, `HARNESS_TELEMETRY_SCHEMA`, `AGENT_TELEMETRY_SCHEMAS` | Pass/use directly; Piclaw adds external service spans only |
| Durable backend | Harness v3 `Storage`/`SessionRepo` plus selected Memory/JSONL/SQLite implementation | Select one coherent v3 backend/source and prove host-owned writable authority plus required forks |
| Built-in tool binding | v2 contextual tool widened to `HarnessTool` | `0.84.1` fixture-only workaround; Harness v3 generic options/tools remove it |

## Piclaw-owned type families

These have no equivalent harness responsibility and remain Piclaw-specific:

- accepted source and canonical `sourceSeq`;
- Piclaw operation ID/version/phase/disposition;
- correlation to Earendil session/lane/run;
- timeline/media terminal commit request/result;
- delivery outbox intent/claim/result;
- scheduler claim, run-log and notification intent;
- Piclaw web projection DTO;
- service authorization/provenance;
- service restart reconciliation decision.

They may use Earendil's generic `Result`/`TaggedError` utilities. They must not extend or replace an Earendil execution union.

## Parallel types removed from the ADR

The review removed or prohibited:

- `HarnessExecutionPort`;
- `AgentHarnessLike`;
- Piclaw prompt/queue/abort handle/result aliases;
- `PiclawToolEffect`;
- custom model/tool script result semantics presented as production contracts;
- authoritative `HarnessBoundaryEventV1`;
- custom filesystem/shell result/error contracts;
- a permanent coding-agent helper compatibility interface.

Test-only `ContractEvidence`, migration reports, fault controls and Piclaw projection DTOs remain acceptable because they do not replace execution contracts.

## Churn policy

- Earendil types may change between selected versions.
- Piclaw updates direct imports, constructors, tools, environments, fixtures and tests.
- Old and new Earendil type shapes are not supported simultaneously in the new production path.
- Version-specific binding code is deleted when no longer needed.
- Semantic product contracts remain tests, not a frozen copy of Earendil's API.

## Compile probe

A temporary strict TypeScript probe against installed `0.84.1` verified:

- root, `./node` and `./session/testing` public imports used by the design;
- released `AgentHarness.create` assignability to the mechanically derived `0.84.1` test factory;
- direct `ModelRuntime`/`Models` and `CredentialStore` availability;
- direct local `NodeExecutionEnv` construction;
- the generic contextual built-in tool binder using one `Static<TSchema>` assertion after `HarnessTool` schema erasure.

The first probe correctly failed on private reducer imports and naive contextual tool spreading; the ADR was corrected. The final strict `0.84.1` probe passed and the transient source file was deleted. Current `dev` provides the expanded types, a public constructor and complete public lane drive, but it is not a selected Piclaw dependency. Piclaw must run a strict compile audit against one coherent release candidate or approved source before implementation.

## Audit result

The ADR now requires direct Earendil types across the entire execution boundary. Remaining custom interfaces in examples are Piclaw service-plane ports or test/report controls. Implementation must enforce this with import-boundary checks and `satisfies` assertions against the selected exact Earendil version.
