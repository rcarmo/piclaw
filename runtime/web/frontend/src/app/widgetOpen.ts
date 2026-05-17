import type { Tab } from "./tabTypes";

export type WidgetArtifactKind = "html" | "svg" | "session_tree";

export interface WidgetOpenDetail {
  title?: string;
  subtitle?: string;
  description?: string;
  widget_id?: string;
  widgetId?: string;
  html?: string;
  kind?: string;
  auto_open?: boolean;
  autoOpen?: boolean;
  chat_jid?: string;
  chatJid?: string;
  originChatJid?: string;
  artifact?: Record<string, unknown>;
  [key: string]: unknown;
}

const SESSION_TREE_WIDGET_SRC = "/static/session-tree.html";

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function readString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function readArtifactKind(detail: WidgetOpenDetail): WidgetArtifactKind | null {
  const artifactKind = isRecord(detail.artifact) ? readString(detail.artifact.kind) : "";
  const kind = artifactKind || readString(detail.kind);
  if (kind === "html" || kind === "svg" || kind === "session_tree") return kind;
  return null;
}

function readChatJid(detail: WidgetOpenDetail, fallbackChatJid: string): string {
  return readString(detail.chat_jid)
    || readString(detail.chatJid)
    || readString(detail.originChatJid)
    || readString(fallbackChatJid)
    || "web:default";
}

export function buildWidgetOpenDetail(block: Record<string, unknown> | null | undefined): WidgetOpenDetail | null {
  if (!block || typeof block !== "object") return null;

  const artifact = isRecord(block.artifact) ? { ...block.artifact } : {};
  const kind = readString(artifact.kind) || readString(block.kind);
  const html = readString(artifact.html) || readString(block.html);
  const svg = readString(artifact.svg) || readString(block.svg);
  const tree = isRecord(artifact.tree) ? artifact.tree : (isRecord(block.tree) ? block.tree : undefined);
  const normalizedArtifact: Record<string, unknown> = {
    ...artifact,
    ...(kind ? { kind } : {}),
  };

  if (html) normalizedArtifact.html = html;
  if (svg) normalizedArtifact.svg = svg;
  if (tree) normalizedArtifact.tree = tree;

  const title = readString(block.title) || readString(block.name) || "Widget";
  const subtitle = readString(block.subtitle);
  const description = readString(block.description) || subtitle;
  const widgetId = readString(block.widget_id) || readString(block.widgetId) || readString(block.id);
  const autoOpen = block.auto_open === true || block.autoOpen === true;
  const chatJid = readString(block.chat_jid) || readString(block.chatJid) || readString(block.originChatJid);

  return {
    ...block,
    title,
    subtitle,
    description,
    widget_id: widgetId || undefined,
    auto_open: autoOpen,
    chat_jid: chatJid || undefined,
    artifact: normalizedArtifact,
    html: html || undefined,
    kind: (kind || undefined) as WidgetOpenDetail["kind"],
  };
}

export function buildWidgetTabFromOpenDetail(detail: WidgetOpenDetail, fallbackChatJid: string): Tab | null {
  const artifactKind = readArtifactKind(detail);
  const title = readString(detail.title) || "Widget";
  const widgetId = readString(detail.widget_id) || readString(detail.widgetId) || `w-${Date.now()}`;
  const tabId = `widget-${widgetId}`;
  const chatJid = readChatJid(detail, fallbackChatJid);
  const widgetHtml = artifactKind === "session_tree"
    ? undefined
    : (readString(detail.artifact?.html) || readString(detail.html) || undefined);
  const widgetSrc = artifactKind === "session_tree"
    ? `${SESSION_TREE_WIDGET_SRC}?chat_jid=${encodeURIComponent(chatJid)}`
    : undefined;

  return {
    id: tabId,
    label: title,
    icon: "📊",
    closable: true,
    type: "widget",
    widgetHtml,
    widgetSrc,
    widgetKind: artifactKind || undefined,
  };
}
