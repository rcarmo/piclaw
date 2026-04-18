/**
 * live-preview.ts — Core cursor-aware decoration engine for Markdown live preview.
 *
 * Walks the visible syntax tree and applies decorations to Markdown nodes.
 * When the cursor is inside a node's line, that node shows raw Markdown.
 * When the cursor is elsewhere, formatting marks are hidden and content
 * is rendered with visual styles.
 *
 * Each Markdown feature registers a "decorator" function that receives
 * a syntax node and returns decorations. The engine orchestrates calling
 * them and managing the cursor-aware visibility logic.
 */
import {
    EditorView,
    Decoration,
    ViewPlugin,
    WidgetType,
    RangeSet,
    syntaxTree,
} from '/editor-vendor/codemirror.js';
import type { DecorationSet, ViewUpdate } from '@codemirror/view';
import type { Range } from '@codemirror/state';
import type { SyntaxNode } from '@lezer/common';
import { isAlwaysDecoratedNode, usesBlockCursorGate } from './cursor-gating.js';

// ── Types ───────────────────────────────────────────────────────

export interface DecorationEntry {
    from: number;
    to: number;
    decoration: Decoration;
}

/**
 * A decorator function receives a node and the document text,
 * and returns decorations to apply when the cursor is NOT on that line.
 */
export type NodeDecorator = (
    node: SyntaxNode,
    view: EditorView,
) => DecorationEntry[];

// ── Decorator registry ──────────────────────────────────────────

const decorators = new Map<string, NodeDecorator>();

/**
 * Register a decorator for a specific lezer node type name.
 */
export function registerDecorator(nodeType: string, decorator: NodeDecorator): void {
    decorators.set(nodeType, decorator);
}

// ── Utility: check if cursor is in a range ──────────────────────

export function cursorInRange(view: EditorView, from: number, to: number): boolean {
    const sel = view.state.selection;
    for (const range of sel.ranges) {
        if (range.head >= from && range.head <= to) return true;
        const selFrom = Math.min(range.anchor, range.head);
        const selTo = Math.max(range.anchor, range.head);
        if (selFrom <= to && selTo >= from) return true;
    }
    return false;
}

// ── ViewPlugin ──────────────────────────────────────────────────

class LivePreviewPlugin {
    decorations: DecorationSet;

    constructor(view: EditorView) {
        this.decorations = this.buildDecorations(view);
    }

    update(update: ViewUpdate) {
        if (
            update.docChanged ||
            update.selectionSet ||
            update.viewportChanged ||
            update.transactions.length > 0
        ) {
            this.decorations = this.buildDecorations(update.view);
        }
    }

    private buildDecorations(view: EditorView): DecorationSet {
        const tree = syntaxTree(view.state);
        const entries: DecorationEntry[] = [];

        for (const { from, to } of view.visibleRanges) {
            tree.iterate({
                from,
                to,
                enter(node) {
                    const decorator = decorators.get(node.type.name);
                    if (!decorator) return;

                    const isFrontmatter = node.type.name === 'FrontMatter';
                    const isBlock = usesBlockCursorGate(node.type.name);
                    const alwaysDecorate = isAlwaysDecoratedNode(node.type.name);

                    if (!isFrontmatter && !alwaysDecorate) {
                        if (isBlock) {
                            // For block nodes: check if cursor's LINE is inside the block.
                            // Use line-level granularity so only the active line shows raw MD,
                            // not the entire multi-line block.
                            const cursorLine = view.state.doc.lineAt(view.state.selection.main.head);
                            if (cursorLine.from >= node.from && cursorLine.from <= node.to) {
                                return;
                            }
                        } else {
                            // For inline nodes: check if cursor is on the same line
                            const checkFrom = view.state.doc.lineAt(node.from).from;
                            const checkTo = view.state.doc.lineAt(node.to).to;
                            if (cursorInRange(view, checkFrom, checkTo)) return;
                        }
                    }

                    const decos = decorator(node.node, view);
                    entries.push(...decos);
                },
            });
        }

        // Convert entries to Range<Decoration> and use RangeSet.of()
        // which handles sorting automatically (unlike RangeSetBuilder).
        const ranges: Range<Decoration>[] = [];
        for (const entry of entries) {
            if (entry.from > entry.to) continue; // skip invalid (but allow point decos: from === to)
            try {
                if (entry.from === entry.to) {
                    // Point decoration (e.g. Decoration.line())
                    ranges.push(entry.decoration.range(entry.from));
                } else {
                    ranges.push(entry.decoration.range(entry.from, entry.to));
                }
            } catch (error) {
                console.warn('[editor/live-preview] skipped invalid decoration range', {
                    from: entry.from,
                    to: entry.to,
                    error: error instanceof Error ? error.message : String(error || 'Unknown error'),
                });
            }
        }

        return RangeSet.of(ranges, true);
    }
}

/**
 * The ViewPlugin for live preview. Import and add to extensions array.
 */
export const livePreviewPlugin = ViewPlugin.fromClass(LivePreviewPlugin, {
    decorations: (v) => v.decorations,
});

// ── Re-exports for decorator implementations ───────────────────

export { Decoration, WidgetType };
export type { EditorView, SyntaxNode };
