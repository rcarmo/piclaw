# Direct Earendil adoption and selected-version fixture

## Early Earendil adoption

### API and package survey

The historical `0.84.1` package survey is recorded in [`evidence/earendil-0.84.1-harness-surface.md`](evidence/earendil-0.84.1-harness-surface.md). It found implemented v2 session contracts and a private recovery reducer, but no usable released execution harness. Piclaw's current loop now selects `0.84.4`; that release retains the same unsupported Harness boundary.

Earendil has since consolidated the audited Harness v3 target into [`packages/agent/docs/harness.md`](https://github.com/earendil-works/pi/blob/5f7195c51eac43cdf329f813a7ef020d7bd74527/packages/agent/docs/harness.md). The authoritative `main` specification and the materially changed draft specification/implementation in PR #8076 are assessed separately in [`evidence/earendil-harness-v3-assessment.md`](evidence/earendil-harness-v3-assessment.md). Harness v3 replaces the v2 record-log/reducer model with immutable entries, mutable total-state registers and an append-only usage ledger. PR #8076 implements substantial session/storage and low-level execution work, but still exposes no concrete public v3 harness runtime. A selected-version test implementation remains required until one coherent tagged runtime/backend is available.

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
- process-local lane-task and `EffectGate` semantics;
- the effect-start uncertainty boundary;
- storage transactions, conformance, migrations and precise rewrites;
- extension points;
- filesystem and persistence ports;
- disposal and process ownership.

The survey must record exact package versions and source commits. [`docs/earendil-0.84-upgrade-assessment.md`](../../earendil-0.84-upgrade-assessment.md) provides historical evidence but states that Piclaw did not then implement `AgentHarness`, `SessionRepo`, `SessionStorage` or `FileSystem`.

### Selected-version test fixture

The required fixture, deterministic driver/fault model, assumption ledger and parameterised contract cases are specified in [`evidence/earendil-version-fixture-contract.md`](evidence/earendil-version-fixture-contract.md).

The released harness cannot execute runs, and PR #8076 is not yet runtime-complete, so the assessment specifies a test implementation of the selected contracts. For `0.84.1`, this follows the released surface only as baseline evidence. The target fixture should move to one coherent tagged Harness v3 public surface. It remains small and disposable; it changes with the selected Earendil version.

It should implement only the selected public contract surface needed by the semantic cases:

- `prompt()` and the external Piclaw `operation_id` ↔ Earendil `runId` correlation;
- initial input and steer delivery;
- typed transcript events and hooks;
- model and tool lifecycle;
- compaction, navigation and manual barriers;
- abort-signal propagation;
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
- replay trace parity;
- process-local task versus restored-operation ownership;
- `EffectGate` abort/admission ordering and crash-after-admission uncertainty;
- bounded point-read recovery without a private or v2-specific recovery query;
- storage migration/backend conformance and concurrent precise-rewrite safety.
