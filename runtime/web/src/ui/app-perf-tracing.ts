type TraceStatus = 'active' | 'completed' | 'cancelled' | 'failed';

type TracePhase = {
  phase: string;
  at: number;
  detail?: Record<string, unknown> | null;
};

type TraceEntry = {
  id: string;
  type: string;
  chatJid: string;
  startedAt: number;
  detail?: Record<string, unknown> | null;
  phases: TracePhase[];
  status: TraceStatus;
  completedAt?: number;
  durationMs?: number;
  error?: string;
};

type RequestEntry = {
  id: string;
  method: string;
  url: string;
  startedAt: number;
  durationMs: number;
  status?: number;
  ok?: boolean;
  requestId?: string | null;
  serverTiming?: string | null;
  detail?: Record<string, unknown> | null;
};

type PerfApi = {
  startTrace: (type: string, chatJid: string, detail?: Record<string, unknown> | null) => string;
  ensureTrace: (type: string, chatJid: string, detail?: Record<string, unknown> | null) => string;
  getActiveTraceId: (type: string, chatJid: string) => string | null;
  markTrace: (traceId: string | null | undefined, phase: string, detail?: Record<string, unknown> | null) => void;
  completeTrace: (traceId: string | null | undefined, phase?: string, detail?: Record<string, unknown> | null) => void;
  failTrace: (traceId: string | null | undefined, error: unknown, phase?: string, detail?: Record<string, unknown> | null) => void;
  cancelTrace: (traceId: string | null | undefined, phase?: string, detail?: Record<string, unknown> | null) => void;
  recordRequest: (entry: Omit<RequestEntry, 'id'>) => string;
  getTraces: () => TraceEntry[];
  getRequests: () => RequestEntry[];
  clear: () => void;
  printSummary: () => { traces: TraceEntry[]; requests: RequestEntry[] };
};

type PerfWindow = Window & typeof globalThis & Record<string, unknown>;

const PERF_GLOBAL_KEY = '__PICLAW_PERF__';
const TRACE_LIMIT = 100;
const REQUEST_LIMIT = 300;

const traces: TraceEntry[] = [];
const requests: RequestEntry[] = [];
const activeTraceIds = new Map<string, string>();

function getRuntimeWindow(runtimeWindow: PerfWindow | null = typeof window !== 'undefined' ? window as PerfWindow : null): PerfWindow | null {
  return runtimeWindow || null;
}

function now(): number {
  if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
    return performance.now();
  }
  return Date.now();
}

function buildTraceKey(type: string, chatJid: string): string {
  return `${type}:${chatJid}`;
}

function nextId(prefix: string): string {
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}-${Date.now().toString(36)}`;
}

function trimBuffer<T>(buffer: T[], limit: number): void {
  if (buffer.length <= limit) return;
  buffer.splice(0, buffer.length - limit);
}

function cloneDetail(detail: Record<string, unknown> | null | undefined): Record<string, unknown> | null {
  if (!detail || typeof detail !== 'object') return null;
  return { ...detail };
}

function findTrace(traceId: string | null | undefined): TraceEntry | null {
  if (!traceId) return null;
  return traces.find((entry) => entry.id === traceId) || null;
}

function markPerformance(traceId: string, phase: string): void {
  if (typeof performance === 'undefined' || typeof performance.mark !== 'function') return;
  try {
    performance.mark(`piclaw:${traceId}:${phase}`);
  } catch (error) {
    console.debug('[app-perf] Ignoring performance.mark failure.', error, { traceId, phase });
  }
}

function createTrace(type: string, chatJid: string, detail?: Record<string, unknown> | null): string {
  const traceId = nextId(type);
  const entry: TraceEntry = {
    id: traceId,
    type,
    chatJid,
    startedAt: now(),
    detail: cloneDetail(detail),
    phases: [],
    status: 'active',
  };
  traces.push(entry);
  trimBuffer(traces, TRACE_LIMIT);
  activeTraceIds.set(buildTraceKey(type, chatJid), traceId);
  markPerformance(traceId, 'start');
  return traceId;
}

function endTrace(traceId: string | null | undefined, status: TraceStatus, phase: string, detail?: Record<string, unknown> | null, error?: unknown): void {
  const trace = findTrace(traceId);
  if (!trace || trace.status !== 'active') return;
  if (phase) {
    trace.phases.push({ phase, at: now(), detail: cloneDetail(detail) });
    markPerformance(trace.id, phase);
  }
  trace.status = status;
  trace.completedAt = now();
  trace.durationMs = trace.completedAt - trace.startedAt;
  if (error !== undefined) {
    trace.error = error instanceof Error ? error.message : String(error);
  }
  const key = buildTraceKey(trace.type, trace.chatJid);
  if (activeTraceIds.get(key) === trace.id) {
    activeTraceIds.delete(key);
  }
}

const perfApi: PerfApi = {
  'startTrace'(type, chatJid, detail) {
    return createTrace(type, chatJid, detail);
  },
  'ensureTrace'(type, chatJid, detail) {
    const existing = activeTraceIds.get(buildTraceKey(type, chatJid));
    if (existing && findTrace(existing)?.status === 'active') {
      return existing;
    }
    return createTrace(type, chatJid, detail);
  },
  'getActiveTraceId'(type, chatJid) {
    const existing = activeTraceIds.get(buildTraceKey(type, chatJid));
    return existing && findTrace(existing)?.status === 'active' ? existing : null;
  },
  'markTrace'(traceId, phase, detail) {
    const trace = findTrace(traceId);
    if (!trace || trace.status !== 'active') return;
    trace.phases.push({ phase, at: now(), detail: cloneDetail(detail) });
    markPerformance(trace.id, phase);
  },
  'completeTrace'(traceId, phase = 'settled', detail) {
    endTrace(traceId, 'completed', phase, detail);
  },
  'failTrace'(traceId, error, phase = 'failed', detail) {
    endTrace(traceId, 'failed', phase, detail, error);
  },
  'cancelTrace'(traceId, phase = 'cancelled', detail) {
    endTrace(traceId, 'cancelled', phase, detail);
  },
  'recordRequest'(entry) {
    const requestId = nextId('req');
    requests.push({ ...entry, id: requestId, detail: cloneDetail(entry.detail) });
    trimBuffer(requests, REQUEST_LIMIT);
    return requestId;
  },
  'getTraces'() {
    return traces.map((entry) => ({
      ...entry,
      detail: cloneDetail(entry.detail),
      phases: entry.phases.map((phase) => ({ ...phase, detail: cloneDetail(phase.detail) })),
    }));
  },
  'getRequests'() {
    return requests.map((entry) => ({ ...entry, detail: cloneDetail(entry.detail) }));
  },
  'clear'() {
    traces.splice(0, traces.length);
    requests.splice(0, requests.length);
    activeTraceIds.clear();
  },
  'printSummary'() {
    const payload = {
      traces: perfApi['getTraces'](),
      requests: perfApi['getRequests'](),
    };
    console.table(payload.traces.map((entry) => ({
      id: entry.id,
      type: entry.type,
      chatJid: entry.chatJid,
      status: entry.status,
      durationMs: Number(entry.durationMs || 0).toFixed(1),
      lastPhase: entry.phases[entry.phases.length - 1]?.phase || 'start',
    })));
    return payload;
  },
};

export function installAppPerfTracing(runtimeWindow: PerfWindow | null = getRuntimeWindow()): PerfApi {
  const existing = runtimeWindow?.[PERF_GLOBAL_KEY] as PerfApi | undefined;
  if (existing) return existing;
  if (runtimeWindow) {
    runtimeWindow[PERF_GLOBAL_KEY] = perfApi;
  }
  return perfApi;
}

export function getAppPerfTracing(runtimeWindow: PerfWindow | null = getRuntimeWindow()): PerfApi {
  return installAppPerfTracing(runtimeWindow);
}

export function startAppPerfTrace(type: string, chatJid: string, detail?: Record<string, unknown> | null): string {
  return getAppPerfTracing().startTrace(type, chatJid, detail);
}

export function ensureAppPerfTrace(type: string, chatJid: string, detail?: Record<string, unknown> | null): string {
  return getAppPerfTracing().ensureTrace(type, chatJid, detail);
}

export function getActiveAppPerfTraceId(type: string, chatJid: string): string | null {
  return getAppPerfTracing().getActiveTraceId(type, chatJid);
}

export function markAppPerfTrace(traceId: string | null | undefined, phase: string, detail?: Record<string, unknown> | null): void {
  getAppPerfTracing().markTrace(traceId, phase, detail);
}

export function completeAppPerfTrace(traceId: string | null | undefined, phase = 'settled', detail?: Record<string, unknown> | null): void {
  getAppPerfTracing().completeTrace(traceId, phase, detail);
}

export function completeAppPerfTraceIfReady(
  traceId: string | null | undefined,
  requiredPhases: string[],
  phase = 'settled',
  detail?: Record<string, unknown> | null,
): boolean {
  const trace = findTrace(traceId);
  if (!trace || trace.status !== 'active') return false;
  const seen = new Set(trace.phases.map((entry) => entry.phase));
  if (!requiredPhases.every((required) => seen.has(required))) {
    return false;
  }
  endTrace(traceId, 'completed', phase, detail);
  return true;
}

export function failAppPerfTrace(traceId: string | null | undefined, error: unknown, phase = 'failed', detail?: Record<string, unknown> | null): void {
  getAppPerfTracing().failTrace(traceId, error, phase, detail);
}

export function cancelAppPerfTrace(traceId: string | null | undefined, phase = 'cancelled', detail?: Record<string, unknown> | null): void {
  getAppPerfTracing().cancelTrace(traceId, phase, detail);
}

export function recordAppPerfRequest(entry: Omit<RequestEntry, 'id'>): string {
  return getAppPerfTracing().recordRequest(entry);
}
