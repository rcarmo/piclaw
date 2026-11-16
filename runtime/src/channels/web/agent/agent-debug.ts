import type { AgentPool } from '../../../agent-pool.js';

export interface AgentDebugContext {
  defaultChatJid: string;
  agentPool: AgentPool;
  json(payload: unknown, status?: number): Response;
}

/** Direct current-native resource metadata. An unbound/unavailable SDK reader
 * cannot open a legacy AgentSession or substitute extension-runner state. */
export async function handleAgentDebugRequest(req: Request, ctx: AgentDebugContext): Promise<Response> {
  const url = new URL(req.url);
  const chatJid = (url.searchParams.get('chat_jid') || ctx.defaultChatJid).trim() || ctx.defaultChatJid;
  let native;
  try { native = await ctx.agentPool.getDurableSessionMetadata(chatJid); }
  catch { return ctx.json({ error: 'Native debug metadata unavailable' }, 503); }
  if (native === undefined) return ctx.json({ error: 'Native debug metadata unavailable' }, 503);
  if (!native) return ctx.json({ error: 'No active session for this chat' }, 404);
  return ctx.json({ chatJid, backend: native.backend, conversationId: native.conversationId,
    extensions: native.extensions.map((name: string) => ({ name, sourceInfo: null })),
    tools: native.tools.map((tool: { name: string; description: string }) => ({ ...tool, sourceInfo: null })),
    commands: [], promptTemplates: [], skills: [],
    unavailable: ['legacy-extension-provenance', 'legacy-extension-commands', 'prompt-templates', 'skills'],
  }, 200);
}
