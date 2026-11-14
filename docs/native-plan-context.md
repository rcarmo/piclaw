# Native Plan context and request prefixes

Core stores the current Plan in a public SDK document family, `app.plan` (version 1), on the existing application Harness. The family is session-scoped and keyed by the exact chat or branch JID; conversation reset does not change that identity. The native `plan` tool uses `defineTool`, `api.snapshot`, `api.commit` and `tx.doc` directly. No Plan add-on, registration collector or legacy execute adapter is involved.

Model context is stored as immutable, hidden `host.plan-context` entries. Each entry contributes a user-role model message at its original position. The next request appends a new snapshot only when the rendered checklist changes. Unchanged state adds no duplicate entry, including across user turns and reopen.

```text
First request:   history + Plan A
After a tool:   history + Plan A + assistant/tools + Plan B
Unchanged:      history + Plan A + assistant/tools + Plan B + new input
```

The Plan tool, sidebar storage and visible timeline keep their existing behaviour. Historical snapshots are model context, not accepted human input. They are validated and excluded by the existing private-history tree projection. An explicitly blank current-native Plan stays blank. Reset restores the default scaffold. If the renderer returns no checklist, the bridge emits an explicit `(empty)` snapshot. Plan capability guidance stays stable.

## Native request boundary

The SDK pins a context cutoff before `beforeRequest`. Appending an entry from that hook does not automatically include it in that request. `materializePlanContext` therefore:

1. Reads the public conversation context and checks that the pinned request matches its prefix.
2. Allows only exact, trailing, same-generation Plan entries to extend that prefix. Unrelated or edited missing contributions fail closed.
3. Checks the live generation and raw context tail in the append transaction.
4. Persists a new snapshot only if the latest active snapshot or its effective contribution differs from the current rendered checklist.
5. Projects any verified missing snapshots, followed by the new one, into this request.

A pre-dispatch interruption can leave committed snapshots beyond the pinned cutoff. Recovery keeps them in order and appends newer Plan state after them. No private SDK checkpoint is modified, and no missing footer is guessed from prompt text.

The Plan hook runs before request-only prompt sections so its comparison uses the SDK context. Provider adapters continue to hoist system guidance. Registering the hook first can change guidance ordering once on rollout; it does not alter tools or cache/session keys.

## Authority and lifecycle

The readonly hook reads the native document through the public SDK Hook API. Its live generation, cancellation and accepted-input provenance are checked during capture and materialisation, including current private side forks. This context read grants no authority to execute a Plan tool. Source and database ownership checks still run at physical SQL write boundaries through the existing `withAdmissionGuard`. Plan tool execution requires direct native input authority and has no S01/harness fallback.

Current-native Plan0.1.28 extension-KV records are an exact-chat, read-only seed when the document is absent. Reads do not create documents. The SDK document always wins after adoption; Core never mirrors writes, changes legacy timestamps or deletes old rows. Malformed or mismatched records fail closed. This is not a v3 store importer.

The Core `/agent/plan` endpoint requires the existing authenticated operator, explicit chat, database binding and CSRF authority. POST requires the loaded content-derived ETag; the SDK commit checks it against the current document. Concurrent stale writes return409, retaining UI drafts.

Goal publication holds the SDK mutation line while selecting the current Plan and committing its existing Root publication transaction. It performs no SDK read while Root SQL is held and keeps no mirror or Plan cache. Native Goal finalization also renders the SDK Plan through the existing pure Goal builder, without a legacy global Plan reader.

Known retired Plan extension, config and web entries are filtered before import, including aggregate declarations. Other add-ons retain their own qualification and storage authorities.

Deduplication reads active native context, not a process-local cache or a whole-history search. Forks retain inherited snapshots. Reset and compaction can discard snapshots; the next request materializes the current checklist again. Context edits that omit a snapshot also cause current state to be materialized without changing the original entry.

## Verification and limits

Qualification covers tool changes, unchanged state, A/B/A transitions, clearing, initially empty state, reopen, cooperative pre-dispatch interruption, fork, independent conversations, reset, real compaction, context edits, SQL-boundary source revocation, unknown cutoffs and terminal tasks. An offline test runs the actual public Codex HTTP serializer and compares input-item JSON prefixes, instructions, tools and cache key. Native factory tests check direct and codemode Plan updates, Goal integration, persisted entries and private tree projection.

Compaction, intentional context edits, model/settings changes and other dynamic prompt sections can still change a request prefix. Goal lifecycle and terminal-proof checks remain in force. The first deployment cannot reconstruct previously unpersisted Plan footers. No live cache-rate improvement or crash/SIGKILL recovery measurement is claimed by these tests. Installation, restart and controlled production measurement require separate approval.
