# Schema ownership and native-format contracts

`runtime/scripts/schema-ownership.json` declares supported application database objects and exact inert objects that may survive in already-native stores. The developer reader inspects an explicitly selected fixture without initialising or repairing it. Normal v4 startup refuses unsupported v3 stores before schema work; selected offline history uses the separate [one-shot importer](session-history-import.md).

## Read an inventory

Use an explicitly selected owned fixture. Inspecting the running profile needs separate operational authority.

```sh
bun runtime/scripts/schema-inventory.ts /path/to/owned-fixture.db core
```

Profiles are `core`, `native` and `native-addons`. The command opens SQLite read-only and reports object names, fingerprints, owners, policies, document kinds, required/optional presence and errors as JSON. It returns non-zero on a failed contract. It does not discover a default store, load the application, read credential/message/document payloads, migrate, repair, optimise or checkpoint.

`readSchemaInventory` uses one read transaction or borrows the caller's transaction without committing it. `classifySchemaInventory` reports errors; `assertSchemaInventory` fails the contract. `PICLAW_SCHEMA_INVENTORY_JSON=1` prints fixture results as `SCHEMA_INVENTORY=` JSON records.

## Producers and retained data

Each owner records its initializer, current writer modules/APIs, source of truth, retention and references. A retired owner may have no active writer. A declaration grants no writer, cleanup or replay authority. Core owns shared physical KV storage; callers retain their payload semantics.

The registry retains historical source/checksum entries. Those entries describe the original schema bytes and are not rewritten as current SDK receipts. Current qualification uses `@earendil-works/pi-durable@1.5.2` and the exact fixtures in `scripts/native-gate-contract.json`.

| Composition or retained component | Current disposition |
| --- | --- |
| Fresh native application | Current Root schemas, SDK persistence/documents, accepted-source bindings and supported service-effect/timeline/media owners. No resident legacy converter or cutover registration. |
| One-shot import destination | Public SDK conversations, entries and data-only import provenance/completion document. Root initialization occurs only through normal supported native startup. No task/submission execution or copied account/configuration schema. |
| Approved add-ons | Exact current add-on-owned objects, including Code Review tables/indexes/constraints. Add-on enablement and execution remain separately fenced. |
| Already-native historical session archives | Exact optional original tables, FTS/shadows, indexes/triggers and receipts remain inert. No session archive producer or startup import is reinstated. |
| Already-native cursor/S01 archives | Exact optional old fields, rowids and receipts remain historical. [Current cursor storage](native-cursor-storage.md) refuses unsupported active shapes; it does not rename/archive/drop them. |
| Already-native historical chat-branch table spelling | The approved quoted-header fingerprint remains readable. The old rebuild producer is removed. |
| Already-native input migration and owned-fork bookkeeping | Exact optional old tables/constraints and original rows/seed bytes remain inert. Their capture, backfill, initializer and fork/seed writers are removed; fresh Root omits them. |
| Old financial/profile/cleanup objects | Exact declared historical objects may remain on already-native stores; retired creators are absent from fresh startup. They grant no native execution authority. |
| SQLite planner statistics | Optional exact `sqlite_stat1` remains SQLite-owned derived state. |

Historical fixtures prepare supported native stores and explicit inert records. They do not convert old stores to manufacture native authority. Supported histories, stable IDs, retained profiles and receipt/data bytes survive normal reopen without old source discovery.

Optional components remain exact when present. `requiredWhenOwnerPresent` requires every declared component table, including FTS roots/shadows. A declared index or trigger is required when its table exists. Removing one archive component cannot make the remaining component valid.

Remote Peer's separate store is outside this main-schema inventory. Generic names in that separate store do not exempt similarly named objects in Root. SDK physical document persistence and logical caller payload ownership remain separate; public SDK document kinds do not permit arbitrary physical tables.

## Shape and failure rules

- Unknown tables, indexes, triggers and views fail; no prefix exemptions or table-count quotas.
- Retired cutover history is absent as a pair on fresh stores. If either original cutover table is present, both original components are required; no old DDL or writer is reinstated.
- Required missing objects and unapproved shapes fail. PK/UNIQUE/CHECK/FK clauses, deferral/actions, defaults, collations, AUTOINCREMENT, partial indexes, triggers, virtual-table options and STRICT/WITHOUT ROWID remain fingerprinted.
- Normalisation removes comments, ordinary SQL spelling case, insignificant whitespace and `IF NOT EXISTS`. Top-level table declaration order can be sorted; constraint/index order remains exact. Quoted tokens and literal values remain exact. Additional historical spellings need reviewed source evidence.
- SQLite-generated PK/UNIQUE indexes inherit only an approved parent constraint fingerprint. Autoindex numbering grants no independent identity.
- FTS tables and exact shadows remain attributed to their existing owner.
- `sqlite_sequence` preserves allocation high-water state. Unknown `sqlite_*` objects fail.

## Maintain the contract

Run affected tests through `test:local`; qualify a delivery with the normal exact-source host/native gates. Keep missing-index, unknown-object, constraint, optional-component, transaction/foreign-key and byte-retention negatives. Never regenerate the registry from an unknown store to accept a failure.

```sh
bun run test:local --cwd runtime -- bun test test/schema-ownership.test.ts
bun run test:local --cwd qualification/native -- bun scripts/test-isolated.ts schema-ownership.test.ts
```

The inventory does not establish payload integrity, power-loss recovery or compatibility with every historical installation. These source tests do not inspect or change live storage, perform in-place cleanup or authorise installation, restart or backup/restore.
