import {
    EditorView,
    Decoration,
    ViewPlugin,
    RangeSet,
    syntaxTree,
} from '/editor-vendor/codemirror.js';
import type { DecorationSet, ViewUpdate } from '@codemirror/view';
import type { Range } from '@codemirror/state';

class CodeBlockMonospacePlugin {
    decorations: DecorationSet;

    constructor(view: EditorView) {
        this.decorations = this.buildDecorations(view);
    }

    update(update: ViewUpdate) {
        if (update.docChanged || update.viewportChanged || update.selectionSet) {
            this.decorations = this.buildDecorations(update.view);
        }
    }

    private buildDecorations(view: EditorView): DecorationSet {
        const doc = view.state.doc;
        const tree = syntaxTree(view.state);
        const lineNos = new Set<number>();

        for (const { from, to } of view.visibleRanges) {
            tree.iterate({
                from,
                to,
                enter: (node) => {
                    const type = node.type.name;
                    if (type !== 'FencedCode' && type !== 'CodeBlock') return;

                    const startLine = doc.lineAt(node.from).number;
                    const endPos = Math.max(node.from, Math.min(node.to, doc.length) - 1);
                    const endLine = doc.lineAt(endPos).number;

                    for (let ln = startLine; ln <= endLine; ln++) {
                        lineNos.add(ln);
                    }
                },
            });
        }

        const ranges: Range<Decoration>[] = [];
        for (const ln of lineNos) {
            const line = doc.line(ln);
            ranges.push(Decoration.line({ class: 'cm-md-code-raw-line' }).range(line.from));
        }

        return RangeSet.of(ranges, true);
    }
}

export const codeBlockMonospacePlugin = ViewPlugin.fromClass(CodeBlockMonospacePlugin, {
    decorations: (v) => v.decorations,
});
