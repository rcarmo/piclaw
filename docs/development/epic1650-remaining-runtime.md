# Remaining thin-shell work — 14 November 2026

At base `d75ec20fb`, all seven direct children of #1650 are closed: #1817, #1857, #1875, #1885, #1886, #1891 and #1892. Their delivered reductions are historical evidence; they receive no new credit here.

## Remove uncalled lifecycle mechanisms

The caller census covers Core's runtime, private engine, operational scripts and skel, plus the add-ons source at `3b7e488`. Tests and type-only service declarations do not establish a supported runtime consumer.

- `AgentPool.setSessionBinder` has no production caller. The capture service factory constructs `AgentSessionBinder` and awaits its empty callback on each binding. Delete the setter, callback owner, module and factory registration. Keep usage-recorder installation and explicit capture intact.
- `AgentSessionManager.prewarm` and `cancelPrewarm` have no production caller. Delete their queue, in-flight/queued sets, cooldown map, loop flag, lightweight helper and obsolete counters. Native startup already uses SDK-owned scheduling and does not construct this manager. No replacement warmup or scheduler is added.

Before: capture factory → session manager binding → usage recorder → binder → optional callback. After: capture factory → session manager binding → usage recorder. Native execution remains unchanged.

This slice changes six handwritten production files: **4 lines added, 216 deleted; net 212 physical / 194 nonblank lines removed**, one module removed. Charge every production addition. Tests/docs/generated output earn no reduction credit. It removes the binder callback owner and the dormant prewarm scheduling mechanism; it does not claim a measured latency improvement.

Two new retirement regressions fail on the base implementation. Six tests exercise only the removed mechanisms and retire with them: two binder tests, three prewarm-policy tests and one lightweight-prewarm fence test. Shutdown admission and mid-create shutdown coverage move to direct session admission, retaining the joined-disposal assertions and deadline. Native web bootstrap now asserts that the binder API is absent. Existing capture, upgrade, MCP admission/teardown, deferred-seed, eviction and source-protection cases remain.

## Reconcile the older trackers

| Tracker | Remaining work |
|---|---|
| #1494 | Map storage/fork/watch/crash/authority requirements to current public SDK qualification and existing owners; name any genuine uncovered row. Do not rerun migration or add a storage facade. |
| #1455 | Map current MCP and shipping Delegate source/artifact/security/cleanup coverage; keep unsupported operations explicit. |
| #1458 | Reconcile the current provider-owned authentication inventory and offline lifecycle/UI evidence. Record real-account operations separately; do not perform them without approval. |
| #1456 | Reconcile completed deployments and historical rollout rows. Identify a necessary new operation before proposing a canary; do not restore old runtimes or credentials. |
| #1907 | Map removed financial/readiness owners to delivered work, finish the caller/profile audit and preserve its unchanged real-work startup/latency gate. Source tests do not establish live latency. |

The remaining operational rows are not waived by this document. No installation, restart, account/provider operation, live-store mutation, migration, backup or replay is authorised by this source slice.
