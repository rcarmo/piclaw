# ADR: Earendil-aligned agent harness integration

Status: **Proposed — assessment complete; architecture awaiting Rui's decision**

This ADR proposes how Piclaw replaces its agentic loop with a service-plane coordinator around a selected Earendil agent harness version. The assessment changed documentation only.

## Decision record

| Field | Value |
|---|---|
| Decision owner | Rui Carmo |
| Assessment baseline | Piclaw `v2.13.2` |
| Baseline commit | `0afd3ae645c423bed82deef80c343bcaa6f31d4d` |
| Earendil runtime selection | Current-loop packages use exact `0.84.4`; `0.84.1` remains the historical Harness baseline |
| Earendil released evidence | `main` at `b8b873b9872db04a938fb4357b5e8e824ddc051c`; latest release `v0.84.4` at `b79e4cc834970cca69daebffab7df1da7d1e52c4` retains the unsupported released-v2 Harness scaffold |
| Earendil implementation watch | `dev` / draft PR `earendil-works/pi#8963` at `d14d6b22327d545d6a253f932165b63e48d7f9c8`; public lane drive complete, only session watch deferred |
| Earendil candidate design | `dev` `packages/agent/docs/harness.md` blob `c7c18c74730d4971f8ca004924e44c7fbe236f25`, SHA-256 `1b200eb7b4255d5afd71e17bb4cf54f82e2c5d1d1e24ae87ba97363838251785` |
| Evidence timestamp | 2026-09-01 18:30 UTC; moving upstream state is valid only at the pinned revisions |
| Document state | Assessment refreshed through public drive, SQLite host ownership and current fork work; decision requested |
| Production changes | Current-loop dependencies select `0.84.4`; no Harness activation, execution-path or service change |
| Final decision | Proposed: select direct Earendil adoption with a selected-version test implementation first |

## Problem

Piclaw has an agentic loop spread across channel handlers, queues, the agent pool, SDK callbacks, compaction and recovery helpers, scheduler delivery, SQLite state and web status handling. Earendil's agent harness is the intended execution plane once Piclaw selects a version with an implemented public surface.

The integration needs a state-machine runner that:

- imports none of Piclaw's existing orchestration or state-machine implementation;
- reuses Piclaw code only through reviewed effector ports;
- records deterministic inputs, transitions, commands and results for replay;
- supports new states, events, effects and recovery behaviour without cross-cutting edits;
- adopts Earendil's public structure, terminology and lifecycle contracts as early as the available APIs permit.

The assessment must preserve existing behaviour deliberately and carry known defects into the design as regression requirements. It must not treat the existing loop as the target architecture.

## Scope

The assessment covers the complete lifecycle of agent work:

1. input acceptance and ordering;
2. operation and session ownership;
3. prompt, model and tool execution;
4. compaction and recovery;
5. cancellation and late results;
6. terminal persistence and queue advancement;
7. restart reconciliation;
8. scheduled agent work;
9. SSE and web status projection;
10. extension and add-on integration points.

The assessment produced this ADR, its evidence tables and a proposed semantic contract suite. Published `0.84.4` still exposes the incomplete released-v2 Harness scaffold. Earendil `dev` now has a concrete v3 constructor and complete public lane drive; source selection, session-wide watch scope, storage/fork stability and Piclaw acceptance remain. This ADR does not activate the production runner, change persistence or deploy a service.

## Chapters and evidence

- [Assessment method and quality bar](01-assessment-method.md)
- [Bug and regression corpus](02-regression-corpus.md)
- [Target architecture and replay model](03-target-architecture.md)
- [Direct Earendil adoption and selected-version fixture](04-earendil-adoption.md)
- [Alternatives and migration](05-alternatives-and-migration.md)
- [Acceptance plan and open questions](06-acceptance-plan.md)
- [Evidence register](evidence/README.md)
  - [Piclaw v2.13.2 capability matrix](evidence/current-capability-matrix.md)
  - [Agent lifecycle regression corpus](evidence/regression-corpus.md)
  - [Piclaw effector inventory](evidence/effector-inventory.md)
  - [Future effector specifications](evidence/future-effector-specifications.md)
  - [Earendil-native effector contracts](evidence/earendil-native-effector-contracts.md)
  - [Tool, environment and resource migration](evidence/tool-resource-migration.md)
  - [Earendil 0.84.1 adoption constraints](evidence/earendil-0.84.1-constraints.md)
  - [Earendil Harness v3 assessment](evidence/earendil-harness-v3-assessment.md)
  - [Earendil version-selection policy](evidence/earendil-version-selection.md)
  - [Direct Earendil type audit](evidence/direct-type-audit.md)
  - [Target state, event and settlement model](evidence/target-state-model.md)
  - [Selected-version fixture and semantic contract suite](evidence/earendil-version-fixture-contract.md)
  - [Alternatives, migration and rollback](evidence/alternatives-and-migration.md)
  - [Capability and regression traceability](evidence/traceability-matrix.md)
  - [Assessment quality review](evidence/quality-review.md)
  - [Earendil 0.84.1 harness surface](evidence/earendil-0.84.1-harness-surface.md)

The index is the ADR decision record. Chapters hold the assessment and design analysis. The evidence directory holds registers, captures and replayable scenario descriptions. All files remain part of one ADR.

## Proposed decision

Select the direct-adoption architecture in [`evidence/alternatives-and-migration.md`](evidence/alternatives-and-migration.md), starting with a selected-version test implementation:

- Piclaw retains authenticated acceptance, canonical source order, operation identity, exact cancellation, timeline/media persistence, scheduler/delivery policy, terminal disposition, frontier and restart reconciliation.
- Earendil owns transcript execution, model/tool lifecycle, execution compaction and execution recovery. Harness v3's entries, typed values/lists, immutable operation results and usage ledger are the target execution model; `0.84.1` remains historical baseline evidence and `dev`/PR #8963 remains unselected development evidence.
- Piclaw imports no current agent orchestration into the replacement path. Piclaw service actions use reviewed service-plane ports; execution uses Earendil's exported lower-level harness/session/model/tool/environment contracts directly, never private coding-agent factories.
- One semantic suite runs against deterministic gated fixtures and a selected real constructor. It covers explicit Context propagation, one lane-owned Drive, `Gate.admit()` ordering, unknown effect outcomes, tool invocation identity, selected storage migration, host ownership and backend conformance. Piclaw updates its latent boundaries when Earendil types change; backward source compatibility is not a goal.
- Production remains on the current Piclaw loop with Earendil `0.84.4`. That runtime selection does not select Harness v3. A latent positive compatibility refresh may target exact `dev`; production migration waits for storage/fork stability, Piclaw HC/PC evidence and explicit activation approval.

Rui's approval is required before M1 or any production implementation. [`evidence/future-effector-specifications.md`](evidence/future-effector-specifications.md) is a documentation-only specification of contracts, fakes and later implementation slices; its TypeScript blocks are illustrative.
