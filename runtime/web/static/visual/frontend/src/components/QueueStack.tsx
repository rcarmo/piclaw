/**
 * QueueStack.tsx — Shows queued followup messages between status panel and compose.
 * Each item can be steered (inject now), edited (return to compose), or cancelled.
 */
import { useEffect, useState, useRef } from "preact/hooks";
import { buildChatUrl, getChatJid } from '../api/chat-jid';
import { createQueueStateController } from './queue-state-controller';

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
  const [chatJid] = useState(() => getChatJid());
  const [actionPending, setActionPending] = useState(false);
  const controller = useRef<ReturnType<typeof createQueueStateController> | null>(null);

  // Listen for SSE queue events
  useEffect(() => {
    const current = createQueueStateController({
      chatJid, isCurrent: () => getChatJid() === chatJid, publish: setItems,
      request: async signal => {
        const response = await fetch(buildChatUrl('/agent/queue-state', { chat_jid: chatJid }), { credentials: 'same-origin', cache: 'no-store', signal: AbortSignal.any([signal, AbortSignal.timeout(15000)]) });
        if (!response.ok) throw Error('Queue unavailable');
        return response.json();
      },
      onError: () => window.dispatchEvent(new CustomEvent('piclaw:status-flash', { detail: { message: 'Queue could not be refreshed. Reconnect or try again.', type: 'error' } })),
    });
    controller.current = current;
    const handleQueued = (e: Event) => {
      current.queued((e as CustomEvent).detail);
    };

    const handleConsumed = (e: Event) => {
      current.removed((e as CustomEvent).detail);
    };

    const handleRemoved = (e: Event) => {
      current.removed((e as CustomEvent).detail);
    };
    const refresh = () => { void current.refresh(); };
    const acknowledged = (event: Event) => { if ((event as CustomEvent).detail?.chat_jid === chatJid) refresh(); };

    window.addEventListener("piclaw:followup-queued", handleQueued);
    window.addEventListener("piclaw:followup-consumed", handleConsumed);
    window.addEventListener("piclaw:followup-removed", handleRemoved);
    window.addEventListener('piclaw:queue-acknowledged', acknowledged);
    window.addEventListener('piclaw:sse-connected', refresh);
    window.addEventListener('piclaw:agent-turn-end', refresh);
    void current.refresh();
    return () => {
      current.stop();
      if (controller.current === current) controller.current = null;
      window.removeEventListener("piclaw:followup-queued", handleQueued);
      window.removeEventListener("piclaw:followup-consumed", handleConsumed);
      window.removeEventListener("piclaw:followup-removed", handleRemoved);
      window.removeEventListener('piclaw:queue-acknowledged', acknowledged);
      window.removeEventListener('piclaw:sse-connected', refresh);
      window.removeEventListener('piclaw:agent-turn-end', refresh);
    };
  }, [chatJid]);

  const action = async (path: string, body: unknown, removeRowId?: number) => {
    const current = controller.current;
    if (!current || actionPending || getChatJid() !== chatJid) return false;
    setActionPending(true);
    try {
      return await current.mutate(async () => {
        const res = await fetch(buildChatUrl(path, { chat_jid: chatJid }), {
          method: "POST",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...(body as Record<string, unknown>), chat_jid: chatJid }),
          signal: AbortSignal.timeout(15000),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        if (path === '/agent/queue-remove' || path === '/agent/queue-reorder' || path === '/agent/queue-steer') {
          const result = await res.json();
          if (path.endsWith('remove') ? result?.removed !== true : path.endsWith('steer') ? result?.queued !== 'steer' : result?.reordered !== true) throw Error('Queue changed before the action');
        }
      }, removeRowId);
    } catch {
      if (getChatJid() === chatJid && controller.current === current) window.dispatchEvent(new CustomEvent('piclaw:status-flash', { detail: { message: 'Queue action failed. Refresh to check the saved state.', type: 'error' } }));
      return false;
    } finally { if (controller.current === current) setActionPending(false); }
  };

  const handleSteer = async (item: QueueItem) => {
    if (await action('/agent/queue-steer', { row_id: item.row_id })) {
      window.dispatchEvent(new CustomEvent("piclaw:status-flash", {
        detail: { message: "Steering queued", type: "success" },
      }));
    }
  };

  const handleCancel = (item: QueueItem) => action('/agent/queue-remove', { row_id: item.row_id }, item.row_id);

  const handleEdit = async (item: QueueItem) => {
    if (await action('/agent/queue-remove', { row_id: item.row_id }, item.row_id)) onEdit(item);
  };

  const handleMove = (from: number, to: number) => action('/agent/queue-reorder', { from_index: from, to_index: to });

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
                  disabled={actionPending || index === 0}
                  onClick={() => handleMove(index, index - 1)}
                  title="Move up"
                >
                  <i className="codicon codicon-chevron-up" />
                </button>
                <button
                  type="button"
                  className="queue-stack__btn queue-stack__btn--move"
                  disabled={actionPending || index === items.length - 1}
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
              disabled={actionPending}
              onClick={() => handleEdit(item)}
              title="Edit in compose"
            >
              <i className="codicon codicon-edit" />
            </button>
            <button
              type="button"
              className="queue-stack__btn queue-stack__btn--steer"
              disabled={actionPending}
              onClick={() => handleSteer(item)}
              title="Inject as steering now"
            >
              ↵ Steer
            </button>
            <button
              type="button"
              className="queue-stack__btn queue-stack__btn--remove"
              disabled={actionPending}
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
