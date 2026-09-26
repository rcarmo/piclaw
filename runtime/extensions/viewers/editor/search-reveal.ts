import {
    Decoration,
    EditorView,
    StateEffect,
    StateField,
    SearchQuery,
    closeSearchPanel,
    openSearchPanel,
    searchPanelOpen,
    setSearchQuery,
} from '#editor-vendor/codemirror';
import type { DecorationSet, EditorState, Extension } from '#editor-vendor/codemirror';

export const REVEAL_FADE_MS = 3200;

const setRevealMatch = StateEffect.define<{ from: number; to: number } | null>();

const revealField = StateField.define<DecorationSet>({
    create() {
        return Decoration.none;
    },
    update(decorations, transaction) {
        decorations = decorations.map(transaction.changes);
        for (const effect of transaction.effects) {
            if (!effect.is(setRevealMatch)) continue;
            decorations = effect.value
                ? Decoration.set([
                    Decoration.mark({ class: 'cm-initialRevealMatch' }).range(effect.value.from, effect.value.to),
                ])
                : Decoration.none;
        }
        return decorations;
    },
    provide: (field) => EditorView.decorations.from(field),
});

const revealTheme = EditorView.theme({
    '.cm-initialRevealMatch': {
        backgroundColor: 'var(--search-highlight-color)',
        borderRadius: '3px',
        boxShadow: '0 0 0 1px color-mix(in srgb, var(--accent-color, #1d9bf0) 40%, transparent)',
        transition: `background-color ${REVEAL_FADE_MS}ms ease, box-shadow ${REVEAL_FADE_MS}ms ease`,
    },
});

let clearRevealTimer: ReturnType<typeof setTimeout> | null = null;

export function buildRevealCandidates(queryText: string): string[] {
    const candidates = new Set<string>();
    const trimmed = queryText.trim();
    if (!trimmed) return [];

    candidates.add(trimmed);

    const collapsed = trimmed.replace(/\s+/g, ' ').trim();
    if (collapsed) candidates.add(collapsed);

    for (const line of trimmed.split('\n').map((part) => part.trim()).filter(Boolean)) {
        candidates.add(line);
        const lineCollapsed = line.replace(/\s+/g, ' ').trim();
        if (lineCollapsed) candidates.add(lineCollapsed);
    }

    if (collapsed.length > 140) candidates.add(collapsed.slice(0, 140).trim());
    if (collapsed.length > 80) candidates.add(collapsed.slice(0, 80).trim());

    return [...candidates].filter((candidate) => candidate.length >= 12 || candidate === trimmed);
}

export function findRevealRange(
    docText: EditorState['doc'],
    queryText: string,
): { from: number; to: number } | null {
    for (const candidate of buildRevealCandidates(queryText)) {
        const query = new SearchQuery({ search: candidate });
        if (!query.valid || !query.search) continue;
        const cursor = query.getCursor(docText);
        const first = cursor.next();
        if (!first.done && first.value.from !== first.value.to) {
            return { from: first.value.from, to: first.value.to };
        }
    }
    return null;
}

function findScrollParent(node: HTMLElement): HTMLElement | null {
    let current: HTMLElement | null = node.parentElement;
    while (current) {
        const { overflowY } = window.getComputedStyle(current);
        if ((overflowY === 'auto' || overflowY === 'scroll') && current.scrollHeight > current.clientHeight) {
            return current;
        }
        current = current.parentElement;
    }
    return null;
}

function scrollMatchNearTop(match: HTMLElement, offset: number): void {
    const scrollParent = findScrollParent(match);
    if (!scrollParent) {
        match.scrollIntoView({ behavior: 'smooth', block: 'start' });
        return;
    }
    const parentRect = scrollParent.getBoundingClientRect();
    const matchRect = match.getBoundingClientRect();
    const nextTop = scrollParent.scrollTop + (matchRect.top - parentRect.top) - offset;
    scrollParent.scrollTo({ top: Math.max(0, nextTop), behavior: 'smooth' });
}

export function revealText(view: EditorView, queryText: string): { from: number; to: number } | null {
    if (!queryText) return null;
    const match = findRevealRange(view.state.doc, queryText);
    if (!match) return null;

    view.dispatch({
        effects: [
            setRevealMatch.of(match),
            EditorView.scrollIntoView(match.from, { y: 'start', yMargin: 72 }),
        ],
    });

    requestAnimationFrame(() => {
        const element = view.dom.querySelector('.cm-initialRevealMatch')?.closest('.cm-line')
            ?? view.dom.querySelector('.cm-initialRevealMatch');
        if (element instanceof HTMLElement) scrollMatchNearTop(element, 72);
    });

    if (clearRevealTimer !== null) clearTimeout(clearRevealTimer);
    clearRevealTimer = setTimeout(() => {
        view.dispatch({ effects: setRevealMatch.of(null) });
        clearRevealTimer = null;
    }, REVEAL_FADE_MS);

    return match;
}

export function openEditorSearch(view: EditorView, query?: string): void {
    if (query !== undefined) {
        view.dispatch({ effects: setSearchQuery.of(new SearchQuery({ search: query })) });
    }
    openSearchPanel(view);
}

export function closeEditorSearch(view: EditorView): void {
    closeSearchPanel(view);
}

export function isEditorSearchOpen(state: EditorState): boolean {
    return searchPanelOpen(state);
}

export const searchRevealExtension: Extension = [revealField, revealTheme];
