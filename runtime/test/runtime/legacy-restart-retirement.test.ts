import '../helpers.js';
import { expect, test } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import { initDatabase, getDb, extensionKvGet, storeChatMetadata, storeMessage } from '../../src/db.js';
import { extensionKvSet } from '../../src/db/extension-kv.js';
import { runWebStartupRecoveryBootstrap } from '../../src/runtime/startup.js';

test('startup retains opaque historical handoffs and timeline bytes without replay, deletion or synthetic completion', () => {
  initDatabase(); const chat = 'web:historical-exit'; storeChatMetadata(chat, new Date().toISOString());
  getDb().transaction(() => {
  for (const state of ['preparing', 'ready', 'completion_posted', 'resume_posted']) {
    extensionKvSet('exit-process', `restart-handoff:${state}`, { version: 1, restartId: state, state, chatJid: chat,
      reason: 'historical', resumeMessage: 'never replay this input', requestedAt: '2026-01-01T00:00:00.000Z',
      restartMessageRowId: 1, completionMessageRowId: null, resumeMessageRowId: null }, 'global');
  }
  extensionKvSet('exit-process', 'restart-handoff:future', { version: 900, payload: 'retain unsupported bytes' }, 'global');
  extensionKvSet('exit-process', 'restart-handoff:malformed', 'retain malformed history', 'global');
  }).immediate();
  storeMessage({ id: 'historical-exit-notice', chat_jid: chat, sender: 'fixture', sender_name: 'Fixture', content: 'Historical notice',
    timestamp: '2026-01-01T00:00:00.000Z', is_from_me: true, is_bot_message: true,
    content_blocks: [{ type: 'restart_handoff', source: 'exit_process', restart_id: 'ready', phase: 'notice' }] });
  const before = getDb().serialize(), scheduled: (() => void)[] = [];
  let nativeResumes = 0;
  const web = { updateAgentStatus() {}, resumePendingChats() { nativeResumes++; },
    storeMessage() { throw Error('No legacy timeline writes'); }, resumeChat() { throw Error('No fabricated continuation'); } };
  runWebStartupRecoveryBootstrap(web, resume => scheduled.push(resume));
  expect(scheduled).toHaveLength(1); expect(scheduled[0]).toBeFunction(); expect(nativeResumes).toBe(0);
  scheduled[0]!(); expect(nativeResumes).toBe(1);
  expect(getDb().serialize()).toEqual(before);
  expect(extensionKvGet('exit-process', 'restart-handoff:malformed', 'global')).toBe('retain malformed history');
});

test('startup has no legacy handoff recovery module or callback port', () => {
  expect(existsSync(new URL('../../src/runtime/restart-handoff.ts', import.meta.url))).toBe(false);
  const startup = readFileSync(new URL('../../src/runtime/startup.ts', import.meta.url), 'utf8');
  expect(startup).not.toContain('recoverRestartHandoffs'); expect(startup).not.toContain('recoverPendingRestartHandoffs');
});
