import { applyInstanceBranding, refreshInstanceBranding } from "../../../../../../src/ui/instance-branding";
import { updateAgentDisplayName } from "../../api/agent-identity";
import { applyThemeFromEvent } from '../../../../../../src/ui/theme';
import { useEffect, useRef } from "preact/hooks";
import type { Signal } from "@preact/signals";
import { buildChatUrl, getChatJid } from "../../api/chat-jid";
import { normalizePost } from "./helpers";
import type { Interaction } from "./types";

import { createLogger } from "../../utils/logger";
const log = createLogger("MessageList");

/** Exponential backoff config for SSE reconnection */
const SSE_RECONNECT_BASE_MS = 1000;
const SSE_RECONNECT_MAX_MS = 30000;
const SSE_RECONNECT_MAX_ATTEMPTS = 10;
const SSE_RECONNECT_COOLDOWN_MS = 60000;


interface UseTimelineStreamParams {
  setMessages: (fn: (prev: Interaction[]) => Interaction[]) => void;
  setConnected: (v: boolean) => void;
  scrollToBottom: (force?: boolean) => void;
  refetchTimelineOnReconnect: () => Promise<void>;
  timelineError: Signal<string | null>;
}

/**
 * Manages the SSE connection lifecycle:
 * - EventSource creation and cleanup
 * - Handles: new_post, agent_draft_delta, agent_draft, agent_response, agent_status,
 *   agent_thought_delta, agent_thought, extension_ui_request
 * - Reconnection logic (triggers refetchTimelineOnReconnect on re-open)
 * - Draft state updates
 * - Connection status dispatch
 * - Relays agent events to AgentStatusPanel via window.dispatchEvent:
 *   piclaw:agent-draft, piclaw:agent-thought, piclaw:agent-turn-end,
 *   piclaw:agent-request (for pending approval requests)
 */
export function useTimelineStream({
  setMessages,
  setConnected,
  scrollToBottom,
  refetchTimelineOnReconnect,
  timelineError,
}: UseTimelineStreamParams) {
  const hasHandledFirstOpenRef = useRef(false);

  // Reconnect state held in refs to avoid stale closures
  const esRef = useRef<EventSource | null>(null);
  const reconnectDelayRef = useRef(SSE_RECONNECT_BASE_MS);
  const reconnectAttemptsRef = useRef(0);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cooldownUntilRef = useRef(0);
  const destroyedRef = useRef(false);
  const draftDeltaActiveRef = useRef(false);
  const thoughtDeltaActiveRef = useRef(false);

  // Callback refs to avoid recreating EventSource when stable dependencies change
  const setMessagesRef = useRef(setMessages);
  const setConnectedRef = useRef(setConnected);
  const scrollToBottomRef = useRef(scrollToBottom);
  const refetchRef = useRef(refetchTimelineOnReconnect);
  const timelineErrorRef = useRef(timelineError);
  useEffect(() => { setMessagesRef.current = setMessages; }, [setMessages]);
  useEffect(() => { setConnectedRef.current = setConnected; }, [setConnected]);
  useEffect(() => { scrollToBottomRef.current = scrollToBottom; }, [scrollToBottom]);
  useEffect(() => { refetchRef.current = refetchTimelineOnReconnect; }, [refetchTimelineOnReconnect]);
  useEffect(() => { timelineErrorRef.current = timelineError; }, [timelineError]);

  useEffect(() => {
    destroyedRef.current = false;

    function scheduleReconnect() {
      if (destroyedRef.current) return;
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);

      const now = Date.now();
      if (reconnectAttemptsRef.current >= SSE_RECONNECT_MAX_ATTEMPTS) {
        cooldownUntilRef.current = Math.max(cooldownUntilRef.current, now + SSE_RECONNECT_COOLDOWN_MS);
        reconnectAttemptsRef.current = 0;
        log.warn("SSE max reconnect attempts reached; cooling down");
      }
      const cooldownDelay = Math.max(cooldownUntilRef.current - now, 0);
      const delay = Math.max(reconnectDelayRef.current, cooldownDelay);
      log.warn(`SSE reconnecting in ${delay}ms (attempt ${reconnectAttemptsRef.current})`);
      reconnectTimerRef.current = setTimeout(() => {
        if (!destroyedRef.current) connect();
      }, delay);
      reconnectDelayRef.current = Math.min(reconnectDelayRef.current * 2, SSE_RECONNECT_MAX_MS);
    }

    function connect() {
      if (destroyedRef.current) return;
      draftDeltaActiveRef.current = false;
      thoughtDeltaActiveRef.current = false;
      if (esRef.current) {
        esRef.current.close();
        esRef.current = null;
      }

    const es = new EventSource(buildChatUrl("/sse/stream"));
    esRef.current = es;
    es.addEventListener("profile_update", (event: MessageEvent) => {
      try { const payload = JSON.parse(event.data); if (payload.agent_id !== "default") return; applyInstanceBranding(payload); updateAgentDisplayName(payload.agent_name); }
      catch (error) { log.warn("Invalid profile event", error); }
    });

    es.addEventListener('ui_theme', (event: MessageEvent) => { try { applyThemeFromEvent(JSON.parse(event.data)); } catch (error) { log.warn('Invalid theme event', error); } });
    es.addEventListener("new_post", (e: MessageEvent) => {
      try {
        const raw = JSON.parse(e.data) as Record<string, unknown>;
        const interaction = normalizePost(raw);
        setMessagesRef.current((prev) => {
          // Avoid duplicates
          if (prev.some((m) => m.id === interaction.id)) return prev;
          return [...prev, interaction];
        });
        scrollToBottomRef.current();
      } catch (err) {
        log.warn("SSE parse error", err);
      }
    });

    es.addEventListener("agent_draft_delta", (e: MessageEvent) => {
      try {
        const parsed = JSON.parse(e.data);
        draftDeltaActiveRef.current = true;
        window.dispatchEvent(new CustomEvent("piclaw:agent-draft", { detail: { ...parsed, delta: parsed.delta, text: parsed.text, reset: parsed.reset } }));
        scrollToBottomRef.current();
      } catch (err) {
        log.warn("SSE parse error:", err);
      }
    });

    es.addEventListener("agent_draft", (e: MessageEvent) => {
      try {
        const parsed = JSON.parse(e.data);
        if (draftDeltaActiveRef.current) return;
        const text = parsed.text ?? parsed.content ?? "";
        window.dispatchEvent(new CustomEvent("piclaw:agent-draft", { detail: { ...parsed, text } }));
        scrollToBottomRef.current();
      } catch (err) {
        log.warn("SSE parse error:", err);
      }
    });

    es.addEventListener("agent_thought_delta", (e: MessageEvent) => {
      try {
        const parsed = JSON.parse(e.data);
        thoughtDeltaActiveRef.current = true;
        window.dispatchEvent(new CustomEvent("piclaw:agent-thought", { detail: { ...parsed, delta: parsed.delta, text: parsed.text, reset: parsed.reset } }));
      } catch (err) {
        log.warn("SSE thought parse error:", err);
      }
    });

    es.addEventListener("agent_thought", (e: MessageEvent) => {
      try {
        const parsed = JSON.parse(e.data);
        if (thoughtDeltaActiveRef.current) return;
        const text = parsed.text ?? parsed.content ?? "";
        window.dispatchEvent(new CustomEvent("piclaw:agent-thought", { detail: { ...parsed, text } }));
      } catch (err) {
        log.warn("SSE thought parse error:", err);
      }
    });

    es.addEventListener("agent_response", (e: MessageEvent) => {
      try {
        const raw = JSON.parse(e.data) as Record<string, unknown>;
        if (raw.chat_jid !== getChatJid()) return;
        const interaction = normalizePost({ ...raw, type: "agent" });
        setMessagesRef.current((prev) => {
          if (prev.some((m) => m.id === interaction.id)) return prev;
          return [...prev, interaction];
        });
        scrollToBottomRef.current();
        // Notify for browser notifications; native status owns completion.
        window.dispatchEvent(new CustomEvent("piclaw:new-message", { detail: { content: interaction.content, type: "agent" } }));
      } catch (err) {
        log.warn("SSE parse error:", err);
      }
    });

    es.addEventListener("extension_ui_widget", (e: MessageEvent) => {
      try {
        const data = JSON.parse(e.data);
        // Only relay status-panel surface widgets as extension panel events
        if (data?.options?.surface === "status-panel") {
          window.dispatchEvent(new CustomEvent("piclaw:extension-panel", { detail: data }));
        }
      } catch (err) {
        log.warn("SSE extension_ui_widget parse error:", err);
      }
    });

    es.addEventListener("extension_ui_request", (e: MessageEvent) => {
      try {
        const data = JSON.parse(e.data);
        // Relay approval/custom UI requests so AgentStatusPanel can show the modal
        window.dispatchEvent(new CustomEvent("piclaw:agent-request", { detail: data }));
      } catch (err) {
        log.warn("SSE extension_ui_request parse error:", err);
      }
    });

    es.addEventListener("model_changed", (e: MessageEvent) => {
      try {
        const payload = JSON.parse(e.data);
        window.dispatchEvent(new CustomEvent("piclaw:model-state-changed", {
          detail: { chatJid: payload.chat_jid, payload },
        }));
      } catch (err) {
        log.warn("SSE model change parse error:", err);
      }
    });

    es.addEventListener('picker_pins_changed', () => window.dispatchEvent(new Event('piclaw:picker-pins-changed')));
    es.addEventListener("agent_status", (e: MessageEvent) => {
      try {
        const data = JSON.parse(e.data);
        window.dispatchEvent(
          new CustomEvent("piclaw:agent-status", { detail: data })
        );
        if (["done", "error", "idle"].includes(data.type)) {
          window.dispatchEvent(new CustomEvent("piclaw:agent-turn-end", { detail: data }));
        }
      } catch (err) {
        log.warn("SSE parse error:", err);
      }
    });

    es.addEventListener("generated_widget_open", (e: MessageEvent) => {
      try {
        const data = JSON.parse(e.data);
        window.dispatchEvent(new CustomEvent("piclaw:widget-open", { detail: { ...data, source: 'live' } }));
      } catch (err) {
        log.warn("SSE widget parse error:", err);
      }
    });

    es.addEventListener("generated_widget_delta", (e: MessageEvent) => {
      try {
        const data = JSON.parse(e.data);
        window.dispatchEvent(new CustomEvent("piclaw:widget-delta", { detail: data }));
      } catch (err) {
        log.warn("SSE widget parse error:", err);
      }
    });

    es.addEventListener("generated_widget_final", (e: MessageEvent) => {
      try {
        const data = JSON.parse(e.data);
        window.dispatchEvent(new CustomEvent("piclaw:widget-final", { detail: data }));
      } catch (err) {
        log.warn("SSE widget parse error:", err);
      }
    });

    es.addEventListener("generated_widget_close", (e: MessageEvent) => {
      try {
        window.dispatchEvent(new CustomEvent("piclaw:widget-close", { detail: JSON.parse(e.data) }));
      } catch (err) {
        log.warn("SSE widget parse error:", err);
      }
    });

    es.addEventListener("generated_widget_error", (e: MessageEvent) => {
      try {
        window.dispatchEvent(new CustomEvent("piclaw:widget-error", { detail: JSON.parse(e.data) }));
      } catch (err) {
        log.warn("SSE widget parse error:", err);
      }
    });

    // Queue followup events
    es.addEventListener("agent_followup_queued", (e: MessageEvent) => {
      try {
        window.dispatchEvent(new CustomEvent("piclaw:followup-queued", { detail: JSON.parse(e.data) }));
      } catch {}
    });
    es.addEventListener("agent_followup_consumed", (e: MessageEvent) => {
      try {
        window.dispatchEvent(new CustomEvent("piclaw:followup-consumed", { detail: JSON.parse(e.data) }));
      } catch {}
    });
    es.addEventListener("agent_followup_removed", (e: MessageEvent) => {
      try {
        window.dispatchEvent(new CustomEvent("piclaw:followup-removed", { detail: JSON.parse(e.data) }));
      } catch {}
    });

    es.onopen = () => {
      void refreshInstanceBranding();
      // Reset backoff state on successful connection
      reconnectDelayRef.current = SSE_RECONNECT_BASE_MS;
      reconnectAttemptsRef.current = 0;
      cooldownUntilRef.current = 0;

      setConnectedRef.current(true);
      window.dispatchEvent(new Event("piclaw:sse-connected"));

      const isFirstOpen = !hasHandledFirstOpenRef.current;
      hasHandledFirstOpenRef.current = true;

      // Skip first open — initial fetch handles it
      if (isFirstOpen) return;

      // Reconnection — merge new messages
      refetchRef.current().catch((err) => {
        log.warn("reconnect refresh failed:", err);
        timelineErrorRef.current.value =
          "Timeline may be stale. Click to refresh.";
      });
    };

    es.onerror = () => {
      setConnectedRef.current(false);
      window.dispatchEvent(new Event("piclaw:sse-disconnected"));

      // If EventSource gave up (CLOSED state), schedule manual reconnect with backoff.
      // readyState CONNECTING (0) means the browser is still retrying natively — don't
      // double-schedule. readyState CLOSED (2) means it gave up (e.g. 4xx/5xx response).
      if (es.readyState === EventSource.CLOSED) {
        reconnectAttemptsRef.current += 1;
        scheduleReconnect();
      }
    };
    } // end connect()

    connect();

    return () => {
      destroyedRef.current = true;
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
      if (esRef.current) {
        esRef.current.close();
        esRef.current = null;
      }
    };
  }, []); // stable: all callbacks accessed via refs
}
