# Revalidate legacy login repairs after writer waits

Legacy token and login-ID repair now compare the observed login fields in the UPDATE and re-read the complete canonical row after the write. A deleted, expired or identity-mutated login is denied instead of returning a pre-wait snapshot.

The compared fields are owner, authentication method, creation time, expiry and established login ID. SQL `IS ?` preserves nullable-method/ID comparisons. A previously null ID may acquire an ID from a concurrent legitimate repair. If this lookup assigned the ID itself, it must read back that same ID. Zero-change token migration can succeed only when a matching canonical row now exists. SQL failures and primary-key collisions propagate; there is no conflict suppression.

Modern hashed-session reads with an existing ID are unchanged: no new transaction, lock, reread or cache is added. The legacy write still uses the existing 5,000 ms busy timeout and WAL/full synchronous durability; this is a correctness fix, not a lock-wait speedup.

## Reproduction and verification

The [fixture](../../runtime/test/fixtures/auth-legacy-race.ts) creates synthetic login data in a disposable full-schema WAL database. A second Bun process changes the login inside an uncommitted writer transaction. The reader sees the old committed row, and a narrow instrumentation hook signals the writer only when `getWebSession()` reaches its actual repair. The writer commits after 250 ms; the real UPDATE blocks and resumes against the new state. No SQL result is simulated.

The [receipt](receipts/auth-legacy-race.json) records fifteen baseline observations and fifteen corrected cases, including reader/writer CPU, SELECT/UPDATE calls and a reader timer spanning the synchronous wait. The baseline delete case returned a row after committed deletion. Expiry, owner, auth-method, creation-time and established-ID changes could likewise leave stale metadata. Missing-ID repair threw `TypeError` after deletion. A separate strict baseline deletion run fails its assertion; observation-mode exit zero is not qualification.

The corrected cases deny all twelve revocation/identity mutation modes and preserve three legitimate races: concurrent token migration, concurrent ID assignment and both repairs together. Nullable authentication methods and established IDs are tested. [Unit tests](../../runtime/test/db/web-session-repair.test.ts) also cover a post-assignment ID mutation, expiry crossing during an ID repair, trigger failure and an actual token-primary-key collision with rollback.

The expanded auth suite passed **118 tests / 588 assertions**, including fifteen two-process races. No timeout was changed. All five type projects and explicit fixture compilation pass; compose retains 95 unchanged transitive diagnostics. Scoped lint reports zero warnings/errors, and pack hygiene checks 24,681 files. Two independent source reviews found no blockers.

The frozen candidate passed `make ci-fast`: **6,030 passed, 8 skipped, zero failed** (907.33 seconds), followed by 25 feature and 9 web build tests. The separate historical 0.99.1 gate passed 468 tests / 8,720 assertions; those results remain historical. Final unchanged-tree auth checks passed 118 / 588 again. Tested tree: `c1f7c328718042ba613545c06a91801666fee496`. Full-gate log SHA-256: `1afdea13ea1415f558d3e5097f8f5faf802a3b0f362358768333361c0469aa78`. Only validation prose changed after the gate.

## Limits

- Revocation immediately after the final read remains possible under normal SQLite autocommit semantics. This patch does not make all authentication reads serialisable.
- Deleting and reinserting a legacy row with a null ID and every compared field exactly equal is indistinguishable without a persisted generation column. No schema change is made here.
- Label changes are not identity changes. They are not used for authentication and are not in the comparison.
- Ordinary request-principal caching, broader permission revalidation and maintenance worker lifecycle are separate work.
- The direct storage function is exercised; this is not a complete HTTP/authentication-gateway concurrency test.
- No CPU sampling profile is used for the writer races. The earlier contention audit found profiled waiting could change `SQLITE_BUSY` behaviour. This receipt retains direct process CPU, writer hold time, call counts and timer delay; it makes no sampled-hotspot or speedup claim.
- Initial six-case timing probes signalled before invoking the function; final receipts strengthen ordering by signalling from the repair call. Only the latter establish the deterministic overlap contract.

## Other pending authentication changes

This branch starts from the shared main checkpoint. PR #1530 changes compiled-query reuse and PR #1532 moves already-invalid-row deletion to maintenance. This patch does not merge or modify either branch. When integrating them, retain both early invalid-row rejection and the post-repair checks; #1530's sweep-count assertion must include the row intentionally retained by #1532. Expired-row cleanup on this branch still follows the original mainline behaviour. An isolated combined check applied both pending source changes, copied their tests and adjusted only the documented expiry-sweep count: **26 tests / 110 assertions passed**, including the fifteen races. Temporary files were removed and this branch's source restored; neither published branch was changed.

## Reproduce

```sh
bun run test:local --cwd runtime --env PICLAW_DB_IN_MEMORY=1 -- bun test \
  test/db/auth-legacy-race.test.ts test/db/web-session-repair.test.ts
```

Use the fixture's `reader <mode> --observe` only to record baseline behaviour. Omit `--observe` for strict corrected assertions. All inputs are synthetic; no live store, credentials, provider calls, installation or restart is required.
