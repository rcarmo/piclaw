# Inactive copied-store rehearsal (#1650)

From the repository root (Bun, installed root Pi 1.2.0 and isolated candidate dependencies):

```sh
bun runtime/durable-engine/src/rehearse.ts \
  --source /isolated/copies/session.jsonl \
  --manifest /isolated/copies/manifest.json \
  --destination /isolated/rehearsals/new-store
```

Or from `runtime/durable-engine`: `bun run rehearse --source … --manifest … --destination …`.
This private application package is source-executed; it is **not** a packaged production CLI or a production switch.

The trusted caller must supply an actual copied v3 JSONL file and this exact manifest shape:

```json
{
  "version": 1,
  "sourceCopied": true,
  "expectedSourceSHA256": "<64 lowercase hex characters: SHA256 of the exact copied file bytes>",
  "pending": 0,
  "inflight": 0,
  "hostBranchBindings": {
    "<source leaf entry ID>": {
      "chatJid": "<original host chat ID>",
      "chatIncarnation": "<original host chat incarnation>",
      "branchId": "<original host branch ID>",
      "hostBaseline": "<explicit original persisted system instructions>"
    }
  }
}
```

Include **every** leaf, with unique original chat/incarnation/branch triples. This map is caller authority, not inferred identity. The baseline must be nonempty, persisted in the source, and equal to that leaf's current public SDK system context. External-only instructions cannot be reconstructed; do not invent a baseline or summary. Do not put credentials in the manifest.

## Boundaries

- Only the three shown flags exist. Unknown/duplicate flags, including `--force` and `--verify-only`, fail closed.
- Both source/manifest snapshots, the expected source digest, all bindings and the complete tree are validated **before any destination write**. Inputs are never written.
- Paths inside any `.pi` or `.piclaw` directory, the canonical active workspace state, or configured agent/store roots are refused, including symlink-resolved aliases. Copy files elsewhere first. `sourceCopied` is a caller assertion, not forensic proof of copying. This is not a sandbox against a malicious caller racing filesystem paths.
- The destination parent must already exist. The destination must not exist, even if empty or a previous rehearsal. Exclusive `mkdir` (0700) is ownership for this one process; no lease, lock expiry, takeover, deletion or resume policy exists.
- Interrupted/error runs leave an **offline incomplete** destination. Preserve it for manual investigation; use a different new directory to retry. The underlying public importer remains restartable, but this CLI deliberately does not reopen arbitrary existing stores.
- Only bounded, supported, quiescent history is accepted. Pending tool calls, unanswered user messages, tool-result-only endings and non-final assistant endings are refused even if the manifest claims zero pending/inflight work. Historical tool results are data, never replayed.
- The root Pi 1.2.0 public context functions and candidate SDK graph exchange detached JSON only. No `ModelRuntime`, host application bootstrap, auth/config runtime, provider, extension or tool is instantiated. Candidate models/registry are empty and credential resolution throws.
- The candidate harness remains paused, with no tasks or submissions. Import creates only conversations/entries/documents. It preserves original host identities in receipts; the engine's internal root ID is not a replacement host identity.
- After import, the CLI closes and **publicly reopens its own store within the same invocation**, verifying all leaf contexts, original entries, typed bindings and paused/empty work. Public storage open can normalize storage; this is **not read-only verification**. There is intentionally no standalone verification flag.

## Artifacts and errors

`rehearsal.sqlite`, `rehearsal.json` and `receipt.json` are private (0600 inside the 0700 destination). The marker starts `incomplete` and becomes `verified` only after successful reopen/verification/close. The receipt contains exact input digests, importer digest, original session/chat/branch identities, shared entry mappings and per-leaf context digests, **not prompts or baselines**. The SQLite store necessarily contains the copied private history. Keep the whole directory private.

Stdout is a JSON success summary with hashes/counts, never prompts, baselines or paths. Stderr is a fixed JSON failure category with exit code 1:

| Code | Action |
| --- | --- |
| `invalid_input` | Correct flags, manifest shape/UTF-8, quiescence assertions, or use copied paths outside active state. |
| `source_digest` | Recheck the caller's expected digest against the actual copied bytes. |
| `destination_exists` | Choose a different, nonexistent directory; the existing directory is untouched. |
| `import_unsupported` | Inspect unsupported/non-quiescent history, complete leaf identities and persisted/current system baselines. Do not truncate history to bypass validation. |
| `context_mismatch` | Keep the offline store for investigation; reopened evidence differs. |
| `storage_failure` | Check filesystem/storage availability; preserve any incomplete destination. |

Successful repeated runs use **different new destinations**. Identical inputs produce identical importer/context digests and receipts. No service restart, live profile access, network, model call, deployment or cutover is required or authorized.

Qualification (isolated local launcher):

```sh
bun run test:local --cwd qualification/pi-durable-130 -- bun test ./rehearsal.test.ts
```
