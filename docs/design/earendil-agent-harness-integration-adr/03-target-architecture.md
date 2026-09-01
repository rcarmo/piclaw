# Target architecture and replay model

The reviewed Piclaw effector classification is in [`evidence/effector-inventory.md`](evidence/effector-inventory.md). Implementable future interfaces, adapters over current Piclaw internals, fake contracts and fault cases are specified in [`evidence/future-effector-specifications.md`](evidence/future-effector-specifications.md). [`evidence/earendil-native-effector-contracts.md`](evidence/earendil-native-effector-contracts.md) requires direct use of Earendil's exported harness, session, model, tool, environment, result/error, resource and telemetry types; Piclaw-specific ports are limited to service-plane responsibilities. Harness v3's entries/typed-values-and-lists/operation-results/usage design and current public contracts are assessed in [`evidence/earendil-harness-v3-assessment.md`](evidence/earendil-harness-v3-assessment.md). The complete proposed Piclaw identity, accepted-source, settlement, cancellation, restart and replay design is in [`evidence/target-state-model.md`](evidence/target-state-model.md). Current Piclaw orchestration and Earendil v2 record-log details remain evidence only.

## Required target invariants

The assessment must test and refine these candidate invariants:

1. Every accepted source has one durable sequence and one lifecycle owner.
2. Prompt, compact, retry, steer, abort and terminal commands carry exact owner identity.
3. Events and command results from stale run, attempt, session or generation identities do not mutate current state.
4. A terminal operation has one immutable disposition.
5. Final output persistence, accepted-source consumption, frontier advancement and ownership release form one atomic settlement boundary or one idempotent transaction protocol.
6. The first accepted cancellation wins and remains scoped to its operation across late events and restart.
7. Tool-call state is monotonic and duplicate results are idempotent.
8. Recovery attempts, elapsed budget and tool use remain bounded.
9. A process-local operation gate orders abort against effect admission but never proves that an admitted external effect did or did not complete; unknown outcomes follow selected replay/reconciliation policy.
10. At most one lane-owned Drive advances an operation locally, and durable flat operation state remains authoritative after process loss.
11. Containment keeps tools disabled until accepted terminal settlement.
12. Restart reconciliation preserves truthful FIFO carry, disposal and successor claims.
13. Scheduler and `runAgent()` output have one delivery owner.
14. UI status and SSE events identify the exact operation and event generation.
15. A harness transcript or in-memory queue is not proof of durable Piclaw acceptance or terminal consumption.

## Target ownership boundary

The ADR must assign each responsibility to one owner. The table below is a hypothesis to validate against Earendil's real API.

| Responsibility | Candidate owner | Status |
|---|---|---|
| Channel authentication and routing | Piclaw | To verify |
| Durable input acceptance and source order | Piclaw | To verify |
| Operation identity and acceptance acknowledgement | Piclaw | To verify |
| Timeline and media persistence | Piclaw | To verify |
| Scheduler intent and delivery policy | Piclaw | To verify |
| Exact cancellation authority | Piclaw | To verify |
| Terminal durable disposition and frontier | Piclaw | To verify |
| Restart reconciliation of Piclaw-owned work | Piclaw | To verify |
| Transcript execution | Earendil harness | To verify |
| Provider/model execution | Earendil harness | To verify |
| Tool execution lifecycle | Earendil harness | To verify |
| Execution-time compaction | Earendil harness | To verify |
| Harness-native execution recovery | Earendil harness | To verify |
| Execution checkpoint/current operation state | Earendil harness | Harness v3 flat operation state; selected source/package still required |
| Process-local lane Drive and effect admission | Earendil harness | Candidate `dev` lane-owned Drive/`Gate.admit()`; never durable authority |
| Storage transactions, migrations and forks | Earendil Session/backend/repository plus host worker lifecycle | Piclaw selects and validates one conformant source/runtime boundary |
| Projection from Earendil events/snapshots to Piclaw status | Piclaw projection service | Direct Earendil inputs; web DTO output |

No final design may share ownership of accepted-input queues, operation completion, cancellation authority, scheduler delivery or terminal persistence.

## State-machine design quality bar

### Piclaw service transition model

Piclaw's service-plane coordinator should have the semantic shape:

```text
reduce(serviceState, serviceEvent) -> { serviceState, commands }
```

This reducer owns accepted sources, Piclaw operation correlation, terminal disposition, frontier and external delivery. It performs no I/O. Command executors call service effectors and direct Earendil methods, then turn results into service events.

Earendil execution is not replayed through this reducer. Harness v3 owns its durable interpreter through flat operation state and atomic storage commits. Time, IDs, external delivery results and storage faults must be injected into the Piclaw model; model/tool/provider execution uses the selected Earendil contracts. The same Piclaw snapshot and ordered service event stream must produce the same semantic service state and command trace.

### Versioned state, events and commands

The assessment must specify:

- the smallest useful state stages and orthogonal substates;
- versioned external events;
- versioned command and result types;
- operation, run, attempt, session and generation identity;
- monotonic event sequence rules;
- terminal and cancellation precedence;
- schema evolution and replay compatibility.

Adding one event, state or effector should require local additions and an exhaustive compiler or contract failure. It should not require unrelated edits across channel, recovery and persistence modules.

### Effect boundaries

Each command must define:

- owner identity;
- idempotency key;
- precondition or expected version;
- effect class;
- success result;
- retry-safe failure;
- ambiguous `effect-may-have-happened` failure;
- compensation or reconciliation rule;
- redaction policy.

For Harness v3 effects, tests distinguish durable intent, process-local admission and durable settlement. `Gate.admit()` is adjacent to invocation but is not a persisted effect-start record. A crash after admission remains an unknown outcome.

## Replay and fault-boundary standard

The design must support:

- a versioned initial-state snapshot;
- an ordered event record;
- deterministic state and command traces;
- state hashes for divergence detection;
- redaction of model text, tool arguments/results and secrets where full payloads are unnecessary;
- golden replay fixtures;
- fault injection before and after every durable command;
- restart at each durable boundary;
- semantic comparison of live and replayed terminal state.

Replay equality excludes timestamps and generated IDs after normalisation. It includes owner identity, accepted-source order, commands, dispositions, frontier state, cancellation and externally visible delivery counts.

### Minimum golden scenarios

- successful prompt without tools;
- prompt with one tool;
- parallel tool calls and duplicate completion;
- steer during model execution;
- multiple FIFO steers;
- compaction followed by continuation;
- abort before model completion;
- abort during a tool process;
- late model or tool result after cancellation;
- process restart with claimed work;
- context-pressure retry and retry exhaustion;
- mutation containment and accepted terminal release;
- scheduled agent delivery;
- terminal persistence failure before and after the effect;
- successor claim and restart reconciliation;
- stale generation event;
- mobile Compose Abort with exact authority;
- abort-first and admission-first at every `Gate.admit()` integration;
- process loss after effect admission but before settlement;
- live lane task versus restored orphaned `effect_pending` state;
- open-operation migration and backend conformance;
- host ownership transfer and streaming forks concurrent with readers/writers and restart.
