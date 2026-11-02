# Usage preservation before expense removal

This #1882 prerequisite preserves SDK reasoning and explicit provider-cost zero. Financial execution policy remains unchanged; #1875/#1882 are not complete.

Source base: `e67eacc6afce3dd275dcb47d229f3e46b56ec63a`, including the separately delivered queue and legacy-compaction retirements. None of their deletions belongs to this change. Root/private SDK graphs remain stock 1.4.0 and physically separate.

## Existing functions changed

- `model-request-accounting.ts` retains SDK `Usage.reasoning` when decoding terminal evidence and uses it when legacy aliases are absent. Output/total tokens remain inclusive; reasoning is not added again.
- An already settled modern request keeps its original canonical report's reasoning total. New decoding cannot rewrite an old report or its settlement hash. Mutable `token_usage` values are repaired from the existing verified canonical payload, not used as repair authority. Legacy-capture mapping remains unchanged.
- `agent-pool/usage.ts` accepts finite, nonnegative explicit provider actual cost even when every token/category cost is zero. Provider actual zero remains known while catalogue valuation remains unavailable. Anonymous zero payloads without an actual-cost fact are still skipped; stable event identity still deduplicates callbacks.

No new export, facade, ledger, mapping-version mechanism, policy flag or state owner is introduced. Cap evaluation, reservation, dispatch, financial readiness and history/schema ownership are unchanged and remain scheduled for deletion.

## Reproduced failures and preservation

1. On original source, the new host cases fail three assertions/cases: SDK reasoning becomes 0 and both explicit-zero cost aliases produce no report. The actual SDK summary checkpoint/reopen file fails four of six parent cases; unknown pre-receipt cases still pass.
2. The initial reasoning fix passes fresh observations but conflicts with a previously committed alias-only report's original settlement hash. That failing historical-replay receipt is retained.
3. The candidate retains the prior report's canonical reasoning value during settled replay. The historical case changes the mutable token projection to 999, then proves the original report/receipt/request/work/hash survives exact replay and a file-backed WAL database reopen.
4. Real SDK compaction checkpoint cases carry reasoning 2 inside output 3/total 5. Retained and already-committed outcomes recover once; SIGKILL/separate-process cases preserve original invocation/checkpoint identity and make no recovery provider call. Before durable receipt, the original uncertain send still fails closed without replay.
5. Both provider-cost aliases record an attributed all-zero terminal exactly once, with provider cost 0/provider provenance and unknown catalogue valuation.

## Focused checks

The selected host files cover recorder, retained settlement, request accounting, canonical projections, retention and token queries. Native files cover terminal allowlists/immutability/error/source behavior and actual SDK checkpoint/process recovery. All tests use the central Nice 19 launcher, mandatory filesystem isolation, disposable databases and synthetic providers; native guard denies network access.

Three strict source projects cover host, private engine and qualification, including the modified native test. An initial broad report-field type error was corrected using the existing validated numeric report value; compiler strictness was not changed. RED and type-failure receipts are preserved.

The exact candidate's passing counts and bounded source review are recorded in the PR. This focused evidence does not establish financial-free native execution, generic provider currency support, full-suite/browser/deployment qualification or completion of #1882. No live database, history, hold, schedule, configuration, provider credential, installation or restart operation is part of this change.
