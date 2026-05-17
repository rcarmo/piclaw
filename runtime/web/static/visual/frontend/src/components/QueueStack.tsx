/**
 * QueueStack.tsx — Shows queued followup messages between status panel and compose.
 * Each item can be steered (inject now), edited (return to compose), or cancelled.
 */
import { useEffect, useState, useCallback } from "preact/hooks";

export interface QueueItem {
  row_id: number;
  content: string;
  timestamp?: string;
}

interface QueueStackProps {
  onEdit: (item: QueueItem) => void;
}

export function QueueStack({ onEdit }: QueueStackProps) {
  const [items, setItems] = useState<QueueItem[]>([]);

  // Listen for SSE queue events
  useEffect(() => {
    const handleQueued = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (!detail?.row_id || !detail?.content) return;
      setItems((prev) => {
        if (prev.some((i) => i.row_id === detail.row_id)) return prev;
        return [...prev, { row_id: detail.row_id, content: detail.content, timestamp: detail.timestamp }];
      });
    };

    const handleConsumed = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (!detail?.row_id) return;
      setItems((prev) => prev.filter((i) => i.row_id !== detail.row_id));
    };

    const handleRemoved = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (!detail?.row_id) return;
      setItems((prev) => prev.filter((i) => i.row_id !== detail.row_id));
    };

    window.addEventListener("piclaw:followup-queued", handleQueued);
    window.addEventListener("piclaw:followup-consumed", handleConsumed);
    window.addEventListener("piclaw:followup-removed", handleRemoved);
    return () => {
      window.removeEventListener("piclaw:followup-queued", handleQueued);
      window.removeEventListener("piclaw:followup-consumed", handleConsumed);
      window.removeEventListener("piclaw:followup-removed", handleRemoved);
    };
  }, []);

  // Clear queue when agent turn ends
  useEffect(() => {
    const handler = () => setItems([]);
    window.addEventListener("piclaw:agent-turn-end", handler);
    return () => window.removeEventListener("piclaw:agent-turn-end", handler);
  }, []);

  const handleSteer = useCallback(async (item: QueueItem) => {
    try {
      const res = await fetch("/agent/queue-steer", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ row_id: item.row_id }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setItems((prev) => prev.filter((i) => i.row_id !== item.row_id));
      window.dispatchEvent(new CustomEvent("piclaw:status-flash", {
        detail: { message: "Steering injected", type: "success" },
      }));
    } catch {
      window.dispatchEvent(new CustomEvent("piclaw:status-flash", {
        detail: { message: "Steer failed", type: "error" },
      }));
    }
  }, []);

  const handleCancel = useCallback(async (item: QueueItem) => {
    setItems((prev) => prev.filter((i) => i.row_id !== item.row_id));
    try {
      await fetch("/agent/queue-remove", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ row_id: item.row_id }),
      });
    } catch {
      // Optimistic removal already done
    }
  }, []);

  const handleEdit = useCallback((item: QueueItem) => {
    onEdit(item);
    setItems((prev) => prev.filter((i) => i.row_id !== item.row_id));
  }, [onEdit]);

  const handleMove = useCallback((from: number, to: number) => {
    setItems((prev) => {
      const next = [...prev];
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      return next;
    });
  }, []);

  if (items.length === 0) return null;

  return (
    <div className="queue-stack">
      {items.map((item, index) => (
        <div key={item.row_id} className="queue-stack__item">
          <div className="queue-stack__content" title={item.content}>
            {item.content.length > 80 ? item.content.slice(0, 80) + "\u2026" : item.content}
          </div>
          <div className="queue-stack__actions">
            {items.length > 1 && (
              <>
                <button
                  type="button"
                  className="queue-stack__btn queue-stack__btn--move"
                  disabled={index === 0}
                  onClick={() => handleMove(index, index - 1)}
                  title="Move up"
                >
                  <i className="codicon codicon-chevron-up" />
                </button>
                <button
                  type="button"
                  className="queue-stack__btn queue-stack__btn--move"
                  disabled={index === items.length - 1}
                  onClick={() => handleMove(index, index + 1)}
                  title="Move down"
                >
                  <i className="codicon codicon-chevron-down" />
                </button>
              </>
            )}
            <button
              type="button"
              className="queue-stack__btn queue-stack__btn--edit"
              onClick={() => handleEdit(item)}
              title="Edit in compose"
            >
              <i className="codicon codicon-edit" />
            </button>
            <button
              type="button"
              className="queue-stack__btn queue-stack__btn--steer"
              onClick={() => handleSteer(item)}
              title="Inject as steering now"
            >
              ↵ Steer
            </button>
            <button
              type="button"
              className="queue-stack__btn queue-stack__btn--remove"
              onClick={() => handleCancel(item)}
              title="Remove from queue"
            >
              <i className="codicon codicon-close" />
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
