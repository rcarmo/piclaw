import type { Database } from 'bun:sqlite';
import { defineExtension, type GenerationHooks } from '@earendil-works/pi-durable';
import { PlanDoc } from './plan-document.js';
import { readLegacyPlan } from '../../src/plan/legacy.js';
import { buildPlanSystemPrompt, buildPlanTurnMessage, DEFAULT_PLAN } from '../../src/plan/markdown.js';
import type { HostConversationRuntime } from './host-runtime.js';

/** Native document read and public SDK context materialisation. No add-on
 * declaration, extension KV authority, legacy hook or session emulation. */
export function createHostPlanPrompt(options: {
  root: Database;
  runtime(): Pick<HostConversationRuntime, 'captureRunSource' | 'preparePlanContext'>;
  assertOwner(): void;
  failClosed(error: unknown): void;
}) {
  const hooks: Pick<GenerationHooks, 'beforeRequest'> = {
    async beforeRequest(request, api, context) {
      try {
        options.assertOwner();
        const captured = await options.runtime().captureRunSource(api.conversationId, api.taskId);
        if (!captured.native) throw Error('Native Plan source required');
        const check = () => { context.abortSignal?.throwIfAborted(); options.assertOwner(); captured.native!.assertCurrent(); };
        check(); const chat = captured.operation.chatJid;
        const stored = await api.snapshot(PlanDoc, chat, context); check();
        const plan = stored ?? readLegacyPlan(options.root, chat) ?? { chat_jid: chat, markdown: DEFAULT_PLAN, updated_at: null };
        if (plan.chat_jid !== chat) throw Error('Plan identity mismatch');
        const system = buildPlanSystemPrompt({ ...plan, markdown: plan.markdown.trim() || '(empty)' });
        const content = buildPlanTurnMessage(plan)?.content ?? [{ type: 'text' as const, text: `Current Plan Sidebar checklist for ${chat}:\n\n(empty)` }];
        const messages = await options.runtime().preparePlanContext(api.conversationId, api.taskId, captured.inputs,
          request.messages, content, () => { check(); if (options.root.inTransaction) throw Error('Root connection transaction active'); }, context);
        check();
        return { messages: [...messages, ...(system ? [{ role: 'system' as const, content: system, timestamp: 0 }] : [])] };
      } catch (error) { options.failClosed(error); throw Error('Plan request authority unavailable'); }
    },
  };
  // Persisted extension identity stays stable across upgrade.
  return defineExtension({ name: 'app.host-plan-prompt', hooks: [{ task: 'pi.generation', handlers: hooks }] });
}
