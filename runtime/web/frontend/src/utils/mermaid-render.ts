/**
 * Post-render mermaid diagram processing.
 * Lazy-loads beautiful-mermaid vendor bundle on first use.
 * Finds .mermaid-container[data-mermaid] elements and renders SVG.
 */

import _DOMPurifyModule from "dompurify";

/** Get DOMPurify instance (browser + Bun/Node safe). */
let _purifyInstance: typeof _DOMPurifyModule | null = null;
function getDOMPurifyInstance(): typeof _DOMPurifyModule | null {
  if (_purifyInstance !== null) return _purifyInstance;
  try {
    if (typeof _DOMPurifyModule.sanitize === "function") {
      _purifyInstance = _DOMPurifyModule;
    } else if (typeof (_DOMPurifyModule as unknown as (win: unknown) => typeof _DOMPurifyModule) === "function") {
      _purifyInstance = (_DOMPurifyModule as unknown as (win: unknown) => typeof _DOMPurifyModule)(globalThis);
    }
  } catch {
    // not usable
  }
  return _purifyInstance;
}

/** Sanitize SVG output from mermaid renderer using bundled DOMPurify. */
function sanitizeSvg(svg: string): string {
  const purify = getDOMPurifyInstance();
  if (!purify) return svg; // fallback: accept as-is if DOMPurify not available
  return purify.sanitize(svg, {
    USE_PROFILES: { svg: true, svgFilters: true },
    ADD_TAGS: ["foreignObject"],
    ADD_ATTR: ["dominant-baseline", "text-anchor", "transform", "clip-path", "marker-end", "marker-start"],
  });
}

/** Decode base64 to UTF-8 string */
function fromBase64(value: string): string {
  const binary = atob(String(value || ""));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new TextDecoder().decode(bytes);
}

/** Decode HTML entities recursively */
function decodeEntitiesDeep(text: string, maxDepth = 2): string {
  if (!text) return text;
  let current = text;
  for (let i = 0; i < maxDepth; i++) {
    const safe = current.replace(/</g, "&lt;").replace(/>/g, "&gt;");
    const doc = new DOMParser().parseFromString(safe, "text/html");
    const next = doc.documentElement.textContent || "";
    if (next === current) break;
    current = next;
  }
  return current;
}

/**
 * Post-process SVG: replace sharp orthogonal polyline corners with
 * smooth arc-cornered paths. Radius is clamped so short segments stay valid.
 */
function roundPolylineCorners(svgString: string, radius = 6): string {
  return svgString.replace(
    /<polyline\b([^>]*)\bpoints="([^"]+)"([^>]*)\/?\s*>/g,
    (_match, before, pointsStr, after) => {
      const pts = pointsStr.trim().split(/\s+/).map((p: string) => {
        const [x, y] = p.split(",").map(Number);
        return { x, y };
      });
      if (pts.length < 3) {
        return `<polyline${before}points="${pointsStr}"${after}/>`;
      }

      const parts = [`M ${pts[0].x},${pts[0].y}`];
      for (let i = 1; i < pts.length - 1; i++) {
        const prev = pts[i - 1];
        const curr = pts[i];
        const next = pts[i + 1];

        const dxIn = curr.x - prev.x;
        const dyIn = curr.y - prev.y;
        const dxOut = next.x - curr.x;
        const dyOut = next.y - curr.y;

        const lenIn = Math.sqrt(dxIn * dxIn + dyIn * dyIn);
        const lenOut = Math.sqrt(dxOut * dxOut + dyOut * dyOut);

        const r = Math.min(radius, lenIn / 2, lenOut / 2);
        if (r < 0.5) {
          parts.push(`L ${curr.x},${curr.y}`);
          continue;
        }

        const ax = curr.x - (dxIn / lenIn) * r;
        const ay = curr.y - (dyIn / lenIn) * r;
        const bx = curr.x + (dxOut / lenOut) * r;
        const by = curr.y + (dyOut / lenOut) * r;

        const cross = dxIn * dyOut - dyIn * dxOut;
        const sweep = cross > 0 ? 1 : 0;

        parts.push(`L ${ax},${ay}`);
        parts.push(`A ${r},${r} 0 0 ${sweep} ${bx},${by}`);
      }
      parts.push(`L ${pts[pts.length - 1].x},${pts[pts.length - 1].y}`);

      return `<path${before}d="${parts.join(" ")}"${after}/>`;
    }
  );
}

/** Detect dark mode */
function isDarkMode(): boolean {
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches !== false;
}

/** Lazy-load beautiful-mermaid vendor bundle */
let loadPromise: Promise<void> | null = null;
function ensureMermaidLoaded(): Promise<void> {
  if (window.beautifulMermaid) return Promise.resolve();
  if (loadPromise) return loadPromise;
  loadPromise = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "/static/js/vendor/beautiful-mermaid.js";
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("Failed to load mermaid vendor bundle"));
    document.head.appendChild(script);
  });
  return loadPromise;
}

/**
 * Find mermaid placeholders in a container and render them as SVG diagrams.
 * Call after DOM updates (message render, streaming).
 */
export async function renderMermaidDiagrams(container: HTMLElement): Promise<void> {
  const pending = container.querySelectorAll(".mermaid-container[data-mermaid]");
  if (!pending.length) return;

  // Lazy-load vendor bundle
  try {
    await ensureMermaidLoaded();
  } catch (e) {
    console.warn("[mermaid] Failed to load vendor bundle:", e);
    for (const el of pending) {
      el.innerHTML = '<pre class="mermaid-error">Mermaid library failed to load</pre>';
      el.removeAttribute("data-mermaid");
    }
    return;
  }

  const bm = window.beautifulMermaid;
  if (!bm?.renderMermaid) return;

  const dark = isDarkMode();
  const theme = dark ? bm.THEMES["tokyo-night"] : bm.THEMES["github-light"];

  for (const el of pending) {
    try {
      const encoded = (el as HTMLElement).dataset.mermaid;
      const raw = fromBase64(encoded || "");
      const code = decodeEntitiesDeep(raw, 2);
      let svg = await bm.renderMermaid(code, { ...theme, transparent: true });
      svg = roundPolylineCorners(svg);
      el.innerHTML = sanitizeSvg(svg);
      el.removeAttribute("data-mermaid");
    } catch (e: unknown) {
      console.error("[mermaid] Render error:", e);
      const pre = document.createElement("pre");
      pre.className = "mermaid-error";
      pre.textContent = `Diagram error: ${e instanceof Error ? e.message : String(e)}`;
      el.innerHTML = "";
      el.appendChild(pre);
      el.removeAttribute("data-mermaid");
    }
  }
}
