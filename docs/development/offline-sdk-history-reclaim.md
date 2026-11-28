# Reclaim SQLite space from an offline Durable store

`reclaim-offline-sdk-history.ts` removes one eligible conversation and its directly owned transcript, documents, tasks and submissions from a **new compacted copy**. It supports the exact **unprefixed `@earendil-works/pi-durable` 1.6.1** SQLite schema and migration ledger. It does not open the original in SQLite. [SDK issue #12641](https://github.com/earendil-works/pi/issues/12641) requests an upstream maintenance API.

## Run on a standalone SDK copy

Stop the owner and make a fully checkpointed copy using the store owner's backup procedure. Keep that closed copy in a canonical, owned, private (`0700`) directory and give the file mode `0600`. Retain the original and its checksum. Choose an exact non-root conversation ID using the SDK's inventory. The output must be a new sibling filename.

```sh
sha256sum /workspace/tmp/private-maintenance/source.sqlite
bun runtime/scripts/reclaim-offline-sdk-history.ts \
  --source /workspace/tmp/private-maintenance/source.sqlite \
  --output /workspace/tmp/private-maintenance/reclaimed.sqlite \
  --conversation-id 12345 \
  --expected-sha256 <approved-sha256>
```

The helper refuses runtime profile paths, symlinks, multiply linked inputs, sidecars, an occupied output, and input digest changes. It also refuses a target with ancestry or surviving dependants, nonterminal tasks, queued or placed submissions, unknown surviving entry/task/document kinds, and exact JSON identifier matches in surviving records. Those last checks are intentionally conservative and may reject a coincidental match. It does not search for or erase copies of text in another conversation, an artifact, an export, or a backup.

## Verification and publication

Erasure happens in a transaction on a private staging copy. `VACUUM INTO` builds the compact candidate. The helper checks SQLite integrity, that the target is gone, that survivor records are byte-equivalent at the row level, and that ID allocation metadata and the `record_ids` ledger are unchanged. It opens a separate probe copy using the public SDK in read-only mode to confirm it can reopen without starting work.

The final file is published without replacing an existing name. A normal receipt includes the source and output digests, the output size and counts by record type. Exit code `2` means an output was linked but directory sync or cleanup needs attention; inspect the receipt and verify the file before any reuse. Abort or refusal before publication leaves the source untouched and publishes no output. An abrupt process exit can leave a private staging directory; it is not a verified output.

**Do not use this command on Piclaw's application database or promote this output into a running instance.** The helper refuses Piclaw tables. Removing a Piclaw session still needs a coordinated offline operation for its routing manifest, host history, scheduled work and shared artifacts. The Classic delete action is unchanged.
