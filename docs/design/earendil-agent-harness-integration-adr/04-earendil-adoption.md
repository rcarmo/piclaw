# Direct Earendil adoption and selected-version fixture

## Early Earendil adoption

### API and package survey

The historical `0.84.1` package survey is recorded in [`evidence/earendil-0.84.1-harness-surface.md`](evidence/earendil-0.84.1-harness-surface.md). It found implemented v2 session contracts and a private recovery reducer, but no usable released execution harness. Piclaw's current loop now selects `0.84.4`; that release retains the same unsupported Harness boundary.

Published `0.84.4` retains the audited released-v2 scaffold. Active design and implementation now live on `dev` and draft PR #8963 at `d14d6b22327d545d6a253f932165b63e48d7f9c8`, assessed in [`evidence/earendil-harness-v3-assessment.md`](evidence/earendil-harness-v3-assessment.md). Harness v3 replaces the v2 record reducer with immutable entries, typed mutable values/lists, immutable operation results and an append-only usage ledger. The candidate implements complete public lane drive, while session watch, source selection and storage/fork stability remain gates.

The fixture and future production code use the selected Earendil version's exact exported types and semantics described in [`evidence/earendil-native-effector-contracts.md`](evidence/earendil-native-effector-contracts.md), not Piclaw equivalents. Piclaw accepts source breakage when selecting a newer Earendil version.

Before choosing Piclaw service interfaces, the assessment must inventory the pinned Earendil packages and each candidate harness source/version:

- public package exports;
- `AgentHarness`, session and run lifecycle types;
- event and callback model;
- transcript ownership;
- model/provider interfaces;
- tool registration and lifecycle;
- compaction hooks and retained state;
- cancellation semantics;
- checkpoint or recovery facilities;
- one lane-owned Drive and `Gate.admit()` semantics;
- the effect-start uncertainty boundary;
- storage transactions, conformance, selected migrations, host ownership and streaming forks;
- extension points;
- filesystem and persistence ports;
- disposal and process ownership.

The survey must record exact package versions and source commits. [`docs/earendil-0.84-upgrade-assessment.md`](../../earendil-0.84-upgrade-assessment.md) provides historical evidence but states that Piclaw did not then implement `AgentHarness`, `SessionRepo`, `SessionStorage` or `FileSystem`.

### Selected-version test fixture

The required fixture, deterministic driver/fault model, assumption ledger and parameterised contract cases are specified in [`evidence/earendil-version-fixture-contract.md`](evidence/earendil-version-fixture-contract.md).

The released Harness cannot execute runs. Current `dev` can, but remains unselected. Deterministic test implementations remain useful for Piclaw-owned service boundaries and fault scheduling; a latent positive compatibility suite may also run the exact `dev` constructor. Fixtures remain small and disposable and change with the selected Earendil source.

It should implement only the selected public contract surface needed by the semantic cases:

- `prompt()` and the external Piclaw `operation_id` ↔ Earendil `operationId` correlation;
- initial input and steer delivery;
- typed transcript events and hooks;
- model and tool lifecycle;
- compaction, navigation and deterministic gated-drive boundaries;
- explicit invocation `Context` and abort-signal propagation;
- usage and diagnostics;
- terminal results;
- total current state and bounded restore through the selected snapshot/session contracts.

Every selected-version assumption needs an evidence record. The current assumption ledger is in [`evidence/earendil-version-fixture-contract.md`](evidence/earendil-version-fixture-contract.md) and its coverage status is summarised in [`evidence/traceability-matrix.md`](evidence/traceability-matrix.md). It contains ten versioned assumptions with confidence and failure responses.

The fixture must import no current Piclaw orchestration code. Its Harness v3 target uses selected direct `Models`, generic `AgentHarnessTool<TContext>`, `ExecutionEnv`, `Storage`, `SessionRepo`, event/hook and result/error contracts with deterministic test implementations. The released-v2 fixture surface remains historical evidence only.

### Shared contract suite

One parameterised contract suite must run against both:

1. the test implementation of the selected Earendil contracts; and
2. the real public constructor exported by that selected Earendil version.

Tests assert observable product invariants through the selected Earendil version's own public types and methods, not fixture internals. A real-harness mismatch produces a version-migration report and corresponding Piclaw/test updates; it is not hidden behind a Piclaw compatibility interface.

The contract suite must cover:

- event order and owner correlation;
- exact steer and cancellation delivery;
- late-result rejection;
- model and tool lifecycle;
- compaction and recovery;
- terminal result cardinality;
- resource disposal;
- deterministic fake provider/tool execution;
- stable tool invocation identity, memos/checkpoints and replay trace parity;
- one lane-owned Drive versus restored-operation ownership;
- `Gate.admit()` abort/admission ordering and crash-after-admission uncertainty;
- explicit invocation `Context` identity, cancellation and telemetry propagation;
- Session/Branch/AgentLane ownership with no implicit main lane;
- bounded point-read recovery without a private or v2-specific recovery query;
- selected storage migration, host ownership and backend/fork conformance.
