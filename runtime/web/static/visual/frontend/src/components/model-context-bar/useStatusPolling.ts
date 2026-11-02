import { useCallback, useEffect, useRef } from "preact/hooks";
import { useSignal, useComputed } from "@preact/signals";
import { getChatJid } from "../../api/chat-jid";
import type { AgentStatus, AgentContext, ModelInfo, ProviderUsage } from "./types";
import { addonHealthSignal } from "./addonHealthSignal";
import { providerConfigured } from "../../app/providerState";
import { mergeVisualLiveContext } from "./telemetry";
import { mergeModelStatePayload } from "../../../../../../src/ui/app-model-state";
import { AGENT_UI_POLL_MS, getAgentUiSnapshot, invalidateAgentUiSnapshot } from "../../../../../../src/ui/agent-ui-snapshot";

import { createLogger } from "../../utils/logger";
import { updateAgentDisplayName } from "../../api/agent-identity";
const log = createLogger("ModelContextBar");


export interface UseStatusPollingResult {
  agentStatus: ReturnType<typeof useSignal<AgentStatus | null>>;
  agentContext: ReturnType<typeof useSignal<AgentContext | null>>;
  error: ReturnType<typeof useSignal<boolean>>;
  isStale: ReturnType<typeof useComputed<boolean>>;
  currentModel: ReturnType<typeof useSignal<string | null>>;
  currentThinkingLevel: ReturnType<typeof useSignal<string>>;
  providerUsage: ReturnType<typeof useSignal<ProviderUsage | null>>;
  systemMetrics: ReturnType<typeof useSignal<any>>;
  metricsError: ReturnType<typeof useSignal<boolean>>;
  modelSelectionKnown: ReturnType<typeof useSignal<boolean>>;
  modelInfo: ReturnType<typeof useSignal<Record<string, any> | null>>;
  fetchStatus: () => Promise<void>;
  fetchContext: () => Promise<void>;
}

export function useStatusPolling(): UseStatusPollingResult {
  const agentStatus = useSignal<AgentStatus | null>(null);
  const agentContext = useSignal<AgentContext | null>(null);
  const error = useSignal<boolean>(false);
  const lastSuccessAt = useSignal<number>(0);
  const pollTick = useSignal(0);
  const isStale = useComputed(() => {
    void pollTick.value; // subscribe to poll ticks for reactivity
    return error.value && lastSuccessAt.value > 0 && Date.now() - lastSuccessAt.value > 30000;
  });
  const currentModel = useSignal<string | null>(null);
  const currentThinkingLevel = useSignal<string>("");
  const providerUsage = useSignal<ProviderUsage | null>(null);
  const systemMetrics = useSignal<any>(null);
  const metricsError = useSignal(false);
  const modelSelectionKnown = useSignal(false);
  const modelInfo = useSignal<Record<string, any> | null>(null);
  const contextVersion = useRef(0);

  const applyModel = (payload: Record<string, any>) => {
    const previous = modelInfo.value;
    const info = mergeModelStatePayload(previous, payload)!;
    modelInfo.value = info;
    if (info.current !== undefined) modelSelectionKnown.value = true;
    const changed = previous && info.current !== previous.current;
    currentModel.value = info.current ?? null;
    currentThinkingLevel.value = info.supports_thinking === false ? "" : info.thinking_level_label ?? info.thinking_level ?? "";
    if (changed || info.current === null) {
      const option = info.model_options?.find((m: any) => m.label === info.current || m.id === info.current || `${m.provider}/${m.id}` === info.current);
      const windowSize = typeof option?.context_window === "number" ? option.context_window : null;
      agentContext.value = { tokens: null, percent: null, contextWindow: windowSize ?? 0, ...(agentContext.value?.cacheUsage ? {cacheUsage: agentContext.value.cacheUsage} : {}) };
    }
    const ready = info.oobe?.provider_ready_completed_instance;
    if (ready !== undefined || info.current !== undefined) providerConfigured.value = ready !== undefined ? !!ready : !!info.current;
    providerUsage.value = info.provider_usage ?? null;
  };

  // Shared requests have transport-owned cancellation; consumers use versions.
  const statusVersion = useRef(0);
  const mounted = useRef(true);
  const isFetchingStatus = useRef(false);
  const statusRefresh = useRef<ReturnType<typeof setTimeout>>();
  const contextRefresh = useRef<ReturnType<typeof setTimeout>>();
  const activeChat = useRef(getChatJid());
  const resetChangedChat = () => {
    const chatJid = getChatJid();
    if (activeChat.current === chatJid) return;
    activeChat.current = chatJid;
    statusVersion.current++; contextVersion.current++;
    modelInfo.value = null; modelSelectionKnown.value = false;
    agentStatus.value = null; currentModel.value = null; currentThinkingLevel.value = '';
    providerUsage.value = null;
    agentContext.value = null;
    lastSuccessAt.value = 0; error.value = false;
    clearTimeout(statusRefresh.current); clearTimeout(contextRefresh.current);
  };

  useEffect(() => () => {
    mounted.current = false;
    statusVersion.current++;
    clearTimeout(statusRefresh.current);
    clearTimeout(contextRefresh.current);
  }, []);

  const fetchStatus = useCallback(async () => {
    resetChangedChat();
    if (isFetchingStatus.current) return;
    isFetchingStatus.current = true;
    // A shared request outlives individual consumers; versions reject stale results
    const myVersion = ++statusVersion.current;
    const contextRevision = contextVersion.current;
    const chatJid = getChatJid();
    try {
      const snapshot = await getAgentUiSnapshot(chatJid);
      if (statusVersion.current !== myVersion || chatJid !== getChatJid()) return;
      const statusData = snapshot.status as AgentStatus;
      agentStatus.value = statusData;
      addonHealthSignal.value = statusData.addon_api ?? null;
      error.value = snapshot.errors.includes("model") || snapshot.errors.includes("context");
      if (!error.value) lastSuccessAt.value = Date.now();
      if (snapshot.model) applyModel(snapshot.model);
      if (snapshot.context && contextRevision === contextVersion.current) {
        const data = snapshot.context as AgentContext;
        if (data.contextUpdate === 'replace' || data.tokens != null || data.cacheUsage?.latest || data.sessionGeneration) {
          const next = mergeVisualLiveContext(agentContext.value, data, { authoritative: true });
          if (JSON.stringify(next) !== JSON.stringify(agentContext.value)) {
            agentContext.value = next;
          }
        }
      }
      metricsError.value = snapshot.errors.includes("metrics");
      if (snapshot.metrics) systemMetrics.value = snapshot.metrics;
      updateAgentDisplayName(snapshot.agent_name);
      pollTick.value += 1;


    } catch (err) {
      if (statusVersion.current !== myVersion) return;
      if (err instanceof Error && err.name === "AbortError") return;
      log.warn("status fetch failed:", err);
      error.value = true;
      pollTick.value += 1;
    } finally {
      isFetchingStatus.current = false;
      // A model event during a pending body supersedes the local view; its
      // timeout may have joined this request. Apply the replacement immediately.
      if (mounted.current && statusVersion.current !== myVersion) void fetchStatus();
    }
  }, []);

  const fetchContext = fetchStatus;

  useEffect(() => {
    void fetchStatus();
    const interval = setInterval(() => {
      void fetchStatus();
    }, AGENT_UI_POLL_MS);
    return () => clearInterval(interval);
  }, [fetchStatus]);

  // Immediately refresh model/context when SSE connects (first load + reconnects)
  useEffect(() => {
    const onConnect = () => {
      statusVersion.current++; contextVersion.current++;
      agentStatus.value=null; agentContext.value=null;
      invalidateAgentUiSnapshot(getChatJid());
      void fetchStatus();
    };
    window.addEventListener("piclaw:sse-connected", onConnect);
    window.addEventListener('piclaw:current-chat-changed', onConnect);
    return () => {
      window.removeEventListener("piclaw:sse-connected", onConnect);
      window.removeEventListener('piclaw:current-chat-changed', onConnect);
    };
  }, [fetchStatus, fetchContext]);

  useEffect(() => {
    const onModelStateChanged = (event: Event) => {
      const detail = (event as CustomEvent<{ chatJid?: string; payload?: ModelInfo }>).detail;
      if (detail?.chatJid && detail.chatJid !== getChatJid()) return;
      resetChangedChat();
      const payload = detail?.payload;
      if (payload) applyModel(payload);
      invalidateAgentUiSnapshot(getChatJid());
      statusVersion.current += 1;
      clearTimeout(statusRefresh.current);
      statusRefresh.current = setTimeout(() => void fetchStatus(), 0);
    };
    window.addEventListener("piclaw:model-state-changed", onModelStateChanged);
    return () => window.removeEventListener("piclaw:model-state-changed", onModelStateChanged);
  }, [fetchStatus]);

  // Listen for agent_status events — extract context_usage from done events
  useEffect(() => {
    const onStatus = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail?.chat_jid && detail.chat_jid !== getChatJid()) return;
      resetChangedChat();
      // Extract context_usage from done event (pushed by backend after each turn)
      if (detail?.context_usage && (detail.context_usage.tokens != null || detail.context_usage.sessionGeneration)) {
        contextVersion.current++;
        const cu = detail.context_usage;
        agentContext.value = mergeVisualLiveContext(agentContext.value, cu);
      }
      // Always refresh context after a turn completes
      if (detail?.type === "done" || detail?.type === "error" || detail?.status === "idle") {
        clearTimeout(contextRefresh.current);
        contextRefresh.current = setTimeout(() => { void fetchContext(); }, 500);
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
    providerUsage,
    systemMetrics,
    metricsError,
    modelSelectionKnown,
    modelInfo,
    fetchStatus,
    fetchContext,
  };
}
