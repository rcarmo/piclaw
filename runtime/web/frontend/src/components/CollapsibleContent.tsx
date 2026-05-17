import { useEffect, useRef } from "preact/hooks";
import { type VNode } from "preact";
import { renderThinkingMarkdown } from "../utils/markdown-pipeline";

// ---------------------------------------------------------------------------
// Shared text truncation helper (previously in AgentStatusPanel)
// ---------------------------------------------------------------------------

/** Truncate text for collapsed view by line count. Returns visible text, omitted line count, total line count. */
export function truncateByLines(
  text: string,
  maxLines: number,
  direction: "head" | "tail" = "head",
): { visible: string; omitted: number; totalLines: number } {
  const normalized = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const lines = normalized.split("\n");
  const totalLines = lines.length;
  if (totalLines <= maxLines) return { visible: normalized, omitted: 0, totalLines };
  const visible = direction === "tail"
    ? lines.slice(-maxLines).join("\n")
    : lines.slice(0, maxLines).join("\n");
  return { visible, omitted: totalLines - maxLines, totalLines };
}

// ---------------------------------------------------------------------------
// MarkdownContent — renders a string as HTML via renderThinkingMarkdown
// ---------------------------------------------------------------------------

interface MarkdownContentProps {
  text: string;
}

export function MarkdownContent({ text }: MarkdownContentProps) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (ref.current) {
      ref.current.innerHTML = "";
      const div = document.createElement("div");
      div.className = "agent-status-panel__body-text";
      div.innerHTML = renderThinkingMarkdown(text);
      ref.current.appendChild(div);
    }
  }, [text]);
  return <div ref={ref} />;
}

// ---------------------------------------------------------------------------
// CollapsibleContent
// ---------------------------------------------------------------------------

interface CollapsibleContentProps {
  expanded: boolean;
  onToggle: () => void;
  // For text-based panels (thought/draft/output):
  text?: string;
  maxLines?: number; // default 8
  direction?: "head" | "tail"; // default "head"
  // Custom renderer for text content (e.g. markdown); receives the visible slice of text
  renderContent?: (visibleText: string) => VNode | null;
  // For item-based panels (tools):
  items?: VNode[];
  maxItems?: number; // default 3
}

/**
 * CollapsibleContent — shared expand/collapse behaviour for all panel types.
 *
 * - Text mode (`text` + optional `maxLines`): truncates by line count, shows
 *   "▸ N more lines" below when collapsed and "▴ show less" when expanded.
 * - Items mode (`items` + optional `maxItems`): shows last N items, shows
 *   "▸ more…" below when collapsed and "▴ show less" when expanded.
 * - Toggle button is always rendered BELOW the content — no CSS max-height.
 */
export function CollapsibleContent({
  expanded,
  onToggle,
  text,
  maxLines = 8,
  direction = "head",
  renderContent,
  items,
  maxItems = 3,
}: CollapsibleContentProps) {
  // ---- Text mode ----
  if (text !== undefined) {
    const { visible, omitted } = expanded
      ? { visible: text, omitted: 0 }
      : truncateByLines(text, maxLines, direction);
    const totalLines = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n").length;
    const canTruncate = totalLines > maxLines;

    return (
      <>
        <div className="agent-status-card__content">
          {renderContent ? renderContent(visible) : visible}
        </div>
        {!expanded && omitted > 0 && (
          <button type="button" className="agent-status-panel__more" onClick={onToggle}>
            <span className="agent-status-card__more">▸ {omitted} more lines</span>
          </button>
        )}
        {expanded && canTruncate && (
          <button type="button" className="agent-status-panel__more" onClick={onToggle}>
            ▴ show less
          </button>
        )}
      </>
    );
  }

  // ---- Items mode ----
  if (items !== undefined) {
    const canTruncate = items.length > maxItems;
    const visible = expanded ? items : items.slice(-maxItems);

    return (
      <>
        <div className="agent-status-card__content">
          {visible}
        </div>
        {!expanded && canTruncate && (
          <button type="button" className="agent-status-card__more-btn" onClick={onToggle}>
            ▸ more…
          </button>
        )}
        {expanded && canTruncate && (
          <button type="button" className="agent-status-card__more-btn" onClick={onToggle}>
            ▴ show less
          </button>
        )}
      </>
    );
  }

  return null;
}
