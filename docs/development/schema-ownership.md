# Schema ownership and fresh/upgrade contracts

`runtime/scripts/schema-ownership.json` declares the owners and approved shapes of the main application database. The developer reader checks owned fixtures without initialising or repairing them. Production startup, migration ledgers, SDK persistence and add-on initialisers retain their existing authority.

## Read an inventory

Use an explicitly selected **owned fixture**, never the running profile without separate operational authorisation:

```sh
bun runtime/scripts/schema-inventory.ts /path/to/owned-fixture.db core
```

Profiles are `core`, `native` and `native-addons`. The command opens SQLite read-only and reports object names, fingerprints, owners, owner policies, registered document kinds, optional/required presence and errors as JSON. It returns a non-zero exit code for a failed contract. It does not select a default database, load the application, inspect credential/message/document payloads, migrate, repair, optimise or checkpoint.

`readSchemaInventory` also serves the existing test surface. It uses one read transaction, or borrows the caller's transaction without committing it. `classifySchemaInventory` reports errors; `assertSchemaInventory` fails the contract. Set `PICLAW_SCHEMA_INVENTORY_JSON=1` when running the focused fixture test to print its inventories as `SCHEMA_INVENTORY=` JSON records.

## Owners and differences

Every declared owner records its category, initialiser, writer modules/APIs, source of truth, replay/retention policy and source references. Writer references identify owning modules and public entry points; they are not a complete caller graph. Core owns shared physical KV storage; each add-on/caller retains its payload semantics and lifecycle. The registry grants no new writer authority.

The registry retains its original core schema source `3c66c54de0bc4826dc51655bb5f009ce6f9905d9` and add-on DDL source `e8aac2399148cbef638764ba2b5a1cd916cc5ecc`. Subsequent owned migrations add explicit source/checksum entries and exact fingerprints; those original provenance entries are not rewritten. Current qualification uses private `@earendil-works/pi-durable@1.4.0` and the native contract's approved add-on source `ad7ad0a4b63ee37090b6bee4309fa5c458ec6510`, including Code Review 0.1.11 with the same version-1 shared schema. These are source/fixture claims, not installed-runtime claims.

| Composition | Difference from fresh core | Authority |
| --- | --- | --- |
| Native default factory | SDK conversations/entries/tasks/submissions/documents and metadata; host bindings/cutover receipts; terminal settlement and timeline/media effect ledgers | SDK record APIs, host binding owner and existing service-effect stores |
| Native with all approved add-ons | Current additional main-schema objects are Code Review's saved-review tables, indexes and generated constraints | Exact approved add-on `ReviewDatabase`/`ReviewStore`; main connection is borrowed under the host owner fence |
| Historical upgraded core | Explicit session-import archive tables, FTS/shadows, indexes and triggers; preserved archive migration receipt | `SqliteSessionStore`, owner `piclaw-agent-sessions`, migration `001-namespaced-session-import` |
| Historical cursor and S01 mirror retirement | Exact optional archives preserve old cursor fields/rowids and S01 lane/state/watch values; active schemas keep polling/queue payloads and immutable native bindings | [Cursor owner](native-cursor-storage.md), [S01 binding owner](native-operation-binding.md) and their existing owned-ledger transitions |
| Historical chat-branch rebuild | SQLite quotes the rebuilt table header; the approved additional fingerprint retains all current clauses and constraints | Existing chat-branch migration in `connection.ts` |
| Reopened/optimised fixture | Optional exact `sqlite_stat1` planner-statistics table | Existing SQLite `PRAGMA optimize`/`ANALYZE` lifecycle |

The historical fixture seeds the older chat-branch uniqueness and token-usage schema through the existing upgrade paths. It verifies retained chat labels, branch identity, legacy usage, exact imported JSONL rows and owner/checksum receipts. Fresh native startup does not recreate the session archive.

Optional add-on/archive objects may remain when their producer is absent. Their exact declared shapes still apply. The atomic SDK/native/add-on/archive components declare `requiredWhenOwnerPresent`: any retained owned object requires all declared component tables, including FTS roots and shadows. An index or trigger declared on a retained table remains required whenever that table is present. Dropping an archive FTS root while leaving its entries/receipts therefore fails. This does not qualify a new add-on enable/disable mechanism; add-on lifecycle work remains separately scoped.

The [offline historical account-schema retirement](historical-account-schema-retirement.md) declares its own exact removal cohort and verified archive/candidate approval. The shared registry additionally preserves the four optional input-authority/provenance tables and their guards under `archive:input-authority`; it grants no cleanup or replay authority. The offline migration's SQL checksum is recorded in `sources`. Historical access-preparation markers remain startup vetoes, and SDK `documents.family` remains SDK-owned.

Remote Peer's separate store is outside this main-schema inventory. Its generic table names are not exemptions in the application database. The other approved add-ons may write existing shared storage or use separate resources; absence of additional main tables does not imply inactivity or obsolescence.

SDK document persistence and logical payload ownership are separate. The registry names the SDK harness documents, native application documents and copied-legacy import manifests with their scope/history/fork policies. Caller-defined document kinds remain supported through the public SDK API in the exact SDK tables. This does not permit arbitrary physical tables or infer a host document authority from a kind prefix.

## Shape and failure rules

- Unknown tables, indexes, triggers and views fail. There are no table-name prefix exemptions or table-count quotas.
- Required missing objects and unapproved shapes fail. All SQL clauses remain fingerprinted, including PK/UNIQUE/CHECK/FK actions and deferral, defaults, collations, AUTOINCREMENT, partial indexes, triggers, virtual-table options and STRICT/WITHOUT ROWID.
- Normalisation removes comments, ordinary SQL spelling case, insignificant whitespace and `IF NOT EXISTS`. It sorts top-level table declarations to accommodate column order after `ALTER ADD`; order within constraints and indexes remains exact. Quoted tokens and literal contents remain exact, including legacy double-quoted strings. This is spelling normalisation, not a proof of SQL equivalence. Additional historical spellings require an explicit reviewed fingerprint and source explanation.
- SQLite-generated PK/UNIQUE indexes inherit a known parent only when their constraint fingerprint is approved. Their physical autoindex numbering is not an independent product identity.
- FTS virtual tables and exact shadow objects are classified separately. Shadow storage is attributed to its projection/archive owner; it is not counted as a separate product table.
- `sqlite_sequence` retains AUTOINCREMENT allocation authority and high-water state. It is not disposable cache. Planner statistics are optional derived state. Unknown `sqlite_*` objects still fail.

## Maintain the contract

Run only the relevant tests through the repository launchers. For the frozen issue campaign, full suites are prohibited. The new fixture test uses the existing native fixture exports, synthetic providers, network denial and isolated filesystem roots.

```sh
PICLAW_LOCAL_TEST_NICE=10 bun runtime/scripts/local-test-priority.ts \
  --cwd runtime --env PICLAW_DB_IN_MEMORY=1 -- bun test ./test/schema-ownership.test.ts

# With the existing pinned native fixture exports; no native discovery sweep:
PICLAW_LOCAL_TEST_NICE=10 bun runtime/scripts/local-test-priority.ts \
  --cwd qualification/native -- bun test ./schema-ownership.test.ts
```

When a legitimate schema changes, inspect fresh and upgraded fixture inventories, identify its existing owner/initialiser and update the exact declarations with source evidence. Keep missing-index, constraint, unknown-object, optional-component and data/receipt-preservation negatives. Do not regenerate the registry from an unknown store to make a failure disappear.

No production schema, index, writer, migration receipt or retention policy changes in this work. Empty or fresh-absent objects remain protected. The contract does not prove data integrity, power-loss behaviour, complete reconstruction or compatibility with every historical installation. It has not inspected the running database. Unknown historical differences require owner evidence before approval; the developer check performs no cleanup or fallback.
