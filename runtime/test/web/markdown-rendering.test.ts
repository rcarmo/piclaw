import { afterEach, expect, test } from 'bun:test';

const PreviousDOMParser = globalThis.DOMParser;
const PreviousNodeFilter = globalThis.NodeFilter;
const PreviousWindow = globalThis.window;
const PreviousMarked = globalThis.marked;
function decodeEntities(value: string) {
  return String(value || '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

afterEach(() => {
  if (PreviousDOMParser === undefined) {
    delete globalThis.DOMParser;
  } else {
    globalThis.DOMParser = PreviousDOMParser;
  }
  if (PreviousNodeFilter === undefined) {
    delete globalThis.NodeFilter;
  } else {
    globalThis.NodeFilter = PreviousNodeFilter;
  }
  if (PreviousWindow === undefined) {
    delete globalThis.window;
  } else {
    globalThis.window = PreviousWindow;
  }
  if (PreviousMarked === undefined) {
    delete globalThis.marked;
  } else {
    globalThis.marked = PreviousMarked;
  }
});

function installSimpleHtmlDomParser() {
  globalThis.NodeFilter = { SHOW_ELEMENT: 1, SHOW_TEXT: 4 } as any;
  globalThis.DOMParser = class {
    parseFromString(input: string) {
      const html = String(input || '');
      const match = html.match(/^<([a-z0-9]+)([^>]*)>([\s\S]*)<\/\1>$/i);
      const textContent = decodeEntities(html.replace(/<[^>]+>/g, ''));
      const body: any = {};

      if (!match) {
        body.innerHTML = html;
        return {
          body,
          documentElement: { textContent },
          createTreeWalker: (_root: unknown, _whatToShow: number) => ({
            nextNode: () => null,
          }),
        } as any;
      }

      const [, rawTag = '', rawAttrs = '', rawText = ''] = match;
      const attrs = Array.from(rawAttrs.matchAll(/([a-zA-Z_:][\w:.-]*)="([^"]*)"/g)).map((entry) => ({
        name: entry[1] || '',
        value: entry[2] || '',
      }));
      const el: any = {
        tagName: rawTag.toUpperCase(),
        attributes: attrs,
        getAttribute(name: string) {
          const attr = this.attributes.find((entry: any) => entry.name === name);
          return attr ? attr.value : null;
        },
        setAttribute(name: string, value: string) {
          const attr = this.attributes.find((entry: any) => entry.name === name);
          if (attr) {
            attr.value = value;
          } else {
            this.attributes.push({ name, value });
          }
        },
        removeAttribute(name: string) {
          this.attributes = this.attributes.filter((entry: any) => entry.name !== name);
        },
      };

      Object.defineProperty(body, 'innerHTML', {
        get() {
          const attrText = el.attributes.map((entry: any) => ` ${entry.name}="${entry.value}"`).join('');
          return `<${rawTag.toLowerCase()}${attrText}>${rawText}</${rawTag.toLowerCase()}>`;
        },
      });

      return {
        body,
        documentElement: { textContent },
        createTreeWalker: (_root: unknown, whatToShow: number) => {
          let used = false;
          return {
            nextNode: () => {
              if (used) return null;
              used = true;
              return whatToShow === globalThis.NodeFilter.SHOW_ELEMENT ? el : null;
            },
          };
        },
      } as any;
    }
  } as any;
}

test('source preparation leaves literal ranges intact; parser HTML tokens retain the escaping policy', async () => {
  globalThis.DOMParser = class {
    parseFromString(input: string) {
      return { documentElement: { textContent: decodeEntities(input) } } as any;
    }
  } as any;

  const { prepareMarkdownSource, prepareMarkdownToken } = await import('../../web/src/markdown.ts');
  const { safeHtml } = prepareMarkdownSource('> `/login` is still a work in progress <script>alert(1)</script>');
  expect(safeHtml).toBe('> `/login` is still a work in progress <script>alert(1)</script>');
  const token={type:'html',text:'<script>alert(1)</script>'}; prepareMarkdownToken(token);
  expect(token.text).toBe('&lt;script>alert(1)&lt;/script>');
  for(const type of ['code','codespan']){const code={type,text:'if (a < b && c > d) return "&lt;literal&gt;";'};prepareMarkdownToken(code);expect(code.text).toBe('if (a < b && c > d) return "&lt;literal&gt;";');}
});

test('parser HTML policy retains allowed ruby, br, and span tags without touching code tokens', async () => {
  globalThis.DOMParser = class {
    parseFromString(input: string) {
      return { documentElement: { textContent: decodeEntities(input) } } as any;
    }
  } as any;

  const { prepareMarkdownToken } = await import('../../web/src/markdown.ts');
  const token={type:'html',text:'<ruby>状況把握<rt>じょうきょうはあく</rt></ruby><br/><span lang="ja" title="x > y">日本語</span>'};
  prepareMarkdownToken(token);const safeHtml=token.text;

  expect(safeHtml).toContain('<ruby>状況把握<rt>じょうきょうはあく</rt></ruby>');
  expect(safeHtml).toContain('<br>');
  expect(safeHtml).toContain('<span lang="ja" title="x &gt; y">日本語</span>');
  expect(safeHtml).not.toContain('&lt;ruby&gt;');
  expect(safeHtml).not.toContain('&lt;br/');
  expect(safeHtml).not.toContain('&lt;span');
});

test('prepareMarkdownSource rewrites leading YAML frontmatter into a fenced yaml block', async () => {
  globalThis.DOMParser = class {
    parseFromString(input: string) {
      return { documentElement: { textContent: decodeEntities(input) } } as any;
    }
  } as any;

  const { prepareMarkdownSource } = await import('../../web/src/markdown.ts');
  const { safeHtml } = prepareMarkdownSource('---\ntitle: Test\ntags:\n  - demo\n---\n\n# Hello');

  expect(safeHtml).toContain('```yaml');
  expect(safeHtml).toContain('title: Test');
  expect(safeHtml).toContain('tags:');
  expect(safeHtml).toContain('- demo');
  expect(safeHtml).toContain('# Hello');
});

test('applySyntaxHighlighting tags leading frontmatter code blocks for compact preview styling', async () => {
  globalThis.DOMParser = class {
    parseFromString(input: string) {
      return { documentElement: { textContent: decodeEntities(input) } } as any;
    }
  } as any;

  const { applySyntaxHighlighting } = await import('../../web/src/markdown.ts');
  const highlighted = applySyntaxHighlighting('<!--frontmatter-block-start--><pre><code class="language-yaml">title: Test\ntags:\n  - demo\n</code></pre><!--frontmatter-block-end-->');

  expect(highlighted).toContain('<pre class="frontmatter-block"><code class="hljs language-yaml">');
  expect(highlighted).not.toContain('frontmatter-block-start');
  expect(highlighted).not.toContain('frontmatter-block-end');
});

test('applySyntaxHighlighting adds token spans for supported fenced languages', async () => {
  globalThis.DOMParser = class {
    parseFromString(input: string) {
      return { documentElement: { textContent: decodeEntities(input) } } as any;
    }
  } as any;

  const { applySyntaxHighlighting } = await import('../../web/src/markdown.ts');
  const highlighted = applySyntaxHighlighting('<pre><code class="language-js">const answer = 42;</code></pre>');

  expect(highlighted).toContain('class="hljs language-js"');
  expect(highlighted).toContain('tok-keyword');
  expect(highlighted).toContain('tok-variableName');
  expect(highlighted).toContain('42');
});

test('applySyntaxHighlighting falls back to escaped plaintext for unsupported languages', async () => {
  globalThis.DOMParser = class {
    parseFromString(input: string) {
      return { documentElement: { textContent: decodeEntities(input) } } as any;
    }
  } as any;

  const { applySyntaxHighlighting } = await import('../../web/src/markdown.ts');
  const highlighted = applySyntaxHighlighting('<pre><code class="language-unknown">&lt;tag&gt;</code></pre>');

  expect(highlighted).toContain('class="hljs language-unknown"');
  expect(highlighted).toContain('&lt;tag&gt;');
  expect(highlighted).not.toContain('tok-keyword');
  expect(highlighted).not.toContain('<span class="tok-');
});

test('isSanitizedHtmlAttributeAllowed rejects inline style while preserving safe attrs', async () => {
  const { isSanitizedHtmlAttributeAllowed } = await import('../../web/src/markdown.ts');

  expect(isSanitizedHtmlAttributeAllowed('span', 'style')).toBe(false);
  expect(isSanitizedHtmlAttributeAllowed('span', 'title')).toBe(true);
  expect(isSanitizedHtmlAttributeAllowed('a', 'href')).toBe(true);
  expect(isSanitizedHtmlAttributeAllowed('img', 'src')).toBe(true);
  expect(isSanitizedHtmlAttributeAllowed('span', 'aria-label')).toBe(true);
  expect(isSanitizedHtmlAttributeAllowed('span', 'onclick')).toBe(false);
});

test('renderMarkdown honors sanitize: false for trusted surfaces', async () => {
  installSimpleHtmlDomParser();
  globalThis.window = {
    marked: {
      parse: () => '<a href="javascript:alert(1)">trusted</a>',
    },
  } as any;
  globalThis.marked = globalThis.window.marked;

  const { renderMarkdown } = await import('../../web/src/markdown.ts');

  expect(renderMarkdown('trusted', null)).toBe('<a>trusted</a>');
  expect(renderMarkdown('trusted', null, { sanitize: false })).toBe('<a href="javascript:alert(1)">trusted</a>');
});
