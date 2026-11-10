# Shared model-request reservations — historical inactive adapter — archived delivery record

This is archived prototype evidence, not the current runtime contract. The prototype and the later active financial request/accounting owners have been removed under #1875. Nothing below is an activation requirement or supported expense-control API. Current passive observations and historical-data protection are described in [Native usage reports](usage-report-projections.md).

## Archived design and qualification


The inactive public-StreamFn adapter and installer described below are removed under #1575 together with their unregistered child-request proxy closure. They were never installed by production bootstrap. Shipping native calls use captured `host-request-accounting.ts` and the retained `model-request-accounting.ts`/reservation/admission/valuation owners; these active financial invariants are not retired.

This document preserves the prototype's historical contracts, limitations and measurements. Original [adapter/installer source](https://github.com/rcarmo/piclaw/tree/fc587de57babb118b5f0fd2ace406548bd04bbfa/runtime/src/budget) and [profile fixtures](https://github.com/rcarmo/piclaw/tree/fc587de57babb118b5f0fd2ace406548bd04bbfa/runtime/test/fixtures) remain in immutable history. Direct accounting tests are retained at their actual shipping primitive. No new adapter, session monkey-patch or fallback replaces this code, and test/profile deletion supplies no production LOC credit.

The shared boundary reserved capacity for each parent, side or Delegate model invocation. This slice provides an explicit, inactive installer and synthetic integration tests. Production startup does not install it because the real provider/authentication settlement and account-authority contracts are still unqualified.

## Per-call admission

`runtime/src/budget/shared-model-request-boundary.ts` adapts the public Pi stream boundary. It captures current budget work, chat and execution kind when the call starts, then obtains a trusted host plan for the exact physical model. Host policy supplies account generation, enforced output limit, pricing/free classification, deadline, authority and prepared execution. There is no default plan or fallback to the old stream.

Each call has a fresh host invocation ID, including subsequent tool-loop turns and retries. The trusted catalogue bound is held in the existing durable ledger. Parent, side and Delegate holds use the same task subtree, scheduled occurrence and instance-cap evaluation. The prepared executor must call dispatch immediately before its actual send and provide a separate raw-settlement promise. Terminal events alone cannot acknowledge raw cleanup.

`install-shared-request-boundary.ts` can replace a trusted runtime's simple-stream method and attach the same boundary to main or side agents. It rejects overlapping installers for the same runtime or agent, preventing an out-of-order release from restoring an already-released wrapper. Its release restores only wrappers it still owns, preserving subsequent replacements. There is no installation in bootstrap, AgentPool or model-services in this slice.

## Exactly-once accounting

`model-request-accounting.ts` centralises usage valuation for all callers; Delegate's existing accounting adapter delegates to it. It captures the database, authority and evidence. The charge uses host accounting time so a provider timestamp cannot move spend outside the current calendar window. That time remains stable for retries of the same settlement payload. Unknown zero telemetry retains an unresolved hold; a zero error or aborted result cannot establish documented-free execution.

The stream boundary waits for raw completion and durable settlement before publishing its terminal event. It adds the host invocation ID to terminal usage so the existing session and side recorders replay `usage:invocation:<ID>` and cannot add another charge. Storage faults expose a finite failure and keep unresolved capacity. Late known usage from cancelled work remains attributed to its captured owner. Cancellation is rechecked after scope close and after the final authority callback, immediately before terminal publication; a completed charge is preserved while delivery reports cancellation.

The ledger now derives execution kind from the captured work instead of labelling every request as Delegate. No child or callback supplies accounting ownership. Changed response-model identity rejects before settlement.

## Verification

Focused tests cover concurrent parent/side/Delegate admission, distinct turn/retry IDs, unresolved-zero blocking, recorder replay, host calendar attribution, late cancellation, unsent cancellation during raw preparation, storage rollback, model substitution and installer restoration. An actual public Pi Agent runs a synthetic two-turn tool loop; the existing simple side-prompt runner uses the installed synthetic boundary. Both produce exactly one ledger/usage event per billable request.

The corrected broad suite passed114tests/476assertions across14files, with five type checks and changed-file lint. Repository static guards also pass. Review negatives cover installer overlap and post-settlement cancellation; the corrected targeted suite passes19tests/78assertions. Fresh final qualification is required before publication. The accidental calendar fixture created a second cap instead of revising the first; the failed receipt is retained and the corrected test uses the same explicit cap ID. Assertions and durability settings are unchanged.

## Owned disk profile

`runtime/test/fixtures/shared-request-profile.ts` measures100 alternating parent/side requests plus actual session-recorder replay on an owned WAL database with `synchronous=FULL`. All runs assert exactly100 settled reservations, token rows and usage events. Three plain runs took5,460–5,723ms (median5,476); three instrumented runs took5,190–5,428ms (median5,207). The instrumented runs being faster reflects run/filesystem variation; no speedup is attributed to instrumentation or this new boundary.

The third instrumented run counted3,100 statement preparations/~66ms,2,700 gets/~22ms,1,000 all calls/~10ms,600 runs/~10ms,400 exec calls/~4ms and10,600 JSON serialisations/417,700bytes/~5ms. Timings exclude transaction commit; elapsed includes durable transaction work. The CPUartifact has717samples/7.92s including startup; sampled SQLite `run` frames dominate. Event-loop9samples at1ms resolution, third instrumented maximum510ms, insufficient for percentile claims. No production before/after baseline or complete live-delay cause is established.

Machine report and CPU/log artifacts: `/workspace/tmp/pi-101-epic-audit/shared-request-profile/report.json`. No SQL text, binds, credentials, prompts, real providers or live database are collected.

## Production gates

A real execution plan must establish raw auth/provider task completion, fresh account/policy authority, enforced token/category ceilings and per-send transport coverage. Upstream Pi issue10461 tracks the public completion gap. A synthetic injected promise or explicit installer does not qualify every configured provider. Startup activation, real-account testing, deployment and restart require their remaining gates and separate permission.
