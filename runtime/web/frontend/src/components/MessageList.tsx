import { useSignal } from "@preact/signals";
import { useCallback, useEffect, useRef, useState } from "preact/hooks";
import { useScrollManager } from "./message-list/useScrollManager";
import { useTimelineFetch } from "./message-list/useTimelineFetch";
import { useTimelineStream } from "./message-list/useTimelineStream";
import { MessageItem } from "./message-list/MessageItem";
import { useCollapsedMessages } from "./message-list/useCollapsedMessages";
import type { Interaction } from "./message-list/types";

export function MessageList() {
  const [connected, setConnected] = useState<boolean | null>(null);
  const [draft, setDraft] = useState<string>("");
  const timelineError = useSignal<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  // Stable ref used to forward setMessages into useScrollManager without
  // a circular dependency (setMessages comes from useTimelineFetch which
  // needs scrollToBottom from useScrollManager).
  const replaceMessagesRef = useRef<((posts: Interaction[]) => void) | null>(null);
  const onReplaceMessages = useCallback((posts: Interaction[]) => {
    replaceMessagesRef.current?.(posts);
  }, []);

  const { listRef, scrollToBottom, userScrolledRef } = useScrollManager(onReplaceMessages);

  const { isCollapsed, toggle: toggleCollapse } = useCollapsedMessages();

  const handleDeleteMessage = async (id: number) => {
    try {
      const res = await fetch(`/post/${id}`, { method: "DELETE", credentials: "same-origin" });
      if (res.ok) {
        setMessages((prev) => prev.filter((m) => m.id !== id));
      } else {
        window.dispatchEvent(new CustomEvent("piclaw:status-flash", { detail: { message: "Failed to delete message", type: "error" } }));
      }
    } catch {
      window.dispatchEvent(new CustomEvent("piclaw:status-flash", { detail: { message: "Failed to delete message", type: "error" } }));
    }
  };

  const {
    messages,
    setMessages,
    hasMore,
    loadingMore,
    fetchTimeline,
    loadMore,
    refetchTimelineOnReconnect,
  } = useTimelineFetch({ setConnected, scrollToBottom, timelineError, listRef });

  // Keep replaceMessagesRef in sync (setMessages is a stable setState setter)
  replaceMessagesRef.current = (posts: Interaction[]) => setMessages(() => posts);

  useTimelineStream({
    setMessages,
    setDraft,
    setConnected,
    scrollToBottom,
    refetchTimelineOnReconnect,
    timelineError,
  });

  // Listen for optimistic user messages from compose box
  useEffect(() => {
    const handler = (e: Event) => {
      const msg = (e as CustomEvent).detail;
      if (!msg?.id) return;
      setMessages((prev) => {
        if (prev.some((m) => m.id === msg.id)) return prev;
        return [
          ...prev,
          {
            id: msg.id,
            type: "user",
            content: msg.data?.content ?? "",
            created_at: msg.timestamp,
            data: msg.data,
          },
        ];
      });
      userScrolledRef.current = false;
      scrollToBottom(true);
    };
    window.addEventListener("piclaw:new-message", handler);
    return () => window.removeEventListener("piclaw:new-message", handler);
  }, [scrollToBottom, setMessages, userScrolledRef]);

  if (connected === false) {
    return (
      <div className="message-list message-list--disconnected">
        <div className="message-list__status-banner">
          ⚠️ Not connected — unable to load messages
        </div>
      </div>
    );
  }

  return (
    <div className="message-list" ref={listRef}>
      {timelineError.value && (
        <div
          className="message-list__error-banner"
          onClick={() => {
            timelineError.value = null;
            void fetchTimeline().then(() => {
              timelineError.value = null;
              scrollToBottom(true);
            });
          }}
        >
          ⚠ {timelineError.value}
        </div>
      )}

      {messages.length === 0 && connected === true && (
        <div className="message-list__empty">
          <p>No messages yet. Say hello! 👋</p>
        </div>
      )}

      {[...messages].reverse().filter((msg) => {
        const c = msg.content ?? "";
        // Hide wizard-generated login/logout messages and their card responses
        if (c.startsWith("/login __step") || c.startsWith("/logout ")) return false;
        if (msg.content_blocks?.some((b: Record<string, unknown>) => {
          const cardId = b.card_id as string ?? "";
          return cardId.startsWith("login-");
        })) return false;
        return true;
      }).map((msg) => (
        <MessageItem
          key={msg.id}
          interaction={msg}
          isCollapsed={isCollapsed(msg.id)}
          onToggleCollapse={() => toggleCollapse(msg.id)}
          onDelete={() => handleDeleteMessage(msg.id)}
        />
      ))}

      {hasMore && (
        <div className="message-list__load-more">
          <button
            type="button"
            className="message-list__load-more-btn"
            onClick={loadMore}
            disabled={loadingMore}
          >
            {loadingMore ? "Loading…" : "Load older messages"}
          </button>
        </div>
      )}
    </div>
  );
}
