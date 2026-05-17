export interface HighlightRange {
  color: string;
  startOffset: number;
  endOffset: number;
  text: string;
}

export const HIGHLIGHT_COLORS = [
  "#4a9e4a80", // green
  "#c9a83b80", // yellow
  "#c94e4e80", // red
  "#4a7ec980", // blue
  "#9e4ac980", // purple
];

/** Walk all text nodes in container, returning them with cumulative offsets. */
function getTextNodes(container: HTMLElement): { node: Text; start: number }[] {
  const result: { node: Text; start: number }[] = [];
  let offset = 0;
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
  let node: Node | null;
  while ((node = walker.nextNode())) {
    const text = node as Text;
    result.push({ node: text, start: offset });
    offset += text.length;
  }
  return result;
}

/** Convert a DOM Selection to character offsets relative to container's text content. */
export function serializeSelection(
  container: HTMLElement,
  selection: Selection
): { startOffset: number; endOffset: number; text: string } | null {
  if (!selection.rangeCount) return null;
  const range = selection.getRangeAt(0);
  if (range.collapsed) return null;

  // Ensure both endpoints are inside container
  if (!container.contains(range.startContainer) || !container.contains(range.endContainer)) {
    return null;
  }

  const textNodes = getTextNodes(container);

  let startOffset = -1;
  let endOffset = -1;

  for (const { node, start } of textNodes) {
    if (node === range.startContainer) {
      startOffset = start + range.startOffset;
    }
    if (node === range.endContainer) {
      endOffset = start + range.endOffset;
    }
  }

  if (startOffset === -1 || endOffset === -1) return null;
  if (startOffset >= endOffset) return null;

  return {
    startOffset,
    endOffset,
    text: selection.toString(),
  };
}

/** Remove all highlight marks from container. */
export function clearHighlights(container: HTMLElement): void {
  const marks = container.querySelectorAll("mark[data-highlight]");
  for (const mark of marks) {
    const parent = mark.parentNode;
    if (!parent) continue;
    while (mark.firstChild) {
      parent.insertBefore(mark.firstChild, mark);
    }
    parent.removeChild(mark);
  }
  container.normalize();
}

/** Apply an array of HighlightRange objects to the container as <mark> elements. */
export function applyHighlights(container: HTMLElement, highlights: HighlightRange[]): void {
  if (!highlights.length) return;

  // Sort descending so we apply from end to start (preserves offsets)
  const sorted = [...highlights].sort((a, b) => b.startOffset - a.startOffset);

  for (const hl of sorted) {
    applyOneHighlight(container, hl);
  }
}

function wrapPartOfTextNode(node: Text, start: number, end: number, color: string): void {
  const len = node.textContent?.length ?? 0;
  const clampedEnd = Math.min(end, len);
  if (start >= clampedEnd) return;

  const range = document.createRange();
  range.setStart(node, start);
  range.setEnd(node, clampedEnd);

  const mark = document.createElement("mark");
  mark.setAttribute("data-highlight", "");
  mark.style.background = color;
  mark.style.borderRadius = "2px";
  mark.style.padding = "0 1px";

  try {
    range.surroundContents(mark);
  } catch {
    // Range spans element boundaries — extract and rewrap
    const fragment = range.extractContents();
    mark.appendChild(fragment);
    range.insertNode(mark);
  }
}

function applyOneHighlight(container: HTMLElement, hl: HighlightRange): void {
  // Collect text nodes once; surroundContents keeps node references valid
  const textNodes = getTextNodes(container);
  let remaining = hl.endOffset - hl.startOffset;
  let started = false;

  for (const { node, start } of textNodes) {
    // Skip nodes already wrapped in a highlight span (avoid double-wrapping)
    if (node.parentElement?.closest("mark[data-highlight]")) continue;

    const nodeLen = node.length;
    const nodeEnd = start + nodeLen;

    if (!started) {
      if (hl.startOffset >= start && hl.startOffset < nodeEnd) {
        started = true;
        const localStart = hl.startOffset - start;
        const localEnd = Math.min(nodeLen, localStart + remaining);
        const wrapped = localEnd - localStart;
        wrapPartOfTextNode(node, localStart, localEnd, hl.color);
        remaining -= wrapped;
        if (remaining <= 0) return;
      }
    } else {
      if (start >= hl.endOffset) break;
      const localEnd = Math.min(nodeLen, remaining);
      wrapPartOfTextNode(node, 0, localEnd, hl.color);
      remaining -= localEnd;
      if (remaining <= 0) return;
    }
  }
}
