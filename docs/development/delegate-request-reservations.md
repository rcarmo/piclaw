# Delegate request reservations — archived delivery record

This is historical design and qualification evidence. The reservation/admission/settlement implementation described below is removed under #1875; no ledger or always-allow replacement admits Delegate work. Current execution uses the public SDK and nonfinancial source/auth/resource controls. Historical monetary records remain opaque and unchanged. See [Native usage reports](usage-report-projections.md).

## Archived design and qualification


The request ledger adds atomic capacity holds to existing budget evaluation. Provider execution and parent/side reservation wiring are separate work. This slice makes no provider calls and registers no new add-on API.

## Admission and settlement

`runtime/src/db/budget-request-reservations.ts` binds each host-generated request ID to its work, chat, exact provider/model, opaque account generation and maximum cost in integer USD micros. The child must not supply these values or its own cost ceiling.

Reservation evaluation and insertion share an IMMEDIATE transaction. Dispatch rechecks active work and ancestors, current caps, selected-account quota evidence, caller authority and cancellation before its one-time state change. The evaluator excludes the request's existing hold while counting its prospective bound once. A request that exactly fits remaining capacity can proceed; an already exhausted cap cannot admit a zero-cost request.

Outstanding `reserved`, `dispatched` and `unresolved` records count against applicable task subtrees, scheduled occurrences and instance caps across calendar rollover. A delegated child inherits its nearest scheduled occurrence and sibling holds. Unknown bounds or unresolved outcomes block dollar-cap admission independently of token counts. Quota evidence must match the selected provider/account/dimension, be no older than two minutes and have a valid future reset when a reset is supplied. Caps remain opt-in; existing allowances and explicit warnings-only policy are unchanged.

Reserved cancellation releases definitely unsent capacity. Cancellation after dispatch retains an unresolved hold. Unknown zero telemetry cannot prove a free request. Complete late host valuation can settle cancelled work; documented-free valuation must have zero amounts in every category. Settlement validates pricing provenance, records usage and changes ledger state in one transaction. The canonical `usage:invocation:<host ID>` prevents double charging when the parent tool event replays the same invocation. Conflicting identities or settlement payloads reject.

`runtime/src/budget/request-reservation-admission.ts` uses the existing asynchronous SQLite admission helper for reserve and dispatch. It snapshots the request, evidence, signal, authority function and database binding once. WAL contention yields to timers with the original busy timeout restored. Revocation, cancellation or replacement of the captured database prevents commit. Synchronous internal ledger operations and settlement still use ordinary SQLite transactions; settlement has no new asynchronous wrapper in this slice.

## Qualification on Smith

Target: Piclaw base `c278927d6462c409a0cdfa03b3561e585ea7e594`, Pi 1.0.1, Bun 1.4.2, Debian LXC. Only disposable synthetic databases were used. No credentials, live providers, production database, installation or restart.

- Budget suite: 67 tests, 272 assertions, zero failures across eight files. Includes two concurrent WAL writers, reopen/late settlement, rollback after post-mutation revocation/abort, database inode replacement during contention, unknown-zero valuation and actual parent tool replay.
- Five type checks and changed-file lint passed. Repository-wide lint failed on identical baseline/candidate diagnostics outside this change; sorted diagnostic sets match.
- Publication requires a fresh full repository gate tied to the exact candidate. Its external receipt records the result; focused tests alone do not qualify the complete release.

### Disk/WAL profile

Fixture: `runtime/test/fixtures/budget-request-profile.ts`, 100 reserve/dispatch/settle requests per run, 100 settled ledger rows and exactly 100 usage rows/events. WAL, foreign keys enabled and `synchronous=FULL` remain unchanged. Three plain and three instrumented runs use the same synthetic seed. The instrumented counters are asserted before recording results.

| Measurement | Result |
| --- | --- |
| Plain elapsed | 3,561–4,361 ms; median 3,602 ms |
| Instrumented elapsed | 4,200–4,397 ms; median 4,379 ms |
| Instrumentation overhead | 21.6% median elapsed |
| Plain CPU user + system | 188–205 ms |
| Instrumented transaction spans | 400, about 4,197 ms inclusive |
| Prepared statements | 3,000, about 55 ms |
| JSON serialisation | 7,600 calls, 148,040 output bytes, about 1.67 ms |
| JSON parsing | No calls through the installed JSON.parse hook in the timed loop |
| Event-loop observations | 9 samples/run at 1 ms resolution; plain maximum 372–416 ms |

Durable transaction wall time dominates this deliberately synchronous loop. Statement execution hooks measured about 33 ms in total; transaction commit work is outside these statement hooks. Transaction spans include 300 outer transactions and 100 usage savepoints; nested timings overlap and cannot be summed as independent costs. The CPU artifact contains 883 samples over about 5.09 seconds, including startup/schema work outside the timed loop. SQLite `run` frames dominate sampled elapsed time; the Bun sampling output is not a pure user-CPU breakdown. The event-loop sample count is too small for percentile claims.

SQL preparation and repeated ancestor/cap lookup are measurable, but smaller than durable writes here. The asynchronous reserve/dispatch path preserves timer responsiveness under a real owned WAL writer; the synthetic tight-loop profile does not establish production latency. JSON is not the primary cost in this fixture. There is no pre-existing ledger baseline, so these timings compare instrumentation only, not a production before/after improvement. No durability settings or assertions were relaxed.

Local artifacts: `/workspace/tmp/pi-101-epic-audit/child-budget-profile-v2/report.json`, adjacent plain/instrumented logs and CPU artifact; corrected correctness/type/lint logs share that audit directory. Only query hashes, timings, counts and byte totals are collected; SQL text and bind data are excluded. The earlier instrumentation assertion expected 300 transaction spans and failed because usage insertion adds 100 savepoints; that failed receipt is retained.

## Remaining execution gates

The eventual provider host must calculate trusted upper bounds, independently validate model/account policy, reserve every competing parent/side/child paid request and gate each actual send. Unknown dispatched outcomes must retain holds through executor cleanup. This ledger does not establish complete shared-cap enforcement, production authentication, selected-engine parity or live canary acceptance. The adapter remains available; unsupported Native configurations fail closed.
