import { useEffect } from "preact/hooks";
import { useSignal } from "@preact/signals";
import { getChatJid } from "../../api/chat-jid";
import { ModalDialog } from "../../components/ModalDialog";
import { registerSettingsPane } from "./pane-registry";

interface Recording {
  id: string;
  date?: string;
  startedAt?: string;
  duration?: number;
  eventCount?: number;
  eventKinds?: string[];
  active?: boolean;
}

function formatDate(dateStr?: string): string {
  if (!dateStr) return "Unknown date";
  try {
    return new Date(dateStr).toLocaleString();
  } catch {
    return dateStr;
  }
}

function formatDuration(seconds?: number): string {
  if (seconds == null) return "";
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

export function RecordingsSection() {
  const recordings = useSignal<Recording[]>([]);
  const selectedId = useSignal<string | null>(null);
  const isRecording = useSignal(false);
  const loading = useSignal(true);
  const error = useSignal<string | null>(null);
  const actionStatus = useSignal<string | null>(null);

  async function fetchRecordings() {
    try {
      const res = await fetch("/agent/recordings", { credentials: "same-origin" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const completed: Recording[] = Array.isArray(data) ? data : (data.recordings ?? []);
      const active: Recording[] = (data.active ?? []).map((r: Recording) => ({ ...r, active: true }));
      recordings.value = [...active, ...completed];
      isRecording.value = active.length > 0;
    } catch (err: unknown) {
      error.value = `Failed to load recordings: ${err instanceof Error ? err.message : String(err)}`;
    } finally {
      loading.value = false;
    }
  }

  useEffect(() => {
    void fetchRecordings();
  }, []);

  function showStatus(msg: string, durationMs = 2500) {
    actionStatus.value = msg;
    setTimeout(() => (actionStatus.value = null), durationMs);
  }

  async function handleStartStop() {
    const chatJid = getChatJid();
    const wasRecording = isRecording.value;
    const endpoint = wasRecording ? "/agent/recordings/stop" : "/agent/recordings/start";
    const activeRec = wasRecording ? recordings.value.find((r) => r.active) : null;
    try {
      const body = wasRecording
        ? { chat_jid: chatJid, ...(activeRec?.id ? { id: activeRec.id } : {}) }
        : { chat_jid: chatJid, title: `Recording ${new Date().toISOString().slice(0, 16)}` };
      const res = await fetch(endpoint, {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error((errData as Record<string,string>).error || `HTTP ${res.status}`);
      }
      showStatus(wasRecording ? "Recording stopped" : "Recording started");
      await fetchRecordings();
    } catch (err: unknown) {
      showStatus(`Error: ${err instanceof Error ? err.message : String(err)}`, 4000);
    }
  }

  function handleExport(id: string) {
    const url = `/agent/recordings/${encodeURIComponent(id)}/export?format=json`;
    window.open(url, "_blank");
  }

  function handlePlayback(id: string) {
    const url = `/recordings/playback?id=${encodeURIComponent(id)}`;
    window.open(url, "_blank");
  }

  const confirmDeleteId = useSignal<string | null>(null);

  async function doDelete(id: string) {
    try {
      const res = await fetch(`/agent/recordings/${encodeURIComponent(id)}`, {
        method: "DELETE",
        credentials: "same-origin",
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      if (selectedId.value === id) selectedId.value = null;
      showStatus("Recording deleted");
      await fetchRecordings();
    } catch (err: unknown) {
      showStatus(`Delete failed: ${err instanceof Error ? err.message : String(err)}`, 4000);
    }
  }

  if (loading.value) {
    return (
      <section className="settings-panel__section">
        <h2 className="settings-panel__section-title">Recordings</h2>
        <div className="settings-panel__description">Loading recordings…</div>
      </section>
    );
  }

  return (
    <section className="settings-panel__section">
      <h2 className="settings-panel__section-title">Recordings</h2>

      {error.value && (
        <div className="settings-panel__error recordings-section__error">{error.value}</div>
      )}
      {actionStatus.value && (
        <div className="recordings-section__status">{actionStatus.value}</div>
      )}

      <div className="recordings-section__controls">
        <button
          className={`recordings-section__btn recordings-section__btn--record${isRecording.value ? " active" : ""}`}
          onClick={handleStartStop}
        >
          {isRecording.value ? "⏹ Stop Recording" : "⏺ Start Recording"}
        </button>
      </div>

      {recordings.value.length === 0 ? (
        <div className="recordings-section__empty">No recordings yet</div>
      ) : (
        <ul className="recordings-section__list">
          {recordings.value.map((rec) => {
            const isSelected = selectedId.value === rec.id;
            const dateStr = formatDate(rec.date ?? rec.startedAt);
            return (
              <li
                key={rec.id}
                className={`recordings-section__item${isSelected ? " recordings-section__item--active" : ""}${rec.active ? " recordings-section__item--recording" : ""}`}
                onClick={() => (selectedId.value = isSelected ? null : rec.id)}
              >
                <div className="recordings-section__item-title">
                  {rec.active && <span className="recordings-section__badge">● REC</span>}
                  {dateStr}
                </div>
                <div className="recordings-section__meta">
                  {rec.duration != null && <span>{formatDuration(rec.duration)}</span>}
                  {rec.eventCount != null && <span> · {rec.eventCount} events</span>}
                  {rec.eventKinds && rec.eventKinds.length > 0 && (
                    <span> · {rec.eventKinds.join(", ")}</span>
                  )}
                </div>

                {isSelected && (
                  <div className="recordings-section__actions">
                    <button
                      className="recordings-section__btn"
                      onClick={(e) => { e.stopPropagation(); handlePlayback(rec.id); }}
                    >
                      ▶ Playback
                    </button>
                    <button
                      className="recordings-section__btn"
                      onClick={(e) => { e.stopPropagation(); handleExport(rec.id); }}
                    >
                      ↓ Export
                    </button>
                    <button
                      className="recordings-section__btn recordings-section__btn--danger"
                      onClick={(e) => { e.stopPropagation(); confirmDeleteId.value = rec.id; }}
                    >
                      Delete
                    </button>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {confirmDeleteId.value && (
        <ModalDialog
          mode="confirm"
          title="Delete recording"
          message="Delete this recording? This cannot be undone."
          confirmLabel="Delete"
          cancelLabel="Cancel"
          onConfirm={() => { const id = confirmDeleteId.value!; confirmDeleteId.value = null; void doDelete(id); }}
          onCancel={() => { confirmDeleteId.value = null; }}
        />
      )}
    </section>
  );
}

registerSettingsPane({
  id: "recordings",
  label: "Recordings",
  icon: <i className="codicon codicon-record" />,
  order: 15,
  component: () => <RecordingsSection />,
});
