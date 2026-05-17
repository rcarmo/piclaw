import { fmtTokens } from "./types";
import { getContextUsagePercent } from "../../utils/context-budget";

interface ContextRingProps {
  percent: number;
  tokens: number;
  contextWindow: number;
  onClick: (e: Event) => void;
}

export function ContextRing({ tokens, contextWindow, onClick }: ContextRingProps) {
  const p = getContextUsagePercent(tokens, contextWindow);
  const color = p >= 90 ? "var(--error)" : p >= 70 ? "var(--warning)" : "var(--success)";
  const tokensK = fmtTokens(tokens);
  const totalK = contextWindow > 0 ? fmtTokens(contextWindow) : "--";

  return (
    <span
      className="context-ring"
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); e.stopPropagation(); onClick(e); } }}
      title={`Context: ${tokensK}/${totalK} (${p.toFixed(0)}%) \u2014 click to compact`}
    >
      <svg width="12" height="12" viewBox="0 0 12 12">
        <circle cx="6" cy="6" r="5" fill={color} opacity="0.9" />
      </svg>
      <span className="context-ring__label">{tokensK}/{totalK}</span>
    </span>
  );
}
