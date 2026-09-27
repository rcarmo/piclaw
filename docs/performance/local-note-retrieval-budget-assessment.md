# Retrieval budget assessment (#1346)

The current search implementation passes 15 of the 17 proposed fixture budgets.
It fails the unanswerable-query target and cannot evaluate revision-bound citation
correctness. Freshness detection and equal-score ordering now pass after #1371.

This assessment reconciles the merged #1367 benchmark with subsequent fixes.
Historical baseline reports remain unchanged. The corpus, relevance labels,
query inputs, scoring and numerical thresholds are unchanged.

The file-based scores below do not establish that an answer's evidence appears
in the text delivered to an agent. The [agent-visible passage experiment](local-note-passage-experiment.md)
compares exact labelled-span coverage of current snippets and bounded BM25
passages. It keeps these historical budgets unchanged and unapproved.

## Assessment semantics

`runtime/scripts/note-retrieval-budget.ts` evaluates the existing version-1 budget
file. The normal isolated baseline runner now emits `budgetSha256` and
`budgetAssessment` alongside its existing measurements. No production search,
index, database schema, provider or UI code changes.

Each check returns one of:

- `pass`: all required observations satisfy the threshold, inclusively.
- `fail`: at least one valid observation exceeds a maximum or misses a minimum.
- `unsupported`: the report explicitly identifies citation support as absent;
  this is never converted to a passing citation score.
- `insufficient_evidence`: a required value/run is missing, null where a number is
  needed, non-finite, malformed or duplicated. A small-only run cannot certify
  the full set of budgets.

A complete run requires eight distinct slots: two independent builds and their
fresh-process reopens, at both 12 and 512 files. The assessor uses the worst
observed split/run value, not an average that could conceal a failure. Response
checks require 24 unique query rows per run. Rebuild tie checks require both sizes.
This validates the repository-generated report structure; it is not cryptographic
attestation of externally supplied measurements.

Successful benchmark execution means measurement completed, not that all budgets
passed. `allBudgetsSatisfied` remains false when any target fails, is unsupported
or lacks evidence. Timing/resource targets are report comparisons on comparable
hardware, not brittle CI wall-clock assertions. `budgetStatus` retains the exact
approval state in `budgets.json`; neither running nor passing the assessment
constitutes acceptance.

## Fresh evidence

The companion [report](local-note-retrieval-budget-assessment-results.json) records
measured commit/worktree state, corpus commit, exact budget digest, all eight runs
and individual comparisons. Tests reject missing slots, duplicate slots, partial
query lists, absent citation data, non-finite values and missing tie evidence.
Boundary tests cover exact-threshold passing and one-over/under failure.

Observed on local Linux/Bun with the unchanged synthetic corpus:

- Recall@5, MRR@5 and precision retain the merged baseline's values; all three
  proposed per-split minima pass.
- Unanswerable false-positive rate remains **0.50**, above the **0.25** target.
- Citation correctness remains **unsupported**; current file hits have no
  revision-bound chunk/line citations.
- All four build probes detect same-size/same-mtime edits.
- Both independent size-case rebuilds retain identical-score order.
- Response size, estimated tokens, warm/reopen timings, refresh timings,
  index-owned pages and sampled RSS pass the existing fixture-specific limits.

The first clean-source replay was made at `2e2fd03a1`; the final assessment-enabled
replay records that same base with evaluator-only worktree modifications. Neither
run changes production search. Fresh-process latency does not flush the OS cache;
RSS is sampled near worker end and is not peak usage. The 512-file case is not a
maximum-contract-size stress test. The historical 50% false-positive rate is based
on two unanswerable cases per split, so it is not a population estimate.

## What still needs acceptance

#1346 already has the merged synthetic corpus, independent labels, repeatable
runner and published measurements. The remaining approval record is the proposed
budgets: retain or explicitly revise them with evidence before #390 ranking work.
All notes and dates in the corpus are fictional; no user notes, credentials or
provider requests participate.

Accepting these budgets does **not** require making current search pass the
future citation/abstention targets first. Those implementation gaps belong to
#376/#387/#390 and #1370. It also does not approve a new production rollout or
broader family retrieval capability. Keep #1346 open until that acceptance is
recorded; do not close it merely because this report's execution succeeded.

## Reproduce

```sh
bun run test:local -- bun runtime/scripts/note-retrieval-baseline.ts --repeat-build
bun run test:local --cwd runtime -- bun test \
  test/note-retrieval-budget.test.ts test/note-retrieval-baseline.test.ts
```

`--small` remains useful for smoke tests but deliberately produces
`insufficient_evidence` for the complete assessment. Reports include no hostnames,
absolute workspace paths, session identifiers or live note text.

Validation: **11 focused tests / 89 assertions**, four configured typechecks,
`make ci-fast` with **5,551 runtime passes / four skips / zero failures**, 25
feature tests and nine build tests. Pack, stale-dist, environment, test-entrypoint,
silent-catch and diff checks pass. The full eight-run assessment is separate from
these regression tests; its remaining fail/unsupported targets are expected
measurements, not hidden test failures.
