import { EditorView } from '#editor-vendor/codemirror';

/** Both sides of a diff use the same host palette. CSS variables remain live
 * across tint/import updates; the compartment only updates CodeMirror's mode. */
export function editorTheme(dark: boolean) {
    return EditorView.theme({
        '&': { color: 'var(--text-code)', backgroundColor: 'var(--bg-code)' },
        '.cm-scroller': { backgroundColor: 'var(--bg-code)' },
        '.cm-content': { color: 'var(--text-code)' },
        '.cm-gutters': { color: 'var(--text-secondary)', backgroundColor: 'var(--bg-code)', borderColor: 'var(--border-color)' },
        '.cm-activeLine, .cm-activeLineGutter': { backgroundColor: 'var(--accent-soft)' },
        '.cm-activeLineGutter': { color: 'var(--text-primary)' },
        '.cm-cursor, .cm-dropCursor': { borderLeftColor: 'var(--accent-color)' },
        '.cm-selectionBackground, &.cm-focused .cm-selectionBackground': { backgroundColor: 'var(--selection-background) !important' },
        '.cm-selectionMatch': { backgroundColor: 'var(--accent-soft)', outline: '1px solid var(--accent-color-alpha)' },
        '.cm-searchMatch, .cm-initialRevealMatch': { backgroundColor: 'var(--search-highlight-color)', outline: '1px solid var(--accent-color-alpha)' },
        '.cm-searchMatch.cm-searchMatch-selected': { backgroundColor: 'var(--selection-background)', outline: '1px solid var(--accent-color)' },
        '&.cm-focused .cm-matchingBracket': { backgroundColor: 'var(--accent-soft)', outline: '1px solid var(--accent-color-alpha)' },
        '&.cm-focused .cm-nonmatchingBracket': { color: 'var(--danger-color)' },
        '.cm-foldPlaceholder': { color: 'var(--text-secondary)', backgroundColor: 'var(--bg-secondary)', borderColor: 'var(--border-color)' },
        '.cm-panels, .cm-tooltip': { color: 'var(--text-primary)', backgroundColor: 'var(--bg-secondary)', borderColor: 'var(--border-color)' },
        '.cm-panels-top': { borderBottomColor: 'var(--border-color)' },
        '.cm-panels-bottom': { borderTopColor: 'var(--border-color)' },
        '.cm-textfield, .cm-button': { color: 'var(--text-primary)', background: 'var(--bg-primary)', border: '1px solid var(--border-color)' },
        '.cm-tooltip-autocomplete > ul > li[aria-selected]': { color: 'var(--text-primary)', backgroundColor: 'var(--accent-soft)' },
    }, { dark });
}
