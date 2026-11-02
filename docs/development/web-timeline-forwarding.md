# Direct timeline endpoint wiring

The counts and retained structures below describe the original #1273 slice. PR #1909 later retired the shared HTTP surface; #1888 removes the remaining prototype installer and lifecycle/message-entry adapters.

The public synchronous `WebChannel.handleTimeline(limit, before?, chatJid?)` calls the existing content handler with the channel's existing typed content context. The HTTP-surface and endpoint-facade timeline methods are removed. Other endpoint families retain their existing paths.

## Call path and removed stages

At implementation base `fc587de57babb118b5f0fd2ace406548bd04bbfa`:

```text
handleContentPrimaryRoutes
  → prototype-installed WebChannel.handleTimeline
  → WebChannelHttpSurfaceService.handleTimeline
  → WebChannelEndpointFacadeService.handleTimeline
  → handleTimelineRequest
  → getTimelineResponse
```

After this change:

```text
handleContentPrimaryRoutes
  → explicit WebChannel.handleTimeline
  → handleTimelineRequest
  → getTimelineResponse
```

This removes two forwarding stages from the six-stage route. The explicit public method replaces the dynamic prototype callback; it adds no replacement facade, adapter or context factory. Generic prototype helpers remain for their other real callers and receive no removal credit.

Removed timeline-only wiring:

- The `installWebChannelPrototype` timeline descriptor and HTTP-surface callback.
- `WebChannelHttpSurfaceService.handleTimeline` and its facade dependency member.
- `WebChannelEndpointFacadeService.handleTimeline` and its content-handler import.

The shared surface/facade classes still serve other endpoint families. They are not reported as deleted classes.

## Retained responsibilities

- `RequestRouterService` still owns authentication, access mode, request guards, request IDs and security headers before content dispatch. No guard is bypassed by the shortened internal path.
- `handleContentPrimaryRoutes` retains query defaults, integer parsing/clamping and chat trimming.
- The public `WebChannel` method retains its name, arguments, synchronous response and extension/subclass override point.
- `endpointContexts.content()` supplies the existing default chat, JSON response and current identity getter. It remains a narrow shared injection boundary; no constructor dependency, cast or `Object.assign` is added.
- `handleTimelineRequest` retains live identity projection, response serialization and timeline timing. It does not own execution or recovery.
- `getTimelineResponse` and the existing stores retain row selection, pagination, hidden-placeholder filtering and project metadata. Store errors propagate; no fallback or second response owner is added.

No timeline SQL, timestamp/rowid policy, identity/avatar content, native dispatch, SSE/queue state, migration, resource lifetime or frontend control changes are part of this slice.

## Reduction measure

Use #1270's stable tracked handwritten source set under `runtime/src` and `runtime/durable-engine/src`, excluding `.d.ts` and exact testing/fixtures/test/qualification/vendor/generated/dist/node_modules components. Physical lines include comments/blanks; nonblank counts are supplementary.

Against this slice's exact base:

| Measure | Before | After | Change |
| --- | ---: | ---: | ---: |
| Production physical lines | 146,885 | 146,874 | −11 |
| Production nonblank lines | 136,386 | 136,376 | −10 |
| Production files | 728 | 728 | 0 |
| Selected timeline call stages | 6 | 4 | −2 |

The [machine-readable receipt](receipts/web-timeline-forwarding-1273.json) records the exact base, paths, counts and retained boundaries.

There is no implementation relocation or production addition outside these roots. Tests, documentation, declarations and generated assets receive no deletion credit. The small LOC delta is reported alongside the actual path reduction; it is not presented as deletion of the surrounding services or completion of the whole epic.

The larger retirement already delivered since the refreshed epic baseline remains separate evidence. Historical relocated fixture helpers remain charged separately; this slice neither claims their deletion nor repeats their implementation.

## Focused qualification and rollback

`timeline-direct-wiring.test.ts` uses the real constructed channel and dispatcher, injected store observations and isolated SQL data. Getter traps make either removed forwarding stage fail if re-entered. Cases cover synchronous wire/identity/timing, defaults/clamping/current identity, exact store failure, authentication rejection before observation, rowid pagination and foreign-chat isolation.

Surviving constructor, endpoint, content-dispatch and non-timeline surface fixtures retain their assertions. Only expectations solely describing the deliberately removed internal timeline forwarding are retired; public behavior is covered at the direct seam. Existing security-header regressions remain.

Run only defining/directly affected files through the filesystem-isolated priority launcher at background priority, plus relevant type/import/package checks. No frontend rebuild is required for this backend-only change. No throughput/latency claim follows from fewer stack frames.

Rollback restores the earlier forwarding implementation without changing stored data or wire format. Source delivery authorises no installation, restart, dependency upgrade, live database/configuration/credential operation or history cleanup.
