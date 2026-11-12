# Intel GPU meters

The web meters show two additional rows when a Linux Intel `i915` device is discovered: **GPU*** (busiest observed engine class) and **GMEM*** (client-reported resident memory). With no supported Intel GPU, neither the rows nor their detail controls appear. NVIDIA's existing VRAM row is unchanged.

Tap the GPU or GMEM meter itself to see engine percentages, memory, sample age and coverage. Each meter is also a keyboard-accessible button (Enter/Space); there is no separate details pill. Escape or Close dismisses the details and restores focus to the meter. Clicking outside dismisses without stealing focus. Multiple Intel devices remain separate; compact mobile values are the same direct triggers. CPU/RAM and other non-GPU meters retain the collapse action. Unknown, missing or stale readings show `—`, not a false zero.

## Collection and permissions

The collector reads Intel vendor/driver/PCI identity from `/sys/class/drm/renderD*/device` and cumulative DRM counters from accessible `/proc/<pid>/fdinfo` files. Only vendor `0x8086` with driver `i915` is enabled. Other drivers, including `xe`, require separate qualification; unsupported/non-Linux hosts emit an empty `gpus` array. It never opens a GPU device, executes a GPU command, reads process arguments/environment, changes permissions, or requires root.

One process-wide asynchronous sampler serves all chats and browser tabs. Visible meters renew demand through `/agent/system-metrics`; ordinary `/agent/status?ui=1` polling does not. The endpoint returns the latest GPU cache immediately. The sampler stops scheduling work after ten seconds without demand and never overlaps scans. Known clients are sampled every two seconds, process discovery every five seconds, and device discovery every thirty seconds. Removal therefore hides rows by the next device scan. UI fetches keep their existing five-second cadence.

Each scan bounds files to 16 KiB, devices to eight, processes to 1,024, descriptors to 512 per process, and retained handles to 256. An operation/time budget stops scheduling additional reads after 8,192 budget checks or 150 ms. A pending filesystem read is allowed to finish; this is not a hard syscall timeout. Incomplete or inaccessible discovery is labelled partial, including after errors. Capabilities retry rather than failing the metrics endpoint. Incomplete device scans retain known devices until a complete scan confirms removal. Truncated process discovery samples only its observed prefix and reports incomplete coverage; it does not imply that omitted clients are idle. NVIDIA metrics use the shared NVML worker cache described in [GPU metrics](gpu-metrics.md), with no command fallback.

## Interpretation

GPU activity is the busiest **observed engine class**, not whole-device utilisation or specifically Vulkan usage. Render, copy and video engines can overlap; their percentages are not added. Each class uses busy-time deltas divided by actual monotonic elapsed time and its reported capacity (default one). Two video engines therefore report 50% when one is fully busy. First observations, PID reuse, counter regression, inconsistent capacity and invalid intervals produce gaps. Temporary counter regressions retain a high-water baseline; recovery does not manufacture a two-second spike.

DRM clients shared by descriptors or processes are counted once per device/client ID, with process start-time checks to detect PID reuse. Closed clients lose their baseline. Processes hidden by permissions or PID namespaces and clients that start/end between discoveries may be missed. Even a successful scan is best-effort process visibility. No visible clients means unknown activity, not an idle device.

GMEM is the sum of resident bytes reported by visible clients, converting declared KiB/MiB units. Requested total and shared bytes are shown separately. Shared allocations across distinct clients may be counted more than once; active/purgeable subsets are not added. Iris Xe memory is system-backed and overlaps RAM accounting. It is not a dedicated-VRAM percentage or a measurement of unique physical allocations.

## API

`/agent/system-metrics` retains existing fields and adds `gpus`, containing device identity, `intel-drm-fdinfo` provider, status/reasons, per-engine capacity/activity, memory regions, visibility counts and at most thirty timestamped history samples. Missing values are `null`. Values older than six seconds are stale; the frontend also checks age when requests fail. No supported device returns `gpus: []`.

## Validation

Regression fixtures cover absent/non-Intel/unsupported GPUs, hotplug, invalid PCI identity, unreadable/disappearing descriptors, PID reuse, bounded inputs, large counters, duplicated clients, capacity mismatch, resets, no-memory/no-engine readings, multiple devices, stale cache, no overlapping scans and idle expiry. UI tests cover null values, histories with gaps, no-GPU hiding, compact display and desktop/tablet keyboard/tap details.

A read-only Sigma observation using eight scans over about 16.1 seconds found the existing speech service's two i915 clients without device access or workload changes. Known-client reads took about 5–6 ms; discovery took 27–39 ms. Process CPU usage was approximately 160 ms (0.99% of one core over the observation, including the probe script). This is a short, mostly idle measurement, not proof of inference-latency non-regression or worst-case overhead. A coordinated active-load comparison remains separate validation; no new inference was run for this change.

Whole-device PMU monitoring, API-specific attribution, `xe` support, power/temperature and persistent telemetry history are outside this change.
