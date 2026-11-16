# Native cursor storage

`chat_cursors` stores polling acknowledgements and retained queue payload bytes. EF-S01 owns accepted-source membership; SDK submissions and tasks own execution. A polling timestamp grants no execution, cancellation or continuation authority.

## Supported schema

`runtime/src/db/chat-cursor-storage.ts` accepts exactly three TEXT columns:

| Field | Meaning |
| --- | --- |
| `chat_jid` | Primary-key chat identity. |
| `cursor_ts` | Host polling/delivery acknowledgement; NOT NULL, default empty string. |
| `queued_followups_json` | Historical payload/provenance bytes. Native executable queue state comes from the SDK inbox. |

Fresh storage uses owner `host.chat-cursors`, migration `polling-frontier-v1`, through the existing checksum ledger. It creates no preflight, inflight, failure, compaction-window, backoff or S01 execution fields, ownership triggers or archive table.

Existing supported native storage keeps its current rows and identities. Exact SQL/column/default/key checks reject extra fields, non-primary indexes, dependent triggers/views/foreign keys and temporary shadows. Failure does not rename, copy, DROP, repair or backfill the table.

## Old stores and retained native history

Normal startup first checks the store format read-only, before WAL/schema work. An unsupported v3 store refuses unchanged and points to [one-shot history import](session-history-import.md) into a fresh separate destination. The importer reads explicitly selected offline JSONL; it does not import a cursor table or runnable queue.

Some already-native stores contain `host_legacy_chat_cursor_state_v1`, S01 archives or old owned-migration receipts created by earlier software. Their original bytes, exact declared shapes and receipts remain historical data. Current startup creates none of those archives and does not inspect their markers to grant execution, revive a host owner or perform another transition. No in-place legacy-schema cleanup is provided.

The [schema inventory](schema-ownership.md) recognises the exact retained native archive shapes without recreating their producers. Unknown or incomplete retained components still fail inventory. Native/public SDK storage evolution remains owned by the existing native components; historical migration names grant no v3 conversion authority.

## Verification

Fresh/current-native fixtures cover exact schema acceptance, old-schema refusal without mutation, malformed historical payload retention, foreign-key/transaction behaviour, temporary/dependent-object refusal and native reopen. Historical fixtures prepare supported native storage directly with public APIs and explicit inert records; they do not invoke removed converters.

Native qualification separately covers settlement before polling acknowledgement, lost acknowledgements, accepted queued inputs, ownership and close/reopen without repeated effects. Failed or focused receipts do not establish a complete host/native gate. No live store, backup, schema, installation or service operation is authorised by these source tests.
