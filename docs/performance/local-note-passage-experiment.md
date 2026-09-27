# Agent-visible BM25 passage experiment

Returning bounded passages and requiring two-thirds of the query units to match
their text improves delivered evidence on the frozen synthetic note corpus.
This is an offline experiment for #1346/#390. No runtime search, note-index
schema, query/get tool, access rule or live workspace data changes.

## What is measured

The existing file-recall metric answers whether a useful file was listed. This
experiment scores the text returned by `search_workspace` or the experimental
passage response. A filename with an irrelevant snippet gets no evidence credit.

- **Labelled-span recall:** fraction of independently labelled quotes fully
  contained, contiguously, in a returned passage with the correct path. Scores
  are macro-averaged over answerable queries. Each quote can be credited once.
- **Labelled-line coverage:** fraction of complete labelled lines delivered, to
  show partial evidence when the entire quote is absent.
- **Useful-hit fraction:** fraction of returned hits containing at least one
  full labelled line from the matching path. This measures result usefulness,
  not the fraction of all output tokens that matter.
- **No-answer false positives:** queries with no labelled answer that nevertheless
  receive one or more hits, reported as a count and rate on each split.
- **Payload bytes:** exact UTF-8 length of the serialized agent-visible response.
  The baseline uses the production extension's text content, not its hidden
  details object. The candidate uses a JSON response parsed back for scoring.
  UI summaries or later prompt transformations are outside this measurement.

Labels can include headings and context beyond a minimal answer. Exact-span
recall is therefore a conservative evidence-completeness measure, not measured
LLM answer accuracy or the probability that an answer is present. Zero full-span
recall does not mean none of the snippets can help answer a question. No follow-up
file reads are credited; they require a separate multi-call evaluation.

Only CRLF-to-LF normalization is applied to evidence. For the production tool,
SQLite's square-bracket highlight markers are removed only if the source has no
literal brackets. Ambiguous cases receive no evidence credit and are counted.
Full files are used to check marker ambiguity, never to fill in missing text.
Neither measured split contained an ambiguous case.

## Fixed candidate

1. Use the existing Markdown chunker to respect sections and source lines.
   Sections larger than 1,536 bytes become complete-line windows with a
   two-line overlap; no arbitrary mid-line clipping.
2. Build a fixture-only FTS5 index with `porter unicode61 remove_diacritics 2`.
   Rank text/heading/path with BM25 weights `1 / 2 / 0.5`.
3. Generate at most 50 candidates with OR matching. Ties use binary path and
   numeric line bounds. No date boost, model call, embeddings or random reranker.
4. Treat quoted phrases and hyphenated identifiers as units. Keep unknown words
   in the denominator; deduplicate Porter/diacritic-equivalent units with the
   same SQLite tokenizer. Count matching units in the **returned text**, not
   hidden headings or path-only matches.
5. Require at least `ceil(2N/3)` matching units. Compare against passage-OR and
   passage-all-terms ablations; no raw BM25 cutoff is interpreted as confidence.
6. Return at most five passages and 4,096 serialized bytes. Candidate or output
   truncation is explicit. An exhausted 50-candidate pool with no passing hit
   reports `candidate_limit`, not a definitive no-match.

The candidate handles plain lexical input and quoted phrases, not the full
production FTS operator grammar. It returns only experimental line ranges, not
validated revision-bound citations. There is no production API wiring.

## Development selection and held-out result

Candidate and evaluator were committed as `a0a7eed5e` before the first held-out
run. The [freeze manifest](../../runtime/test/fixtures/note-retrieval/passage-freeze.json)
binds the experiment/scorer/worker/runner, all production source, all frozen note
inputs and dependencies. Held-out execution checks those hashes. The existing
corpus, relevance labels and proposed `budgets.json` were not changed.

The two-thirds rule was selected on development: it retained full labelled-span
recall without the false positive seen with OR. All-terms matching lost a
development paraphrase. The rule was not changed after held-out evaluation.

Each split has **10 answerable and 2 unanswerable queries**. Results below are
identical at 12 notes and with 500 neutral filler files added, except the noted
OR historical-conflict count and small byte variations.

| Split / method | Labelled-span recall | Labelled-line coverage | Useful-hit fraction | No-answer false positives | Mean / max payload bytes |
| --- | ---: | ---: | ---: | ---: | ---: |
| Development: current tool | 0% | 30% | 45% | 1/2 | 275 / 626 |
| Development: passage OR | 100% | 100% | 51.5% | 1/2 | 748 / 2,204 |
| Development: passage two-thirds | 100% | 100% | 86.7% | 0/2 | 314 / 655 |
| Development: passage all terms | 90% | 90% | 86.7% | 0/2 | 247 / 655 |
| Held-out: current tool | 10% | 23.3% | 18.3% | 1/2 | 200 / 407 |
| Held-out: passage OR | 100% | 100% | 32.2% | 1/2 | 730 / 1,167 |
| Held-out: passage two-thirds | 100% | 100% | 81.7% | 0/2 | 314 / 716 |
| Held-out: passage all terms | 100% | 100% | 95% | 0/2 | 254 / 553 |

The selected candidate returns all labelled spans on all 20 answerable queries
and abstains on all four labelled unanswerable queries. These are **20+4 unique
cases**, not multiplied by repetitions or scale runs. Held-out all-terms results
do not justify switching the previously selected rule.

One conflicting historical passage still appears on the held-out split with
the selected rule, as it does with the current tool. Passage-OR returns one at
12 files and two at 512 files. High lexical coverage cannot resolve current
versus superseded policy. A separate vocabulary-only negative test deliberately
matches every query unit and still yields a false positive: this boundary is
recorded, not treated as a successful no-answer rule.

## Reproducibility and cost

Two independently built databases (opposite source insertion order), each read
from a fresh process, at both corpus sizes: eight runs per split. Every query is
repeated five times. Comparisons require byte-identical payloads, not merely the
same paths. All comparisons passed on Bun 1.4.2 / SQLite 3.53.2. This proves
same-stack reproducibility for these fixtures, not cross-version score identity.

The candidate SQLite file occupied 65,536 bytes at the small size and 188,416
bytes at the larger size. Sampled build times were 70–510 ms; the worst per-query
warm p95 sample was 1.47 ms. These are observations, not CI timing assertions or
production guarantees. Filesystem cache was not flushed; process RSS includes
both the baseline and candidate setup.

Important scale limit: a single source line larger than 1,536 bytes is omitted
by this prototype. The original neutral fillers contain such long lines, so
only their headings enter this passage index. The 512-file run checks corpus
dilution and deterministic ordering, **not** a realistic large-content budget.
Fenced-block/window exclusions, coverage status and bounded candidate work need
production design review; this experiment does not claim they are solved.

## Reproduce

From this branch with pinned dependencies installed:

```bash
bun run test:controlled -- runtime/test/note-passage-experiment.test.ts
bun run test:local -- bun runtime/scripts/note-passage-experiment.ts > development.json
bun run test:local -- bun runtime/scripts/note-passage-experiment.ts --held-out > held-out.json
```

Use `--small` for a smoke run, not scale evidence. The runners require the
repository filesystem-isolation launcher and create only owned test databases.
They make no provider or network requests. The full report includes exact
payloads and per-query scores; the [recorded compact evidence](local-note-passage-results.json)
keeps representative payloads, all run summaries and payload digests.

Validation at the frozen candidate: ten focused tests / 72 assertions, full
typecheck and scoped lint passed. The final `make ci-fast` passed 5,698 runtime
tests (seven skipped), 25 feature tests and nine build tests. Its initial static
failure required regenerating the environment-observation file for the new
fixture runner; no production environment readers were added. A bounded prose
review found no claim blockers; a broader final delegate review timed out and
provides no approval. Frozen code and recorded evidence hashes were verified
again after the held-out runs.

## What this supports next

Implement passage-returning query/get under #387's access and freshness contract,
then evaluate the fixed coverage/BM25 recipe against new untouched questions,
especially semantic distractors, short queries, synonyms and contradictory notes.
Unknown synonyms can reduce recall; broad one-term queries can still be noisy;
overlapping phrase units are not independent semantic concepts. Ranking the
first 50 OR candidates before coverage filtering can miss a qualifying result
outside that pool, so preserve the incomplete-search signal.

Keep file recall as a diagnostic upper bound, and evaluate delivered evidence
and context cost as the primary quality measures. The historical file-recall
budgets remain proposed; neither their acceptance nor readiness for deployment
follows from this result. The 12+12 published synthetic queries have been seen
in earlier work and are not statistically independent unseen data. No claim
of zero real-world false positives is justified by four negative cases.
