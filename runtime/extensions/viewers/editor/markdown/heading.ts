/**
 * heading.ts — Heading decorations for Markdown live preview.
 *
 * Hides `#` marks and applies font size styling based on heading level.
 * Adds fold affordance for collapsing/expanding heading sections.
 *
 * ATXHeading1–6 nodes contain HeaderMark children (the `#` symbols).
 */
import { registerDecorator, Decoration, WidgetType, cursorInRange, forceLivePreviewRebuild } from './live-preview.js';
import type { DecorationEntry, SyntaxNode, EditorView } from './live-preview.js';

const HEADING_CLASSES: Record<string, string> = {
    ATXHeading1: 'cm-md-h1',
    ATXHeading2: 'cm-md-h2',
    ATXHeading3: 'cm-md-h3',
    ATXHeading4: 'cm-md-h4',
    ATXHeading5: 'cm-md-h5',
    ATXHeading6: 'cm-md-h6',
};

const HEADING_LINE_CLASSES: Record<string, string> = {
    ATXHeading1: 'cm-md-h-line cm-md-h1-line',
    ATXHeading2: 'cm-md-h-line cm-md-h2-line',
    ATXHeading3: 'cm-md-h-line cm-md-h3-line',
    ATXHeading4: 'cm-md-h-line cm-md-h4-line',
    ATXHeading5: 'cm-md-h-line cm-md-h5-line',
    ATXHeading6: 'cm-md-h-line cm-md-h6-line',
};

const HEADING_LEVELS: Record<string, number> = {
    ATXHeading1: 1,
    ATXHeading2: 2,
    ATXHeading3: 3,
    ATXHeading4: 4,
    ATXHeading5: 5,
    ATXHeading6: 6,
};

const collapsedHeadingStarts = new Set<number>();

const CHEVRON_RIGHT = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"></polyline></svg>';
const CHEVRON_DOWN = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg>';

class HeadingFoldWidget extends WidgetType {
    headingFrom: number;
    collapsed: boolean;

    constructor(headingFrom: number, collapsed: boolean) {
        super();
        this.headingFrom = headingFrom;
        this.collapsed = collapsed;
    }

    toDOM(view: EditorView): HTMLElement {
        const btn = document.createElement('span');
        btn.className = this.collapsed
            ? 'cm-md-heading-fold cm-md-heading-fold-collapsed'
            : 'cm-md-heading-fold';
        btn.setAttribute('role', 'button');
        btn.setAttribute('tabindex', '0');
        btn.setAttribute('aria-label', this.collapsed ? 'Expand section' : 'Collapse section');
        btn.innerHTML = this.collapsed ? CHEVRON_RIGHT : CHEVRON_DOWN;

        const toggle = () => {
            if (collapsedHeadingStarts.has(this.headingFrom)) {
                collapsedHeadingStarts.delete(this.headingFrom);
            } else {
                collapsedHeadingStarts.add(this.headingFrom);
            }
            // Keyboard toggles have no pointer-release transaction to refresh them.
            view.dispatch({ effects: forceLivePreviewRebuild.of() });
        };

        btn.addEventListener('mousedown', (e) => {
            e.preventDefault();
            e.stopPropagation();
        });
        btn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            toggle();
        });
        btn.addEventListener('keydown', (e) => {
            if (e.key !== 'Enter' && e.key !== ' ') return;
            e.preventDefault();
            e.stopPropagation();
            toggle();
        });

        return btn;
    }

    eq(other: HeadingFoldWidget): boolean {
        return this.headingFrom === other.headingFrom && this.collapsed === other.collapsed;
    }

    ignoreEvent(): boolean {
        return false;
    }
}

function findSectionEndPos(doc: any, headingLineNo: number, headingLevel: number): number {
    for (let ln = headingLineNo + 1; ln <= doc.lines; ln++) {
        const text = doc.line(ln).text;
        const m = text.match(/^\s{0,3}(#{1,6})\s+/);
        if (!m) continue;
        const nextLevel = m[1].length;
        if (nextLevel <= headingLevel) {
            return doc.line(ln).from;
        }
    }
    return doc.length;
}

/** Whether a document position falls inside a collapsed heading body. */
export function isPositionInCollapsedHeadingBody(doc: any, pos: number): boolean {
    for (const headingFrom of collapsedHeadingStarts) {
        if (headingFrom < 0 || headingFrom > doc.length) continue;

        const line = doc.lineAt(Math.min(headingFrom, doc.length));
        const m = line.text.match(/^\s{0,3}(#{1,6})\s+/);
        if (!m) continue;

        const level = m[1].length;
        if (line.number >= doc.lines) continue;

        const contentFrom = doc.line(line.number + 1).from;
        const contentTo = findSectionEndPos(doc, line.number, level);
        if (pos >= contentFrom && pos < contentTo) return true;
    }
    return false;
}

function headingDecorator(node: SyntaxNode, view: EditorView): DecorationEntry[] {
    const entries: DecorationEntry[] = [];
    const cls = HEADING_CLASSES[node.type.name];
    const lineCls = HEADING_LINE_CLASSES[node.type.name];
    const headingLevel = HEADING_LEVELS[node.type.name] || 6;
    if (!cls || !lineCls) return entries;

    const doc = view.state.doc;
    const collapsed = collapsedHeadingStarts.has(node.from);
    const headingLine = doc.lineAt(node.from);
    const cursorOnHeadingLine = cursorInRange(view, headingLine.from, headingLine.to);

    // Find the HeaderMark child (the `# ` prefix)
    let markEnd = node.from;
    const firstChild = node.firstChild;
    if (firstChild && firstChild.type.name === 'HeaderMark') {
        const afterMark = firstChild.to;
        let hideEnd = afterMark;
        const lineText = doc.sliceString(afterMark, Math.min(afterMark + 2, node.to));
        if (lineText.startsWith(' ')) hideEnd = afterMark + 1;

        // Keep raw heading marker while the cursor is on this heading line,
        // but keep fold affordance in read mode.
        if (!cursorOnHeadingLine) {
            entries.push({
                from: firstChild.from,
                to: hideEnd,
                decoration: Decoration.replace({
                    widget: new HeadingFoldWidget(node.from, collapsed),
                }),
            });
            markEnd = hideEnd;
        }
    } else if (!cursorOnHeadingLine) {
        // Safety fallback if parser shape differs.
        entries.push({
            from: node.from,
            to: node.from,
            decoration: Decoration.widget({
                widget: new HeadingFoldWidget(node.from, collapsed),
                side: -1,
            }),
        });
    }

    // Apply heading line spacing class (+ collapsed marker class).
    entries.push({
        from: node.from,
        to: node.from,
        decoration: Decoration.line({ class: collapsed ? `${lineCls} cm-md-h-collapsed` : lineCls }),
    });

    // Apply heading text style in read mode only.
    if (!cursorOnHeadingLine && markEnd < node.to) {
        entries.push({
            from: markEnd,
            to: node.to,
            decoration: Decoration.mark({ class: cls }),
        });
    }

    // Collapsed headings hide following section content until next heading
    // of the same or higher level.
    if (collapsed) {
        if (headingLine.number < doc.lines) {
            const contentFrom = doc.line(headingLine.number + 1).from;
            const contentTo = findSectionEndPos(doc, headingLine.number, headingLevel);
            if (contentFrom < contentTo) {
                const endLine = doc.lineAt(Math.max(contentFrom, contentTo - 1)).number;
                for (let ln = headingLine.number + 1; ln <= endLine; ln++) {
                    const line = doc.line(ln);
                    entries.push({
                        from: line.from,
                        to: line.from,
                        decoration: Decoration.line({ class: 'cm-md-heading-collapsed-line' }),
                    });
                }
            }
        }
    }

    return entries;
}

// Register for all heading levels.
for (const type of Object.keys(HEADING_CLASSES)) {
    registerDecorator(type, headingDecorator);
}
