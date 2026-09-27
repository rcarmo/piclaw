# Anchor, proximity and context-expansion experiment

Context expansion improves delivered evidence on harder synthetic queries, but
lexical anchors and BM25 do not reliably distinguish a matching topic from an
absent answer. V2 is not ready to replace the [v1 candidate](local-note-passage-experiment.md)
as a universally better retrieval policy. This change is an offline experiment
for #1346/#390; it enables no tool, schema, production ranking or live-index change.

## Frozen fixtures and candidate

A separate author created 16 fictional notes and 24 queries before any candidate
run. The author did not inspect candidate code or results. Each split has seven
answerable queries and five no-answer queries, with separate topics: exact names
and identifiers, near matches, wrong-entity attributes, explicit historical
conflicts, paraphrases and cross-paragraph evidence. Labels select exact source
lines needed for the answer, not chunk boundaries. A pre-run correction changed
one exact-entity query per split to actually use ASCII quotes; labels and notes
were untouched. Hashes and label ranges were verified and committed at
`afa12469a` before development evaluation.

The [v2 freeze](../../runtime/test/fixtures/note-retrieval/anchor-freeze.json)
binds candidate/evaluator code, production source, both corpora and dependencies.
Candidate `8f5256f22` was committed before the first successful held-out run.
The initial held-out invocation refused to run because the freeze file did not
exist; no queries ran in that attempt. No candidate, evaluator or labels were
changed after successful held-out evaluation. The v1 files and original labels
and budgets remain byte-identical to #1422.

This authorship separation reduces direct tuning to labels but is not a
statistically representative or externally curated benchmark. The hard held-out
split was not consulted to tune the candidate. The original published held-out
split is a known regression set, not new unseen evidence.

## Implemented components

- **Small paragraph cores and adjacent context.** The existing Markdown chunker
  supplies sections. Cores split at paragraphs or complete-line size bounds.
  Windows add adjacent paragraphs and a directly preceding heading chain, at
  most 1,536 bytes. No guessed sentence completion or fabricated heading text.
- **Explicit anchors.** Quoted phrases and numeric compound identifiers are
  mandatory literal surface matches, including case and punctuation. Identifier
  prefixes, pluralised entities and reordered phrases cannot pass. Sentence-final
  punctuation is allowed; combining-mark continuations are not.
- **Separate bounded candidate streams.** All-query-unit, anchor and broad OR
  streams each retain at most 50 rows. All candidates are rescored under the same
  MATCH expression before merging. A regression fixture puts a qualifying long
  passage below 50 partial OR hits: the all-unit stream recovers it. Candidate
  truncation stays explicit; the streams are not exhaustive retrieval.
- **Coverage and proximity.** SQLite Porter tokenisation deduplicates non-anchor
  equivalents. Unknown units stay in the denominator. The default needs at least
  half of the units and 65% document-frequency-weighted coverage in returned text.
  It sorts by weighted coverage, matched-unit count, minimum token span, common
  BM25 score and binary source coordinates. No learned weights or model calls.
- **Conservative exact-anchor proximity.** Porter offsets cannot identify which
  literal anchor occurrence passed the surface check. Queries containing exact
  units therefore get no proximity bonus rather than a guessed one. Non-anchor
  queries use token positions from `fts5vocab`.
- **Deduplication and packing.** Overlapping source intervals are merged when the
  union fits the passage and total payload caps; bridged overlaps cannot leave
  duplicate ranges. Otherwise the higher-ranked interval stays and output is
  flagged limited. Five hits and 4,096 serialized bytes are hard caps. Matching
  explanations on merged context describe the highest-ranked constituent.
- **Metadata without authority claims.** Explicit `Status:` and ISO `Date:`,
  `Updated:` or `Effective:` lines can be displayed, never used for ranking.
  Free-form dates/status remain in source text and headings. No blanket recency
  boost or inference of which contradictory statement is correct.

Harder filler now uses ordinary bounded lines and paragraphs. Both methods index
its text rather than dropping one long line as in the v1 scale probe. No source
windows were excluded in the measured runs. A separate overlong-line regression
verifies incomplete status instead of a definitive no-match.

## Evaluation

The scorer is unchanged from v1: it credits only complete labelled quotes in
agent-visible returned text under the matching path. Line coverage and file-only
upper bounds remain diagnostics. It does not measure an LLM's answer accuracy,
calibrated confidence or validated revision citations. Production-tool comparison
uses the exact returned text and only removes unambiguous highlight markers.

Each table entry counts unique queries once. Repeated queries, scales and process
runs are stability evidence, not additional independent samples.

| Hard split / variant | Queries with all labelled spans | False positives on five no-answer queries | Invalid queries |
| --- | ---: | ---: | ---: |
| Development: current tool | 0/7 | 5/5 | 0 |
| Development: v1 two-thirds | 3/7 | 2/5* | 4 |
| Development: v2 | 6/7 | 4/5 | 0 |
| Development: no expansion | 3/7 | 4/5 | 0 |
| Development: all units | 3/7 | 1/5 | 0 |
| Development: relaxed rarity | 6/7 | 5/5 | 0 |
| Held-out: current tool | 0/7 | 5/5 | 0 |
| Held-out: v1 two-thirds | 5/7 | 4/5* | 2 |
| Held-out: v2 | 6/7 | 5/5 | 0 |
| Held-out: no expansion | 3/7 | 5/5 | 0 |
| Held-out: all units | 3/7 | 0/5 | 0 |
| Held-out: relaxed rarity | 6/7 | 5/5 | 0 |

*V1 rejects four development queries including three negatives, and two held-out
queries including one negative, for exceeding its eight-unit limit. Those are
**unsupported requests**, not successful abstentions. Among supported negative
queries, v1 returns a false positive for 2/2 development and 4/4 held-out cases.
The recorded output exposes both denominators. V2 supports up to 20 units and
rejects none of these fixture queries.

Removing proximity did not change aggregate quality on either hard split. Removing
anchor enforcement also did not change those aggregate counts after final bounds
fixes, although focused exact-name/identifier tests show why the requirement is
needed. These features are correctness/ranking controls, not demonstrated broad
quality improvements. V2 still returns two conflicting hits in development and
one in held-out; all-units matching returns none but loses four answerable queries
per split. It is not a safe default merely because its negative score is better.

On the original regression set, v1 remains 10/10 answerable evidence delivery on
both splits with 0/2 negative false positives. Strict v2 is 9/10 development and
10/10 held-out, both 0/2 negatives. Capping rarity weights at two recovers the
original development paraphrase but admits all five hard development negatives.
That trade-off was observed during development and retained as an explicit
ablation; no held-out retuning occurred.

Hard v2 payloads average about 480 bytes in development (maximum 1,129) and 468
bytes held-out (maximum 950). V1 is smaller but often returns errors or less
complete evidence. Exact payloads and every run summary are in
[the recorded evidence](local-note-anchor-results.json).

## Determinism, bounds and tests

All eight runs per dataset/split passed byte-identical payload comparisons: two
independent forward/reverse builds at 16/516 hard files or 12/512 original files,
with a fresh-process reopen of each build and five repeated queries. Four
combinations give 32 runs; these do not increase the statistical sample count.
SQLite/Bun versions are recorded. No network, provider or production DB is used.
Input limits are 2,000 files, 32 MiB source bytes, 32,768 experimental passages,
512 query bytes, 20 units and at most 150 merged candidates. This synthetic
experiment has no production query deadline or cancellation implementation.
Quoted anchors can still be crowded out by punctuation variants in SQLite's
candidate tokenisation; such exhausted streams report limited coverage. Lexical
synonyms and absent facts remain unresolved. Cross-version score identity is not
claimed.

Ten focused v2 tests (69 assertions), typecheck and scoped lint pass. Initial full
`ci-fast`: 5,706 pass, seven skipped, two unrelated five-second timeouts
(image text rendering and EF-S07 SQLite projection). The two files plus v2 tests
pass in an isolated rerun: 47 tests / 387 assertions. Separate 25 feature tests and
nine build tests pass. No timeout threshold was changed. A subsequent complete
`make ci-fast` passed: 5,708 runtime tests, seven skipped, zero failures, plus 25
feature tests and nine build tests. The initial failed attempt is retained in the
evidence; the final full pass, not the focused rerun alone, supplies the green gate.

A bounded pre-freeze code review identified and prompted fixes for combining-mark
anchor boundaries, mixed-stream score comparisons, misleading proximity for exact
anchors, incomplete-source status and transitive overlap merging. Broader and final prose-review
attempts timed out and supply no approval. Remaining bounded-candidate limitations
are listed above.

## Reproduce and next step

```bash
bun run test:controlled -- runtime/test/note-anchor-experiment.test.ts
bun run test:local -- bun runtime/scripts/note-anchor-experiment.ts > hard-development.json
bun run test:local -- bun runtime/scripts/note-anchor-experiment.ts --held-out > hard-held-out.json
bun run test:local -- bun runtime/scripts/note-anchor-experiment.ts --original > original-development.json
bun run test:local -- bun runtime/scripts/note-anchor-experiment.ts --original --held-out > original-held-out.json
```

`--small` omits scale runs. Held-out execution requires the checked-in frozen
fingerprints. Changing candidate/scorer/source requires a new explicitly reviewed
freeze and new untouched evaluation data, rather than retuning this held-out set.

Adopt context expansion, complete source ranges and overlap handling as components
of #387's bounded query/get design, preserving its access/freshness contract.
Do not promote either weighted or all-unit rejection as semantically reliable.
The next experiment needs evidence-sufficiency signals for requested attributes
and negation, measured alongside abstentions and incorrect-context cost. It should
retain this hard set as regression evidence and introduce new untouched cases.
Old #1346 budgets remain proposed; no issue or deployment gate is closed here.
