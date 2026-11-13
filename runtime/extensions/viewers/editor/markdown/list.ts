/**
 * list.ts — List marker styling for Markdown live preview.
 *
 * Replaces raw list markers with styled widgets and normalizes
 * indentation/continuation alignment for nested lists.
 *
 * Fit-gap parity improvements:
 * - Task list items no longer show an extra bullet before the checkbox
 * - Continuation lines align with item text, not marker column
 * - Parent list-item indentation no longer leaks into nested child lists
 *
 * Lezer structure:
 *   BulletList → ListItem → ListMark (dash/star/plus) + content
 *   OrderedList → ListItem → ListMark (number + dot) + content
 *   Nested: BulletList → ListItem → BulletList → ListItem → ...
 */
import { registerDecorator, Decoration, WidgetType } from './live-preview.js';
import type { DecorationEntry, SyntaxNode, EditorView } from './live-preview.js';

class BulletWidget extends WidgetType {
    toDOM(): HTMLElement {
        const el = document.createElement('span');
        el.className = 'cm-md-bullet';
        el.textContent = '•';
        return el;
    }

    eq(): boolean {
        return true;
    }

    ignoreEvent(): boolean {
        return false;
    }
}

class OrderedMarkerWidget extends WidgetType {
    marker: string;

    constructor(marker: string) {
        super();
        this.marker = marker;
    }

    toDOM(): HTMLElement {
        const el = document.createElement('span');
        el.className = 'cm-md-list-number';
        el.textContent = this.marker;
        return el;
    }

    eq(other: OrderedMarkerWidget): boolean {
        return this.marker === other.marker;
    }

    ignoreEvent(): boolean {
        return false;
    }
}

/** Count how many BulletList/OrderedList ancestors this ListItem has. */
function nestingDepth(node: SyntaxNode): number {
    let depth = 0;
    let p = node.parent;
    while (p) {
        if (p.type.name === 'BulletList' || p.type.name === 'OrderedList') {
            depth++;
        }
        p = p.parent;
    }
    // depth >= 1 always (the immediate parent list); nesting starts at 0
    return Math.max(0, depth - 1);
}

function isTaskListItem(node: SyntaxNode): boolean {
    for (let child = node.firstChild; child; child = child.nextSibling) {
        if (child.type.name === 'Task' || child.type.name === 'TaskMarker') return true;
    }
    return false;
}

function firstNestedListStart(node: SyntaxNode): number | null {
    const visit = (current: SyntaxNode): number | null => {
        for (let child = current.firstChild; child; child = child.nextSibling) {
            if ((child.type.name === 'BulletList' || child.type.name === 'OrderedList') && child.from > node.from) {
                return child.from;
            }
            const nested = visit(child);
            if (nested != null) return nested;
        }
        return null;
    };

    return visit(node);
}

/** Pixels of left padding per nesting level. */
const INDENT_PX = 22;
const CONTINUATION_OFFSET_PX = 22;

function listItemDecorator(node: SyntaxNode, view: EditorView): DecorationEntry[] {
    const entries: DecorationEntry[] = [];
    const doc = view.state.doc;
    const depth = nestingDepth(node);
    const taskItem = isTaskListItem(node);

    // Add line-level alignment classes for this item's own content lines.
    // Do NOT include nested child lists (they get their own indentation pass).
    const firstLine = doc.lineAt(node.from);
    const nestedStart = firstNestedListStart(node);
    const contentTo = nestedStart != null ? doc.lineAt(nestedStart).from : node.to;
    const endAnchor = Math.max(firstLine.from, Math.min(doc.length, contentTo) - 1);
    const endLineNo = doc.lineAt(endAnchor).number;
    const cursorLineNo = doc.lineAt(view.state.selection.main.head).number;
    const cursorOwnLines = cursorLineNo >= firstLine.number && cursorLineNo <= endLineNo;

    // Width of the rendered marker, so wrapped text can hang under the item text.
    let hang = '';

    // Find ListMark child.
    for (let child = node.firstChild; child; child = child.nextSibling) {
        if (child.type.name !== 'ListMark') continue;

        const markerText = doc.sliceString(child.from, child.to).trim();
        const lineStart = doc.lineAt(child.from).from;

        // Hide raw indentation before marker; indentation is re-applied via line classes.
        if (lineStart < child.from) {
            entries.push({
                from: lineStart,
                to: child.from,
                decoration: Decoration.replace({}),
            });
        }

        // Consume one post-marker space when present so widget spacing is consistent.
        let markerEnd = child.to;
        if (markerEnd < doc.length && doc.sliceString(markerEnd, markerEnd + 1) === ' ') {
            markerEnd++;
        }

        if (!cursorOwnLines) {
            if (markerText === '-' || markerText === '*' || markerText === '+') {
                hang = taskItem ? 'var(--cm-md-list-task-width)' : 'var(--cm-md-list-marker-width)';
                if (taskItem) {
                    // Task lists should show only checkbox + text (no extra bullet marker).
                    entries.push({
                        from: child.from,
                        to: markerEnd,
                        decoration: Decoration.replace({}),
                    });
                } else {
                    entries.push({
                        from: child.from,
                        to: markerEnd,
                        decoration: Decoration.replace({
                            widget: new BulletWidget(),
                        }),
                    });
                }
            } else if (/^\d+\.$/.test(markerText)) {
                hang = 'var(--cm-md-list-number-width)';
                entries.push({
                    from: child.from,
                    to: markerEnd,
                    decoration: Decoration.replace({
                        widget: new OrderedMarkerWidget(markerText),
                    }),
                });
            }
        }

        break;
    }

    const baseStyle = `--cm-md-list-indent: ${depth * INDENT_PX}px; --cm-md-list-continuation: ${CONTINUATION_OFFSET_PX}px;`;

    for (let ln = firstLine.number; ln <= endLineNo; ln++) {
        const line = doc.line(ln);
        const continuation = ln > firstLine.number;
        let cls = continuation
            ? 'cm-md-list-item-line cm-md-list-item-continuation'
            : 'cm-md-list-item-line';
        if (taskItem) cls += ' cm-md-list-item-task';
        if (!continuation && hang) cls += ' cm-md-list-item-hang';

        entries.push({
            from: line.from,
            to: line.from,
            decoration: Decoration.line({
                class: cls,
                attributes: { style: !continuation && hang ? `${baseStyle} --cm-md-list-hang: ${hang};` : baseStyle },
            }),
        });
    }

    return entries;
}

registerDecorator('ListItem', listItemDecorator);
