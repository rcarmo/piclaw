import { expect, test } from 'bun:test';
import { handleLogin, handleLogout } from '../../src/agent-control/handlers/login.js';
import { withChatContext } from '../../src/core/chat-context.js';
import '../helpers.js';

for (const type of ['login', 'logout'] as const) test(`${type} refuses legacy subjects before runtime or credential access`, async () => {
  let legacyReads = 0;
  const legacy = {
    sessionId: 'retired-session',
    get modelRuntime() { legacyReads++; throw Error('Legacy runtime must not be read'); },
    get dispose() { legacyReads++; throw Error('Legacy disposal must not be patched'); },
  };
  const result = await withChatContext('web:native-auth-only', 'web', () => type === 'login'
    ? handleLogin(legacy as any, {} as any, { type, raw: '/login' })
    : handleLogout(legacy as any, {} as any, { type, provider: 'openai', raw: '/logout openai' })).catch(() => null);
  expect(result).toMatchObject({ status: 'error', message: 'Native authentication context required. No legacy runtime was opened.' });
  expect(legacyReads).toBe(0);
});
