import { afterEach, expect, test } from 'bun:test';

import { importFresh, waitFor } from '../helpers.js';

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
    if (index >= 0) this.childNodes.splice(index, 0, child);
    else this.childNodes.push(child);
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

  remove() {
    this.parentNode?.removeChild(this);
  }

  setAttribute(name: string, value: string) {
    const existing = this.attributes.find((entry) => entry.name === name);
    if (existing) existing.value = value;
    else this.attributes.push({ name, value });
  }

  getAttribute(name: string) {
    return this.attributes.find((entry) => entry.name === name)?.value ?? null;
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

function flattenText(node: FakeNode | null): string {
  if (!node) return '';
  if (node instanceof FakeTextNode) return node.data;
  if (node instanceof FakeElement) return node.childNodes.map((child) => flattenText(child)).join('');
  return '';
}

function findByClass(node: FakeNode | null, className: string): FakeElement | null {
  if (!node) return null;
  if (node instanceof FakeElement) {
    const cls = node.getAttribute('class') || '';
    if (cls.split(/\s+/).includes(className)) return node;
    for (const child of node.childNodes) {
      const found = findByClass(child, className);
      if (found) return found;
    }
  }
  return null;
}

const originalDocument = (globalThis as any).document;
const originalWindow = (globalThis as any).window;
const originalElement = (globalThis as any).Element;

afterEach(() => {
  (globalThis as any).document = originalDocument;
  (globalThis as any).window = originalWindow;
  (globalThis as any).Element = originalElement;
});

test('BodyPortal mounts portal children into a body host after the host is created', async () => {
  const fakeDocument = new FakeDocument();
  (globalThis as any).document = fakeDocument;
  (globalThis as any).window = { document: fakeDocument };
  (globalThis as any).Element = FakeElement;

  const { BodyPortal } = await importFresh<typeof import('../../web/src/components/body-portal.ts')>('../web/src/components/body-portal.ts');
  const { h, render } = await import('../../web/src/vendor/preact-htm.js');

  const host = fakeDocument.createElement('div');
  fakeDocument.body.appendChild(host);

  render(h(BodyPortal, { className: 'portal-host' }, h('div', { class: 'portal-child' }, 'hello portal')), host);

  await waitFor(() => Boolean(findByClass(fakeDocument.body, 'portal-child')), 1000, 10);

  const portalChild = findByClass(fakeDocument.body, 'portal-child');
  expect(fakeDocument.body.childNodes.length).toBeGreaterThan(1);
  expect(portalChild).toBeTruthy();
  expect(flattenText(portalChild)).toBe('hello portal');
});
