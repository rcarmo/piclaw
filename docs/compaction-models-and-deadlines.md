# Native compaction policy

Piclaw uses `pi-durable` compaction with the active conversation model. The Settings → Compaction pane and `/auto-compact on|off` share one host-wide enable flag. A save changes the next SDK compaction decision without restarting the runtime. Disabling automatic compaction does not cancel accepted maintenance or disable manual `/compact`.

## Settings contract

`GET /agent/settings` includes `compactionPolicy: "pi-durable"` and `autoCompactionEnabled`. `POST /agent/settings/compaction` accepts a boolean `autoCompactionEnabled`, persisted as `domains.compaction.autoCompactionEnabled` (default `true`). The native Harness reads that value at each decision through `createHostCommandPolicy`.

A valid deprecated `PICLAW_AUTO_COMPACTION_ENABLED` override still takes precedence. A conflicting API or native-command change fails before writing settings. The environment is never rewritten by a settings save. Invalid deprecated values retain the domain parser's existing fallback behaviour.

| Former API field | Native contract |
|---|---|
| `smartCompactionMethod` | Unsupported. No Selective/Pipelined method selector. |
| `compactionModel` | Unsupported. Use the active conversation model. |
| `remoteCompactionEnabled`, `remoteCompactionTimeoutSec` | Unsupported. No provider-native remote pre-pass or local fallback. |
| `compactionThresholdPercent` | Unsupported. SDK token thresholds apply. |
| `compactionTimeoutSec` | Unsupported. No legacy wall-clock deadline is translated into native task policy. |
| `compactionBackoffBaseMin`, `compactionBackoffMaxMin`, `compactionBackoffDecayFactor` | Unsupported. Native tasks own their lifecycle; legacy per-chat suppression does not control them. |

Any retired field in a save request returns HTTP 400 naming the unsupported fields, even when its value is unchanged. The request writes none of its settings. Reads omit retired fields, legacy latency estimates and backoff lists. Old clients must stop sending those fields. The retired `/agent/settings/compaction/probe` and `/reset-backoff` POST routes return HTTP 410 without provider calls or database changes. The obsolete provider-probe runner, AgentPool forwarding methods and probe-only latest-latency selector are removed; historical telemetry and the shared offline estimator remain intact.

With SDK 1.4.0, the native defaults are `reserveTokens: 16384`, `keepRecentTokens: 20000` and `backgroundTokens: 32768`. The SDK selects a summarisation range before admitting threshold work; model context size determines the blocking and background boundaries. These token counts are SDK defaults, not editable percentage settings.

## Maintenance and preservation

Settings writes grant no model/tool authority and do not create, replace, abort or replay tasks. Existing native maintenance admission, source checks, immutable task/request identity, checkpoint recovery and usage accounting still apply. A paused or accepted task retains its identity when the automatic enable flag changes.

Persisted legacy compaction values, imported provenance, latency observations and backoff records remain intact. Legacy model/method/remote/deadline/backoff/progressive settings are inert historical keys; direct stale configuration writes reject before changing supported policy. The earlier [model/deadline guide](archive/legacy-compaction-models-and-deadlines.md) describes the removed implementation.

## Legacy execution retirement

The Selective/Pipelined/Progressive runners, remote provider pre-pass and payload replay, `createSmartCompactionExtension`, its facade/compatibility aliases and the `compactionStreamFn` option are removed. Built-in factory selection no longer registers a `session_before_compact` hook. There is no fallback compaction engine.

Explicit offline `createSessionInDir` construction, source/media/history import and resident capture remain. Automatic compaction stays disabled on those legacy sessions; normal application compaction uses the native Harness. Two data-only modules retain historical result parsing, opaque records, file facts and readable checkpoint decoding without provider requests or replay. The shared historical latency estimator and telemetry database APIs remain unchanged. Receipt metadata remains types only; the old asynchronous deadline scope and cancellation-reason cache are removed. Reading an opaque historical record grants no authority to send it to a provider.

Local-lite prompt options, tool-result compression, semantic summaries and watchdog fields keep their separate controls and consumers (`config-tools`, `context-mode-api`, `local-lite-prompt-profile`, and the progress-watchdog supervisor). They are independent of native conversation compaction and are not mapped into its SDK policy.
