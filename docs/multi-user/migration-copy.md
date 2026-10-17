# Prepare an ownership migration copy

`piclaw access-migration` inventories an existing single-user database, prepares a reviewed version-five copy and promotes that copy into a separate startable family database. The source database, prepared copy, configuration, credentials, JIDs and session files remain unchanged until the operator explicitly installs the promoted database.

## Scope

The prepare command cannot convert a running deployment. The prepared copy retains its `single-user` activation value and gains an `access_migration_preparation` marker, which prevents startup. Do not remove the marker or edit activation values. After review, `promote-copy` clones the prepared copy into another new file, verifies version-five migration receipts and ownership, records an immutable promotion receipt and changes only that new destination to `family-shared`. Older releases may not recognise these records; never run an older binary against either copy.

The command writes `session_roots` ownership and `chat_branches.handle_owner_id` in one transaction. Plan versions add the following operations:

- Version 1 assigns owners and handle namespaces.
- Version 2 can also capture reviewed child JSONL files for later import.
- Version 3 adds the authentication, task and media rules below.
- Version 4 adds factor preservation and optional TOTP import for the default account.
- Version 5 adds holds for legacy inputs.

All versions preserve message content, names, IDs, archive state, account roles, enabled state and homes. The command cannot create users or homes, rename colliding handles, overwrite confirmed factors, map non-web services, execute or rewrite queued messages, install session directories or retire browser caches.

Unregistered chats, broken/cyclic/cross-root parent chains and non-web roots are quarantined in the preview and block preparation. This command cannot override quarantine. All registered roots, including archives, need an explicit existing owner. Existing ownership cannot be transferred. Account homes must remain active roots owned by that account; enabled accounts need a home. Handle collisions are checked case-insensitively within each owner's active namespace; resolve them explicitly before reviewing another preview.

## Offline workflow

1. Confirm the host, workspace/store paths and release. Use the service manager configured for that host.
2. Stop Piclaw and all other writers. Prevent automatic restart while reviewing/preparing the copy. Retain a coordinated backup of configuration, the original database and key material, session files and other state. The database snapshot made here does not include external files or keys.
3. Create an owner-only `0700` directory for the inventory, reviewed plan and destination. Use new filenames. The command rejects existing destinations, symlinks and unsafe directories.
4. Generate the preview:

   ```sh
   piclaw --workspace /path/to/workspace access-migration preview \
     --output /path/to/private-migration/inventory.json
   ```

5. Review `users`, `branches`, `owners`, quarantined records and resource counts. The preview contains no transcript or credential contents. Copy **only the `plan` object** to `reviewed-plan.json`, preserving its version and snapshot. Fill each null `owner_user_id` with the intended immutable account ID. Unowned roots are never auto-assigned to `default`; existing owners are prefilled and cannot be changed.
6. Prepare the copy with both acknowledgements and the exact confirmation:

   ```sh
   piclaw --workspace /path/to/workspace access-migration prepare-copy \
     --plan /path/to/private-migration/reviewed-plan.json \
     --destination /path/to/private-migration/prepared.sqlite \
     --writers-stopped --backup-set-confirmed \
     --confirm 'PREPARE OWNERSHIP COPY'
   ```

The plan must be a regular non-symlink JSON file up to 1 MiB. Version 1 has exactly `version`, `snapshot` and `assignments`; later versions add the fields specified below. Each assignment has only `root_chat_jid` and `owner_user_id`. Missing, extra, unknown or duplicate mappings fail. The fingerprint detects changes to access state, users and homes, topology, handle namespaces, existing owners, resource counts and SQL schema. It does not grant permission or hash every stored message.

The command acquires the workspace maintenance lock even when the runtime-lock environment override is set. Every existing lock path, including empty, malformed and stale records, blocks acquisition unchanged. Follow [offline operator cleanup](operator-recovery.md#existing-runtime-locks) before retrying; the command never removes an existing lock. It opens the existing source read-only, performs no schema initialisation, creates a verified WAL-inclusive SQLite snapshot, checks source `data_version` and inventory again, then validates and applies assignments transactionally in the copy. The destination is `0600` in the private directory and receives a final integrity check. Output reports counts and paths only. A normal failure removes only the newly created partial destination and releases the lock; source state is never edited.

## Promote the reviewed copy

Promotion supports only a freshly prepared version-five copy with no pending child sessions and matching resource, factor and legacy-input receipts. Configure the offline workspace explicitly for `family-shared`, keep all writers stopped and retain the original coordinated backup. Use the exact `snapshot` printed by preview/preparation:

```sh
piclaw --workspace /path/to/offline-workspace access-migration promote-copy \
  --prepared /path/to/private-migration/prepared.sqlite \
  --destination /path/to/private-migration/promoted.sqlite \
  --source-snapshot <reviewed-lowercase-sha256> \
  --writers-stopped --backup-set-confirmed \
  --confirm 'PROMOTE FAMILY COPY'
```

The prepared file and source remain byte-for-byte unchanged. The destination must not exist or be the configured live database. The command requires owner-only files/directories, the maintenance lock, explicit family configuration and an exact reviewed snapshot. It creates a verified SQLite clone, promotes that clone transactionally, verifies it again and emits counts/paths only.

To install, stop all writers, retain the current single-user database/configuration/key/session backup, place the promoted database at the configured store path with owner-only permissions, install matching explicit `family-shared` configuration, then restart through the host's normal service manager. Piclaw revalidates the immutable promotion receipt and ownership at every startup. This command does not install, restart or activate the running instance.

## Rollback

Stop all writers. Restore the original single-user database, matching single-user configuration, credentials/keys and session files together, then restart through the normal service manager. Do not switch only the config, edit markers, reuse a prepared copy as a live database or point an older binary at a promoted family database. Any family-only work created after installation is absent from the original backup; export or retain it separately before rollback when required.

## After preparation

Keep both the prepared copy and original backup for review/rollback. Do not point the service at the prepared copy. Children omitted from an adoption list have no fork-provenance records and block promotion. Versions 1–4 remain review artifacts; only version 5 is promotable. The preparation marker prevents startup in both single-user and family mode.

## Authentication, tasks and media disposition

For this additional copy-only stage use `version: 3`, keep `child_sessions` (an empty array is valid), and add exactly:

```json
"resource_policy": "revoke-logins-pause-tasks-quarantine-media-v1"
```

This value selects one policy; its individual operations cannot be disabled. Review the `resources` counts and fingerprint in a fresh preview before approving it. The snapshot includes links between messages, threads and media; scheduler statuses and revisions; cursor state; and temporary authentication records. It exports no message contents, queued payloads, bearer tokens, media metadata or provider keys. Changes to links and statuses invalidate the fingerprint even if row counts stay the same. Changes to message text are not covered by this resource fingerprint.

In the destination transaction:

- Delete all copied browser logins, pending TOTP/self-TOTP/passkey ceremonies, invitations and legacy WebAuthn enrolments. Preserve confirmed TOTP ciphertext/replay state and passkey credentials/handles unchanged; legacy-factor conversion and key coordination remain separate requirements.
- Delete copied unowned legacy tool-output metadata and FTS chunks, recording only the count in the migration report. Their external log files are not read or removed; retain or dispose of them through a separate protected operator procedure. Scoped family rows are invalid in a single-user source and block preparation.
- Pause every active scheduled task in both `scheduled_tasks` and the durable scheduler authority head. Preserve task payload, revision, next-run time, completed history and already-paused/completed status. This does not assign a user owner or permit resumption in family mode.
- Insert `migration_media_quarantine` rows for unlinked blobs, unresolved stored message links and blobs linked across mapped owners. Preserve bytes and links, including for quarantined media. Same-owner links across roots remain usable after normal ownership checks. The family media authoriser denies a quarantined ID even if a new owned link is added; there is no automatic unquarantine API.
- Record policy, source snapshot, counts and excluded surfaces in `access_resource_migration`. Keep the non-startable preparation marker intact.

Preparation refuses cursor markers for in-flight runs, preflight work or compaction, and any queued follow-up payload. It also refuses unresolved scheduler runs; active operations, wake intents, sources or queued inputs; pending, started or unknown outbox deliveries; and failed deliveries scheduled for retry. Messages with unregistered chats, invalid or cross-chat thread references, and missing or mismatched scheduler heads also block preparation. Stopping a process does not settle its queued work. Resolve these records through their supported workflows before taking another preview.

Unconsumed legacy user messages are counted and retained without new execution grants or cursor movement. Version 5 adds the hold and dismissal actions below. The command excludes shared keychain and provider credentials, push subscriptions and recordings stored in files, generic add-on state, external tool-output files and ambiguous thinking records. It does not read their secrets or classify every indirect media reference. Raw content blocks may still contain historical references; family media requests check quarantine by ID. Migration of the excluded resources and notification recipients is unfinished.

Any disposition failure rolls back ownership, seed capture, revocation, task pausing and quarantine together in the copy; CLI cleanup removes only the new failed destination. The live source remains unchanged. Paused tasks and quarantined media must not be re-enabled by manually editing the marker or records.

## Factor preservation and optional legacy TOTP import

Use `version: 4`, retain the version-three resource policy and `child_sessions`, and add exactly:

```json
"factor_policy": {
  "passkeys": "preserve-immutable-handles",
  "legacy_totp": "none"
}
```

The command checks credential owners, base64url encoding of credential IDs and public keys, RP metadata, non-negative counters, transports and confirmed TOTP record structure. It leaves every existing passkey byte, user ID, RP ID, signature counter, label and timestamp unchanged. The legacy WebAuthn user handle stays `default`; renaming that account never transfers credentials. Unknown owners or malformed records stop preparation. The preview returns factor counts and an opaque fingerprint, with no credential IDs, public keys, ciphertext or seed hashes. Changes to factor bytes or counters invalidate a reviewed plan.

Existing confirmed TOTP factors remain encrypted under their original bootstrap material, including replay state. This stage validates record shape but does not prove that the supplied bootstrap key decrypts every existing factor. Verify restored credentials separately before any future activation; coordinated key rotation remains a different operation.

If the old single-user authenticator seed must be retained, set `legacy_totp` to `import-default` and provide `--legacy-totp-file /private/path/legacy-factor.json`. The file must be a regular non-symlink file owned by the invoking user, with no group/other permissions, at most 4 KiB. Its JSON must contain only `secret` (uppercase base32, 16–128 characters) and `code` (current six-digit authenticator proof). Keep both values out of the reviewed plan, command-line arguments, stdout, transcripts and logs. Create the file through a protected operator workflow, never a shell command containing the plaintext seed. The CLI does not infer it from global config or keychain listings, and does not delete the operator's input file automatically.

Import is allowed only for the immutable `default` account when it has no confirmed per-user TOTP factor. The command requires TOTP-enabled policy and the existing bootstrap encryption key. It verifies the code with bounded clock skew, encrypts using the existing user-bound AES-GCM/PBKDF2 format, checks the proof again after encryption and supplies ciphertext to the copy transaction. The prepared import expires after five minutes if it has not been committed. Committing it consumes the proof timestep and cannot replace a pre-existing factor. It neither enables an account nor issues a login. A code from that timestep cannot authenticate again; after a future supported activation, use a code from a later timestep.

Missing/unexpected secret files, wrong/expired codes, malformed records, missing key material, concurrent source changes or SQL failure abort without a partial destination. Raw input buffers are cleared and parsed secret references dropped after encryption; JavaScript strings cannot promise secure memory erasure. Protect the process and original input file accordingly. The destination transaction includes resource dispositions, optional import and an `access_factor_migration` count-only report. Source configuration and its old global TOTP seed are not removed or rewritten.

Factor import cannot reset or transfer credentials, start Piclaw in recovery-only mode or rotate encryption keys. The prepared copy cannot start. Physical-device testing and migration of legacy browsers and services remain operator responsibilities before installation.

## Legacy input holds

Version-five plans retain `resource_policy`, `factor_policy` and `child_sessions` and add exactly `"input_policy": "hold-legacy-inputs-owner-dismiss-v1"`. In the copy transaction, all unconsumed non-bot messages beyond their stored chat cursor receive immutable `migration_input_holds` records with row ID, original message/chat/timestamp, mapped owner and content hash. The command does not fabricate an actor/login, insert normal admission authority, alter original author/content or advance a cursor. A mixed input already carrying execution authority fails preparation for separate reconciliation.

The family admission reader always denies a held legacy message, even if a normal authority record is later supplied. The normal recovery status reports `legacy-held` for the oldest such input selected by dequeue. Legacy slash-command, assistant-prefix and steering exclusions remain unchanged; excluded historical messages are never promoted into executable prompts. Inputs without explicit migration holds remain blocked by the existing missing-authority checks.

The owner can explicitly confirm `dismiss-legacy` after recent authentication. The operation runs on the same chat lane as processing, checks live ownership/idle state/original hash and appends an idempotent `migration_input_dismissals` record. It leaves history and the timestamp cursor untouched. Row-specific filtering removes that dismissed input from future family dequeue, avoiding accidental skips of different inputs with the same timestamp. Ordinary single-user query behaviour ignores this filter. There is no retry/re-admission action for the old row.

To run a prompt from old history, the owner must review it and send a new supported plain-text message. Dismissal does not prefill, copy or submit content, and it preserves the original author. The browser shows the legacy hold separately, hides Retry, requires confirmation and reuses the request key for unchanged manual retries. Losing focus, navigating away or changing accounts clears the controls. Late responses cannot restore the previous account's state.

This policy does not handle live durable scheduler/outbox work, which blocks version-three-and-later preparation. It does not reactivate stopped workers, rewrite service grants or make the prepared copy startable. Unsupported transports and automatic workers stay disabled in family mode.

## Explicit child-session capture

For a legacy child with an existing session file, use plan version 2 or later and include `child_sessions`, an array of exact `{chat_jid,file,sha256}` records. `file` is the absolute path to the selected child JSONL; `sha256` is the reviewed hash of its complete contents. The command does not choose a file for you. Check that the selected history belongs to the intended child and owner. The hash detects changed bytes but cannot establish who owns their content.

Each file must be a regular non-symlink `.jsonl` in the child's exact `DATA_DIR/sessions/<sanitised-jid>` directory. Ambiguous sanitised directory names reject. The header must identify version 3, the source workspace, and a parent-session file in the registered parent's expected directory. Pending `.branch-seed.json` or `.branch-seed.claimed.json` blocks adoption; resolve it through an independently reviewed workflow. Roots, unknown children and children with existing fork-operation provenance cannot be adopted again.

Capture is bounded to 8 MiB and 25,000 entries per file, 100 children and 32 MiB total. The parser requires unique entry IDs, backward-resolvable parent links, known entry types, valid labels/compaction references, stored model/thinking and a completed assistant boundary with matched tool calls/results. It rejects incomplete/trimmed legacy trees and unsupported versions rather than repairing them silently. Source files are re-read and hash-checked after the database snapshot. No source file is modified.

In the destination transaction, each captured child receives an `owned_fork_operations` record with its real parent, owner and an `adopted_jsonl` seed containing the exact JSONL and hash. `materialised_at` stays null. The copy remains blocked by its preparation marker. This is conversation data: protect the database and backups accordingly. CLI summaries contain counts, not captured messages.

The gated family first-use path checks owner/source authority before importing the captured seed through the SDK, without loading an unverified legacy file first. Import preserves the original tree entries, labels, custom entries, model and thinking level. The latest registered friendly name wins. The runtime persists and reopens the imported session before clearing the seed; errors/revocation retain it for retry and dispose the failed runtime. A cold reopen uses the imported file and does not replay a completed adoption. Temporary import files are removed. Original JSONL archives are not a substitute for complete migration and remain part of the coordinated backup.

Multi-file selection, unsupported/trimmed versions, pending file seeds and cross-directory parent histories are unsupported. Promotion requires every registered child to have reviewed adoption evidence and does not confer authority to another account.

A crash can leave a partial destination because filesystem creation and SQLite commit are not one transaction. Treat any output without an independently verified preparation marker/integrity check as incomplete. Never overwrite or reuse an uncertain destination; choose a fresh path. Keep the source unchanged and rerun a fresh preview if any relevant source metadata changed.

The maintenance lock excludes cooperating Piclaw processes. Check separately for external readers and writers; privileged processes can bypass the lock. Later source changes are not copied into the prepared database. The command has been tested on fixtures; no live migration or restart was performed. Unsupported child histories, external resources and automatic workers must be removed or kept outside the family deployment.
