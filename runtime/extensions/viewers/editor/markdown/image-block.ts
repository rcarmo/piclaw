import {
    Decoration,
    EditorView,
    StateField,
    WidgetType,
    syntaxTree,
} from '#editor-vendor/codemirror';
import type { DecorationSet, EditorState, Extension, Range, Transaction } from '#editor-vendor/codemirror';
import type { SyntaxNode } from '@lezer/common';
import { rewriteWorkspaceMarkdownImageSrc } from '../../../../web/src/ui/workspace-markdown-image.js';
import { normalizeLinkHref } from './link.js';
import { treeGrowthEffect, treeProgressPlugin } from './tree-progress.js';

const imageDimensionCache = new Map<string, { width: number; height: number }>();

export function parseMarkdownImageSource(raw: string): { alt: string; url: string } | null {
    const match = raw.match(/^!\[([^\]]*)\]\(([^\s)"']+)(?:\s+["'][^)]*["'])?\)$/);
    if (!match) return null;
    const [, alt, url] = match;
    if (!url) return null;
    return { alt, url };
}

class ImageBlockWidget extends WidgetType {
    constructor(readonly url: string, readonly alt: string, readonly markdownPath: string) {
        super();
    }

    eq(other: ImageBlockWidget): boolean {
        return this.url === other.url
            && this.alt === other.alt
            && this.markdownPath === other.markdownPath;
    }

    toDOM(view: EditorView): HTMLElement {
        const wrapper = document.createElement('figure');
        wrapper.className = 'cm-md-image-wrap cm-md-image-block';

        const img = document.createElement('img');
        img.className = 'cm-md-image';
        img.alt = this.alt;
        img.loading = 'lazy';
        img.decoding = 'async';

        const href = normalizeLinkHref(rewriteWorkspaceMarkdownImageSrc(this.url, this.markdownPath));
        if (href) {
            img.src = href;
            const cached = imageDimensionCache.get(href);
            if (cached) {
                img.width = cached.width;
                img.height = cached.height;
            } else {
                img.addEventListener('load', () => {
                    if (img.naturalWidth > 0 && img.naturalHeight > 0) {
                        imageDimensionCache.set(href, {
                            width: img.naturalWidth,
                            height: img.naturalHeight,
                        });
                    }
                });
            }
        } else {
            img.removeAttribute('src');
            img.classList.add('cm-md-image-invalid');
        }

        img.addEventListener('mousedown', (event) => {
            event.preventDefault();
            event.stopPropagation();
            const pos = view.posAtDOM(wrapper);
            if (pos < 0) return;
            view.focus();
            view.dispatch({ selection: { anchor: Math.max(0, pos - 1) }, scrollIntoView: false });
        });
        img.addEventListener('click', (event) => {
            event.preventDefault();
            event.stopPropagation();
            if (!href) return;
            window.open(href, '_blank', 'noopener,noreferrer');
        });
        img.onerror = () => {
            img.remove();
            const fallback = document.createElement('span');
            fallback.className = 'cm-md-image-fallback';
            fallback.textContent = this.alt ? `[Image: ${this.alt}]` : '[Image unavailable]';
            wrapper.appendChild(fallback);
        };

        wrapper.appendChild(img);

        if (this.alt.trim()) {
            const caption = document.createElement('figcaption');
            caption.className = 'cm-md-image-caption';
            caption.textContent = this.alt;
            wrapper.appendChild(caption);
        }

        return wrapper;
    }

    ignoreEvent(event: Event): boolean {
        return event.type === 'mousedown' || event.type === 'click';
    }
}

function imageIsInsideTable(node: SyntaxNode): boolean {
    for (let parent = node.parent; parent; parent = parent.parent) {
        if (parent.name === 'Table') return true;
    }
    return false;
}

interface DocumentRange {
    from: number;
    to: number;
}

function expandedLineRange(state: EditorState, from: number, to: number): DocumentRange {
    const safeFrom = Math.max(0, Math.min(from, state.doc.length));
    const safeTo = Math.max(safeFrom, Math.min(to, state.doc.length));
    const first = state.doc.lineAt(safeFrom);
    const last = state.doc.lineAt(safeTo);
    const firstLine = state.doc.line(Math.max(1, first.number - 1));
    const lastLine = state.doc.line(Math.min(state.doc.lines, last.number + 1));
    return { from: firstLine.from, to: lastLine.to };
}

function changedLineRanges(transaction: Transaction): DocumentRange[] {
    const ranges: DocumentRange[] = [];
    transaction.changes.iterChanges((_fromA, _toA, fromB, toB) => {
        ranges.push(expandedLineRange(transaction.state, fromB, toB));
    });
    return ranges;
}

function imageBlockRanges(
    state: EditorState,
    markdownPath: string,
    scanRanges?: readonly DocumentRange[],
): Range<Decoration>[] {
    const ranges: Range<Decoration>[] = [];
    const seen = new Set<string>();
    const scans = scanRanges?.length ? scanRanges : [{ from: 0, to: state.doc.length }];

    for (const scan of scans) {
        syntaxTree(state).iterate({
            from: scan.from,
            to: scan.to,
            enter(node) {
                if (node.name !== 'Image' || imageIsInsideTable(node.node)) return;
                const key = `${node.from}:${node.to}`;
                if (seen.has(key)) return;
                seen.add(key);

                const parsed = parseMarkdownImageSource(state.doc.sliceString(node.from, node.to));
                if (!parsed) return;

                const line = state.doc.lineAt(node.from);
                ranges.push(Decoration.widget({
                    widget: new ImageBlockWidget(parsed.url, parsed.alt, markdownPath),
                    block: true,
                    side: 1,
                }).range(line.to));
            },
        });
    }
    return ranges;
}

function buildImageBlocks(state: EditorState, markdownPath: string): DecorationSet {
    return Decoration.set(imageBlockRanges(state, markdownPath), true);
}

function refreshImageBlocks(
    decorations: DecorationSet,
    state: EditorState,
    markdownPath: string,
    scanRanges: readonly DocumentRange[],
): DecorationSet {
    if (!scanRanges.length) return decorations;
    return decorations.update({
        filter: (from, to) => !scanRanges.some((scan) => from <= scan.to && to >= scan.from),
        add: imageBlockRanges(state, markdownPath, scanRanges),
        sort: true,
    });
}

export function imageBlocks(markdownPath = ''): Extension {
    const imageBlockField = StateField.define<DecorationSet>({
        create: (state) => buildImageBlocks(state, markdownPath),
        update(decorations, transaction) {
            for (const effect of transaction.effects) {
                if (effect.is(treeGrowthEffect)) {
                    return refreshImageBlocks(decorations, transaction.state, markdownPath, [
                        expandedLineRange(transaction.state, effect.value.from, effect.value.to),
                    ]);
                }
            }
            if (!transaction.docChanged) return decorations;
            return refreshImageBlocks(
                decorations.map(transaction.changes),
                transaction.state,
                markdownPath,
                changedLineRanges(transaction),
            );
        },
        provide: (field) => EditorView.decorations.from(field),
    });
    return [imageBlockField, treeProgressPlugin];
}
