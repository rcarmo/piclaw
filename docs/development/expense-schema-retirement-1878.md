# Retire financial schema initialisation — archived delivery record

This records the accepted #1878 slice. The final #1875 delivery also removes the caller-free payload encoder/decoder described as retained below. Old payload/hash bytes are opaque: startup does not decode, validate/repair, backfill or reconstruct financial reports. Structural references still protect history; current reporting is described in [Native usage reports](usage-report-projections.md).

## Archived design and qualification


#1878 removes financial schema creation and migration from ordinary startup. Fresh databases contain passive `token_usage` reporting without cap, reservation, allowance, window, decision, financial-work or expense-event tables.

## Deleted ownership

Base: `9026ef0e8f22208a16e6060ebf8157c6933f9615`.

- Delete `runtime/src/db/budget-limits-schema.ts` and its sole production caller in `connection.ts`: table/index/trigger creation, cap-revision backfill and six reservation migrations.
- Delete automatic report-event schema migration, payload backfill, trigger repair and recursive verification in `usage-report-projection.ts`.
- Remove active financial-owner descriptions from the schema inventory. Their exact schema fingerprints remain optional historical data under a retired classification. This classification owns no execution or mutation.

No new runtime owner, facade, queue, ledger, financial gate, migration or feature flag replaces these paths. Report normalisation and narrow historical payload encoding/decoding remain plain data functions. Goal token budgets and provider-reported quota/authentication are separate contracts and remain unchanged.

## Historical records

Opening a historical database preserves financial tables, rows, SQLite constraints, migration receipts and original payload bytes. Ordinary startup does not backfill missing historical payloads, reinterpret old holds, repair expense triggers, settle debt or prune financial history. A pre-payload event decodes as unavailable evidence; a malformed hash still fails validation. Existing financial data never admits fresh work.

Generic schema inspection can still flag missing constraints or unapproved schema drift in a retained historical component. This diagnostic is separate from ordinary financial-free startup. No live history deletion, hold clearance, restore or migration is part of this source change.

## Passive reporting and existing cleanup

`storeTokenUsage` still appends directly to `token_usage`, preserving tokens, actual-zero/unknown provider cost, catalogue valuation, attribution and event deduplication.

Existing report retention and branch/orphan cleanup protect historical event/request references only when their original tables exist. Absence means there are no references in that table, matching an empty old table; it does not introduce another cleanup policy. Recognised report/invocation/work identities and recorded historical windows retain their existing retention protections.

Retention preview and apply observe a consistent SQLite transaction. Apply re-reads optional dependencies under its write transaction, so historical references restored between preview and apply revoke the old plan before deletion. Orphan metadata/report deletion now shares one short synchronous transaction; filesystem inspection remains outside it. No SQL callback or external effect is replayed.

The offline recovery qualifier includes historical work/request tables in its before/after fingerprint when present, without requiring them in a fresh recovery unit. Required SDK and accepted-source tables remain mandatory.

## Scheduled-history reference follow-up

S07 retention no longer joins or classifies financial reservation states. The existing store protects a terminal occurrence whenever an original `budget_work.scheduled_task_id` references its task, regardless of state or whether a reservation exists. A retained reservation table without the work table is insufficient evidence for deletion, so the store retains history conservatively. With neither table present, ordinary retention proceeds.

One private structural-reference predicate serves native preview/apply and the old cleanup entry point. The legacy route retains its original selection and replay contracts; it does not acquire the stricter, different native eligibility policy. No other owner, queue, ledger, schema or financial lifecycle is introduced. Historical rows are read only, and the task-ID lookup can use the existing historical index.

The predicate adds five net production lines to cover both entry points and incomplete historical schema. Combined with the preceding schema retirement, the #1878 production reduction is 396 physical lines. Tests and archived SQL remain separately charged.

Coverage includes every original reservation state, opaque future state, work-only and request-only schemas, unrelated task references, malformed mappings, temporary shadows, references arriving between preview/apply, whole-page refusal, lost ACK/reopen replay and fresh occurrence admission for the same referenced task. A shared real SDK database control retains the original financial rows and SDK identities, retires only an unreferenced terminal occurrence, and makes no model or credential call.

## Tests and package boundary

- Fresh-root regression proves no financial objects or financial migration receipts are created, while real usage reporting succeeds.
- Disposable on-disk reopen preserves old unresolved records, original schema and migration receipts exactly.
- Historical report tests cover opaque/partial pre-payload schema, unknown evidence, corrupt hashes, unchanged old records and no financial repair.
- Existing retention tests retain exact-page ACK replay, bounds, protected references/windows, rollback, revocation, tampered plans and cursor publication. A new fresh-root preview/apply case checks newly restored historical references.
- Actual SDK/core-add-on controls verify both stored-account and unaccounted reporting with no financial schema. Side, Dream, compaction, scheduled allocation, source revocation and reopen scenarios retain their existing effect-count and non-replay assertions.

Tests needing old records explicitly install a fixed synthetic SQL fixture captured from the base schema: 46 named objects and seven migration receipts. It contains no evaluator, request executor or automatic migration chain. The fixture and its helper live under `runtime/test/fixtures`, outside the package file allowlist. Fresh-root tests do not install it. `bun pm pack --dry-run --ignore-scripts` confirms neither the deleted initializer nor this test fixture appears in the package inventory; release hooks were not executed.

## Review limits

MAI supplied a production caller audit and raised three review concerns. The absent historical reader now returns no event, and pre-payload events remain unknown without mutation. Optional-reference deletion is tested against fresh and historical data. Retention uses synchronous transactions, so concurrent DDL cannot change its dependencies mid-batch; orphan SQL cleanup also uses one transaction. A later delegated review timed out and is not counted as approval.

Validation receipts and exact final production/test/metadata line counts belong in the PR and exported qualification receipt. Historical fixture SQL, inventory metadata and tests earn no production deletion credit. Rollout requires separate approval.
