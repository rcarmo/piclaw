# Memory Footprint History

Track Piclaw memory measurements over time with the repo commit context that produced them.

## How to use this log

- Add a new entry whenever memory-related changes land or are benchmarked.
- Record the Git commit hash that best matches the measured code.
- If the workspace is not clean, mark the entry as `dirty` and describe why.
- Regenerate the SVG chart with:
  - `bun run runtime/scripts/render-memory-progress-chart.ts --template docs/performance/memory-progress.template.json --input docs/performance/memory-footprint-history.md --output docs/performance/memory-progress-2026-11-24.svg`
- The [updated chart](memory-progress-2026-11-24.svg) keeps matched synthetic comparisons separate from the historical live-service timeline. The April SVG and PNG remain historical artifacts.
- Prefer two measurement types:
  - **live-service snapshot** — running `piclaw.service` after restart/settle
  - **fresh-process cold-session benchmark** — isolated one-shot measurement of session bootstrap cost
- Backfilled entries are allowed when we already have trustworthy values in tickets, shell output, or journals; mark those clearly in the notes.

## Measurement fields

- **commit** — repo HEAD used for the measurement
- **dirty** — whether the workspace had uncommitted changes
- **scenario** — what was measured
- **rss / pss / cgroup** — main resident memory numbers
- **vmhwm** — peak RSS seen by the process so far
- **heap_used / external** — Node/Bun process memory breakdown
- **runtime counters** — cached sessions / active chats / prewarm state
- **notes** — what changed or why the number matters

## Live service snapshots

| Timestamp (UTC) | Commit | Dirty | Scenario | RSS | PSS | cgroup current | VmHWM | Heap used | External | Cached main | Active chats | Prewarm queue | Notes |
|---|---|---:|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 2026-04-21T21:43:06Z | `a1824665` | no | Live `piclaw.service` after pressure-threshold retune (384→512 MB) and pressure-TTL retune (30→60s), settled under active multi-session load | 303 MB | — | — | 480 MB | 39 MB | 16 MB | 2 | 3 | 0 | PID 711016. Post-start snapshot at 21:35Z showed 219 MB RSS / 39 MB heap / 16 MB external with `cached_main_sessions=0`. VmHWM of 480 MB reflects earlier pressure events before the retune landed. With the new 512 MB threshold, pressure mode no longer fires at the 388–428 MB peaks observed during normal multi-session use. Pressure TTL raised 30→60s to reduce session kill/recreate churn (was 37 creates/evictions in 10 min under the old threshold). |
| 2026-04-18T07:37:17Z | `ca768600` | yes | Live `piclaw.service` after the most recent 07:27Z restart, rechecked under light interactive load on the current main branch | 221.5 MB | 220.4 MB | 191.6 MB | 242.1 MB | 59.9 MB | 27.0 MB | 1 | 1 | 0 | Service PID 94278 on `:8080`. Runtime counters at capture time: `create_in_flight=0`, `prewarm_in_flight=0`, `queued_prewarms=0`. The restart emitted `.piclaw/data/startup-memory-snapshots/2026-04-18T07-27-49-968Z_post-web-start.json`, a fresh post-start sample at 212.7 MB RSS / 38.8 MB heap / 15.9 MB external with `cached_main_sessions=0` and `active_chats=0`. The workspace was dirty only because of unrelated local note/measurement artifacts that were intentionally left untouched; by 07:37Z the same process had fallen a bit further from the 07:31 checkpoint while still staying close to the new restart baseline, so this row replaces the earlier RAM-work checkpoint in place. |
| 2026-04-17T23:32:37Z | `008c236a` | yes | Live `piclaw.service` shortly after the 23:32Z restart with one active chat and the current main branch loaded | 220.9 MB | 219.7 MB | 190.0 MB | 236.5 MB | 54.6 MB | 22.2 MB | 1 | 1 | 0 | Service PID 34642 on `:8080`. Runtime counters at capture time: `create_in_flight=0`, `prewarm_in_flight=0`, `queued_prewarms=0`. The restart emitted `.piclaw/data/startup-memory-snapshots/2026-04-17T23-32-02-436Z_post-web-start.json`, a fresh post-start sample at 218.3 MB RSS / 38.8 MB heap / 15.9 MB external with `cached_main_sessions=0` and `active_chats=0`. By 23:32Z the live process remained close to that new baseline, making this a much cleaner post-restart interactive sample than the earlier 23:28 checkpoint. |
| 2026-04-17T23:28:19Z | `bb7608df` | yes | Live `piclaw.service` after the later 23:05Z restart, renderer/chart follow-up work, and additional interactive activity | 271.5 MB | 249.6 MB | 425.1 MB | 352.3 MB | 100.3 MB | 64.9 MB | 2 | 2 | 0 | Service PID 26894 on `:8080`. Runtime counters at capture time: `create_in_flight=0`, `prewarm_in_flight=0`, `queued_prewarms=0`. The later restart emitted `.piclaw/data/startup-memory-snapshots/2026-04-17T23-05-07-451Z_post-web-start.json`, a fresh post-start sample at 217.6 MB RSS / 38.8 MB heap / 15.9 MB external with `cached_main_sessions=0` and `active_chats=0`. By 23:28Z the live process had grown under two active chats and two cached main sessions, so treat this as a heavier interactive snapshot rather than a post-restart idle baseline. |
| 2026-04-17T22:58:16Z | `0943907f` | yes | Live `piclaw.service` after installing the Azure provider-bootstrap + image-module cold-path split, restarting, and settling | 254.1 MB | 253.2 MB | 237.3 MB | 256.9 MB | 93.1 MB | 61.5 MB | 1 | 1 | 0 | Service PID 25826 on `:8080`. Runtime counters at capture time: `create_in_flight=0`, `prewarm_in_flight=0`, `queued_prewarms=0`. The restart emitted `.piclaw/data/startup-memory-snapshots/2026-04-17T22-56-01-827Z_post-web-start.json`, a clean post-start sample at 207.8 MB RSS / 25.2 MB heap / 5.3 MB external with `cached_main_sessions=0` and `active_chats=0`. Compared to the earlier 22:03 lazy-viewer-route split baseline, the live post-settle process is higher; treat this as an installed dirty-workspace snapshot after the Azure cold-path tranche, not a new low-water mark. |
| 2026-04-17T22:03:54Z | `49fae082` | no | Live `piclaw.service` after installing the lazy web-viewer route split, restarting, and settling | 217.7 MB | 216.2 MB | 606.0 MB | 253.2 MB | 44.8 MB | 14.0 MB | 1 | 1 | 0 | Service PID 16889 on `:8080`. Runtime counters at capture time: `create_in_flight=0`, `prewarm_in_flight=0`, `queued_prewarms=0`. The restart emitted `.piclaw/data/startup-memory-snapshots/2026-04-17T22-03-03-224Z_post-web-start.json`, a clean post-start sample at 218.3 MB RSS / 39.4 MB heap / 15.8 MB external with `cached_main_sessions=0` and `active_chats=0`. Compared to the earlier 20:54 baseline, this restart stayed in the same low-RSS range while preserving the web viewer tools and moving their heavy route modules off session bootstrap. |
| 2026-04-17T20:54:34Z | `d5b6975569dd6ad4e6284828faa0079f08c72ab2` | yes | Live `piclaw.service` after installing the pressure-aware cache-trim fixes, restarting, and settling with the new startup-memory snapshot hook active | 229.6 MB | 223.5 MB | 197.3 MB | 242.3 MB | 61.7 MB | 28.4 MB | 1 | 1 | 0 | Service PID 3851 on `:8080`. Runtime counters at capture time: `cached_side_sessions=0`, `create_in_flight=0`, `prewarm_in_flight=0`, `queued_prewarms=0`, `prewarm_cooldowns=0`. The restart also emitted `.piclaw/data/startup-memory-snapshots/2026-04-17T20-54-06-298Z_post-web-start.json`, a clean post-start sample at 222.5 MB RSS / 41.4 MB heap / 16.6 MB external with `cached_main_sessions=0` and `active_chats=0`. This is the cleanest post-restart baseline in the log so far. |
| 2026-04-17T20:25:16Z | `d5b6975569dd6ad4e6284828faa0079f08c72ab2` | yes | Live `piclaw.service` after enabling session autorotation at 64 MB and rotating `web:default` off the oversized default-session file | 280.8 MB | 272.6 MB | 568.0 MB | 296.6 MB | 102.9 MB | 65.4 MB | 2 | 2 | 0 | Service PID 49437 on `:8080`. Runtime counters at capture time: `cached_side_sessions=0`, `create_in_flight=0`, `prewarm_in_flight=0`, `queued_prewarms=0`, `prewarm_cooldowns=0`. The active `web:default` file had fallen to ~228.9 KB, while the prior oversized live session was archived at 95,217,421 bytes (`web_default/archive/2026-04-06T19-04-37-583Z_...jsonl`). This sample was still taken during interactive debugging (`active_chats=2`), but it demonstrates that trimming/rotating the huge default session materially reduced retained live memory versus the earlier ~449–479 MB readings. |
| 2026-04-17T20:00:28Z | `d5b6975569dd6ad4e6284828faa0079f08c72ab2` | yes | Live `piclaw.service` after local install + systemd user restart with the cold-start bootstrap fixes, Dream fixes, and deterministic audit-group refresh loaded | 478.7 MB | 477.6 MB | 495.8 MB | 835.2 MB | 322.1 MB | 267.4 MB | 1 | 1 | 0 | Service PID 45635 on `:8080`. Runtime counters at capture time: `cached_side_sessions=0`, `create_in_flight=0`, `prewarm_in_flight=0`, `queued_prewarms=0`, `prewarm_cooldowns=0`. Follow-up probing showed the fresh post-restart process initially sat around ~449.3 MB RSS / ~213.6 MB external, close to the 18:02 baseline; later diagnostic requests and active-chat growth pushed the live process into the 465–479 MB range. Treat this row as an in-turn interactive snapshot, not a clean idle baseline. |
| 2026-04-17T18:02:53Z | `d35e1f61dd1ed99662616384307ba7ca475e9ede` | yes | Live `piclaw.service` after landing startup warmup disable, removing workspace-local extensions, and moving workspace indexing off `session_start` into a background process | 450.8 MB | 449.7 MB | 429.0 MB | 651.5 MB | 257.4 MB | 203.2 MB | 1 | 1 | 0 | Service PID 24685. Runtime counters: `cached_side_sessions=0`, `create_in_flight=0`, `prewarm_in_flight=0`, `queued_prewarms=0`, `prewarm_cooldowns=0`. Workspace was dirty because the current implementation tranche was in progress, but the installed runtime had been verified against the workspace before restart. |

## Fresh-process cold-session benchmarks

| Timestamp (UTC) | Commit | Dirty | Scenario | Elapsed | RSS delta | Tool count | Notes |
|---|---|---:|---|---:|---:|---:|---|
| 2026-04-17T17:22:20Z* | `d35e1f61dd1ed99662616384307ba7ca475e9ede` | yes | Empty-workspace cold-session baseline | 370 ms | 83.3 MB | 46 | Backfilled from earlier shell output during the audit; timestamp approximate. Useful baseline for the base Piclaw session bootstrap cost without local workspace extensions. |
| 2026-04-17T17:22:20Z* | `d35e1f61dd1ed99662616384307ba7ca475e9ede` | yes | Real workspace cold-session benchmark before removing workspace-local extensions | 630 ms | 133.3 MB | 46 | Backfilled from earlier shell output during the audit; timestamp approximate. Included active workspace-local `github-copilot-opus-1m-safe.ts` and `gist-badlogic-edit.ts`. |
| 2026-04-17T17:34:55Z | `d35e1f61dd1ed99662616384307ba7ca475e9ede` | yes | Real workspace cold-session benchmark after removing workspace-local extensions | 314 ms | 81.3 MB | 46 | Compared to the earlier ~630 ms / 133.3 MB pre-removal measurement. |
| 2026-04-17T17:50:06Z | `d35e1f61dd1ed99662616384307ba7ca475e9ede` | yes | Real workspace cold-session benchmark with background indexing disabled for the harness | 317 ms | 78.6 MB | 46 | Spot-check after removing blocking workspace indexing from session bootstrap. |
| 2026-04-17T18:16:00Z | `d35e1f61dd1ed99662616384307ba7ca475e9ede` | yes | Real workspace cold-session benchmark after removing redundant per-session startup hooks | 295 ms | 84.3 MB | 46 | Time improved modestly; RSS delta remained noisy. This tranche removed duplicate `session_start` work from `context-mode` and Azure refresh extensions. |
| 2026-04-17T18:18:23Z | `d35e1f61dd1ed99662616384307ba7ca475e9ede` | yes | Real web-chat cold-session benchmark after platform/channel bundled-extension gating | 296 ms | 80.0 MB | 46 | Linux web path stayed roughly flat, as expected, because web viewer extensions still load for web chats. |
| 2026-04-17T18:18:39Z | `d35e1f61dd1ed99662616384307ba7ca475e9ede` | yes | Real non-web-chat cold-session benchmark after platform/channel bundled-extension gating | 277 ms | 79.3 MB | 44 | Non-web chats now skip web-only viewer tools, dropping tool count from 46 to 44. |
| 2026-04-17T18:47:37Z | `d35e1f61dd1ed99662616384307ba7ca475e9ede` | yes | Real web-chat cold-session benchmark after lazy-loading heavy Office/CDP modules | 215 ms | 25.3 MB | 46 | `cdp-browser` and `office-tools` now lazy-load their heavier dependencies, cutting the earlier Linux web benchmark from ~296 ms / 80.0 MB while keeping the same exposed tool count. |
| 2026-04-17T22:32:00Z* | `0943907f` | yes | Real web-chat cold-session benchmark after Azure provider-bootstrap + session-shim split | 169 ms | 26.9 MB | 41 | Backfilled from the focused source-tree harness run during the Azure cold-path tranche. This step moved Azure provider registration off ordinary session bootstrap and into the async provider-bootstrap/session-shim path, materially reducing cold-path elapsed time while also dropping active-tool count. |
| 2026-04-17T22:38:00Z* | `0943907f` | yes | Real web-chat cold-session benchmark after splitting Azure image helpers out of the provider module | 175 ms | 26.3 MB | 41 | Backfilled from the follow-up source-tree harness run after moving `/image` and `/flux` into `runtime/extensions/integrations/azure-openai-images.ts`. RSS improved a bit further, while elapsed time stayed within the same noise band as the prior Azure provider-bootstrap split. |

## Current installed-service observation

On 24 November 2026 at 13:49:19 UTC, Smith's existing `piclaw.service` process, PID 3923744, reported 712.48 MiB RSS, 711.36 MiB PSS, 686.79 MiB anonymous RSS and 2,989.93 MiB lifetime peak RSS. The service cgroup separately reported 861.95 MiB current memory. Heap metrics and idle state were not verified. This is a read-only observation of the service that restarted on 23 November, not a fresh idle run or a measurement of current main.

Installed Core reported 3.3.4, private `pi-durable` 1.6.0. It still has the legacy optimiser-off recovery backport; installed source fingerprints and exact synthetic scope are in the [November report](memory-report-2026-11-24.md). This sample is excluded from the historical chart's chronological comparison: its installed build, workload and time since startup do not match the April runs. No new live baseline was manufactured by restarting or sending test traffic.

## Matched synthetic RSS comparisons

| Workload | Baseline RSS (MiB) | Candidate RSS (MiB) | Measurement |
|---|---:|---:|---|
| ZIP preview · incremental peak RSS | 189.95 | 0.25 | 192 MiB stored member; three pairs, [#2081](https://github.com/rcarmo/piclaw/pull/2081). |
| Long-history SDK idle · RSS at 30 s | 214.31 | 66.72 | Eight conversations, 512 × 32 KiB entries each; three pairs, [#2083 follow-up](https://github.com/rcarmo/piclaw/issues/2044#issuecomment-7069609046). |
| tar.gz preview · incremental peak RSS | 321.93 | 21.77 | 160 MiB decoded member; three alternating pairs, [November report](memory-report-2026-11-24.md). |

## Notes

- `*` marks a backfilled entry where the value is trustworthy but the timestamp is approximate.
- Earlier 2026-04-17 audit findings showed the startup crash loop was an OOM/restart storm triggered during startup session creation.
- Journal-derived failure-path memory figures from the crash loop:
  - repeated failed startup attempts peaked around **475–477 MB** RSS-equivalent per systemd accounting
  - each failed attempt consumed roughly **~1.9s CPU time** before OOM kill
- The most important immediate deltas already landed before this log was created were:
  - startup warmup disabled by default
  - workspace-local `github-copilot-opus-1m-safe.ts` removed from active `.pi/extensions`
  - workspace-local `gist-badlogic-edit.ts` removed from active `.pi/extensions`
  - workspace indexing moved off blocking `session_start` into a background process
- Subsequent dirty-workspace changes that now have measured live impact in this log:
  - `sessionAutoRotate` is enabled locally and the intended upstream default is now `sessionMaxSizeMb=32`
  - `web:default` was manually rotated once, proving the oversized ~95.2 MB session file was a major retained-memory contributor
  - the pressure-aware session-cache trim path now runs both on the cleanup timer and immediately after session acquisition under memory pressure
  - the startup-memory snapshot hook is now installed and writing under `.piclaw/data/startup-memory-snapshots/`
  - oversized persisted `toolResult` payloads are now sanitized both before session resume and at append-time to prevent reintroducing the same OOM class
- Still-open measurement work:
  - explicit warmup vs lightweight-recent-warmup runtime counter differences
  - whether the capped pool materially lowers steady-state retained-memory pressure on the crash-prone VM under broader multi-chat activity
  - ~~whether the local pressure threshold defaults should be tuned down now that the pressure path is actually wired into the live runtime~~ — **resolved**: pressure threshold raised 384→512 MB and pressure TTL raised 30→60s on 2026-04-21 (`af519034`); normal multi-session peaks of 388–428 MB no longer trigger pressure mode
- Follow-up work should append entries after any change to:
  - packaged extension load gating
  - session bootstrap composition
  - provider refresh behavior
  - memory telemetry interpretation
  - session-cache retention policy
  - persisted tool-result sanitization policy

## Root-cause write-up

- See `docs/performance/session-bootstrap-oom-analysis-2026-04-17.md` for the historical crash-loop analysis, isolated session-hydration benchmark data, and the landed mitigations.
