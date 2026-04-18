import { keymap, Prec } from '/editor-vendor/codemirror.js';
import type { EditorView } from './live-preview.js';
import { isPositionInCollapsedHeadingBody } from './heading.js';

function moveByDocumentLine(direction: -1 | 1) {
    return (view: EditorView): boolean => {
        const state = view.state;
        const main = state.selection.main;
        const currentLine = state.doc.lineAt(main.head);
        const goalColumn = main.head - currentLine.from;

        let lineNo = currentLine.number + direction;
        while (lineNo >= 1 && lineNo <= state.doc.lines) {
            const candidate = state.doc.line(lineNo);
            if (!isPositionInCollapsedHeadingBody(state.doc, candidate.from)) {
                const targetPos = Math.min(candidate.from + goalColumn, candidate.to);
                view.dispatch({
                    selection: { anchor: targetPos, head: targetPos },
                    scrollIntoView: true,
                    userEvent: 'select.move',
                });
                return true;
            }
            lineNo += direction;
        }

        return false;
    };
}

export const livePreviewCursorNav = Prec.highest(
    keymap.of([
        { key: 'ArrowDown', run: moveByDocumentLine(1) },
        { key: 'ArrowUp', run: moveByDocumentLine(-1) },
    ]),
);
