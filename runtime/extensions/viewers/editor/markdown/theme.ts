/**
 * theme.ts — CSS theme for Markdown live preview decorations.
 *
 * Uses piclaw CSS variables for consistent theming.
 * All classes are prefixed with `cm-md-` to avoid collisions.
 *
 * Code blocks and tables use Decoration.line() which adds classes
 * directly to .cm-line elements for continuous styling.
 */
import { EditorView } from '/editor-vendor/codemirror.js';

export const markdownPreviewTheme = EditorView.theme({
    /* ── Base: switch to reading font ── */
    '& .cm-scroller': {
        fontFamily:
            '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif !important',
    },
    '& .cm-content': {
        fontFamily: 'inherit !important',
        fontSize: '15px',
        lineHeight: '1.6',
        padding: '10px 0',
        overflowWrap: 'anywhere',
    },
    /* Hide line numbers in live preview — like Obsidian */
    '& .cm-gutters': {
        display: 'none !important',
    },
    /* Active line gets subtle background — like Obsidian */
    '& .cm-activeLine': {
        backgroundColor: 'rgba(255, 255, 255, 0.03) !important',
    },
    /* Cursor line number emphasis (hidden gutters, but good to have) */
    '& .cm-activeLineGutter': {
        backgroundColor: 'transparent !important',
    },

    /* ── Hide whitespace indicators globally in live preview ── */
    '& .cm-highlightSpace': {
        backgroundImage: 'none !important',
    },
    '& .cm-highlightSpace::before': {
        content: 'none !important',
    },
    '& .cm-trailingSpace': {
        backgroundImage: 'none !important',
    },
    '& .cm-highlightTab::before': {
        content: 'none !important',
    },
    '& .cm-highlightTab': {
        backgroundImage: 'none !important',
    },

    /* ── Formatting marks (visible when cursor is on the line) ── */
    '.cm-md-mark': {
        color: 'var(--text-secondary, #666)',
        fontSize: '0.85em',
        opacity: '0.6',
    },

    /* ── Headings ── */
    '.cm-md-h-line': { paddingTop: '0.1em' },
    // IMPORTANT: avoid vertical margins on .cm-line decorations
    // (CodeMirror coordinate mapping drifts when line margins accumulate).
    '.cm-md-h1-line': { paddingTop: '0.9em' },
    '.cm-md-h2-line': { paddingTop: '0.82em' },
    '.cm-md-h3-line': { paddingTop: '0.72em' },
    '.cm-md-h4-line, .cm-md-h5-line, .cm-md-h6-line': { paddingTop: '0.6em' },
    '.cm-md-h1': { fontSize: '1.42em', fontWeight: '700', lineHeight: '1.24', letterSpacing: '-0.01em' },
    '.cm-md-h2': { fontSize: '1.28em', fontWeight: '700', lineHeight: '1.25', letterSpacing: '-0.005em' },
    '.cm-md-h3': { fontSize: '1.16em', fontWeight: '650', lineHeight: '1.26' },
    '.cm-md-h4': { fontSize: '1.08em', fontWeight: '650', lineHeight: '1.28' },
    '.cm-md-h5': { fontSize: '1.02em', fontWeight: '600', lineHeight: '1.3' },
    '.cm-md-h6': { fontSize: '0.98em', fontWeight: '600', lineHeight: '1.32', opacity: '0.92' },
    '.cm-md-heading-fold': {
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: '14px',
        height: '14px',
        marginRight: '6px',
        borderRadius: '4px',
        color: 'var(--text-secondary, #8a8f98)',
        cursor: 'pointer',
        verticalAlign: 'middle',
        outline: 'none',
    },
    '.cm-md-heading-fold:hover': {
        color: 'var(--text-primary, #d6d6d6)',
        backgroundColor: 'rgba(255, 255, 255, 0.06)',
    },
    '.cm-md-heading-fold:focus-visible': {
        boxShadow: '0 0 0 2px color-mix(in srgb, var(--accent-color, #1d9bf0) 38%, transparent)',
    },
    '.cm-md-heading-fold svg': {
        display: 'block',
        width: '14px',
        height: '14px',
    },
    '.cm-md-h-collapsed': {
        opacity: '0.98',
    },
    '.cm-md-heading-collapsed-line': {
        display: 'none',
    },

    /* ── Emphasis ── */
    '.cm-md-em': { fontStyle: 'italic' },
    '.cm-md-strong': { fontWeight: '700' },
    '.cm-md-strike': { textDecoration: 'line-through', opacity: '0.7' },

    /* ── Inline code ── */
    '.cm-md-inline-code': {
        fontFamily:
            'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
        fontSize: '0.9em',
        backgroundColor: 'var(--bg-secondary, #2a2a2a)',
        padding: '1px 5px',
        borderRadius: '3px',
        border: '1px solid var(--border-color, #333)',
        overflowWrap: 'anywhere',
    },

    /* ── Code blocks (line decorations on .cm-line) ── */
    '.cm-md-code-fence-open': {
        backgroundColor: 'var(--bg-secondary, #2a2a2a)',
        borderRadius: '6px 6px 0 0',
        borderTop: '1px solid var(--border-color, #333)',
        borderLeft: '1px solid var(--border-color, #333)',
        borderRight: '1px solid var(--border-color, #333)',
        padding: '4px 10px !important',
        minHeight: '22px',
    },
    '.cm-md-code-block-header': {
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: '10px',
        width: '100%',
        verticalAlign: 'top',
    },
    '.cm-md-code-block-lang': {
        fontSize: '0.72em',
        color: 'var(--text-secondary, #888)',
        textTransform: 'none',
        letterSpacing: '0.2px',
        fontFamily:
            '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
        whiteSpace: 'nowrap',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
    },
    '.cm-md-code-copy-btn': {
        display: 'inline-flex',
        alignItems: 'center',
        gap: '5px',
        border: '1px solid var(--border-color, #3a3a3a)',
        borderRadius: '6px',
        padding: '2px 7px',
        backgroundColor: 'transparent',
        color: 'var(--text-secondary, #9aa0a6)',
        fontSize: '0.72em',
        lineHeight: '1',
        cursor: 'pointer',
        whiteSpace: 'nowrap',
    },
    '.cm-md-code-copy-btn:hover': {
        backgroundColor: 'color-mix(in srgb, var(--accent-color, #1d9bf0) 10%, transparent)',
        borderColor: 'color-mix(in srgb, var(--accent-color, #1d9bf0) 28%, var(--border-color, #3a3a3a))',
        color: 'var(--text-primary, #d6d6d6)',
    },
    '.cm-md-code-copy-btn:focus-visible': {
        outline: 'none',
        boxShadow: '0 0 0 2px color-mix(in srgb, var(--accent-color, #1d9bf0) 40%, transparent)',
    },
    '.cm-md-code-copy-btn[data-state="copied"]': {
        color: '#10b981',
        borderColor: 'color-mix(in srgb, #10b981 35%, var(--border-color, #3a3a3a))',
    },
    '.cm-md-code-copy-btn[data-state="error"]': {
        color: '#ef4444',
        borderColor: 'color-mix(in srgb, #ef4444 35%, var(--border-color, #3a3a3a))',
    },
    '.cm-md-code-copy-icon': {
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: '14px',
        height: '14px',
    },
    '.cm-md-code-content': {
        display: 'inline',
        whiteSpace: 'pre',
        margin: '0',
        padding: '0',
        lineHeight: '1.35',
        fontFamily:
            'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace !important',
    },
    '.cm-md-code-raw-line': {
        fontFamily:
            'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace !important',
        fontSize: '0.9em',
        lineHeight: '1.35 !important',
    },
    '.cm-md-code-content .tok-keyword': { color: '#c792ea' },
    '.cm-md-code-content .tok-operator': { color: '#89ddff' },
    '.cm-md-code-content .tok-comment': { color: '#6a737d', fontStyle: 'italic' },
    '.cm-md-code-content .tok-string': { color: '#c3e88d' },
    '.cm-md-code-content .tok-number': { color: '#f78c6c' },
    '.cm-md-code-content .tok-bool': { color: '#ffcb6b' },
    '.cm-md-code-content .tok-null': { color: '#ffcb6b' },
    '.cm-md-code-content .tok-variableName, .cm-md-code-content .tok-propertyName': { color: '#e6edf3' },
    '.cm-md-code-content .tok-typeName, .cm-md-code-content .tok-className': { color: '#82aaff' },
    '.cm-md-code-content .tok-function, .cm-md-code-content .tok-functionName': { color: '#82aaff' },
    '.cm-md-code-content .tok-punctuation': { color: '#9aa5b1' },
    '.cm-md-code-content .tok-tagName': { color: '#f07178' },
    '.cm-md-code-content .tok-attributeName': { color: '#c792ea' },
    '.cm-md-code-content .tok-meta': { color: '#89ddff' },
    '.cm-md-code-line': {
        backgroundColor: 'var(--bg-secondary, #2a2a2a)',
        fontFamily:
            'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace !important',
        fontSize: '0.9em',
        lineHeight: '1.35 !important',
        minHeight: '1.35em',
        borderLeft: '1px solid var(--border-color, #333)',
        borderRight: '1px solid var(--border-color, #333)',
        padding: '0 16px !important',
        margin: '0 !important',
    },
    '.cm-md-code-line-last': {
        borderLeft: '1px solid var(--border-color, #333)',
        borderRight: '1px solid var(--border-color, #333)',
        padding: '0 16px !important',
        paddingBottom: '2px !important',
    },
    '.cm-md-code-fence-close': {
        backgroundColor: 'var(--bg-secondary, #2a2a2a)',
        borderLeft: '1px solid var(--border-color, #333)',
        borderRight: '1px solid var(--border-color, #333)',
        borderBottom: '1px solid var(--border-color, #333)',
        borderRadius: '0 0 6px 6px',
        minHeight: '0 !important',
        padding: '0 16px !important',
        margin: '0 !important',
        overflow: 'hidden',
        fontSize: '0',
        lineHeight: '0 !important',
    },
    '.cm-md-code-block-spacer': {
        display: 'block',
        width: '100%',
        height: '10px',
    },
    /* Hide whitespace markers inside code blocks */
    '.cm-md-code-line .cm-highlightSpace': {
        backgroundImage: 'none !important',
    },
    '.cm-md-code-line .cm-highlightSpace::before': {
        content: 'none !important',
    },

    /* ── Blockquote / Callout ── */
    '.cm-md-blockquote-line': {
        boxShadow: 'inset 3px 0 0 var(--accent-color, #1d9bf0)',
        padding: '0 0 0 12px',
        margin: '0 !important',
        color: 'var(--text-secondary, #aaa)',
    },
    '.cm-md-blockquote-line-first': {
        paddingTop: '1px',
    },
    '.cm-md-blockquote-line-last': {
        paddingBottom: '1px',
    },
    '.cm-md-callout': {
        boxShadow: 'inset 3px 0 0 var(--cm-md-callout-color, var(--accent-color, #1d9bf0))',
        backgroundColor: 'var(--accent-soft, rgba(29,155,240,0.08))',
        borderRadius: '0',
        padding: '0 12px',
        margin: '0 !important',
    },
    '.cm-md-callout-line-first': {
        paddingTop: '8px',
        borderRadius: '0 6px 0 0',
    },
    '.cm-md-callout-line-last': {
        paddingBottom: '8px',
        borderRadius: '0 0 6px 0',
    },
    '.cm-md-callout-title': {
        display: 'inline-flex',
        alignItems: 'center',
        gap: '6px',
        fontWeight: '600',
        fontSize: '0.95em',
        marginBottom: '4px',
        marginRight: '6px',
        color: 'var(--cm-md-callout-color, var(--accent-color, #1d9bf0))',
    },
    '.cm-md-callout-fold-icon': {
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: '14px',
        height: '14px',
        opacity: '0.85',
        flexShrink: '0',
        cursor: 'pointer',
        borderRadius: '4px',
        outline: 'none',
    },
    '.cm-md-callout-fold-icon:hover': {
        backgroundColor: 'color-mix(in srgb, var(--cm-md-callout-color, var(--accent-color, #1d9bf0)) 16%, transparent)',
    },
    '.cm-md-callout-fold-icon:focus-visible': {
        boxShadow: '0 0 0 2px color-mix(in srgb, var(--cm-md-callout-color, var(--accent-color, #1d9bf0)) 45%, transparent)',
    },
    '.cm-md-callout-fold-icon svg': {
        display: 'block',
        width: '14px',
        height: '14px',
    },
    '.cm-md-callout-icon': {
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: '16px',
        height: '16px',
        color: 'inherit',
        opacity: '0.95',
        flexShrink: '0',
    },
    '.cm-md-callout-icon svg': {
        display: 'block',
        width: '16px',
        height: '16px',
    },
    '.cm-md-callout-title-label': {
        fontWeight: '600',
    },
    '.cm-md-callout-title-text': {
        fontWeight: '600',
        fontSize: '0.95em',
        color: 'var(--cm-md-callout-color, var(--accent-color, #1d9bf0))',
    },
    '.cm-md-callout-collapsed': {
        paddingTop: '6px',
        paddingBottom: '6px',
    },
    '.cm-md-callout-collapsed .cm-md-callout-title': {
        marginBottom: '0',
    },
    '.cm-md-callout-collapsed .cm-md-callout-fold-icon': {
        opacity: '1',
    },
    '.cm-md-callout-collapsed-line': {
        display: 'none',
    },
    '.cm-md-callout-title-line': {
        paddingTop: '1px',
    },
    '.cm-md-callout-body-line': {
        paddingLeft: '2px',
    },
    '.cm-md-callout-body-line-last': {
        paddingBottom: '2px',
    },
    '.cm-md-blockquote-line.cm-md-list-item-line': {
        paddingLeft: 'calc(12px + var(--cm-md-list-indent, 0px))',
    },
    '.cm-md-blockquote-line.cm-md-list-item-continuation': {
        paddingLeft: 'calc(12px + var(--cm-md-list-indent, 0px) + var(--cm-md-list-continuation, 22px))',
    },
    '.cm-md-callout.cm-md-list-item-line': {
        paddingLeft: 'calc(12px + var(--cm-md-list-indent, 0px))',
    },
    '.cm-md-callout.cm-md-list-item-continuation': {
        paddingLeft: 'calc(12px + var(--cm-md-list-indent, 0px) + var(--cm-md-list-continuation, 22px))',
    },
    '.cm-md-callout .cm-md-bullet, .cm-md-callout .cm-md-list-number, .cm-md-callout .cm-md-link, .cm-md-callout .cm-md-tag, .cm-md-callout .cm-md-footnote-ref': {
        color: 'var(--cm-md-callout-color, var(--accent-color, #1d9bf0))',
    },
    '.cm-md-callout .cm-md-code-fence-open': {
        borderTopColor: 'color-mix(in srgb, var(--cm-md-callout-color, var(--accent-color, #1d9bf0)) 28%, var(--border-color, #333))',
        borderLeftColor: 'color-mix(in srgb, var(--cm-md-callout-color, var(--accent-color, #1d9bf0)) 22%, var(--border-color, #333))',
        borderRightColor: 'color-mix(in srgb, var(--cm-md-callout-color, var(--accent-color, #1d9bf0)) 22%, var(--border-color, #333))',
    },
    '.cm-md-callout .cm-md-code-line, .cm-md-callout .cm-md-code-line-last, .cm-md-callout .cm-md-code-fence-close': {
        borderLeftColor: 'color-mix(in srgb, var(--cm-md-callout-color, var(--accent-color, #1d9bf0)) 22%, var(--border-color, #333))',
        borderRightColor: 'color-mix(in srgb, var(--cm-md-callout-color, var(--accent-color, #1d9bf0)) 22%, var(--border-color, #333))',
    },
    '.cm-md-callout .cm-md-code-fence-close': {
        borderBottomColor: 'color-mix(in srgb, var(--cm-md-callout-color, var(--accent-color, #1d9bf0)) 28%, var(--border-color, #333))',
    },
    '.cm-md-callout .cm-md-code-copy-btn:hover': {
        backgroundColor: 'color-mix(in srgb, var(--cm-md-callout-color, var(--accent-color, #1d9bf0)) 12%, transparent)',
        borderColor: 'color-mix(in srgb, var(--cm-md-callout-color, var(--accent-color, #1d9bf0)) 30%, var(--border-color, #3a3a3a))',
    },
    '.cm-md-callout .cm-md-code-copy-btn:focus-visible': {
        boxShadow: '0 0 0 2px color-mix(in srgb, var(--cm-md-callout-color, var(--accent-color, #1d9bf0)) 40%, transparent)',
    },
    '.cm-md-callout .cm-md-table-line': {
        borderLeftColor: 'color-mix(in srgb, var(--cm-md-callout-color, var(--accent-color, #1d9bf0)) 18%, var(--border-color, #333))',
        borderRightColor: 'color-mix(in srgb, var(--cm-md-callout-color, var(--accent-color, #1d9bf0)) 18%, var(--border-color, #333))',
    },
    '.cm-md-callout .cm-md-table-row-last': {
        borderBottomColor: 'color-mix(in srgb, var(--cm-md-callout-color, var(--accent-color, #1d9bf0)) 24%, var(--border-color, #333))',
    },
    '.cm-md-callout .cm-md-table-delim-line': {
        borderTopColor: 'color-mix(in srgb, var(--cm-md-callout-color, var(--accent-color, #1d9bf0)) 24%, var(--border-color, #333))',
    },
    '.cm-md-callout .cm-md-table-sep': {
        borderLeftColor: 'color-mix(in srgb, var(--cm-md-callout-color, var(--accent-color, #1d9bf0)) 18%, var(--border-color, #444))',
    },

    /* ── Tables (line decorations + pipe widgets) ── */
    '.cm-md-table-line': {
        fontFamily:
            '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif !important',
        fontSize: '0.9em',
        lineHeight: '1.55',
        borderLeft: '1px solid var(--border-color, #333)',
        borderRight: '1px solid var(--border-color, #333)',
        padding: '0 8px !important',
        whiteSpace: 'nowrap',
    },
    '.cm-md-table-header-line': {
        fontWeight: '700',
        backgroundColor: 'var(--bg-secondary, #2a2a2a)',
        borderTop: '1px solid var(--border-color, #333)',
        borderRadius: '6px 6px 0 0',
    },
    '.cm-md-table-row-even': {
        backgroundColor: 'transparent',
    },
    '.cm-md-table-row-odd': {
        backgroundColor: 'rgba(255, 255, 255, 0.02)',
    },
    '.cm-md-table-row-even:hover, .cm-md-table-row-odd:hover': {
        backgroundColor: 'rgba(255, 255, 255, 0.04)',
    },
    '.cm-md-table-row-last': {
        borderBottom: '1px solid var(--border-color, #333)',
        borderRadius: '0 0 6px 6px',
    },
    '.cm-md-table-delim-line': {
        height: '0 !important',
        padding: '0 !important',
        margin: '0 !important',
        overflow: 'hidden',
        fontSize: '0',
        lineHeight: '0 !important',
        minHeight: '0 !important',
        borderTop: '1px solid var(--border-color, #333)',
    },
    '.cm-md-table-cell': {
        display: 'inline-block',
        padding: '2px 8px',
        verticalAlign: 'middle',
        boxSizing: 'border-box',
    },
    '.cm-md-table-cell-header': {
        fontWeight: '700',
        color: 'var(--text-primary, #d6d6d6)',
    },
    '.cm-md-table-cell-left': {
        textAlign: 'left',
    },
    '.cm-md-table-cell-center': {
        textAlign: 'center',
    },
    '.cm-md-table-cell-right': {
        textAlign: 'right',
        fontVariantNumeric: 'tabular-nums',
    },
    '.cm-md-table-cell-widget': {
        borderRadius: '4px',
        cursor: 'text',
        outline: 'none',
    },
    '.cm-md-table-cell-widget:hover': {
        backgroundColor: 'rgba(255, 255, 255, 0.06)',
    },
    '.cm-md-table-cell-widget:focus-visible': {
        boxShadow: 'inset 0 0 0 1px var(--accent-color, #1d9bf0)',
        backgroundColor: 'rgba(29, 155, 240, 0.1)',
    },
    /* Pipe separator widgets */
    '.cm-md-table-edge': {
        /* Edge pipes (first/last) — invisible */
        display: 'inline-block',
        width: '0',
        overflow: 'hidden',
    },
    '.cm-md-table-sep': {
        /* Inner pipes — thin vertical line */
        display: 'inline-block',
        width: '0',
        borderLeft: '1px solid var(--border-color, #444)',
        height: '1.35em',
        verticalAlign: 'middle',
        margin: '0 1px',
    },
    /* Hide whitespace markers inside table lines */
    '.cm-md-table-line .cm-highlightSpace': {
        backgroundImage: 'none !important',
    },
    '.cm-md-table-line .cm-highlightSpace::before': {
        content: 'none !important',
    },

    /* ── Links ── */
    '.cm-md-link': {
        color: 'var(--accent-color, #1d9bf0)',
        textDecoration: 'underline',
        textDecorationColor: 'var(--accent-soft, rgba(29,155,240,0.3))',
        cursor: 'pointer',
    },
    '.cm-md-link:hover': {
        textDecorationColor: 'var(--accent-color, #1d9bf0)',
    },
    '.cm-md-link-widget': {
        display: 'inline',
        maxWidth: '100%',
        whiteSpace: 'normal',
        overflowWrap: 'anywhere',
        wordBreak: 'break-word',
    },
    '.cm-md-link-invalid': {
        color: 'var(--text-secondary, #8a8f98)',
        textDecorationStyle: 'dotted',
        cursor: 'not-allowed',
    },

    /* ── Images ── */
    '.cm-md-image-wrap': {
        display: 'inline-flex',
        flexDirection: 'column',
        maxWidth: '100%',
        margin: '8px 0',
        gap: '4px',
    },
    '.cm-md-image': {
        maxWidth: '100%',
        borderRadius: '6px',
        margin: '0',
        border: '1px solid var(--border-color, #333)',
        cursor: 'zoom-in',
    },
    '.cm-md-image-caption': {
        fontSize: '0.82em',
        color: 'var(--text-secondary, #8a8f98)',
        textAlign: 'center',
        lineHeight: '1.3',
    },
    '.cm-md-image-fallback': {
        color: 'var(--text-secondary, #8a8f98)',
        fontStyle: 'italic',
    },

    /* ── Horizontal rule ── */
    '.cm-md-hr': {
        borderTop: '1px solid var(--border-color, #444)',
        margin: '16px 0',
        display: 'block',
    },

    /* ── Checkbox ── */
    '.cm-md-checkbox': {
        cursor: 'pointer',
        width: '16px',
        height: '16px',
        verticalAlign: 'middle',
        marginRight: '6px',
        accentColor: 'var(--accent-color, #1d9bf0)',
    },
    '.cm-md-task-checked-text': {
        color: 'var(--text-secondary, #8a8f98)',
        textDecoration: 'line-through',
        textDecorationThickness: '1.5px',
        textDecorationColor: 'color-mix(in srgb, var(--text-secondary, #8a8f98) 70%, transparent)',
    },

    /* ── List markers ── */
    '.cm-md-list-item-line': {
        paddingLeft: 'var(--cm-md-list-indent, 0px)',
    },
    '.cm-md-list-item-continuation': {
        paddingLeft: 'calc(var(--cm-md-list-indent, 0px) + var(--cm-md-list-continuation, 22px))',
    },
    '.cm-md-list-item-task .cm-md-checkbox': {
        marginRight: '6px',
    },
    '.cm-md-bullet': {
        display: 'inline-block',
        minWidth: '1.1em',
        textAlign: 'center',
        marginRight: '6px',
        color: 'var(--accent-color, #1d9bf0)',
        fontWeight: '700',
        fontSize: '1.05em',
        lineHeight: '1',
    },
    '.cm-md-list-number': {
        display: 'inline-block',
        minWidth: '1.8em',
        textAlign: 'right',
        marginRight: '6px',
        color: 'var(--accent-color, #1d9bf0)',
        fontWeight: '600',
        fontVariantNumeric: 'tabular-nums',
    },

    /* ── Tags ── */
    '.cm-md-tag': {
        backgroundColor: 'var(--accent-soft, rgba(29,155,240,0.12))',
        color: 'var(--accent-color, #1d9bf0)',
        padding: '1px 6px',
        borderRadius: '10px',
        fontSize: '0.9em',
    },

    /* ── Frontmatter ── */
    '.cm-md-frontmatter-line': {
        backgroundColor: 'var(--bg-secondary, #2a2a2a)',
        borderLeft: '1px solid var(--border-color, #333)',
        borderRight: '1px solid var(--border-color, #333)',
        padding: '1px 10px !important',
        fontSize: '0.84em',
        lineHeight: '1.35',
        minHeight: '1.35em',
    },
    '.cm-md-frontmatter-line-first': {
        borderTop: '1px solid var(--border-color, #333)',
        borderRadius: '8px 8px 0 0',
        paddingTop: '4px !important',
    },
    '.cm-md-frontmatter-line-last': {
        borderBottom: '1px solid var(--border-color, #333)',
        borderRadius: '0 0 8px 8px',
        paddingBottom: '4px !important',
    },
    '.cm-md-frontmatter-fence': {
        height: '0 !important',
        padding: '0 !important',
        margin: '0 !important',
        overflow: 'hidden',
        fontSize: '0',
        lineHeight: '0 !important',
        minHeight: '0 !important',
        border: 'none !important',
    },
    '.cm-md-frontmatter-row': {
        display: 'grid',
        gridTemplateColumns: 'max-content minmax(0, 1fr)',
        alignItems: 'center',
        columnGap: '8px',
        width: '100%',
    },
    '.cm-md-frontmatter-field-cell': {
        textAlign: 'right',
        whiteSpace: 'nowrap',
    },
    '.cm-md-frontmatter-value-cell': {
        textAlign: 'left',
        minWidth: '0',
    },
    '.cm-md-frontmatter-pill': {
        display: 'inline-block',
        borderRadius: '999px',
        padding: '1px 7px',
        fontSize: '0.9em',
        lineHeight: '1.2',
        border: '1px solid var(--border-color, #3a3a3a)',
    },
    '.cm-md-frontmatter-field-pill': {
        color: 'var(--accent-color, #1d9bf0)',
        fontWeight: '600',
        backgroundColor: 'color-mix(in srgb, var(--accent-color, #1d9bf0) 10%, transparent)',
        borderColor: 'color-mix(in srgb, var(--accent-color, #1d9bf0) 24%, var(--border-color, #3a3a3a))',
    },
    '.cm-md-frontmatter-value': {
        color: 'var(--text-primary, #d6d6d6)',
        fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
        fontSize: '0.96em',
        lineHeight: '1.3',
    },
    '.cm-md-frontmatter-tags': {
        display: 'inline-flex',
        alignItems: 'center',
        gap: '4px',
        flexWrap: 'wrap',
    },
    '.cm-md-frontmatter-tag-pill': {
        color: 'var(--accent-color, #1d9bf0)',
        backgroundColor: 'var(--accent-soft, rgba(29,155,240,0.12))',
        borderColor: 'color-mix(in srgb, var(--accent-color, #1d9bf0) 24%, var(--border-color, #3a3a3a))',
        fontWeight: '500',
    },

    /* ── Footnotes ── */
    '.cm-md-footnote-ref': {
        fontSize: '0.8em',
        verticalAlign: 'super',
        color: 'var(--accent-color, #1d9bf0)',
        cursor: 'pointer',
        textDecoration: 'none',
    },
    '.cm-md-footnote-ref:hover': {
        textDecoration: 'underline',
    },
    '.cm-md-footnote-ref-unresolved': {
        color: '#f59e0b',
        textDecorationStyle: 'dotted',
    },
    '.cm-md-footnote-def-line': {
        borderLeft: '2px solid color-mix(in srgb, var(--accent-color, #1d9bf0) 26%, var(--border-color, #333))',
        paddingLeft: '10px',
        color: 'var(--text-primary, #d6d6d6)',
    },
    '.cm-md-footnote-def-line-first': {
        paddingTop: '6px',
    },
    '.cm-md-footnote-def-line-cont': {
        color: 'var(--text-secondary, #a7adb6)',
    },
    '.cm-md-footnote-def-line-last': {
        paddingBottom: '6px',
    },
    '.cm-md-footnote-def-label': {
        display: 'inline-flex',
        alignItems: 'center',
        gap: '6px',
        marginRight: '8px',
    },
    '.cm-md-footnote-def-badge': {
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        minWidth: '1.4em',
        height: '1.4em',
        borderRadius: '999px',
        padding: '0 6px',
        fontSize: '0.78em',
        lineHeight: '1',
        color: 'var(--accent-color, #1d9bf0)',
        backgroundColor: 'color-mix(in srgb, var(--accent-color, #1d9bf0) 12%, transparent)',
        border: '1px solid color-mix(in srgb, var(--accent-color, #1d9bf0) 28%, var(--border-color, #3a3a3a))',
    },
    '.cm-md-footnote-def-back': {
        color: 'var(--accent-color, #1d9bf0)',
        textDecoration: 'none',
        cursor: 'pointer',
    },
    '.cm-md-footnote-def-back:hover': {
        textDecoration: 'underline',
    },
    '.cm-md-footnote-def-back-disabled': {
        color: 'var(--text-secondary, #8a8f98)',
        cursor: 'not-allowed',
    },
    '.cm-md-footnote-def-text': {
        color: 'var(--text-primary, #d6d6d6)',
    },
});
