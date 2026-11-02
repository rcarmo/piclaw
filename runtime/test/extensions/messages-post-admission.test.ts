import '../helpers.js';
import { afterEach, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { setMessagesPostFn, postMessagesToolMessage, admitRegisteredMessagesTool, runMessagesTool } from '../../src/extensions/messages-crud.js';
import { getDb, initDatabase, storeChatMetadata } from '../../src/db.js';

afterEach(() => setMessagesPostFn(undefined));
const chat = 'web:admitted-runtime-post';

test('unwired runtime posts reject without the raw database fallback', async () => {
  initDatabase(); storeChatMetadata(chat, new Date().toISOString()); setMessagesPostFn(undefined);
  const count = getDb().query('SELECT count(*) n FROM messages').get();
  await expect(postMessagesToolMessage({ action: 'post', content: 'must not fallback' }, chat)).rejects.toThrow('admission unavailable');
  await expect(admitRegisteredMessagesTool({ action: 'post', content: 'must not fallback either' }, chat, () => {})).rejects.toThrow('admission unavailable');
  expect(getDb().query('SELECT count(*) n FROM messages').get()).toEqual(count);
  expect(() => runMessagesTool({ action: 'post', content: 'sync retired' }, chat)).toThrow('asynchronous admission');
});

test('runtime post waits for its captured admission port and signal before returning the committed receipt', async () => {
  let release!: () => void, completed = false, observed: unknown[] = [];
  const held = new Promise<void>(resolve => { release = resolve; });
  const signal = new AbortController().signal;
  setMessagesPostFn(async (...args: any[]) => { observed = args; await held; return 234; });
  const posting = postMessagesToolMessage({ action: 'post', type: 'agent', content: 'captured' }, chat, signal).then(value => { completed = true; return value; });
  setMessagesPostFn(async () => { throw Error('replacement port must not run'); });
  await Bun.sleep(0); expect(completed).toBe(false); release();
  expect((await posting).details).toMatchObject({ posted: 1, row_id: 234, broadcast: true, chat_jid: chat });
  expect(observed.slice(0, 4)).toEqual([chat, 'captured', true, []]); expect(observed[6]).toBe(signal);
});

test('registered native post forwards its exact source authority and signal', async () => {
  const sourceAuthority = () => {}, signal = new AbortController().signal;
  let observed: unknown[] = [];
  setMessagesPostFn(async (...args: any[]) => { observed = args; return 345; });
  expect((await admitRegisteredMessagesTool({ action: 'post', content: 'native' }, chat, sourceAuthority, signal)).details.row_id).toBe(345);
  expect(observed[5]).toBe(sourceAuthority); expect(observed[6]).toBe(signal);
});

test('posting has one registered admission owner and no synchronous registered API', () => {
  const source = readFileSync(new URL('../../src/extensions/messages-crud.ts', import.meta.url), 'utf8');
  expect(source).not.toContain('registeredPostFn'); expect(source).not.toContain('MessagePostFn');
  expect(source).not.toContain('runRegisteredMessagesTool');
});
