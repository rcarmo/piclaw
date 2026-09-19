# Local note retrieval: access, freshness and citations

Status: proposed prerequisite contract for [#1345](https://github.com/rcarmo/piclaw/issues/1345), under [epic #1347](https://github.com/rcarmo/piclaw/issues/1347).
Source baseline: `0ea661493ef46cf24d5b03dbaa641a434e28a237`.
This change adds documentation only. `memory_query`, `memory_get` and the chunk index are not implemented or enabled by this PR. Acceptance requires review and merge; downstream work must satisfy the proposed rules below.

## Decisions

1. The first release admits new note tools only in single-user mode. Existing family index/bootstrap behaviour is unchanged.
2. Markdown under the trusted workspace's `notes/` is source data. Index tables are disposable derived data with their own migration owner and namespace.
3. A citation identifies exact bytes and their original line range. Edits invalidate old references; lookup never follows a guessed replacement passage.
4. Query/get validate selected source files before returning note content. Index age alone cannot establish freshness.
5. Refresh uses existing background coordination and explicit mutation/Dream triggers, with bounded external-change reconciliation. No new autonomous writer or separate scheduler.
6. Atomic per-file replacement, source generations and admission checks prevent mixed revisions and cross-mode publication. A scan is not a filesystem-wide snapshot.
7. Resource ceilings are finite. Ranking quality and deployment performance thresholds belong to prerequisite [#1346](https://github.com/rcarmo/piclaw/issues/1346).

## What exists at this baseline

| Surface | Present behaviour | New work still required |
| --- | --- | --- |
| [Search](../../runtime/src/workspace-search.ts) | File-level FTS5/BM25, notes/skills scopes, sanitised queries and fallback | Section records, citation references, freshness on content delivery |
| [Index core](../../runtime/src/workspace-index-core.ts) | Walks roots, skips equal rounded mtime/size, prunes deleted files | Content revision checks, atomic chunk replacement, external-edit reconciliation |
| [Index process](../../runtime/src/workspace-index-process.ts) | Background process, active-child guard, pinned expected mode | Integrate bounded dirty-work handling; ready state must not suppress overdue reconciliation |
| [Workspace mutations](../../runtime/src/channels/web/workspace/service.ts) and [Dream](../../runtime/src/dream.ts) | Mutation invalidation and post-Dream refresh | Cover note tool writes and external/shell changes without assuming notification |
| [Index access](../../runtime/src/core/workspace-index-access.ts) | Pins mode/workspace/execution identity; denies family model contexts | New tool admission and database/namespace binding |
| [Family index](../../runtime/src/family-workspace-index.ts) | Separate shared tables/fixed roots; bounded staged refresh and generation CAS | No new family retrieval capability in this first release |
| [Bootstrap](../../runtime/src/extensions/workspace-memory-bootstrap.ts) | Existing global or selected-owner memory sources; authority checks | Preserve it; add guidance only in #377 |

Source takes precedence over stale overview wording: [access-state.ts](../../runtime/src/db/access-state.ts) admits explicitly configured family mode after promoted-store validation. It rejects isolated-container activation. Some existing overview docs still describe both modes as gated. This prerequisite changes neither startup rule. The new note tools are denied in family mode even on an otherwise valid family deployment.

## Access matrix

The matrix below governs **new note tools/index APIs**, not every existing file or search tool. No browser route is added by this epic.

| Configured mode and caller | New query/get | New index mutation | Roots |
| --- | --- | --- | --- |
| Single-user, admitted model tool call with server-owned single-user/default-account identity | Allow within tool grants and output limits | Tool may request bounded refresh, never supply file content or SQL | Fixed local note root below |
| Single-user, legacy model tool dispatch with no execution identity | Allow only through the registered tool execution closures specified below | Tool requests the same coordinator-owned refresh boundary | Same root |
| Single-user, trusted background coordinator without execution identity | No content-returning query/get entrypoint | Allow bounded refresh/rebuild through the private coordinator API specified below | Same root |
| Single-user with stale family identity, malformed identity or invalid default-account/chat binding | Deny before reading caller selectors or notes | Deny | None |
| Family-shared model, browser, account-admin or delegated caller | Deny | Deny | None |
| Family-shared trusted background code without execution identity | Deny new APIs; existing `family_workspace_*` APIs retain their current policy | No new note-chunk store reads or writes | Existing family index only: `notes/family`, `.pi/skills` |
| Isolated-containers, malformed configuration or mode/store mismatch | Deny | Deny | None |

Absence of execution identity is not a trust flag. The only admissible no-identity query/get path is the future `execute` closure registered for each tool in `runtime/src/extensions/memory-search.ts`, invoked through the existing tool dispatcher with a real extension context and captured chat binding. It must check active tool grants and configured single-user mode before calling a module-private content reader. Do not export a raw no-identity query/get API or accept a request field selecting internal trust. The only no-identity writer is a private coordinator operation called by the existing `runWorkspaceIndexProcessFromArgs` worker after its expected-mode/root checks; startup, mutation, Dream and tool handlers may enqueue that operation, not invoke an alternate writer. Rebuild is an explicitly reviewed internal maintenance invocation through that same coordinator, without a new HTTP route. These are proposed wiring restrictions for #376/#387; the current generic index helper's absence-of-identity check is insufficient on its own. Preserve existing tool admission and apply the memory bootstrap's stricter identity/default-owner/chat checks when an execution identity is present.

For each operation, pin the access mode, canonical workspace/store/data roots, database instance, retrieval namespace and captured execution identity. Validate at entry, around each awaited I/O, inside the write transaction and immediately before returning content. An observed failure is latched for the invocation; a temporary reversion does not restore access. Checks cannot detect a change that happens and reverts entirely between observations.

Authorisation precedes chunk lookup, file-existence checks and detailed errors. A denied response contains no note path, heading, snippet, owner ID, row count or existence oracle. Chunk IDs, note headings and model text never confer authority. Existing raw file access/host privileges are outside this tool boundary.

## Roots and filesystem admission

- Resolve the workspace through runtime configuration. The only first-release input root is `<workspace>/notes`; callers cannot supply roots, absolute paths or a different workspace. Existing configurable `search_workspace` roots are unchanged.
- Admit regular UTF-8 `.md` files only. Exclude `notes/users/**` and `notes/family/**` from the new single-user index, even if those trees remain on disk after a mode change. This conservative exclusion is specific to the new capability.
- Skip hidden subdirectories/files and `.git`, `node_modules`, `.cache`, `generated`. Never scan transcripts, keychain/config files, attachments or skill roots as part of this note index. Missing `notes/` yields an empty initial snapshot; arbitrary read errors do not mean an empty workspace.
- Reject symlink roots, traversed directories and files, hard-linked files, non-regular files, invalid UTF-8/NULs and escaping paths. Use canonical containment, link-aware checks and bounded open/read operations. Only normalised workspace-relative `notes/...` paths leave the service.
- Supplied selectors cannot contain absolute paths, `..`/`.` components, backslashes or NULs; URL decoding belongs to any future transport boundary and cannot turn a validated selector into another path. IDs are looked up only in the pinned namespace.
- Detect replacement/in-place edits by verifying the open handle's identity, link count, size and timestamps before/after read, and the named path's identity before publication/return. Digest the bytes actually read. Abort if an observed ancestor/root/path changes.

These checks protect supported application boundaries, not against a privileged writer who can modify the process, SQLite or shared filesystem between checks. No claim of OS confinement or atomic protection from every ancestor-renaming race. Network-filesystem I/O may block beyond a cooperative timeout; deployment support must state that limit.

## Byte and chunk identity

A new store namespace is an opaque, persisted random identifier bound to canonical workspace/store/data roots, access mode and index-format version. Namespace records contain no user-supplied authority. A different root/mode/format cannot reuse cached rows; mark the index unavailable and rebuild into a new namespace. A normal process restart preserves a compatible namespace. Explicit rebuild, restoration into another location or incompatible migration invalidates old references. Restoring a compatible backup at the same binding may retain the namespace only after source validation.

- `source_revision`: SHA-256 of the complete original file bytes, including line endings and any BOM. A byte change anywhere in the file invalidates all that file's chunk references. Metadata alone cannot establish equality.
- `chunk_id`: `nr1:` followed by lowercase SHA-256 hex of the UTF-8 `JSON.stringify` encoding of `[namespace, normalised_relative_path, source_revision, chunker_version, first_byte, after_last_byte]`. The first four fields are strings; offsets are non-negative safe integers, with an exclusive upper bound. No whitespace or Unicode normalisation is added. Publish cross-platform golden vectors in #376. IDs are deterministic within a namespace and never secret capabilities.
- `heading_path`: ordered source headings for display/ranking. It is not a unique selector: repeated headings are valid.
- `line_start`/`line_end`: one-based inclusive original-source line numbers for the exact byte slice. LF and CRLF each delimit one line; a final newline does not create an extra cited line. No source normalisation before hashing/range calculation. Reject malformed decoding instead of replacing characters.
- Chunk boundaries retain complete source lines. Split oversized prose at heading/paragraph boundaries, then line boundaries; a single line or fenced block that cannot fit is handled by the exclusion policy below. Do not split fenced blocks or silently drop part of them.

Changing a heading, inserting a paragraph above a chunk or editing an unrelated part of the same note yields new IDs. Moving/renaming a file is deletion plus creation, without fuzzy redirect. Deleting a note removes its live chunk references. Restoring exactly the same bytes at the same path and namespace can reproduce an ID; this first release identifies content, not an immutable history of file incarnations.

Query results carry a reference tuple `{chunk_id, source_revision}` plus path, heading ancestry, line range, bounded snippet, index generation and validation timestamp. #387 must require both fields for `memory_get` and ensure they match the stored record. Path/range direct selectors and heading-only selectors are excluded from this first release; #1345 explicitly allows narrowing that optional #387 surface. A later API proposal can add revision-bound selectors without introducing unrestricted reads.

## Query/get consistency and outcomes

A query searches one committed database generation. It then validates source bytes for the bounded candidate set, groups work by path, and returns only candidates matching their stored revision and admitted file identity. Derive the snippet from that verified slice. Recheck namespace/access and affected per-file generation before returning. Do not write note text or run a synchronous full scan on the ordinary query path.

`memory_get` resolves the supplied reference in the current namespace, opens that exact path safely and verifies bytes/ranges before returning the full bounded chunk. It neither searches for another paragraph nor returns old indexed text as current. On success, report `validated_at` and the index/source revision used. The guarantee holds at the operation's final validation point; an external edit after that point cannot be prevented or retroactively withdrawn from a tool result.

| Outcome | Meaning and response |
| --- | --- |
| `ok` | Verified current source slice and authority; query has `completeness: complete` for the last completed scan under the admitted-source policy; zero matches is a snapshot-scoped no-match, not knowledge of all subsequent external edits |
| `partial` | Query only: zero or more verified hits with `completeness: partial` and reasons; zero means no verified match under incomplete coverage, not definitive no-match |
| `access_denied` | Admission or observed authority/binding failure; no note-derived metadata/content |
| `invalid_request` | Admitted caller supplied malformed query/reference or exceeded argument limits; no file read |
| `not_found` | Well-formed reference has no live row in this namespace; includes pruned/deleted/moved references; no historical tombstone service or cross-namespace lookup |
| `source_stale` | Row exists but bytes/revision changed, source disappeared, or filesystem admission (path, regular-file/link/size checks) failed; return no chunk text, invalidate that file and request reconciliation |
| `index_unavailable` | Never indexed, incompatible, corrupt or rebuilding without a compatible committed generation; no empty-success fallback |
| `source_unavailable` | Transient permission/I/O/read instability prevented source validation; no content from that file |
| `limit_exceeded` | Bounded work/output cannot complete; explain the safe limit, omit unverified content and never present truncation as a complete result |
| `cancelled` | Query/get: cancellation observed before delivery suppresses the result. Refresh: cancellation observed before commit rolls back uncommitted work; an already committed generation cannot be retracted |

Known dirty files are excluded until refreshed. A query may return other verified hits with `completeness: partial` and a bounded reason set (`refresh_pending`, `excluded_sources`, `validation_budget`, `source_unavailable`). Zero hits under those conditions is not a definitive no-match. Other file failures never relax admission. Query-wide authority loss or database corruption discards all pending output. No malformed-SQL fallback into a broader corpus; plain-language query preparation can reuse the existing FTS helpers.

Query/get does not re-chunk every candidate. It verifies full source bytes against the stored revision and requires the active chunker version; an equal digest preserves the chunk-policy decision made during indexing. Any digest/version mismatch withholds content and requests indexing. Over-limit files are stopped by the filesystem byte limit before decoding; parser-specific exclusions are decided only during indexing. Validate stored record shape and byte/line bounds and recompute the reference hash before returning the verified slice; malformed rows are index failure, not an invitation to reconstruct guessed content.

An unknown external edit does not invalidate source content already delivered before the edit. Each delivered hit is checked, but a newly created or changed file may not enter the candidate set until reconciliation. Report snapshot age/completeness separately from per-hit source validity; avoid a global claim that every file is current.

## Freshness and index lifetime

Detailed requirements and bounds are in [the lifecycle/test map](local-note-retrieval-lifecycle-tests.md).

Use one runtime-owned indexing coordinator and its existing child-process lifecycle. Add a note-chunk phase with an independent status/generation, without treating a ready file-level index as a ready chunk index. Mutation notifications mark affected files dirty; Dream requests refresh after it finishes its writes. Agent writes, edits and shell commands cannot be assumed to pass through UI mutation hooks.

The proposed maximum reconciliation eligibility interval is five minutes while the runtime is active. Before a query searches, compare now with the last complete reconciliation (missing or backwards-clock timestamps are overdue); overdue status becomes `stale` and the response must be `partial` even if persisted status still says ready. Make work eligible through the existing coordinator at startup, mutations, query and periodic maintenance. If no appropriate periodic dispatch exists, #376 must propose one coordinator-owned timer rather than assert that one already exists. Resume/wake makes an overdue scan eligible. Coalesce requests; one writer per namespace. Work delayed by shutdown, a prior scan or resource ceilings stays visibly stale—five minutes is a scheduling target, not a proven delivery deadline.

External-change reconciliation reads and hashes admitted notes within total scan bounds; equal mtime/size is insufficient. Files known dirty are refreshed first, then bounded rescans discover additions/deletions. This intentionally adds source validation for the new capability without changing `search_workspace` semantics. Polling only candidate files cannot discover new matching notes.

Source Markdown, existing bootstrap maps and the message database are never repaired, migrated or removed by index rebuild. Rollback disables new tools and leaves original files/search intact. Do not delete the entire SQLite store to remove a corrupt derived index.

## Ownership and approval

#1345 supplies this proposed contract and a reviewable implementation test map. #376 implements versioned chunks/refresh after acceptance; #387 implements admitted query/get; #390 tunes ranking only after #1346 supplies frozen evaluation budgets; #377 adds guidance and closes release gates. Reranking, automatic prompt preflight and family capability expansion are excluded.

Any change to roots, allow/deny rows, stale-reference semantics or output/resource ceilings must update this contract and its tests in the same reviewed PR. Conservative resource limits can be revised using #1346 evidence; they cannot be silently widened through request arguments. No production code, config, permissions or timers are changed by the documentation PR.
