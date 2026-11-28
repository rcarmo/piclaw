import type { Database } from 'bun:sqlite';
import { defineExtension, type GenerationHooks } from '@earendil-works/pi-durable';
import { PlanDoc } from './plan-document.js';
import { readLegacyPlan } from '../../src/plan/legacy.js';
import { buildPlanSystemPrompt, buildPlanTurnMessage, DEFAULT_PLAN } from '../../src/plan/markdown.js';
import type { HostConversationRuntime } from './host-runtime.js';
import { splitGoalSystemInstructions } from './host-plan-context.js';

/** Native document read and public SDK context materialisation. No add-on
 * declaration, extension KV authority, legacy hook or session emulation. */
export function createHostPlanPrompt(options: {
  root: Database;
  runtime(): Pick<HostConversationRuntime, 'captureRunSource' | 'assertCapturedSourceCurrent'>;
  assertOwner(): void;
  failClosed(error: unknown): void;
}) {
  const hooks: Pick<GenerationHooks, 'beforeRequest'> = {
    async beforeRequest(request, api, context) {
      try {
        options.assertOwner();
        const runtime = options.runtime();
        const captured = await runtime.captureRunSource(api.conversationId, api.taskId);
        // This is a readonly SDK hook, not authority to execute a Plan tool.
        // Private side forks still have accepted-input bookkeeping; their live
        // SDK generation and source must remain usable without a legacy Plan API.
        const check = () => {
          context.abortSignal?.throwIfAborted(); options.assertOwner();
          captured.native?.assertCurrent(); runtime.assertCapturedSourceCurrent(captured.inputs);
        };
        check(); const chat = captured.operation.chatJid;
        const stored = await api.snapshot(PlanDoc, chat, context); check();
        if (options.root.inTransaction) throw Error('Root connection transaction active');
        const plan = stored ?? readLegacyPlan(options.root, chat) ?? { chat_jid: chat, markdown: DEFAULT_PLAN, updated_at: null };
        if (plan.chat_jid !== chat) throw Error('Plan identity mismatch');
        const system = buildPlanSystemPrompt({ ...plan, markdown: plan.markdown.trim() || '(empty)' });
        const content = buildPlanTurnMessage(plan)?.content ?? [{ type: 'text' as const, text: `Current Plan Sidebar checklist for ${chat}:\n\n(empty)` }];
        const composed = splitGoalSystemInstructions(request.messages, chat, api.taskId);
        const messages = [...composed.messages];
        let insertion = messages.findLastIndex(message => message.role === 'user' && message.timestamp !== 0);
        if (insertion < 0) {
          insertion = messages.length;
          while (insertion > 0 && messages[insertion - 1]?.role === 'toolResult') insertion--;
          if (insertion > 0 && messages[insertion - 1]?.role === 'assistant') insertion--;
        }
        messages.splice(insertion, 0, { role: 'user' as const, content, timestamp: 0 });
        if (composed.instruction) messages.push(composed.instruction);
        if (system) messages.push({ role: 'system', content: system, timestamp: 0 });
        check();
        return { messages };
      } catch (error) { options.failClosed(error); throw Error('Plan request authority unavailable'); }
    },
  };
  // Persisted extension identity stays stable across upgrade.
  return defineExtension({ name: 'app.host-plan-prompt', hooks: [{ task: 'pi.generation', handlers: hooks }] });
}
