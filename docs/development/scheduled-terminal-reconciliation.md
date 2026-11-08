# Reconcile interrupted scheduled SDK work

An expired scheduled occurrence can remain `source_bound` after its host operation and SDK submission have failed. The occurrence blocks native shutdown until its result is reconciled. Expiration alone never proves that execution stopped.

The scheduler now captures a native terminal-receipt fence for SDK-attached interruptions. The existing S07 completion transaction still checks the run, attempt, task revision, expired lease, source identity and operation version. It leaves the original attachment, source membership and lease history intact.

## Required evidence

- The host operation is terminal, failed with `scheduled_run_interrupted`; its source is disposed for the same reason.
- No cancellation or terminal timeline publication owns that operation.
- The exact SDK submission is an `input`, `unanswered` for `model_error`, with the scheduled run's request ID.
- Its committed `host.accepted` entry matches the original session domain, conversation, chat, operation, source sequence and run ID.
- A failed native generation matches that submission's failure detail.
- Every task and input in the scheduled conversation and its owned descendant conversations is terminal, including background work. Oversized or cyclic ownership trees are refused.
- Host/database ownership remains current through the S07 writer boundary. A backend replacement invalidates a captured fence.

The private engine reads public `Storage` records. It does not open or resume a Harness, inspect private SDK tables, submit input, invoke models, or cancel tasks. Terminal receipts are immutable; a terminal task cannot create further descendants. A disposed host source supplies no authority to start another scheduled run.

Without the native proof port, SDK-attached reconciliation remains refused. A harness ID, expired lease, terminal host operation or terminal submission alone is insufficient. Never clear attachment fields to make a run look undispatched.

## Settlement and recovery

The reconciler records an error with `scheduled_run_interrupted`, creates one run log and recurrence decision, and skips missed cron occurrences. It creates no delivery outbox entries and makes no assertion that prior tool effects were absent. Existing task-head changes still win over stale completion.

A lost acknowledgement is resolved from the original S07 completion receipt. Repeating the same request repairs acknowledgement only; it neither rechecks execution by resubmitting nor replays tools/providers. The normal scheduler supplies the proof reader through its existing native backend and AgentPool contracts.

For operator reconciliation, first retain a consistent online database backup and validate the exact request against that copy. Use the same native `captureInterruptedScheduledHarness` reader and `reconcileInterruptedAgentSource` API for the live transition. No schema migration, raw terminal-row update or fabricated lease is needed. Recheck native global idle before requesting `exit_process`; reconciliation does not grant restart authority.
