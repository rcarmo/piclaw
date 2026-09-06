# Memory bootstrap selection

The built-in `workspaceMemoryBootstrap` hook selects files from the current configured workspace on every invocation. Family and isolated deployment startup remains gated; this boundary is covered by disposable tests, not a live migration or activation.

## Single-user compatibility

With valid single-user configuration, legacy callers without execution identity keep `notes/memory/MEMORY.md`, `notes/index.md` and optional `notes/preferences/agent.md`, including existing missing-file and truncation behaviour. An explicitly supplied single-user default-account identity uses those same paths and retains its runtime identity label. A stale family identity in single-user mode cannot select family files or fall back to legacy memory.

## Family sources and authority

Family mode requires a matching immutable runtime execution identity, provenance and optional preference snapshot. The source chat, live account, role, original root and login or private scheduled-dispatch authority must validate before any memory read. Absent identity, unsupported isolated mode, malformed configuration, wrong chat/root/role and revoked authority reject the hook. Scheduled work uses the existing durable dispatcher checks and does not require its owner's old browser login.

Only these fixed paths are selected:

- `notes/users/<immutable-user-id>/MEMORY.md` — selected owner context;
- `notes/users/<immutable-user-id>/preferences.md` — selected owner preferences;
- `notes/family/MEMORY.md` — separately labelled shared family reference.

The owner ID comes from runtime identity, not username or message text. Missing or unreadable files remain missing; they never select another user or legacy global notes. Each family file retains its 8,000-character output cap. The existing reader reads the full file before truncating; this change does not add file-size or filesystem resource limits. Account response guidance retains its per-run immutable snapshot.

Mode, workspace and identity are rechecked around reads and before returning the assembled system prompt. An observed denial is latched for that invocation, even if configuration changes back inside optional-file handling. Read errors cannot swallow an authority denial. No filesystem writes, shared publication, search-index refresh, model call or timer is added.

## Limits

Memory text is labelled reference data, not identity or permission authority. Family reference is not automatically attributed to the selected owner. The hook does not recursively load linked notes or publish personal context into shared memory. This is automatic prompt-source selection, not filesystem confidentiality: explicit permitted reads, symlinks, writable shared code and privileged installed extensions remain within the shared-machine trust boundary.

The SDK may catch extension-hook errors and continue without this hook's addition. This change guarantees that denied bootstrap text is not returned; it is not a new model-cancellation boundary. The runtime's existing admission and scheduled-scope checks still govern execution. Shared-index selection is described below. Other system-prompt extensions, per-user Dream source/output coordination and explicit shared-memory publication require separate integration before family activation.

## Shared-family index

Trusted internal workspace-index APIs use separate `family_workspace_*` tables in configured family mode. Their only roots are `notes/family` and `.pi/skills`, with `notes` and `skills` scopes selecting the respective root. Configured extra roots, `notes/users`, legacy personal notes and the global single-user index are never searched or imported into the family index. Empty family tables stay empty until an explicit refresh; a ready legacy index cannot satisfy family status or return stale personal snippets. FTS and syntax-error LIKE fallback query only the family tables and fixed-root paths, before pagination. Operational database errors return failure rather than silently changing query semantics.

This profile does not grant a family model or browser a workspace-search capability. Index APIs reject execution identity in family mode; background callers without an execution context remain trusted internal code. Isolated and malformed modes deny. Valid single-user callers keep the existing configured roots, tables and search behaviour. Mode, workspace, identity and database checks prevent a running refresh from continuing into a different profile after an await. The background launcher passes resolved workspace/store/data and its expected mode; a changed-mode child rejects before database initialisation. No timer or automatic family startup is introduced.

Family refresh stages at most 2,000 files and 32 MiB, visits at most 20,000 directory entries to depth 16, and checks a 30-second elapsed-time budget between filesystem operations. It streams directory entries, accepts a fixed text-extension set, and bounds individual files by the requested 16–2,048 KiB limit (512 KiB default). Symlink roots/directories/files and hard-linked files are excluded; opened files must be regular, single-link and unchanged across a bounded read. Missing roots are empty. Other read/decode/limit failures discard staging and preserve the prior snapshot. The elapsed-time budget cannot interrupt an already blocked filesystem operation.

Scope replacement and ready status commit atomically. A persisted generation compare-and-swap rejects staging superseded by a source-change notification or another refresh, including another process. Partial refresh invalidates aggregate freshness without marking the unrelated scope stale. Local refresh coordination is workspace-scoped and released in `finally`; no failed-status write occurs after authority denial. Explicit filesystem changes without a notification still require a fresh refresh; this is not a filesystem-wide atomic snapshot.

The legacy tables are neither erased nor migrated. This separates automatic source selection, not filesystem confidentiality: a privileged process can race ancestor replacement or edit shared source/SQL, and permitted explicit reads still access shared files. Per-user search indexes, Dream integration and deployment acceptance remain separate work.

## Explicit publication ledger

The `db/family-memory.ts` control-plane APIs copy an explicitly confirmed, verbatim message excerpt into a separate SQLite publication ledger. They require configured family mode and a live account login; preview, publication and withdrawal also require authentication within five minutes. Model execution contexts, service grants, absent identity and other modes cannot call these APIs. The HTTP API below backs the [browser confirmation panel](user-guide.md#family-memory-publication); no filesystem projection, prompt injection or Dream consumer uses this ledger yet.

Preview requires an exact message row ID, message ID and active owned chat. It returns at most 100 KiB of text with a hash binding content, source metadata, branch, root and owner. Publication requires that unchanged hash, a non-empty verbatim excerpt of at most 16 KiB, a UUID request ID and `confirm: true`. Media, structured blocks and thinking content are never copied. Ownership permits selection; it does not prove the publisher authored the message or that its claims are true.

The transaction records the immutable publisher ID, current username/display-name snapshot, original approving login, source identifiers/hash and copied text/hash. Same-owner exact retries return the original publication ID without relabelling it, even after source editing, archival or deletion. They acknowledge the existing copy and never read or republish the source. Changed request payload or withdrawn publication denies; another account, including an administrator, cannot publish from that source. New request IDs are independent publication requests and require a live unchanged source matching the preview.

Shared reads return the newest 20 non-withdrawn copies, ordered by publication time and ID. They expose only copied text, publication ID/time, publisher attribution and the `message-excerpt` source kind. Private chat/message IDs, source hashes, login/request IDs and unselected text stay outside the shared projection. The owner can inspect the historical receipt, including source identifiers, after source archival or deletion. Name changes do not relabel existing publications; source edits, deletion and publisher disablement do not silently erase already shared copies.

Only a recently authenticated publisher can withdraw a copy, including after source archival or deletion. Withdrawal is append-only and idempotent, removes the copy from future shared reads and prevents publication retry from resurrecting it. It cannot retract earlier downloads, filesystem copies or provider context. Publication and withdrawal records are immutable and retained; this slice has no erasure or retention policy.

Immediate SQLite transactions serialise publication/withdrawal and enforce retained-history limits of 100 copies per publisher and 1,000 globally, including withdrawn copies. Exact retries do not consume another slot; withdrawal does not free a slot. A full ledger rejects new publications until a separately reviewed retention mechanism exists. There are no concurrent shared-file edits because these APIs write no files. Legacy memory, transcripts, cursors, search indexes, timers and startup gates are unchanged. Shared filesystem/SQL-capable processes remain privileged. Per-user Dream coordination, file projection, consumer integration and browser confirmation need separate implementation and review.

## Publication HTTP API

The family-only dispatcher recognises these exact routes. All require a live family cookie and matching `x-piclaw-account-id` and `x-piclaw-login-id`. They accept no query parameters, including owner, chat, limit or pagination selectors. GET requires a live login; every POST also requires recent factor authentication, a matching Origin and `application/json`.

| Method and path | Request / response |
|---|---|
| `POST /agent/family-memory/preview` | Exact `{chat_jid,message_rowid,message_id}`; returns those identifiers, owned source text and source hash without writing a record |
| `POST /agent/family-memory` | Exact `{chat_jid,message_rowid,message_id,source_hash,text,request_id,confirm:true}`; returns publication ID, echoed request ID and `created`; 201 first publication, 200 exact receipt retry |
| `GET /agent/family-memory/own` | Newest-first complete owner history, at most 100 entries: publication ID, request ID, time and withdrawn flag; no text/source/login metadata |
| `GET /agent/family-memory/<publication-id>` | Owner-only copied text and historical source receipt; includes withdrawn copies and inaccessible original sources |
| `GET /agent/family-memory/shared` | Newest 20 non-withdrawn copies with publisher attribution, without private source/login/request identifiers |
| `POST /agent/family-memory/<publication-id>/withdraw` | Exact `{confirm:true}`; returns publication ID, `withdrawn:true` and `created`; 201 first withdrawal, 200 repeat |

Preview, publication and withdrawal each have independent limits of 20 requests per minute per account, so preview/publication cannot exhaust withdrawal's allowance. The three GET routes share 60 reads per minute per account. Account limits cover all its login sessions. Rate rejection returns 429; no automatic retry is added.

Body limits are 4 KiB for preview, 128 KiB for publication and 1 KiB for withdrawal, measured as encoded UTF-8 JSON. The larger publication envelope permits JSON escaping but does not increase the ledger's 16 KiB excerpt limit. Body reading has a 10-second deadline, rejects malformed UTF-8, invalid JSON, wrong shapes, overflow and aborts, and releases the reader. Account/role/login, configured mode, workspace/store/data paths and database connection are checked around every body read and before the ledger operation. An observed denial is permanent for that request; a replacement login/database cannot become its authority. Changes that occur and revert entirely between checks are not observable.

The router returns 401 without a live family login, 409 for supplied stale/partial browser pins, and 403 for absent pins, denied authority or invalid route/input. Unexpected ledger failures return a generic 500 without logging their error payload. Responses are private/no-store and vary on Cookie. Publication response loss can be reconciled through the owner history and exact request ID, including after source archival/deletion; a retry acknowledges the existing receipt without republishing. Withdrawal prevents resurrection by retry. A client that loses its request ID must inspect history before creating another request.

No SSE, notification, model/queue call, automatic refresh, search-index change or shared-file write follows these requests. Consumer integration, per-user Dream and deployment activation require separate work. Shared copies are reference data and must never be interpreted as runtime identity or permission grants.

The family timeline adds `memory_source` only to its already-authorised message rows with non-empty source text up to 100 KiB. It contains the exact chat, row and stable message ID for preview; it grants no publication authority. The preview API independently validates the live source and returns a hash before confirmation. Single-user timeline responses are unchanged.

The panel uses text-only rendering, fixed owner/shared endpoints and in-memory drafts. It starts with no excerpt or confirmation selected. Successful requests are identity-revalidated before rendering. Publication freezes the exact request on uncertainty; manual retry requires fresh confirmation. Close, refresh, shared view, inspection, another source, blur, session switch and navigation clear drafts and retry identity. Reopening an already visible panel preserves a pending retry. Returning from blur exposes only an empty panel until an explicit read. Withdrawal uses separate confirmation and may run during an unrelated send without releasing its lock. No automatic memory refresh or browser storage is added.
