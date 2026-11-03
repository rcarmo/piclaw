# Native scheduler execution and completion

Scheduled agent work enters through an admitted S07 occurrence and `dispatchScheduledAgent`, which uses the existing pi-durable fork/submission path. Core keeps application scheduling policy and validated shell/internal maintenance; it does not add another agent runner.

## One execution path

The raw `runScheduledTask` source export is retired. The running native application already refused it, and its remaining consumers were tests; no production, script, declared add-on API or installed add-on caller was found. Older capability matrices and legacy plumbing benchmarks describe their pinned historical source, not a current execution API.

All task kinds now reach the existing private executor with a captured lease and active-claim check. Legacy `advanceTask`/`deferHistory` modes, direct task-log insertion and direct recurrence advancement are removed. S07 owns the atomic occurrence/history/recurrence transition. Native source identity, revision/lease fencing, queue ordering, cancellation, delivery formatting and truthful outcomes remain.

Shell output, PI metadata, Unicode bounds, quiet output and notification policy keep their existing contracts. Tests exercise them through the same admitted S07 claim/queue/settlement path; no replacement adapter or native reachability is introduced. Historical task logs and recurrence receipts are unchanged.

## Completion persistence

A retryable `not_applied` acquisition failure now uses the same existing bounded completion retry as an unknown acknowledgement. Both attempts reuse the identical sealed completion request. Uncertainty from either attempt remains latched: a failed readback cannot turn a possibly committed success into a failed source. Task/model/tool execution is never repeated to repair completion storage.

The SQLite acquisition budget remains five seconds. A real six-second fixture writer outage verifies one native execution/submission/delivery and one committed completion/history/next decision after retry. The repair adds no queue, result ledger, timer or lease owner.

Longer outages, repeated not-applied/fatal persistence, complete stop/reopen recovery, idle writer polling and full scheduler capacity/cancellation qualification remain unfinished under #1826/#1827. This bounded delivery grants no live rollout, replay or data migration authority.
