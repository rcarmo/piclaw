import { html } from '../vendor/preact-htm.js';

type TextToken = { type: string; text?: string; raw?: string; tokens?: TextToken[]; items?: TextToken[]; ordered?: boolean; start?: number; depth?: number };
type Lexer = { lexer(text: string): TextToken[]; Lexer: { lexInline(text: string): TextToken[] } };

/** Turn the existing Markdown lexer's tokens into Preact nodes; never emit parsed HTML or URLs. */
export function renderA2uiText(text: string, inline: boolean): { content: unknown; block: boolean } {
    const lexer = typeof window !== 'undefined' ? window.marked as unknown as Lexer | undefined : undefined;
    if (!lexer?.Lexer || !text || text.length > 8192) return { content: text, block: false };
    let remaining = 256;
    const walk = (tokens: TextToken[], depth = 0): unknown[] => tokens.map((token): unknown => {
        if (--remaining < 0 || depth > 16) throw Error('A2UI Markdown limit exceeded');
        const children = () => token.tokens ? walk(token.tokens, depth + 1) : token.text ?? token.raw ?? '';
        switch (token.type) {
            case 'space': return null;
            case 'paragraph': return html`<p>${children()}</p>`;
            case 'heading': {
                const tag = `h${Math.max(1, Math.min(6, token.depth ?? 1))}`;
                return html`<${tag}>${children()}</${tag}>`;
            }
            case 'strong': return html`<strong>${children()}</strong>`;
            case 'em': return html`<em>${children()}</em>`;
            case 'del': return html`<del>${children()}</del>`;
            case 'br': return html`<br />`;
            case 'codespan': return html`<code>${token.text ?? ''}</code>`;
            case 'code': return html`<pre><code>${token.text ?? ''}</code></pre>`;
            case 'blockquote': return html`<blockquote>${children()}</blockquote>`;
            case 'list': {
                const tag = token.ordered ? 'ol' : 'ul';
                return html`<${tag} start=${token.ordered ? token.start : undefined}>${walk(token.items ?? [], depth + 1)}</${tag}>`;
            }
            case 'list_item': return html`<li>${children()}</li>`;
            case 'hr': return html`<hr />`;
            case 'link': return children();
            case 'image': return token.text ?? '';
            case 'text': return children();
            default: return token.raw ?? token.text ?? '';
        }
    });
    try {
        if (inline) return { content: walk(lexer.Lexer.lexInline(text)), block: false };
        const tokens = lexer.lexer(text).filter(token => token.type !== 'space');
        const first = tokens[0];
        if (tokens.length === 1 && first?.type === 'paragraph' && first.tokens) return { content: walk(first.tokens), block: false };
        return { content: walk(tokens), block: true };
    } catch {
        return { content: text, block: false };
    }
}
