# Independent evaluation of strict and candidate note queries

**Decision: neither mode passes the predeclared diagnostic gate. Do not make candidate mode the default or deploy it as an answer-quality fix.** This evaluation ran unchanged registered `memory_query` and `memory_get` tools from stacked PR #1428 against a newly authored, separately frozen fictional corpus. It measured text delivered to the agent, not file rank or model answer accuracy.

## Freeze and method

- The corpus, labels and scoring rule were committed at `923698539` **before either tool was invoked**. `runtime/test/fixtures/note-retrieval/independent-v3/manifest.json` fixes SHA-256 hashes for 16 Markdown notes, one evaluation file (12 answerable and 10 no-answer queries) and `policy.json`. The worker verifies every hash and labelled source quote before indexing.
- The rule requires ≥80% of answerable questions to return every labelled quote contiguously in a source-verified snippet at the right path, ≤20% of no-answer questions to return any hit, zero conflicting-path hits, 100% reference round-trips and responses ≤16 KiB. This is a **predeclared diagnostic rule**, not an approved #1346 production budget.
- An isolated writer publishes a note generation in a disposable SQLite store. A fresh SQLite reader verifies that publication. The registered `memory_query` executes with `limit: 5` in default strict and explicit candidate mode; every returned `{chunk_id, source_revision}` is passed to `memory_get` and checked against the same path and snippet. No provider calls, live notes or Smith store are involved.
- The test repeats the run in fresh stores with forward, forward again and reverse file-creation order. It compares all returned rows after excluding wall-clock elapsed time. The result payload was identical in all three runs. It does **not** test a same-store process restart, network filesystem, or a 512-file scale case.

## Results

| Measure | Strict default | Explicit candidate | Predeclared diagnostic rule |
|---|---:|---:|---:|
| Answerable questions with all labelled text in returned snippets | **2/12 (16.7%)** | **11/12 (91.7%)** | ≥80% |
| No-answer questions with any returned hit | **4/10 (40%)** | **10/10 (100%)** | ≤20% |
| Conflicting-path hits | **0** | **5** | 0 |
| Exact query→get reference round-trips | All returned hits | All returned hits | 100% |
| Maximum encoded response | 1,552 bytes | 3,528 bytes | ≤16,384 bytes |
| Largest observed per-query time, tiny local corpus | 20 ms | 32 ms | Recorded only; no approved latency cap |
| Stable payload on forward/repeat/reverse builds | Yes | Yes | Yes |
| Diagnostic gate | **Fail** (coverage, no-answer hits) | **Fail** (no-answer and conflicts) | All rows required |

All 44 query calls per build reported `status: ok` with no incomplete reasons because the indexed synthetic snapshot was clean; `ok` means source/index validation, not answer validity. The candidate mode found 11/12 labelled answer spans but also returned unsupported evidence for **every** no-answer query. The one missed answer was a repeated-heading case whose labelled quote includes a parent `##` heading outside the indexed leaf chunk. The pure context assembler preserves that chunk boundary; it cannot add the parent heading without an explicit, separately reviewed citation/context change. Five candidate hits came from paths labelled as conflicting with the question. These are measured exposures, not proven incorrect model answers.

The 16-note corpus is synthetic and small. It does not estimate real-world answer accuracy, semantic abstention or a production p95. The earlier hard-v2 set was used to select the candidate mode and cannot serve as a fresh independent check. No thresholds, labels, code or queries were changed after this run. Reproduce with `bun run test:controlled -- runtime/test/note-retrieval/independent-evaluation.test.ts` from the evaluation branch; the test prints `INDEPENDENT_EVALUATION=` with per-query outcomes.

## Recommendation

- **No-go for merging/deploying #1428 as a quality improvement.** Keep the merged strict default unchanged. An opt-in mode with a warning still gives the agent unassessed false-positive evidence on every no-answer case in this set.
- Keep #1346 open for explicit budget acceptance or revision. A revised budget must state the tolerated no-answer hit and conflict rates rather than counting a citation round-trip as an answer.
- For #390, evaluate evidence selection and abstention separately from candidate recall, then freeze another untouched set before a new claimed improvement. The present run gives no basis for changing production thresholds or automatically rejecting answers.
