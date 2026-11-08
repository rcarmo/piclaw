# Reasoning-only usage and native qualification

This #1882 fix retains usage records containing reasoning tokens even when the provider supplies no positive input, output, cache or total count. The reporting predicate now uses the existing reasoning extractor. It does not infer a total, invent provider cost or change catalogue valuation.

The five supported reasoning spellings are regression-tested with duplicate event delivery. An actual offline SDK side invocation verifies the original reasoning count, unknown provider cost and unchanged financial history across database reopen. The regressions fail without the production change.

## SDK ownership

The qualification repairs remove expectations of a callable web runner, host-lane settlement, financial reservations and a second saved queue. Tests observe the SDK admission receipt and persisted `done`/`unanswered` result. The low-level application bundle has no timeline-result projector unless one is supplied; its tests verify immutable SDK answers. Actual default-factory tests still verify timeline projection, tools, images, routing-token retirement and reopen.

Two files exclusively testing removed financial owners are retired:

| Retired file | Removed contract | Retained safety coverage |
|---|---|---|
| `host-request-write-admission.test.ts` | Reservation creation, pre-send financial dispatch, refunds and monetary owner revocation | `sqlite-admission-workload`, `native-post-provider-contention`, `native-provider-authority`, `native-passive-usage-fault` |
| `host-regrets-model.test.ts` | Account-required decision adapter, reservation settlement/refund and cached financial replay | `host-regrets-bindings`, `host-regrets-tool`, `newregrets-enabled-default-factory`; these cover source revocation, scoped access, actual SDK transport, reporting failure and reopen without replay |

Generic failure-envelope, bounded aggregate-error and redaction tests remain. Their fixtures use a nonfinancial source error rather than importing the retired budget error type.

Goal component tests use a transaction-local SQL admission probe instead of restoring the deleted queue service. Native Goal suites retain actual SDK execution and lifecycle coverage. Peer tests retain exact target/principal checks, conflict detection, transactional revocation and immutable accepted source correlation.

A failed SDK abort write is not a successful cancellation. The recovery test holds a real foreign WAL writer through the existing acquisition deadline, verifies reopen of the same submission and performs an explicit, freshly scoped operator abort. It creates no synthetic cancellation source or host replay coordinator.

## Existing schema

The covering token-usage index already shipped on main but was missing from the ownership inventory. The inventory now records its exact fingerprint and existing `core:token_usage` owner. There is no schema migration or new index in this change.

## Scope

Production changes: one predicate entry. No new production module, owner, facade, queue, ledger or financial gate. Test support observes existing SDK terminal evidence; it cannot submit, resume, retry or settle execution. Most other changes reconcile qualification with owners already removed on main. They are not additional production deletion credit.

This is a bounded fix and qualification repair, not completion of all #1882 or conversion-epic acceptance. No live database/history, configuration, credentials, task, installation or service restart is authorised by this change.
