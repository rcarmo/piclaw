import { afterEach, expect, test } from 'bun:test';

const previousWindow = globalThis.window;
const previousKatex = globalThis.katex;
const previousDOMParser = globalThis.DOMParser;

function installDomParserStub() {
  globalThis.DOMParser = class {
    parseFromString(input: string) {
      return { documentElement: { textContent: input }, body: { innerHTML: input } } as any;
    }
  } as any;
}

afterEach(() => {
  if (previousWindow === undefined) {
    delete globalThis.window;
  } else {
    globalThis.window = previousWindow;
  }
  if (previousKatex === undefined) {
    delete globalThis.katex;
  } else {
    globalThis.katex = previousKatex;
  }
  if (previousDOMParser === undefined) {
    delete globalThis.DOMParser;
  } else {
    globalThis.DOMParser = previousDOMParser;
  }
});

test('renderMath leaves inline currency values alone even when KaTeX is available', async () => {
  const katexStub = {
    renderToString: (tex: string, options: { displayMode?: boolean }) => `<span data-display="${options?.displayMode ? 'true' : 'false'}">${tex}</span>`,
  };
  globalThis.window = { katex: katexStub } as any;
  globalThis.katex = katexStub as any;
  installDomParserStub();

  const { renderMath } = await import('../../web/src/markdown.ts');
  const input = '<p>649 <strong>standalone</strong> $899 with AMS.</p>';

  expect(renderMath(input)).toBe(input);
});

test('renderMath still renders block math fences with KaTeX', async () => {
  const katexStub = {
    renderToString: (tex: string, options: { displayMode?: boolean }) => `<span class="katex" data-display="${options?.displayMode ? 'true' : 'false'}">${tex}</span>`,
  };
  globalThis.window = { katex: katexStub } as any;
  globalThis.katex = katexStub as any;
  installDomParserStub();

  const { renderMath } = await import('../../web/src/markdown.ts');
  const input = '<p>$$x + y$$</p>';
  const output = renderMath(input);

  expect(output).toContain('class="katex"');
  expect(output).toContain('data-display="true"');
  expect(output).not.toContain('$$x + y$$');
});
