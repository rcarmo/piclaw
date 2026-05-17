import { useCallback, useEffect, useRef } from "preact/hooks";
import { useSignal, useComputed } from "@preact/signals";
import { getChatJid } from "../../api/chat-jid";
import type { AgentStatus, AgentContext, ModelInfo, ProviderUsage } from "./types";
import { fmtTokens } from "./types";
import { addonHealthSignal } from "./addonHealthSignal";
import { providerConfigured } from "../../app/providerState";
import { safeGetItem, safeSetItem } from "../../utils/storage";

export interface UseStatusPollingResult {
  agentStatus: ReturnType<typeof useSignal<AgentStatus | null>>;
  agentContext: ReturnType<typeof useSignal<AgentContext | null>>;
  error: ReturnType<typeof useSignal<boolean>>;
  isStale: ReturnType<typeof useComputed<boolean>>;
  currentModel: ReturnType<typeof useSignal<string | null>>;
  currentThinkingLevel: ReturnType<typeof useSignal<string>>;
  modelContextWindow: ReturnType<typeof useSignal<number>>;
  sessionTokens: ReturnType<typeof useSignal<number>>;
  usageLabel: ReturnType<typeof useSignal<string>>;
  providerUsage: ReturnType<typeof useSignal<ProviderUsage | null>>;
  fetchStatus: () => Promise<void>;
  fetchContext: () => Promise<void>;
}

function loadCachedContext(): AgentContext | null {
  const jid = getChatJid();
  const cached = safeGetItem(`piclaw:context-cache:${jid}`) || safeGetItem("piclaw:context-cache");
  if (!cached) return null;
  try { return JSON.parse(cached) as AgentContext; } catch { return null; }
}

export function useStatusPolling(): UseStatusPollingResult {
  const agentStatus = useSignal<AgentStatus | null>(null);
  const agentContext = useSignal<AgentContext | null>(loadCachedContext());
  const error = useSignal<boolean>(false);
  const lastSuccessAt = useSignal<number>(0);
  const pollTick = useSignal(0);
  const isStale = useComputed(() => {
    void pollTick.value; // subscribe to poll ticks for reactivity
    return error.value && lastSuccessAt.value > 0 && Date.now() - lastSuccessAt.value > 30000;
  });
  const currentModel = useSignal<string | null>(null);
  const currentThinkingLevel = useSignal<string>("");
  // #60: store model's context_window from /agent/models as fallback
  const modelContextWindow = useSignal<number>(0);
  // billing: session usage
  const sessionTokens = useSignal<number>(0);
  const usageLabel = useSignal<string>("");
  const providerUsage = useSignal<ProviderUsage | null>(null);

  // Anti-race refs: versioning, abort controllers, and in-flight guards
  const statusVersion = useRef(0);
  const contextVersion = useRef(0);
  const statusAbort = useRef<AbortController | null>(null);
  const contextAbort = useRef<AbortController | null>(null);
  const isFetchingStatus = useRef(false);
  const isFetchingContext = useRef(false);

  const fetchStatus = useCallback(async () => {
    if (isFetchingStatus.current) return;
    isFetchingStatus.current = true;
    // Abort any previous in-flight request and assign a new controller
    statusAbort.current?.abort();
    statusAbort.current = new AbortController();
    const myVersion = ++statusVersion.current;
    try {
      const res = await fetch("/agent/status?chat_jid=" + encodeURIComponent(getChatJid()), { signal: statusAbort.current.signal });
      // Discard stale response if a newer request has started
      if (statusVersion.current !== myVersion) return;
      if (res.ok) {
        const statusData = await res.json() as AgentStatus;
        agentStatus.value = statusData;
        // Update shared addon health signal
        addonHealthSignal.value = statusData.addon_api ?? null;
        error.value = false;
        lastSuccessAt.value = Date.now();
      } else {
        error.value = true;
      }
      // Also fetch current model (status.data is null when idle)
      const modelsRes = await fetch("/agent/models?chat_jid=" + encodeURIComponent(getChatJid()), { signal: statusAbort.current.signal });
      if (statusVersion.current !== myVersion) return;
      if (modelsRes.ok) {
        const info = await modelsRes.json() as ModelInfo;
        if (info.current) currentModel.value = info.current;
        if (info.thinking_level) currentThinkingLevel.value = info.thinking_level;
        // #60: store context_window from current model's definition
        const currentOpt = info.model_options?.find((m: Record<string, unknown>) => m.label === info.current || m.id === info.current);
        if (currentOpt?.context_window) modelContextWindow.value = currentOpt.context_window as number;
        // Set provider configured state from oobe field
        const oobeReady = info.oobe?.provider_ready_completed_instance;
        providerConfigured.value = oobeReady !== undefined ? !!oobeReady : !!(info.current);
        // billing: store provider_usage (conditional on data shape)
        if (info.provider_usage) {
          providerUsage.value = info.provider_usage;
          const pu = info.provider_usage as Record<string, unknown>;
          // Check if percentage-based (GitHub Copilot style)
          if (pu.primary && typeof (pu.primary as Record<string, unknown>).used_percent === "number") {
            const pct = (pu.primary as Record<string, unknown>).used_percent as number;
            const label = (pu.primary as Record<string, unknown>).label as string || "premium";
            usageLabel.value = `${pct}% ${label}`;
            sessionTokens.value = 0;
          } else {
            // Token-based provider (Anthropic, OpenAI, etc.)
            const total = Object.values(pu).reduce((sum: number, p: unknown) => {
              if (typeof p !== "object" || p === null) return sum;
              const pp = p as Record<string, unknown>;
              return sum + ((pp.total_tokens as number) ?? (((pp.input_tokens as number) ?? 0) + ((pp.output_tokens as number) ?? 0)));
            }, 0);
            if (total > 0) {
              sessionTokens.value = total;
              usageLabel.value = `▼ ${fmtTokens(total)}`;
            }
          }
        }
      }
      pollTick.value += 1;
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") return;
      console.warn("[ModelContextBar] status fetch failed:", err);
      error.value = true;
      pollTick.value += 1;
    } finally {
      isFetchingStatus.current = false;
    }
  }, []);

  const fetchContext = useCallback(async () => {
    if (isFetchingContext.current) return;
    isFetchingContext.current = true;
    // Abort any previous in-flight request and assign a new controller
    contextAbort.current?.abort();
    contextAbort.current = new AbortController();
    const myVersion = ++contextVersion.current;
    try {
      const res = await fetch("/agent/context?chat_jid=" + encodeURIComponent(getChatJid()), { signal: contextAbort.current.signal });
      // Discard stale response if a newer request has started
      if (contextVersion.current !== myVersion) return;
      if (res.ok) {
        const data = await res.json() as AgentContext;
        // Only update if backend returned real data (not all-null)
        if (data.tokens !== null) {
          agentContext.value = data;
          safeSetItem(`piclaw:context-cache:${getChatJid()}`, JSON.stringify(data));
        } else if (!agentContext.value) {
          // Load from cache on first null response
          const cached = safeGetItem(`piclaw:context-cache:${getChatJid()}`);
          if (cached) {
            try { agentContext.value = JSON.parse(cached) as AgentContext; } catch {}
          }
        }
      }
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") return;
      console.warn("[ModelContextBar] context fetch failed:", err);
    } finally {
      isFetchingContext.current = false;
    }
  }, []);

  useEffect(() => {
    void fetchStatus();
    const interval = setInterval(() => {
      void fetchStatus();
    }, 5_000);
    return () => clearInterval(interval);
  }, [fetchStatus]);

  useEffect(() => {
    void fetchContext();
    const interval = setInterval(() => {
      void fetchContext();
    }, 10_000);
    return () => clearInterval(interval);
  }, [fetchContext]);

  // Immediately refresh model/context when SSE connects (first load + reconnects)
  useEffect(() => {
    const onConnect = () => {
      void fetchStatus();
      void fetchContext();
    };
    window.addEventListener("piclaw:sse-connected", onConnect);
    return () => window.removeEventListener("piclaw:sse-connected", onConnect);
  }, [fetchStatus, fetchContext]);

  // Listen for agent_status events — extract context_usage from done events
  useEffect(() => {
    const onStatus = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      // Extract context_usage from done event (pushed by backend after each turn)
      if (detail?.context_usage && detail.context_usage.tokens !== null && detail.context_usage.tokens !== undefined) {
        const cu = detail.context_usage;
        agentContext.value = { tokens: cu.tokens, contextWindow: cu.contextWindow ?? 0, percent: cu.percent ?? 0 };
        safeSetItem(`piclaw:context-cache:${getChatJid()}`, JSON.stringify(agentContext.value));
      }
      // Always refresh context after a turn completes
      if (detail?.type === "done" || detail?.type === "error" || detail?.status === "idle") {
        setTimeout(() => { void fetchContext(); }, 500);
      }
    };
    window.addEventListener("piclaw:agent-status", onStatus);
    return () => window.removeEventListener("piclaw:agent-status", onStatus);
  }, [fetchContext]);

  return {
    agentStatus,
    agentContext,
    error,
    isStale,
    currentModel,
    currentThinkingLevel,
    modelContextWindow,
    sessionTokens,
    usageLabel,
    providerUsage,
    fetchStatus,
    fetchContext,
  };
}
