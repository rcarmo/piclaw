import { useState, useRef, useEffect } from "preact/hooks";
import { HighlightPopup } from "./HighlightPopup";
import { serializeSelection, applyHighlights, clearHighlights, HIGHLIGHT_COLORS, type HighlightRange } from "../../utils/highlight-serializer";
import { ImageLightbox } from "../ImageLightbox";
import { AttachmentChip } from "../AttachmentChip";
import { DelimitedTable } from "./DelimitedTable";
import { isDelimitedFile } from "../../utils/delimited-preview";
import { renderMarkdown } from "../../utils/markdown-pipeline";
import { relativeTime, getBlockKey } from "./helpers";
import { MessageActionBar } from "./MessageActionBar";
import { userAvatarUrl, assistantAvatarUrl } from "../../api/identity";
import { AvatarPopover } from "../AvatarPopover";
import { AdaptiveCardRenderer, extractCardBlocks } from "./AdaptiveCardRenderer";
import { CopyButton } from "../CopyButton";
import type { ContentBlock, Interaction } from "./types";
import { safeParseJSON, safeSetItem } from "../../utils/storage";
import { parseUserContent } from "../../utils/attachments";

// ── ToolCallBlock ──────────────────────────────────────────────────────────

const TOOL_OUTPUT_TAIL_LINES = 20;

interface ToolCallBlockProps {
  useBlock: ContentBlock;
  resultBlock?: ContentBlock;
}

export function ToolCallBlock({ useBlock, resultBlock }: ToolCallBlockProps) {
  const [open, setOpen] = useState(false);
  const [resultExpanded, setResultExpanded] = useState(false);

  const inputStr = useBlock.input
    ? JSON.stringify(useBlock.input, null, 2)
    : "";

  const resultStr = (() => {
    if (!resultBlock?.content) return null;
    if (typeof resultBlock.content === "string") return resultBlock.content;
    try {
      return JSON.stringify(resultBlock.content, null, 2);
    } catch {
      return String(resultBlock.content);
    }
  })();

  const resultLines = resultStr ? resultStr.split("\n") : [];
  const hiddenLineCount =
    resultLines.length > TOOL_OUTPUT_TAIL_LINES && !resultExpanded
      ? resultLines.length - TOOL_OUTPUT_TAIL_LINES
      : 0;
  const displayedResult =
    hiddenLineCount > 0
      ? resultLines.slice(-TOOL_OUTPUT_TAIL_LINES).join("\n")
      : resultStr;

  return (
    <div className="message-list__tool-call">
      <button
        className="message-list__tool-call-header"
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        <span className="message-list__tool-call-icon">{open ? "▾" : "▸"}</span>
        <span className="message-list__tool-call-name">
          {useBlock.name ?? "tool"}
        </span>
        {resultBlock && (
          <span className="message-list__tool-call-badge">done</span>
        )}
      </button>
      {open && (
        <div className="message-list__tool-call-body">
          {inputStr && (
            <div className="tool-call__pre-wrapper">
              <CopyButton
                text={inputStr}
                className="tool-call__copy"
                copiedClassName="tool-call__copy--copied"
                title="Copy"
              >
                <i className="codicon codicon-copy" />
              </CopyButton>
              <pre className="message-list__tool-call-code">{inputStr}</pre>
            </div>
          )}
          {displayedResult && (
            <>
              <div className="message-list__tool-call-result-label">Result</div>
              <div className="tool-call__pre-wrapper">
                {hiddenLineCount > 0 && (
                  <button
                    type="button"
                    className="tool-call__hidden-lines"
                    onClick={() => setResultExpanded(true)}
                    title="Show full output"
                  >
                    {hiddenLineCount} lines hidden — click to expand
                  </button>
                )}
                {resultExpanded && (
                  <button
                    type="button"
                    className="tool-call__hidden-lines tool-call__hidden-lines--collapse"
                    onClick={() => setResultExpanded(false)}
                  >
                    collapse
                  </button>
                )}
                <CopyButton
                  text={resultStr ?? ""}
                  className="tool-call__copy"
                  copiedClassName="tool-call__copy--copied"
                  title="Copy"
                >
                  <i className="codicon codicon-copy" />
                </CopyButton>
                <pre className="message-list__tool-call-code">{displayedResult}</pre>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

// ── MessageItem ────────────────────────────────────────────────────────────

interface MessageItemProps {
  interaction: Interaction;
  isCollapsed: boolean;
  onToggleCollapse: () => void;
  onDelete: () => void;
}

export function MessageItem({
  interaction,
  isCollapsed,
  onToggleCollapse,
  onDelete,
}: MessageItemProps) {
  const isUser = interaction.type === "user";
  const [lightboxSrc, setLightboxSrc] = useState<string | null>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const [popup, setPopup] = useState<{ x: number; y: number } | null>(null);
  const pendingSelectionRef = useRef<{ startOffset: number; endOffset: number; text: string } | null>(null);

  const getStoredHighlights = (id: number): HighlightRange[] =>
    safeParseJSON<HighlightRange[]>(`highlights:${id}`, []);

  const saveHighlights = (id: number, highlights: HighlightRange[]) => {
    safeSetItem(`highlights:${id}`, JSON.stringify(highlights));
  };

  useEffect(() => {
    if (!contentRef.current) return;
    const stored = getStoredHighlights(interaction.id);
    if (stored.length) {
      clearHighlights(contentRef.current);
      applyHighlights(contentRef.current, stored);
    }
  }, [interaction.id, interaction.content]);

  const handlePointerUp = (e: PointerEvent) => {
    // Delay to let system selection menu appear first, then show ours above it
    setTimeout(() => {
      const sel = window.getSelection();
      if (!sel || sel.isCollapsed || !contentRef.current) return;
      const serialized = serializeSelection(contentRef.current, sel);
      if (!serialized) return;
      pendingSelectionRef.current = serialized;
      // Position above the selection, not at pointer (avoids system menu overlap)
      const range = sel.getRangeAt(0);
      const rect = range.getBoundingClientRect();
      setPopup({ x: rect.left, y: rect.top });
    }, 300);
  };

  const handleSelectColor = (color: string) => {
    if (!pendingSelectionRef.current || !contentRef.current) return;
    const newHl: HighlightRange = { color, ...pendingSelectionRef.current };
    const existing = getStoredHighlights(interaction.id);
    const updated = [...existing, newHl];
    saveHighlights(interaction.id, updated);
    clearHighlights(contentRef.current);
    applyHighlights(contentRef.current, updated);
    pendingSelectionRef.current = null;
    setPopup(null);
    window.getSelection()?.removeAllRanges();
  };

  const handleClearHighlight = () => {
    if (!contentRef.current) return;
    if (pendingSelectionRef.current) {
      // Remove highlights that overlap the selected range
      const { startOffset, endOffset } = pendingSelectionRef.current;
      const existing = getStoredHighlights(interaction.id);
      const updated = existing.filter(
        (hl) => hl.endOffset <= startOffset || hl.startOffset >= endOffset
      );
      saveHighlights(interaction.id, updated);
      clearHighlights(contentRef.current);
      applyHighlights(contentRef.current, updated);
    } else {
      saveHighlights(interaction.id, []);
      clearHighlights(contentRef.current);
    }
    pendingSelectionRef.current = null;
    setPopup(null);
    window.getSelection()?.removeAllRanges();
  };

  const handleContentClick = (e: MouseEvent) => {
    const target = e.target as HTMLElement;
    if (target.tagName === "IMG") {
      const src = (target as HTMLImageElement).src;
      if (src) setLightboxSrc(src);
    }
  };

  const renderUserContent = (content: string) => {
    const { cleanedContent, attachments } = parseUserContent(content);

    return (
      <>
        {cleanedContent}
        {attachments.length > 0 && (
          <div className="message-list__attachments">
            {attachments.map((attachment, idx) => (
              <div key={`${attachment.mediaId}-${attachment.filename}-${idx}`}>
                <AttachmentChip
                  mediaId={attachment.mediaId}
                  filename={attachment.filename}
                />
                {isDelimitedFile(attachment.filename) && (
                  <DelimitedTable
                    mediaId={attachment.mediaId}
                    filename={attachment.filename}
                  />
                )}
              </div>
            ))}
          </div>
        )}
      </>
    );
  };

  // Pair tool_use with their tool_result blocks
  const toolPairs: { use: ContentBlock; result?: ContentBlock }[] = [];
  if (interaction.content_blocks?.length) {
    const blocks = interaction.content_blocks;
    const resultsByToolUseId = new Map<string, ContentBlock>();
    for (const b of blocks) {
      if (b.type === "tool_result" && b.tool_use_id) {
        resultsByToolUseId.set(b.tool_use_id, b);
      }
    }
    for (const b of blocks) {
      if (b.type === "tool_use") {
        toolPairs.push({
          use: b,
          result: b.id ? resultsByToolUseId.get(b.id) : undefined,
        });
      }
    }
  }

  const displayName = isUser ? "You" : "PiClaw";

  const [userImgError, setUserImgError] = useState(false);
  const [avatarPopover, setAvatarPopover] = useState<{ type: "user" | "agent"; x: number; y: number } | null>(null);

  const handleAvatarClick = (e: MouseEvent) => {
    e.stopPropagation();
    setAvatarPopover({ type: isUser ? "user" : "agent", x: e.clientX, y: e.clientY });
  };

  const AvatarCircle = () => {
    if (isUser) {
      const uavUrl = userAvatarUrl.value;
      if (uavUrl && !userImgError) {
        return <img className="message-list__avatar-img" src={uavUrl} alt="" aria-hidden="true" onError={() => setUserImgError(true)} />;
      }
      return <div className="message-list__avatar-circle message-list__avatar-circle--user" aria-hidden="true">Y</div>;
    }
    return <img className="message-list__avatar-img" src={assistantAvatarUrl.value} alt="" aria-hidden="true" onError={(e) => { (e.target as HTMLImageElement).src = "/static/icon-192.png"; }} />;
  };

  // ── Collapsed render ───────────────────────────────────────────────────
  if (isCollapsed) {
    return (
      <div
        className={`message-list__item message-list__item--collapsed ${
          isUser ? "message-list__item--user" : "message-list__item--agent"
        }`}
        data-message-id={interaction.id}
      >
        <span className="message-list__avatar-clickable" onClick={handleAvatarClick}><AvatarCircle /></span>
        <div className="message-list__body message-list__body--collapsed">
          <MessageActionBar
            messageId={interaction.id}
            content={interaction.content ?? ""}
            isCollapsed={true}
            onToggleCollapse={onToggleCollapse}
            onDelete={onDelete}
          />
          <span
            className={`message-list__name ${
              isUser ? "message-list__name--user" : "message-list__name--agent"
            }`}
          >
            {displayName}
          </span>
          <span
            className="message-list__time"
            title={new Date(interaction.created_at).toLocaleString()}
          >
            {relativeTime(interaction.created_at)}
          </span>
          <span className="message-list__collapsed-preview">
            {interaction.content
              ? interaction.content.replace(/\s+/g, " ").slice(0, 120) + (interaction.content.length > 120 ? "…" : "")
              : "— collapsed"}
          </span>
        </div>
      </div>
    );
  }

  // ── Expanded render ────────────────────────────────────────────────────
  return (
    <div
      className={`message-list__item ${
        isUser ? "message-list__item--user" : "message-list__item--agent"
      }`}
      data-message-id={interaction.id}
    >
      <span className="message-list__avatar-clickable" onClick={handleAvatarClick}><AvatarCircle /></span>
      <div className="message-list__body">
        <MessageActionBar
          messageId={interaction.id}
          content={interaction.content ?? ""}
          isCollapsed={false}
          onToggleCollapse={onToggleCollapse}
          onDelete={onDelete}
        />
        <div className="message-list__header">
          <span
            className={`message-list__name ${
              isUser ? "message-list__name--user" : "message-list__name--agent"
            }`}
          >
            {displayName}
          </span>
          <span
            className="message-list__time"
            title={new Date(interaction.created_at).toLocaleString()}
          >
            {relativeTime(interaction.created_at)}
          </span>
        </div>
        {toolPairs.length > 0 && (
          <div className="message-list__tool-calls">
            {toolPairs.map((pair, i) => (
              <ToolCallBlock
                key={getBlockKey(pair.use, i)}
                useBlock={pair.use}
                resultBlock={pair.result}
              />
            ))}
          </div>
        )}
        {interaction.content_blocks && extractCardBlocks(interaction.content_blocks).length > 0 && (
          <AdaptiveCardRenderer
            blocks={interaction.content_blocks}
            postId={interaction.id}
          />
        )}
        {!isUser && interaction.content_blocks?.some((b: Record<string, unknown>) => b.type === "file") && (
          <div className="message-list__attachments">
            {interaction.content_blocks
              .filter((b: Record<string, unknown>) => b.type === "file")
              .map((b: Record<string, unknown>, i: number) => {
                const filename = String(b.filename ?? b.name ?? "file");
                const mediaId = interaction.media_ids?.[i];
                return (
                  <>
                  <span key={i} className="attachment-chip">
                    <span className="attachment-chip__icon">📄</span>
                    <span className="attachment-chip__name">{filename}</span>
                    {mediaId && (
                      <>
                        <span
                          className="attachment-chip__action"
                          role="button"
                          tabIndex={0}
                          title="Download"
                          onClick={async (e) => {
                            e.stopPropagation();
                            try {
                              const res = await fetch(`/media/${mediaId}`);
                              const blob = await res.blob();
                              const url = URL.createObjectURL(blob);
                              const a = document.createElement('a');
                              a.href = url;
                              a.download = filename;
                              a.click();
                              URL.revokeObjectURL(url);
                            } catch {
                              window.open(`/media/${mediaId}`, '_blank');
                            }
                          }}
                        >
                          <i className="codicon codicon-desktop-download" />
                        </span>
                        <span
                          className="attachment-chip__action"
                          role="button"
                          tabIndex={0}
                          title="Preview"
                          onClick={async (e) => {
                            e.stopPropagation();
                            try {
                              const res = await fetch(`/media/${mediaId}`);
                              const text = await res.text();
                              const previewHtml = `
                                <style>
                                  :root { color-scheme: light dark; }
                                  body { font-family: -apple-system, system-ui, sans-serif; padding: 32px 48px; max-width: 860px; margin: 0 auto; line-height: 1.6; font-size: 14px; color: #1e1e1e; background: #fff; }
                                  h1, h2, h3 { color: #2563eb; margin-top: 24px; }
                                  h1 { font-size: 22px; border-bottom: 1px solid #d4d4d4; padding-bottom: 8px; }
                                  h2 { font-size: 18px; }
                                  h3 { font-size: 15px; color: #16a34a; }
                                  pre { background: #f5f5f5; padding: 12px 16px; border-radius: 6px; overflow-x: auto; font-size: 13px; }
                                  code { font-family: monospace; background: #f5f5f5; padding: 2px 5px; border-radius: 3px; font-size: 13px; }
                                  ul, ol { padding-left: 24px; }
                                  li { margin: 4px 0; }
                                  a { color: #2563eb; }
                                  @media (prefers-color-scheme: dark) {
                                    body { color: #cdd6f4; background: #1e1e2e; }
                                    h1, h2, h3 { color: #89b4fa; }
                                    h1 { border-bottom-color: #45475a; }
                                    h3 { color: #a6e3a1; }
                                    pre, code { background: #181825; }
                                    a { color: #89b4fa; }
                                  }
                                </style>
                                ${renderMarkdown(text)}
                              `;
                              window.dispatchEvent(new CustomEvent('piclaw:widget-open', {
                                detail: { title: filename, html: previewHtml, widget_id: `preview-${mediaId}` }
                              }));
                            } catch {
                              window.open(`/media/${mediaId}`, '_blank');
                            }
                          }}
                        >
                          <i className="codicon codicon-eye" />
                        </span>
                      </>
                    )}
                  </span>
                  {mediaId && isDelimitedFile(filename) && (
                    <DelimitedTable mediaId={mediaId} filename={filename} />
                  )}
                  </>
                );
              })}
          </div>
        )}
        {interaction.content && (
          <div
            ref={contentRef}
            className="message-list__content"
            onClick={handleContentClick}
            onPointerUp={handlePointerUp}
            // biome-ignore lint/security/noDangerouslySetInnerHtml: markdown sanitized by markdown-pipeline
            dangerouslySetInnerHTML={
              isUser
                ? undefined
                : { __html: renderMarkdown(interaction.content) }
            }
          >
            {isUser ? renderUserContent(interaction.content) : undefined}
          </div>
        )}
        {popup && (
          <HighlightPopup
            x={popup.x}
            y={popup.y}
            onSelectColor={handleSelectColor}
            onClear={handleClearHighlight}
            onDismiss={() => setPopup(null)}
          />
        )}
        {interaction.content_blocks?.some((b) => b.type === "generated_widget") && (
          <button
            type="button"
            className="message-list__widget-open-btn"
            onClick={() => {
              const block = interaction.content_blocks?.find((b) => b.type === "generated_widget") as Record<string, unknown> | undefined;
              if (block) {
                window.dispatchEvent(new CustomEvent("piclaw:widget-open", {
                  detail: block
                }));
              }
            }}
          >
            📊 Open Widget
          </button>
        )}
        {interaction.media_ids && interaction.media_ids.length > 0 && !interaction.content_blocks?.some((b: Record<string, unknown>) => b.type === "file") && (
          <div className="message-list__media" onClick={handleContentClick}>
            {interaction.media_ids.map((id) => (
              <img
                key={id}
                className="message-list__media-img"
                src={`/media/${id}`}
                alt="attachment"
                loading="lazy"
              />
            ))}
          </div>
        )}
        {lightboxSrc && (
          <ImageLightbox src={lightboxSrc} onClose={() => setLightboxSrc(null)} />
        )}
        {avatarPopover && (
          <AvatarPopover
            type={avatarPopover.type}
            x={avatarPopover.x}
            y={avatarPopover.y}
            onDismiss={() => setAvatarPopover(null)}
          />
        )}
      </div>
    </div>
  );
}
