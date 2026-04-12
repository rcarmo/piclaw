/**
 * channels/web/agent/agent-debug.ts – Agent debug/introspection endpoint.
 *
 * Returns full provenance information for loaded extensions, tools,
 * commands, skills, and prompt templates using the SourceInfo API
 * from pi-coding-agent ≥0.62.0.
 */

import type { AgentPool } from "../../../agent-pool.js";

export interface AgentDebugContext {
  defaultChatJid: string;
  agentPool: AgentPool;
  json(payload: unknown, status?: number): Response;
}

interface SourceInfoPayload {
  path: string;
  source: string;
  scope: string;
  origin: string;
  baseDir?: string;
}

function serializeSourceInfo(si: { path: string; source: string; scope: string; origin: string; baseDir?: string } | undefined): SourceInfoPayload | null {
  if (!si) return null;
  return {
    path: si.path,
    source: si.source,
    scope: si.scope,
    origin: si.origin,
    ...(si.baseDir ? { baseDir: si.baseDir } : {}),
  };
}

/** Return a provenance snapshot of all loaded resources for the requested chat session. */
export async function handleAgentDebugRequest(req: Request, ctx: AgentDebugContext): Promise<Response> {
  const url = new URL(req.url);
  const chatJid = (url.searchParams.get("chat_jid") || ctx.defaultChatJid).trim() || ctx.defaultChatJid;

  const session = await ctx.agentPool.getSessionForIntrospection(chatJid);
  if (!session) {
    return ctx.json({ error: "No active session for this chat" }, 404);
  }

  const runner = session.extensionRunner;

  // Extensions
  const extensions: unknown[] = [];
  if (runner) {
    for (const ext of (runner as any).extensions ?? []) {
      extensions.push({
        path: ext.path,
        resolvedPath: ext.resolvedPath,
        sourceInfo: serializeSourceInfo(ext.sourceInfo),
        commandCount: ext.commands?.size ?? 0,
        toolCount: ext.tools?.size ?? 0,
        handlerCount: Array.from(ext.handlers?.values?.() ?? []).reduce<number>((sum, h) => sum + (Array.isArray(h) ? h.length : 0), 0),
      });
    }
  }

  // Tools (from extension runner)
  const tools: unknown[] = [];
  if (runner) {
    for (const tool of runner.getAllRegisteredTools()) {
      tools.push({
        name: tool.definition.name,
        description: tool.definition.description,
        sourceInfo: serializeSourceInfo(tool.sourceInfo),
      });
    }
  }

  // Commands (from extension runner)
  const commands: unknown[] = [];
  if (runner) {
    for (const cmd of runner.getRegisteredCommands()) {
      commands.push({
        name: cmd.invocationName || cmd.name,
        description: cmd.description,
        sourceInfo: serializeSourceInfo(cmd.sourceInfo),
      });
    }
  }

  // Prompt templates
  const promptTemplates = session.promptTemplates.map((t) => ({
    name: t.name,
    description: t.description,
    filePath: t.filePath,
    sourceInfo: serializeSourceInfo(t.sourceInfo),
  }));

  // Skills
  const skills = session.resourceLoader.getSkills().skills.map((s) => ({
    name: s.name,
    description: s.description,
    filePath: s.filePath,
    baseDir: s.baseDir,
    sourceInfo: serializeSourceInfo(s.sourceInfo),
  }));

  return ctx.json({
    chatJid,
    extensions,
    tools,
    commands,
    promptTemplates,
    skills,
  });
}
