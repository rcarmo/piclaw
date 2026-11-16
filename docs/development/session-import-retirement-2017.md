# Session import and legacy retirement — #2017

Source base: `5f2e2dd18b3d95d669142cd5052f0f75f72eee08`. Merge checkpoint `86612d6d2`
integrates that reviewed main into the import branch without rebase. Exact final
head, gate fingerprints and numeric outcomes belong to the qualification receipt.
No source gate is certified by this census.

## Counted source

The Git diff against that base changes66handwritten production
TypeScript files under `runtime/src`, `runtime/durable-engine/src` and
`runtime/scripts`: 565added / 7118removed physical lines,
a reduction of6553. This includes comments and type declarations,
and charges every added production line. Generated assets, tests, docs and JSON
metadata are excluded from production credit.

Conservatively debit102moved declaration lines:60original archive DDL,
10owned-fork DDL,26original optional/MCP composition excerpts and6PoolEntry type
lines. The resulting attributed reduction is6451lines.
The2069-line historical account-object JSON declaration moved unchanged to test
fixtures; it earns zero deletion credit. Registry metadata and historical #1875
classifications/earlier reduction receipts keep their separate accounting.
These source counts establish no latency, memory, rollout or account acceptance.

## Removed packaged modules

- `runtime/durable-engine/src/application-upgrade.ts`
- `runtime/durable-engine/src/copied-installation.ts`
- `runtime/durable-engine/src/copied-upgrade.ts`
- `runtime/durable-engine/src/host-cutover.ts`
- `runtime/durable-engine/src/legacy-import.ts`
- `runtime/durable-engine/src/rehearsal-sqlite.ts`
- `runtime/durable-engine/src/rehearse.ts`
- `runtime/durable-engine/src/runtime-upgrade-workflow.ts`
- `runtime/scripts/benchmark-cold-session.ts`
- `runtime/scripts/benchmark-sqlite-session-layouts.ts`
- `runtime/scripts/import-jsonl-sessions.ts`
- `runtime/scripts/lib/historical-account-copies.ts`
- `runtime/scripts/lib/historical-account-retirement.ts`
- `runtime/scripts/lib/historical-account-schema.json`
- `runtime/scripts/lib/sqlite-session-archive.ts`
- `runtime/scripts/retire-historical-accounts.ts`
- `runtime/src/agent-pool/adopted-session-import.ts`
- `runtime/src/agent-pool/branch-seeding.ts`
- `runtime/src/agent-pool/legacy-authority-capture.ts`
- `runtime/src/agent-pool/legacy-host-frontier.ts`
- `runtime/src/agent-pool/legacy-source-inventory.ts`
- `runtime/src/agent-pool/retired-provider-selection.ts`
- `runtime/src/agent-pool/session-file-persistence.ts`
- `runtime/src/agent-pool/session-manager.ts`
- `runtime/src/agent-pool/session-node-modules-link.ts`
- `runtime/src/agent-pool/session-persistence.ts`
- `runtime/src/agent-pool/session.ts`
- `runtime/src/db/media-recompress.ts`
- `runtime/src/db/migration-input-holds.ts`
- `runtime/src/db/owned-forks.ts`
- `runtime/src/session-archive.ts`

The bounded `session-import/source.ts` reader, native history importer and
completion/provenance record remain. CLI exports expose that explicit one-shot
operation. Current native tools/models/MCP still use public SDK APIs through
`durable-legacy-sdk.ts`; shared transport, credentials, authority and history
readers were not deleted by name. Path-only consumers retain `session-paths.ts`.
The four #1875 preparation metadata files stay inert with unchanged rows and
protection policies; their test oracle uses frozen historical composition excerpts.

## Database objects and data

`runtime/scripts/schema-ownership.json` supplies the per-object table/index/
trigger/view fingerprints, producer/writer declarations, references and exact
optional-component rules. [Schema ownership](schema-ownership.md) records each
retired cohort and supported native evolution boundary. Historical account
objects have their original157-entry declaration and original initializer SQL
in test fixtures; no account cleanup command or DROP implementation is shipped.

Fresh native Root omits retired account/profile/cleanup, old input hold/authority
and owned-fork objects. Removed creators cannot recreate them during startup.
Supported already-native archive/cursor/input/fork records, raw seed bytes,
receipts, identities and exact shapes remain inert and survive reopen. Unknown
objects, missing required components, changed constraints/indexes and foreign-key
failures remain negatives. Existing v3 stores refuse unchanged before WAL/DDL.
No in-place DROP/backfill cleanup, private-copy migration rehearsal or automatic
source discovery is supplied as an alternative to fresh import.

Supported current-native Root/service-effect and public SDK schema evolution
remains in its existing owners. Those owners do not convert a v3 store: the
read-only format fence runs first. Source histories/configuration are never
installed by the importer as current instructions, accounts, credentials, model
selection, queue/lease state or execution receipts.

## Qualification boundaries

[Import procedure and test disposition](session-history-import.md) lists supported
content, exclusions, repeated/interrupted behaviour and retired constructor cases.
Native schema tests reopen actual public SDK document families, archived input
records and approved add-on schemas without copied-store cleanup. Generic adapter
features remain outside native parity qualification. The complete native contract
contains152files: seven converter/rehearsal files were removed and two import/
bootstrap files added against the157-file base. Discovery, both
private type projects and required source-admission/store-format integration remain
mandatory. Original failures and focused passes stay distinct from the full gate.

Local source/build/package preparation authorises no installation, restart, live
migration/import, account canary, backup/restore, release tag or publication.
