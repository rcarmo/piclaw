import { fmtTokens } from "./types";

interface ContextRingProps {
  percent: number | null | undefined;
  tokens: number | null | undefined;
  contextWindow: number | null | undefined;
  onClick: (e: Event) => void;
}

export function ContextRing({ percent, tokens, contextWindow, onClick }: ContextRingProps) {
  const p = percent != null && Number.isFinite(percent) ? Math.min(100, Math.max(0, percent)) : null;
  const color = p == null ? "var(--text-muted)" : p > 90 ? "var(--error)" : p > 75 ? "var(--warning)" : "var(--success)";
  const tokensK = tokens != null && Number.isFinite(tokens) && tokens >= 0 ? fmtTokens(tokens) : "--";
  const totalK = contextWindow != null && Number.isFinite(contextWindow) && contextWindow > 0 ? fmtTokens(contextWindow) : "--";
  const percentLabel = p == null ? "unavailable" : `${p.toFixed(0)}%`;
  const title = `Context: ${tokensK} / ${totalK} tokens (${percentLabel})\nCompact context`;

  return (
    <span
      className="context-ring"
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); e.stopPropagation(); onClick(e); } }}
      title={title}
      aria-label={title}
    >
      <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
        <circle cx="6" cy="6" r="5" fill={color} opacity="0.9" />
      </svg>
      <span className="context-ring__label">{tokensK}/{totalK}</span>
    </span>
  );
}
