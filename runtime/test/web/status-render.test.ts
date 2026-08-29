import { afterEach, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { importFresh } from '../helpers.js';

class FakeNode {
  parentNode: FakeElement | null = null;
  ownerDocument: FakeDocument;
  namespaceURI: string;
  nodeType: number;

  constructor(ownerDocument: FakeDocument, nodeType: number, namespaceURI = 'http://www.w3.org/1999/xhtml') {
    this.ownerDocument = ownerDocument;
    this.nodeType = nodeType;
    this.namespaceURI = namespaceURI;
  }

  get nextSibling(): FakeNode | null {
    const parent = this.parentNode;
    if (!parent) return null;
    const index = parent.childNodes.indexOf(this);
    if (index < 0) return null;
    return parent.childNodes[index + 1] || null;
  }
}

class FakeTextNode extends FakeNode {
  data: string;

  constructor(ownerDocument: FakeDocument, text: string) {
    super(ownerDocument, 3);
    this.data = text;
  }
}

class FakeElement extends FakeNode {
  tagName: string;
  localName: string;
  childNodes: FakeNode[] = [];
  attributes: Array<{ name: string; value: string }> = [];
  innerHTML = '';
  style = {
    cssText: '',
    setProperty: () => {},
    removeProperty: () => {},
  };
  l?: Record<string, unknown>;

  constructor(ownerDocument: FakeDocument, tagName: string, namespaceURI = 'http://www.w3.org/1999/xhtml') {
    super(ownerDocument, 1, namespaceURI);
    this.tagName = tagName.toUpperCase();
    this.localName = tagName.toLowerCase();
  }

  get firstChild(): FakeNode | null {
    return this.childNodes[0] || null;
  }

  appendChild(child: FakeNode): FakeNode {
    return this.insertBefore(child, null);
  }

  insertBefore(child: FakeNode, referenceNode: FakeNode | null): FakeNode {
    if (child.parentNode) {
      child.parentNode.removeChild(child);
    }
    child.parentNode = this;
    const index = referenceNode ? this.childNodes.indexOf(referenceNode) : -1;
    if (index >= 0) {
      this.childNodes.splice(index, 0, child);
    } else {
      this.childNodes.push(child);
    }
    return child;
  }

  removeChild(child: FakeNode): FakeNode {
    const index = this.childNodes.indexOf(child);
    if (index >= 0) {
      this.childNodes.splice(index, 1);
      child.parentNode = null;
    }
    return child;
  }

  setAttribute(name: string, value: string) {
    const existing = this.attributes.find((entry) => entry.name === name);
    if (existing) existing.value = value;
    else this.attributes.push({ name, value });
  }

  removeAttribute(name: string) {
    this.attributes = this.attributes.filter((entry) => entry.name !== name);
  }

  addEventListener() {}

  removeEventListener() {}
}

class FakeDocument {
  body: FakeElement;
  documentElement: FakeElement;

  constructor() {
    this.documentElement = new FakeElement(this, 'html');
    this.body = new FakeElement(this, 'body');
    this.documentElement.appendChild(this.body);
  }

  createElement(tagName: string): FakeElement {
    return new FakeElement(this, tagName);
  }

  createElementNS(namespaceURI: string, tagName: string): FakeElement {
    return new FakeElement(this, tagName, namespaceURI);
  }

  createTextNode(text: string): FakeTextNode {
    return new FakeTextNode(this, text);
  }

  addEventListener() {}

  removeEventListener() {}
}

const originalWindow = (globalThis as any).window;
const originalDocument = (globalThis as any).document;
const originalElement = (globalThis as any).Element;
const originalDOMParser = (globalThis as any).DOMParser;
const originalNodeFilter = (globalThis as any).NodeFilter;
const originalGetComputedStyle = (globalThis as any).getComputedStyle;

afterEach(() => {
  (globalThis as any).window = originalWindow;
  (globalThis as any).document = originalDocument;
  (globalThis as any).Element = originalElement;
  (globalThis as any).DOMParser = originalDOMParser;
  (globalThis as any).NodeFilter = originalNodeFilter;
  (globalThis as any).getComputedStyle = originalGetComputedStyle;
});

test('thought, draft, and live tool-output panels scroll with their configured line limits', () => {
  const css = readFileSync(join(import.meta.dir, '../../web/static/classic/css/agent.css'), 'utf8');
  expect(css).toContain('.agent-thinking[data-panel-key="thought"] .agent-thinking-body-collapsible');
  expect(css).toContain('.agent-thinking[data-panel-key="draft"] .agent-thinking-body-collapsible');
  expect(css).toContain('.agent-thinking[data-panel-key="tool-output"] .agent-thinking-body-collapsible');
  expect(css).toContain('overflow: hidden auto;');
  expect(css).not.toContain('max-height: min(52vh, 34rem);');
  expect(css).not.toContain('max-height: min(34vh, 22rem);');
  expect(css).toContain('max-height: calc((var(--agent-thinking-line-height) * 1em * var(--agent-thinking-collapsed-lines, 9)) + 0.4em);');
  expect(css).toContain('min-height: calc((var(--agent-thinking-line-height) * 1em * var(--agent-thinking-collapsed-lines, 6)) + 0.4em);');
  expect(css).toContain('.agent-thinking[data-panel-key="tool-output"] .agent-thinking-body');
  expect(css).toContain('--agent-intent-tool-argument-font-size: 0.9em;');
  expect(css).toContain('--agent-tool-output-font-size: 0.8em;');
  expect(css).toContain('font-family: var(--font-mono, monospace);');
  expect(css).toContain('font-size: var(--agent-tool-output-font-size, 0.8em);');
  expect(css).toContain('.agent-thinking-truncation');
  expect(css).toContain('border-radius: 999px;');
  expect(css).toContain('.agent-thinking-truncation-arrow');
  expect(css).toContain('min-width: var(--ui-disclosure-triangle-size);');
});

test('thinking and draft panels use 9 lines while tool output uses 6 lines', () => {
  const source = readFileSync(join(import.meta.dir, '../../web/src/components/status.ts'), 'utf8');
  expect(source).toContain('const THOUGHT_MAX_LINES = 9;');
  expect(source).toContain('const DRAFT_MAX_LINES = 9;');
  expect(source).toContain('const TOOL_OUTPUT_MAX_LINES = 6;');
  expect(source).toContain('maxLines: TOOL_OUTPUT_MAX_LINES');
});

test('thinking panel markdown tables match post table formatting while inheriting pane text attributes', () => {
  const css = readFileSync(join(import.meta.dir, '../../web/static/classic/css/agent.css'), 'utf8');
  expect(css).toContain('.agent-thinking-body table');
  expect(css).toContain('.agent-thinking-body th,');
  expect(css).toContain('.agent-thinking-body td');
  expect(css).toContain('border-collapse: collapse;');
  expect(css).toContain('padding: 0.4em 0.75em;');
  expect(css).toContain('background: var(--bg-secondary);');
  expect(css).toContain('.agent-thinking-body tbody tr:nth-child(even) td');
  expect(css).toContain('.agent-thinking-body tbody tr:nth-child(odd) td');
  expect(css).toContain('font-family: inherit;');
  expect(css).toContain('font-size: inherit;');
  expect(css).toContain('color: inherit;');
});

test('collapsed tool output lines are capped at 132 characters with an ellipsis', async () => {
  const statusModule = await importFresh<typeof import('../../web/src/components/status.ts')>('../web/src/components/status.ts');
  const longLine = 'x'.repeat(140);
  const formatted = statusModule.truncateCollapsedToolOutputLines(`short\n${longLine}`);
  expect(formatted).toBe(`short\n${'x'.repeat(132)}…`);
});

test('AgentStatus renders generic active Working rows with an animated indicator', async () => {
  const fakeDocument = new FakeDocument();
  installStatusDomStubs(fakeDocument);

  const { AgentStatus } = await importFresh<typeof import('../../web/src/components/status.ts')>('../web/src/components/status.ts');
  const { h, render } = await import('../../web/src/vendor/preact-htm.js');

  const host = fakeDocument.createElement('div');
  fakeDocument.body.appendChild(host);

  render(h(AgentStatus, {
    status: { type: 'active', title: 'Working...' },
    turnId: 'turn-working',
  }), host);

  expect(collectText(host)).toContain('Working...');
  const dots = findElements(host, (node) => getAttr(node, 'class').includes('turn-dot'));
  expect(dots).toHaveLength(1);
  expect(getAttr(dots[0], 'class')).toContain('turn-dot-pulsing');

  render(null, host);
});

function collectInnerHtml(node: FakeNode | null): string[] {
  if (!node || !(node instanceof FakeElement)) return [];
  return [node.innerHTML, ...node.childNodes.flatMap((child) => collectInnerHtml(child))].filter(Boolean);
}

function collectText(node: FakeNode | null): string {
  if (!node) return '';
  if (node instanceof FakeTextNode) return node.data;
  if (!(node instanceof FakeElement)) return '';
  return node.childNodes.map((child) => collectText(child)).join('');
}

function getAttr(node: FakeElement, name: string): string {
  return node.attributes.find((attr) => attr.name === name)?.value || '';
}

function findElements(node: FakeNode | null, predicate: (node: FakeElement) => boolean): FakeElement[] {
  if (!node || !(node instanceof FakeElement)) return [];
  const matches = predicate(node) ? [node] : [];
  return [...matches, ...node.childNodes.flatMap((child) => findElements(child, predicate))];
}

function installStatusDomStubs(fakeDocument: FakeDocument): void {
  (globalThis as any).document = fakeDocument;
  (globalThis as any).window = { document: fakeDocument };
  (globalThis as any).Element = FakeElement;
  Object.defineProperty(globalThis, 'getComputedStyle', {
    configurable: true,
    value: () => ({ getPropertyValue: () => '' }),
  });
  (globalThis as any).NodeFilter = { SHOW_TEXT: 4 };
  (globalThis as any).DOMParser = class DOMParserStub {
    parseFromString(text: string) {
      return {
        documentElement: { textContent: text.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&') },
        body: { innerHTML: text },
        createTreeWalker: () => ({ nextNode: () => null }),
      };
    }
  };
}

test('AgentStatus renders bash tool command lines as generic monospace tool arguments', async () => {
  const css = readFileSync(join(import.meta.dir, '../../web/static/classic/css/agent.css'), 'utf8');
  expect(css).toContain('.agent-tool-argument');
  expect(css).toContain('font-family: var(--font-mono, monospace);');
  expect(css).toContain('.agent-thinking-intent .agent-tool-argument');
  expect(css).toContain('font-size: var(--agent-intent-tool-argument-font-size, 0.9em);');
  expect(css).toContain('.agent-tool-status-pill');
  expect(css).toContain('text-transform: lowercase;');

  const fakeDocument = new FakeDocument();
  installStatusDomStubs(fakeDocument);

  const { AgentStatus } = await importFresh<typeof import('../../web/src/components/status.ts')>('../web/src/components/status.ts');
  const { h, render } = await import('../../web/src/vendor/preact-htm.js');

  const host = fakeDocument.createElement('div');
  fakeDocument.body.appendChild(host);
  const command = 'bun test runtime/test/web/status-render.test.ts';

  render(h(AgentStatus, {
    status: {
      type: 'intent',
      title: `bash: ${command}`,
      tool_name: 'bash',
      tool_args: { command },
    },
  }), host);

  let commandSpans = findElements(host, (node) => getAttr(node, 'class').includes('agent-tool-argument'));
  expect(commandSpans).toHaveLength(1);
  expect(getAttr(commandSpans[0], 'class')).not.toContain('agent-tool-command-line');
  expect(collectText(commandSpans[0])).toBe(command);

  render(h(AgentStatus, {
    status: {
      type: 'tool_call',
      title: `bash: ${command}`,
      tool_name: 'bash',
      tool_args: { command },
    },
  }), host);

  commandSpans = findElements(host, (node) => getAttr(node, 'class').includes('agent-tool-argument'));
  expect(commandSpans).toHaveLength(1);
  expect(getAttr(commandSpans[0], 'class')).not.toContain('agent-tool-command-line');
  expect(collectText(commandSpans[0])).toBe(command);

  render(null, host);
});

test('AgentStatus renders non-bash tool title arguments in monospace spans', async () => {
  const fakeDocument = new FakeDocument();
  installStatusDomStubs(fakeDocument);

  const { AgentStatus } = await importFresh<typeof import('../../web/src/components/status.ts')>('../web/src/components/status.ts');
  const { h, render } = await import('../../web/src/vendor/preact-htm.js');

  const host = fakeDocument.createElement('div');
  fakeDocument.body.appendChild(host);
  const path = '/workspace/piclaw/runtime/web/src/components/status.ts';

  render(h(AgentStatus, {
    status: {
      type: 'intent',
      title: `read: ${path}`,
      tool_name: 'read',
      tool_args: { path },
    },
  }), host);

  let argumentSpans = findElements(host, (node) => getAttr(node, 'class').includes('agent-tool-argument'));
  expect(argumentSpans).toHaveLength(1);
  expect(collectText(argumentSpans[0])).toBe(path);

  render(h(AgentStatus, {
    status: {
      type: 'tool_call',
      title: `read: ${path}`,
      tool_name: 'read',
      tool_args: { path },
    },
  }), host);

  argumentSpans = findElements(host, (node) => getAttr(node, 'class').includes('agent-tool-argument'));
  expect(argumentSpans).toHaveLength(1);
  expect(collectText(argumentSpans[0])).toBe(path);

  const query = 'agent status monospace arguments';
  render(h(AgentStatus, {
    status: {
      type: 'intent',
      title: `grep: ${query}`,
      tool_name: 'grep',
      tool_args: { query },
    },
  }), host);

  argumentSpans = findElements(host, (node) => getAttr(node, 'class').includes('agent-tool-argument'));
  expect(argumentSpans).toHaveLength(1);
  expect(collectText(argumentSpans[0])).toBe(query);

  render(null, host);
});

test('AgentStatus renders trailing tool status text as lowercase pills', async () => {
  const fakeDocument = new FakeDocument();
  installStatusDomStubs(fakeDocument);

  const { AgentStatus } = await importFresh<typeof import('../../web/src/components/status.ts')>('../web/src/components/status.ts');
  const { h, render } = await import('../../web/src/vendor/preact-htm.js');

  const host = fakeDocument.createElement('div');
  fakeDocument.body.appendChild(host);
  const command = 'bun test runtime/test/web/status-render.test.ts';

  render(h(AgentStatus, {
    status: {
      type: 'tool_status',
      title: `bash: ${command}`,
      status: 'Working...',
      tool_name: 'bash',
      tool_args: { command },
    },
  }), host);

  const textOutput = collectText(host);
  expect(textOutput).toContain(`bash: ${command} working`);
  expect(textOutput).not.toContain(': Working...');
  let argumentSpans = findElements(host, (node) => getAttr(node, 'class').includes('agent-tool-argument'));
  expect(argumentSpans).toHaveLength(1);
  expect(collectText(argumentSpans[0])).toBe(command);
  let pills = findElements(host, (node) => getAttr(node, 'class').includes('agent-tool-status-pill'));
  expect(pills).toHaveLength(1);
  expect(collectText(pills[0])).toBe('working');

  render(h(AgentStatus, {
    status: {
      type: 'tool_status',
      status: 'Working...',
      tool_name: 'bash',
      tool_args: { command },
    },
  }), host);

  argumentSpans = findElements(host, (node) => getAttr(node, 'class').includes('agent-tool-argument'));
  expect(argumentSpans).toHaveLength(1);
  expect(collectText(argumentSpans[0])).toBe(command);

  render(h(AgentStatus, {
    status: {
      type: 'intent',
      title: `bash: ${command}: Working...`,
      status: 'Working...',
      tool_name: 'bash',
      tool_args: { command },
    },
  }), host);

  let spinners = findElements(host, (node) => getAttr(node, 'class').includes('agent-status-spinner'));
  let turnDots = findElements(host, (node) => getAttr(node, 'class').split(/\s+/).includes('turn-dot'));
  pills = findElements(host, (node) => getAttr(node, 'class').includes('agent-tool-status-pill'));
  expect(spinners).toHaveLength(1);
  expect(turnDots).toHaveLength(0);
  expect(pills).toHaveLength(1);
  expect(collectText(pills[0])).toBe('working');

  render(h(AgentStatus, {
    status: {
      type: 'intent',
      title: `bash: ${command}: Failed`,
      status: 'Failed',
      tool_name: 'bash',
      tool_args: { command },
    },
  }), host);

  pills = findElements(host, (node) => getAttr(node, 'class').includes('agent-tool-status-pill'));
  expect(pills).toHaveLength(1);
  expect(collectText(pills[0])).toBe('failed');
  expect(collectText(host)).toContain(`bash: ${command} failed`);
  expect(collectText(host)).not.toContain(': Failed');

  render(h(AgentStatus, {
    status: {
      type: 'tool_call',
      title: 'mcp: memento → memory_search',
      tool_name: 'mcp',
      tool_args: { server: 'memento', tool: 'memory_search' },
      mcp_operation: 'call',
      mcp_server: 'memento',
      mcp_tool: 'memory_search',
    },
  }), host);

  const mcpText = collectText(host);
  expect(mcpText).toContain('mcp: memento → memory_search');
  expect(mcpText).not.toBe('mcp');

  render(null, host);
});

test('AgentStatus labels tool output as Output and shows the tail while collapsed', async () => {
  const fakeDocument = new FakeDocument();
  installStatusDomStubs(fakeDocument);

  const { AgentStatus } = await importFresh<typeof import('../../web/src/components/status.ts')>('../web/src/components/status.ts');
  const { h, render } = await import('../../web/src/vendor/preact-htm.js');

  const host = fakeDocument.createElement('div');
  fakeDocument.body.appendChild(host);
  const output = Array.from({ length: 7 }, (_, index) => `line ${index + 1}`).join('\n');

  render(h(AgentStatus, {
    status: {
      type: 'tool_status',
      title: 'bash',
      status: 'Streaming output...',
      output_preview: output,
      output_total_lines: 7,
    },
  }), host);

  const textOutput = collectText(host);
  expect(textOutput).toContain('Output');
  expect(textOutput).not.toContain('bash: Streaming output...');

  const htmlOutput = collectInnerHtml(host).join('\n');
  expect(htmlOutput).toContain('line 2');
  expect(htmlOutput).toContain('line 7');
  expect(htmlOutput).not.toContain('line 1');

  render(null, host);
});

test('AgentStatus preserves leading tool-output blanks and trims only trailing blanks for display', async () => {
  const fakeDocument = new FakeDocument();
  installStatusDomStubs(fakeDocument);

  const { AgentStatus } = await importFresh<typeof import('../../web/src/components/status.ts')>('../web/src/components/status.ts');
  const { h, render } = await import('../../web/src/vendor/preact-htm.js');

  const host = fakeDocument.createElement('div');
  fakeDocument.body.appendChild(host);
  const output = '\n\n  indented output\nplain output\n\n  \t  ';

  render(h(AgentStatus, {
    status: {
      type: 'tool_status',
      title: 'bash',
      status: 'Streaming output...',
      output_preview: output,
      output_total_lines: output.split('\n').length,
    },
  }), host);

  const body = findElements(host, (node) => getAttr(node, 'data-panel-key') === 'tool-output')[0];
  expect(body).toBeDefined();
  const htmlOutput = collectInnerHtml(body).join('\n');
  expect(htmlOutput).toContain('<br><br>  indented output');
  expect(htmlOutput).toContain('plain output');
  expect(htmlOutput).not.toContain('plain output<br><br>');

  render(null, host);
});

test('AgentStatus keeps short tool-output collapsed height without a hidden more-lines row', async () => {
  const fakeDocument = new FakeDocument();
  installStatusDomStubs(fakeDocument);

  const { AgentStatus } = await importFresh<typeof import('../../web/src/components/status.ts')>('../web/src/components/status.ts');
  const { h, render } = await import('../../web/src/vendor/preact-htm.js');

  const host = fakeDocument.createElement('div');
  fakeDocument.body.appendChild(host);

  render(h(AgentStatus, {
    status: {
      type: 'tool_status',
      title: 'bash',
      status: 'Streaming output...',
      output_preview: 'line 1\nline 2',
      output_total_lines: 2,
    },
  }), host);

  const toolPanel = findElements(host, (node) => getAttr(node, 'data-panel-key') === 'tool-output')[0];
  expect(toolPanel).toBeDefined();
  const truncationButtons = findElements(toolPanel, (node) => getAttr(node, 'class').includes('agent-thinking-truncation'));
  const body = findElements(toolPanel, (node) => getAttr(node, 'class').includes('agent-thinking-body'))[0];

  expect(truncationButtons).toHaveLength(0);
  expect(body).toBeDefined();

  render(null, host);
});

test('AgentStatus truncates long collapsed tool-output lines and places more-lines pill in the title row', async () => {
  const fakeDocument = new FakeDocument();
  installStatusDomStubs(fakeDocument);

  const { AgentStatus } = await importFresh<typeof import('../../web/src/components/status.ts')>('../web/src/components/status.ts');
  const { h, render } = await import('../../web/src/vendor/preact-htm.js');

  const host = fakeDocument.createElement('div');
  fakeDocument.body.appendChild(host);
  const longTailLine = `line 7 ${'x'.repeat(140)}`;
  const output = Array.from({ length: 7 }, (_, index) => index === 6 ? longTailLine : `line ${index + 1}`).join('\n');

  render(h(AgentStatus, {
    status: {
      type: 'tool_status',
      title: 'bash',
      status: 'Streaming output...',
      output_preview: output,
      output_total_lines: 7,
    },
  }), host);

  const toolPanel = findElements(host, (node) => getAttr(node, 'data-panel-key') === 'tool-output')[0];
  expect(toolPanel).toBeDefined();
  const directElementChildren = toolPanel.childNodes.filter((child): child is FakeElement => child instanceof FakeElement);
  const title = directElementChildren.find((node) => getAttr(node, 'class').includes('agent-thinking-title'));
  const bodyIndex = directElementChildren.findIndex((node) => getAttr(node, 'class').includes('agent-thinking-body'));
  const titleIndex = directElementChildren.findIndex((node) => node === title);
  const truncationButton = title && findElements(title, (node) => getAttr(node, 'class').includes('agent-thinking-truncation'))[0];

  expect(title).toBeDefined();
  expect(truncationButton).toBeDefined();
  expect(getAttr(truncationButton!, 'class')).toContain('agent-thinking-truncation');
  const triangle = findElements(truncationButton!, (node) => getAttr(node, 'class').includes('ui-disclosure-triangle-down'))[0];
  expect(triangle).toBeDefined();
  expect(collectText(truncationButton!)).toContain('more…');
  expect(bodyIndex).toBeGreaterThan(-1);
  expect(titleIndex).toBeGreaterThan(-1);
  expect(titleIndex).toBeLessThan(bodyIndex);

  const htmlOutput = collectInnerHtml(host).join('\n');
  expect(htmlOutput).toContain(`${longTailLine.slice(0, 132)}…`);
  expect(htmlOutput).not.toContain(longTailLine);

  render(null, host);
});

test('AgentStatus can toggle between hidden and visible renders without hook-order failures', async () => {
  const fakeDocument = new FakeDocument();
  (globalThis as any).document = fakeDocument;
  (globalThis as any).window = { document: fakeDocument };
  (globalThis as any).Element = FakeElement;

  const { AgentStatus } = await importFresh<typeof import('../../web/src/components/status.ts')>('../web/src/components/status.ts');
  const { h, render } = await import('../../web/src/vendor/preact-htm.js');

  const host = fakeDocument.createElement('div');
  fakeDocument.body.appendChild(host);

  expect(() => {
    render(h(AgentStatus, { showCorePanels: false, showExtensionPanels: false }), host);
    render(h(AgentStatus, { status: { type: 'thinking', title: 'Working...' } }), host);
    render(h(AgentStatus, { showCorePanels: false, showExtensionPanels: false }), host);
  }).not.toThrow();
});
