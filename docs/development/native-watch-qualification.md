# Native watch qualification — #1494

SDK 1.5.2 exposes three different watch bounds. Core reads the initial conversation
snapshot from `watch.value`, then starts the asynchronous listener. There is no
initial callback merely because `start()` was called.

The tests extend
[`qualification/native/native-view-close.test.ts`](../../qualification/native/native-view-close.test.ts).
Its two existing actual-factory lifecycle cases remain. Ten new cases use public
SDK/Chord APIs; four exercise the conversation watch on disposable real SQLite
and six exercise the public queue primitives directly.

## Qualified contracts

| Surface | Workload and expected result |
| --- | --- |
| Conversation acquisition | `watch.value` contains the acquired immutable revision. `start()` alone emits no callback; a real committed append triggers the first update. |
| Slow conversation listener | With the first update held, 3 or 125 further SQLite commits finish without overlapping listener calls. Releasing it delivers their folded latest view in one subsequent callback. |
| Delta correctness | Applying the actual folded operations through public `applyImmutable` reproduces the callback value. Omitting that delta leaves a different, stale value. Earlier snapshots remain unchanged. |
| Stored history | The watch's bounded entry window does not delete SQLite history. A public entries read still returns every fixture entry in order. |
| Default conversation window | A late watch starts at the newest 50 entries. It grows to 100. The next append drops its oldest entries in one splice down to 50, rather than maintaining a sliding last-100 window. `before` identifies the preceding entry. |
| Late start | Commits after attachment but before `start()` join the first delivered delta. A fresh watch's acquired value remains its initial 50-entry snapshot; two pre-start appends yield 52 entries on delivery. |
| Stop | `stop()` is idempotent and ends future callbacks, including queued updates. It does not join an already-entered listener. The test owns/releases/joins that callback separately; later SQLite commits remain stored without another callback. |
| JSON `Watch` operations | A small folded batch and exactly 10,000 pending decoded operations remain operations. A subsequent frame taking the queue to 10,001 operations replaces them with the current root value. Public delta replay verifies both results. |
| `NativeWatch` values | 3 and 100 pending native values remain ordered calls. 101 pending values collapse to the newest value by the default replacement policy. This is separate from JSON operations and conversation entry windows. |

The JSON tests submit one real public `Watch.advance` batch plus a second tail
frame while its listener is held. They do not import a private queue limit or
construct a replacement watch implementation. Native-value tests use the public
`NativeWatch` class. These primitive cases qualify those classes; they do not
turn a conversation window into a frame-count guarantee.

## Isolation and cleanup

- Conversation cases reuse the existing `openFixture` and current
  `BunSqliteDatabase`/public `SqliteStorage`, under the native filesystem-isolation
  guard and central local-test launcher.
- New conversation cases append application fixture data through public commits.
  They never submit input or enable scheduling. Public inspection stays paused,
  with no tasks or submissions; model, tool-effect and credential-lookup counters
  remain zero.
- Network access is denied by the existing native guard. No installed profile,
  live database, provider account, SSH host or MCP server is used.
- Held callbacks use barriers, not timing sleeps. Cleanup releases them and joins
  only a callback that actually entered, then stops the watch and closes its
  disposable storage. The existing per-case and native-file deadlines are
  unchanged.
- No production source, SDK package, adapter, execution owner, queue, ledger,
  configuration or runtime backend changes are part of this qualification.

## Evidence and limits

The complete existing native contract still discovers 152 files, including this
expanded file. Exact source, fingerprints, numeric gate outcomes and JUnit/Bun
reports belong to the run receipt. Focused, failed and complete runs remain
separate evidence classes.

The initial fixture incorrectly waited for an initial callback and timed out;
reading `watch.value` and committing the first actual update follows the public
contract. A second fixture expectation omitted the public `scheduling: paused`
field. Both failed receipts are retained; neither was an SDK bug or fixed by
extending a deadline.

This slice supplies current watch/folding/window/stop evidence for #1494 and the
HC-018/PC-014 subset of #1650. It supplies no operational canary, arbitrary
external-effect guarantee, whole-series independent safety review, live restore
or production-latency acceptance. It requires no installation or restart.
