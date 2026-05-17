import { useEffect, useRef, useState } from "preact/hooks";
import { renderThinkingMarkdown } from "../utils/markdown-pipeline";
import { copyToClipboard } from "../utils/clipboard";
import { formatElapsed } from "../utils/format";

// ---------------------------------------------------------------------------
// ExtensionPanel type
// ---------------------------------------------------------------------------

export interface ExtensionPanelAction {
  /** Unique action identifier */
  id: string;
  /** Button label */
  label: string;
  /** When true, renders as pending/disabled with "Working…" label */
  pending?: boolean;
  /** Danger tone — renders with danger styling */
  tone?: "danger";
}

export interface ExtensionPanelSeries {
  key: string;
  label: string;
  points: Array<{ t: number; v: number }>;
}

export interface ExtensionPanel {
  /** Unique panel identifier (maps to upstream `key`) */
  id: string;
  /** Display title */
  title: string;
  /** Subtitle/metadata (maps to upstream `collapsed_text`) */
  meta?: string;
  /** State determines dot color and animation */
  state: "running" | "idle" | "error" | "done";
  /** Markdown content for expanded detail view (maps to upstream `detail_markdown`) */
  detail?: string;
  /** Action buttons */
  actions?: ExtensionPanelAction[];
  /** Copyable tmux command (maps to upstream `tmux_command`) */
  tmuxCommand?: string;
  /** ISO timestamp for elapsed display (maps to upstream `started_at` or `last_activity_at`) */
  lastActivity?: string;
  /** Reserved for #376 — series chart data */
  series?: ExtensionPanelSeries[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------



// Copy icon SVG (matches upstream COPY_ICON_SVG)
const CopyIcon = () => (
  <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
  </svg>
);

// ---------------------------------------------------------------------------
// ExtensionPanelCard component
// ---------------------------------------------------------------------------

interface ExtensionPanelCardProps {
  panel: ExtensionPanel;
  nowMs: number;
  onAction?: (panelId: string, actionId: string) => void;
  onDismiss?: (panelId: string) => void;
}

export function ExtensionPanelCard({ panel, nowMs, onAction, onDismiss }: ExtensionPanelCardProps) {
  const [expanded, setExpanded] = useState(false);
  const [copyState, setCopyState] = useState<"idle" | "copied">("idle");
  const detailRef = useRef<HTMLDivElement>(null);

  const state = panel.state ?? "idle";
  const isExpandable = Boolean(
    panel.detail?.trim() ||
    panel.tmuxCommand?.trim() ||
    (Array.isArray(panel.series) && panel.series.length > 0)
  );
  const elapsedLabel = panel.lastActivity ? formatElapsed(panel.lastActivity, nowMs) : null;

  // Render markdown detail into DOM
  useEffect(() => {
    if (detailRef.current && panel.detail) {
      detailRef.current.innerHTML = renderThinkingMarkdown(panel.detail);
    }
  }, [panel.detail, expanded]);

  const handleCopy = async () => {
    if (!panel.tmuxCommand) return;
    const ok = await copyToClipboard(panel.tmuxCommand);
    if (ok) {
      setCopyState("copied");
      setTimeout(() => setCopyState("idle"), 2000);
      window.dispatchEvent(
        new CustomEvent("piclaw:status-flash", {
          detail: { message: "tmux command copied", type: "success" },
        })
      );
    } else {
      window.dispatchEvent(
        new CustomEvent("piclaw:status-flash", {
          detail: { message: "Copy failed — clipboard unavailable", type: "error" },
        })
      );
    }
  };

  return (
    <div
      className={`agent-status-card agent-status-card--extension agent-status-card--ext-${state}`}
      data-expanded={expanded ? "true" : "false"}
    >
      {/* Header */}
      <div
        className="agent-status-card__header"
        onClick={() => isExpandable && setExpanded((v) => !v)}
        style={isExpandable ? undefined : { cursor: "default" }}
      >
        {/* State dot */}
        <span
          className={[
            "agent-status-card__dot",
            "agent-ext-panel__dot",
            `agent-ext-panel__dot--${state}`,
          ].join(" ")}
          aria-hidden="true"
        />

        {/* Title */}
        <span className="agent-status-card__title">{panel.title}</span>

        {/* Meta/subtitle */}
        {panel.meta && (
          <span className="agent-ext-panel__meta">{panel.meta}</span>
        )}

        {/* Elapsed */}
        {elapsedLabel && (
          <span className="agent-status-card__timer">{elapsedLabel}</span>
        )}

        {/* Inline action buttons */}
        {Array.isArray(panel.actions) && panel.actions.length > 0 && (
          <div className="agent-ext-panel__actions">
            {panel.actions.map((action) => (
              <button
                key={action.id}
                type="button"
                className={[
                  "agent-ext-panel__action-btn",
                  action.tone === "danger" ? "agent-ext-panel__action-btn--danger" : "",
                ].filter(Boolean).join(" ")}
                disabled={!!action.pending}
                onClick={(e) => {
                  e.stopPropagation();
                  if (!action.pending && onAction) {
                    onAction(panel.id, action.id);
                  }
                }}
              >
                {action.pending ? "Working…" : action.label}
              </button>
            ))}
          </div>
        )}

        {/* Close/dismiss button */}
        {onDismiss && (
          <button
            type="button"
            className="agent-status-card__close"
            onClick={(e) => { e.stopPropagation(); onDismiss(panel.id); }}
            aria-label="Dismiss panel"
          >
            ×
          </button>
        )}

        {/* Expand/collapse toggle */}
        {isExpandable && (
          <button
            type="button"
            className="agent-ext-panel__toggle"
            aria-label={`${expanded ? "Collapse" : "Expand"} ${panel.title}`}
            title={expanded ? "Collapse details" : "Expand details"}
            onClick={(e) => {
              e.stopPropagation();
              setExpanded((v) => !v);
            }}
          >
            <svg
              viewBox="0 0 16 16"
              width="12"
              height="12"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              {expanded
                ? <polyline points="4 6 8 10 12 6" />
                : <polyline points="4 10 8 6 12 10" />}
            </svg>
          </button>
        )}
      </div>

      {/* Expanded content */}
      {expanded && (
        <div className="agent-status-card__content agent-ext-panel__content">
          {/* Detail markdown */}
          {panel.detail?.trim() && (
            <div
              className="agent-ext-panel__detail agent-status-panel__body-text"
              ref={detailRef}
            />
          )}

          {/* Tmux command block */}
          {panel.tmuxCommand?.trim() && (
            <div className="agent-ext-panel__tmux-block">
              <div className="agent-ext-panel__tmux-header">
                <span>Attach to session</span>
              </div>
              <div className="agent-ext-panel__tmux-shell">
                <pre className="agent-ext-panel__tmux-code">{panel.tmuxCommand}</pre>
                <button
                  type="button"
                  className="agent-ext-panel__tmux-copy"
                  aria-label="Copy tmux command"
                  title={copyState === "copied" ? "Copied!" : "Copy tmux command"}
                  onClick={handleCopy}
                >
                  {copyState === "copied"
                    ? <span aria-hidden="true">✓</span>
                    : <CopyIcon />}
                </button>
              </div>
            </div>
          )}

          {/* Series chart placeholder (#376) */}
          {Array.isArray(panel.series) && panel.series.length > 0 && (
            <div
              className="agent-ext-panel__series-placeholder"
              data-series-placeholder="true"
              data-panel-id={panel.id}
            >
              <span className="agent-ext-panel__series-placeholder-label">
                Variable history will appear after the first completed run.
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Normalize upstream extension_ui_widget payload → ExtensionPanel
// ---------------------------------------------------------------------------

interface UpstreamPanelPayload {
  key?: unknown;
  content?: Array<{ type?: unknown; panel?: Record<string, unknown> | null } | null> | null;
  options?: { remove?: boolean; surface?: string | null } | null;
}

function findPanelInContent(
  content: UpstreamPanelPayload["content"]
): Record<string, unknown> | null {
  if (!Array.isArray(content)) return null;
  const match = content.find(
    (item) => item?.type === "status_panel" && item?.panel
  );
  return (match?.panel as Record<string, unknown>) ?? null;
}

function mapUpstreamState(
  raw: unknown
): ExtensionPanel["state"] {
  const s = String(raw ?? "").toLowerCase();
  if (s === "running") return "running";
  if (s === "error" || s === "failed") return "error";
  if (s === "completed" || s === "done") return "done";
  return "idle";
}

/**
 * Convert an `extension_ui_widget` SSE payload to an ExtensionPanel or null (remove).
 * Returns `null` when the panel should be removed.
 */
export function normalizeExtensionPanelPayload(
  payload: UpstreamPanelPayload
): { id: string; panel: ExtensionPanel | null } | null {
  const key = typeof payload?.key === "string" ? payload.key.trim() : "";
  if (!key) return null;

  const remove = payload?.options?.remove;
  if (remove) return { id: key, panel: null };

  const raw = findPanelInContent(payload.content);
  if (!raw) return { id: key, panel: null };

  const actions: ExtensionPanelAction[] = Array.isArray(raw.actions)
    ? (raw.actions as Array<Record<string, unknown>>).map((a) => ({
        id: String(a.key ?? a.id ?? ""),
        label: String(a.label ?? "Run"),
        pending: Boolean(a.pending),
        tone: a.tone === "danger" ? "danger" : undefined,
      }))
    : [];

  const series: ExtensionPanelSeries[] = Array.isArray(raw.series)
    ? (raw.series as Array<Record<string, unknown>>).map((s) => ({
        key: String(s.key ?? ""),
        label: String(s.label ?? ""),
        points: Array.isArray(s.points)
          ? (s.points as Array<Record<string, unknown>>).map((p) => ({
              t: Number(p.t ?? 0),
              v: Number(p.v ?? 0),
            }))
          : [],
      }))
    : [];

  const panel: ExtensionPanel = {
    id: key,
    title: String(raw.title ?? "Extension status"),
    meta: typeof raw.collapsed_text === "string" ? raw.collapsed_text.trim() || undefined : undefined,
    state: mapUpstreamState(raw.state),
    detail: typeof raw.detail_markdown === "string" ? raw.detail_markdown.trim() || undefined : undefined,
    actions: actions.length > 0 ? actions : undefined,
    tmuxCommand: typeof raw.tmux_command === "string" ? raw.tmux_command.trim() || undefined : undefined,
    lastActivity: typeof raw.started_at === "string" ? raw.started_at : typeof raw.last_activity_at === "string" ? raw.last_activity_at : undefined,
    series: series.length > 0 ? series : undefined,
  };

  return { id: key, panel };
}
