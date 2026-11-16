# Dormant durable projection retirement

The unselected EF-S08 projection bridge and cursor sink are removed from executable Piclaw. Current native conversation watches, UI views and committed-terminal publication keep their existing implementations.

## Consumer decision

Implementation base: `ed0e58042e99dac27f79bb15f685ff2b351d47d8`. Its two backend trees equal the review pin `6eec077c222c1451da0939d2b0edffc119cb18bd`. SDK pins remain 1.4.0.

| Surface | Decision and actual consumers |
| --- | --- |
| `durable-engine/src/host-projection.ts` | Remove. Only the private barrel re-exported it; calls belonged to the exclusive projection qualification prototype. |
| `service-effects/current-piclaw/agent-projection-sink.ts` | Remove. Its only production importer was the unselected bridge. Contract/fake/mixed tests were the other consumers. |
| `service-effects/contracts/agent-projection-sink.ts` | Remove the exclusive type contract. Its 71 lines receive zero implementation credit. |
| Projection fake, contract suite, catalogue entry and `qualification/native/projection.test.ts` | Retire the deliberately removed prototype only. Testing/support/qualification deletion receives zero backend credit. |
| Existing delivery contracts and boundaries | Keep. All five driver families retain their original 18-case contract assertions, certainty, payload, transport, cancellation and ownership checks. Mixed files lose only EF-S08 imports, helpers and cases. |
| Native SDK observation and settlement | Keep. `HostConversationRuntime.watchSession` uses public `conversation.watch`; actual native views and committed terminal/cursor publication have current application callers. |

The inventory covered tracked files including tracked ignored paths, static/type/literal-dynamic imports, registration, package exports, CLI consumers and approved/current/installed add-ons. The production selector imports the fixed `default-application-runtime.ts` entry. It does not discover arbitrary integration files. The engine is private, but the root package distributed its source: private status or one missing import alone was insufficient evidence. No supported live or offline consumer selects this prototype.

## Removed path and accounting

Before, the dormant path translated SDK `watchEvents` into `PublicAgentEvent`, then an EF-S08 cursor/Result protocol, then old UI DTOs. After, that whole path is absent, with no replacement adapter or state owner. One unused observer lifecycle and one cursor map each become zero. The active native path remains unchanged; no performance or active SDK call-depth improvement is asserted.

Stable backend inventory:

| Metric | Before | After | Raw reduction |
| --- | ---: | ---: | ---: |
| Physical lines | 142,634 | 142,266 | 368 |
| Nonblank lines | 132,294 | 131,958 | 336 |
| Files | 710 | 707 | 3 |

Only original function/class declaration spans receive conservative implementation credit:

- `observeProjection`: 83 physical / 83 nonblank.
- Sink class and helpers: 145 / 135.
- **Credited net reduction: 228 physical / 218 nonblank.**

All other 140 physical / 118 nonblank lines—including the type contract, imports, constant data, outer comments and two barrel exports—are fully charged as non-credit removal. No implementation is relocated or added in another path/package. Generated source-pin data is unchanged and earns zero credit. The excluded source-support set changes separately from 32 files / 12,910 physical / 12,388 nonblank to 30 / 12,551 / 12,043; those deletions earn zero production credit.

The [machine receipt](receipts/durable-projection-retirement-1835.json) includes original hashes/spans and exact scope. This is #1809 F1; #1812 owns its delivery credit, with #1815 cross-linked. It does not repeat #1270 or #1683 credit.

## Qualification and historical evidence

The retirement checks fail against the original source in all four cases, then pass after deletion. The directly affected delivery/catalogue/retirement matrix passes 47 cases / 624 assertions. The retained EF-S06 catalogue is byte-identical with the base: 17 named cases plus one crash oracle form the existing 18-case contract. An initial new-test assumption treated all 18 as catalogue entries; only that new assertion was corrected. Original driver assertions and production guards were untouched. A new-test readonly matcher typing error was fixed by copying the expected tuple, without a cast or suppression. Both failed receipts remain recorded.

Actual native events (182 assertions), cursor ACK (34), close/reopen (22), SDK view/progress (4 cases / 17 assertions), and disposable Chromium/WebKit × both skins × valid/malformed history (8 cases / 104 assertions) pass. Normal source/private/qualification type projects and strict new-test typing pass. These fixtures use owned frozen graphs and add-on revisions ad7/087, isolated storage and synthetic providers; no live profile or network/provider probing.

Scoped extension imports, the 545-file runtime graph with zero cycles, environment observations and package checks pass. General import checking retains 25 pre-existing findings, byte-identical under the same invocation against an unchanged-base source copy; it is not green and no rule/exemption changed. The runtime package excludes the retired bridge/sink/contract while retaining current runtime, factory and UI-state owners. Required final repository/native gates, review, automatic CI and exact merged-head verification remain integration steps.

Original prototype source, tests and case definitions remain at [the immutable implementation base](https://github.com/rcarmo/piclaw/tree/ed0e58042e99dac27f79bb15f685ff2b351d47d8). Earlier dated ADR/qualification results remain historical receipts. The qualification README labels that observation-only prototype retired; no original hashes, unsupported outcomes or history were regenerated.

## Scope and rollback

Reverting restores dormant source only; no data rollback is needed. No SDK/pin upgrade, new framework, supported feature removal, schema/data/history mutation, live configuration/credentials, installation/restart, backup/retention/schedule change or restore promotion is included. This bounded slice does not complete #1809 until the agreed batch and final findings reconciliation are accepted.
