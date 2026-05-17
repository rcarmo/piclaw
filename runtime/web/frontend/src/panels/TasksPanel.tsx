import { useState, useEffect, useCallback } from "preact/hooks";
import { getChatJid } from "../api/chat-jid";
import {
  chatName,
  extractChatJidFromAction,
  loadMergedSessions,
  sanitizeSessionName,
  type SessionEntry,
} from "../utils/session";
import { useDialog } from "../hooks/useDialog";

// ─── Types ────────────────────────────────────────────────────────────────────

interface SessionsTabProps {
  activeChatJid: string;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

// ─── Tasks Tab ────────────────────────────────────────────────────────────────


// ─── Task Types ───────────────────────────────────────────────────────────────

interface RunLog {
  run_at: string;
  duration_ms: number;
  status: string;
  result?: string | null;
  error?: string | null;
}

interface ScheduledTask {
  id: string;
  task_kind: "agent" | "shell";
  schedule_type: "cron" | "interval" | "once";
  schedule_value: string;
  status: "active" | "paused" | "completed";
  prompt?: string | null;
  prompt_summary?: string | null;
  command?: string | null;
  command_summary?: string | null;
  summary?: string;
  model?: string | null;
  chat_jid?: string;
  cwd?: string | null;
  timeout_sec?: number | null;
  created_at?: string;
  next_run?: string | null;
  last_run?: string | null;
  last_result?: string | null;
  latest_run_log?: RunLog | null;
  recent_run_logs?: RunLog[];
}

interface TaskCounts {
  active: number;
  paused: number;
  completed: number;
}

type StatusFilter = "all" | "active" | "paused" | "completed";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function relativeTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const diff = Date.now() - new Date(iso).getTime();
  if (diff < 0) {
    const future = -diff;
    if (future < 60000) return `in ${Math.round(future / 1000)}s`;
    if (future < 3600000) return `in ${Math.round(future / 60000)}m`;
    if (future < 86400000) return `in ${Math.round(future / 3600000)}h`;
    return `in ${Math.round(future / 86400000)}d`;
  }
  if (diff < 60000) return `${Math.round(diff / 1000)}s ago`;
  if (diff < 3600000) return `${Math.round(diff / 60000)}m ago`;
  if (diff < 86400000) return `${Math.round(diff / 3600000)}h ago`;
  return `${Math.round(diff / 86400000)}d ago`;
}

function cronHuman(expr: string): string {
  const parts = expr.split(/\s+/);
  if (parts.length !== 5) return expr;
  const [min, hour, dom, mon, dow] = parts;
  if (dom === "*" && mon === "*" && dow === "*") {
    if (hour === "*" && min === "*") return "Every minute";
    if (hour === "*") return `Every hour at :${min.padStart(2, "0")}`;
    return `Daily at ${hour.padStart(2, "0")}:${min.padStart(2, "0")}`;
  }
  if (dow !== "*" && dom === "*" && mon === "*") return `Weekly (${dow}) at ${hour}:${min.padStart(2, "0")}`;
  return expr;
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60000).toFixed(1)}m`;
}

// ─── Tasks Tab ────────────────────────────────────────────────────────────────

function TasksTab() {
  const [tasks, setTasks] = useState<ScheduledTask[]>([]);
  const [counts, setCounts] = useState<TaskCounts>({ active: 0, paused: 0, completed: 0 });
  const [status, setStatus] = useState<"loading" | "done" | "error">("loading");
  const [filter, setFilter] = useState<StatusFilter>("all");
  const [actionBusy, setActionBusy] = useState<string | null>(null);
  const [expandedLogs, setExpandedLogs] = useState<Set<string>>(new Set());

  const fetchTasks = useCallback(async () => {
    try {
      const params = new URLSearchParams({ include_run_logs: "true", run_log_limit: "5", limit: "50" });
      if (filter !== "all") params.set("status", filter);
      const res = await fetch(`/agent/scheduled-tasks?${params}`, { credentials: "same-origin" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setTasks(data.tasks ?? []);
      if (data.counts) setCounts(data.counts);
      setStatus("done");
    } catch {
      setStatus("error");
    }
  }, [filter]);

  useEffect(() => { fetchTasks(); }, [fetchTasks]);

  const handleAction = async (id: string, action: "pause" | "resume" | "delete") => {
    setActionBusy(id);
    try {
      const res = await fetch("/agent/scheduled-tasks/action", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, id, allow_internal: true }),
      });
      if (!res.ok) console.warn("[tasks] action failed:", res.status);
      await fetchTasks();
    } finally {
      setActionBusy(null);
    }
  };

  const toggleLogs = (id: string) => {
    setExpandedLogs((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  if (status === "loading") return <div className="tasks-panel__empty">Loading tasks…</div>;
  if (status === "error") return <div className="tasks-panel__empty tasks-panel__empty--error">Failed to load tasks. <button onClick={fetchTasks}>Retry</button></div>;

  const total = counts.active + counts.paused + counts.completed;

  return (
    <div className="tasks-panel__tasks">
      {/* Status filter tabs */}
      <div className="tasks-panel__filter-tabs">
        {(["all", "active", "paused", "completed"] as StatusFilter[]).map((f) => {
          const count = f === "all" ? total : counts[f];
          return (
            <button
              key={f}
              className={`tasks-panel__filter-tab${filter === f ? " tasks-panel__filter-tab--active" : ""}`}
              onClick={() => setFilter(f)}
            >
              {f.charAt(0).toUpperCase() + f.slice(1)} ({count})
            </button>
          );
        })}
      </div>

      {tasks.length === 0 ? (
        <div className="tasks-panel__empty">No {filter !== "all" ? filter : ""} tasks</div>
      ) : (
        <div className="tasks-panel__list">
          {tasks.map((task) => (
            <div key={task.id} className="tasks-panel__card">
              {/* Header */}
              <div className="tasks-panel__card-header">
                <span className="tasks-panel__card-id">{task.id}</span>
                <span className={`tasks-panel__badge tasks-panel__badge--${task.status}`}>{task.status}</span>
                <span className="tasks-panel__badge tasks-panel__badge--kind">{task.task_kind}</span>
              </div>

              {/* Schedule */}
              <div className="tasks-panel__card-row">
                <span className="tasks-panel__card-label">Schedule:</span>
                <span className="tasks-panel__card-value">
                  {task.schedule_type === "cron" ? cronHuman(task.schedule_value) : `${task.schedule_type}: ${task.schedule_value}`}
                  <span className="tasks-panel__card-muted"> ({task.schedule_value})</span>
                </span>
              </div>

              {/* Model */}
              {task.model && (
                <div className="tasks-panel__card-row">
                  <span className="tasks-panel__card-label">Model:</span>
                  <span className="tasks-panel__card-value">{task.model}</span>
                </div>
              )}

              {/* Prompt / Command */}
              {(task.prompt_summary || task.prompt) && (
                <div className="tasks-panel__card-row">
                  <span className="tasks-panel__card-label">Prompt:</span>
                  <span className="tasks-panel__card-value tasks-panel__card-mono">{task.prompt_summary || task.prompt}</span>
                </div>
              )}
              {(task.command_summary || task.command) && (
                <div className="tasks-panel__card-row">
                  <span className="tasks-panel__card-label">Command:</span>
                  <span className="tasks-panel__card-value tasks-panel__card-mono">{task.command_summary || task.command}</span>
                </div>
              )}

              {/* Next / Last run */}
              <div className="tasks-panel__card-row">
                <span className="tasks-panel__card-label">Next:</span>
                <span className="tasks-panel__card-value">{relativeTime(task.next_run)}</span>
                <span className="tasks-panel__card-label" style={{ marginLeft: "12px" }}>Last:</span>
                <span className="tasks-panel__card-value">{relativeTime(task.last_run)}</span>
              </div>

              {/* Last result */}
              {task.last_result && (
                <div className="tasks-panel__card-row">
                  <span className="tasks-panel__card-label">Result:</span>
                  <span className="tasks-panel__card-value tasks-panel__card-mono">{task.last_result.slice(0, 120)}</span>
                </div>
              )}

              {/* Run logs (expandable) */}
              {task.recent_run_logs && task.recent_run_logs.length > 0 && (
                <div className="tasks-panel__card-logs">
                  <button className="tasks-panel__logs-toggle" onClick={() => toggleLogs(task.id)}>
                    {expandedLogs.has(task.id) ? "▾" : "▸"} Run history ({task.recent_run_logs.length})
                  </button>
                  {expandedLogs.has(task.id) && (
                    <div className="tasks-panel__logs-list">
                      {task.recent_run_logs.map((log, i) => (
                        <div key={i} className={`tasks-panel__log-entry tasks-panel__log-entry--${log.status}`}>
                          <span>{relativeTime(log.run_at)}</span>
                          <span>{formatDuration(log.duration_ms)}</span>
                          <span className="tasks-panel__log-status">{log.status}</span>
                          {log.error && <span className="tasks-panel__log-error">{log.error.slice(0, 80)}</span>}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* Actions */}
              <div className="tasks-panel__card-actions">
                {task.status === "active" && (
                  <button disabled={actionBusy === task.id} onClick={() => handleAction(task.id, "pause")} title="Pause">⏸ Pause</button>
                )}
                {task.status === "paused" && (
                  <button disabled={actionBusy === task.id} onClick={() => handleAction(task.id, "resume")} title="Resume">▶ Resume</button>
                )}
                <button disabled={actionBusy === task.id} onClick={() => handleAction(task.id, "delete")} title="Delete">🗑 Delete</button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}


function SessionsTab({ activeChatJid }: SessionsTabProps) {
  const [allSessions, setAllSessions] = useState<SessionEntry[]>([]);
  const [selectedJid, setSelectedJid] = useState<string | null>(null);
  const [status, setStatus] = useState<"loading" | "done" | "error">("loading");
  const [errorMsg, setErrorMsg] = useState<string>("");
  const [actionBusy, setActionBusy] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const { showPrompt, showConfirm } = useDialog();

  const navigateToChat = (chatJid: string) => {
    window.location.href = `/?chat_jid=${encodeURIComponent(chatJid)}`;
  };

  const loadData = useCallback(async () => {
    setStatus("loading");
    setErrorMsg("");
    try {
      const { sessions, unauthorized } = await loadMergedSessions(activeChatJid, { includeArchived: true });
      if (unauthorized) {
        setErrorMsg("Authenticate to view sessions.");
        setStatus("error");
        return;
      }

      setAllSessions(sessions);
      setStatus("done");
    } catch {
      setErrorMsg("Failed to load sessions.");
      setStatus("error");
    }
  }, [activeChatJid]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const runSessionAction = useCallback(async (
    actionKey: string,
    endpoint: string,
    body: Record<string, unknown>,
    errorMessage: string,
  ) => {
    if (actionBusy) return null;
    setActionBusy(actionKey);
    setActionError(null);
    try {
      const res = await fetch(endpoint, {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const errBody = await res.json().catch(() => null);
        const apiError = typeof errBody?.error === "string" ? errBody.error : null;
        console.warn(`[tasks] ${actionKey} failed:`, res.status, apiError);
        setActionError(apiError || errorMessage);
        return null;
      }
      const payload = await res.json().catch(() => null);
      await loadData();
      return extractChatJidFromAction(payload);
    } catch (err) {
      console.warn(`[tasks] ${actionKey} failed:`, err);
      setActionError(errorMessage);
      return null;
    } finally {
      setActionBusy(null);
    }
  }, [actionBusy, loadData]);

  const handleRenameSession = useCallback(async (chatJid: string) => {
    const session = allSessions.find((entry) => entry.jid === chatJid);
    const input = await showPrompt({
      title: "Enter new session name:",
      placeholder: "session-name",
      defaultValue: session ? chatName(session) : "",
    });
    const name = sanitizeSessionName(input);
    if (!name) return;
    await runSessionAction(
      `rename-${chatJid}`,
      "/agent/branch-rename",
      { chat_jid: chatJid, agent_name: name },
      "Couldn't rename session. Please try again.",
    );
  }, [allSessions, runSessionAction, showPrompt]);

  const handleArchiveSession = useCallback(async (chatJid: string) => {
    const confirmed = await showConfirm({
      title: "Archive this session?",
      description: "The session will be archived and can be restored later.",
      confirmLabel: "Archive",
    });
    if (!confirmed) return;
    await runSessionAction(
      `archive-${chatJid}`,
      "/agent/branch-prune",
      { chat_jid: chatJid },
      "Couldn't archive session. Please try again.",
    );
    // Navigate to default if we archived the current session
    if (chatJid === activeChatJid) navigateToChat("web:default");
  }, [activeChatJid, runSessionAction, showConfirm]);

  const handleDeleteSession = useCallback(async (chatJid: string) => {
    const confirmed = await showConfirm({
      title: "Delete this session permanently?",
      description: "This cannot be undone. The session must be archived first.",
      confirmLabel: "Delete permanently",
      destructive: true,
    });
    if (!confirmed) return;
    const nextChatJid = await runSessionAction(
      `delete-${chatJid}`,
      "/agent/branch-purge",
      { chat_jid: chatJid },
      "Couldn't delete session. Please try again.",
    );
    if (chatJid === activeChatJid && nextChatJid) {
      navigateToChat(nextChatJid);
    }
  }, [activeChatJid, runSessionAction, showConfirm]);

  const handleNewBranch = useCallback(async () => {
    const nextChatJid = await runSessionAction(
      "fork",
      "/agent/branch-fork",
      { source_chat_jid: activeChatJid },
      "Couldn't create branch. Please try again.",
    );
    if (nextChatJid) navigateToChat(nextChatJid);
  }, [activeChatJid, runSessionAction]);

  const handleNewRoot = useCallback(async () => {
    const input = await showPrompt({
      title: "Enter root session name:",
      placeholder: "session-name",
    });
    const name = sanitizeSessionName(input);
    if (!name) return;
    const nextChatJid = await runSessionAction(
      "new-root",
      "/agent/root-session",
      { agent_name: name },
      "Couldn't create root session. Please try again.",
    );
    if (nextChatJid) navigateToChat(nextChatJid);
  }, [runSessionAction, showPrompt]);

  const handleMergeParent = useCallback(async () => {
    const nextChatJid = await runSessionAction(
      "merge-parent",
      "/agent/branch-merge-parent",
      { chat_jid: activeChatJid },
      "Couldn't merge session into parent. Please try again.",
    );
    if (nextChatJid) navigateToChat(nextChatJid);
  }, [activeChatJid, runSessionAction]);

  const handleRestore = useCallback(async (branchJid: string) => {
    await runSessionAction(
      `restore-${branchJid}`,
      "/agent/branch-restore",
      { chat_jid: branchJid },
      "Couldn't restore branch. Please try again.",
    );
  }, [runSessionAction]);

  if (status === "loading") {
    return (
      <div className="tasks-panel__sessions">
        <div className="tasks-panel__list">
          <div className="tasks-panel__empty">Loading sessions…</div>
        </div>
      </div>
    );
  }

  if (status === "error") {
    return (
      <div className="tasks-panel__sessions">
        <div className="tasks-panel__sessions-error">
          <span>{errorMsg || "Failed to load sessions."}</span>
          <button type="button" className="settings-panel__provider-btn" onClick={() => { void loadData(); }}>Retry</button>
        </div>
      </div>
    );
  }

  return (
    <div className="tasks-panel__sessions">
      <div className="tasks-panel__list tasks-panel__sessions-list">
        {allSessions.length === 0 && (
          <div className="tasks-panel__empty">No sessions found.</div>
        )}

        {allSessions.map((session) => {
          const isCurrent = session.jid === activeChatJid;
          const isArchived = session.archived || session.status === "archived";
          const isInactive = !isArchived && session.status === "inactive";
          const statusTone = isCurrent ? "current" : isArchived ? "archived" : isInactive ? "inactive" : "active";

          return (
            <div
              key={session.jid}
              className={`tasks-panel__session-row${isCurrent ? " tasks-panel__session-row--current" : ""}${isArchived ? " tasks-panel__session-row--archived" : ""}${selectedJid === session.jid ? " tasks-panel__session-row--selected" : ""}`}
            >
              <button
                type="button"
                className="tasks-panel__session-main"
                onClick={() => isArchived ? setSelectedJid(selectedJid === session.jid ? null : session.jid) : navigateToChat(session.jid)}
                title={isArchived ? "Select to restore" : session.jid}
              >
                <span className={`tasks-panel__session-dot tasks-panel__session-dot--${statusTone}`} />
                <span className="tasks-panel__session-name">@{chatName(session)}</span>
                <span className="tasks-panel__session-jid">{session.jid}</span>
                <span className="tasks-panel__session-badges">
                  {isCurrent && <span className="tasks-panel__item-badge tasks-panel__item-badge--current">current</span>}
                  {!isArchived && !isInactive && <span className="tasks-panel__item-badge tasks-panel__item-badge--active">active</span>}
                  {isInactive && <span className="tasks-panel__item-badge tasks-panel__item-badge--inactive">inactive</span>}
                  {isArchived && <span className="tasks-panel__item-badge tasks-panel__item-badge--archived">archived</span>}
                </span>
              </button>

              <div className="tasks-panel__session-actions" aria-label={`Actions for ${chatName(session)}`}>
                {isArchived ? (
                  <>
                    <button
                      type="button"
                      className="tasks-panel__action-icon"
                      disabled={Boolean(actionBusy)}
                      onClick={(event) => {
                        event.stopPropagation();
                        void handleRestore(session.jid);
                      }}
                      title="Restore session"
                    >
                      <i className="codicon codicon-history" />
                    </button>
                    <button
                      type="button"
                      className="tasks-panel__action-icon tasks-panel__action-icon--delete"
                      disabled={Boolean(actionBusy)}
                      onClick={(event) => {
                        event.stopPropagation();
                        void handleDeleteSession(session.jid);
                      }}
                      title="Delete permanently"
                    >
                      <i className="codicon codicon-trash" />
                    </button>
                  </>
                ) : (
                  <>
                    <button
                      type="button"
                      className="tasks-panel__action-icon"
                      disabled={Boolean(actionBusy)}
                      onClick={(event) => {
                        event.stopPropagation();
                        void handleRenameSession(session.jid);
                      }}
                      title="Rename session"
                    >
                      <i className="codicon codicon-edit" />
                    </button>
                    <button
                      type="button"
                      className="tasks-panel__action-icon"
                      disabled={Boolean(actionBusy)}
                      onClick={(event) => {
                        event.stopPropagation();
                        void handleArchiveSession(session.jid);
                      }}
                      title="Archive session"
                    >
                      <i className="codicon codicon-archive" />
                    </button>
                  </>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <div className="tasks-panel__sessions-footer">
        {actionError && <div className="tasks-panel__sessions-error tasks-panel__sessions-error--inline">{actionError}</div>}
        <div className="tasks-panel__sessions-toolbar">
          <button type="button" className="tasks-panel__toolbar-btn" disabled={Boolean(actionBusy)} onClick={() => { void handleNewBranch(); }} title="Fork current session">
            <i className="codicon codicon-repo-forked" /> Fork
          </button>
          <button type="button" className="tasks-panel__toolbar-btn" disabled={Boolean(actionBusy)} onClick={() => { void handleNewRoot(); }} title="Create new root session">
            <i className="codicon codicon-add" /> New root…
          </button>
          <button type="button" className="tasks-panel__toolbar-btn" disabled={Boolean(actionBusy)} onClick={() => { void handleMergeParent(); }} title="Merge current into parent">
            <i className="codicon codicon-git-merge" /> Merge
          </button>
          {selectedJid && allSessions.find(s => s.jid === selectedJid && (s.archived || s.status === "archived")) && (
            <button type="button" className="tasks-panel__toolbar-btn" disabled={Boolean(actionBusy)} onClick={() => { void handleRestore(selectedJid); setSelectedJid(null); }} title="Restore archived session">
              <i className="codicon codicon-history" /> Restore
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── TasksPanel (root) ────────────────────────────────────────────────────────

type TabId = "tasks" | "sessions";

export function TasksPanel() {
  const [activeTab, setActiveTab] = useState<TabId>("sessions");
  const activeChatJid = getChatJid();

  return (
    <div className="tasks-panel">
      <div className="tasks-panel__tabs" role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === "sessions"}
          className={`tasks-panel__tab${activeTab === "sessions" ? " tasks-panel__tab--active" : ""}`}
          onClick={() => setActiveTab("sessions")}
        >
          Sessions
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === "tasks"}
          className={`tasks-panel__tab${activeTab === "tasks" ? " tasks-panel__tab--active" : ""}`}
          onClick={() => setActiveTab("tasks")}
        >
          Tasks
        </button>
      </div>

      <div className="tasks-panel__body">
        {activeTab === "sessions" && <SessionsTab activeChatJid={activeChatJid} />}
        {activeTab === "tasks" && <TasksTab />}
      </div>
    </div>
  );
}
