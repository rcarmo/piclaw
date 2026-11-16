# Historical import and archive boundaries

V4 supports the explicit [one-shot session history importer](session-history-import.md) into a fresh separate native destination. Resident v3 conversion, copied-installation rehearsal, live cutover and the former JSONL-to-archive database CLI/benchmark are removed. None runs during normal startup.

## Already-native document history

`runtime/durable-engine/src/legacy-import-schema.ts` retains pure definitions for copied linear/tree documents already persisted in native stores. The original kinds, versions, scopes, fork/history policies and identity/provenance fields remain readable. It imports the public document factory; it cannot read a v3 source, construct an old runtime or convert a store.

`host-runtime.ts` and `session-tree.ts` use these definitions for retained native history. Their compiled runtime graph excludes removed import/cutover/rehearsal and archive constructors. The new one-shot importer uses its own bounded source reader and public SDK session/transaction APIs. No compatibility re-export restores `legacy-import.ts`.

## Already-native archive tables

The former `SqliteSessionStore`, archive importer and layout benchmark are removed. Their old table/index/trigger/view creation, JSONL decoder, append/search/export methods, recursive discovery, automatic backup and package requirements are removed with them. V4 supplies no in-place archive conversion or repair command.

Existing exact `piclaw_agent_sessions`, `piclaw_agent_entries`, FTS/shadows, indexes, triggers and original owned-migration receipts can remain as inert data on supported already-native stores. Fresh v4 Root and one-shot import destinations create none of this old archive schema. The schema inventory still rejects missing indexes, incomplete FTS components, unknown objects and shape drift; retiring a producer does not relax retained-data protection.

The native schema-preservation fixture now seeds explicit synthetic already-native history and the frozen historical DDL under `runtime/test/fixtures/historical-session-archive.json`. It invokes no removed producer or source-file importer. This test-only DDL/data setup is charged as replacement footprint; relocating it earns no production deletion credit.

## Already-native input and fork bookkeeping

The old migration-input capture/DDL/backfill module and owned-fork initializer, mutation and seed-materialisation APIs are removed. Fresh Root omits their tables. Already-native input holds/dismissals and owned-fork records retain their exact declared shapes, original identities, captured seed bytes and timestamps; no old seed becomes runnable work. Native reopen tests compare those rows, including unmaterialised seed bytes.

The unused offline root-owner assignment operation is also removed. Current ownership resolution, explicit home provisioning, role/enabled checks, parent-chain validation and foreign-owner denials remain supported. Reinitialising those native metadata schemas does not assign unowned archived or non-web history to any account. History import never adopts source accounts or configuration.

## Evidence and operational boundary

Native history tests retain original mappings, forks, counts, content and redaction checks. Schema tests retain exact component/constraint/foreign-key and byte/receipt preservation negatives. New importer tests cover supported content, refusals, data-only execution, incomplete destinations and reopen. Full exact-source/package qualification remains a separate delivery requirement.

Historical measurements and receipts remain labelled historical. No live source/store/configuration/history mutation, backup/restore, release, installation or restart is authorised by these source changes.
