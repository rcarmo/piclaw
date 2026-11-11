import { afterEach, expect, test } from 'bun:test';
import {
  METERS_COLLAPSED_EVENT_NAME,
  METERS_COLLAPSED_STORAGE_KEY,
  applyMetersCollapsed,
  readStoredMetersCollapsed,
  toggleMetersCollapsed,
} from '../../web/src/ui/meters.ts';
import { SYSTEM_METERS_COMPACT_BREAKPOINT_PX, SYSTEM_METERS_POLL_MS, buildCompactMetersSummary, buildSparklinePath, formatBytesCompact, resolveCurrentRssBytes, resolveGpuMeterSnapshots, GpuSnapshotTracker, shouldShowRss, shouldShowVram } from '../../web/src/components/system-meters-hud.ts';

import { GpuMetricsCache } from '../../src/channels/web/agent/gpu-metrics-cache.ts';
import { SystemMetricsSampler } from '../../src/channels/web/agent/system-metrics.ts';
import { normalizeGpuSnapshots } from '../../web/src/components/intel-gpu-meters.ts';

test('legacy NVIDIA aggregate memory remains discoverable through transient reader failure', () => {
    const tracker = new GpuSnapshotTracker();
    const good = { gpus: [], gpu_provider: 'nvml', vram_percent: 0, vram_total_bytes: 4096, vram_used_bytes: 0, vram_series: [0] };
    expect(tracker.resolve({gpus:[]})).toEqual([]);
    expect(tracker.resolve(good)).toHaveLength(1);
    const [missing] = tracker.resolve({gpus:[],gpu_provider:null,vram_percent:null,vram_total_bytes:0});
    expect(missing.provider).toBe('nvml');expect(missing.status).toBe('unavailable');expect(missing.memory.used_bytes).toBeUndefined();
    const devices=[{id:'nv0',provider:'nvml',disabled:true}];expect(tracker.resolve({gpus:devices})).toEqual(devices);
    expect(tracker.resolve({gpus:[]})).toEqual([]);
});

const originalWindow = globalThis.window;

function makeWindow(initial = {}) {
  const store = new Map(Object.entries(initial));
  const events: Array<{ type: string; detail: any }> = [];
  return {
    localStorage: {
      getItem: (key: string) => (store.has(key) ? String(store.get(key)) : null),
      setItem: (key: string, value: string) => {
        store.set(key, value);
      },
    },
    dispatchEvent: (event: Event & { detail?: any }) => {
      events.push({ type: event.type, detail: (event as any).detail });
      return true;
    },
    __events: events,
  } as any;
}

afterEach(() => {
  globalThis.window = originalWindow;
});

test('applyMetersCollapsed persists state and dispatches a collapsed-change event', () => {
  const win = makeWindow();
  globalThis.window = win;

  const next = applyMetersCollapsed(true);

  expect(next).toBe(true);
  expect(win.localStorage.getItem(METERS_COLLAPSED_STORAGE_KEY)).toBe('true');
  expect(win.__events).toEqual([
    { type: METERS_COLLAPSED_EVENT_NAME, detail: { collapsed: true } },
  ]);
});

test('system meters compact breakpoint is 600px', () => {
  expect(SYSTEM_METERS_COMPACT_BREAKPOINT_PX).toBe(600);
});

test('buildCompactMetersSummary uses fat bullet separators and includes Linux buffer/cache when present', () => {
  expect(buildCompactMetersSummary({
    cpu_percent: 18,
    ram_percent: 62,
    buffer_cache_bytes: 512 * 1024 * 1024,
    swap_percent: 7,
    swap_total_bytes: 1024,
  })).toBe('CPU 18% • RAM 62% • BUF 512M • SWP 7%');
  expect(buildCompactMetersSummary({
    cpu_percent: 18,
    ram_percent: 62,
    buffer_cache_bytes: null,
    vram_percent: 33,
    vram_total_bytes: 8 * 1024 * 1024 * 1024,
    vram_used_bytes: 3 * 1024 * 1024 * 1024,
    vram_series: [25, 33],
    swap_percent: null,
    swap_total_bytes: 0,
  })).toBe('CPU 18% • RAM 62% • VRAM 33%');
  expect(buildCompactMetersSummary({ cpu_percent: 18, ram_percent: 62, buffer_cache_bytes: null, swap_percent: null, swap_total_bytes: 0 })).toBe('CPU 18% • RAM 62%');
});

test('buildSparklinePath supports dynamically scaled byte series and flat lines', () => {
  expect(buildSparklinePath([100, 200], 56, 16)).toBe('M 0.00 16.00 L 56.00 0.00');
  expect(buildSparklinePath([512, 512], 56, 16)).toBe('M 0 8.00 L 56 8.00');
});

test('formatBytesCompact keeps RSS labels short enough for the HUD', () => {
  expect(formatBytesCompact(0)).toBe('0B');
  expect(formatBytesCompact(512 * 1024 * 1024)).toBe('512M');
  expect(formatBytesCompact(1536 * 1024 * 1024)).toBe('1.5G');
});

test('resolveCurrentRssBytes prefers Linux VmRSS but still exposes cross-platform RSS', () => {
  expect(resolveCurrentRssBytes({ process_memory: { vm_rss_bytes: 256, rss_bytes: 128 } })).toBe(256);
  expect(resolveCurrentRssBytes({ process_memory: { vm_rss_bytes: null, rss_bytes: 128 } })).toBe(128);
  expect(resolveCurrentRssBytes({ process_memory: { vm_rss_bytes: 0, rss_bytes: 128 } })).toBe(128);
});

test('shouldShowRss allows Windows and macOS resident-memory meters when RSS data exists', () => {
  expect(shouldShowRss({
    platform: 'win32',
    process_memory: { vm_rss_bytes: null, rss_bytes: 200 },
    process_rss_series_bytes: [100, 200],
  })).toBe(true);
  expect(shouldShowRss({
    platform: 'darwin',
    process_memory: { vm_rss_bytes: null, rss_bytes: 300 },
    process_rss_series_bytes: [150, 300],
  })).toBe(true);
  expect(shouldShowRss({
    platform: 'linux',
    process_memory: { vm_rss_bytes: 0, rss_bytes: 0 },
    process_rss_series_bytes: [0, 0],
  })).toBe(false);
  expect(shouldShowRss({
    platform: 'win32',
    process_memory: { vm_rss_bytes: null, rss_bytes: 300 },
    process_rss_series_bytes: [],
  })).toBe(false);
});

test('shouldShowVram requires valid optional GPU memory telemetry', () => {
  expect(shouldShowVram({
    vram_percent: 50,
    vram_total_bytes: 8 * 1024 * 1024 * 1024,
    vram_used_bytes: 4 * 1024 * 1024 * 1024,
    vram_series: [25, 50],
    gpu_provider: 'nvidia-smi',
  })).toBe(true);
  expect(shouldShowVram({
    vram_percent: null,
    vram_total_bytes: 8 * 1024 * 1024 * 1024,
    vram_used_bytes: 4 * 1024 * 1024 * 1024,
    vram_series: [25, 50],
  })).toBe(false);
  expect(shouldShowVram({
    vram_percent: 50,
    vram_total_bytes: 0,
    vram_used_bytes: 0,
    vram_series: [50],
  })).toBe(false);
  expect(shouldShowVram({
    vram_percent: 50,
    vram_total_bytes: 8 * 1024 * 1024 * 1024,
    vram_used_bytes: 4 * 1024 * 1024 * 1024,
    vram_series: [],
  })).toBe(false);
});
test('meter polling preserves demand-driven GPU samples and VRAM chart history', () => {
  let now = 0;
  let requestId = 0;
  let reads = 0;
  const worker = {
    onmessage: null as ((event: MessageEvent) => void) | null,
    onerror: null as ((event: ErrorEvent) => void) | null,
    postMessage(message: any) { if (message.type === 'sample') requestId = message.id; },
  };
  const cache = new GpuMetricsCache(() => worker, () => now);
  const sampler = new SystemMetricsSampler(30, SYSTEM_METERS_POLL_MS, () => cache.read());
  const poll = () => sampler.readSnapshot();
  const complete = () => {
    now += 5; // Worker replies after the HTTP snapshot, not synchronously.
    reads += 1;
    const usedBytes = reads * 1024;
    worker.onmessage!({ data: { id: requestId, snapshot: {
      totalBytes: 4096, usedBytes, percent: usedBytes / 4096 * 100, provider: 'nvml',
    } } } as MessageEvent);
  };

  expect(poll().vram_percent).toBeNull(); // Discovery is asynchronous.
  complete();
  let lastRequestId = requestId;
  for (let index = 1; index <= 5; index += 1) {
    now = index * SYSTEM_METERS_POLL_MS;
    const metrics = poll();
    expect(metrics.sample_interval_ms).toBe(SYSTEM_METERS_POLL_MS);
    expect(metrics.gpu_provider).toBe('nvml');
    expect(metrics.vram_series).toHaveLength(index);
    expect(metrics.vram_percent).toBeGreaterThan(0);
    const [meter] = normalizeGpuSnapshots(resolveGpuMeterSnapshots(metrics), { nowMs: now });
    expect(meter.rows.residentSparkPath).toContain('L');
    expect(meter.rows.residentSparkPath).not.toContain('NaN');
    if (requestId !== lastRequestId) { complete(); lastRequestId = requestId; }
  }
  expect(reads).toBeGreaterThan(1);
  // A genuinely overdue poll must still suppress stale readings.
  now += 6000;
  expect(poll().vram_percent).toBeNull();
  cache.dispose();
});

test('aggregate non-Intel telemetry supplies a generic GPU memory popup only when enabled and available',()=>{
 const value={gpu_provider:'nvml',gpus:[],vram_percent:50,vram_total_bytes:4096,vram_used_bytes:2048,vram_series:[25,50]};expect(resolveGpuMeterSnapshots(value)).toMatchObject([{name:'GPU',provider:'nvml',memory:{used_bytes:2048,total_bytes:4096}}]);expect(resolveGpuMeterSnapshots({...value,vram_percent:null})).toEqual([]);expect(resolveGpuMeterSnapshots({...value,gpus:[{id:'nvidia0',provider:'nvml'}]})).toHaveLength(1);
});
test('invalid or missing aggregate memory counters do not fabricate enabled GPU rows',()=>{
 const value={gpu_provider:'nvml',gpus:[],vram_percent:50,vram_total_bytes:4096,vram_used_bytes:2048,vram_series:[50]};
 for(const patch of [{vram_used_bytes:null},{vram_used_bytes:undefined},{vram_percent:101},{vram_total_bytes:Infinity},{vram_used_bytes:8192}])expect(resolveGpuMeterSnapshots({...value,...patch})).toEqual([]);
});
test('compact system summary omits disabled optional lines without turning null into idle zero',()=>{
 expect(buildCompactMetersSummary({cpu_percent:null,ram_percent:0,swap_percent:null,swap_total_bytes:4096,vram_percent:null,vram_total_bytes:4096,vram_used_bytes:0,vram_series:[0]})).toBe('RAM 0%');
});

test('toggleMetersCollapsed flips the stored collapsed state', () => {
  const win = makeWindow({ [METERS_COLLAPSED_STORAGE_KEY]: 'true' });
  globalThis.window = win;

  expect(readStoredMetersCollapsed(false)).toBe(true);
  expect(toggleMetersCollapsed()).toBe(false);
  expect(readStoredMetersCollapsed(false)).toBe(false);
});

test('applyMetersFromEvent applies server-persisted collapsed state and ignores the retired enabled flag', async () => {
  const win = makeWindow();
  globalThis.window = win;
  const { applyMetersFromEvent } = await import('../../web/src/ui/meters.ts');

  applyMetersFromEvent({ enabled: false, collapsed: true });

  expect(readStoredMetersCollapsed(false)).toBe(true);
  expect(win.localStorage.getItem('piclaw_system_meters_enabled')).toBeNull();
  expect(win.__events).toEqual([{ type: METERS_COLLAPSED_EVENT_NAME, detail: { collapsed: true } }]);
});

test('aggregate GPU activity adds the GPU row without conflating it with VRAM percent',()=>{
 const value={gpu_provider:'nvml',gpus:[],vram_percent:50,vram_total_bytes:4096,vram_used_bytes:2048,vram_series:[25,50],gpu_busy_percent:0,gpu_busy_series:[75,null,0]};
 const [snapshot]=resolveGpuMeterSnapshots(value);
 expect(snapshot.busy_percent).toBe(0);
 expect(snapshot.history.map(x=>x.busy_percent)).toEqual([75,null,0]);
 expect(snapshot.history.map(x=>x.resident_bytes)).toEqual([null,1024,2048]);
 const [meter]=normalizeGpuSnapshots([snapshot]);expect(meter.rows.busyText).toBe('0%');expect(meter.rows.residentText).toBe('50%');
 expect(meter.rows.busySparkPath).not.toContain('NaN');
 const [memoryOnly]=normalizeGpuSnapshots(resolveGpuMeterSnapshots({...value,gpu_busy_percent:null}));expect(memoryOnly.rows.busyPercent).toBeNull();expect(memoryOnly.rows.residentText).toBe('50%');
});

test('aggregate sample identities and resident gaps survive tracker outages and recovery',()=>{
 const tracker=new GpuSnapshotTracker();const base={gpus:[],vram_percent:25,vram_total_bytes:100,vram_used_bytes:25,vram_series:[25,25,25],gpu_provider:'nvml',gpu_busy_percent:20,gpu_busy_series:[20],gpu_sample_times:[10000],gpu_resident_series:[25]};
 expect(tracker.resolve(base)[0].sample_time_ms).toBe(10000);
 const missing=tracker.resolve({...base,vram_percent:null,vram_series:[],gpu_busy_series:[20,null],gpu_sample_times:[10000,12000],gpu_resident_series:[25,null]})[0];expect(missing.sample_time_ms).toBe(12000);expect(missing.history[1]).toEqual({timestamp_ms:12000,busy_percent:null,resident_bytes:null});
 const recovered=tracker.resolve({...base,vram_percent:50,vram_used_bytes:50,vram_series:[25,25,50],gpu_busy_series:[20,null,60],gpu_sample_times:[10000,12000,14000],gpu_resident_series:[25,null,50]})[0];expect(recovered.history.map(row=>row.resident_bytes)).toEqual([25,null,50]);expect(recovered.history.map(row=>row.timestamp_ms)).toEqual([10000,12000,14000]);
});
