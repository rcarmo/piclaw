# Historical account objects remain inert

The historical-account prepare/apply CLI, copy/backup workflow and DROP helper
are removed under #2017. Existing source/development stores remain intact.
Normal v4 startup refuses unsupported stores before schema work. Selected offline
session history uses the [one-shot importer](session-history-import.md), which
creates a fresh separate native destination and imports no account state.

The original per-object declaration remains as test data in
`runtime/test/fixtures/historical-account-objects.json`:157object fingerprints,
36regular tables, one FTS root and five shadows. Its source is
`cdc214fcc06349dc9d315c2d17c866764e4557d5`. The original initializer SQL and
source paths remain in `historical-account-schema.json` beside it. These moved
declarations earn no production deletion credit.

Current runtime does not initialise the historical account cohort. Exact supported
already-native input-authority objects and records remain covered by the shared
schema registry and native reopen tests. Native SDK document-family discriminators,
approved add-on schemas and original migration receipts survive reopen. Unknown
objects, missing components and shape drift still refuse qualification.

The older35-table deployed audit did not identify the missing source-defined
table; the historical source defines36. No guessed identity or live data census
has been substituted. [Historical procedure and evidence](../archive/historical-account-schema-retirement.md)
remain available as removed-code documentation.
