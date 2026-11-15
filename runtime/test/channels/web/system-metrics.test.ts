import { expect, test } from "bun:test";
import { handleSystemMetricsRequest, parseLinuxRamMeminfo, parseLinuxSwapMeminfo, SystemMetricsSampler } from "../../../src/channels/web/agent/system-metrics.js";

test("system metrics reads shared GPU cache but can opt out for general UI polling", async () => {
  let reads = 0;
  const gpu = { read: () => { reads++; return []; } };
  const ctx = { json: (payload: unknown) => Response.json(payload) };
  let nvmlReads = 0;
  const sampler = new SystemMetricsSampler(2, 2000, () => { nvmlReads++; return { usedBytes: 25, totalBytes: 100, percent: 25, provider: "nvml" }; });
  const a = await handleSystemMetricsRequest(ctx, sampler, gpu).json();
  expect(a.gpus).toEqual([]);
  expect(reads).toBe(1);
  expect(nvmlReads).toBe(1);
  expect(a.vram_percent).toBe(25);
  const b = await handleSystemMetricsRequest(ctx, sampler, null).json();
  expect(b.gpus).toEqual([]);
  expect(b.vram_percent).toBeNull();
  expect(reads).toBe(1);
  expect(nvmlReads).toBe(1);
  expect(b.vram_series).toEqual([]);
  const c = await handleSystemMetricsRequest(ctx, sampler, gpu).json();
  expect(c.vram_series).toEqual([25, 25]);
  expect(reads).toBe(2);
  expect(nvmlReads).toBe(2);
});

test("parseLinuxRamMeminfo uses MemAvailable instead of MemFree for usage", () => {
  expect(parseLinuxRamMeminfo([
    "MemTotal:        7864320 kB",
    "MemFree:         3879731 kB",
    "MemAvailable:    6396313 kB",
    "Buffers:          123456 kB",
    "Cached:          2500000 kB",
    "SReclaimable:      400000 kB",
    "Shmem:             100000 kB",
  ].join("\n"))).toEqual({
    totalBytes: 7864320 * 1024,
    usedBytes: (7864320 - 6396313) * 1024,
    percent: 18.7,
    bufferCacheBytes: (123456 + 2500000 + 400000 - 100000) * 1024,
  });

  expect(parseLinuxRamMeminfo("MemTotal:       16384256 kB\nMemFree:         1024000 kB")).toBeNull();
});

test("parseLinuxSwapMeminfo parses swap totals and usage from /proc/meminfo text", () => {
  expect(parseLinuxSwapMeminfo([
    "MemTotal:       16384256 kB",
    "MemFree:         1024000 kB",
    "SwapTotal:       2097148 kB",
    "SwapFree:        1048574 kB",
  ].join("\n"))).toEqual({
    totalBytes: 2097148 * 1024,
    usedBytes: (2097148 - 1048574) * 1024,
    percent: 50,
  });

  expect(parseLinuxSwapMeminfo("SwapTotal:             0 kB\nSwapFree:              0 kB")).toBeNull();
});

test("SystemMetricsSampler returns bounded CPU/RAM payloads with rolling series", () => {
  const sampler = new SystemMetricsSampler(3, 1500, () => null);

  const first = sampler.readSnapshot();
  const second = sampler.readSnapshot();
  const third = sampler.readSnapshot();
  const fourth = sampler.readSnapshot();

  for (const sample of [first, second, third, fourth]) {
    expect(sample.process_memory.rss_bytes).toBeGreaterThan(0);
    expect(sample.process_memory.heap_total_bytes).toBeGreaterThan(0);
    expect(sample.process_memory.heap_used_bytes).toBeGreaterThanOrEqual(0);
    expect(sample.process_memory.external_bytes).toBeGreaterThanOrEqual(0);
    expect(sample.process_memory.array_buffers_bytes).toBeGreaterThanOrEqual(0);
    expect(sample.buffer_cache_bytes === null || sample.buffer_cache_bytes >= 0).toBe(true);
    expect(Array.isArray(sample.buffer_cache_series_bytes)).toBe(true);
    expect(Array.isArray(sample.process_rss_series_bytes)).toBe(true);
    expect(Array.isArray(sample.process_heap_used_series_bytes)).toBe(true);
    expect(sample.process_rss_series_bytes.length).toBeLessThanOrEqual(3);
    expect(sample.process_heap_used_series_bytes.length).toBeLessThanOrEqual(3);
    expect(sample.buffer_cache_series_bytes.length).toBeLessThanOrEqual(3);
    expect(sample.runtime_memory).toBeNull();
    expect(sample.cpu_percent).toBeGreaterThanOrEqual(0);
    expect(sample.cpu_percent).toBeLessThanOrEqual(100);
    expect(sample.ram_percent).toBeGreaterThanOrEqual(0);
    expect(sample.ram_percent).toBeLessThanOrEqual(100);
    expect(sample.sample_interval_ms).toBe(1500);
    expect(Array.isArray(sample.cpu_series)).toBe(true);
    expect(Array.isArray(sample.ram_series)).toBe(true);
    expect(Array.isArray(sample.swap_series)).toBe(true);
    expect(sample.vram_percent).toBeNull();
    expect(sample.vram_total_bytes).toBe(0);
    expect(sample.vram_used_bytes).toBe(0);
    expect(sample.gpu_provider).toBeNull();
    expect(sample.vram_series).toEqual([]);
    expect(sample.cpu_series.length).toBeLessThanOrEqual(3);
    expect(sample.ram_series.length).toBeLessThanOrEqual(3);
    expect(sample.swap_series.length).toBeLessThanOrEqual(3);
    if (sample.swap_percent !== null) {
      expect(sample.swap_percent).toBeGreaterThanOrEqual(0);
      expect(sample.swap_percent).toBeLessThanOrEqual(100);
      expect(sample.swap_total_bytes).toBeGreaterThan(0);
      expect(sample.swap_used_bytes).toBeGreaterThanOrEqual(0);
    }
  }

  expect(fourth.cpu_series.length).toBe(3);
  expect(fourth.ram_series.length).toBe(3);
  if (fourth.buffer_cache_bytes !== null) {
    expect(fourth.buffer_cache_series_bytes.length).toBe(3);
  }
  expect(fourth.process_rss_series_bytes.length).toBe(3);
  expect(fourth.process_heap_used_series_bytes.length).toBe(3);
});

test("SystemMetricsSampler includes optional bounded VRAM payloads when GPU telemetry is available", () => {
  const samples = [
    { usedBytes: 1 * 1024 * 1024 * 1024, totalBytes: 4 * 1024 * 1024 * 1024, percent: 25, provider: "nvml" },
    { usedBytes: 2 * 1024 * 1024 * 1024, totalBytes: 4 * 1024 * 1024 * 1024, percent: 50, provider: "nvml" },
    { usedBytes: 3 * 1024 * 1024 * 1024, totalBytes: 4 * 1024 * 1024 * 1024, percent: 75, provider: "nvml" },
  ];
  const sampler = new SystemMetricsSampler(2, 1500, () => samples.shift() ?? null);

  sampler.readSnapshot();
  const second = sampler.readSnapshot();
  const third = sampler.readSnapshot();

  expect(second.vram_percent).toBe(50);
  expect(second.vram_series).toEqual([25, 50]);
  expect(third.vram_percent).toBe(75);
  expect(third.vram_series).toEqual([50, 75]);
  expect(third.vram_total_bytes).toBe(4 * 1024 * 1024 * 1024);
  expect(third.vram_used_bytes).toBe(3 * 1024 * 1024 * 1024);
  expect(third.gpu_provider).toBe("nvml");
});

test("handleSystemMetricsRequest includes runtime memory instrumentation when provided", async () => {
  const response = handleSystemMetricsRequest({
    json: (payload, status = 200) => new Response(JSON.stringify(payload), { status, headers: { "content-type": "application/json" } }),
    getRuntimeMemorySnapshot: () => ({
      cachedMainSessions: 2,
      cachedSideSessions: 1,
      activeForkBaseLeaves: 3,
      activeChats: 4,
      sessionResources: {
        sessionEntries: 15,
        activeMessages: 16,
        persistedSessionBytes: 17,
        loadedSkills: 18,
        loadedExtensions: 19,
        registeredTools: 20,
      },
      sessionManager: {
        branchSeedRealizationsInFlight: 5,
        createInFlight: 6,
        invalidDeferredSeedErrors: 7,
      },
    }),
  }, new SystemMetricsSampler(2, 1000, () => null));

  expect(response.status).toBe(200);
  const payload = await response.json();
  expect(payload.runtime_memory).toEqual({
    cached_main_sessions: 2,
    cached_side_sessions: 1,
    active_fork_base_leaves: 3,
    active_chats: 4,
    session_entries: 15,
    active_messages: 16,
    persisted_session_bytes: 17,
    loaded_skills: 18,
    loaded_extensions: 19,
    registered_tools: 20,
    create_in_flight: 6,
    branch_seed_realizations_in_flight: 5,
    invalid_deferred_seed_errors: 7,
  });
});

test('optional GPU activity has nullable history and survives memory-only telemetry',()=>{
 let value:any={totalBytes:100,usedBytes:25,percent:25,provider:'nvml',busyPercent:0,sampleTimeMs:1};
 const sampler=new SystemMetricsSampler(3,2000,()=>value);
 expect(sampler.readSnapshot()).toMatchObject({gpu_busy_percent:0,gpu_busy_series:[0],vram_percent:25});
 value.sampleTimeMs=2;value.busyPercent=60;expect(sampler.readSnapshot().gpu_busy_series).toEqual([0,60]);
 value.sampleTimeMs=3;value.busyPercent=null;expect(sampler.readSnapshot()).toMatchObject({gpu_busy_percent:null,gpu_busy_series:[0,60,null],vram_percent:25});
 expect(sampler.readSnapshot(null,[],false)).toMatchObject({gpu_busy_percent:null,gpu_busy_series:[],vram_percent:null});
 value.sampleTimeMs=4;value.busyPercent=100;expect(sampler.readSnapshot().gpu_busy_series).toEqual([60,null,100]);
});

test('GPU activity samples once per shared observation and carries gap identities',()=>{
 let value:any={totalBytes:100,usedBytes:25,percent:25,provider:'nvml',busyPercent:20,sampleTimeMs:10000};const sampler=new SystemMetricsSampler(30,2000,()=>value);
 for(let i=0;i<40;i++)sampler.readSnapshot();expect(sampler.readSnapshot().gpu_busy_series).toEqual([20]);
 value={...value,busyPercent:null,sampleTimeMs:12000};sampler.readSnapshot();value={...value,busyPercent:50,sampleTimeMs:14000};const next=sampler.readSnapshot();expect(next.gpu_busy_series).toEqual([20,null,50]);expect(next.gpu_sample_times).toEqual([10000,12000,14000]);
});
