import { useRef, useCallback, useEffect } from "preact/hooks";
import { buildChatUrl } from "../../api/chat-jid";
import { copyToClipboard } from "../../utils/clipboard";
import { renderMermaidDiagrams } from "../../utils/mermaid-render";
import { normalizePost } from "./helpers";
import type { Interaction } from "./types";

/**
 * Manages scroll state and scroll-related behaviours:
 * - Creates and returns listRef (attach to the list container)
 * - scrollToBottom (respects user-scroll state)
 * - userScrolledRef tracking via scroll-event listener
 * - Scroll-to-message / jump-to-message (search navigation)
 *
 * @param onReplaceMessages - stable callback to replace the message list
 *   (used by jump-to-message to load messages around a target ID).
 *   May be a no-op initially; populated after useTimelineFetch is called.
 */
export function useScrollManager(
  onReplaceMessages: (posts: Interaction[]) => void
) {
  const listRef = useRef<HTMLDivElement>(null);
  const userScrolledRef = useRef(false);

  const scrollToBottom = useCallback((force = false) => {
    if (force || !userScrolledRef.current) {
      const doScroll = () => {
        const el = listRef.current;
        // column-reverse: scrollTop 0 = visual bottom
        if (el) el.scrollTop = 0;
      };
      doScroll();
      // Double-tap: ensure scroll after Preact render cycle
      requestAnimationFrame(doScroll);
    }
  }, []);

  // Detect manual scroll
  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    const handleScroll = () => {
      // column-reverse: scrollTop 0 = visual bottom, scrolling up goes negative
      const atBottom = Math.abs(el.scrollTop) < 60;
      userScrolledRef.current = !atBottom;
    };
    el.addEventListener("scroll", handleScroll, { passive: true });
    return () => el.removeEventListener("scroll", handleScroll);
  }, []);

  // Scroll to a specific message (triggered from search panel via piclaw:scroll-to-message)
  useEffect(() => {
    let lastHighlighted: HTMLElement | null = null;
    const highlight = (el: HTMLElement) => {
      if (lastHighlighted) {
        lastHighlighted.classList.remove("message--highlighted");
      }
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      el.classList.add("message--highlighted");
      lastHighlighted = el;
    };

    const handler = async (e: Event) => {
      const id = (e as CustomEvent).detail?.id;
      if (!id || !listRef.current) return;

      // Try to find in DOM first
      let el = listRef.current.querySelector(
        `[data-message-id="${id}"]`
      ) as HTMLElement;
      if (el) {
        highlight(el);
        return;
      }

      // Not in DOM — load messages around this ID
      try {
        // Backend supports 'before' (loads messages with rowid < value)
        // To get messages around target, use before = id + 26 (gets 50 msgs before that point)
        const beforeId = Number(id) + 26;
        const res = await fetch(
          buildChatUrl("/timeline", {
            before: String(beforeId),
            limit: "50",
          }),
          { credentials: "include" }
        );
        if (res.ok) {
          const data = (await res.json()) as {
            posts?: Array<Record<string, unknown>>;
          };
          const posts = (data.posts ?? []).map(normalizePost);
          if (posts.length) {
            onReplaceMessages(posts);
            // Wait for render, then scroll
            setTimeout(() => {
              el = listRef.current?.querySelector(
                `[data-message-id="${id}"]`
              ) as HTMLElement;
              if (el) highlight(el);
            }, 100);
          }
        }
      } catch (err) {
        console.warn("[MessageList] jump-to-message failed:", err);
        window.dispatchEvent(
          new CustomEvent("piclaw:status-flash", {
            detail: { message: "Failed to load message", type: "error" },
          })
        );
      }
    };

    window.addEventListener("piclaw:scroll-to-message", handler);
    return () => window.removeEventListener("piclaw:scroll-to-message", handler);
  }, [onReplaceMessages]);

  // Copy button delegated handler
  useEffect(() => {
    const container = listRef.current;
    if (!container) return;
    const handler = async (e: MouseEvent) => {
      const btn = (e.target as HTMLElement).closest(
        ".code-block__copy"
      ) as HTMLElement;
      if (!btn) return;
      const encoded = btn.dataset.code;
      if (!encoded) return;
      const code = decodeURIComponent(escape(atob(encoded)));
      const ok = await copyToClipboard(code);
      if (ok) {
        btn.dataset.copyState = "copied";
        setTimeout(() => { btn.dataset.copyState = ""; }, 2000);
      }
    };
    container.addEventListener("click", handler as unknown as EventListener);
    return () =>
      container.removeEventListener("click", handler as unknown as EventListener);
  }, []);

  // Post-render: mermaid diagrams
  useEffect(() => {
    const container = listRef.current;
    if (!container) return;
    const render = () => {
      if (container.querySelector(".mermaid-container[data-mermaid]")) {
        renderMermaidDiagrams(container).catch((err) => {
          console.warn("[MessageList] mermaid render failed:", err);
        });
      }
    };
    render();
    let debounceTimer = 0;
    const observer = new MutationObserver(() => {
      clearTimeout(debounceTimer);
      debounceTimer = window.setTimeout(render, 100);
    });
    observer.observe(container, { childList: true, subtree: true });
    return () => {
      observer.disconnect();
      clearTimeout(debounceTimer);
    };
  }, []);

  return { listRef, scrollToBottom, userScrolledRef };
}
