# Native web UI observations

Native working state comes from the bound SDK conversation watch. Context meters come from its current context and model. Web status/context observations have no persistent host or browser copy and grant no execution or recovery authority.

## Field ownership

| Data | Owner and durability |
| --- | --- |
| Accepted inputs, queue payloads and provenance | S01 and the existing queue/input stores; durable user intent, independent of UI observations |
| Host operation phase, cancellation and terminal settlement | Existing host contracts; distinguish accepted work from provider/tool execution |
| Current model/tool activity and streamed model text | Public SDK `pi.live`/entries; projected onto existing status, Thought, Draft and Output surfaces |
| Context count/window | Bound SDK context/model, fenced across the awaited read; unknown clears meters |
| Latest-run token/cache/cost telemetry | Independent usage ledger; retained when context becomes unknown |
| `router_state:last_agent_timestamp_web` historical `agentStatuses`/`contextUsages` | Obsolete observations; no reads, writes or restoration by the web projection |
| Historical `draftRecoveries` in that JSON | Uncommitted **model** draft evidence; opaque and inert, not the user's unsent composer text |
| Unsent user composer text | Existing Classic component state; survives server interruption while the page remains open |
| Preferences, editor buffers and compose history | Existing preference/KV/browser/editor owners; unchanged |
| `web:oobe:provider-ready:completed` | Durable instance setup choice; retained independently |
| Polling cursors and other router keys | Their existing owners, including cursor migration; unchanged |

The retirement deletes `WebChannelState`, its status/context persistence, startup restoration and the `loadState`/`saveState`/`setContextUsage`/`getContextUsage` web forwarding APIs. Context commands publish through existing SSE events without copying the result into host state. There is no replacement persistence class or compatibility forwarding API.

## Reconstruction and bounds

`HostConversationRuntime.watchSession` delivers the current public conversation view before starting its subscription. `createNativeTurnView` binds the run's actual SDK input IDs to the primary host source or an exact same-operation/chat/conversation intent binding. A run containing only a late intent can therefore reconstruct the original turn without submitting another input.

`AgentStatusStore` retains at most 128 chat observations. Terminal hints expire after 15 seconds; eviction and disposal remove their expiry timers too. Model thought/draft buffers retain their existing 50-entry bounds. Capacity eviction can remove rich display detail: accepted host work/queue remains visible, and a fresh SDK watch reconstructs detail. A cached tool for a different operation cannot be relabelled as the newly accepted operation or pending queue.

Classic retains at most 128 page-local context values, with monotonically increasing revisions so eviction cannot alias an older request. The shared UI transport retains its existing bounded per-chat replies. The web UI ignores historical browser context keys (`piclaw:ctx:*` and `piclaw:context-cache:*`), including malformed values, without deleting them.

Connection boundaries invalidate context even when the SDK session identity is unchanged. Classic status/context refreshes use the connection generation, preventing reconnect from joining an obsolete request. The web UI fences delayed status/context bodies. Authoritative `contextUpdate: "replace"` clears counts when the same session is unknown or the binding is unavailable. The page can retain the last accepted identity for revision/stream fencing; this never restores its old counts. Unscoped legacy updates cannot replace a known Classic observation.

Timeline publication and search retain their existing durable owners. A status/context read neither reconstructs history nor decides recovery, schedules work, changes source membership or republishes an old model draft.

## Compatibility and rollback

No schema migration, router-row deletion or historical JSON rewrite is required. Old JSON, including malformed bytes and unknown fields, remains untouched. Setup, preferences, queue provenance and history are retained. The change adds no new browser-reload durability guarantee for composer text: it preserves the established open-page behaviour.

Source rollback can still read the old historical JSON. An older binary may resume trusting obsolete hints, so rollback needs the usual operational review; this source change does not authorise a live downgrade, cleanup, install, deployment or restart. Backups and migration receipts remain unchanged.

## Focused qualification

> Historical qualification of the original delivery. Visual was later retired in #1990.


- `qualification/pi-durable-130/native-ui-projection.test.ts`: actual shared-file SDK generation close/reopen, exclusive owner replacement, tool reattachment after real cache eviction, and tool close/reopen. Observations do not resume interrupted unsafe work or replay completed effects; context, exact submissions, historical JSON, preferences and OOBE survive. The file is registered in the native contract.
- `runtime/test/channels/web/native-projection-memory.test.ts`: removed APIs, bounded observations, opaque history, direct SDK context without host fallback, and operation identity fencing.
- `runtime/test/channels/web/runtime/channel-state-context-generation.test.ts`: awaited bound-session changes and per-chat reads, without a historical state class.
- `runtime/test/channels/web/native-turn-view-reattach.test.ts`: late-intent public-view binding and foreign conversation rejection.
- `runtime/test/web/native-projection-memory.test.ts` and `context-snapshot-contract.test.ts`: bounded revisions, unchanged unknown boundaries, unbound context replacement, telemetry separation and late-poll rejection.
- `runtime/test/web/native-ui-projection.browser.optional.test.ts`: real Chromium/WebKit, Classic/Visual hooks and composers, cold valid/malformed cache entries, reconnect/late status+context, ordinary unbound replacement, preserved typed text and browser preferences. Transport is controlled; these are not live-service restart tests.

Use the isolated priority launcher with explicit files/cases and `PICLAW_LOCAL_TEST_NICE=10`. Rebuild both shipped skins after frontend changes. This evidence does not authorise running a broad suite or operating the live instance.
