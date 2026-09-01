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
12. Piclaw service replay plus Harness v3 deterministic gated-drive/instrumented-storage design;
13. operation `Gate.admit()`, one lane-owned Drive and effect-start uncertainty semantics;
14. bounded recovery queries, transaction/conformance, selected migration, host ownership and fork semantics;
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
| Which Earendil source/version should Harness production target? | The current Piclaw loop selects `0.84.4`, whose Harness scaffold is byte-identical to `0.84.2`. `dev`/draft PR #8963 at `d14d6b22327d545d6a253f932165b63e48d7f9c8` has complete public lane drive and green exact-head CI; only session watch is stubbed, while WP08 storage/fork work remains active. | Keep production Harness disabled; allow a separately approved latent positive compatibility run against exact `dev`, then select production only after storage/fork stability and HC/PC gates. |
| How much Earendil type stability is required? | None across selected upgrades. Piclaw accepts source breakage and removes obsolete glue. | Compile and run HC-001–HC-025 for every selected version; record migration differences. |
| Does Earendil expose recoverable run state? | Current `dev` exposes total flat operation state, bounded restore, lane watches, deferred suspension, immutable `OperationResultRecord` and public drive; provider/tool/structural reconciliation is implemented. PR #7784's v2 `findRecords()` proposal is not a v3 dependency. | HC-004/005/012/013/022 against the selected real harness/backend. |
| Who owns tool process groups? | Harness v3 owns effect signals/tool invocation; Piclaw's `ExecutionEnv` implementation may retain host process tracking. | TP process-group and real-harness abort/close tests before M6. |
| Who owns transcript persistence? | Harness v3 owns entries, typed values/lists, immutable operation results and usage ledger; Piclaw owns accepted sources, timeline and service dispositions. | Selected backend/fork conformance and two-domain reconciliation tests. |
| Can real harness use deterministic fake models/tools? | Current `dev` supports generic contextual tools, direct `Models`, stable invocation identity, memos/checkpoints, gated storage and public drive. | HC suite against the exact selected constructor using direct Context-last APIs. |
| Which Piclaw writes share one transaction? | EF-S01 atomically accepts/claims service work. EF-S02 separately performs one terminal transaction across disposition, terminal timeline/media binding, source disposal, frontier, owner release and outbox. Both use `messages.db`; Earendil sessions stay separate. | Future logical-schema review and EF-S01/EF-S02 contract fault suites. |
| Which modules qualify as effectors? | Classified in `evidence/effector-inventory.md`; nine implementable interfaces and their current-internal adapter sources are specified in `evidence/future-effector-specifications.md`; orchestration modules are rejected. | G-SHAPE, G-OWNER, G-CURRENT and per-interface contract review. |
| Which baseline behaviours are removed? | Cursor authority, deferred JSON queue, chat-scoped abort/provenance, Piclaw recovery/compaction loop and direct scheduler agent delivery are migration targets. User-visible capabilities remain unless separately approved. | M0 ADR decision and per-capability implementation issues. |
| What closes the effect-start crash window? | Nothing process-local can close it. `Gate.admit()` orders durable abort versus admission; durable intent and settlement bound an unknown-outcome interval. | HC-021/022 plus provider/tool/structural recovery tests before M4. |
| How is writable Session ownership fenced? | Current `dev` assigns one writable Session to a host-managed worker. SQLite no longer implements a second writer lease. Same-repository forks use commit-queue ordering; live external sources use read-only WAL snapshots. | HC-015/023/024/025 plus host replacement, deletion and fork tests before M4. |
| What shadow/soak and resource budgets apply? | Metrics and gates are defined; numeric budgets need measured real-harness evidence. | Set numbers after M4 canary measurements and before M6/M7 approval. |
