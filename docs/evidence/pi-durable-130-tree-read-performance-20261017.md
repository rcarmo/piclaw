# Bounded durable tree and context metadata reads — 17 October 2026

The existing local run passed 18,716 assertions at 100, 1,000 and 2,000 synthetic native entries; production performance acceptance is unverified. All 45 HC/PC statuses in the [current assessment](../design/earendil-agent-harness-integration-adr/evidence/pi-durable-130-acceptance-current-20261017.md) are unchanged.

## Source and method

The run started at `2026-10-17T18:59:50.859Z` on Smith (Linux x64 LXC, Bun 1.4.2, niceness 10). Published HEAD was `8dcf4dd73d88150e5da5e869d480e006d4714b59`; the native context metadata/public projection follow-up was unpublished. The raw JSON records dirty paths and matching before/after SHA-256 fingerprints for the eight selected source/lock files. These are selected-file fingerprints, not a whole-worktree identity or a future commit hash.

The reader used actual public SDK SQLite storage, one borrowed physical root with real host effect/binding composition and ownership tables, `HostConversationRuntime`, the durable adapter and `AgentRuntimeFacade`. This exercises the real cross-store composition in one physical SQLite file. It did not use default application bootstrap/runtimeFactory. Native user, assistant, tool-call and tool-result rows were synthetic; no provider, credential or external tool execution occurred.

Each size received one initial tree read, then five timed warm reads. Golden assertions ran outside the timed intervals. Median and p95 use nearest rank; with five samples p95 is the maximum. Runtime/storage close and reopen preceded a first tree read in the same process with the OS cache retained. The JSON field `coldReadMs` means this warm-OS-cache first read after reopen, not disk-cold IO. Temporary SQLite files were removed after the run.

## Recorded measurements

All durations are milliseconds. RSS values are process snapshots in MiB; DB/WAL are bytes.

| Entries | Warm tree median | Warm tree p95 (n=5) | Runtime/storage reopen | First tree read after reopen | RSS before/after | DB / WAL |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 100 | 0.475 | 0.585 | 1.139 | 0.504 | 117.0 / 121.9 | 8192 / 679832 |
| 1,000 | 2.574 | 2.864 | 1.232 | 2.776 | 125.1 / 139.8 | 8192 / 1042392 |
| 2,000 | 7.430 | 8.311 | 1.949 | 4.707 | 141.9 / 152.7 | 8192 / 1458512 |

The context path was `AgentRuntimeFacade.getContextUsageForChat` → durable `readModel` → `HostConversationRuntime.readSessionModel` → public persisted `AgentDoc` and the actual keyless fixture model registry. This reads model/window metadata, without full context assembly or token counting. Every observation required `contextWindow: 100000`, null tokens/percent, internal authoritative-unknown counts and session generation `perf`.

| Entries | Warm metadata median | Warm metadata p95 (n=5) | Metadata after reopen |
| ---: | ---: | ---: | ---: |
| 100 | 0.077 | 0.133 | 0.251 |
| 1,000 | 0.053 | 0.089 | 0.295 |
| 2,000 | 0.043 | 0.093 | 0.358 |

## Validation and limits

All 18,716 assertions passed. Each returned node matched the original appended public entry ID, ordered linear ancestry, role/text and child count. Total and length, raw and visible leaves, active leaf and public saved position matched. Warm and reopened full snapshot hashes matched. Thinking text was excluded. The 1,000/2,000-entry cases exercised the actual reader's 100-entry pagination boundary.

CPU contention from shared gates was uncontrolled. RSS includes imports, appends, validation and garbage collection; snapshots measure neither peak memory nor reader-only allocation. Five warm samples are descriptive observations, without reliable tail, throughput or budget estimates. Reopen did not evict OS caches. There was no 10,000-entry, imported/forked/compacted history, multimodal, concurrency, load or production-history qualification. The final context root gate is separate and RUNNING at this documentation refresh; this performance run supplies no final root receipt.

## Raw evidence and reproduction gap

[The raw JSON copy](pi-durable-130-tree-read-performance-20261017.json) retains all actual samples, environment, source fingerprints, dirty inventory, table/file information and assertion result. It is a byte-for-byte copy of the external JSON, not a rounded reconstruction from the tables.

SHA-256 digests:

- Original script: `302f34af4c951545a9a8419fbfbfd95a991c0349ca2f998da2debe7d179a6fd6`.
- External JSON and repository JSON copy: `8e49e4106cf11196f6be46fc3320db5e044de3506e7899c4f31bd6e6b4223682`.

External workspace evidence uses absolute local paths:

- Script: `/workspace/reviews/durable-1650/tree-read-performance.ts`.
- Raw JSON: `/workspace/reviews/durable-1650/tree-read-performance.json`.
- Original report: `/workspace/reviews/durable-1650/tree-read-performance.md`.
- Source tree: `/workspace/tmp/durable-1650`.

The script's original local invocation is `nice -n 10 bun /workspace/reviews/durable-1650/tree-read-performance.ts`. It requires those workspace paths and the existing installed candidate graph; it was not rerun for this refresh. The external script persists in this workspace but is absent from the repository. A clone alone cannot reproduce the run: a portable harness is missing. The repository retains the method and actual raw evidence without copying the entire script. This bounded evidence does not require a new code benchmark or change any acceptance status.
