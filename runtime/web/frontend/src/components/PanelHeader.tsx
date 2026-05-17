import type { ComponentChildren } from "preact";

// ---------------------------------------------------------------------------
// Shared PanelHeader — used by all agent status card panels
// ---------------------------------------------------------------------------

const GIT_BRANCH_SVG = (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M6 3v12"/><circle cx="18" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M18 9a9 9 0 0 1-9 9"/>
  </svg>
);

interface PanelHeaderProps {
  title: string;
  dotColor?: string; // CSS class suffix: "thought" | "draft" | "output" | "tools"
  elapsed?: number; // seconds
  gitBranch?: string;
  onToggle?: () => void;
  onDismiss?: (e: MouseEvent) => void;
  children?: ComponentChildren; // extra elements in the header (e.g. tool count)
}

/**
 * Shared header for agent status card panels.
 * Renders: dot indicator, title, optional git branch, elapsed timer, optional extras, close button.
 */
export function PanelHeader({ title, dotColor, elapsed, gitBranch, onToggle, onDismiss, children }: PanelHeaderProps) {
  return (
    <div className="agent-status-card__header" onClick={onToggle}>
      {dotColor && (
        <span className={`agent-status-card__dot agent-status-card__dot--${dotColor}`} aria-hidden="true" />
      )}
      <span className="agent-status-card__title">{title}</span>
      {gitBranch && (
        <span className="agent-status-card__git-hint">
          {GIT_BRANCH_SVG}
          {gitBranch}
        </span>
      )}
      {typeof elapsed === "number" && elapsed > 0 && (
        <span className="agent-status-card__timer">{elapsed}s</span>
      )}
      {children}
      {onDismiss && (
        <button
          type="button"
          className="agent-status-card__close"
          aria-label={`Close ${title} panel`}
          onClick={onDismiss}
          title="Dismiss"
        >
          ×
        </button>
      )}
    </div>
  );
}
