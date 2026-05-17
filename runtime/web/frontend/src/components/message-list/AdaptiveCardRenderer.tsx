/**
 * AdaptiveCardRenderer.tsx — Preact wrapper for rendering Adaptive Card content blocks.
 *
 * Uses the vendored adaptivecards SDK (loaded via script tag in index.html) via
 * the global `window.AdaptiveCards` namespace. This avoids ESM import issues with
 * the upstream renderer's .js extension dependencies.
 */
import { useEffect, useRef, useMemo } from "preact/hooks";
import type { ContentBlock } from "./types";

// ── Types ──────────────────────────────────────────────────────────────────

interface AdaptiveCardBlock {
  type: "adaptive_card";
  card_id: string;
  schema_version: string;
  state: "active" | "completed" | "cancelled" | "failed";
  payload: Record<string, unknown>;
  fallback_text?: string;
  completed_at?: string;
  last_submission?: unknown;
}

// ── SDK loader ─────────────────────────────────────────────────────────────

let sdkLoaded = false;
let sdkLoadPromise: Promise<void> | null = null;

async function ensureSdk(): Promise<void> {
  if (sdkLoaded) return;
  // If the script tag already ran (e.g. loaded via index.html script tag), the global is ready.
  if ((globalThis as any).AdaptiveCards) {
    sdkLoaded = true;
    return;
  }
  if (sdkLoadPromise) return sdkLoadPromise;

  sdkLoadPromise = new Promise<void>((resolve, reject) => {
    // Check again after a tick — the script tag may still be loading.
    const existing = document.querySelector<HTMLScriptElement>(
      'script[src="/static/js/vendor/adaptivecards.min.js"]',
    );
    if (existing) {
      // Already in DOM; wait for it to finish.
      existing.addEventListener("load", () => {
        sdkLoaded = true;
        resolve();
      });
      existing.addEventListener("error", () =>
        reject(new Error("adaptivecards SDK failed to load")),
      );
      return;
    }
    // Inject it ourselves.
    const script = document.createElement("script");
    script.src = "/static/js/vendor/adaptivecards.min.js";
    script.onload = () => {
      sdkLoaded = true;
      resolve();
    };
    script.onerror = () => reject(new Error("Failed to load adaptivecards SDK"));
    document.head.appendChild(script);
  });

  return sdkLoadPromise;
}

function getAC(): any {
  return (globalThis as any).AdaptiveCards;
}

// ── Host config ────────────────────────────────────────────────────────────

/** Build a minimal dark-theme HostConfig from the page's CSS variables. */
function buildHostConfig(): Record<string, unknown> {
  const style = globalThis.getComputedStyle?.(document.documentElement);
  const get = (v: string, fallback: string) => style?.getPropertyValue(v)?.trim() || fallback;

  const bg = get("--sidebarBg", "#1e1e2e");
  const fg = get("--text-primary", "#cdd6f4");
  const accent = get("--accent-color", "#89b4fa");
  const border = get("--border-color", "#45475a");
  const fgMuted = get("--text-secondary", "#a6adc8");

  return {
    $schema: "http://adaptivecards.io/schemas/host-config.json",
    fontFamily: "var(--font-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif)",
    containerStyles: {
      default: { backgroundColor: bg, foregroundColors: { default: { default: fg, subtle: fgMuted } } },
      emphasis: { backgroundColor: bg, foregroundColors: { default: { default: fg, subtle: fgMuted } } },
    },
    actions: {
      actionAlignment: "left",
      buttonSpacing: 8,
      showCard: { actionMode: "inline", inlineTopMargin: 8 },
      actionsOrientation: "horizontal",
    },
    adaptiveCard: { allowCustomStyle: true },
    separator: { lineThickness: 1, lineColor: border },
    imageSizes: { small: 40, medium: 80, large: 160 },
    inputs: {
      label: { requiredInputs: { weight: "bolder", color: "attention" }, optionalInputs: {} },
      errorMessage: { spacing: "small", size: "small", weight: "bolder", color: "attention" },
    },
    // Accent color is used for buttons/links
    hostCapabilities: {},
  };
}

// ── Helpers ────────────────────────────────────────────────────────────────

const SUPPORTED_VERSIONS = new Set(["1.0", "1.1", "1.2", "1.3", "1.4", "1.5", "1.6"]);

/** Check if a content block is a renderable adaptive card. */
function isAdaptiveCardBlock(block: ContentBlock): block is ContentBlock & AdaptiveCardBlock {
  return (
    block.type === "adaptive_card" &&
    typeof block.card_id === "string" &&
    typeof block.schema_version === "string" &&
    typeof block.payload === "object" &&
    block.payload !== null
  );
}

/** Extract adaptive card blocks from content_blocks array. */
export function extractCardBlocks(blocks: ContentBlock[]): AdaptiveCardBlock[] {
  return blocks.filter(isAdaptiveCardBlock) as unknown as AdaptiveCardBlock[];
}

// ── Renderer ───────────────────────────────────────────────────────────────

/** Render a single adaptive card block into a DOM element. */
async function renderCard(
  cardEl: HTMLElement,
  block: AdaptiveCardBlock,
  postId: number,
  chatJid?: string,
): Promise<void> {
  try {
    await ensureSdk();
  } catch (err) {
    console.error("[AdaptiveCard] SDK load failed:", err);
    const el = document.createElement("div");
    el.className = "adaptive-card-fallback";
    el.textContent = block.fallback_text ?? "Card could not be rendered (SDK unavailable).";
    cardEl.appendChild(el);
    return;
  }

  if (!SUPPORTED_VERSIONS.has(block.schema_version)) {
    console.warn(`[AdaptiveCard] Unsupported schema version ${block.schema_version}`);
    const el = document.createElement("div");
    el.className = "adaptive-card-fallback";
    el.textContent = block.fallback_text ?? `Unsupported card version: ${block.schema_version}`;
    cardEl.appendChild(el);
    return;
  }

  try {
    const AC = getAC();
    if (!AC?.AdaptiveCard) {
      throw new Error("AdaptiveCards global not found");
    }

    // Set up markdown processor once
    if (!AC.AdaptiveCard.onProcessMarkdown) {
      AC.AdaptiveCard.onProcessMarkdown = (text: string, result: any) => {
        result.outputHtml = text;
        result.didProcess = true;
      };
    }

    const card = new AC.AdaptiveCard();
    card.hostConfig = new AC.HostConfig(buildHostConfig());

    card.parse(block.payload);

    // Wire up action handler
    card.onExecuteAction = (action: any) => {
      const type: string =
        (typeof action?.getJsonTypeName === "function" ? action.getJsonTypeName() : "") ||
        action?.constructor?.name ||
        "Unknown";
      const title: string = typeof action?.title === "string" ? action.title : "";
      const url: string | undefined = typeof action?.url === "string" ? action.url : undefined;
      const data: unknown = action?.data ?? undefined;

      if (type === "Action.OpenUrl") {
        const safeUrl = url ?? "";
        if (safeUrl && /^https?:\/\/|^\//i.test(safeUrl)) {
          window.open(safeUrl, "_blank", "noopener,noreferrer");
        }
        return;
      }

      if (type === "Action.Submit") {
        cardEl.classList.add("adaptive-card-busy");
        fetch("/agent/card-action", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "same-origin",
          body: JSON.stringify({
            post_id: postId,
            thread_id: postId,
            chat_jid: chatJid ?? "web:default",
            card_id: block.card_id,
            action: { type, title, data },
          }),
        })
          .catch((err) => console.error("[AdaptiveCard] Submit failed:", err))
          .finally(() => cardEl.classList.remove("adaptive-card-busy"));
        return;
      }

      console.warn("[AdaptiveCard] Unsupported action:", type);
    };

    const rendered = card.render();
    if (!rendered) {
      throw new Error("card.render() returned null");
    }

    cardEl.classList.add("adaptive-card-container");

    // State banner for non-active cards
    if (block.state !== "active") {
      cardEl.classList.add("adaptive-card-finished");
      const label =
        block.state === "completed" ? "Submitted" :
        block.state === "cancelled" ? "Cancelled" : "Failed";
      const banner = document.createElement("div");
      banner.className = `adaptive-card-status adaptive-card-status-${block.state}`;
      banner.textContent = label;
      if (block.completed_at) {
        const detail = document.createElement("span");
        detail.className = "adaptive-card-status-detail";
        try {
          detail.textContent = " · " + new Intl.DateTimeFormat(undefined, {
            month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
          }).format(new Date(block.completed_at));
        } catch {}
        banner.appendChild(detail);
      }
      cardEl.appendChild(banner);

      // Lock inputs on completed cards
      const inputs = rendered.querySelectorAll("input, select, textarea, button");
      for (const el of inputs) {
        (el as HTMLElement).setAttribute("disabled", "");
      }
    }

    cardEl.appendChild(rendered);
  } catch (err) {
    console.error("[AdaptiveCard] Render error:", err);
    const el = document.createElement("div");
    el.className = "adaptive-card-fallback";
    el.textContent = block.fallback_text ?? "Card failed to render.";
    cardEl.appendChild(el);
  }
}

// ── Preact component ───────────────────────────────────────────────────────

interface AdaptiveCardRendererProps {
  blocks: ContentBlock[];
  postId: number;
  chatJid?: string;
}

export function AdaptiveCardRenderer({ blocks, postId, chatJid }: AdaptiveCardRendererProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const cardBlocks = useMemo(() => extractCardBlocks(blocks), [blocks]);

  // Stable key — only re-render when card identity or state changes
  const cardBlocksKey = useMemo(
    () => cardBlocks.map((b) => `${b.card_id}:${b.state}`).join("|"),
    [cardBlocks],
  );

  useEffect(() => {
    if (!containerRef.current || cardBlocks.length === 0) return;
    const container = containerRef.current;
    container.innerHTML = "";

    void (async () => {
      for (const block of cardBlocks) {
        const cardEl = document.createElement("div");
        container.appendChild(cardEl);
        await renderCard(cardEl, block, postId, chatJid);
      }
    })();
  }, [cardBlocksKey, postId, chatJid]);

  if (cardBlocks.length === 0) return null;

  return <div className="message-list__adaptive-cards" ref={containerRef} />;
}
