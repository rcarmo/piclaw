# Assessment quality review

Review baseline: Piclaw `v2.13.2` behavioural evidence; ADR refresh based on Piclaw `d921fd4b5244074e9a76dc46244633e8ff5981a8` and pinned Earendil evidence observed on 2026-08-14.

Result: **decision-ready with explicit post-approval implementation gates**.

## Scope and integrity

- Production/runtime changes: **0**.
- Changed paths from `v2.13.2`: ADR Markdown files only.
- Refresh worktree base: `d921fd4b5244074e9a76dc46244633e8ff5981a8`; documentation-only branch reviewed independently from production installation.
- Post-release campaign: preserved at `archive/post-v2.13.2-fixes-20260810` and in a verified complete Git bundle.
- Markdown links: checked as local paths across the ADR bundle.
- Whitespace: `git diff --check` passes.

## Evidence completeness

| Measure | Result |
|---|---:|
| Current capabilities | 59 |
| Regressions/incidents | 26 |
| Invariants | 15 |
| Piclaw surfaces classified for effector reuse | 36 |
| Future Piclaw-owned interfaces specified | 9 (`EF-S01`–`EF-S08`, `EF-H01`) |
| Direct Earendil boundary specifications | 5 (`EB-01`–`EB-05`) |
| Documentation work packages | 11 (`WP-0A`–`WP-3C`) |
| Direct Earendil contract families detailed | 11: harness, operation result/error, action/snapshot, storage/session, model/credential, tool, environment, resource, compaction/retry, events/hooks, telemetry |
| Harness contract cases | 25 |
| Piclaw boundary contract cases | 20 |
| Earendil assumptions | 10 |
| Migration phases | 9 (`M0`–`M8`) |
| Capabilities with owner/mechanism/test traceability | 59/59 |
| Regressions with mechanism/test traceability | 26/26 |

## Quality-bar review

| Criterion | Evidence | Result |
|---|---|---|
| Pinned baselines | ADR index and evidence E-001/E-002 | Pass |
| Existing functionality captured systematically | `current-capability-matrix.md` | Pass; named evidence-strength gaps retained |
| Known defects treated as specification | `regression-corpus.md` | Pass |
| Every durable responsibility has a target owner | capability and traceability matrices | Pass |
| Future effectors are implementable over current internals | `future-effector-specifications.md` gives complete illustrative types, adapter source maps, fakes, fault cases, effort and dependencies | Pass as documentation; no code authorised |
| No reuse of current Piclaw orchestration | effector classification rejects agent pool, process-chat/recovery/compaction orchestration | Pass as design constraint; implementation boundary test is an M1 gate |
| Earendil structure adopted early | historical 0.84.1 contracts, current 0.84.4 compatibility evidence, authoritative `main` design and draft PR #8076 storage/primitives pinned separately | Pass |
| Parallel execution abstractions removed | `direct-type-audit.md` separates Earendil-owned from Piclaw service-owned types | Pass |
| Real installed harness viability checked | current 0.84.4 Harness operations remain unsupported; PR #8076 has v3 storage/primitives but no concrete public harness runtime | Pass |
| Selected-version test implementation specified | fixture layout, manual driver, direct Earendil `Models`/tools, fault plan and assumptions | Pass |
| One semantic suite can target fixture and real harness | direct Earendil factory input and version-migration report | Pass as specification; implementation is an M1/M4 gate |
| Replay and fault boundaries specified | target state model and selected-version fixture cover intent, `EffectGate` admission, unknown effect-start outcome and settlement | Pass |
| Exact-owner cancellation specified | operation/run identity and cancellation protocol | Pass |
| Atomic terminal settlement specified | nine-step transaction/protocol | Pass |
| Restart reconciliation specified | Piclaw service log correlated to bounded Harness v3 current-state reads/`lane.lastResult`; no v2/private recovery-query dependency | Pass |
| Scheduler delivery ownership specified | scheduler model and PC-012/013 | Pass |
| Mobile installed-browser acceptance specified | PC-015 and M5–M7 installed gates | Pass |
| Alternatives compared | five alternatives with selected direct-adoption/selected-version-fixture architecture | Pass |
| Migration and rollback reversible | M0–M8, per-chat backend cutover and no destructive downgrade | Pass |
| Storage/concurrency gates specified | upstream backend conformance plus total open-operation migration and precise-rewrite/writer races | Pass |
| Unsupported claims labelled | ten assumptions updated for authoritative design, draft implementation and tagged-release resolution gates | Pass |

## Original baseline test evidence

The original documentation-only review reran representative stable tests with inherited MCP/browser compatibility variables removed:

- focused recovery/compaction/tool/queue/restart/scheduler slice: **100 pass, 0 fail**, 313 assertions across 9 files;
- web-channel and main run-orchestrator slice: **162 pass, 3 pre-existing skips, 0 fail**, 838 assertions across 2 files;
- MCP keychain isolation probe: **8 pass, 0 fail** with `PICLAW_MCP_MEMENTO_TOKEN` unset; **7 pass, 1 fail** with the host-injected token.

The original pre-push guard was attempted on documentation-only commits. It reached the baseline suite and failed on the inherited MCP token assumption. The guard bypass and its reason are recorded in E-010. At that review point, no runtime source differed from `v2.13.2`; later dependency-selection evidence is recorded separately.

## Independent-review limitation

One agent produced the assessment and this quality review. No independent reviewer has approved the architecture. The ADR therefore remains **Proposed**, not Accepted.

An independent review should challenge:

- whether Piclaw should own the accepted-source sequence and terminal frontier;
- whether timeline persistence can participate in the same transaction as operation settlement;
- whether fixture semantic assertions distinguish product invariants from version-specific Earendil details;
- whether M5 (service authority before execution cutover) is the safest order;
- whether per-chat rollback can preserve context without uncertain tool replay;
- whether the semantic suite covers add-on/extension resource migration sufficiently;
- whether the selected Harness v3 implementation faithfully delivers bounded restore, `lane.lastResult`, process-local task ownership, `EffectGate` admission, external finalisation and total schema migration;
- whether precise rewrite and backend writer leases are sufficient for PR-#7751-style concurrency;
- whether Piclaw should wait for one coherent tagged release as this refresh recommends.

## Post-approval gates

The future-effector specification is documentation only. Its TypeScript blocks are illustrative and its work packages organise later design/implementation reviews. These are implementation evidence, not missing assessment prose:

- implement the selected-version fixture and semantic suite in M1;
- prototype/benchmark the Piclaw operation schema in M2;
- track draft PR #8076 as moving development evidence without selecting it;
- select one coherent tagged Harness v3 package/backend set and update Piclaw to its direct types;
- run HC-001–HC-025 plus selected backend conformance, migration and rewrite-race suites against the real harness in M4;
- measure shadow/soak and resource budgets;
- complete installed-service/mobile/restart/rollback gates before cutover.

## Review decision

The assessment satisfies the agreed documentation quality bar and is ready for Rui's architecture decision. Approval authorises planning/implementation of M1 only; it does not authorise production cutover, dependency upgrade, schema deployment or service restart.
