# Timeline and accepted-payload query indexes

The core timeline and native accepted-payload fallback have separate nonunique indexes. Both preserve existing rows and source authority.

## Timeline owner

`runtime/src/db/connection.ts:createSchema` ensures `idx_messages_chat_jid ON messages(chat_jid)` inside the existing core startup schema transaction. Existing databases missing this index gain it; an existing historical index stays in place. The timestamp, bot/timestamp and thread indexes remain for their distinct callers.

The chat-only index includes SQLite's implicit rowid suffix. `getTimeline` uses it for latest and before-rowid pages; `hasOlderMessages` uses it for its existence probe. There is no explicit rowid index or change to pagination SQL.

`runtime/test/db/timeline-rowid-index.test.ts` captures the actual API SQL. Removing the index reproduces temporary sorting for both timeline branches. Fresh and upgraded fixtures verify indexed searches without a temporary sort, interleaved chats, reversed timestamp order, identical pages and repeated initialisation without row or historical-index changes.

## Host binding owner

`runtime/durable-engine/src/host-schema.ts` applies migration `host.native-bindings:accepted-payload-index-v1`, order 1, through the existing `piclaw_schema_migrations` ledger. Its immutable declaration in `runtime/src/db/native-host-schema-contract.ts` is shared with the legacy-upgrade guard:

```sql
CREATE INDEX IF NOT EXISTS idx_piclaw_durable_bindings_payload_recovery_v1
  ON piclaw_durable_bindings_v1(incarnation,chat_jid,source_id,payload_ref);
```

Fresh host setup applies the step after exact table-shape validation. Existing-schema application bootstrap validates the host tables, then explicitly applies the same step before controller recovery. The idle FK-enabled connection, synchronous ownership guard, index definition and checksummed receipt are checked within the guarded transaction. Ownership loss rolls back the index and receipt together. An incompatible index or a receipt whose index is missing fails closed.

The legacy-upgrade frontier permits this exact candidate index and a native receipt matching the declared owner, ID, order and SQL checksum. The shared ledger schema, all other receipts and undeclared indexes stay protected. Candidate receipt validation and host index-shape validation retain their separate owners. No prefix exemption or whole-ledger exclusion is used.

The fallback SQL and existing message-selection/provenance checks live in `runtime/durable-engine/src/accepted-payload-recovery.ts`. The query joins host correlations to SDK `submissions` and `entries`; those SDK tables retain their own schema owner. There is no new payload store, JSON-expression index or cross-domain foreign key.

The selection policy is unchanged. A missing row or changed projection identity recovers SDK accepted bytes. A same-identity content edit still reaches the binding port's canonical request-hash check and fails on a mismatch. Accepted-entry provenance and current source checks remain required; a correlation index grants no execution authority.

`qualification/native/schema-convergence.test.ts` exercises the production reader and binding port against a real SDK fixture with 4,000 retained correlations. It reproduces a binding scan before migration, then requires a binding index search and SDK primary-key lookups. It also checks unchanged rows/selected records, projection changes/deletion, provenance/hash rejection, owner-loss rollback, index drift and idempotence.

These are query-plan and disposable-fixture checks. No large live-history throughput benchmark, deployment, live database migration or rollback operation was performed. The change removes no object or retained write path; older code can ignore the additive indexes and new host-owned receipt.
