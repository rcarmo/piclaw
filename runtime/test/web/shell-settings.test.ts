import { afterEach, describe, expect, test } from 'bun:test';

import { h, render } from '../../web/src/vendor/preact-htm.js';
import {
  registerShellSurface,
  resetShellSurfaceRegistryForTests,
  setShellSurfaceGeometry,
  setShellSurfaceVisible,
} from '../../web/src/ui/shell-surface-registry.js';
import { ShellSection } from '../../web/src/components/settings/shell.js';

class MemoryStorage {
  store = new Map<string, string>();

  get length() { return this.store.size; }
  key(index: number) { return Array.from(this.store.keys())[index] || null; }
  getItem(key: string) { return this.store.has(key) ? this.store.get(key)! : null; }
  setItem(key: string, value: string) { this.store.set(key, String(value)); }
  removeItem(key: string) { this.store.delete(key); }
  clear() { this.store.clear(); }
}

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
  style = { cssText: '', setProperty: () => {}, removeProperty: () => {} };
  listeners = new Map<string, Array<(event: any) => void>>();
  checked = false;
  disabled = false;
  id = '';
  value = '';
  type = '';
  l?: Record<string, unknown>;

  constructor(ownerDocument: FakeDocument, tagName: string, namespaceURI = 'http://www.w3.org/1999/xhtml') {
    super(ownerDocument, 1, namespaceURI);
    this.tagName = tagName.toUpperCase();
    this.localName = tagName.toLowerCase();
  }

  get firstChild(): FakeNode | null { return this.childNodes[0] || null; }

  appendChild(child: FakeNode): FakeNode { return this.insertBefore(child, null); }

  insertBefore(child: FakeNode, referenceNode: FakeNode | null): FakeNode {
    if (child.parentNode) child.parentNode.removeChild(child);
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

  setAttribute(name: string, value: string) {
    const stringValue = String(value);
    if (name === 'id') this.id = stringValue;
    if (name === 'type') this.type = stringValue;
    const existing = this.attributes.find((entry) => entry.name === name);
    if (existing) existing.value = stringValue;
    else this.attributes.push({ name, value: stringValue });
  }

  removeAttribute(name: string) {
    if (name === 'id') this.id = '';
    this.attributes = this.attributes.filter((entry) => entry.name !== name);
  }

  addEventListener(type: string, listener: (event: any) => void) {
    const listeners = this.listeners.get(type) || [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }

  removeEventListener(type: string, listener: (event: any) => void) {
    this.listeners.set(type, (this.listeners.get(type) || []).filter((entry) => entry !== listener));
  }

  dispatchEvent(event: any) {
    event.target ||= this;
    event.currentTarget = this;
    for (const listener of this.listeners.get(event.type) || []) listener.call(this, event);
    return true;
  }
}

class FakeDocument {
  body: FakeElement;
  documentElement: FakeElement;

  constructor() {
    this.documentElement = new FakeElement(this, 'html');
    this.body = new FakeElement(this, 'body');
    this.documentElement.appendChild(this.body);
  }

  createElement(tagName: string): FakeElement { return new FakeElement(this, tagName); }
  createElementNS(namespaceURI: string, tagName: string): FakeElement { return new FakeElement(this, tagName, namespaceURI); }
  createTextNode(text: string): FakeTextNode { return new FakeTextNode(this, text); }
  addEventListener() {}
  removeEventListener() {}
}

const originalWindow = (globalThis as any).window;
const originalDocument = (globalThis as any).document;
const originalElement = (globalThis as any).Element;
const originalLocalStorage = (globalThis as any).localStorage;

function installDom() {
  const document = new FakeDocument();
  const localStorage = new MemoryStorage();
  (globalThis as any).document = document;
  (globalThis as any).window = {
    document,
    localStorage,
    dispatchEvent: () => true,
    addEventListener: () => {},
    removeEventListener: () => {},
  };
  (globalThis as any).Element = FakeElement;
  (globalThis as any).localStorage = localStorage;
  return { document, localStorage };
}

function collectText(node: FakeNode | null): string {
  if (!node) return '';
  if (node instanceof FakeTextNode) return node.data;
  if (!(node instanceof FakeElement)) return '';
  return node.childNodes.map((child) => collectText(child)).join('');
}

function findElements(node: FakeNode | null, predicate: (node: FakeElement) => boolean): FakeElement[] {
  if (!node || !(node instanceof FakeElement)) return [];
  const matches = predicate(node) ? [node] : [];
  return [...matches, ...node.childNodes.flatMap((child) => findElements(child, predicate))];
}

function registerTestSurface(overrides: Record<string, unknown>) {
  return registerShellSurface({
    id: 'addon.panel',
    slot: 'dock.panel',
    label: 'Addon Panel',
    owner: 'addon',
    kind: 'configurable',
    order: 20,
    defaultVisible: true,
    render: () => null,
    ...overrides,
  } as any);
}

function restoreGlobal(name: string, value: unknown) {
  if (value === undefined) {
    delete (globalThis as any)[name];
    return;
  }
  (globalThis as any)[name] = value;
}

afterEach(() => {
  resetShellSurfaceRegistryForTests();
  restoreGlobal('window', originalWindow);
  restoreGlobal('document', originalDocument);
  restoreGlobal('Element', originalElement);
  restoreGlobal('localStorage', originalLocalStorage);
});

describe('ShellSection', () => {
  test('lists shell surfaces with label, id, slot, owner, and kind', () => {
    const { document } = installDom();
    registerTestSurface({ id: 'addon.timeline', slot: 'timeline.above', label: 'Timeline Addon', owner: 'addon', kind: 'additive' });

    const host = document.createElement('div');
    document.body.appendChild(host);
    render(h(ShellSection, {}), host);

    const text = collectText(host);
    expect(text).toContain('Timeline Addon');
    expect(text).toContain('addon.timeline');
    expect(text).toContain('timeline.above');
    expect(text).toContain('addon / additive');

    render(null, host);
  });

  test('toggles configurable surfaces and persists namespaced visibility keys', () => {
    const { document, localStorage } = installDom();
    registerTestSurface({ id: 'addon.panel', kind: 'configurable', defaultVisible: true });

    const host = document.createElement('div');
    document.body.appendChild(host);
    render(h(ShellSection, {}), host);

    const input = findElements(host, (node) => node.localName === 'input' && node.id === 'shell-surface-addon.panel')[0];
    expect(input.disabled).toBe(false);
    expect(input.checked).toBe(true);

    input.checked = false;
    input.dispatchEvent({ type: 'Change' });

    expect(localStorage.getItem('piclaw.shell.surface.addon.panel.visible')).toBe('false');

    render(null, host);
  });

  test('reset controls clear configurable visibility and geometry keys', () => {
    const { document, localStorage } = installDom();
    registerTestSurface({ id: 'addon.panel', kind: 'configurable', defaultVisible: true });
    setShellSurfaceVisible('addon.panel', false);
    setShellSurfaceGeometry('addon.panel', { width: 420 });

    const host = document.createElement('div');
    document.body.appendChild(host);
    render(h(ShellSection, {}), host);

    const buttons = findElements(host, (node) => node.localName === 'button');
    const resetVisibility = buttons.find((node) => collectText(node).includes('Reset visibility'));
    const resetGeometry = buttons.find((node) => collectText(node).includes('Reset geometry'));

    resetVisibility?.dispatchEvent({ type: 'Click' });
    resetGeometry?.dispatchEvent({ type: 'Click' });

    expect(localStorage.getItem('piclaw.shell.surface.addon.panel.visible')).toBeNull();
    expect(localStorage.getItem('piclaw.shell.surface.addon.panel.geometry')).toBeNull();

    render(null, host);
  });

  test('renders required surfaces read-only', () => {
    const { document } = installDom();
    registerTestSurface({ id: 'core.status', label: 'Core Status', owner: 'core', kind: 'required', defaultVisible: true });

    const host = document.createElement('div');
    document.body.appendChild(host);
    render(h(ShellSection, {}), host);

    const input = findElements(host, (node) => node.localName === 'input' && node.id === 'shell-surface-core.status')[0];
    expect(input.disabled).toBe(true);
    expect(collectText(host)).toContain('Core Status');
    expect(collectText(host)).toContain('core / required');

    render(null, host);
  });
});
