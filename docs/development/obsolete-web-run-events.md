# Obsolete web run-event adapters

The uncalled AgentSession-to-SSE adapter, its display scheduler and legacy response publisher are deleted under #1277. Their producers/callers disappeared under #1673/#1674. Current native watches and committed terminal publication keep their existing implementations and browser event names.

## Usage and owners

Implementation base: `fc587de57babb118b5f0fd2ace406548bd04bbfa`.

| Surface | Decision and evidence |
| --- | --- |
| `sse/agent-events.ts` | Delete the unused `createStreamingEventHandler`, `createAgentEventEmitter`, payload/handler interfaces and private casts. No production factory, bootstrap, registry, package entry or channel constructor calls these exports. |
| `sse/display-update-coalescer.ts` | Delete. Its sole production caller was the removed adapter; its pending map and cadence timer have no surviving owner. Native SDK watches already provide the current projection input. |
| `messaging/agent-message-store.ts` | Delete the uncalled `storeAgentTurn`, private attachment mapper, placeholder/publication callbacks and legacy push invocation. Its only production relationship to the adapter was an emitter type import. |
| `agent-pool/recovery-classification.ts` | Remove from executable Core. Its sole production caller was the retired adapter. Preserve its exact opaque-string classification rules as an **unpackaged test oracle** in `runtime/test/helpers/recovery-classification.ts`; credential and version-compatibility assertions still use them. Charge all 57 physical/51 nonblank moved lines against deletion credit. |
| Native watch/terminal owners | Keep `default-application-runtime.ts::ensureLiveWatch/publishTerminal` and `agent/native-turn-view.ts::createNativeTurnView`. Native watches feed existing thought/draft/status frames; committed native terminal messages emit `new_post`. |
| Current store/queue/push/auth/accounting owners | Keep. Input admission, accepted source identity, atomic settlement, queued source materialisation, native cancellation/uncertain cleanup, media storage and active extension/notification paths are unaffected. |

Tracked inventory covers ignored tracked files, static/dynamic imports, public and runtime registrations, package files/scripts and approved add-ons at `ad7ad0a4b63ee37090b6bee4309fa5c458ec6510`. The three source graphs (`index.ts`:546 reachable; AgentPool:324; native factory:635) contain none of the retired adapter/publisher closure. The later classifier inventory proves that its only production importer was this same adapter. No module loader discovers this directory by convention. The root package broadly included these sources; package-content validation must establish their absence after deletion.

Five approved voice-pipeline matches named `storeAgentTurn` refer to that add-on's own SQLite helper, **not** this Core module. That supported implementation is untouched. Historical baseline-test basename classifiers and Git receipts do not install these APIs. Unsupported arbitrary external deep imports were not observable and receive no runtime compatibility stub.

## Paths and reduction

The dormant path `AgentSession events → streaming adapter/display scheduler → emitter facade → channel SSE hub` is removed, as is the independent legacy `storeAgentTurn → channel store/placeholder → emitter/push` path. Adapter implementation1→0, custom display scheduler/timer owner1→0, legacy publication owner1→0. No replacement event bus, facade, callback registry or scheduler is added.

The active path is unchanged: `SDK watch → native turn view → channel SSE hub`, with committed terminal publication in the default factory. Dormant deletion supplies no claimed speedup or active-path depth change. #1273 separately measures the real timeline forwarding reduction.

Stable #1270 source rules give 146,885→145,369 physical lines, 136,386→134,951 nonblank and 728→724 production files: gross **−1,516 physical/−1,435 nonblank**. After charging the relocated classifier57/51, genuine reduction is **−1,459 physical/−1,384 nonblank**. No other production implementation is moved or added outside the roots. Test/profile/doc changes receive zero production credit; the one-line consumer-comment correction has zero metric delta. The [machine receipt](receipts/obsolete-web-run-events-1277.json) records the source hashes and charge.

## Coverage and historical tests

- Retire tests whose sole subject is the deleted AgentSession adapter, its scheduler or uncalled publisher, including synthetic legacy recovery/compaction events and publisher-only placeholder/push callbacks. Their code and outcomes remain in immutable Git history; supported native execution does not pass through those fixtures.
- Preserve credential/redaction/provider-format assertions unchanged. Ten imports move to the exact test oracle; no expected classifications or safety assertions change. Current public-runtime auth fixtures still prove no network/inference and redacted failures.
- Keep the attachment publisher double explicitly scoped to current message storage: use `WebChannel.storeMessage`, retain all source-row/media/content-block assertions, and do not claim that the double qualifies native settlement. Actual native factory evidence separately covers settlement/publication.
- Replace the dead display-throttle fixture with the actual native renderer and SSE hub: accepted input and new-turn working feedback appear synchronously, with correct source/turn identity and no prior draft replay.
- Defining absence test fails against the old source. Current native preview/delta/tool/retry/privacy/reattach tests, committed native terminal publication/cursor handoff and actual native cancellation pass through their real surviving owners.

Focused evidence:9 host cases/48 assertions for retirement/native view/reattach/priority/import boundary; attachment1/4; unchanged credential/format oracle tests77/882; current public-runtime auth8/48. Actual default-factory cases: `native-events`1/182, `native-web-cursor-ack`1/34, `native-codemode-cancel`1/40. Three source type projects and strict new-test/oracle compilation pass. Circular graph546/0cycles and environment observations pass. Package dry-run (scripts disabled) excludes all four retired production paths and the test oracle while retaining native view/factory/store/push owners.

The general import-boundary checker still reports25 pre-existing findings, byte-identical to unchanged fc587 under the same invocation; no import/scan rules or exemptions are relaxed. Automatic repository CI and user-approved integration are additional evidence, not supplied by these local receipts.

## Native side-model event contract

After the substantive deletion, the surviving `SidePromptOptions.onEvent` boundary accepts the SDK's `AssistantMessageEvent` only. Its actual producer is `host-models.ts`; `default-application-runtime.ts` checks the captured source/current owner and clones the event before the side observer receives it. `application-bootstrap.ts` forwards native text/thinking deltas and detaches failing or cancelled observers. No current source or approved add-on emits AgentSession lifecycle events through this path.

The follow-up removes the obsolete AgentSession event-family union/import and the clone callback's `as any`. Compile-negative cases in `qualification/native/side-prompt-event-types.ts` reject session lifecycle/compaction events and missing/wrong native fields, with a positive SDK native-event case. The **existing** qualification type project includes this plain compile-only fixture, so the repository gate enforces it without a new test runner or event abstraction. Before narrowing, two unused `@ts-expect-error` diagnostics prove the old union accepted the retired families; afterward all three type projects and the real native side-dispatch scenario (123 assertions) pass.

This supporting typing follow-up has **zero physical/nonblank LOC or file-count delta** in production and earns no extra reduction credit. The substantive PR's −1,459/−1,384 after relocation charge is unchanged. See [side-boundary receipt](receipts/native-side-events-1277.json).

## Compatibility and rollback

No current native/browser wire contract changes. Old recovery/compaction/summarisation producer APIs have no supported runtime caller. Shared preview/title utilities retain native and handler callers. Existing native SDK and host boundaries retain source IDs, budgets, error redaction, cancellation, terminal ordering and resource ownership.

Reverting restores source and test wiring only; no storage/schema/state rollback is needed. Historical #1673/#1674 deletions receive no duplicate credit. This source-only slice performs no installation, restart, dependency upgrade, credential/history/data operation or branch/worktree cleanup. Final child acceptance requires merged-head revalidation; it does not complete #1270.
