# Agent lifecycle regression corpus

Baseline: Piclaw `v2.13.2` at `0afd3ae645c423bed82deef80c343bcaa6f31d4d`.

Post-release reference: `archive/post-v2.13.2-fixes-20260810` at `da47ca62f3c1e7e0d5e538cc250303eb8c9ca1f4` and the verified bundle `/workspace/backups/piclaw-post-v2.13.2-fixes-20260810.bundle`.

The archive is root-cause and regression evidence. Its implementation is not the target design.

## Invariants

| ID | Invariant |
|---|---|
| INV-01 | Every accepted source receives one durable Piclaw sequence before execution. |
| INV-02 | Prompt, compact, retry, steer, abort and terminal commands carry exact owner identity. |
| INV-03 | Stale run, session, attempt or generation events cannot mutate current state. |
| INV-04 | Every operation receives one immutable terminal disposition. |
| INV-05 | Terminal output, source consumption, frontier advance and owner release settle atomically or through one idempotent transaction protocol. |
| INV-06 | The first accepted cancellation remains scoped to its operation across late results and restart. |
| INV-07 | Tool invocation and result state is monotonic; duplicate results and unsafe replay are rejected. |
| INV-08 | Recovery attempts, time, compaction and tool use are bounded. |
| INV-09 | Containment keeps tools disabled until an accepted terminal settlement or explicit hand-off. |
| INV-10 | Restart reconciliation preserves FIFO input, steer/follow-up ownership, partial output and successor claims truthfully. |
| INV-11 | Scheduler execution, timeline response, run log and notification each have one delivery owner. |
| INV-12 | UI status and SSE events carry exact Piclaw operation, correlated Earendil operation and watch/connection-generation identity. |
| INV-13 | Harness transcript/queue state is execution evidence, not proof of Piclaw acceptance or terminal consumption. |
| INV-14 | Protected tool arguments, results, scheduling intent and secrets do not leak through timelines, UI events or logs. |
| INV-15 | Process-local admission does not erase external-effect uncertainty: abort prevents only work that has not passed `Gate.admit()`, and crash recovery never treats admitted work as definitely absent. |

## Corpus

### REG-001 — Blank or no-terminal turn consumes input

- **Trigger:** the provider resolves with no terminal assistant text; a user-only session delta or incomplete tool phase remains.
- **Incorrect behaviour:** older paths advanced the cursor or displayed a warning while consuming the user message without an authoritative response.
- **Cause:** success, cursor advancement and terminal artifact persistence were decided in separate layers.
- **Evidence:** `run-agent-blank-turn-recovery.test.ts`, `run-agent-attempt-finalization.test.ts`, `web-channel.test.ts`; archived turn audit records the historical no-op trade-off.
- **Baseline status:** mitigation exists through blank-turn recovery and held failure, but ownership is still cursor-based.
- **Violates:** INV-04, INV-05.
- **Target prevention:** Piclaw commits the terminal disposition only after one terminal output effector succeeds; a failed/no-terminal harness outcome leaves the accepted source pending or failed without frontier advance.
- **Contract scenario:** `blank_completion_does_not_consume_source`.

### REG-002 — Tool-budget continuation loses lineage or repeats

- **Trigger:** a turn reaches its tool budget, persists a terminal warning/draft and schedules one automatic continuation.
- **Incorrect behaviour:** the continuation used a null thread, acquired a new lineage and could reserve another continuation; failed queue persistence could strand the reservation.
- **Cause:** terminal persistence, lineage resolution, reservation and queue write were split.
- **Evidence:** `docs/audits/2026-08-05-code-change-audit.md`, defect 1; baseline `web-channel.test.ts` regression cases.
- **Baseline status:** focused fix is in v2.13.2, but the protocol remains bespoke.
- **Violates:** INV-01, INV-05, INV-10.
- **Target prevention:** one transaction/outbox stores terminal disposition and any successor intent with the same operation lineage and idempotency key.
- **Contract scenario:** `one_continuation_per_lineage_after_tool_budget`.

### REG-003 — Abort provenance labels a later turn

- **Trigger:** a control abort records a chat-scoped cause while no prompt is active, or an exceptional path exits before consuming it.
- **Incorrect behaviour:** a later turn inherits `user_command` or `service_shutdown` as its abort cause.
- **Cause:** chat-scoped mutable provenance outlived its run.
- **Evidence:** `docs/audits/2026-08-05-code-change-audit.md`, defect 2; `run-agent-orchestrator.test.ts` stale-entry and exceptional-exit tests.
- **Baseline status:** fixed by clear-on-entry and consume-on-exit.
- **Violates:** INV-02, INV-03, INV-06.
- **Target prevention:** Piclaw cancellation is operation-owned; Harness v3 durably commits `cancel_requested` before signal pull, and later fallout remains under the correlated Piclaw/Harness operation IDs.
- **Contract scenario:** `stale_abort_cause_cannot_cross_run`.

### REG-004 — Timed-out compaction mutates a replacement generation

- **Trigger:** compaction times out, a replacement session/generation starts, and late cleanup or result arrives.
- **Incorrect behaviour:** late completion clears replacement active state, consumes its cancellation reason or reopens unsafe prompting.
- **Cause:** compaction single-flight and cleanup were keyed too broadly before generation checks.
- **Evidence:** `compaction.test.ts`: late timed-out compaction and late cancellation cleanup cases.
- **Baseline status:** baseline has generation-focused tests and quarantine-until-settlement logic.
- **Violates:** INV-02, INV-03, INV-08.
- **Target prevention:** use the Harness v3 compaction operation ID, Piclaw correlation and lane-serialised state mutation on every settlement; an absent externally-finalised operation stops the live task without writing.
- **Contract scenario:** `late_compaction_result_is_ignored_after_replacement`.

### REG-005 — Session replacement leaves stale tool-policy owner

- **Trigger:** recovery/rotation swaps the live session while a tool ceiling or temporary tools-disabled patch remains active.
- **Incorrect behaviour:** an old setter is restored onto a replacement, tools re-enable during protected recovery or the next ordinary turn inherits an empty set.
- **Cause:** policy ownership was implemented by patching mutable session methods and saved arrays.
- **Evidence:** `run-tool-ceiling.test.ts`, `session-manager.test.ts`, `run-agent-orchestrator.test.ts` empty-set restoration tests.
- **Baseline status:** targeted owner-transfer and restoration guards exist.
- **Violates:** INV-03, INV-09.
- **Target prevention:** Harness v3 persists total `lane.config`; Piclaw uses direct `AgentLane.setActiveTools()` owner-fenced by its operation correlation and never restores state from another run/session.
- **Contract scenario:** `tool_policy_owner_survives_session_replacement`.

### REG-006 — Protected recovery dead-ends or claims success without tools

- **Trigger:** an attempt fails after tool activity; recovery disables tools and asks for terminal prose.
- **Incorrect behaviour:** the tool-free response can be mistaken for authoritative completion, or the hand-off never runs the required ordinary continuation.
- **Cause:** execution authority and explanatory prose were conflated; continuation ownership crossed agent-pool and web queue layers.
- **Evidence:** issues [#912](https://github.com/rcarmo/piclaw/issues/912) and [#916](https://github.com/rcarmo/piclaw/issues/916); `protected-recovery-handoff.test.ts`; `run-agent-recovery-phase.test.ts`.
- **Baseline status:** v2.13.2 has one-shot hand-off tests, but post-release work found further durability gaps.
- **Violates:** INV-01, INV-04, INV-09, INV-10.
- **Target prevention:** harness outcome states whether execution completed; explanatory output cannot promote a failed operation. Piclaw accepts exactly one successor continuation before releasing the source owner.
- **Contract scenario:** `protected_recovery_handoff_is_one_shot_and_non_terminal`.

### REG-007 — First context-pressure retry is suppressed or repeats unsafe work

- **Trigger:** tool activity or provider failure reaches context pressure on the first failed attempt.
- **Incorrect behaviour:** recovery budget suppresses the required first compaction, or replaying the original prompt repeats side effects.
- **Cause:** initial attempt time was charged to the wrong recovery phase and prompt persistence was not a first-class fact.
- **Evidence:** issue [#913](https://github.com/rcarmo/piclaw/issues/913); `run-agent-recovery-phase.test.ts`; context-pressure tests.
- **Baseline status:** budget and neutral-continuation mitigations exist.
- **Violates:** INV-07, INV-08.
- **Target prevention:** Harness v3 total generation/tool/compaction state decides whether to resume; tool replay policy forbids unsafe repetition; Piclaw deadlines trigger exact abort commands.
- **Contract scenario:** `first_context_pressure_compaction_gets_budget_without_prompt_replay`.

### REG-008 — Accepted self-continuation fails to wake

- **Trigger:** a continuation/follow-up is durably queued while the current lane completes or no worker remains active.
- **Incorrect behaviour:** accepted work stays in storage until another user action or restart happens to wake the chat.
- **Cause:** durable queue state and in-memory wake tasks had separate ownership.
- **Evidence:** rollback manifest entry for PR #909 and archive commit history.
- **Baseline status:** post-v2.13.2 fix was rolled back.
- **Violates:** INV-01, INV-10.
- **Target prevention:** Piclaw writes accepted source plus outbox wake in one transaction; wake is an idempotent projection of pending durable work.
- **Contract scenario:** `accepted_successor_always_has_recoverable_wake`.

### REG-009 — Split cursor, queue and runtime ownership loses or duplicates work

- **Trigger:** failure/restart occurs between message persistence, cursor promotion, SDK queueing and terminal finalisation.
- **Incorrect behaviour:** the earliest accepted source is skipped, replayed twice, left behind a blocked marker or attached to the wrong turn.
- **Cause:** no canonical accepted-source operation sequence; cursor timestamps, queue tasks and SDK transcript each represented partial truth.
- **Evidence:** rollback manifest PRs #910, #911, #914 and #915; issues [#920](https://github.com/rcarmo/piclaw/issues/920) and related archive tests.
- **Baseline status:** architectural limitation of v2.13.2.
- **Violates:** INV-01, INV-04, INV-05, INV-13.
- **Target prevention:** Piclaw operation log owns service acceptance/frontier; Harness v3 entries, values/lists, operation results and usage own execution; one persisted correlation joins the durable domains.
- **Contract scenario:** `fault_between_every_accept_execute_settle_boundary`.

### REG-010 — Cancellation targets whichever operation is active later

- **Trigger:** an abort request is delayed or a replacement turn starts before generic chat-scoped abort executes.
- **Incorrect behaviour:** cancellation marks or physically aborts the replacement operation.
- **Cause:** compare-and-act did not carry exact durable operation identity through the service and SDK boundary.
- **Evidence:** issues [#918](https://github.com/rcarmo/piclaw/issues/918), [#932](https://github.com/rcarmo/piclaw/issues/932), [#951](https://github.com/rcarmo/piclaw/issues/951); rollback manifest PRs #919 and #945.
- **Baseline status:** exact-owner cancellation is absent from stable baseline.
- **Violates:** INV-02, INV-06.
- **Target prevention:** Piclaw verifies expected operation and correlated Earendil `operationId` in one owner transition, persists cancellation, then calls `requestAbort()`/`abort()`; stale requests return no-op.
- **Contract scenario:** `stale_abort_cannot_cancel_replacement`.

### REG-011 — Late result overwrites cancellation

- **Trigger:** cancellation persists while provider/tool completion is already in flight.
- **Incorrect behaviour:** late success stores terminal output or clears cancellation, yielding two outcomes.
- **Cause:** terminalisation and cancellation were competing callbacks without one ordered disposition fence.
- **Evidence:** operation-cancellation and atomic-recovery issue family [#918](https://github.com/rcarmo/piclaw/issues/918), [#920](https://github.com/rcarmo/piclaw/issues/920); archived PRs #919/#921.
- **Baseline status:** stable baseline lacks the full durable operation fence.
- **Violates:** INV-04, INV-05, INV-06.
- **Target prevention:** first terminal disposition wins under expected operation version; late harness outcomes are recorded as observations only.
- **Contract scenario:** `cancel_wins_over_late_success_exactly_once`.

### REG-012 — Terminal output is lost behind post-turn maintenance

- **Trigger:** model output completes, then idle compaction or maintenance fails before the response is committed.
- **Incorrect behaviour:** successful user-visible output is lost and the source may be retried.
- **Cause:** maintenance ran inside `runAgent()` before Piclaw terminal persistence.
- **Evidence:** issue [#922](https://github.com/rcarmo/piclaw/issues/922); archive PR #923.
- **Baseline status:** present ordering risk in stable baseline: post-turn auto-compaction occurs before `runAgentPrompt` returns to `processChat`.
- **Violates:** INV-05.
- **Target prevention:** harness returns terminal outcome; Piclaw commits output/disposition first; maintenance is a separately owned successor operation.
- **Contract scenario:** `terminal_commit_precedes_maintenance_failure`.

### REG-013 — Streaming steer is accepted outside exact owner

- **Trigger:** cross-session or compose steer arrives while a chat reports streaming.
- **Incorrect behaviour:** the SDK queue accepts it without durable acknowledgement or it lands on a replacement run.
- **Cause:** `isStreaming` plus `session.prompt(... steer)` lacks durable operation compare-and-act.
- **Evidence:** issues [#927](https://github.com/rcarmo/piclaw/issues/927) and [#933](https://github.com/rcarmo/piclaw/issues/933); rollback PRs #934/#938.
- **Baseline status:** stable steer path is in-memory and chat-scoped.
- **Violates:** INV-01, INV-02, INV-10.
- **Target prevention:** Piclaw accepts steer with exact operation ID and sequence, then calls `steer()` on the correlated Harness v3 lane/operation; acknowledgement follows Piclaw durable acceptance.
- **Contract scenario:** `cross_session_steer_ack_after_durable_exact_owner_acceptance`.

### REG-014 — Trusted internal enqueue bypasses durable provenance

- **Trigger:** internal tool/add-on/runtime work injects a follow-up through a privileged shortcut.
- **Incorrect behaviour:** work lacks the same acceptance provenance and restart semantics as external input.
- **Cause:** trusted paths bypass ordinary message acceptance.
- **Evidence:** issue [#928](https://github.com/rcarmo/piclaw/issues/928); archive PR #939.
- **Baseline status:** heterogeneous trusted paths remain.
- **Violates:** INV-01, INV-13.
- **Target prevention:** all work enters a named accepted-source class; trust affects authorisation, not durability.
- **Contract scenario:** `trusted_enqueue_uses_same_acceptance_ledger`.

### REG-015 — Committed checkpoint settles twice

- **Trigger:** Goal checkpoint or terminal tool commits output before the ordinary process-chat finaliser observes it.
- **Incorrect behaviour:** the run is treated as incomplete, retried or given a second terminal disposition.
- **Cause:** tool-side commit and outer orchestration did not share terminal state.
- **Evidence:** issue [#929](https://github.com/rcarmo/piclaw/issues/929); archive PR #940.
- **Baseline status:** Goal checkpoint integration is outside stable core contract.
- **Violates:** INV-04, INV-05.
- **Target prevention:** terminal commit is a Piclaw operation effector with idempotency key; harness receives/returns an already-committed outcome token rather than inferring from transcript.
- **Contract scenario:** `tool_committed_terminal_is_not_settled_twice`.

### REG-016 — Restart loses or misattributes pending steers

- **Trigger:** restart occurs after steer acceptance but before consumption or terminal settlement.
- **Incorrect behaviour:** steer disappears, replays twice, advances frontier incorrectly or attaches to a successor.
- **Cause:** pending steer timestamps live in memory while messages/cursors live in SQLite.
- **Evidence:** issue [#930](https://github.com/rcarmo/piclaw/issues/930); archive PR #941.
- **Baseline status:** stable `PendingSteeringStore` is in-memory.
- **Violates:** INV-01, INV-10.
- **Target prevention:** Piclaw accepted-source row records target operation and sequence; Harness v3 queue state/`pending.entry` is correlated; restart reconciles Piclaw state with the harness snapshot/current state.
- **Contract scenario:** `restart_preserves_pending_steer_fifo_and_owner`.

### REG-017 — Late steer races checkpoint successor settlement

- **Trigger:** Goal/checkpoint starts terminal settlement while a steer is accepted for the same run.
- **Incorrect behaviour:** steer is lost, applied after terminalisation or claimed by the wrong successor.
- **Cause:** acceptance and terminal owner release were not one serialised state transition.
- **Evidence:** issue [#931](https://github.com/rcarmo/piclaw/issues/931); archive PR #942.
- **Baseline status:** not safely represented in stable cursor model.
- **Violates:** INV-01, INV-02, INV-05, INV-10.
- **Target prevention:** operation version/sequence fence serialises steer acceptance against terminal commit; losing side receives explicit successor disposition.
- **Contract scenario:** `checkpoint_terminal_race_with_late_steer`.

### REG-018 — Repeated mutation loop poisons a branch

- **Trigger:** model repeats a successful state-changing tool call or recovery replays a mutation.
- **Incorrect behaviour:** external side effects repeat until budget exhaustion; later turns may inherit unsafe tool state.
- **Cause:** successful mutation identity/replay policy was not durable and containment lifecycle was incomplete.
- **Evidence:** issue [#935](https://github.com/rcarmo/piclaw/issues/935); archive PR #948; earlier tool-budget tests.
- **Baseline status:** stable has budgets but not the accepted durable quarantine campaign design.
- **Violates:** INV-07, INV-08, INV-09.
- **Target prevention:** mark tools `safe` or `never`; persist `effect_pending` arguments/state before admission and result settlement after it; quarantine unresolved `never` calls and hold tools until terminal settlement.
- **Contract scenario:** `repeated_successful_mutation_is_blocked_and_contained`.

### REG-019 — Protected recovery evidence leaks to timeline/events

- **Trigger:** runtime persists internal scheduling/protected-continuation metadata or emits raw tool data.
- **Incorrect behaviour:** users see internal records; sensitive arguments/results survive in normal timeline or status channels.
- **Cause:** operational evidence reused user-visible message storage and event payloads.
- **Evidence:** issues [#936](https://github.com/rcarmo/piclaw/issues/936) and [#946](https://github.com/rcarmo/piclaw/issues/946); archive PRs #943/#950.
- **Baseline status:** some redaction exists, but protected operation ledger is not separated.
- **Violates:** INV-14.
- **Target prevention:** keep Harness v3 storage/events restricted from the user timeline; project allowlisted fields only; owner-authorised erasure uses a separately reviewed administrative rewrite/audit path.
- **Contract scenario:** `protected_evidence_never_enters_user_projection`.

### REG-020 — SSE reconnect applies duplicate or stale generation events

- **Trigger:** EventSource reconnects/replaces while old callbacks remain deliverable.
- **Incorrect behaviour:** draft/thought resets, duplicate updates, stale approval/status or missing Abort authority.
- **Cause:** UI callbacks lacked exact connection generation and operation identity.
- **Evidence:** issues [#937](https://github.com/rcarmo/piclaw/issues/937) and [#947](https://github.com/rcarmo/piclaw/issues/947); archive PRs #944/#949.
- **Baseline status:** stable has ref-based reconnect handling but not complete exact-operation projection.
- **Violates:** INV-03, INV-12.
- **Target prevention:** Piclaw projects typed Harness v3 watch events under its operation correlation and watch/connection generation; client rejects older receipt sequences/generations.
- **Contract scenario:** `old_sse_generation_cannot_mutate_live_projection`.

### REG-021 — Compose Abort route or authority is missing

- **Trigger:** mobile/desktop stop button is shown from client-only active state while operation ID/agent route is missing or stale.
- **Incorrect behaviour:** undefined-agent request, refusal with `The active operation identity is not available`, or cancellation of replacement.
- **Cause:** UI active status was presentation state, not a fresh exact-owner snapshot.
- **Evidence:** issues [#951](https://github.com/rcarmo/piclaw/issues/951), [#954](https://github.com/rcarmo/piclaw/issues/954), [#958](https://github.com/rcarmo/piclaw/issues/958); archived PRs #955/#959; operational rollback note.
- **Baseline status:** installed mobile path was not accepted as proven before rollback.
- **Violates:** INV-02, INV-06, INV-12.
- **Target prevention:** stop button obtains fresh Piclaw operation authority; exact repeated abort is idempotent; installed iPhone E2E drives the real silence-watchdog producer.
- **Contract scenario:** `installed_mobile_abort_refreshes_and_cancels_exact_run_once`.

### REG-022 — Stale inherited async context blocks replacement mutation lane

- **Trigger:** queued Goal/continuation inherits old `AsyncLocalStorage` mutation context after the original lane exits.
- **Incorrect behaviour:** new operation fails with `generation_mismatch`, becomes blocked and later retries appear silent.
- **Cause:** ambient context outlived its owner and was treated as authoritative.
- **Evidence:** issue [#956](https://github.com/rcarmo/piclaw/issues/956); archive PR #957; rollback operational note.
- **Baseline status:** stable baseline predates the durable mutation gateway, but the lesson applies to the new boundary.
- **Violates:** INV-02, INV-03.
- **Target prevention:** no ambient authority. Piclaw validates explicit operation/run/generation before calling the exact `AgentLane` method.
- **Contract scenario:** `inherited_async_context_has_no_mutation_authority`.

### REG-023 — Scheduled agent output is delivered twice

- **Trigger:** scheduler calls `runAgent()` and both the run callback and scheduler delivery path write the response.
- **Incorrect behaviour:** two identical timeline messages; run-log/notification cardinality may diverge.
- **Cause:** agent execution and scheduler delivery both believed they owned output persistence.
- **Evidence:** issue [#960](https://github.com/rcarmo/piclaw/issues/960); archive PR #961; rollback operational note.
- **Baseline status:** defect present in stable scheduler design unless explicitly avoided by path.
- **Violates:** INV-04, INV-11.
- **Target prevention:** scheduled agent execution returns one harness outcome; Piclaw scheduler owns one timeline delivery and one run log. Shell and Pushover remain separate named effects.
- **Contract scenario:** `scheduled_agent_has_single_timeline_and_run_log_delivery`.

### REG-024 — Terminal side-effect tool masks an earlier failed tool

- **Trigger:** one tool fails and a later UI/exit side-effect tool succeeds without final prose.
- **Incorrect behaviour:** run is classified `tool_complete` despite failed required work.
- **Cause:** terminal-side-effect presence was considered without the whole tool batch outcome.
- **Evidence:** `run-agent-attempt-finalization.test.ts` and `run-agent-orchestrator.test.ts` terminal-side-effect masking cases.
- **Baseline status:** guarded in v2.13.2.
- **Violates:** INV-04, INV-07.
- **Target prevention:** Harness v3 total tool-batch state and committed result entries cover every call; completion policy evaluates the full batch and required effect set.
- **Contract scenario:** `terminal_side_effect_cannot_hide_failed_tool`.

### REG-025 — Provider length repair repeats the same effective cap

- **Trigger:** compaction output hits `length` under a context-constrained safe cap.
- **Incorrect behaviour:** repair requests half the configured cap but resolves to the same effective provider cap.
- **Cause:** retry used requested rather than effective cap.
- **Evidence:** `docs/audits/2026-08-05-code-change-audit.md`, defect 3.
- **Baseline status:** fixed in v2.13.2.
- **Violates:** INV-08.
- **Target prevention:** Harness v3 generation context stores effective stream options/retry policy in total state; later attempts derive from the actual captured request.
- **Contract scenario:** `length_repair_reduces_effective_output_cap`.

### REG-026 — Concurrent session rewrites corrupt or replace active ownership

- **Trigger:** manual/automatic compaction, navigation, prompt or a completion listener starts while another current-session rewrite is active.
- **Incorrect behaviour:** rewrites overlap, a stale abort controller/state owner is cleared, or a prompt continues against a replaced session generation.
- **Cause:** the current coding-agent runtime uses shared mutable session/rewrite state without one owner across every entry and completion callback.
- **Evidence:** Earendil PR [#7751](https://github.com/earendil-works/pi/pull/7751) at `f3e5cc82a44c0970d3e6935417b6fb4079dc3d2a`; issue-7738 regression tests cover manual/automatic compaction, navigation, prompts and listener re-entry.
- **Baseline status:** upstream PR remains open; Piclaw migration has no selected v3 backend/rewrite proof.
- **Violates:** INV-02, INV-03, INV-10, INV-15.
- **Target prevention:** ordinary Harness v3 mutations use one Session mutation line; host/worker lifecycle assigns one writable Session authority, closes the old owner before replacement and uses read-only snapshots for live external forks. Stale workers cannot retain writable authority.
- **Contract scenario:** `concurrent_session_rewrite_has_one_owner_and_generation`.

## Open issue requirements

Two open project issues affect the target architecture:

- [#401](https://github.com/rcarmo/piclaw/issues/401): a scheduler next-wake bridge should expose durable wake state without giving the harness scheduler ownership.
- [#428](https://github.com/rcarmo/piclaw/issues/428): turn error/outcome UX should project typed Piclaw/harness outcomes and must not parse rendered prose.

## Coverage rules

Every corpus scenario must run at the narrowest applicable layer:

1. pure Piclaw service-state/reducer replay;
2. Harness v3 direct-drive fixture with instrumented/gated storage and deterministic model/tool effects;
3. Piclaw service-plane fault-boundary integration;
4. restart/compaction integration with durable storage;
5. installed browser/service E2E for UI authority and process lifecycle.

A unit test alone does not close an operational regression involving service restart, installed bundles, mobile browser state, process groups or scheduler delivery.
