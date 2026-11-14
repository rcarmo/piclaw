# Cross-browser model and session pins

Model and session pins follow the same Piclaw instance across browsers. Browsers use the same server list. In single-user mode the list belongs to the operator; in family mode it belongs to the authenticated account. Recent models, sorting and compatibility filters remain local.

## Migration and changes

Each operator browser imports its existing local pins once per server scope. The server returns an opaque scope ID, so replacing the server database creates a new migration scope. A per-browser import receipt makes an uncertain retry harmless. A browser with no legacy pins records completion locally without uploading an empty import.

Imports add only keys that the server has never seen. Unpinning creates a tombstone, including when the key was never pinned on the server. An older browser's import cannot resurrect it. An explicit later pin can restore it. Imports from different browsers merge; repeated imports from the same browser do nothing.

Normal writes contain one desired pin state, not a complete list. Concurrent writes to different keys do not overwrite one another. For the same key, the last committed server action wins. Requests are serialized within a page, and responses carry monotonic revisions so an older refresh cannot overwrite a newer reply.

Family preferences use the existing account-private in-memory runtime. They never import the unscoped operator localStorage keys or save private pin lists to browser storage. Their lists are fetched again after reload. Classic session groups retain their existing ordering.

## Synchronization and failures

`GET /agent/picker-pins` returns `{scope, revision, models, sessions}`. `POST` accepts either:

- `{action:"set", kind:"model"|"session", key, pinned:boolean}`;
- `{action:"import", browser, models, sessions}`.

The existing SSE connection carries `picker_pins_changed` invalidations with an empty client payload. Single-user notifications reach only operator clients; family notifications reach only live subscriptions for the same immutable account, across its session tabs. No pin names or account IDs are delivered in the notification. The receiving page reloads its authorized list. Load, reconnect, window focus and visibility restoration also refresh; there is no new interval or polling loop.

UI changes are optimistic. Failed writes display an error and restore the latest confirmed list. There is no durable offline mutation queue. Local legacy pins are captured at startup, so a failed optimistic edit cannot become a migration import. In-flight responses cannot update a stopped account/page runtime.

If the server committed a request but its response was lost, the next refresh may reveal the committed change. Explicit pin writes and import receipts are safe to retry. Do not treat an error toast as proof that the server transaction did not occur.

## Security and bounds

- Request authority chooses the owner; no request field selects an account.
- Family requests require live account/login headers and browser binding. The account is revalidated after asynchronous body reading and before mutation.
- Session pins are checked against current ownership on reads and writes. Operator session keys must exist. Import silently ignores inaccessible/deleted sessions; explicit inaccessible-session writes are denied.
- POST requires a matching Origin and is rate-limited to 120 mutations/minute per owner. The streaming body reader accepts at most 300,000 bytes and waits at most ten seconds.
- Keys are bounded to 512 characters, control characters are rejected, and model keys require `provider/model` form.
- Each owner may have 256 active pins per kind, 4,096 retained pin/tombstone rows and 1,024 non-empty browser imports. Exceeding limits rolls back the transaction. Tombstones are retained to protect old-browser migration.
- Pin preferences do not grant model or session access. An unavailable pinned model stays stored but cannot bypass the model catalogue's admission rules.

Tables `picker_pin_scopes`, `picker_pins` and `picker_pin_imports` are created additively in the existing database. No messages, previous preferences or session state are deleted. Normal backup/restore includes the pin data.

## Refinement decisions

Approved scope: same-instance cross-browser pins, the web UI, account isolation and one-time local-pin import. Explicit non-goals: cross-instance sync, recent-file/model history synchronization, global sort synchronization, offline command queues and new polling. Migration must preserve explicit unpins over stale browser imports. Existing operator local pins are retained as the local cache; family mode does not reuse them.

## Verification

> Historical qualification of the original delivery. Visual was later retired in #1990.


- Database tests cover account/operator isolation, independent desired-state edits, repeated import receipts, never-pinned tombstones, explicit repinning, session access filters, key/size bounds, rollback and database reopen persistence.
- HTTP tests use the family router with real account/session fixtures: owned/foreign sessions, forged or missing login pins, cross-origin requests, oversized bodies and authority loss during body reading.
- SSE tests verify matching-account delivery across different chat subscriptions, exclusion of other users/operator clients, empty payloads and revoked subscriptions.
- Chromium and WebKit use independent browser contexts against a disposable server and real SQLite store. Cases cover legacy import, real model-pin/session-pin controls, concurrent changes, stale imports, reload, unchanged recents/sort, failure rollback/retry, offline startup, no five-second polling and delayed-response teardown.
- The existing full family/picker browser suites pass with the new endpoint fixture: **148 tests / 2,390 assertions**. Focused database/preferences/security checks pass **34 tests / 389 assertions**.
- Full `make ci-fast`: **5,518 runtime passes**, 4 skips, zero failures; 25 feature tests and 9 build tests. Four typechecks, scoped lint, packaging hygiene, stale-bundle and environment-surface checks pass.
- Final post-build cross-browser lifecycle rerun: **6 passes / 36 assertions**. No completed test run was repeated after resuming publication.

This branch also carries the identical partial-window snapshot listener guard and import regression from pending #1366, without that PR's compose styling. It prevents non-browser rendering fixtures from attempting to call a missing `window.addEventListener`; browser snapshot behaviour is unchanged.

Browser contexts use synthetic identities and pin values. Tests do not connect to the live instance. The delegated read-only review timed out; no independent review is claimed. No merge, install or reload is included.
