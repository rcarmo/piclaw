/**
 * blockquote.ts — Blockquote and callout decorations.
 *
 * Standard blockquotes get a styled left border.
 * Obsidian-style callouts (`> [!note]`, `> [!warning]`, etc.) get
 * coloured styling based on the callout type.
 *
 * Lezer structure (note: QuoteMark is inside Paragraph, not direct child):
 *   Blockquote → Paragraph → QuoteMark(>) + text content
 *
 * Callout detection is content-based: first line starts with `[!type]`.
 */
import { registerDecorator, Decoration, WidgetType } from './live-preview.js';
import type { DecorationEntry, SyntaxNode, EditorView } from './live-preview.js';
import { parseBlockquoteLead, shouldDecorateBlockquote } from './blockquote-utils.js';

/** Widget that renders a callout SVG icon + optional title prefix. */
class CalloutIconWidget extends WidgetType {
    iconName: string;
    title: string;
    foldState: 'none' | 'expanded' | 'collapsed';
    markerPos: number;

    constructor(
        iconName: string,
        title: string,
        foldState: 'none' | 'expanded' | 'collapsed' = 'none',
        markerPos = -1,
    ) {
        super();
        this.iconName = iconName;
        this.title = title;
        this.foldState = foldState;
        this.markerPos = markerPos;
    }

    toDOM(view: EditorView): HTMLElement {
        const span = document.createElement('span');
        span.className = 'cm-md-callout-title';

        const fold = document.createElement('span');
        fold.className = 'cm-md-callout-fold-icon';
        fold.setAttribute('role', 'button');
        fold.setAttribute('tabindex', '0');
        fold.setAttribute(
            'aria-label',
            this.foldState === 'collapsed' ? 'Expand callout' : 'Collapse callout',
        );
        fold.innerHTML =
            this.foldState === 'collapsed'
                ? CALLOUT_SVG_ICONS['chevron-right']
                : CALLOUT_SVG_ICONS['chevron-down'];

        const toggle = () => {
            if (this.markerPos < 0) return;
            const current = view.state.doc.sliceString(this.markerPos, this.markerPos + 1);

            // Existing marker: toggle it.
            if (current === '+' || current === '-') {
                const next = current === '-' ? '+' : '-';
                view.dispatch({
                    changes: { from: this.markerPos, to: this.markerPos + 1, insert: next },
                });
                return;
            }

            // No marker present: make it collapsible and collapse on first toggle.
            view.dispatch({
                changes: { from: this.markerPos, to: this.markerPos, insert: '-' },
            });
        };

        fold.addEventListener('mousedown', (e) => {
            e.preventDefault();
            e.stopPropagation();
            toggle();
        });
        fold.addEventListener('keydown', (e) => {
            if (e.key !== 'Enter' && e.key !== ' ') return;
            e.preventDefault();
            e.stopPropagation();
            toggle();
        });

        span.appendChild(fold);

        const icon = document.createElement('span');
        icon.className = 'cm-md-callout-icon';
        icon.setAttribute('aria-hidden', 'true');
        icon.innerHTML = CALLOUT_SVG_ICONS[this.iconName] || CALLOUT_SVG_ICONS['gh-info'];
        span.appendChild(icon);

        if (this.title) {
            const label = document.createElement('span');
            label.className = 'cm-md-callout-title-label';
            label.textContent = this.title;
            span.appendChild(label);
        }

        return span;
    }

    eq(other: CalloutIconWidget): boolean {
        return this.iconName === other.iconName
            && this.title === other.title
            && this.foldState === other.foldState
            && this.markerPos === other.markerPos;
    }

    ignoreEvent(): boolean {
        return false;
    }
}

/** Callout type → accent colour (CSS variable fallback). */
const CALLOUT_COLORS: Record<string, string> = {
    note: 'var(--accent-color, #1d9bf0)',
    info: 'var(--accent-color, #1d9bf0)',
    tip: 'var(--success-color)',
    hint: 'var(--success-color)',
    important: 'var(--accent-color)',
    warning: 'var(--warning-color)',
    caution: 'var(--warning-color)',
    danger: 'var(--danger-color)',
    error: 'var(--danger-color)',
    bug: 'var(--danger-color)',
    example: 'var(--accent-color)',
    quote: 'var(--text-secondary)',
    cite: 'var(--text-secondary)',
    abstract: 'var(--accent-color)',
    summary: 'var(--accent-color)',
    tldr: 'var(--accent-color)',
    success: 'var(--success-color)',
    check: 'var(--success-color)',
    done: 'var(--success-color)',
    question: 'var(--warning-color)',
    help: 'var(--warning-color)',
    faq: 'var(--warning-color)',
    fail: 'var(--danger-color)',
    failure: 'var(--danger-color)',
    missing: 'var(--danger-color)',
};

/** Callout type → SVG icon name. */
const CALLOUT_ICON_NAMES: Record<string, string> = {
    // GitHub alert icon set parity:
    // NOTE/INFO -> info, TIP -> light-bulb, IMPORTANT -> report,
    // WARNING -> alert, CAUTION(+danger-ish aliases) -> stop
    note: 'gh-info',
    info: 'gh-info',
    tip: 'gh-tip',
    hint: 'gh-tip',
    success: 'gh-tip',
    check: 'gh-tip',
    done: 'gh-tip',
    important: 'gh-important',
    example: 'gh-important',
    abstract: 'gh-important',
    summary: 'gh-important',
    tldr: 'gh-important',
    warning: 'gh-warning',
    question: 'gh-warning',
    help: 'gh-warning',
    faq: 'gh-warning',
    caution: 'gh-caution',
    danger: 'gh-caution',
    error: 'gh-caution',
    bug: 'gh-caution',
    fail: 'gh-caution',
    failure: 'gh-caution',
    missing: 'gh-caution',
    quote: 'gh-info',
    cite: 'gh-info',
};

function defaultCalloutTitle(type: string): string {
    return type
        .split(/[-_]+/)
        .filter(Boolean)
        .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
        .join(' ');
}

/**
 * Inline SVG icons (stroke uses currentColor so icon follows callout color).
 * 16x16 keeps sizing close to Obsidian's title icon scale.
 */
const CALLOUT_SVG_ICONS: Record<string, string> = {
    // Exact Octicons (GitHub) symbols for markdown alerts.
    'gh-info': '<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" fill="currentColor"><path d="M0 8a8 8 0 1 1 16 0A8 8 0 0 1 0 8Zm8-6.5a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13ZM6.5 7.75A.75.75 0 0 1 7.25 7h1a.75.75 0 0 1 .75.75v2.75h.25a.75.75 0 0 1 0 1.5h-2a.75.75 0 0 1 0-1.5h.25v-2h-.25a.75.75 0 0 1-.75-.75ZM8 6a1 1 0 1 1 0-2 1 1 0 0 1 0 2Z"/></svg>',
    'gh-tip': '<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" fill="currentColor"><path d="M8 1.5c-2.363 0-4 1.69-4 3.75 0 .984.424 1.625.984 2.304l.214.253c.223.264.47.556.673.848.284.411.537.896.621 1.49a.75.75 0 0 1-1.484.211c-.04-.282-.163-.547-.37-.847a8.456 8.456 0 0 0-.542-.68c-.084-.1-.173-.205-.268-.32C3.201 7.75 2.5 6.766 2.5 5.25 2.5 2.31 4.863 0 8 0s5.5 2.31 5.5 5.25c0 1.516-.701 2.5-1.328 3.259-.095.115-.184.22-.268.319-.207.245-.383.453-.541.681-.208.3-.33.565-.37.847a.751.751 0 0 1-1.485-.212c.084-.593.337-1.078.621-1.489.203-.292.45-.584.673-.848.075-.088.147-.173.213-.253.561-.679.985-1.32.985-2.304 0-2.06-1.637-3.75-4-3.75ZM5.75 12h4.5a.75.75 0 0 1 0 1.5h-4.5a.75.75 0 0 1 0-1.5ZM6 15.25a.75.75 0 0 1 .75-.75h2.5a.75.75 0 0 1 0 1.5h-2.5a.75.75 0 0 1-.75-.75Z"/></svg>',
    'gh-important': '<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" fill="currentColor"><path d="M0 1.75C0 .784.784 0 1.75 0h12.5C15.216 0 16 .784 16 1.75v9.5A1.75 1.75 0 0 1 14.25 13H8.06l-2.573 2.573A1.458 1.458 0 0 1 3 14.543V13H1.75A1.75 1.75 0 0 1 0 11.25Zm1.75-.25a.25.25 0 0 0-.25.25v9.5c0 .138.112.25.25.25h2a.75.75 0 0 1 .75.75v2.19l2.72-2.72a.749.749 0 0 1 .53-.22h6.5a.25.25 0 0 0 .25-.25v-9.5a.25.25 0 0 0-.25-.25Zm7 2.25v2.5a.75.75 0 0 1-1.5 0v-2.5a.75.75 0 0 1 1.5 0ZM9 9a1 1 0 1 1-2 0 1 1 0 0 1 2 0Z"/></svg>',
    'gh-warning': '<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" fill="currentColor"><path d="M6.457 1.047c.659-1.234 2.427-1.234 3.086 0l6.082 11.378A1.75 1.75 0 0 1 14.082 15H1.918a1.75 1.75 0 0 1-1.543-2.575Zm1.763.707a.25.25 0 0 0-.44 0L1.698 13.132a.25.25 0 0 0 .22.368h12.164a.25.25 0 0 0 .22-.368Zm.53 3.996v2.5a.75.75 0 0 1-1.5 0v-2.5a.75.75 0 0 1 1.5 0ZM9 11a1 1 0 1 1-2 0 1 1 0 0 1 2 0Z"/></svg>',
    'gh-caution': '<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" fill="currentColor"><path d="M4.47.22A.749.749 0 0 1 5 0h6c.199 0 .389.079.53.22l4.25 4.25c.141.14.22.331.22.53v6a.749.749 0 0 1-.22.53l-4.25 4.25A.749.749 0 0 1 11 16H5a.749.749 0 0 1-.53-.22L.22 11.53A.749.749 0 0 1 0 11V5c0-.199.079-.389.22-.53Zm.84 1.28L1.5 5.31v5.38l3.81 3.81h5.38l3.81-3.81V5.31L10.69 1.5ZM8 4a.75.75 0 0 1 .75.75v3.5a.75.75 0 0 1-1.5 0v-3.5A.75.75 0 0 1 8 4Zm0 8a1 1 0 1 1 0-2 1 1 0 0 1 0 2Z"/></svg>',
    'chevron-right': '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"></polyline></svg>',
    'chevron-down': '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg>',
};

/** Collect all QuoteMark nodes from the subtree. */
function collectQuoteMarks(node: SyntaxNode): SyntaxNode[] {
    const marks: SyntaxNode[] = [];
    const cursor = node.cursor();
    if (!cursor.firstChild()) return marks;
    do {
        if (cursor.type.name === 'QuoteMark') {
            marks.push(cursor.node);
        }
        // Recurse into children
        if (cursor.firstChild()) {
            do {
                if (cursor.type.name === 'QuoteMark') {
                    marks.push(cursor.node);
                }
            } while (cursor.nextSibling());
            cursor.parent();
        }
    } while (cursor.nextSibling());
    return marks;
}

function blockquoteDecorator(node: SyntaxNode, view: EditorView): DecorationEntry[] {
    const entries: DecorationEntry[] = [];
    const doc = view.state.doc;

    // Get the full text of the first line to check for callout pattern
    const firstLine = doc.lineAt(node.from);
    const lineText = firstLine.text;

    // Detect whether the first quoted line is an Obsidian-style callout.
    const { calloutMatch } = parseBlockquoteLead(lineText);

    // Collect all QuoteMark nodes in the subtree
    const quoteMarks = collectQuoteMarks(node);
    const lastLineNo = doc.lineAt(Math.max(node.from, node.to - 1)).number;
    const cursorLineNo = doc.lineAt(view.state.selection.main.head).number;
    const cursorInsideBlock = cursorLineNo >= firstLine.number && cursorLineNo <= lastLineNo;

    if (!shouldDecorateBlockquote(lineText, cursorInsideBlock)) {
        return entries;
    }

    if (calloutMatch) {
        const type = calloutMatch[1].toLowerCase();
        const color = CALLOUT_COLORS[type] || 'var(--accent-color, #1d9bf0)';
        const marker = calloutMatch[2] || '';
        const foldState: 'none' | 'expanded' | 'collapsed' = marker === '-'
            ? 'collapsed'
            : marker === '+'
                ? 'expanded'
                : 'none';
        const calloutClass = foldState === 'collapsed'
            ? 'cm-md-callout cm-md-callout-collapsed'
            : 'cm-md-callout';

        // Style callouts with line decorations (not inline marks) so
        // background + left border stay aligned to full editor line width.
        for (let ln = firstLine.number; ln <= lastLineNo; ln++) {
            const line = doc.line(ln);
            const isFirst = ln === firstLine.number;
            const isLast = ln === lastLineNo;
            let cls = `${calloutClass} cm-md-callout-line`;
            if (isFirst) cls += ' cm-md-callout-line-first';
            if (isLast) cls += ' cm-md-callout-line-last';
            entries.push({
                from: line.from,
                to: line.from,
                decoration: Decoration.line({
                    class: cls,
                    attributes: {
                        style: `--cm-md-callout-color: ${color}; border-left-color: ${color}; background-color: color-mix(in srgb, ${color} 8%, transparent)`,
                    },
                }),
            });
        }

        // Line-level classes improve spacing/typography parity for callout title/body.
        entries.push({
            from: firstLine.from,
            to: firstLine.from,
            decoration: Decoration.line({ class: 'cm-md-callout-title-line' }),
        });
        if (foldState !== 'collapsed') {
            for (let ln = firstLine.number + 1; ln <= lastLineNo; ln++) {
                const line = doc.line(ln);
                const isLast = ln === lastLineNo;
                entries.push({
                    from: line.from,
                    to: line.from,
                    decoration: Decoration.line({
                        class: isLast
                            ? 'cm-md-callout-body-line cm-md-callout-body-line-last'
                            : 'cm-md-callout-body-line',
                    }),
                });
            }
        }

        // Hide all QuoteMark nodes (`>`). If collapsed, only keep the title line;
        // body lines are hidden by the range replacement below.
        for (const mark of quoteMarks) {
            if (foldState === 'collapsed' && mark.from > firstLine.to) continue;

            // Include trailing space after `>`
            let end = mark.to;
            if (end < doc.length && doc.sliceString(end, end + 1) === ' ') end++;
            entries.push({
                from: mark.from,
                to: end,
                decoration: Decoration.replace({}),
            });
        }

        // Replace `[!type][+|-]? title` with icon+title widget on the first line
        const bracketStart = firstLine.from + lineText.indexOf('[!');
        const bracketEnd = firstLine.from + lineText.indexOf(']') + 1;
        if (bracketStart >= firstLine.from && bracketEnd > bracketStart) {
            // Determine the custom title text (after [!type][+|-]?)
            const providedTitle = (calloutMatch[3] || '').trim();
            const customTitle = providedTitle || defaultCalloutTitle(type);
            const iconName = CALLOUT_ICON_NAMES[type] || 'gh-info';

            // Replace from [!type][+|-]? plus trailing space with icon widget
            let replaceEnd = bracketEnd;
            const markerPos = bracketEnd;
            const afterBracket = doc.sliceString(replaceEnd, replaceEnd + 1);
            if (afterBracket === '+' || afterBracket === '-') replaceEnd++;
            if (doc.sliceString(replaceEnd, replaceEnd + 1) === ' ') replaceEnd++;

            // If there's custom title text, keep it and inject icon prefix only
            if (providedTitle) {
                entries.push({
                    from: bracketStart,
                    to: replaceEnd,
                    decoration: Decoration.replace({
                        widget: new CalloutIconWidget(iconName, '', foldState, markerPos),
                    }),
                });
                // Make the remaining title text bold
                entries.push({
                    from: replaceEnd,
                    to: firstLine.to,
                    decoration: Decoration.mark({ class: 'cm-md-callout-title-text' }),
                });
            } else {
                // No custom title — replace full marker with icon + default title
                entries.push({
                    from: bracketStart,
                    to: firstLine.to,
                    decoration: Decoration.replace({
                        widget: new CalloutIconWidget(iconName, customTitle, foldState, markerPos),
                    }),
                });
            }
        }

        // Collapsed callout: hide body text (everything after first line marker).
        // Body reappears automatically when cursor enters the block (decorations off).
        if (foldState === 'collapsed' && firstLine.number < doc.lines && firstLine.to < node.to) {
            const lastLine = doc.lineAt(Math.max(firstLine.to + 1, node.to - 1)).number;
            for (let ln = firstLine.number + 1; ln <= lastLine; ln++) {
                const line = doc.line(ln);
                entries.push({
                    from: line.from,
                    to: line.from,
                    decoration: Decoration.line({ class: 'cm-md-callout-collapsed-line' }),
                });
            }
        }
    } else {
        // Regular blockquote — style each line so the quote bar/background stay
        // contiguous and nested list indentation composes correctly.
        for (let ln = firstLine.number; ln <= lastLineNo; ln++) {
            const line = doc.line(ln);
            let cls = 'cm-md-blockquote-line';
            if (ln === firstLine.number) cls += ' cm-md-blockquote-line-first';
            if (ln === lastLineNo) cls += ' cm-md-blockquote-line-last';
            entries.push({
                from: line.from,
                to: line.from,
                decoration: Decoration.line({ class: cls }),
            });
        }

        // Hide QuoteMark characters (>) — the left border comes from CSS.
        for (const mark of quoteMarks) {
            let end = mark.to;
            if (end < doc.length && doc.sliceString(end, end + 1) === ' ') end++;
            entries.push({
                from: mark.from,
                to: end,
                decoration: Decoration.replace({}),
            });
        }
    }

    return entries;
}

registerDecorator('Blockquote', blockquoteDecorator);
