/**
 * checkbox.ts — Clickable task checkbox widget.
 *
 * Replaces `- [ ]` and `- [x]` task markers with a clickable checkbox.
 * Clicking dispatches a CM6 transaction to toggle the marker.
 *
 * Lezer structure:
 *   ListItem → (TaskMarker)? + content
 *   Task contains TaskMarker child
 */
import { registerDecorator, Decoration, WidgetType, forceLivePreviewRebuild } from './live-preview.js';
import type { DecorationEntry, SyntaxNode, EditorView } from './live-preview.js';

class CheckboxWidget extends WidgetType {
    checked: boolean;
    pos: number; // position of `[` in the document

    constructor(checked: boolean, pos: number) {
        super();
        this.checked = checked;
        this.pos = pos;
    }

    toDOM(view: EditorView): HTMLElement {
        const input = document.createElement('input');
        input.type = 'checkbox';
        input.checked = this.checked;
        input.className = 'cm-md-checkbox';
        input.addEventListener('mousedown', (e) => {
            e.preventDefault();
            // Toggle: replace [ ] with [x] or [x] with [ ]
            const newText = this.checked ? '[ ]' : '[x]';
            view.dispatch({
                changes: { from: this.pos, to: this.pos + 3, insert: newText },
                effects: forceLivePreviewRebuild.of(),
            });
        });
        return input;
    }

    eq(other: CheckboxWidget): boolean {
        return this.checked === other.checked && this.pos === other.pos;
    }

    ignoreEvent(): boolean {
        return false;
    }
}

function taskDecorator(node: SyntaxNode, view: EditorView): DecorationEntry[] {
    const entries: DecorationEntry[] = [];
    const doc = view.state.doc;

    // Find TaskMarker child
    for (let child = node.firstChild; child; child = child.nextSibling) {
        if (child.type.name === 'TaskMarker') {
            const text = doc.sliceString(child.from, child.to);
            const checked = text.includes('x') || text.includes('X');

            // Replace the TaskMarker (and one following space, as list markers do)
            // with a checkbox widget, so wrapped text can hang under the item text.
            const markerEnd = doc.sliceString(child.to, child.to + 1) === ' ' ? child.to + 1 : child.to;
            entries.push({
                from: child.from,
                to: markerEnd,
                decoration: Decoration.replace({
                    widget: new CheckboxWidget(checked, child.from),
                }),
            });

            // Obsidian parity: checked tasks show dimmed + struck text in preview.
            if (checked) {
                const line = doc.lineAt(node.from);
                const textFrom = Math.min(child.to, line.to);
                if (textFrom < line.to) {
                    entries.push({
                        from: textFrom,
                        to: line.to,
                        decoration: Decoration.mark({ class: 'cm-md-task-checked-text' }),
                    });
                }
            }
            break;
        }
    }

    return entries;
}

registerDecorator('Task', taskDecorator);
