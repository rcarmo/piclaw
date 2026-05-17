import { useEffect, useRef } from "preact/hooks";
import type { Signal } from "@preact/signals";
import { buildChatUrl } from "../../api/chat-jid";
import { normalizePost } from "./helpers";
import type { Interaction } from "./types";

interface UseTimelineStreamParams {
  setMessages: (fn: (prev: Interaction[]) => Interaction[]) => void;
  setDraft: (v: string | ((prev: string) => string)) => void;
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
  setDraft,
  setConnected,
  scrollToBottom,
  refetchTimelineOnReconnect,
  timelineError,
}: UseTimelineStreamParams) {
  const hasHandledFirstOpenRef = useRef(false);

  useEffect(() => {
    const es = new EventSource(buildChatUrl("/sse/stream"));

    es.addEventListener("new_post", (e: MessageEvent) => {
      try {
        const raw = JSON.parse(e.data) as Record<string, unknown>;
        const interaction = normalizePost(raw);
        setMessages((prev) => {
          // Avoid duplicates
          if (prev.some((m) => m.id === interaction.id)) return prev;
          return [...prev, interaction];
        });
        // Clear draft when a new agent post arrives
        if (interaction.type === "agent") {
          setDraft("");
        }
        scrollToBottom(true);
      } catch (err) {
        console.warn("[MessageList] SSE parse error:", err);
      }
    });

    es.addEventListener("agent_draft_delta", (e: MessageEvent) => {
      try {
        const parsed = JSON.parse(e.data);
        if (parsed.delta) {
          setDraft((prev) => prev + parsed.delta);
        } else if (parsed.text !== undefined) {
          setDraft(parsed.text);
        }
        window.dispatchEvent(new CustomEvent("piclaw:agent-draft", { detail: { delta: parsed.delta, text: parsed.text } }));
        scrollToBottom();
      } catch (err) {
        console.warn("[MessageList] SSE parse error:", err);
      }
    });

    es.addEventListener("agent_draft", (e: MessageEvent) => {
      try {
        const parsed = JSON.parse(e.data);
        const text = parsed.text ?? parsed.content ?? "";
        setDraft(text);
        window.dispatchEvent(new CustomEvent("piclaw:agent-draft", { detail: { text } }));
        scrollToBottom();
      } catch (err) {
        console.warn("[MessageList] SSE parse error:", err);
      }
    });

    es.addEventListener("agent_thought_delta", (e: MessageEvent) => {
      try {
        const parsed = JSON.parse(e.data);
        window.dispatchEvent(new CustomEvent("piclaw:agent-thought", { detail: { delta: parsed.delta, text: parsed.text } }));
      } catch (err) {
        console.warn("[MessageList] SSE thought parse error:", err);
      }
    });

    es.addEventListener("agent_thought", (e: MessageEvent) => {
      try {
        const parsed = JSON.parse(e.data);
        const text = parsed.text ?? parsed.content ?? "";
        window.dispatchEvent(new CustomEvent("piclaw:agent-thought", { detail: { text } }));
      } catch (err) {
        console.warn("[MessageList] SSE thought parse error:", err);
      }
    });

    es.addEventListener("agent_response", (e: MessageEvent) => {
      try {
        const raw = JSON.parse(e.data) as Record<string, unknown>;
        const interaction = normalizePost({ ...raw, type: "agent" });
        setMessages((prev) => {
          if (prev.some((m) => m.id === interaction.id)) return prev;
          return [...prev, interaction];
        });
        setDraft("");
        scrollToBottom(true);
        // Notify for browser notifications
        window.dispatchEvent(new CustomEvent("piclaw:new-message", { detail: { content: interaction.content, type: "agent" } }));
        // Signal that agent turn is complete (clears compaction badge, etc.)
        window.dispatchEvent(new CustomEvent("piclaw:agent-turn-end"));
        window.dispatchEvent(
          new CustomEvent("piclaw:agent-status", { detail: { type: "done" } })
        );
      } catch (err) {
        console.warn("[MessageList] SSE parse error:", err);
        setDraft("");
        scrollToBottom(true);
        window.dispatchEvent(new CustomEvent("piclaw:agent-turn-end"));
        window.dispatchEvent(
          new CustomEvent("piclaw:agent-status", { detail: { type: "done" } })
        );
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
        console.warn("[MessageList] SSE extension_ui_widget parse error:", err);
      }
    });

    es.addEventListener("extension_ui_request", (e: MessageEvent) => {
      try {
        const data = JSON.parse(e.data);
        // Relay approval/custom UI requests so AgentStatusPanel can show the modal
        window.dispatchEvent(new CustomEvent("piclaw:agent-request", { detail: data }));
      } catch (err) {
        console.warn("[MessageList] SSE extension_ui_request parse error:", err);
      }
    });

    es.addEventListener("agent_status", (e: MessageEvent) => {
      try {
        const data = JSON.parse(e.data);
        window.dispatchEvent(
          new CustomEvent("piclaw:agent-status", { detail: data })
        );
      } catch (err) {
        console.warn("[MessageList] SSE parse error:", err);
      }
    });

    es.addEventListener("generated_widget_open", (e: MessageEvent) => {
      try {
        const data = JSON.parse(e.data);
        window.dispatchEvent(new CustomEvent("piclaw:widget-open", { detail: data }));
      } catch (err) {
        console.warn("[MessageList] SSE widget parse error:", err);
      }
    });

    es.addEventListener("generated_widget_delta", (e: MessageEvent) => {
      try {
        const data = JSON.parse(e.data);
        window.dispatchEvent(new CustomEvent("piclaw:widget-delta", { detail: data }));
      } catch (err) {
        console.warn("[MessageList] SSE widget parse error:", err);
      }
    });

    es.addEventListener("generated_widget_final", (e: MessageEvent) => {
      try {
        const data = JSON.parse(e.data);
        window.dispatchEvent(new CustomEvent("piclaw:widget-final", { detail: data }));
      } catch (err) {
        console.warn("[MessageList] SSE widget parse error:", err);
      }
    });

    es.addEventListener("generated_widget_close", (e: MessageEvent) => {
      try {
        window.dispatchEvent(new CustomEvent("piclaw:widget-close", { detail: JSON.parse(e.data) }));
      } catch (err) {
        console.warn("[MessageList] SSE widget parse error:", err);
      }
    });

    es.addEventListener("generated_widget_error", (e: MessageEvent) => {
      try {
        window.dispatchEvent(new CustomEvent("piclaw:widget-error", { detail: JSON.parse(e.data) }));
      } catch (err) {
        console.warn("[MessageList] SSE widget parse error:", err);
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
      setConnected(true);
      window.dispatchEvent(new Event("piclaw:sse-connected"));

      const isFirstOpen = !hasHandledFirstOpenRef.current;
      hasHandledFirstOpenRef.current = true;

      // Skip first open — initial fetch handles it
      if (isFirstOpen) return;

      // Reconnection — merge new messages
      refetchTimelineOnReconnect().catch((err) => {
        console.warn("[MessageList] reconnect refresh failed:", err);
        timelineError.value =
          "Timeline may be stale. Click to refresh.";
      });
    };

    es.onerror = () => {
      setConnected(false);
      window.dispatchEvent(new Event("piclaw:sse-disconnected"));
    };

    return () => {
      es.close();
    };
  }, [
    refetchTimelineOnReconnect,
    scrollToBottom,
    setConnected,
    setDraft,
    setMessages,
    timelineError,
  ]);
}
