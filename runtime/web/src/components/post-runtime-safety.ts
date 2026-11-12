export async function writeClipboardTextBestEffort(
  clipboard: { writeText?: (value: string) => Promise<unknown> } | null | undefined,
  value: string,
): Promise<boolean> {
  try {
    await clipboard?.writeText?.(value);
    return true;
  } catch (_error) {
    return false;
  }
}

export function writeClipboardDataViaExecCommand(
  documentLike: {
    body?: { appendChild?: (node: unknown) => void; removeChild?: (node: unknown) => void };
    createElement?: (tag: string) => any;
    addEventListener?: (type: string, handler: (event: any) => void, capture?: boolean) => void;
    removeEventListener?: (type: string, handler: (event: any) => void, capture?: boolean) => void;
    execCommand?: (command: string) => boolean;
  } | null | undefined,
  payload: { text: string; html?: string | null },
): boolean {
  const text = typeof payload?.text === "string" ? payload.text : "";
  const html = typeof payload?.html === "string" ? payload.html : "";
  if (!documentLike || !text || typeof documentLike.createElement !== "function" || typeof documentLike.execCommand !== "function") {
    return false;
  }

  let host: any = null;
  let copyHandled = false;
  const onCopy = (event: any) => {
    const clipboardData = event?.clipboardData;
    if (!clipboardData || typeof clipboardData.setData !== "function") return;
    clipboardData.setData("text/plain", text);
    if (html) clipboardData.setData("text/html", html);
    if (typeof event.preventDefault === "function") event.preventDefault();
    copyHandled = true;
  };

  try {
    host = documentLike.createElement("textarea");
    host.value = text;
    if (typeof host.setAttribute === "function") host.setAttribute("readonly", "");
    if (host.style) {
      host.style.position = "fixed";
      host.style.opacity = "0";
      host.style.pointerEvents = "none";
    }
    documentLike.body?.appendChild?.(host);
    if (typeof host.select === "function") host.select();
    if (typeof host.setSelectionRange === "function") host.setSelectionRange(0, host.value.length);
    documentLike.addEventListener?.("copy", onCopy, true);
    const commandResult = documentLike.execCommand("copy");
    return Boolean(copyHandled || commandResult);
  } catch {
    return false;
  } finally {
    documentLike.removeEventListener?.("copy", onCopy, true);
    if (host) {
      documentLike.body?.removeChild?.(host);
    }
  }
}

function normalizeSelectionNode(node: unknown): any {
  if (!node || typeof node !== 'object') return null;
  const maybeNode = node as any;
  if (typeof maybeNode.nodeType === 'number' && maybeNode.nodeType === 3) {
    return maybeNode.parentNode || null;
  }
  return maybeNode;
}

export function copyPlainTextSelectionFromElement(
  event: { clipboardData?: { setData?: (type: string, value: string) => void } | null; preventDefault?: () => void } | null | undefined,
  options: {
    root: { contains?: (node: unknown) => boolean } | null | undefined;
    selection:
      | {
          isCollapsed?: boolean;
          toString?: () => string;
          anchorNode?: unknown;
          focusNode?: unknown;
          rangeCount?: number;
          getRangeAt?: (index: number) => { intersectsNode?: (node: unknown) => boolean };
        }
      | null
      | undefined;
  },
): boolean {
  const clipboardData = event?.clipboardData;
  const root = options?.root;
  const selection = options?.selection;
  if (!clipboardData || typeof clipboardData.setData !== 'function' || !root || !selection) return false;
  if (selection.isCollapsed) return false;

  let intersectsRoot = false;
  const rangeCount = Number(selection.rangeCount || 0);
  if (rangeCount > 0 && typeof selection.getRangeAt === 'function') {
    try {
      const range = selection.getRangeAt(0);
      if (range && typeof range.intersectsNode === 'function') {
        intersectsRoot = Boolean(range.intersectsNode(root));
      }
    } catch {
      intersectsRoot = false;
    }
  }

  if (!intersectsRoot && typeof root.contains === 'function') {
    const anchorNode = normalizeSelectionNode(selection.anchorNode);
    const focusNode = normalizeSelectionNode(selection.focusNode);
    intersectsRoot = Boolean(
      (anchorNode && root.contains(anchorNode)) ||
      (focusNode && root.contains(focusNode)),
    );
  }

  if (!intersectsRoot) return false;

  const text = typeof selection.toString === 'function'
    ? String(selection.toString() || '').replace(/\u00a0/g, ' ')
    : '';
  if (!text) return false;

  clipboardData.setData('text/plain', text);
  event?.preventDefault?.();
  return true;
}

export function readSessionStorageFlagBestEffort(
  storage: { getItem?: (key: string) => string | null } | null | undefined,
  key: string,
): boolean {
  try {
    return Boolean(storage?.getItem?.(key));
  } catch (_error) {
    return false;
  }
}

export function writeSessionStorageFlagBestEffort(
  storage: { setItem?: (key: string, value: string) => void } | null | undefined,
  key: string,
  value: string,
): boolean {
  try {
    storage?.setItem?.(key, value);
    return true;
  } catch (_error) {
    return false;
  }
}

export function resolveLinkPreviewSiteName(siteName: unknown, safeUrl: string | null | undefined): string | null {
  const normalizedSiteName = typeof siteName === 'string' && siteName.trim() ? siteName.trim() : null;
  if (normalizedSiteName) return normalizedSiteName;
  if (!safeUrl) return null;
  try {
    return new URL(safeUrl).hostname;
  } catch (_error) {
    return safeUrl;
  }
}

/** Best-effort plain-text copy: execCommand, the async Clipboard API, then a hidden textarea. */
export async function copyTextToClipboard(text) {
    const value = typeof text === 'string' ? text : '';
    if (!value) return false;

    if (writeClipboardDataViaExecCommand(document as unknown as Parameters<typeof writeClipboardDataViaExecCommand>[0], { text: value })) {
        return true;
    }

    if (await writeClipboardTextBestEffort(navigator.clipboard, value)) {
        return true;
    }

    try {
        const textarea = document.createElement('textarea');
        textarea.value = value;
        textarea.setAttribute('readonly', '');
        textarea.style.position = 'fixed';
        textarea.style.opacity = '0';
        textarea.style.pointerEvents = 'none';
        document.body.appendChild(textarea);
        textarea.select();
        textarea.setSelectionRange(0, textarea.value.length);
        const copied = document.execCommand('copy');
        document.body.removeChild(textarea);
        return copied;
    } catch {
        return false;
    }
}
