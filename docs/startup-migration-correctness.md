# Historical startup-migration evidence

The selected legacy column/media startup passes described below are historical. V4 removes the media recompression pass and refuses unsupported v3 stores before schema work. The generic owned ledger and supported native/public SDK storage evolution retain their existing owners. Use the [one-shot history importer](development/session-history-import.md) with a fresh separate destination; this page supplies no current conversion, cleanup or rollback procedure.

Issues #1699, #1700 and #1701 shared one requirement: record or report an applied migration only after its postconditions hold. The changes use the existing owners and markers. They add no schema ledger or automatic repair of historical receipts.

## Owned ledger

`applyOwnedMigrations` validates the whole declaration before DDL, then checks and applies the batch inside one IMMEDIATE transaction. Nested calls use the caller's transaction/savepoint; startup already owns an IMMEDIATE writer transaction.

Replay compares owner, ID, order and SQL checksum. Changed historical order or SQL fails without rewriting the receipt. A later failure rolls back the entire unapplied batch, including its ledger writes. Previously applied receipts remain unchanged. Separate owners can retain their existing IDs/order values.

`piclaw_schema_migrations` remains the owned ledger. Historical `user_version`, `core_schema_migrations` and SDK `durable_schema` interpretation is unchanged. The subsequent [#1274 web-session slice](development/web-session-schema-ledger.md) adopts the existing identity index under this same ledger and removes two bespoke ensure helpers. Ledger-shape work in #1684 is separate.

## Selected legacy columns

The message-column and keychain-note compatibility helpers now share `ensureLegacyColumns`. It checks declared type, nullability, default, primary-key position and hidden/generated state through `table_xinfo`. Equivalent type case and redundant default parentheses are accepted.

A failed ALTER is accepted only when a fresh schema read proves the expected column shape. Missing, wrong-shape or uninspectable columns stop initialization. Diagnostics contain the selected table/column identity and exclude raw SQLite errors, SQL text, paths and values. A successful no-op ALTER cannot bypass verification.

The caller's foreign-key policy is restored on both successful and failed schema initialization. The existing startup transaction rolls back earlier DDL when a later postcondition fails. The #1699 slice left other legacy ensure helpers unchanged. #1274 subsequently reuses this verifier for the selected web-session columns and the existing owned ledger for their stable identity index; unselected legacy steps remain unchanged.

## Media compression

The media migration returns explicit outcomes:

- `complete`: every row in the pass was compressed and verified, or safely skipped because it was ineligible, too small, already flagged gzip or would not shrink.
- `partial`: some rows completed or were skipped and others failed.
- `failed`: no row completed, a pass-level operation failed, or the completion marker could not be verified.
- `already_complete`: historical `user_version >= 2`; no recompression or marker reset.

Each pass streams metadata through the initial maximum media ID and loads one blob at a time. Each row gets at most one attempt in that pass. A failed optional pass leaves v1 in place for a later startup attempt; there is no retry loop or second retry ledger.

Compression exceptions remain visible to migration accounting. The ordinary media-write API retains its existing raw-byte fallback. Before replacing data, migration output must round-trip to the original bytes. Each update has a savepoint and verifies its row count, stored bytes and metadata. Ignored updates, AFTER-trigger changes and statement failures restore the affected row. Transaction-wide rollback stops the pass before later rows can autocommit; loss of an enclosing startup transaction propagates as a fatal initialization error.

Partial passes retain successful gzip rows and leave failed rows byte-for-byte intact. Retries skip flagged rows and compress the remaining candidates. Malformed metadata and unsupported compression markers are retained as errors rather than silently discarded. Existing gzip-marked rows are preserved without reinterpreting their payloads.

The v2 marker advances only after a complete pass and is verified in the same transaction as its updates. Marker failure rolls back those updates. Startup performs the existing FTS v1 step first; unsuccessful media work does not replay FTS. Databases already marked v2 or higher remain authoritative, including historical cases whose original completion cannot now be proven. Detecting or repairing those cases requires separate operator review.

## Qualification and rollout

Synthetic tests cover changed order/checksum, duplicate identities/order, real competing processes, nested/batch rollback, matching and incompatible ALTER races, bounded errors, fresh/repeated initialization, compressor and row failures, ignored writes, metadata preservation, lossless retries and historical markers. Counterfactual runs of the original implementation fail each new regression. Existing DB and native copied-history/SQLite contracts also pass.

No table rebuild, data deletion, dependency change, live database operation or marker reset is part of this work. Valid schemas and media formats remain byte-compatible with older software. Rolling software back can restore the old false-completion behaviour for unfinished v1 work; it does not require undoing successful gzip rows. No installation or restart is authorised by the PR.
