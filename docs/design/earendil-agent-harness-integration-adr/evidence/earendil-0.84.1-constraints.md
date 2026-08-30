# Earendil 0.84.1 constraints for direct adoption

This file records the historical constraints found in the then-installed `0.84.1` public contracts. It is not a request for Earendil changes. Piclaw now selects `0.84.4` for the existing loop, but that release retains the unsupported Harness boundary. Harness v3 resolves or supersedes several constraints at design/type level; see [`earendil-harness-v3-assessment.md`](earendil-harness-v3-assessment.md).

## Production blockers in this version

### C-001 — Execution harness is incomplete

`AgentHarness` prompt, queue, abort, compaction, navigation, resume, lane, watcher and manual-drive methods throw `HarnessNotImplemented`. Restore rejects sessions containing records.

Piclaw response: retain this version as historical baseline evidence only. Current `0.84.4` is selected for non-Harness production APIs but remains unsupported for Harness execution. Draft PR #8076 has superseded the earlier type-only branch and implements substantial v3 session/storage work, but still has no concrete public harness runtime. Select one coherent tagged Harness-v3 implementation before production Harness execution.

### C-002 — Coding-agent harness helper is private

`dist/server/create-harness` is absent from the package export map.

Piclaw response: use public lower-level agent-core composition for fixture evidence at this version. Never depend on the private helper or make its shape an adoption requirement.

### C-003 — Contextual tool types require closure binding

`AgentHarnessTool<TContext,...>` and `toolContext` exist, while `AgentHarnessOptions.tools` is `HarnessTool[]`. The installed coding-agent helper binds context into tool closures.

Piclaw response: follow that exact closure-binding pattern only in `0.84.1` fixture code. Harness v3 generic `AgentHarnessOptions<TContext>` and contextual tools supersede it.

### C-004 — `HarnessTool` erases the parameter schema

`HarnessTool = AgentTool` uses the default schema and exposes `execute` parameters as `unknown`. Binding a contextual `AgentHarnessTool<TContext, TSchema,...>` to `HarnessTool` requires one assertion back to `Static<TSchema>` after harness validation.

Piclaw response: use a small generic closure binder only for `0.84.1` fixture evidence; no `any`, copied schema or Piclaw tool interface. Harness v3 removes the target need.

### C-005 — Hook/event payloads are `unknown`

Piclaw response: narrow payloads locally only for `0.84.1` fixture projection. Harness v3 specifies typed event/hook unions and snapshot-first watches; adopt those directly.

### C-006 — Restore/resume semantics are declared but not executable

Piclaw response: Harness v3 specifies total-state restore/resume. Keep assumptions explicit until the runtime slices pass HC-009/HC-012/HC-013.

### C-007 — Recovery reducer is not package-exported

The installed files implement `reduceLaneState()` and `validateRecordLog()`, but the package export map exposes only `.`, `./node`, `./session/testing` and `./package.json`; the root index does not re-export the reducer.

Piclaw response: do not deep-import it. Harness v3 removes reducer/history recovery in favour of current registers and bounded restore; select that public implementation.

### C-008 — Bun is outside the declared engine contract

Piclaw response: run public session conformance, execution environment and real harness suites under Bun. If the selected version cannot support Bun, use an explicitly approved runtime boundary or do not adopt it.

## Lower-confidence surfaces

- implementation fidelity to Harness v3 typed event/watch ordering;
- runtime enforcement that public `runId` is the durable operation ID;
- abort ordering around queue state and late tool/model results;
- hook durability/replay timing;
- manual-drive action/effect timing;
- process-local `EffectGate` coverage and abort/admission ordering;
- unknown outcomes after effect admission but before settlement;
- transaction/migration/precise-rewrite behaviour across selected backends.

Piclaw response: let the selected version's direct contract tests determine behaviour. Do not hide differences behind compatibility interfaces.

## Prohibited workarounds

- private deep imports;
- monkey-patching harness methods;
- Piclaw copies of Earendil result/error/session/tool/environment types;
- a permanent wrapper preserving `0.84.1` method signatures after Earendil changes;
- treating the fixture as a specification that overrides the real harness;
- assuming Bun compatibility without evidence.
