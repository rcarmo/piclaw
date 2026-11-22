import { getTestWorkspace } from '../../../helpers.js';
import { expect, test } from 'bun:test';
import { getDb, getMessageByRowId, initDatabase, storeMessage } from '../../../../src/db.js';
import type { AgentControlCommand } from '../../../../src/agent-control/agent-control-types.js';
import { withChatContext } from '../../../../src/core/chat-context.js';
import { createNativeControlFixture } from '../../../agent-control/native-control-fixture.js';
import { createTestModelRegistry, TestAgentControlSession } from '../../../agent-control/session-fixture.js';
import type { WebChannelLike } from '../../../../src/channels/web/core/web-channel-contracts.js';
import { buildA2uiAction, type A2uiActionRequest } from '../../../../src/channels/web/a2ui/action.js';
import { handleA2uiAction } from '../../../../src/channels/web/a2ui/admission.js';
import { isA2uiSurfaceBlock } from '../../../../src/channels/web/a2ui/surface.js';

const chat = 'web:a2ui-login';
const sentinel = 'PRIVATE-integration-secret';

test('an actual provider reveals and consumes two private prompts through owned surface revisions', async () => {
  initDatabase();
  const registry = createTestModelRegistry([{ provider: 'openai', id: 'one' }]);
  const providerValues: string[] = [];
  registry.modelRuntime.login = async (_id: string, _type: string, input: any) => {
    input.notify({ type: 'auth_url', url: `https://auth.example.test/?challenge=${sentinel}` });
    providerValues.push(await input.prompt({ type: 'secret', message: `${sentinel}-first` }));
    input.notify({ type: 'progress', message: sentinel });
    providerValues.push(await input.prompt({ type: 'text', message: `${sentinel}-second` }));
  };
  const control = createNativeControlFixture(new TestAgentControlSession(getTestWorkspace().workspace, registry), registry, chat);
  const run = (command: AgentControlCommand) => withChatContext(chat, 'web', () => control.facade.applyControlCommand(chat, command));
  const updates: unknown[] = [];
  const sent: unknown[] = [];
  const events: unknown[] = [];
  const channel = {
    json: (body: unknown, status = 200) => Response.json(body, { status }),
    agentPool: { applyControlCommand: async (jid: string, command: AgentControlCommand) => { expect(jid).toBe(chat); return run(command); }, getAvailableModels: async () => ({}) },
    broadcastEvent: (...event: unknown[]) => events.push(event),
    interactionBroadcaster: { broadcastInteractionUpdated: (row: unknown) => updates.push(row) },
    sendMessage: async (...args: unknown[]) => { sent.push(args); },
  } as unknown as WebChannelLike;
  try {
    const start = await run({ type: 'login', raw: '/login' });
    const block = start.contentBlocks?.find(isA2uiSurfaceBlock);
    expect(block?.owner).toBe('login');
    const id = storeMessage({ id: crypto.randomUUID(), chat_jid: chat, sender: 'assistant', content: start.message,
      is_from_me: true, is_bot_message: true, timestamp: new Date().toISOString(), content_blocks: start.contentBlocks });
    const current = () => getMessageByRowId(chat, id)?.data?.content_blocks?.find(isA2uiSurfaceBlock);
    const submit = (request: A2uiActionRequest, private_value?: string) => handleA2uiAction(channel, new Request('http://test/agent/a2ui-action', {
      method: 'POST', body: JSON.stringify({ ...request, ...(private_value !== undefined ? { private_value } : {}) }),
    }));
    const select = { chat_jid: chat, post_id: id, thread_id: id, revision: 1, request_id: crypto.randomUUID(),
      message: buildA2uiAction(block!.surface, 'next', new Map([['/provider', ['openai']]]), new Date().toISOString()) };
    const spoof = structuredClone(select);
    Object.assign(spoof.message.action.context, { provider: ['foreign-provider'] });
    expect((await submit(spoof)).status).toBe(400);
    expect((await submit({ ...select, chat_jid: 'web:foreign' })).status).toBe(404);
    expect((await submit(select, 'unexpected-secret')).status).toBe(400);
    expect((await submit(select)).status).toBe(200);
    const next = current()!;
    expect(next.revision).toBe(2);
    const reveal = { ...select, revision: next.revision, request_id: crypto.randomUUID(),
      message: buildA2uiAction(next.surface, 'present', new Map(), new Date().toISOString()) };
    getDb().exec(`CREATE TEMP TRIGGER login_fixture_reject_update BEFORE UPDATE OF content_blocks ON messages
      BEGIN SELECT RAISE(ABORT, 'Synthetic persistence failure'); END`);
    try {
      const refused = await submit(reveal);
      expect(refused.status).toBe(409);
      expect(await refused.text()).not.toContain(sentinel);
      expect(current()?.revision).toBe(2);
    } finally { getDb().exec('DROP TRIGGER login_fixture_reject_update'); }
    const response = await submit(reveal);
    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('private, no-store');
    const first = (await response.json()).auth_presentation;
    expect(first.prompt.message).toBe(`${sentinel}-first`);
    const firstAction = first.actions.continue as A2uiActionRequest;
    const value1 = `${sentinel}-one`;
    const nextReplies = await Promise.all([submit(firstAction, value1), submit(firstAction, value1)]);
    expect(nextReplies.map((r) => r.status).sort()).toEqual([200, 409]);
    const second = (await nextReplies.find((r) => r.ok)!.json()).auth_presentation;
    expect(second.prompt.message).toBe(`${sentinel}-second`);
    expect((await submit(firstAction, 'replay')).status).toBe(409);
    expect((await submit(second.actions.continue, `${sentinel}-two`)).status).toBe(200);
    expect(providerValues).toEqual([value1, `${sentinel}-two`]);
    expect(JSON.stringify({ post: current(), updates, sent })).not.toContain(sentinel);
    expect(JSON.stringify({ post: current(), updates, sent })).not.toMatch(/flow_id|action_id/);
    expect(sent).toEqual([]);
    expect(events).toEqual([]);
    const picker = current()!;
    expect(picker.surface.components.some(item => item.id === 'activate')).toBe(true);
    const activate = { ...select, revision: picker.revision, request_id: crypto.randomUUID(),
      message: buildA2uiAction(picker.surface, 'activate', new Map(), new Date().toISOString()) };
    expect((await submit(activate)).status).toBe(200);
    expect(events).toEqual([['model_changed', expect.objectContaining({ chat_jid: chat, model: 'openai/one' })]]);
    expect((await submit(activate)).status).toBe(409);
    expect(current()?.state).toBe('completed');
  } finally { control.dispose(); }
});

test('typed provider submissions cannot be injected through a slash command or logged as a post', async () => {
  const { handleAgentMessage } = await import('../../../../src/channels/web/handlers/agent.js');
  initDatabase();
  const channel = {
    json: (payload: unknown, status = 200) => Response.json(payload, { status }),
    agentPool: { applyControlCommand: () => { throw Error('Public text reached private handler'); } },
    admitMessage: () => { throw Error('Private value would reach the timeline'); },
  } as unknown as WebChannelLike;
  const pathname = '/agent/default/message';
  const response = await handleAgentMessage(channel, new Request(`http://test${pathname}`, { method: 'POST',
    body: JSON.stringify({ content: `/login __step2 ${JSON.stringify({ auth_value: sentinel })}` }) }), pathname, chat, 'default');
  expect(response.status).toBe(400);
  expect(await response.text()).not.toContain(sentinel);
});
