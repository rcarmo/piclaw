# Acceptance plan and open questions

Full capability/regression/assumption coverage is recorded in [`evidence/traceability-matrix.md`](evidence/traceability-matrix.md): 59 capabilities, 26 regressions and 10 Earendil assumptions all map to owners, mechanisms and planned tests.

## ADR acceptance criteria

This ADR is complete only when it contains:

1. pinned Piclaw/released-Earendil baselines plus the exact unreleased Harness v3 target specification and implementation evidence;
2. current architecture and responsibility map;
3. completed capability traceability matrix;
4. completed bug and regression corpus;
5. approved invariants;
6. Piclaw service state/event/command model aligned with Harness v3 execution/storage semantics;
7. Piclaw–Earendil ownership boundary;
8. reviewed effector inventory;
9. complete future-effector specifications with interfaces, current-internal adapter maps, independent fake oracles, fault cases, relative effort, dependency order and documentation work packages;
10. released Earendil API/source survey and Harness v3 design/type/runtime/backend status survey;
11. fixture design and assumption ledger, if needed;
12. Piclaw service replay plus Harness v3 manual-drive/instrumented-storage design;
13. `EffectGate`, process-local task, effect-start uncertainty and external-finalisation semantics;
14. bounded recovery queries, transaction/conformance, migration and precise-rewrite semantics;
15. failure, cancellation and restart semantics;
16. alternatives with evidence;
17. incremental migration sequence;
18. compatibility and rollback strategy;
19. contract and acceptance-test plan;
20. unresolved questions and Earendil dependencies;
21. traceability from every preserved capability and known bug to a target mechanism and test.

## Definition of done for the assessment

The assessment passes when:

- every agentic public entry point is accounted for;
- every durable lifecycle mutation has one target owner;
- every known bug maps to an invariant and regression scenario;
- every target responsibility has one owner;
- every Piclaw-owned future effector has a complete illustrative interface, bounded errors, idempotency rule, current-internal adapter source, independent fake and fault cases;
- every Earendil-owned boundary names direct selected-version contracts and prohibits duplicate Piclaw wrappers;
- the proposed machine runs without importing Piclaw orchestration;
- golden scenarios replay deterministically;
- effect-gate race tests prove both admission orders without claiming that a process-local gate closes the crash window;
- recovery uses selected public bounded reads and does not depend on private or v2-specific recovery queries;
- every selected backend passes upstream conformance plus open-operation migration and concurrent rewrite tests;
- the semantic suite runs against both the selected-version test implementation and real Earendil harness; source compatibility across Earendil upgrades is not required;
- every unsupported claim is marked as an assumption or unresolved question;
- implementation can be divided into reviewed, reversible increments;
- Rui approves the architecture before production implementation starts.

## Assessment work plan

### Phase 1: Pin evidence

- verify baseline package and installer pins;
- record repository, archive and bundle identities;
- identify available Earendil harness source or proposals;
- define evidence IDs and commands.

### Phase 2: Capture current behaviour

- enumerate all ingress paths and lifecycle owners;
- complete the capability matrix;
- map durable and volatile state;
- trace effect and terminal boundaries;
- rerun representative baseline tests without changing code.

### Phase 3: Build the regression corpus

- inspect issues, PRs, regression tests and archive history;
- reduce incidents to ordered scenarios;
- map each incident to an invariant;
- identify gaps requiring future contract fixtures.

### Phase 4: Survey Earendil

- inventory public and proposed harness structure;
- map Piclaw capabilities to Earendil concepts;
- record gaps and assumptions;
- decide whether a selected-version test implementation is required.

### Phase 5: Design and compare

- define state, events, commands and effector ports;
- assign ownership;
- specify replay, fault and restart semantics;
- compare alternatives;
- propose the migration and rollback sequence.

### Phase 6: Review the ADR

- check full capability and bug traceability;
- run an independent design review against the quality bar;
- resolve or label every open assumption;
- request Rui's architecture decision.

## Open questions

The assessment resolves ownership and design questions that can be answered from the current baseline. Remaining questions are implementation gates tied to selecting an Earendil source/version and deployment policy.

| Question | Current assessment position | Resolution gate |
|---|---|---|
| Which Earendil source/version should Harness production target? | `0.84.1` is historical baseline evidence. The current Piclaw loop selects `0.84.4`, whose Harness scaffold remains unsupported. The `main` Harness v3 specification is authoritative; draft PR #8076 at `fd389abc4677b4e0fa5dc9b2bbd2e63418f079b4` contains substantial storage/primitives but no concrete public harness runtime. | Keep the current loop on `0.84.4`; select a Harness-v3 implementation only after required runtime/backend slices and all migration gates pass. |
| How much Earendil type stability is required? | None across selected upgrades. Piclaw accepts source breakage and removes obsolete glue. | Compile and run HC-001–HC-025 for every selected version; record migration differences. |
| Does Earendil expose recoverable run state? | Harness v3 specifies total `op.state`, bounded point-read restore, accepted suspension outcomes and `lane.lastResult`; draft implementation remains incomplete. PR #7784's v2 `findRecords()` proposal is not a v3 dependency. | HC-012/HC-013 plus storage fault tests on the selected real harness/backend. |
| Who owns tool process groups? | Harness v3 owns effect signals/tool invocation; Piclaw's `ExecutionEnv` implementation may retain host process tracking. | TP process-group and real-harness abort/close tests before M6. |
| Who owns transcript persistence? | Harness v3 owns entries/registers/usage ledger; Piclaw owns accepted sources, timeline and service dispositions. | Selected backend conformance and two-domain reconciliation tests. |
| Can real harness use deterministic fake models/tools? | Harness v3 types directly support generic contextual tools, `Models`, manual drive and instrumented storage. Draft PR #8076 implements lower-level assistant/tool helpers, but not the complete public runtime. | HC suite against the selected real Harness v3 implementation. |
| Which Piclaw writes share one transaction? | EF-S01 atomically accepts/claims service work. EF-S02 separately performs one terminal transaction across disposition, terminal timeline/media binding, source disposal, frontier, owner release and outbox. Both use `messages.db`; Earendil sessions stay separate. | Future logical-schema review and EF-S01/EF-S02 contract fault suites. |
| Which modules qualify as effectors? | Classified in `evidence/effector-inventory.md`; nine implementable interfaces and their current-internal adapter sources are specified in `evidence/future-effector-specifications.md`; orchestration modules are rejected. | G-SHAPE, G-OWNER, G-CURRENT and per-interface contract review. |
| Which baseline behaviours are removed? | Cursor authority, deferred JSON queue, chat-scoped abort/provenance, Piclaw recovery/compaction loop and direct scheduler agent delivery are migration targets. User-visible capabilities remain unless separately approved. | M0 ADR decision and per-capability implementation issues. |
| What closes the effect-start crash window? | Nothing process-local can close it. `EffectGate` orders abort versus admission; durable intent and settlement bound an unknown-outcome interval. | HC effect-start crash matrix and tool replay/reconciliation tests before M4. |
| How are concurrent session rewrites fenced? | Ordinary lane mutation uses the lane line and backend writer lease; precise rewrite is an administrative snapshot/swap. PR #7751 remains current-loop race evidence. | Selected-backend writer/reader/rewrite/process-death tests before M4. |
| What shadow/soak and resource budgets apply? | Metrics and gates are defined; numeric budgets need measured real-harness evidence. | Set numbers after M4 canary measurements and before M6/M7 approval. |
