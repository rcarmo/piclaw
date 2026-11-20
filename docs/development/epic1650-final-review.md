# #1650 integration review and whole-range accounting

This review records the 17 November source, deployment and accounting ranges. See the [subsequent #1650 acceptance record](epic1650-acceptance.md) for the later MCP cutover, live checks and forward-recovery contract.

The native runtime migration is deployed at Core `b9dd5ec79e938e3ddeed168472c0d4ac305486c3`. The retained integration review found no evidenced runtime blocker in its declared source partitions. Live authentication, server, recovery and real-work latency acceptance still prevent closing the epic under its current requirements.

This review fixes two current design documents that described removed resident capture and `runAgent` compatibility paths. It changes no runtime implementation, supported feature, SDK package or live data.

## Exact targets and evidence

| Surface | Target |
| --- | --- |
| Core source and deployed implementation | `b9dd5ec79e938e3ddeed168472c0d4ac305486c3` |
| Core tree | `b1e8397b978e9c7dc6e140f7ac8f868afbfbdd74` |
| Add-ons main used for accounting | `d534f90e8507db71cdb736afdbd0539c8fa4f802` |
| Public and physically separate private/native SDK | `1.5.2` |
| OpenAI package | `7.52.0` |
| Automatic exact-main CI | [44110930934](https://github.com/rcarmo/piclaw/actions/runs/44110930934), passed |
| Deployed process | Smith/LXC/systemd-user, PID1927612, started17November17:37:10UTC |

The authorised deployment verified all1055 installed source hashes, private dependency guard, public CLI paths,20approved add-on profiles, seven protected canonical files, live config/add-on metadata and DBdevice:inode50:84037. Passive loopback HTTP returned200. Its fresh checks were17build tests/67assertions,10submission units/34assertions and39scoped Chromium/WebKit cases/522assertions. Earlier failures and exact-source full/native receipts retain their original scope; no new whole-full result is inferred here.

All seven direct sub-epics are closed: #1817, #1857, #1875, #1885, #1886, #1891 and #1892. #2017, #2039 and current watch qualification #1494 are also closed. #1455 was consolidated without certifying its unfinished acceptance.

## Independent retained-integration review

Approved read-only `github-copilot/mai-code-1.1-flash` analyses covered the current engine integration and direct Core consumers in explicit partitions. [The coverage receipt](receipts/epic1650-final/integration-review.json) lists103unique source paths and their SHA256 values. Coverage is reviewer-reported source reading, with parent adjudication of concrete findings and source hashes.

| Partition | Files | Result |
| --- | ---: | --- |
| Lifecycle, accepted bindings, recovery, terminal and process controls |11| No evidenced runtime blocker |
| Provider/model, MCP, Delegate and credential store |20| No evidenced runtime blocker |
| Storage, import, profile/catalogue and operation authority |9| No evidenced runtime blocker; generated profile entries checked through generator/catalogue invariants |
| Default application runtime and private/background ingress |6| No evidenced runtime blocker |
| Bootstrap and external Core adapter/bootstrap consumers |3| No evidenced runtime blocker; stale design documents confirmed |
| Goal, scheduler terminal, Dream and Regrets integration |13| No evidenced runtime blocker |
| Remaining host/domain tools, Plan, remote peer, historical readers, CLI and extension registry |29| No evidenced runtime blocker |
| Central AgentPool, service wiring and native control/model facade |3| No evidenced runtime blocker |
| Branch, ownership, MCP settings, routing and product contracts |7| No evidenced runtime blocker after finding adjudication |
| Database branch/handle namespace boundary |2| Rename finding rejected against source policy and existing regressions |

The final evidence audit found the central AgentPool/service boundary missing from the initial91file inventory. Follow-up partitions covered that boundary. One reviewer then reported a null-actor rename bypass; parent and independent adjudication rejected it. Null explicitly permits single-user unscheduled metadata operations, while scheduled/non-single-user contexts and migrated owner namespaces keep their separate denial gates. All61existing request-admission, branch, routing and handle regression cases passed with267assertions. No product permission was broadened or rename API removed.

The first composition analysis returned no output and supplied no clearance. The first storage analysis omitted many leaves. Smaller completed partitions cover those omissions; the incomplete attempts remain recorded in the receipt. No account, production database or external server was accessed by reviewers, and they ran no tests.

This is a review of the declared current integration graph. It is not a fresh independent review of every historical change in both repository ranges or a universal security certificate. Earlier child deliveries retain their own accepted review and qualification evidence. A broader whole-series claim must retain that distinction.

## Removed owners and current call paths

| Concern | Earlier execution path / owner | Current path / retained boundary |
| --- | --- | --- |
| Conversation execution | Web handler → `AgentPool.runAgent` → legacy session construction/orchestration → AgentSession prompt | Authenticated application ingress → exact native conversation/source → public SDK submission/tasks; no Core `runAgent` or session constructor |
| Session lifecycle and warmup | Session manager/binder, prewarm/replay and eviction/pressure/GC paths | One SDK application; AgentPool provides product metadata/controls and a captured native position lookup |
| Delegate | Installed package execution/loader/profile dependencies | Core declaration/approval policy → public SDK child conversation/submission/result; retired package excluded before evaluation and externally deprecated |
| Context and compaction | Legacy smart-compaction algorithms, duplicate projections and orchestration | Public SDK context/compaction and committed entry/task projections; supported historical decoding retained |
| Provider authentication | Legacy AgentSession auth subject/interception/bypass/disposal integration | Provider-owned ModelRuntime/Models authentication with the existing serialised Core credential store and explicit source/privacy checks |
| Expense enforcement | Financial admission, cap, reservation and execution barriers | Removed by #1875; tokens, model prices and reported provider costs are observational |
| Existing history | Resident capture/cutover/conversion and legacy constructors | Explicit bounded offline import into a fresh separate SQLite destination; ordinary Core execution remains native |
| MCP | Legacy switch/fallback and adapter runtime ownership | Public tools-only `McpClient`, actual transport close and invocation-local Core authority/credential leases |

These are logical product-to-engine paths, not a claim that arbitrary external effects became atomic. [Current composition](native-host-composition.md), [input boundary](native-runner-boundary.md), [operation binding](native-operation-binding.md), [input retirement](native-input-retirement-review.md) and [offline import retirement](session-import-retirement-2017.md) name the actual owners and tests.

## Retained product and public-SDK boundaries

| Retained integration | Exact constraint and consumer | Replacement/removal condition |
| --- | --- | --- |
| `BunSqliteDatabase` | Implements the public `SqliteDatabase`/executor contract for Bun, exact shared-file ownership, acquisition-only retry and source persistence in the SDK write transaction. The SDK interface does not supply Core's authenticated timeline/source check. | A qualified public Bun adapter with the same borrowed-root/transaction/close contract can replace the adapter; product source checks must still have a real owner. |
| `host-models` | Crosses the deliberately separate Root ModelRuntime and private Models type/runtime boundary using admitted JSON-shaped requests, current physical model/provider selection and result privacy. It cannot grant host auth mutation or invent provider callbacks. | A qualified shared public boundary carrying the same source/auth/privacy contract removes the bridge; package-version equality alone does not remove physical/type ownership constraints. |
| Accepted-source, operation and terminal bindings | Public SDK tasks do not authenticate Core HTTP/channel principals or publish Core timeline/delivery identities. Core binds exact accepted source bytes, submissions and terminal outcomes without a second execution scheduler. | Replace individual joins only with a supported transaction/source publication boundary that preserves the actual product identity and uncertain outcomes. |
| Installed/domain tool authority | SDK tool execution identity does not itself authorise Core file/process/SSH/add-on resources. Dispatch and result checks bind current principal, source, task, policy and resource. | Remove an adapter when its actual product consumer retires or an equivalent qualified capability binding replaces it; never infer zero external effects after uncooperative cancellation. |
| `host-mcp` | Public `McpClient` owns protocol calls. Core owns startup config, exposure policy, current accepted source and keychain/env lease retention. Failed close cannot release that lease. | A supported equivalent product source/lease lifecycle can replace the mapping; generic prompts/resources/Apps/hot replacement are outside the qualified tools-only profile. |
| Historical import/schema readers | Supported old data and explicit offline v3 input require exact historical shape/identity checks. The SDK does not define Core's former schema. | Remove only after the actual supported data/import contract retires; no resident conversion or old engine is required. |
| Protected tool-preparation metadata | Four original #1875 metadata files and frozen source oracle retain historical/test classifications. They are separate from current native parity. | Separate evidence-retention decision; no runtime owner or deletion credit follows from these declarations. |
| Standalone `pi` | The user expressly retained this JSONL-backed terminal fallback. | A later explicit product decision, such as #2038, may add durable terminal support. No Core JSONL fallback is permitted. |

The absence of a general SDK primitive for conditional physical-generation abort, uncooperative bounded close or arbitrary external exactly-once effects supplies no reason to recreate a host engine. The current supported controls retain exact accepted-operation scope and uncertainty.

## Whole-range cross-package accounting

[The accounting receipt](receipts/epic1650-final/production-accounting.json) uses the last first-parent main commit before epic creation2026-10-15T21:16:24UTC in each repository:

- Core: `09ba20064965ba5f9fa5430e0721cfe106c343d7` → `b9dd5ec79e938e3ddeed168472c0d4ac305486c3`.
- Add-ons: `de92bc95b5b3bb1505beec9617d3b8a5e4fa92d3` → `d534f90e8507db71cdb736afdbd0539c8fa4f802`.

These are objective whole-range measurement baselines. Both ranges include unrelated product changes. All measured additions are charged; the table supplies no claim that every deletion belongs causally to #1650. Individual child/batch counters are not added into these totals.

| Repository / area | Physical additions | Physical deletions | Physical net | Runtime-token-bearing line net | Runtime-token net | Source-file net |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Core backend |25614|56199|−30585|−14745|−45442|−83|
| Core frontend |5507|7563|−2056|−1614|−15420|−5|
| Core tooling |1367|2092|−725|−567|−1443|+4|
| Add-ons backend |3972|7440|−3468|−2518|−6092|+1|
| Add-ons frontend |514|586|−72|−114|−388|−1|
| Add-ons tooling |169|18|+151|+85|+608|+1|
| Combined measured source |37143|73898|−36755|−19473|−68177|−83|

Backend source alone is34053physical lines smaller, with17263fewer runtime-token-bearing lines and51534fewer runtime tokens. Implementation-bearing backend files decrease by78. These are measurements of the complete declared ranges; they are not a new exclusively attributed deletion-credit total.

Physical LoC includes comments and declarations. The second metric excludes comments, TypeScript-only declarations/import-export declarations and static literal/enum data. Runtime namespace bodies and dynamic enum initialisers remain measured. Runtime tokens provide a formatting countercheck; neither metric proves behaviour. Generated output, minification, vendors, tests, fixtures, declarations-only files, documentation, immutable archives, static/legacy generated assets and templates earn no reduction credit. AssemblyScript receives physical measurement only, because it is a separate language. The two unchanged Babel diagnostics occur inside excluded TypeScript annotation spans in the editor source and are recorded by the producer; no runtime parse diagnostic is accepted.

Moves inside the measured repositories are charged on both ends. Retained deprecated package/archive bytes are not counted as deletion. Known moved declarations/data are not fresh backend credit. The earlier disjoint5f→1e17batch6445attributed-line result remains its own bounded receipt; it is not added to this table.

The [offline producer](receipts/epic1650-final/account-production.ts) reads Git objects, never application state or measured code execution. It records every measured source blob, its classification, per-area additions/deletions and before/after metrics; asserts whole-range line conservation and zero unclassified candidate source paths; and runs twelve type/data/comment/formatting/runtime-namespace/dynamic-enum/parser-refusal counterexamples. Its analysis program and these receipts are evidence-only additions, outside the shipped runtime, and earn no backend reduction credit.

Reproduce with frozen Core development dependencies and both repositories' history available:

```sh
bun docs/development/receipts/epic1650-final/account-production.ts \
  /path/to/piclaw /path/to/piclaw-addons /workspace/tmp/piclaw/runs/epic1650-accounting-check
```

Run repository-owned checks through the central `test:local` launcher with effective niceness≥10. The receipt records Bun1.4.4 and Babel parser/types8.1.2.

## Acceptance still requiring a decision

| Tracker | Unproved requirement | Required next authority/evidence |
| --- | --- | --- |
| #1458 | Real account login/refresh/rotation/revocation, broader private/log/export/keychain and in-flight boundaries; direct SDK malformed-response limitation outside the Core store | Named provider/account/method and bounded allowed actions. Normal assistant use and synthetic providers do not execute this matrix. |
| #1456 | Named server/UX canaries and coherent current restore/post-cutover-write/token-rotation handling | Select actual required operations and compatible recovery procedure. No new backup copies, live restore or old-token restoration is authorised by this review. |
| #1907 | Current real-work latency and any demonstrated causal stall repair | Separate unchanged90second startup/600GET workload approval: zero HTTP failures, maximum≤1500ms, p95≤500ms. The historical maximum4336ms failure keeps its original source/date. |
| #1650 wider contract | Explicit acceptance or exclusion of general external exactly-once/zero-effect claims, physical-generation abort, noncooperative cleanup, all provider/transport/fleet combinations and superseded full/reverse conversion | Explicit supported-scope decision. Source gates and this review cannot silently accept or emulate those contracts. |

The current request completes the permitted source review, documentation and accounting work. It does not waive these remaining epic requirements, approve named live operations or close #1458/#1456/#1907. #2038 durable terminal work and #2044 RSS remain separate Inbox proposals.
