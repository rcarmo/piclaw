# Offline historical account-schema retirement

The offline tool creates a verified archive and a separate candidate database. It can retire only qualified empty historical objects and the original zero-valued workspace counter. It never promotes the candidate, discovers the running profile or changes the source database. Production cleanup needs separate operational approval.

## Object authority

`runtime/scripts/lib/historical-account-schema.json` is the per-object retirement declaration. Its 157 entries record exact table, index, generated-index, trigger and FTS fingerprints, parent objects and references. The `dependencies` map records every regular table's foreign keys. The original empty FTS shadow contents are also declared; an empty visible index does not establish that its shadow data is unused.

The declaration comes from source `cdc214fcc06349dc9d315c2d17c866764e4557d5`, the parent of `e6d459ea2` (feature removal). The fixture preserves the original initializer SQL, source paths, line numbers and initialization order. It contains no copied production data.

| Historical producer (`runtime/src/db/`) | Regular tables |
| --- | --- |
| `account-avatar.ts`, `account-model-defaults.ts`, `account-preferences.ts` | `user_avatars`, `user_model_defaults`, `user_preferences` |
| `auth-factors-schema.ts` | `user_totp_factors`, `user_totp_enrolments`, `user_auth_invitations`, `user_passkey_registrations`, `user_totp_registrations`, `account_recovery_events`, `account_security_events`, `user_auth_attempts`, `operator_recovery_events` |
| `family-execution-admission-schema.ts`, `family-task-admission-schema.ts` | `family_execution_admissions`, `family_task_admissions` |
| `family-media-uploads.ts`, `family-memory-schema.ts` | `family_media_uploads`, `family_memory_publications`, `family_memory_withdrawals` |
| `family-scheduled-grants-schema.ts` | `family_scheduled_grants`, `family_scheduled_grant_revocations` |
| `family-scheduled-occurrences-schema.ts` | `family_scheduled_occurrences`, `family_scheduled_occurrence_events` |
| `family-scheduled-executions-schema.ts` | `family_scheduled_executions`, `family_scheduled_results`, `family_scheduled_execution_events` |
| Other `family-scheduled-*-schema.ts` producers | `family_scheduled_cancellations`, `family_scheduled_dispatches`, `family_scheduled_expiries`, `family_scheduled_interruptions`, `family_scheduled_publications` |
| `family-tool-restrictions.ts` | `user_tool_restrictions`, `user_tool_restriction_events` |
| `family-workspace-index-schema.ts` | `family_workspace_files`, `family_workspace_index_status`, `family_workspace_index_generation` |
| `message-authority-schema.ts`, `session-ownership.ts` | `family_turn_queue`, `account_home_events` |

This source defines **36 regular tables**, one virtual `family_workspace_fts` and five exact shadows: **42 physical tables**. Eleven historical triggers are attached to retained `users`, `web_sessions`, `scheduled_tasks` and the two S07 task tables. They are included in the declaration and removed before tables. Tables are removed child-first; SQLite owns removal of each virtual table's shadows and each table's indexes.

Issue #1690's older deployed-store audit counted 35 regular tables. That audit did not publish their individual identities. This source revalidation cannot identify which source-defined table was absent there. It does not invent a missing table to match 35. Each approval binds the actual present-object list and physical table reduction; unknown shapes and incomplete components refuse migration.

## Retained authority and consumers

Tracked Core source, including tracked agent templates, and supported add-ons at `8150ca59edb44d30d6a07557433f30612f71adc0` have no current production references to the 37 parent-table names. This is static evidence; unsupported external consumers or dynamic SQL need separate qualification. Existing preservation tests remain consumers of historical fixtures. Current startup does not recreate the retired cohort.

Everything outside the exact declaration remains retained, including:

- `users`, `access_state`, `session_roots`, current ownership guards and branch/fork records;
- current sessions, WebAuthn credentials/enrolments, labels, encrypted keychain data and credential references;
- SDK tables, document revisions and **`documents.family`**, which is an SDK discriminator;
- media, messages, current workspace/message FTS, usage, scheduling, budgets and add-on data;
- migration ledgers, access-factor/resource/promotion receipts, quarantine and import provenance;
- `access_migration_preparation`, whose presence still vetoes startup; retirement never fabricates activation;
- `migration_input_holds`, `migration_input_dismissals`, `message_execution_authorities` and `message_recovery_authorities`, with their indexes and immutable guards.

The four input-authority tables have an explicit optional archive owner in the shared schema registry. Current `migration-input-holds.ts` remains their reader/writer where applicable. Their admission, dismissal, source-snapshot and recovery history is neither deleted nor replayed by this tool. Their old initializer is fixture-only.

## Prepare and approve an owned offline copy

Do not use a running profile. Obtain separate authority and establish a quiescent, owned offline input and any complete external recovery unit first. These commands qualify **owned fixtures/copies only**:

```sh
bun runtime/scripts/retire-historical-accounts.ts prepare \
  /path/to/owned-offline-copy.db /path/to/new-private-directory

# Review plan.json, blocked reasons, exact objects/counts and the archive hash.
# Apply only the exact approved plan.sha256:
bun runtime/scripts/retire-historical-accounts.ts apply \
  /path/to/new-private-directory APPROVED_PLAN_SHA256
```

Preparation exclusively creates a private directory containing `archive.db`, `candidate.db` and metadata-only `plan.json`. It opens the source read-only and uses the existing verified SQLite backup owner. Full logical fingerprints compare source, archive and candidate, including sparse hidden rowids, int64 storage, binary/NUL data, SQLite allocation state and all migration receipts. A changed or lossy snapshot refuses approval. No payloads are printed.

Application opens the archive read-only with `query_only`, checks private ownership, file identities, hashes and exact approval, and changes only `candidate.db`. Symlinks, shared hard links, unexpected output sidecars, attachments, TEMP objects and changed copies refuse application. The source is not opened during application.

## Refusals and commit receipt

Preflight checks integrity, foreign keys, exact declared shapes/children, FTS completeness and dependencies. Any populated historical table refuses removal, except the single original `(id=1, revision=0)` counter. Credentials, audit rows, queued intent, uncertain executions, publications, nonzero counters and changed FTS shadow contents remain archived and unmodified. Their reconciliation requires a separately reviewed migration; an operator cannot bypass the refusal by approving its digest.

Unknown incoming foreign keys, retained views/triggers, or extra objects on the cohort also refuse removal. Reference scanning reuses the schema SQL lexer, so quotes inside comments or literals cannot hide executable references. It deliberately overblocks literal words and column names. A false positive needs source review; there is no force flag or name-prefix exemption.

One outer SQLite transaction rechecks the plan, removes objects through `applyOwnedMigrations`, verifies the exact table/schema reduction and unchanged retained logical state, and checks the owned receipt and database health. An injected failure after all removal DDL restores schema, counter data and receipts. Foreign-key enforcement stays enabled.

The commit receipt is the existing `piclaw_schema_migrations` row:

- owner: `host.historical-accounts`
- id: `offline-empty-v1`, order: `1`
- SQL checksum: `746a4c82365ce5a36baf333a86d4331c9272e9c812920652ab0c7743ba2bc09e`

`result.json` is a derived report, not another lifecycle authority. Application is intentionally single-use. After any failure preserve the directory; inspect the ledger before considering another action. A missing report does not prove rollback after a committed transaction. There is no automatic retry, replay, source replacement or restore.

The archive preserves the full original database for rollback qualification. It does not contain every external key, model credential, attachment file or configuration required by a complete recovery unit. Promotion and restoration remain separate operations. The SDK 1.4 format-2 compatibility restriction still applies.

## Focused qualification

Run only changed behaviour through the central isolation/priority launcher:

- `runtime/test/historical-account-retirement.test.ts`: fresh, historical empty/populated, unknown dependency/shape, approval/alias, rollback, current auth/owner/FTS, startup veto and typed/sparse-row backup cases;
- `runtime/test/schema-ownership.test.ts`, filter `safe-integer metadata`: identical constraint fingerprints with safe-integer metadata;
- `qualification/native/schema-ownership.test.ts`, filter `offline historical retirement`: real SDK family creation/read/reopen and approved add-on schema preservation.

No production store was inspected or changed. Table reduction is qualified from the approved object manifest; no large byte-saving claim is made.
