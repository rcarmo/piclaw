import { useEffect, useRef, useState, useCallback } from "preact/hooks";
import { getMessageUrl } from "../api/chat-jid";
import { safeParseJSON, safeSetItem } from "../utils/storage";
import { extractToolContextPath, getWorkspaceBranch } from "../utils/tool-git-context";
import {
  resolveToolKind,
  TOOL_KIND_LABELS,
  resolveTitleFromArgs,
  parseRetryAt,
  formatRetryCountdown,
  sanitizeSvg,
  type ParsedTitle,
} from "../utils/agent-status";
import { AgentRequestModal, type AgentRequest } from "./AgentRequestModal";
import { CollapsibleContent, MarkdownContent } from "./CollapsibleContent";
import { PanelHeader } from "./PanelHeader";
import {
  ExtensionPanelCard,
  normalizeExtensionPanelPayload,
  type ExtensionPanel,
} from "./ExtensionPanelCard";

/**
 * Decide whether to show a dot, spinner, or nothing for a given status.
 * Mirrors resolveRunningStatusIndicator from upstream status-dot.js.
 */
export function resolveStatusIndicator(
  status: string | null,
  opts: { pendingRequest?: boolean; isLastActivity?: boolean } = {},
): "dot" | "spinner" | "none" {
  if (opts.pendingRequest) return "dot";
  if (opts.isLastActivity) return "none";
  if (status === "error") return "none";
  if (status === "last_activity") return "none";
  if (status === "intent" || status === "pending_request") return "dot";
  if (
    status === "tool_metadata" ||
    status === "tool_call" ||
    status === "tool_status" ||
    status === "thinking" ||
    status === "waiting"
  ) {
    return "spinner";
  }
  return "dot";
}

interface PanelState {
  text: string;
  expanded: boolean;
  dismissed: boolean;
}

const COLLAPSED_MAX_LINES = 8;
const STORAGE_KEY = "piclaw:agent-panel-prefs";

function loadPanelPrefs(): { draftExpanded: boolean; thoughtExpanded: boolean } {
  return safeParseJSON(STORAGE_KEY, { draftExpanded: false, thoughtExpanded: false });
}

function savePanelPrefs(prefs: { draftExpanded: boolean; thoughtExpanded: boolean }) {
  safeSetItem(STORAGE_KEY, JSON.stringify(prefs));
}

/** Strip <internal>...</internal> blocks from text before rendering. */
function stripInternalTags(text: string): string {
  return text.replace(/<internal>[\s\S]*?<\/internal>/g, "");
}

// truncateByLines is exported from CollapsibleContent.tsx

interface StatusHint {
  key: string;
  icon_svg: string;
  label: string;
  title?: string;
}

interface ToolCall {
  id: string;
  name: string;
  title: string;
  rawTitle: string;
  toolArgs: unknown;
  kind: "bash" | "read" | "write" | "search" | "other";
  status: "running" | "done" | "error";
  hints: StatusHint[];    // "repo • branch"
  retryAt: number | null; // epoch ms for retry countdown
  gitBranch: string | null;
}

export function AgentStatusPanel() {
  const prefs = loadPanelPrefs();
  const [draft, setDraftState] = useState<PanelState>({ text: "", expanded: prefs.draftExpanded, dismissed: false });
  const [thought, setThoughtState] = useState<PanelState>({ text: "", expanded: prefs.thoughtExpanded, dismissed: false });
  const [output, setOutputState] = useState<PanelState>({ text: "", expanded: false, dismissed: false });
  const [outputMeta, setOutputMeta] = useState<{ toolName: string; startedAt: string; gitBranch: string }>({ toolName: "", startedAt: "", gitBranch: "" });
  const [status, setStatus] = useState<string | null>(null);
  const [steerQueued, setSteerQueued] = useState(false);
  const [turnColor, setTurnColor] = useState<string | null>(null);
  const [statusText, setStatusText] = useState("");
  const [tools, setTools] = useState<ToolCall[]>([]);
  const [toolsExpanded, setToolsExpanded] = useState(false);
  const [elapsed, setElapsed] = useState({ draft: 0, thought: 0, tools: 0 });
  const [nowMs, setNowMs] = useState(() => Date.now());

  // #377 Pending approval request
  const [pendingRequest, setPendingRequest] = useState<AgentRequest | null>(null);
  const [modalOpen, setModalOpen] = useState(false);

  // #320 Recovery substates
  type RecoveryState = null | "recovering" | "compacting" | "retrying" | "blocked" | "error";
  const [recoveryState, setRecoveryState] = useState<RecoveryState>(null);
  const [recoveryDetail, setRecoveryDetail] = useState("");

  // #323 Watchdog
  type WatchdogState = null | "warning" | "hung";
  const [watchdogState, setWatchdogState] = useState<WatchdogState>(null);
  const [watchdogElapsed, setWatchdogElapsed] = useState(0);
  const lastProgressTimeRef = useRef<number | null>(null);
  const agentRunningRef = useRef(false);

  // #375 Extension panels
  const [extensionPanels, setExtensionPanels] = useState<Map<string, ExtensionPanel>>(new Map());
  const [extensionPanelNowMs, setExtensionPanelNowMs] = useState(() => Date.now());

  // Tick extensionPanelNowMs every second when any panel has a lastActivity timestamp
  useEffect(() => {
    const hasTimestamp = Array.from(extensionPanels.values()).some((p) => !!p.lastActivity);
    if (!hasTimestamp) return;
    const interval = setInterval(() => setExtensionPanelNowMs(Date.now()), 1000);
    return () => clearInterval(interval);
  }, [extensionPanels]);

  const draftBufferRef = useRef("");
  const thoughtBufferRef = useRef("");
  const outputBufferRef = useRef("");
  const draftRafRef = useRef<number | null>(null);
  const thoughtRafRef = useRef<number | null>(null);
  const outputRafRef = useRef<number | null>(null);
  const draftStartRef = useRef<number | null>(null);
  const thoughtStartRef = useRef<number | null>(null);
  const toolsStartRef = useRef<number | null>(null);

  const flushDraft = useCallback(() => {
    draftRafRef.current = null;
    setDraftState((prev) => ({ ...prev, text: draftBufferRef.current }));
  }, []);

  const flushThought = useCallback(() => {
    thoughtRafRef.current = null;
    setThoughtState((prev) => ({ ...prev, text: thoughtBufferRef.current }));
  }, []);

  const flushOutput = useCallback(() => {
    outputRafRef.current = null;
    setOutputState((prev) => ({ ...prev, text: outputBufferRef.current }));
  }, []);

  useEffect(() => {
    const interval = setInterval(() => {
      setElapsed({
        draft: draftStartRef.current ? Math.floor((Date.now() - draftStartRef.current) / 1000) : 0,
        thought: thoughtStartRef.current ? Math.floor((Date.now() - thoughtStartRef.current) / 1000) : 0,
        tools: toolsStartRef.current ? Math.floor((Date.now() - toolsStartRef.current) / 1000) : 0,
      });
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  // Tick nowMs every second when any tool has an active retry countdown
  useEffect(() => {
    const hasRetry = tools.some((t) => t.retryAt != null);
    if (!hasRetry) return;
    const interval = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(interval);
  }, [tools]);

  useEffect(() => {
    const handleDraft = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (!draftStartRef.current) draftStartRef.current = Date.now();
      if (detail.delta) {
        draftBufferRef.current += detail.delta;
      } else if (detail.text !== undefined) {
        draftBufferRef.current = detail.text;
      }
      if (!draftRafRef.current) {
        draftRafRef.current = requestAnimationFrame(flushDraft);
      }
    };

    const handleThought = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (!thoughtStartRef.current) thoughtStartRef.current = Date.now();
      if (detail.delta) {
        thoughtBufferRef.current += detail.delta;
      } else if (detail.text !== undefined) {
        thoughtBufferRef.current = detail.text;
      }
      if (!thoughtRafRef.current) {
        thoughtRafRef.current = requestAnimationFrame(flushThought);
      }
    };

    const handleStatus = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail.type === "tool_call") {
        if (!toolsStartRef.current) toolsStartRef.current = Date.now();
        lastProgressTimeRef.current = Date.now();
        agentRunningRef.current = true;
        const id = detail.title || detail.tool_name || "unknown";
        setTools((prev) => {
          if (prev.some((t) => t.id === id && t.status === "running")) return prev;
          const toolName = detail.tool_name || "tool";
          const rawTitle = detail.title || toolName || "Running tool...";
          const toolArgs = detail.tool_args ?? null;
          const kind = resolveToolKind(toolName);
          const parsed = resolveTitleFromArgs(toolName, rawTitle, toolArgs);
          const displayTitle = parsed.argument != null
            ? parsed.prefix + parsed.argument + parsed.suffix
            : parsed.prefix;
          return [...prev, {
            id,
            name: toolName,
            title: displayTitle,
            rawTitle,
            toolArgs,
            kind,
            status: "running" as const,
            hints: Array.isArray(detail.status_hints) ? detail.status_hints : [],
            retryAt: null,
            gitBranch: parsed.gitBranch,
          }];
        });
      } else if (detail.type === "tool_status") {
        lastProgressTimeRef.current = Date.now();
        const id = detail.title || detail.tool_name || "unknown";
        const retryAt = parseRetryAt(detail as Record<string, unknown>);
        setTools((prev) => prev.map((t) => {
          if (t.id !== id) return t;
          const newStatus = retryAt ? "running" as const : "done" as const;
          return { ...t, status: newStatus, retryAt: retryAt ?? null };
        }));
        // Accumulate tool output preview text
        const outputPreview = detail.output_preview ?? detail.outputPreview;
        if (typeof outputPreview === "string" && outputPreview) {
          outputBufferRef.current = outputPreview;
          if (!outputRafRef.current) {
            outputRafRef.current = requestAnimationFrame(flushOutput);
          }
          // Capture meta for output panel header
          const toolName = detail.title || detail.tool_name || "";
          const startedAt = detail.started_at || detail.startedAt || "";
          setOutputMeta((prev) => ({ ...prev, toolName, startedAt }));
          // Async: fetch git branch from workspace API (like classic)
          const contextPath = extractToolContextPath(detail.tool_name, detail.tool_args);
          if (contextPath) {
            getWorkspaceBranch(contextPath).then((result) => {
              if (result?.branch) {
                setOutputMeta((prev) => ({ ...prev, gitBranch: result.branch }));
              }
            });
          }
        }
      }
      if (detail.type && detail.type !== "context_usage" && detail.type !== "done") {
        setStatus(detail.type);
        if (detail.type !== "done") {
          lastProgressTimeRef.current = Date.now();
          agentRunningRef.current = true;
        }
      }
      // steer_queued: show queued dot
      if (detail.type === "steer_queued") {
        setSteerQueued(true);
      } else if (detail.type && detail.type !== "context_usage") {
        setSteerQueued(false);
      }
      // turn color
      if (detail.turn_color) setTurnColor(detail.turn_color);
      if (detail.text || detail.message) setStatusText(detail.text || detail.message || "");

      // #377 pending_request status: also open approval modal if request_id is present
      if (detail.type === "pending_request" && detail.request_id) {
        setPendingRequest(detail as AgentRequest);
        setModalOpen(true);
      }

      // #320 Recovery substates
      if (detail.type === "intent") {
        const key = detail.intent_key;
        if (key === "recovery") {
          const strategy = detail.recovery_strategy || "";
          setRecoveryState("recovering");
          setRecoveryDetail(strategy ? `Recovering — ${strategy.replace(/_/g, " ")}` : "Recovering…");
        } else if (key === "compaction") {
          setRecoveryState("compacting");
          setRecoveryDetail("Auto-compacting…");
        } else if (key === "retry") {
          const attempt = detail.attempt;
          const total = detail.total;
          const delay = detail.delay_seconds;
          setRecoveryState("retrying");
          let txt = "Retrying";
          if (attempt != null && total != null) txt += ` (attempt ${attempt}/${total}`;
          if (delay != null) txt += `, ${delay}s delay`;
          if (attempt != null && total != null) txt += ")";
          setRecoveryDetail(txt);
        }
      } else if (detail.type === "error") {
        const classifier = detail.classifier;
        if (classifier === "auth_config" || classifier === "provider_auth") {
          setRecoveryState("blocked");
          setRecoveryDetail("Authentication required — reconfigure provider");
        } else {
          setRecoveryState("error");
          setRecoveryDetail(detail.message || detail.text || "Recovery exhausted");
        }
      }
    };

    const handleTurnEnd = () => {
      draftBufferRef.current = "";
      thoughtBufferRef.current = "";
      outputBufferRef.current = "";
      if (draftRafRef.current) cancelAnimationFrame(draftRafRef.current);
      if (thoughtRafRef.current) cancelAnimationFrame(thoughtRafRef.current);
      if (outputRafRef.current) cancelAnimationFrame(outputRafRef.current);
      draftRafRef.current = null;
      thoughtRafRef.current = null;
      outputRafRef.current = null;
      draftStartRef.current = null;
      thoughtStartRef.current = null;
      toolsStartRef.current = null;
      const savedPrefs = loadPanelPrefs();
      setDraftState({ text: "", expanded: savedPrefs.draftExpanded, dismissed: false });
      setThoughtState({ text: "", expanded: savedPrefs.thoughtExpanded, dismissed: false });
      setOutputState({ text: "", expanded: false, dismissed: false });
      setOutputMeta({ toolName: "", startedAt: "", gitBranch: "" });
      setElapsed({ draft: 0, thought: 0, tools: 0 });
      setStatus(null);
      setStatusText("");
      setSteerQueued(false);
      setTurnColor(null);
      setTools([]);
      setToolsExpanded(false);
      // Reset recovery and watchdog state
      setRecoveryState(null);
      setRecoveryDetail("");
      setWatchdogState(null);
      setWatchdogElapsed(0);
      lastProgressTimeRef.current = null;
      agentRunningRef.current = false;
      // #377 Clear pending request on turn end
      setPendingRequest(null);
      setModalOpen(false);
      // #375 Clear extension panels on turn end
      setExtensionPanels(new Map());
    };

    let mounted = true;

    window.addEventListener("piclaw:agent-draft", handleDraft);
    window.addEventListener("piclaw:agent-thought", handleThought);
    window.addEventListener("piclaw:agent-status", handleStatus);
    window.addEventListener("piclaw:agent-turn-end", handleTurnEnd);

    // #377 Pending approval requests from extension_ui_request SSE events
    const handleAgentRequest = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (!detail) return;
      // Accept extension_ui_request payloads (kind: "custom" or any kind with request_id)
      // Also accept agent_status payloads with type: "pending_request"
      if (detail.request_id || detail.type === "pending_request") {
        setPendingRequest(detail as AgentRequest);
        setModalOpen(true);
      }
    };
    window.addEventListener("piclaw:agent-request", handleAgentRequest);

    // #375 Extension panel events from extension_ui_widget SSE
    const handleExtensionPanel = (e: Event) => {
      const payload = (e as CustomEvent).detail;
      if (!payload) return;
      const result = normalizeExtensionPanelPayload(payload);
      if (!result) return;
      setExtensionPanels((prev) => {
        const next = new Map(prev);
        if (result.panel === null) {
          next.delete(result.id);
        } else {
          next.set(result.id, result.panel);
        }
        return next;
      });
    };
    window.addEventListener("piclaw:extension-panel", handleExtensionPanel);

    return () => {
      mounted = false;
      window.removeEventListener("piclaw:agent-draft", handleDraft);
      window.removeEventListener("piclaw:agent-thought", handleThought);
      window.removeEventListener("piclaw:agent-status", handleStatus);
      window.removeEventListener("piclaw:agent-turn-end", handleTurnEnd);
      window.removeEventListener("piclaw:agent-request", handleAgentRequest);
      window.removeEventListener("piclaw:extension-panel", handleExtensionPanel);
      if (draftRafRef.current) cancelAnimationFrame(draftRafRef.current);
      if (thoughtRafRef.current) cancelAnimationFrame(thoughtRafRef.current);
      if (outputRafRef.current) cancelAnimationFrame(outputRafRef.current);
    };
  }, [flushDraft, flushThought, flushOutput]);

  // #323 Watchdog interval
  useEffect(() => {
    const watchdogInterval = setInterval(() => {
      if (!agentRunningRef.current || lastProgressTimeRef.current === null) return;
      const secs = Math.floor((Date.now() - lastProgressTimeRef.current) / 1000);
      setWatchdogElapsed(secs);
      if (secs > 60) {
        setWatchdogState("hung");
      } else if (secs > 30) {
        setWatchdogState("warning");
      }
    }, 10000);
    return () => clearInterval(watchdogInterval);
  }, []);

  // #319 Abort handler
  const handleAbort = async () => {
    try {
      await fetch(getMessageUrl(), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ content: "/abort" }),
      });
    } catch {}
    window.dispatchEvent(new CustomEvent("piclaw:agent-turn-end"));
    window.dispatchEvent(new CustomEvent("piclaw:agent-status", { detail: { type: "done" } }));
  };

  const hasContent = draft.text || thought.text || output.text || tools.length > 0 || (status && status !== "idle" && status !== "done") || recoveryState || watchdogState || pendingRequest || extensionPanels.size > 0;
  if (!hasContent) return null;

  const toggleDraftExpand = () => {
    setDraftState((prev) => {
      const next = { ...prev, expanded: !prev.expanded };
      savePanelPrefs({ draftExpanded: next.expanded, thoughtExpanded: thought.expanded });
      return next;
    });
  };
  const toggleThoughtExpand = () => {
    setThoughtState((prev) => {
      const next = { ...prev, expanded: !prev.expanded };
      savePanelPrefs({ draftExpanded: draft.expanded, thoughtExpanded: next.expanded });
      return next;
    });
  };
  const dismissDraft = (e: MouseEvent) => {
    e.stopPropagation();
    setDraftState((prev) => ({ ...prev, dismissed: true }));
  };
  const dismissThought = (e: MouseEvent) => {
    e.stopPropagation();
    setThoughtState((prev) => ({ ...prev, dismissed: true }));
  };
  const dismissOutput = (e: MouseEvent) => {
    e.stopPropagation();
    setOutputState((prev) => ({ ...prev, dismissed: true }));
  };
  const toggleOutputExpand = () => {
    setOutputState((prev) => ({ ...prev, expanded: !prev.expanded }));
  };

  // Escape key: collapse any expanded panel
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
      const target = e.target as Element | null;
      if (target?.closest("input, textarea, select, [contenteditable='true']")) return;
      if ((target as HTMLElement | null)?.isContentEditable) return;
      let collapsed = false;
      if (thought.expanded) {
        setThoughtState((prev) => ({ ...prev, expanded: false }));
        savePanelPrefs({ draftExpanded: draft.expanded, thoughtExpanded: false });
        collapsed = true;
      }
      if (draft.expanded) {
        setDraftState((prev) => ({ ...prev, expanded: false }));
        savePanelPrefs({ draftExpanded: false, thoughtExpanded: thought.expanded });
        collapsed = true;
      }
      if (collapsed) {
        e.preventDefault();
        e.stopPropagation();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [thought.expanded, draft.expanded]);

  return (
    <div className="agent-status-panel">
      {/* #377 Pending approval request — shield row (clickable, auto-shows modal) */}
      {pendingRequest && (
        <div
          className="agent-status agent-status-request"
          aria-live="assertive"
          role="button"
          tabIndex={0}
          style={turnColor ? { "--turn-color": turnColor } as preact.JSX.CSSProperties : undefined}
          onClick={() => setModalOpen(true)}
          onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") setModalOpen(true); }}
          title="Click to review approval request"
        >
          <span className="agent-status-panel__status-dot" aria-hidden="true" />
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
            style={{ flexShrink: 0 }}
          >
            <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
          </svg>
          <span className="text-ellipsis">
            {pendingRequest.tool_call?.title
              ? `Awaiting approval: ${pendingRequest.tool_call.title}`
              : "Awaiting approval…"}
          </span>
        </div>
      )}

      {/* #377 Approval modal — auto-open; dismissable only via Allow/Deny/Always Allow */}
      {pendingRequest && modalOpen && (
        <AgentRequestModal
          request={pendingRequest}
          onClose={() => {
            setModalOpen(false);
            setPendingRequest(null);
          }}
        />
      )}
      {status && status !== "idle" && status !== "done" && (() => {
        const indicator = resolveStatusIndicator(status);
        // For error: show status row with ⚠ icon (indicator is 'none' but we still render)
        const showRow = indicator !== "none" || status === "error";
        if (!showRow) return null;
        const colorStyle = turnColor ? { "--turn-color": turnColor } as preact.JSX.CSSProperties : undefined;
        return (
          <div className="agent-status-panel__status" style={colorStyle}>
            {status === "error" ? (
              <span className="agent-status-panel__error-icon" aria-label="Error" role="img">⚠</span>
            ) : indicator === "spinner" ? (
              <div className="agent-status-panel__spinner" />
            ) : (
              <div
                className={[
                  "agent-status-panel__status-dot",
                  steerQueued ? "agent-status-panel__status-dot--queued" : "",
                ].filter(Boolean).join(" ")}
              />
            )}
            <span className="agent-status-panel__status-text">
              {statusText || status}
            </span>
          </div>
        );
      })()}

      {tools.length > 0 && (
        <div className="agent-status-card agent-status-card--tools">
          <div className="agent-status-card__header" onClick={() => setToolsExpanded(prev => !prev)}>
            <span className="agent-status-card__dot agent-status-card__dot--tools" />
            <span className="agent-status-card__title">Tools ({tools.length})</span>
            {elapsed.tools > 0 && (
              <span className="agent-status-card__timer">{elapsed.tools}s</span>
            )}
          </div>
          <CollapsibleContent
            expanded={toolsExpanded}
            onToggle={() => setToolsExpanded(prev => !prev)}
            items={tools.map((tool) => {
              const parsed = resolveTitleFromArgs(tool.name, tool.rawTitle, tool.toolArgs);
              const kindMeta = TOOL_KIND_LABELS[tool.kind] || TOOL_KIND_LABELS.other;
              const retryLabel = tool.retryAt != null ? formatRetryCountdown(tool.retryAt - nowMs) : null;
              return (
              <div key={tool.id} className={`agent-status-card__tool-item agent-status-card__tool-item--${tool.status}`}>
                <div className="agent-status-card__tool-indicator">
                  {tool.status === "running" ? (
                    <span className="agent-status-card__tool-spinner" />
                  ) : (
                    <span className="agent-status-panel__tool-check">✓</span>
                  )}
                </div>
                <div className="agent-status-panel__tool-info">
                  {/* Tool kind pill */}
                  <span className={`agent-tool-kind-pill ${kindMeta.cls}`}>{kindMeta.label}</span>
                  {/* Parsed title with highlighted argument */}
                  <span className="agent-status-panel__tool-title">
                    {parsed.argument != null ? (
                      <>
                        <span className="agent-tool-title-prefix">{parsed.prefix}</span>
                        <span className="agent-tool-title-arg">{parsed.argument}</span>
                        {parsed.suffix && <span className="agent-tool-title-suffix">{parsed.suffix}</span>}
                      </>
                    ) : (
                      parsed.prefix
                    )}
                  </span>
                  {/* Git branch hint */}
                  {parsed.gitBranch && (
                    <span className="agent-tool-git-branch" title="Git branch">
                      <span aria-hidden="true">⎇</span> {parsed.gitBranch}
                    </span>
                  )}
                  {/* Retry countdown */}
                  {retryLabel && (
                    <span className="agent-tool-retry-countdown">{retryLabel}</span>
                  )}
                  {/* Status hints (SVG icons) */}
                  {tool.hints.length > 0 && (
                    <span className="agent-status-panel__tool-context">
                      {tool.hints.map((hint) => (
                        <span key={hint.key} className="agent-status-panel__tool-hint" title={hint.title || hint.label}>
                          <span className="agent-status-panel__tool-hint-icon" dangerouslySetInnerHTML={{ __html: sanitizeSvg(hint.icon_svg) }} />
                          <span>{hint.label}</span>
                        </span>
                      ))}
                    </span>
                  )}
                </div>
              </div>
              );
            })}
            maxItems={3}
          />
        </div>
      )}

      {/* #320 Recovery substates pill */}
      {recoveryState && (
        <div className={`agent-status__recovery-pill agent-status__recovery-pill--${recoveryState}`}>
          <span aria-hidden="true">
            {recoveryState === "compacting" ? "🟡" :
             recoveryState === "retrying" ? "🟡" :
             recoveryState === "recovering" ? "🟠" :
             recoveryState === "blocked" ? "🔴" :
             recoveryState === "error" ? "🔴" : ""}
          </span>
          <span>{recoveryDetail}</span>
          {(watchdogState === "hung" || recoveryState === "blocked" || recoveryState === "error") && (
            <button className="agent-status__abort-btn" onClick={handleAbort}>Abort</button>
          )}
        </div>
      )}

      {/* #323 Watchdog notification */}
      {watchdogState && (
        <div className={`agent-status__recovery-pill agent-status__recovery-pill--${watchdogState === "hung" ? "error" : "retrying"}`}>
          <span aria-hidden="true">{watchdogState === "hung" ? "🔴" : "⚠️"}</span>
          <span>
            {watchdogState === "hung"
              ? `Possible hung run (${Math.floor(watchdogElapsed / 60)}m ${watchdogElapsed % 60}s)`
              : `No progress for ${watchdogElapsed}s`}
          </span>
          {watchdogState === "hung" && !recoveryState && (
            <button className="agent-status__abort-btn" onClick={handleAbort}>Abort</button>
          )}
        </div>
      )}

      {output.text && !output.dismissed && (
        <OutputPanel
          text={output.text}
          expanded={output.expanded}
          toolName={outputMeta.toolName}
          startedAt={outputMeta.startedAt}
          gitBranch={outputMeta.gitBranch}
          onToggle={toggleOutputExpand}
          onDismiss={dismissOutput}
        />
      )}

      {thought.text && !thought.dismissed && (
        <AgentPanel
          title="Thoughts"
          type="thought"
          text={thought.text}
          expanded={thought.expanded}
          elapsed={elapsed.thought}
          onToggle={toggleThoughtExpand}
          onDismiss={dismissThought}
        />
      )}

      {draft.text && !draft.dismissed && (
        <AgentPanel
          title="Draft"
          type="draft"
          text={draft.text}
          expanded={draft.expanded}
          elapsed={elapsed.draft}
          onToggle={toggleDraftExpand}
          onDismiss={dismissDraft}
        />
      )}

      {/* #375 Extension panels */}
      {extensionPanels.size > 0 && Array.from(extensionPanels.values()).map((panel) => (
        <ExtensionPanelCard
          key={panel.id}
          panel={panel}
          nowMs={extensionPanelNowMs}
          onAction={(panelId, actionId) => {
            window.dispatchEvent(
              new CustomEvent("piclaw:extension-panel-action", {
                detail: { panelId, actionId },
              })
            );
          }}
          onDismiss={(panelId) => {
            setExtensionPanels((prev) => {
              const next = new Map(prev);
              next.delete(panelId);
              return next;
            });
          }}
        />
      ))}
    </div>
  );
}

interface AgentPanelProps {
  title: string;
  type: "draft" | "thought";
  text: string;
  expanded: boolean;
  elapsed?: number;
  onToggle: () => void;
  onDismiss: (e: MouseEvent) => void;
}

function AgentPanel({ title, type, text, expanded, elapsed = 0, onToggle, onDismiss }: AgentPanelProps) {
  // Strip <internal> blocks before passing to CollapsibleContent
  const stripped = stripInternalTags(text);

  return (
    <div className={`agent-status-card agent-status-card--${type}`}>
      <PanelHeader
        title={title}
        dotColor={type}
        elapsed={elapsed}
        onToggle={onToggle}
        onDismiss={onDismiss}
      />
      <CollapsibleContent
        expanded={expanded}
        onToggle={onToggle}
        text={stripped}
        maxLines={COLLAPSED_MAX_LINES}
        renderContent={(visibleText) => <MarkdownContent text={visibleText} />}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// OutputPanel — live tool output, monospace, tail-direction, green dot
// ---------------------------------------------------------------------------

const OUTPUT_MAX_LINES = 9;

interface OutputPanelProps {
  text: string;
  expanded: boolean;
  toolName?: string;
  startedAt?: string;
  gitBranch?: string;
  onToggle: () => void;
  onDismiss: (e: MouseEvent) => void;
}

function OutputPanel({ text, expanded, toolName, startedAt, gitBranch, onToggle, onDismiss }: OutputPanelProps) {
  const elapsed = startedAt ? Math.round((Date.now() - new Date(startedAt).getTime()) / 1000) : 0;

  return (
    <div className="agent-status-card agent-status-card--output">
      <PanelHeader
        title={toolName || "Output"}
        dotColor="output"
        elapsed={elapsed}
        gitBranch={gitBranch}
        onToggle={onToggle}
        onDismiss={onDismiss}
      />
      <CollapsibleContent
        text={text}
        maxLines={OUTPUT_MAX_LINES}
        direction="tail"
        expanded={expanded}
        onToggle={onToggle}
        renderContent={(visible) => <pre className="agent-output-text">{visible}</pre>}
      />
    </div>
  );
}
