# Selected-version Earendil fixture and semantic contract suite

Status: required until Piclaw selects and validates one coherent Harness v3 source/package candidate. Released `0.84.1` is the historical stub baseline; installed `0.84.4` retains that unsupported Harness boundary. Earendil `dev`/draft PR #8963 at `d14d6b22327d545d6a253f932165b63e48d7f9c8` provides current design and implementation evidence, including complete public lane drive; session-wide watch and WP08 fork/storage work remain.

Historical fixture evidence follows the released-v2 session/record model, while current compatibility and backend-conformance probes execute against installed `0.84.4`. The target fixture follows Harness v3 entries, typed values/lists, immutable operation results, usage and direct durable drive. It does not imitate Piclaw's current agent loop or promise compatibility with another Earendil version.

## Purpose

The fixture lets Piclaw test the service/Harness boundary with deterministic fault controls before selecting a production source. It is disposable: when Piclaw selects a usable Earendil version, the fixture and direct integration update to that version, and the semantic product suite runs against both implementations.

The fixture is assessment output. Production implementation follows a separate approved phase.

## Proposed package layout

```text
runtime/test/fixtures/earendil-harness/
├── index.ts
├── create-fixture.ts
├── deterministic-driver.ts
├── deterministic-model.ts
├── deterministic-tools.ts
├── fault-plan.ts
├── trace.ts
└── types.ts
runtime/test/contracts/earendil-harness/
├── factory.ts
├── cases.ts
├── service-boundary-cases.ts
├── replay-cases.ts
└── run.ts
```

The future implementation should place fixture code under tests or a non-shipping development package. No production import may resolve to the fixture.

## API shape

The fixture implements the exported public `AgentHarness` interface and is supplied through Earendil's exported `AgentHarnessConstructor` contract. It does not copy or rename lane methods or results:

```typescript
import type {
  AgentHarnessConstructor,
  AgentHarnessOptions,
  Context,
} from "@earendil-works/pi-agent-core";

type CreateHarnessUnderTest = AgentHarnessConstructor["create"];

const fixtureConstructor: AgentHarnessConstructor = {
  create: createFixtureHarness,
};

async function runSelected<TContext extends object | undefined>(
  constructor: AgentHarnessConstructor,
  options: AgentHarnessOptions<TContext>,
  context: Context,
) {
  return constructor.create(options, context);
}
```

The fixture implements exactly the selected public surface and uses `AgentLane`, result unions, snapshots, hooks, events and trailing invocation `Context` without renaming them. A compile-time key/signature audit fails when Earendil changes that surface. Piclaw then updates to the new surface and deletes the old shape. Test-only fault/release controls remain outside the returned harness object.

At the pinned `dev` head, `AgentHarness.create` satisfies `AgentHarnessConstructor` and public lane execution is implemented; only session-wide watch remains `SliceNotImplemented`. A support manifest reports pass/fail/unsupported per selected source. Required boundary cases cannot be marked passed merely because an unreleased branch implements them.

## Fixture internals

For the Harness v3 target, the fixture uses the selected public types for:

- `Storage`, `Entry`, typed `Value<T>`/`ValueList<T>` addresses and `UsageRow`;
- `Session`, `Branch`, `SessionRepo` and backend/fork conformance;
- `AgentHarness`, `AgentLane`, `OperationResultRecord` and lane snapshot/result surfaces;
- typed events, snapshots, hooks and direct durable-drive boundaries;
- generic contextual tools, stable tool invocation identities, model contracts, compaction/retry and telemetry `Context`.

The fixture supplies deterministic implementations through direct public interfaces. An instrumented storage decorator records committed writes for assertions; production authority remains entries, values/lists, operation results and usage, not a test log. It implements enough target behaviour to drive semantic cases:

1. atomically accept input plus operation metadata/state and lane-owned inbox changes;
2. commit provider/tool/structural intent before dispatch;
3. apply process-local `Gate.admit()` immediately before deterministic hook/provider/tool/timer admission;
4. execute deterministic model/tool effects;
5. atomically settle output, usage and next total state;
6. consume lane-inbox IDs through placement commits;
7. commit cancellation control and drain before signal pull;
8. terminate by deleting operation-owned values/lists, clearing lane current operation and writing immutable `OperationResultRecord`;
9. expose selected direct drive and snapshot-first buffered lane watches.

The fixture must model the lane-owned Drive as process-local. Crash/restore discards that Drive and its gate, then reattaches from durable flat operation state. It must not add a durable `effect_started` marker that the selected Harness does not have.

Released `0.84.1` record/reducer code remains historical fixture evidence only. No new target case should require `operation_started`, `step_attempt`, `tool_started`, `operation_finished` or a recovery reducer. Piclaw service acceptance, terminal settlement and delivery run in a separate reference implementation around the fixture.

## Deterministic drive

The selected design has no manual action API. Deterministic interleaving uses injected providers/tools/clocks plus instrumented and gated storage around direct drive. Tests release one durable commit or external effect boundary at a time, then crash/reopen or continue through the public constructor.

The trace records operation state, commits, admitted effect identity and result tags. It excludes secret payload values.

## Deterministic model

The test model is a real Earendil `Models` implementation, preferably `createModels()` with the exported faux provider. Scripted responses are concrete `AssistantMessage` values and deferred steps use `DeferredHandle`; failures follow the `Models` stream/final-message contract rather than a Piclaw provider result union.

Tests hold/release provider streams through test-only controls outside `Models` to create races. Generated message IDs, timestamps and `Usage` values come from injected deterministic sources. Contract cases interact only through `AgentHarnessOptions.models`, `model`, `streamOptions` and harness methods.

## Deterministic tools

Each test tool is an Earendil `AgentHarnessTool<TContext>` directly. It returns `AgentToolResult`, throws on failure, receives the selected update callback, stable `AgentHarnessToolInvocation`, tool context and trailing invocation `Context`, and sets `replay` to `safe` or `never`.

Test-only controls can delay completion, record an external effect before throwing, or ignore abort to exercise late results. Those controls are closures captured by the tool implementation; they are not part of the tool contract. The trace stores tool call ID, name, replay policy, result status and effect key. Secret arguments/results are replaced by stable hashes.

## Fault plan

```typescript
interface FaultPlan {
  at: string;
  occurrence?: number;
  mode:
    | "throw_before"
    | "effect_then_throw"
    | "ack_then_crash"
    | "duplicate_result"
    | "delay_result"
    | "corrupt_state";
}
```

Named fault points include every Harness v3 storage/effect boundary, including before intent, after intent, after `Gate.admit()` admission, after external acknowledgement and before settlement. They also include Piclaw acceptance/claim/settlement writes, timeline commit, queue delivery, direct-drive boundaries, selected migrations, host replacement, forks and outbox delivery.

A simulated crash discards in-memory actors, reopens Piclaw service state and the Earendil `SessionRepo`, then continues through the same public contracts.

## Shared contract runner

```typescript
interface HarnessContractCase {
  id: string;
  run(createHarness: CreateHarnessUnderTest): Promise<ContractEvidence>;
}

async function runHarnessContract(
  createHarness: CreateHarnessUnderTest,
): Promise<VersionMigrationReport>;
```

`ContractEvidence` and `VersionMigrationReport` are test-report DTOs only. They do not wrap or replace Earendil operation results.

The runner is test-framework neutral. Bun tests register each case for:

- `fixture`;
- released `0.84.1` only for supported baseline methods/negative capability evidence;
- pinned `dev`/PR #8963 for source-level public-drive evidence, never as a production dependency;
- one later selected source/package build with the same direct constructor.

The report contains:

- pass/fail/unsupported per case;
- normalised Harness v3 storage transactions and terminal current state;
- normalised Piclaw service log;
- selected action/effect trace;
- semantic diff;
- installed package/version/commit/specification metadata.

## Harness-level cases

| ID | Case | Required assertion |
|---|---|---|
| HC-001 | Simple prompt | Acceptance precedes provider intent/effect; terminal transaction yields one immutable operation result |
| HC-002 | Tool prompt | Tool `effect_pending` commits before execution; result settlement and final run happen once |
| HC-003 | Parallel tools | Effects may complete out of order; finalisation/result entries commit in source order |
| HC-004 | Safe replay | Restored `effect_pending` tool re-executes only when persisted and current declarations are `safe` |
| HC-005 | Never replay | Restored `never` tool settles interrupted under its reserved result ID and is not executed again |
| HC-006 | Steer | Lane-owned tagged inbox preserves accepted steer until one eligible boundary consumes it |
| HC-007 | Follow-up | Lane-owned follow-up remains queued until an eligible finish boundary or later run captures it |
| HC-008 | Next run | Lane-owned next-run input survives terminal cleanup and is captured once by a later operation |
| HC-009 | Abort | Cancellation control commits before signal pull; late model/tool results cannot create a second terminal transaction |
| HC-010 | Compaction | Manual/threshold/overflow structural state, preparation and result entry remain consistent |
| HC-011 | Retry | Captured policy/options and attempt progression survive restore; effective retry options change as specified |
| HC-012 | Suspension | Deferred suspension and process-loss recovery report the exact current operation; unavailable identities fail in band |
| HC-013 | Restore | Bounded current-value/list reads plus exact referenced content reconstruct open state without history folding |
| HC-014 | Corruption | Invalid current value/list/reference combinations are rejected, not repaired silently |
| HC-015 | Session/Branch/lane isolation | No implicit main lane; Branch data and AgentLane operations/configuration stay within explicit names |
| HC-016 | Close | Close writes nothing, rejects new work, drains admitted commits and leaves open work resumable |
| HC-017 | Deterministic drive | Gated storage/effects produce the same durable result as uninterrupted direct drive; one released boundary advances at a time |
| HC-018 | Hooks/events | Typed hook ordering, durable settlement barriers and snapshot-buffer event ordering match the selected harness |
| HC-019 | Usage | Every settled attempt has one `UsageRow`; totals equal ledger sum and do not duplicate |
| HC-020 | Deferred provider | One poll per resume, exact handle lineage, cancel and restart retain the specified outcome |
| HC-021 | Effect admission | Every selected `Gate.admit()` site proves abort-first starts nothing and admission-first receives the operation signal |
| HC-022 | Effect-start crash | Crash after admission but before settlement is treated as unknown and follows provider/tool/structural replay policy |
| HC-023 | Drive/host ownership | One lane-owned Drive serves observers; process replacement reattaches without duplicate writable authority |
| HC-024 | Storage migration | A selected storage version migrates an open operation totally and resumes after a crash at every boundary |
| HC-025 | Backend/fork parity | Memory, JSONL and selected SQLite plus host ownership and streaming-fork boundaries produce specified outcomes |

## Piclaw boundary cases

These wrap the same harness factory with the Piclaw service reference model and fake ports.

| ID | Case | Required assertion |
|---|---|---|
| PC-001 | Ordinary accepted message | Durable source/operation precede harness prompt |
| PC-002 | Exact steer | Durable target operation and source sequence precede `steer()` |
| PC-003 | Stale steer | No harness queue call; explicit owner-mismatch disposition |
| PC-004 | Exact cancellation | Piclaw cancellation commits before harness abort |
| PC-005 | Stale cancellation | Replacement run remains untouched |
| PC-006 | Late completion after cancellation | One cancelled disposition; late output is observation only |
| PC-007 | Terminal commit fault matrix | No frontier advance before durable terminal row; eventual one disposition |
| PC-008 | Restart with open run | Piclaw service log, current operation state and immutable operation result reconcile without duplicate prompt/tool/delivery |
| PC-009 | Pending steer restart | FIFO owner and delivery state survive |
| PC-010 | Protected hand-off | One accepted successor, no tool-free false success |
| PC-011 | Mutation containment | `never` tool uncertainty disables tools until settlement/operator disposition |
| PC-012 | Scheduler agent task | One timeline delivery, one run log and optional one notification |
| PC-013 | Scheduler shell task | Existing shell and Pushover semantics stay unchanged |
| PC-014 | Stale SSE generation | No mutation of current projection |
| PC-015 | Mobile Abort | Fresh status gives exact operation/run and one cancellation |
| PC-016 | Protected evidence | Public traces contain no raw args/results/internal scheduling payload |
| PC-017 | Maintenance failure | Terminal disposition remains committed and delivery is not repeated |
| PC-018 | Trusted internal input | Same acceptance sequence and durability as external input |
| PC-019 | Cross-session steer | Acknowledgement follows durable exact-owner acceptance |
| PC-020 | Goal/checkpoint race | Late accepted steer is consumed, carried or disposed exactly once |

## Golden replay fixtures

Each regression corpus scenario gets a stable fixture ID equal to its `Contract scenario` name. The initial required set contains the 26 scenarios in [`regression-corpus.md`](regression-corpus.md).

Fixture review rules:

- human-readable YAML or JSON with schema version;
- no credentials, raw protected tool data or private timeline content;
- deterministic symbolic IDs;
- explicit input order and fault point;
- expected Piclaw service log and Earendil transactions/current state;
- expected delivery cardinality;
- expected terminal disposition and frontier;
- source link to issue/test/evidence.

## Assumption ledger

| ID | Fixture assumption | Evidence | Confidence | Failure response |
|---|---|---|---|---|
| EA-001 | `AgentHarness` public method names and result tags may change | Direct-adoption policy | Expected churn | Update Piclaw and contract cases to the selected version; retain semantic product assertions |
| EA-002 | Harness v3 entries, typed values/lists, immutable results and usage are the target durable protocol | `dev` types/session/storage at `d14d6b22` | High as design; source unselected | Update fixture to selected source types/storage; no v2 reducer dependency |
| EA-003 | Public operation ID is the durable Harness operation ID | `dev` admission/drive/result types | High as source evidence | Correlate directly after HC-012/013 on selected source |
| EA-004 | Steer/follow-up/nextRun are lane-owned tagged input | `dev` lane inbox and public queue methods | Implemented in source; unselected | Validate admission/placement across process replacement |
| EA-005 | Deterministic gated drive replaces manual actions | `dev` removed manual APIs and exports public drive plus gated storage | Implemented in source; unselected | Prove HC-017 against selected public drive |
| EA-006 | Typed snapshot-first lane watching removes event registration gaps | `dev` event bus, lane reducer/resnapshot and tests | Implemented for lane watch; session watch stubbed | Piclaw assigns web receipt sequence and validates selected runtime |
| EA-007 | Abort commits cancellation before pulling the operation signal | `dev` exact-ID abort/control/gate runtime | Implemented in source; unselected | Piclaw cancellation fence remains outside Harness; prove HC-009/021/022 |
| EA-008 | Real Harness supports deterministic `Models` and contextual tools with stable invocation identity | `dev` generic tools and public provider/deferred/tool drive | Implemented in source; unselected | Contract suite supplies direct selected-source implementations |
| EA-009 | Harness backend/fork conformance remains public | `dev` Memory/JSONL/SQLite conformance; WP07 complete, WP08 active | Implemented but moving | Run unchanged suites plus HC-024/025 on selected source/runtime |
| EA-010 | Hook/event payloads and invocation Context follow typed maps/unions | `dev` typed registries and public drive | Implemented in source; unselected | Adopt direct types and update Piclaw on change |

## Acceptance of the fixture design

Implementation may start only when:

- the fixture compiles against the selected Earendil declarations;
- no fixture module imports Piclaw agent-pool/recovery/compaction/process-chat orchestration;
- the selected Harness v3 backend conformance suite passes unchanged;
- every contract case names required capabilities and unsupported real-harness gaps;
- at least one complete golden replay demonstrates crash/restart at every Piclaw settlement boundary and every relevant Harness v3 intent/admission/settlement boundary;
- within one coherent selected Harness v3 source/package family, replacing the fixture `AgentHarnessConstructor` with the real exported constructor changes only the constructor supplied to semantic cases; on version upgrades, fixture code and Earendil-specific assertions may change while Piclaw service invariants remain explicit;
- version-migration reports record contract changes and Piclaw updates for each selected Earendil upgrade; source compatibility with earlier versions is not required.
