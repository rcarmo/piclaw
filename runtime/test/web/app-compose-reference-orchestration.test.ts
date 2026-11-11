import { expect, test } from 'bun:test';

import {
  activateComposeMessageRef,
  addEditorFileReferenceFromEvent,
  resolveComposeSubmitErrorDetail,
} from '../../web/src/ui/app-compose-reference-orchestration.js';

test('resolveComposeSubmitErrorDetail trims valid string messages', () => {
  expect(resolveComposeSubmitErrorDetail('  failed to send  ')).toBe('failed to send');
});

test('resolveComposeSubmitErrorDetail falls back for blank/non-string payloads', () => {
  expect(resolveComposeSubmitErrorDetail('   ')).toBe('Could not send your message.');
  expect(resolveComposeSubmitErrorDetail(null)).toBe('Could not send your message.');
  expect(resolveComposeSubmitErrorDetail({ message: 'nope' })).toBe('Could not send your message.');
});

test('activateComposeMessageRef appends refs in the current non-search session', () => {
  let refs = ['41'];
  const changed = activateComposeMessageRef({
    id: 42,
    currentChatJid: 'web:default',
    setMessageRefs: (next) => {
      refs = typeof next === 'function' ? next(refs) : next;
      return refs;
    },
  });

  expect(changed).toBe(true);
  expect(refs).toEqual(['41', '42']);
});

test('activateComposeMessageRef switches sessions and clears search context', () => {
  let refs: string[] = [];
  const searchStates: Array<[string, unknown]> = [];
  const navigateCalls: string[] = [];

  const changed = activateComposeMessageRef({
    id: 99,
    targetChatJid: 'web:other',
    currentChatJid: 'web:default',
    searchQuery: 'needle',
    searchOpen: true,
    setCurrentHashtag: (value) => { searchStates.push(['hashtag', value]); },
    setSearchQuery: (value) => { searchStates.push(['query', value]); },
    setSearchOpen: (value) => { searchStates.push(['open', value]); },
    setMessageRefs: (next) => {
      refs = typeof next === 'function' ? next(refs) : next;
      return refs;
    },
    navigate: (url) => navigateCalls.push(String(url)),
    baseHref: 'https://example.test/?chat_jid=web%3Adefault',
  });

  expect(changed).toBe(true);
  expect(refs).toEqual(['99']);
  expect(searchStates).toEqual([
    ['hashtag', null],
    ['query', null],
    ['open', false],
  ]);
  expect(navigateCalls).toEqual(['https://example.test/?chat_jid=web%3Aother']);
});

test('activateComposeMessageRef clears search context without navigating when target chat is already active', () => {
  let refs: string[] = [];
  const searchStates: Array<[string, unknown]> = [];
  const navigateCalls: string[] = [];

  const changed = activateComposeMessageRef({
    id: '123',
    currentChatJid: 'web:default',
    currentHashtag: 'todo',
    setCurrentHashtag: (value) => { searchStates.push(['hashtag', value]); },
    setSearchQuery: (value) => { searchStates.push(['query', value]); },
    setSearchOpen: (value) => { searchStates.push(['open', value]); },
    setMessageRefs: (next) => {
      refs = typeof next === 'function' ? next(refs) : next;
      return refs;
    },
    navigate: (url) => navigateCalls.push(String(url)),
    baseHref: 'https://example.test/?chat_jid=web%3Adefault',
  });

  expect(changed).toBe(true);
  expect(refs).toEqual(['123']);
  expect(searchStates).toEqual([
    ['hashtag', null],
    ['query', null],
    ['open', false],
  ]);
  expect(navigateCalls).toEqual([]);
});

test('addEditorFileReferenceFromEvent adds normalized editor path and focuses compose', () => {
  const refs: string[] = [];
  const toasts: Array<[string, string | null | undefined, string | undefined, number | undefined]> = [];
  let focused = 0;

  const changed = addEditorFileReferenceFromEvent({ detail: { path: ' /notes/today.md ' } }, {
    addFileRef: (path) => refs.push(path),
    showIntentToast: (title, detail, kind, durationMs) => toasts.push([title, detail, kind, durationMs]),
    focusCompose: () => { focused += 1; },
  });

  expect(changed).toBe(true);
  expect(refs).toEqual(['notes/today.md']);
  expect(toasts).toEqual([['Reference added', 'notes/today.md', 'info', 1800]]);
  expect(focused).toBe(1);
});

test('addEditorFileReferenceFromEvent ignores empty editor path payloads', () => {
  const refs: string[] = [];
  let focused = 0;

  const changed = addEditorFileReferenceFromEvent({ detail: { path: '   ' } }, {
    addFileRef: (path) => refs.push(path),
    focusCompose: () => { focused += 1; },
  });

  expect(changed).toBe(false);
  expect(refs).toEqual([]);
  expect(focused).toBe(0);
});
