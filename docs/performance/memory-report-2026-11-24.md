# Runtime memory and staged test report — 24 November 2026

Streaming a synthetic 160 MiB tar.gz member listing reduced median incremental peak RSS from **321.93 to 21.77 MiB**. The listing stayed byte-identical; median wall time increased from **116.31 to 161.62 ms**. This measures a workspace preview, not whole-service idle memory or a production OOM fix.

## Matched archive previews

Baseline: clean `9c5b650555344e749206198e6271a31621ba366b`. Candidate: `9cb7e4171bb3900227d6154a1d1b30848db70671`, measured source hashes verified before committing. Each arm ran in a fresh `test:local` process at effective nice 10, Bun 1.4.4, on Smith's LXC on the same host. Each scope had a 1.5 GiB memory cap and no swap. Three pairs alternated arm order; no forced GC, credentials or live database. One zero-filled member expands from a 163,155-byte gzip file to 160 MiB. The measurement of each preview subtracts `/proc/self/status` `VmHWM` immediately before the call from `VmHWM` after it; it does not use a post-call RSS sample as a peak.

| Arm | Peak increment range | Median incremental peak | Median wall time |
|---|---:|---:|---:|
| Whole read and synchronous decompression | 321.46–322.10 MiB | 321.93 MiB | 116.31 ms |
| Streaming listing | 20.07–24.80 MiB | 21.77 MiB | 161.62 ms |

The original preview read the gzip file and inflated all decoded bytes in one call, then inspected only the tar headers. The new path keeps one 512-byte header and the bounded listing; it skips bodies, checks the gzip trailer, and cancels the stream if the request is aborted or decoded input exceeds 512 MiB. Oversized or invalid archives use the existing binary preview result. ZIP, file downloads, archive extraction and database behaviour are unchanged. The two retained buffers in the old path can explain the matched peak; the samples do not separately attribute the residual streaming RSS to the allocator or zlib. No SDK code or alternate archive owner was added.

## Fresh default application runtime

The measured source is `9cb7e4171bb3900227d6154a1d1b30848db70671` (tree `8d2469095785f9121a3ab9f78e83b5e9b5f781dd`). Root/private SDK 1.6.0; three fresh WAL/FULL SQLite stores, default application composition without external add-ons, eight accepted synthetic turns per process. Each turn executes a tiny local shell tool and settles normally. The fake provider received 16 callbacks per run; reopen preserved the entry count and produced none. The previous #2044 add-on cohort is not directly comparable.

| Median phase | Process RSS (MiB) | PSS (MiB) | Private RSS (MiB) | JSC heap / extra (MiB) | Cgroup current (MiB) |
|---|---:|---:|---:|---:|---:|
| Launcher | 17.27 | 8.13 | 4.05 | 0.51 / 0.19 | 10.75 |
| Before native start, after imports | 139.27 | 124.12 | 114.78 | 23.01 / 4.89 | 121.00 |
| Native ready | 148.88 | 133.63 | 124.18 | 23.03 / 4.91 | 129.42 |
| Before first turn, 2 s settle | 136.39 | 121.05 | 111.56 | 29.74 / 8.61 | 116.91 |
| Eighth turn settled | 186.03 | 170.51 | 160.84 | 39.50 / 15.37 | 166.44 |
| 30 s after work | 156.18 | 140.53 | 130.83 | 36.69 / 14.84 | 135.84 |
| Reopened, 2 s settle | 166.12 | 150.47 | 140.77 | 37.32 / 15.43 | 145.41 |

Median lifetime peak by the last turn was 186.29 MiB; cold native start took 215–1,235 ms. The 30 s process RSS range was 156.17–157.00 MiB. No child survived final close. Median mean checkpoint sampling overhead per run was 12.36 ms. Process PSS and cgroup totals are separate measures; do not sum them or infer SQLite memory by subtraction. Eight turns do not establish a long-term retained-memory bound. The import-to-readiness rise does not by itself identify an avoidable allocation.

## Controlled runner refresh

The existing staged runner measured six selected host files in three fresh processes (stage size two; 100 ms period, `--isolate`, in-memory host test defaults, same disposable capped scope). It passed **80 tests**, exit 0. These are aggregate sampled test-process-tree RSS values, which may count shared pages more than once. Cgroup memory includes the runner and file cache. Neither figure is a live Piclaw-service measurement.

| Stage | Files | Process-tree peak (MiB) | Cgroup peak (MiB) | Samples |
|---|---|---:|---:|---:|
| Workspace preview and HTTP dispatch | 2 | 75.39 | 46.55 | 10 |
| Accepted input and manual compaction ownership | 2 | 146.53 | 115.75 | 19 |
| Delegate policy and staged-runner contract | 2 | 84.14 | 36.17 | 4 |

```sh
nice -n 10 bun run test:local -- bun runtime/scripts/controlled-test-runner.ts \
  --stage-size 2 --sample-ms 100 --report /workspace/tmp/controlled-rss.json --isolate \
  ./test/channels/web/workspace-file-service.test.ts ./test/channels/web/http-dispatch-workspace.test.ts \
  ./test/channels/web/input-source-admission.test.ts ./test/channels/web/manual-compaction-status-ownership.test.ts \
  ./test/delegate/policy.test.ts ./test/scripts/controlled-test-runner.test.ts
```

This scope does not time the native cancellation, Delegate child or compaction execution paths. Native lifecycle correctness belongs to the native gate, which runs in its own package; the staged runner's host working directory must not be used to qualify it. The earlier failed launcher attempts are retained separately.

## Installed observation and evidence boundary

The [history log](memory-footprint-history.md) records the current Smith process separately. Installed Core 3.3.4, private `pi-durable` 1.6.0, PID 3923744, user systemd in LXC. Installed `token-optimizer.ts` SHA-256 `d20ff5d03f2a2b770f37b27f7bf30f2037651fb471f3aeb0b9d8198de63e5fc7` includes the 23 November recovery backport; installed `default-application-runtime.ts` SHA-256 `a8f3960da1a159cdde7b95bf56fbb9b73b502ed7f37fc98e36a02f6333f7c3b4`. The installed package is not the measured main tree. No fresh post-reload idle baseline, paid provider or operational workload was authorised or run.

[Sanitised numerical receipts](memory-report-2026-11-24.json) include source identities, measurements and per-stage counters. Private shell logs and existing adapted probes are under `tmp/piclaw/runs/rss2044-394-20261124/` on Smith. No heap dumps or production state copies were created. See [#2044](https://github.com/rcarmo/piclaw/issues/2044) for the open broader memory investigation and [#394](https://github.com/rcarmo/piclaw/issues/394) for reporting.
