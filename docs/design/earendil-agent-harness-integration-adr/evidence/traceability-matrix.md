# Capability and regression traceability

This matrix connects every capability in [`current-capability-matrix.md`](current-capability-matrix.md) and every defect in [`regression-corpus.md`](regression-corpus.md) to a target owner, mechanism and planned test.

## Test families

| Prefix | Layer |
|---|---|
| `SM` | Pure Piclaw service model, property and fault tests |
| `HC` | Shared Earendil fixture/real-harness contract |
| `PC` | Piclaw service/harness boundary contract |
| `SP` | Storage, migration, transaction and outbox integration |
| `TP` | Tool effector, replay, process and redaction contract |
| `SCH` | Scheduler/delivery contract |
| `UI` | Web projection and browser contract |
| `OPS` | Installed-service, restart and rollback acceptance |
| `GF` | Golden replay fixture from the regression corpus |

## Capability traceability

| Capability | Target owner | Target mechanism | Required tests |
|---|---|---|---|
| CAP-001 | Piclaw | Accepted-source transaction and operation claim | SM-accept-order; SP-accept-crash; PC-001 |
| CAP-002 | Piclaw acceptance; Earendil execution | Exact operation/run steer intent and `AgentLane.steer()` | SM-steer-race; HC-006; PC-002/003/009 |
| CAP-003 | Piclaw acceptance; Earendil execution | Ordered follow-up/successor intent; explicit `followUp` vs new operation choice | SM-follow-up-order; HC-007/008; PC-008 |
| CAP-004 | Piclaw | Owner/version-fenced source reorder/cancel | SM-source-mutation; HC cancel-queued case; PC-003 |
| CAP-005 | Piclaw acceptance; Earendil execution | Atomic queue-source disposition plus exact-run steer delivery | SM-queue-to-steer; HC-006; PC-002/003 |
| CAP-006 | Piclaw authorisation; split execution | Durable typed control source and owner-fenced service/harness command | SM-control-fence; PC control-race cases |
| CAP-007 | Piclaw scheduler; Earendil execution | `scheduled_agent` source, one operation and delivery outbox | SCH-agent-cardinality; PC-012; OPS-scheduler |
| CAP-008 | Piclaw | Existing shell effector and independent delivery/notification intents | SCH-shell-parity; PC-013; TP-process-abort |
| CAP-009 | Piclaw scheduler; Earendil lane | Temporary/named Dream lane, explicit tool/resource policy and cleanup | HC-015/016; PC trusted-input case; OPS-dream-cleanup |
| CAP-010 | Earendil lane; Piclaw projection | Ephemeral/named side lane seeded through explicit context input | HC-015; PC-side-isolation; UI-side-stream |
| CAP-011 | Piclaw service/delivery | Same accepted-source and settlement protocol with channel delivery outbox | SM-channel-source; PC-001/007/017; OPS-channel-delivery |
| CAP-012 | Piclaw | Named trusted provenance on the same acceptance ledger | SM-provenance; PC-018; GF-trusted-enqueue |
| CAP-013 | Piclaw dispatcher | Wake outbox and non-authoritative lane worker | SM-wake-idempotency; SP-wake-crash; GF-accepted-wake |
| CAP-014 | Piclaw | Claim next consecutive pending `sourceSeq` | SM-frontier-properties; PC-001/008 |
| CAP-015 | Piclaw | Operation claim/version instead of cursor preflight/inflight authority | SM-claim-cas; SP-claim-crash; PC-001/007/008 |
| CAP-016 | Piclaw | Immutable failed disposition and blocked frontier | SM-failed-frontier; PC-007; GF-blank-completion |
| CAP-017 | Earendil | Public lane/session snapshots and selected-version recovery surface; activity is projection only | HC-013/014; PC-008 |
| CAP-018 | Earendil Session/Branch/AgentLane; Piclaw correlation | `SessionRepo`, explicit Branch tips, lane acquisition, navigation/fork | HC-010/013/015; SP-session-conformance |
| CAP-019 | Boundary projector | `(piclawOperationId, harnessOperationId, generation, eventSeq)` projection key | PC-014/015; UI-generation |
| CAP-020 | Earendil `AgentHarness`/`Session` | Direct `AgentHarnessOptions` resources and explicit close/eviction | HC-015/016; OPS-session-lifecycle |
| CAP-021 | Earendil | `AgentLane.prompt()` and durable Harness v3 operation values/state | HC-001/009/013; PC-001 |
| CAP-022 | Earendil typed events/watch; Piclaw projection | Snapshot-first buffered watch, redacted event projection; Piclaw terminal commit remains authoritative | HC-001/002/018; PC-007/014/016 |
| CAP-023 | Earendil `AgentHarnessTool<TContext>` | Durable tool plan/`effect_pending`, stable invocation ID, memos/checkpoints, exact result, gate and replay policy | HC-002/003/004/005/021/022; TP-safe-never |
| CAP-024 | Earendil lane configuration; Piclaw policy | Total `lane.config` and direct owner-scoped setters | HC-config-state; TP-tool-policy; GF-tool-owner-replacement |
| CAP-025 | Piclaw policy through Earendil hooks/actions | Explicit admission budget and full tool ledger | HC-tool-budget; TP-parallel-budget; GF-tool-budget-lineage |
| CAP-026 | Piclaw mutation policy; Earendil tool recovery | Piclaw policy/hook can block repeated mutation; Harness v3 `never` unknown effect settles interrupted and never replays | PC-011; TP-mutation-containment; GF-repeated-mutation |
| CAP-027 | Earendil usage ledger; Piclaw billing/UI projection | Durable `UsageRow`, commit totals and idempotent projection | HC-019; SP-usage-idempotency |
| CAP-028 | Piclaw authorisation; Earendil configuration | Typed model/thinking/tool commands and total lane configuration value | HC-config-state; PC-control-fence |
| CAP-029 | Earendil `Resources`, tools and hooks; Piclaw command service | Direct `Skill`, `PromptTemplate`, `HarnessTool` and named hook use | HC-018; TP-resource-contract; version-migration report |
| CAP-030 | Earendil | First-class threshold compaction operation | HC-010/011; PC maintenance cases; GF-late-compaction |
| CAP-031 | Earendil | Durable attempt/compaction/resume sequence with replay policy | HC-004/005/010/011/013; GF-context-pressure |
| CAP-032 | Piclaw control; Earendil compaction | Exact owner/version fence followed by `compact()` | SM-control-fence; HC-010; PC-control-race |
| CAP-033 | Earendil session repository | Explicit Branch/lane fork/navigation under one Session mutation line and host-owned writable authority | HC-010/013/015/024/025; SP-session-rollback; GF-concurrent-rewrite |
| CAP-034 | Earendil retry policy | Total generation/summary state with captured effective options and numbered attempts | HC-011; GF-length-repair |
| CAP-035 | Earendil outcome/tool batch | Full-batch completion and terminate semantics; optional final assistant; no explanatory false success | HC-002/003; PC-010; GF-protected-handoff/terminal-tool |
| CAP-036 | Piclaw deadline; Earendil abort | Piclaw deadline triggers exact abort; durable cancellation plus `Gate.admit()` ordering while admitted effects remain reconcilable | HC-009/021/022; PC-004/006; SM-cancel-complete-race |
| CAP-037 | Piclaw watchdog over correlated events | Operation-scoped typed events/snapshot and cancellation command | SM-watchdog-owner; PC-004/014 |
| CAP-038 | Boundary projector | Active tool-call IDs from typed events/snapshots | HC-002/003; UI-tool-heartbeat |
| CAP-039 | Piclaw policy | Durable bounded recovery/containment counters, no chat-global ambient map | SM-recovery-bound; PC-011; OPS-restart-loop |
| CAP-040 | Piclaw acceptance; Earendil successor | One accepted continuation source before owner release | SM-successor-one-shot; PC-010; GF-protected-handoff |
| CAP-041 | Piclaw | Operation-aware intermediate/terminal timeline port | SP-terminal-transaction; PC-007/016 |
| CAP-042 | Piclaw | Typed salvage terminal candidate and one settlement path | SM-salvage; PC-007; UI-timeout-marker |
| CAP-043 | Piclaw | Atomic settlement and outbox wake | SM-settlement-properties; SP-terminal-crash; PC-007/017 |
| CAP-044 | Piclaw | Immutable failure disposition without frontier overrun | SM-failed-frontier; PC-007; GF-blank-completion |
| CAP-045 | Piclaw + Harness restore/result | Piclaw log reconciled with bounded current-value/list reads and `getResult(operationId)` or `LaneSnapshot.lastResult`; no v2/private recovery query | HC-013/014/022/023/024; PC-008/009/011; OPS-crash-matrix |
| CAP-046 | Piclaw dispatcher | Rebuild wakes from pending source/operation/outbox state | SM-wake-idempotency; SP-restart-wake |
| CAP-047 | Earendil plus host lifecycle | Conformant `SessionRepo`/`Storage`, selected migration, streaming forks and exclusive writable ownership | Upstream backend/fork conformance; HC-013/014/024/025; SP-backup-restore |
| CAP-048 | Earendil and Piclaw service | Explicit close, drain and operation claim fence | HC-016; OPS-shutdown/restart |
| CAP-049 | Piclaw | Reload continuation is an accepted-source/outbox class | SM-restart-continuation; PC-008; OPS-reload |
| CAP-050 | Piclaw authorisation; Earendil execution | Exact Piclaw/Earendil operation-ID cancellation | SM-cancel-cas; HC-009; PC-004/005/006/015 |
| CAP-051 | Earendil `ExecutionEnv`/`HarnessTool` | Exact AbortSignal and environment cleanup own process groups | TP-process-abort; OPS-process-tree |
| CAP-052 | Piclaw | Owner-fenced disposition/retry creates a new operation or explicit skip | SM-retry-skip; PC-008 |
| CAP-053 | Piclaw control; Earendil lane | Exact operation controls and invocation `Context`; no manual action API | SM-control-fence; PC stale-control cases |
| CAP-054 | Piclaw projection service | Allowlisted projection over Harness v3 snapshot/watch and Piclaw correlation | PC-014/016; UI-status-order |
| CAP-055 | Boundary projector/UI | Generation-fenced draft/thought state | PC-014; UI-reconnect-draft |
| CAP-056 | Piclaw projection | Typed outcome/usage marker rendering; no prose classification | UI-outcome-markers; PC-016 |
| CAP-057 | Piclaw delivery outbox | One `deliveryId` per channel response | SP-outbox-idempotency; PC-017; SCH-agent-cardinality |
| CAP-058 | Piclaw notification outbox | Separate Pushover delivery ID/policy | SCH-notification-parity; SP-outbox-idempotency |
| CAP-059 | Piclaw authority/UI; Earendil abort | Fresh exact status and idempotent cancellation | PC-015; UI-installed-iphone-abort; OPS-mobile-PWA |

## Regression traceability

Every regression already names a golden fixture. This table gives its owner mechanism and primary contract layer.

| Regression | Mechanism | Primary tests |
|---|---|---|
| REG-001 | Atomic Piclaw terminal disposition/frontier | GF `blank_completion_does_not_consume_source`; SM/SP terminal fault matrix |
| REG-002 | Lineage-bound successor in terminal transaction | GF `one_continuation_per_lineage_after_tool_budget`; PC-010 |
| REG-003 | Operation-owned cancellation event | GF `stale_abort_cause_cannot_cross_run`; SM cancellation properties |
| REG-004 | Run/generation-fenced compaction result | GF `late_compaction_result_is_ignored_after_replacement`; HC-010/013 |
| REG-005 | Persisted active-tool configuration and owner-scoped policy | GF `tool_policy_owner_survives_session_replacement`; TP-tool-policy |
| REG-006 | Harness execution outcome plus one Piclaw successor | GF `protected_recovery_handoff_is_one_shot_and_non_terminal`; PC-010 |
| REG-007 | Durable attempts and safe/never replay | GF `first_context_pressure_compaction_gets_budget_without_prompt_replay`; HC-004/005/011 |
| REG-008 | Acceptance plus wake outbox transaction | GF `accepted_successor_always_has_recoverable_wake`; SP-wake-crash |
| REG-009 | Canonical Piclaw source sequence correlated to Harness v3 durable current state | GF `fault_between_every_accept_execute_settle_boundary`; PC-007/008 |
| REG-010 | Exact operation/run compare-and-act | GF `stale_abort_cannot_cancel_replacement`; PC-004/005 |
| REG-011 | First immutable disposition wins | GF `cancel_wins_over_late_success_exactly_once`; PC-006 |
| REG-012 | Piclaw terminal commit before maintenance outbox | GF `terminal_commit_precedes_maintenance_failure`; PC-017 |
| REG-013 | Durable exact-run steer acceptance | GF `cross_session_steer_ack_after_durable_exact_owner_acceptance`; PC-002/019 |
| REG-014 | Uniform trusted accepted-source path | GF `trusted_enqueue_uses_same_acceptance_ledger`; PC-018 |
| REG-015 | Idempotent terminal effector and disposition | GF `tool_committed_terminal_is_not_settled_twice`; SP-terminal-idempotency |
| REG-016 | Durable source delivery state reconciled with harness queue | GF `restart_preserves_pending_steer_fifo_and_owner`; PC-009 |
| REG-017 | Version-fenced steer acceptance vs settlement | GF `checkpoint_terminal_race_with_late_steer`; PC-020 |
| REG-018 | `never` replay containment and mutation identity | GF `repeated_successful_mutation_is_blocked_and_contained`; PC-011/TP |
| REG-019 | Restricted harness storage/events and allowlisted Piclaw projector | GF `protected_evidence_never_enters_user_projection`; PC-016 |
| REG-020 | Operation/run/SSE generation projection key | GF `old_sse_generation_cannot_mutate_live_projection`; PC-014/UI |
| REG-021 | Fresh operation authority and idempotent exact abort | GF `installed_mobile_abort_refreshes_and_cancels_exact_run_once`; PC-015/OPS |
| REG-022 | Explicit command identity; no ambient authority | GF `inherited_async_context_has_no_mutation_authority`; SM-control-fence |
| REG-023 | Scheduler-owned delivery outbox | GF `scheduled_agent_has_single_timeline_and_run_log_delivery`; PC-012/SCH |
| REG-024 | Full tool-batch outcome | GF `terminal_side_effect_cannot_hide_failed_tool`; HC-002/003 |
| REG-025 | Retry from actual effective stream options | GF `length_repair_reduces_effective_output_cap`; HC-011 |
| REG-026 | One writer/owner across compaction, navigation, forks and offline administration | GF `concurrent_session_rewrite_has_one_owner_and_generation`; HC-023/024/025; SP-session-rewrite |

## Assumption status

| Assumption | Status | Evidence or required resolution |
|---|---|---|
| EA-001 public harness method/result stability | Intentionally not assumed | Compile against each selected Earendil version and update Piclaw/contracts to its direct types |
| EA-002 session record protocol is recovery basis | Superseded by Harness v3 design | Target uses entries, typed values/lists, immutable results, usage and total current state, not v2 records/reducer |
| EA-003 operation ID behaviour across resume | Implemented on `dev`; source unselected | Public operation ID is durable; HC-012/013 prove the selected implementation |
| EA-004 queue ownership semantics | Implemented on `dev`; source unselected | One lane-owned tagged inbox carries steer/follow-up/next-run/write items; validate admission and placement across replacement |
| EA-005 one-action manual drive | Superseded and removed | HC-017 tests deterministic direct drive using gated storage/effects |
| EA-006 event ordering data | Lane watch/event runtime implemented; session watch stubbed | Snapshot-first buffered lane watch removes registration gaps; Piclaw still assigns web receipt sequence |
| EA-007 abort intent durability/order | Implemented on `dev`; source unselected | Durable control plus `Gate.admit()` requires HC-009/021/022; Piclaw cancellation remains authoritative |
| EA-008 deterministic `Models`/tools | Implemented on `dev`; source unselected | Generic contextual tools, stable invocation identity and direct `Models` require the real HC suite |
| EA-009 backend/fork conformance export | Memory/JSONL/SQLite conformance exists; WP07 complete and WP08 active | Run unchanged suites plus HC-024/025 on the selected source/runtime |
| EA-010 hook/event/Context stability | Typed maps, registries and Context-last runtime implemented; source unselected | Adopt selected direct types and update Piclaw when Earendil changes them |

No execution-type assumption is a compatibility promise. Piclaw updates to each selected Earendil version. Piclaw acceptance, cancellation and terminal authority remain service responsibilities unless a later ADR deliberately transfers them.

## Coverage completion

- Capabilities traced: **59/59**.
- Regressions traced: **26/26**.
- Assumptions classified: **10/10**.
- Coverage gaps from the capability inventory now have named tests: trusted inputs, non-web delivery, process groups, extensions, containment, shell/Pushover and mobile installed-browser behaviour.
