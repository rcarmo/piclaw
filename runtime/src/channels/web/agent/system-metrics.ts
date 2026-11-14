/**
 * web/agent/system-metrics.ts – Lightweight host CPU/RAM/swap metrics for the web HUD.
 */

import fs from "node:fs";
import os from "node:os";
import { IntelGpuMetrics } from "./intel-gpu-metrics.js";
import type { IntelGpuSnapshot } from "./intel-gpu-accounting.js";
import { readGpuVramUsage } from "./gpu-metrics.js";
import type { GpuVramUsageSnapshot } from "./gpu-metrics-cache.js";
export type { GpuVramUsageSnapshot } from "./gpu-metrics-cache.js";

import type { AgentPoolMemoryInstrumentationSnapshot } from "../../../agent-pool.js";
import { createLogger, debugSuppressedError } from "../../../utils/logger.js";

const log = createLogger("web-system-metrics");

export interface ProcessMemorySnapshot {
  rss_bytes: number;
  heap_total_bytes: number;
  heap_used_bytes: number;
  external_bytes: number;
  array_buffers_bytes: number;
  vm_rss_bytes: number | null;
  vm_hwm_bytes: number | null;
  rss_anon_bytes: number | null;
  rss_file_bytes: number | null;
  rss_shmem_bytes: number | null;
  pss_bytes: number | null;
  private_clean_bytes: number | null;
  private_dirty_bytes: number | null;
  shared_clean_bytes: number | null;
  shared_dirty_bytes: number | null;
  cgroup_memory_current_bytes: number | null;
  threads: number | null;
}

export interface RuntimeMemorySnapshot {
  cached_main_sessions: number;
  cached_side_sessions: number;
  active_fork_base_leaves: number;
  active_chats: number;
  session_entries: number;
  active_messages: number;
  persisted_session_bytes: number;
  loaded_skills: number;
  loaded_extensions: number;
  registered_tools: number;
  create_in_flight: number;
  branch_seed_realizations_in_flight: number;
  invalid_deferred_seed_errors: number;
  prewarm_in_flight: number;
  queued_prewarms: number;
  prewarm_queue_length: number;
  prewarm_cooldowns: number;
}

export interface SystemMetricsSnapshot {
  cpu_percent: number;
  ram_percent: number;
  swap_percent: number | null;
  io_pressure_some_percent: number | null;
  io_pressure_full_percent: number | null;
  io_pressure_some_series: number[];
  io_pressure_full_series: number[];
  cpu_series: number[];
  ram_series: number[];
  swap_series: number[];
  buffer_cache_bytes: number | null;
  buffer_cache_series_bytes: number[];
  process_rss_series_bytes: number[];
  process_heap_used_series_bytes: number[];
  swap_total_bytes: number;
  swap_used_bytes: number;
  sample_interval_ms: number;
  platform: NodeJS.Platform;
  process_memory: ProcessMemorySnapshot;
  runtime_memory: RuntimeMemorySnapshot | null;
  gpu_busy_percent: number | null;
  gpu_busy_series: Array<number | null>;
  gpu_sample_times: number[];
  gpu_resident_series: Array<number | null>;
  vram_percent: number | null;
  vram_series: number[];
  vram_total_bytes: number;
  vram_used_bytes: number;
  gpu_provider: string | null;
  gpus: IntelGpuSnapshot[];
}

export interface SystemMetricsContext {
  json(payload: unknown, status?: number): Response;
  getRuntimeMemorySnapshot?: () => AgentPoolMemoryInstrumentationSnapshot | null;
}

type CpuTotals = {
  idle: number;
  total: number;
};

interface MemoryUsageSnapshot {
  totalBytes: number;
  usedBytes: number;
  percent: number;
  bufferCacheBytes: number | null;
}

interface SwapUsageSnapshot {
  totalBytes: number;
  usedBytes: number;
  percent: number;
}

interface ProcStatusSnapshot {
  vmRssBytes: number | null;
  vmHwmBytes: number | null;
  rssAnonBytes: number | null;
  rssFileBytes: number | null;
  rssShmemBytes: number | null;
  threads: number | null;
}

interface ProcSmapsRollupSnapshot {
  pssBytes: number | null;
  privateCleanBytes: number | null;
  privateDirtyBytes: number | null;
  sharedCleanBytes: number | null;
  sharedDirtyBytes: number | null;
}

function readCpuTotals(): CpuTotals {
  let idle = 0;
  let total = 0;
  for (const cpu of os.cpus()) {
    const times = cpu?.times;
    if (!times) continue;
    idle += times.idle;
    total += times.user + times.nice + times.sys + times.idle + times.irq;
  }
  return { idle, total };
}

function roundPercent(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, Math.round(value * 10) / 10));
}

function pushSample(series: number[], value: number, maxSamples: number): number[] {
  const next = [...series, value];
  return next.length > maxSamples ? next.slice(next.length - maxSamples) : next;
}

export function parseLinuxRamMeminfo(text: string): MemoryUsageSnapshot | null {
  const normalized = typeof text === "string" ? text : "";
  const totalBytes = parseKbLine(normalized, "MemTotal");
  const availableBytes = parseKbLine(normalized, "MemAvailable");
  if (!totalBytes || availableBytes === null || totalBytes <= 0) return null;

  const buffersBytes = parseKbLine(normalized, "Buffers") ?? 0;
  const cachedBytes = parseKbLine(normalized, "Cached") ?? 0;
  const sreclaimableBytes = parseKbLine(normalized, "SReclaimable") ?? 0;
  const shmemBytes = parseKbLine(normalized, "Shmem") ?? 0;
  const bufferCacheBytes = Math.max(0, buffersBytes + cachedBytes + sreclaimableBytes - shmemBytes);

  const usedBytes = Math.max(0, totalBytes - Math.min(availableBytes, totalBytes));
  const percent = totalBytes > 0 ? (usedBytes / totalBytes) * 100 : 0;
  return { totalBytes, usedBytes, percent: roundPercent(percent), bufferCacheBytes };
}

export function parseLinuxSwapMeminfo(text: string): SwapUsageSnapshot | null {
  const normalized = typeof text === "string" ? text : "";
  const totalBytes = parseKbLine(normalized, "SwapTotal");
  const freeBytes = parseKbLine(normalized, "SwapFree");
  if (!totalBytes || freeBytes === null || totalBytes <= 0) return null;

  const usedBytes = Math.max(0, totalBytes - Math.min(freeBytes, totalBytes));
  const percent = totalBytes > 0 ? (usedBytes / totalBytes) * 100 : 0;
  return { totalBytes, usedBytes, percent: roundPercent(percent) };
}

export interface LinuxIoPressureSnapshot {
  somePercent: number;
  fullPercent: number | null;
}

/** PSI avg10 is stall time as a percentage, not disk utilisation or throughput. */
export function parseLinuxIoPressure(text: string): LinuxIoPressureSnapshot | null {
  const lines = text.split("\n");
  const read = (kind: string): number | null => {
    const line = lines.find(line => line.startsWith(`${kind} `));
    const raw = line?.match(/(?:^|\s)avg10=(\d+(?:\.\d+)?)(?=\s|$)/)?.[1];
    const value = raw === undefined ? NaN : Number(raw);
    return Number.isFinite(value) && value <= 100 ? value : null;
  };
  const somePercent = read("some");
  return somePercent === null ? null : { somePercent, fullPercent: read("full") };
}

export function readLinuxIoPressure(
  platform: NodeJS.Platform = process.platform,
  readText: () => string = () => fs.readFileSync("/proc/pressure/io", "utf8"),
): LinuxIoPressureSnapshot | null {
  if (platform !== "linux") return null;
  try {
    return parseLinuxIoPressure(readText());
  } catch {
    return null;
  }
}

function parseKbLine(text: string, label: string): number | null {
  const match = text.match(new RegExp(`^${label}:\\s+(\\d+)\\s+kB$`, "m"));
  if (!match) return null;
  const kb = Number(match[1]);
  return Number.isFinite(kb) && kb >= 0 ? kb * 1024 : null;
}

function parseIntLine(text: string, label: string): number | null {
  const match = text.match(new RegExp(`^${label}:\\s+(\\d+)$`, "m"));
  if (!match) return null;
  const value = Number(match[1]);
  return Number.isFinite(value) && value >= 0 ? value : null;
}

function readRamUsage(): MemoryUsageSnapshot {
  if (process.platform === "linux") {
    try {
      const meminfo = fs.readFileSync("/proc/meminfo", "utf8");
      const usage = parseLinuxRamMeminfo(meminfo);
      if (usage) return usage;
    } catch (error) {
      debugSuppressedError(log, "Failed to read /proc/meminfo; falling back to os memory counters.", error, {});
    }
  }

  const totalBytes = os.totalmem();
  const freeBytes = os.freemem();
  const usedBytes = Math.max(0, totalBytes - freeBytes);
  const percent = totalBytes > 0 ? (usedBytes / totalBytes) * 100 : 0;
  return { totalBytes, usedBytes, percent: roundPercent(percent), bufferCacheBytes: null };
}

function readSwapUsage(): SwapUsageSnapshot | null {
  if (process.platform !== "linux") return null;
  try {
    const meminfo = fs.readFileSync("/proc/meminfo", "utf8");
    return parseLinuxSwapMeminfo(meminfo);
  } catch {
    return null;
  }
}

function readProcStatus(): ProcStatusSnapshot {
  try {
    const text = fs.readFileSync("/proc/self/status", "utf8");
    return {
      vmRssBytes: parseKbLine(text, "VmRSS"),
      vmHwmBytes: parseKbLine(text, "VmHWM"),
      rssAnonBytes: parseKbLine(text, "RssAnon"),
      rssFileBytes: parseKbLine(text, "RssFile"),
      rssShmemBytes: parseKbLine(text, "RssShmem"),
      threads: parseIntLine(text, "Threads"),
    };
  } catch {
    return {
      vmRssBytes: null,
      vmHwmBytes: null,
      rssAnonBytes: null,
      rssFileBytes: null,
      rssShmemBytes: null,
      threads: null,
    };
  }
}

function readProcSmapsRollup(): ProcSmapsRollupSnapshot {
  if (process.platform !== "linux") {
    return {
      pssBytes: null,
      privateCleanBytes: null,
      privateDirtyBytes: null,
      sharedCleanBytes: null,
      sharedDirtyBytes: null,
    };
  }
  try {
    const text = fs.readFileSync("/proc/self/smaps_rollup", "utf8");
    return {
      pssBytes: parseKbLine(text, "Pss"),
      privateCleanBytes: parseKbLine(text, "Private_Clean"),
      privateDirtyBytes: parseKbLine(text, "Private_Dirty"),
      sharedCleanBytes: parseKbLine(text, "Shared_Clean"),
      sharedDirtyBytes: parseKbLine(text, "Shared_Dirty"),
    };
  } catch {
    return {
      pssBytes: null,
      privateCleanBytes: null,
      privateDirtyBytes: null,
      sharedCleanBytes: null,
      sharedDirtyBytes: null,
    };
  }
}

function readCgroupMemoryCurrent(): number | null {
  if (process.platform !== "linux") return null;
  try {
    const text = fs.readFileSync("/proc/self/cgroup", "utf8");
    const line = text.split("\n").find((entry) => entry.startsWith("0::"));
    if (!line) return null;
    const relativePath = line.slice(3).trim();
    const fullPath = relativePath && relativePath !== "/"
      ? `/sys/fs/cgroup${relativePath}/memory.current`
      : "/sys/fs/cgroup/memory.current";
    const raw = fs.readFileSync(fullPath, "utf8").trim();
    const value = Number(raw);
    return Number.isFinite(value) && value >= 0 ? value : null;
  } catch {
    return null;
  }
}

function normalizeRuntimeMemorySnapshot(snapshot: AgentPoolMemoryInstrumentationSnapshot | null | undefined): RuntimeMemorySnapshot | null {
  // These are legacy session-pool counters, not native SDK runtime metrics.
  if (!snapshot?.sessionManager) return null;
  return {
    cached_main_sessions: snapshot.cachedMainSessions,
    cached_side_sessions: snapshot.cachedSideSessions,
    active_fork_base_leaves: snapshot.activeForkBaseLeaves,
    active_chats: snapshot.activeChats,
    session_entries: snapshot.sessionResources?.sessionEntries ?? 0,
    active_messages: snapshot.sessionResources?.activeMessages ?? 0,
    persisted_session_bytes: snapshot.sessionResources?.persistedSessionBytes ?? 0,
    loaded_skills: snapshot.sessionResources?.loadedSkills ?? 0,
    loaded_extensions: snapshot.sessionResources?.loadedExtensions ?? 0,
    registered_tools: snapshot.sessionResources?.registeredTools ?? 0,
    create_in_flight: snapshot.sessionManager.createInFlight,
    branch_seed_realizations_in_flight: snapshot.sessionManager.branchSeedRealizationsInFlight,
    invalid_deferred_seed_errors: snapshot.sessionManager.invalidDeferredSeedErrors,
    prewarm_in_flight: snapshot.sessionManager.prewarmInFlight,
    queued_prewarms: snapshot.sessionManager.queuedPrewarms,
    prewarm_queue_length: snapshot.sessionManager.prewarmQueueLength,
    prewarm_cooldowns: snapshot.sessionManager.prewarmCooldowns,
  };
}

export class SystemMetricsSampler {
  private lastCpuTotals: CpuTotals | null = null;
  private cpuSeries: number[] = [];
  private ramSeries: number[] = [];
  private swapSeries: number[] = [];
  private ioPressureSomeSeries: number[] = [];
  private ioPressureFullSeries: number[] = [];
  private vramSeries: number[] = [];
  private gpuBusySeries: Array<number | null> = [];
  private gpuSampleTimes: number[] = [];
  private lastGpuObservation: string | null = null;
  private gpuResidentSeries: Array<number | null> = [];
  private bufferCacheSeriesBytes: number[] = [];
  private processRssSeriesBytes: number[] = [];
  private processHeapUsedSeriesBytes: number[] = [];

  constructor(
    private readonly maxSamples = 30,
    private readonly sampleIntervalMs = 2000,
    private readonly gpuVramReader: () => GpuVramUsageSnapshot | null = readGpuVramUsage,
    private readonly ioPressureReader: () => LinuxIoPressureSnapshot | null = readLinuxIoPressure,
  ) {}

  readSnapshot(runtimeMemorySnapshot?: AgentPoolMemoryInstrumentationSnapshot | null, gpus: IntelGpuSnapshot[] = [], collectGpu = true): SystemMetricsSnapshot {
    const currentCpuTotals = readCpuTotals();
    let cpuPercent = 0;
    if (this.lastCpuTotals) {
      const deltaIdle = currentCpuTotals.idle - this.lastCpuTotals.idle;
      const deltaTotal = currentCpuTotals.total - this.lastCpuTotals.total;
      cpuPercent = deltaTotal > 0 ? ((deltaTotal - deltaIdle) / deltaTotal) * 100 : 0;
    }
    this.lastCpuTotals = currentCpuTotals;

    const ramUsage = readRamUsage();
    const swapUsage = readSwapUsage();
    const ioPressure = this.ioPressureReader();
    this.ioPressureSomeSeries = ioPressure === null ? [] : pushSample(this.ioPressureSomeSeries, ioPressure.somePercent, this.maxSamples);
    this.ioPressureFullSeries = ioPressure?.fullPercent == null ? [] : pushSample(this.ioPressureFullSeries, ioPressure.fullPercent, this.maxSamples);
    const gpuVramUsage = collectGpu ? this.gpuVramReader() : null;
    const cpuValue = roundPercent(cpuPercent);
    const ramValue = ramUsage.percent;
    const swapValue = swapUsage ? roundPercent(swapUsage.percent) : null;
    const vramValue = gpuVramUsage ? roundPercent(gpuVramUsage.percent) : null;
    const rawBusy = gpuVramUsage?.busyPercent;
    const gpuBusyValue = typeof rawBusy === "number" && Number.isFinite(rawBusy) && rawBusy >= 0 && rawBusy <= 100 ? roundPercent(rawBusy) : null;
    if (collectGpu) {
      const rawTime = gpuVramUsage?.sampleTimeMs ?? Math.floor(Date.now() / this.sampleIntervalMs) * this.sampleIntervalMs;
      const identity = `${gpuVramUsage ? 'native' : 'gap'}:${rawTime}`;
      if (identity !== this.lastGpuObservation) {
        this.lastGpuObservation = identity;
        const observation = Math.max(rawTime, (this.gpuSampleTimes.at(-1) ?? -1) + 1);
        this.gpuResidentSeries = [...this.gpuResidentSeries, gpuVramUsage?.usedBytes ?? null].slice(-this.maxSamples);
        this.gpuBusySeries = [...this.gpuBusySeries, gpuBusyValue].slice(-this.maxSamples);
        this.gpuSampleTimes = [...this.gpuSampleTimes, observation].slice(-this.maxSamples);
      }
    }
    this.cpuSeries = pushSample(this.cpuSeries, cpuValue, this.maxSamples);
    this.ramSeries = pushSample(this.ramSeries, ramValue, this.maxSamples);
    this.swapSeries = swapValue === null ? [] : pushSample(this.swapSeries, swapValue, this.maxSamples);
    if (collectGpu) this.vramSeries = vramValue === null ? [] : pushSample(this.vramSeries, vramValue, this.maxSamples);
    this.bufferCacheSeriesBytes = ramUsage.bufferCacheBytes === null
      ? []
      : pushSample(this.bufferCacheSeriesBytes, ramUsage.bufferCacheBytes, this.maxSamples);

    const processMemoryUsage = process.memoryUsage();
    const procStatus = readProcStatus();
    const procSmapsRollup = readProcSmapsRollup();
    const cgroupMemoryCurrentBytes = readCgroupMemoryCurrent();
    this.processRssSeriesBytes = pushSample(this.processRssSeriesBytes, processMemoryUsage.rss, this.maxSamples);
    this.processHeapUsedSeriesBytes = pushSample(this.processHeapUsedSeriesBytes, processMemoryUsage.heapUsed, this.maxSamples);

    return {
      cpu_percent: cpuValue,
      ram_percent: ramValue,
      swap_percent: swapValue,
      io_pressure_some_percent: ioPressure?.somePercent ?? null,
      io_pressure_full_percent: ioPressure?.fullPercent ?? null,
      io_pressure_some_series: [...this.ioPressureSomeSeries],
      io_pressure_full_series: [...this.ioPressureFullSeries],
      cpu_series: [...this.cpuSeries],
      ram_series: [...this.ramSeries],
      swap_series: [...this.swapSeries],
      gpu_busy_percent: gpuBusyValue,
      gpu_busy_series: collectGpu ? [...this.gpuBusySeries] : [],
      gpu_sample_times: collectGpu ? [...this.gpuSampleTimes] : [],
      gpu_resident_series: collectGpu ? [...this.gpuResidentSeries] : [],
      vram_percent: vramValue,
      vram_series: collectGpu ? [...this.vramSeries] : [],
      vram_total_bytes: gpuVramUsage?.totalBytes ?? 0,
      vram_used_bytes: gpuVramUsage?.usedBytes ?? 0,
      gpu_provider: gpuVramUsage?.provider ?? null,
      gpus,
      buffer_cache_bytes: ramUsage.bufferCacheBytes,
      buffer_cache_series_bytes: [...this.bufferCacheSeriesBytes],
      process_rss_series_bytes: [...this.processRssSeriesBytes],
      process_heap_used_series_bytes: [...this.processHeapUsedSeriesBytes],
      swap_total_bytes: swapUsage?.totalBytes ?? 0,
      swap_used_bytes: swapUsage?.usedBytes ?? 0,
      sample_interval_ms: this.sampleIntervalMs,
      platform: process.platform,
      process_memory: {
        rss_bytes: processMemoryUsage.rss,
        heap_total_bytes: processMemoryUsage.heapTotal,
        heap_used_bytes: processMemoryUsage.heapUsed,
        external_bytes: processMemoryUsage.external,
        array_buffers_bytes: processMemoryUsage.arrayBuffers,
        vm_rss_bytes: procStatus.vmRssBytes,
        vm_hwm_bytes: procStatus.vmHwmBytes,
        rss_anon_bytes: procStatus.rssAnonBytes,
        rss_file_bytes: procStatus.rssFileBytes,
        rss_shmem_bytes: procStatus.rssShmemBytes,
        pss_bytes: procSmapsRollup.pssBytes,
        private_clean_bytes: procSmapsRollup.privateCleanBytes,
        private_dirty_bytes: procSmapsRollup.privateDirtyBytes,
        shared_clean_bytes: procSmapsRollup.sharedCleanBytes,
        shared_dirty_bytes: procSmapsRollup.sharedDirtyBytes,
        cgroup_memory_current_bytes: cgroupMemoryCurrentBytes,
        threads: procStatus.threads,
      },
      runtime_memory: normalizeRuntimeMemorySnapshot(runtimeMemorySnapshot),
    };
  }
}

const defaultSampler = new SystemMetricsSampler();
const defaultIntelGpuMetrics = new IntelGpuMetrics();

export function handleSystemMetricsRequest(
  ctx: SystemMetricsContext, sampler: SystemMetricsSampler = defaultSampler,
  gpuMetrics: Pick<IntelGpuMetrics, "read"> | null = defaultIntelGpuMetrics,
): Response {
  return ctx.json(sampler.readSnapshot(ctx.getRuntimeMemorySnapshot?.() ?? null, gpuMetrics?.read() ?? [], gpuMetrics !== null), 200);
}
