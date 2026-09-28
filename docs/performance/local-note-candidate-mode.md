# Explicit candidate recall for local notes

An explicit `memory_query` candidate mode raises agent-visible labelled-span coverage on a small frozen synthetic corpus. It also returns hits for **all 10 no-answer questions**. This mode is exploratory recall, not an answer classifier or accepted release gate. The default strict query remains unchanged.

## Mechanism

The mode accepts only `strict` (default) or `candidate`. `candidate` tokenises up to 512 UTF-8 bytes and 20 lexical units, preserves quoted phrases, drops a closed stopword list and builds an FTS5 OR expression with a 512-character bound. The existing admitted tool closure still checks session/chat identity, root and database binding, active tool grant, source digest, row byte/line bounds, namespace, scope dirty/coverage markers, cancellation, and the 2-second cooperative deadline. Candidate selection and result limits remain 20 validated candidates, five hits and 16 KiB encoded output. Each response reports `retrieval_mode`, `answer_assessed: false`, and a candidate-mode warning. `ok` refers to snapshot completeness and source validation; it does not assert relevance or correctness.

A quoted anchor can still be out-ranked by unrelated OR matches. The existing FTS5 tokenizer can match punctuation variants, and the candidate pool can be saturated. The mode does not merge context across original chunk bounds, guess a replacement reference, or reject missing facts.

## Frozen evidence

The hash-verified hard-v2 fixture in [the baseline report](local-note-current-tool-quality.md) has 16 fictional notes and two 12-query splits (7 answerable, 5 no-answer each). The disposable test runs the registered `memory_query` and `memory_get` tools; it scores exact labelled text **actually returned in snippets** at the labelled path and verifies every returned `{chunk_id, source_revision}` via `memory_get`. Filename or BM25 ranking alone receives no credit.

| Tool mode | Development answer spans | Held-out answer spans | Development no-answer hits | Held-out no-answer hits | Conflicting hits (dev / held) | Max encoded response bytes (dev / held) |
|---|---:|---:|---:|---:|---:|---:|
| Strict default | 2/7 | 3/7 | 0/5 | 0/5 | 0 / 0 | 894 / 1,621 |
| Explicit candidate | 6/7 | 6/7 | 5/5 | 5/5 | 4 / 2 | 3,548 / 3,554 |

All returned references resolved to their original bytes in the frozen unchanged corpus; no model answer accuracy was measured. A first-three-unit AND probe reduced no-answer hits to 3/5 per split but lost one development answer and still missed both repeated-heading labelled spans; it is **not** in the tool. The pre-existing pure context assembler preserves original chunk bounds and also cannot add an ancestor heading to those leaf chunks. The held-out labels were examined in earlier experiments, so this comparison does not establish an unbiased ranking threshold. Source-changing, admission, cancellation and index-corruption tests remain separate from these quality counts.

## Decision boundary

This slice exposes a bounded opt-in retrieval *candidate* surface; it does not satisfy the proposed #1346 evaluation gate of ≥6/7 answer spans and ≤1/5 no-answer hits per split at the same time. Neither a zero-hit strict result nor a nonempty candidate result proves that an answer exists. Do not deploy or make candidate mode the default on this evidence. Ranking and evidence/abstention policy require a separately accepted budget and a fresh untouched evaluation split under #390. Reproduce the quality probe with `bun run test:controlled -- runtime/test/note-retrieval/current-tool-evidence.test.ts` in an isolated worktree; no provider calls or live Smith note index are involved.
