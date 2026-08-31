import { afterEach, expect, test } from 'bun:test';

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

  getAttribute(name: string) {
    return this.attributes.find((entry) => entry.name === name)?.value ?? null;
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

const originalWindow = (globalThis as any).window;
const originalDocument = (globalThis as any).document;
const originalElement = (globalThis as any).Element;

afterEach(() => {
  (globalThis as any).window = originalWindow;
  (globalThis as any).document = originalDocument;
  (globalThis as any).Element = originalElement;
});

async function renderPostWithBlocks(contentBlocks: any[], options: { content?: string; type?: string } = {}) {
  const fakeDocument = new FakeDocument();
  (globalThis as any).document = fakeDocument;
  (globalThis as any).window = {
    document: fakeDocument,
    open: () => null,
    setTimeout,
    clearTimeout,
    location: { href: 'https://example.test/' },
    sessionStorage: {
      getItem: () => null,
      setItem: () => {},
      removeItem: () => {},
    },
  };
  (globalThis as any).Element = FakeElement;

  const { Post } = await importFresh<typeof import('../../web/src/components/post.ts')>('../web/src/components/post.ts');
  const { h, render } = await import('../../web/src/vendor/preact-htm.js');

  const host = fakeDocument.createElement('div');
  fakeDocument.body.appendChild(host);

  render(h(Post, {
    post: {
      id: 42,
      timestamp: '2026-04-21T12:00:00.000Z',
      chat_jid: 'web:default',
      data: {
        type: options.type || 'agent_response',
        content: options.content || '',
        content_blocks: contentBlocks,
        media_ids: [],
      },
    },
    onClick: () => {},
    onHashtagClick: () => {},
    onMessageRef: () => {},
    onScrollToMessage: () => {},
    agentName: 'Pi',
    agentAvatarUrl: null,
    userName: 'You',
    userAvatarUrl: null,
    userAvatarBackground: null,
    onDelete: () => {},
    isThreadReply: false,
    isThreadPrev: false,
    isThreadNext: false,
    isRemoving: false,
    highlightQuery: '',
    onFileRef: () => {},
    onOpenWidget: () => {},
    onOpenAttachmentPreview: () => {},
  }), host);

  return host;
}

test('Post keeps a typed protected-recovery control intent invisible', async () => {
  const host = await renderPostWithBlocks([{
    type: 'control_intent',
    intent: 'protected_recovery_continuation',
    schema_version: 1,
    label: 'Recovery resumed with execution tools',
    source_message_id: 'source-123',
    source_row_id: 41,
    thread_id: 41,
    handoff_depth: 1,
    reason: 'post_compaction_tools_required',
    compaction: 'succeeded',
    tools_required: true,
    retryable: true,
    recovery_attempts: 2,
  }], {
    type: 'user_message',
    content: 'Recovery resumed with execution tools',
  });

  expect(findByClass(host, 'post-control-intent')).toBeNull();
  expect(findByClass(host, 'post-control-intent-pill')).toBeNull();
  expect(flattenText(host)).toBe('');
});

test('Post hides an empty successful protected-recovery placeholder', async () => {
  const host = await renderPostWithBlocks([{
    type: 'turn_outcome_marker',
    kind: 'recovery',
    label: 'recovery',
    title: 'Recovery resumed with execution tools',
    detail: 'Continuing in an ordinary turn with execution tools restored.',
    severity: 'info',
  }], {
    type: 'agent_response',
    content: '',
  });

  expect(findByClass(host, 'post-outcome-pill')).toBeNull();
  expect(findByClass(host, 'post-outcome-chip')).toBeNull();
  expect(flattenText(host)).toBe('');
});

test('Post renders a typed terminal protected-recovery outcome with deterministic wording', async () => {
  const host = await renderPostWithBlocks([{
    type: 'turn_outcome_marker',
    kind: 'recovery',
    label: 'tools required',
    title: 'Automatic recovery paused after successful compaction',
    detail: 'Compaction succeeded, but the unfinished task still requires execution tools. The session is preserved.',
    severity: 'warning',
    reason: 'post_compaction_tools_required',
    compaction: 'succeeded',
    tools_required: true,
    retryable: true,
    recovery_attempts: 2,
  }], {
    type: 'agent_response',
    content: '',
  });

  expect(findByClass(host, 'post-outcome-pill')).toBeTruthy();
  expect(findByClass(host, 'post-outcome-chip')).toBeTruthy();
  expect(flattenText(host)).toContain('Automatic recovery paused after successful compaction');
});

test('protected recovery requires typed control intent instead of interpreting user prose', async () => {
  const { getProtectedRecoveryControlIntent } = await importFresh<typeof import('../../web/src/components/post.ts')>('../web/src/components/post.ts');

  expect(getProtectedRecoveryControlIntent([])).toBeNull();
  expect(getProtectedRecoveryControlIntent('Resume this interrupted task from where it stopped.' as any)).toBeNull();
  expect(getProtectedRecoveryControlIntent([{
    type: 'control_intent',
    intent: 'protected_recovery_continuation',
    schema_version: 1,
  }])).toBeNull();
  expect(getProtectedRecoveryControlIntent([{
    type: 'control_intent',
    intent: 'protected_recovery_continuation',
    schema_version: 2,
    source_message_id: 'source-123',
    source_row_id: 41,
    thread_id: 41,
  }])).toBeNull();
  const envelope = {
    type: 'control_intent',
    intent: 'protected_recovery_continuation',
    schema_version: 1,
    source_message_id: 'source-123',
    source_row_id: 41,
    thread_id: 41,
  };
  expect(getProtectedRecoveryControlIntent([{ ...envelope, reason: 'tools_required' }])).toBeNull();
  const completeTimeout = {
    ...envelope,
    reason: 'tools_required',
    compaction: 'not_attempted',
    tools_required: true,
    retryable: true,
    recovery_attempts: 1,
    primary_failure_category: 'timeout',
    primary_failure_detail: 'Timed out after 3600s.',
    primary_failure_elapsed_ms: 3_600_575,
    primary_failure_execution_tools: true,
    primary_failure_had_partial_output: true,
    primary_failure_had_tool_activity: true,
    primary_failure_tool_executions: 403,
  };
  expect(getProtectedRecoveryControlIntent([completeTimeout])).toMatchObject({ sourceMessageId: 'source-123' });
  expect(getProtectedRecoveryControlIntent([{
    ...completeTimeout,
    primary_failure_tool_executions: undefined,
  }])).toBeNull();
  expect(getProtectedRecoveryControlIntent([{
    ...envelope,
    reason: 'post_compaction_tools_required',
    compaction: 'failed',
    tools_required: true,
    retryable: true,
    recovery_attempts: 1,
  }])).toBeNull();
});

test('Post renders safe timeout activity details before the tools-required handoff', async () => {
  const host = await renderPostWithBlocks([{
    type: 'turn_outcome_marker',
    kind: 'recovery',
    severity: 'warning',
    label: 'timeout',
    title: 'Tool-enabled continuation timed out after 1h 00m',
    detail: 'Timed out after 3600s. Automatic recovery requires execution tools.',
    reason: 'tools_required',
    tools_required: true,
    retryable: true,
    recovery_attempts: 1,
    primary_failure_category: 'timeout',
    primary_failure_detail: 'Timed out after 3600s.',
    primary_failure_elapsed_ms: 3_600_575,
    primary_failure_execution_tools: true,
    primary_failure_had_partial_output: true,
    primary_failure_had_tool_activity: true,
    primary_failure_tool_executions: 403,
  }]);

  expect(flattenText(host)).toContain('Tool-enabled continuation timed out after 1h 00m');
  const header = findByClass(host, 'post-outcome-pill-header');
  expect(header).toBeTruthy();
  const click = header?.l?.Clickfalse;
  expect(typeof click).toBe('function');
  (click as (event: { stopPropagation(): void }) => void)({ stopPropagation() {} });
  await Promise.resolve();
  expect(flattenText(host)).toContain('403 tool executions');
  expect(flattenText(host)).toContain('tools required');
});

test('Post renders a visible recovery chip with the recovery tooltip', async () => {
  const host = await renderPostWithBlocks([{
    type: 'recovery_marker',
    recovered: true,
    attempts_used: 2,
    classifier: 'timeout',
  }]);

  const chip = findByClass(host, 'post-recovery-chip');
  expect(chip).toBeTruthy();
  expect(flattenText(chip)).toContain('recovered');
  expect(chip?.getAttribute('title')).toBe('Recovered after 2 attempts — request timeout');
});

test('Post renders a visible timeout chip with the last tool action tooltip', async () => {
  const host = await renderPostWithBlocks([{
    type: 'timeout_marker',
    timed_out: true,
    tool_action_summary: 'Timed out while running bash',
  }]);

  const chip = findByClass(host, 'post-timeout-chip');
  expect(chip).toBeTruthy();
  expect(flattenText(chip)).toContain('timeout');
  expect(chip?.getAttribute('title')).toBe('Turn timed out — Timed out while running bash');
});

test('Post renders an outcome chip after the timestamp for turn failures', async () => {
  const host = await renderPostWithBlocks([{
    type: 'turn_outcome_marker',
    kind: 'provider',
    label: 'provider',
    title: 'Provider retry budget exhausted',
    detail: '429 Too Many Requests',
    tool_action_summary: 'bash echo hi',
    severity: 'warning',
  }]);

  const chip = findByClass(host, 'post-outcome-chip');
  const meta = findByClass(host, 'post-meta');
  const timestamp = findByClass(host, 'post-time');
  expect(chip).toBeTruthy();
  expect(flattenText(chip)).toContain('provider');
  expect(chip?.getAttribute('title')).toBe('provider');
  const metaText = flattenText(meta);
  const timestampText = flattenText(timestamp);
  expect(metaText.indexOf(timestampText)).toBeGreaterThan(-1);
  expect(metaText.indexOf('provider')).toBeGreaterThan(metaText.indexOf(timestampText));
});
