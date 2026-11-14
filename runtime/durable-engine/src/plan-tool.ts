import { defineTool } from '@earendil-works/pi-durable';
import { planParameters } from '../../src/plan/parameters.js';
import { applyPlanEdits, applyPlanPatches, DEFAULT_PLAN, normalizeStoredPlanMarkdown,
  structuredPlanDetails, updatePlanArgsToMarkdown, type SessionPlan } from '../../src/plan/markdown.js';
import { PlanDoc } from './plan-document.js';
import type { HostConversationRuntime } from './host-runtime.js';
import { createLogger } from '../../src/utils/logger.js';
const log = createLogger('plan');

export type PlanAction = 'write' | 'edit' | 'patch' | 'update';

/** Public SDK arguments preparation; no legacy registration or execute adapter. */
export function preparePlanArguments(args: unknown): unknown {
  if (!args || typeof args !== 'object') return args;
  const input = args as Record<string, unknown>;
  if (input.action === 'get') return { ...input, action: 'read' };
  if (input.action === 'set') return { ...input, action: 'write' };
  if (input.action === undefined && Array.isArray(input.plan)) return { ...input, action: 'update' };
  if (input.action === undefined && Array.isArray(input.patches)) return { ...input, action: 'patch' };
  if (input.action === 'edit' && !Array.isArray(input.edits) && typeof input.oldText === 'string' && typeof input.newText === 'string') {
    return { ...input, edits: [{ oldText: input.oldText, newText: input.newText }] };
  }
  return args;
}

/** Direct durable tool. SDK documents/commits own state and serialisation.
 * Source capture binds the product chat identity; there is no S01/harness path.
 * The readonly legacy reader is only a seed when the SDK document is absent. */
export function createPlanTool(options: {
  runtime(): Pick<HostConversationRuntime, 'captureToolSource' | 'withSourceWriteGuard'>;
  assertOwner(): void;
  readLegacy(chatJid: string): SessionPlan | undefined;
  changed(plan: SessionPlan, action: PlanAction): void;
}) {
  return defineTool({
    name: 'plan',
    description: "Read or update the current session's Plan sidebar. Prefer action=patch for multi-item add/update/remove operations; use action=update for full-plan replacement and action=edit only for exact Markdown edits. All mutations are normalized with at most one in_progress item.",
    parameters: planParameters, callers: ['model', 'tools'], replay: 'unsafe',
    prepareArguments(args) { options.assertOwner(); return preparePlanArguments(args) as any; },
    async execute(raw, api, context) {
      const checkOwner = () => { context.abortSignal?.throwIfAborted(); options.assertOwner(); };
      try {
        checkOwner();
        const plain = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object'
          && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
        if (!plain(raw)) throw Error('Plain Plan arguments required');
        const args = structuredClone(raw);
        const runtime = options.runtime();
        const captured = await runtime.captureToolSource(api.conversationId, api.taskId, api.callId);
        checkOwner();
        if (!captured.native) throw Error('Native Plan source required');
        const chat = captured.operation.chatJid;
        const check = () => { checkOwner(); captured.native!.assertCurrent(); };
        check();
        if (args.chat_jid !== undefined && args.chat_jid !== chat) throw Error('Cross-chat Plan override denied');
        const seed = () => {
          check();
          const legacy = options.readLegacy(chat);
          if (legacy && legacy.chat_jid !== chat) throw Error('Legacy Plan identity mismatch');
          return legacy ?? { chat_jid: chat, markdown: DEFAULT_PLAN, updated_at: null };
        };
        const snapshot = (plan: Readonly<SessionPlan>): SessionPlan => {
          if (plan.chat_jid !== chat) throw Error('Plan identity mismatch');
          return { chat_jid: chat, markdown: plan.markdown, updated_at: plan.updated_at };
        };
        const current = await api.snapshot(PlanDoc, chat, context);
        check();
        if (args.action === 'read') {
          const plan = snapshot(current ?? seed());
          return { output: [{ type: 'text', text: `Plan for ${chat}:\n\n${plan.markdown || '(empty)'}` }], details: structuredPlanDetails(plan) };
        }
        const action = args.action as PlanAction;
        const legacy = current ? snapshot(current) : seed();
        const plan = await runtime.withSourceWriteGuard(check, () => api.commit(async tx => {
          check();
          const draft = await tx.doc(PlanDoc, chat, legacy);
          check();
          if (draft.chat_jid !== chat) throw Error('Plan identity mismatch');
          const markdown = action === 'update' ? updatePlanArgsToMarkdown(args)
            : action === 'edit' ? applyPlanEdits(draft.markdown, args.edits)
            : action === 'patch' ? applyPlanPatches(draft.markdown, args.patches)
            : typeof args.markdown === 'string' ? normalizeStoredPlanMarkdown(args.markdown)
            : (() => { throw Error('plan action=write requires a markdown string.'); })();
          const next = { chat_jid: chat, markdown, updated_at: new Date(api.now()).toISOString() };
          if (Buffer.byteLength(JSON.stringify(next), 'utf8') > 65_536) throw Error('Plan value exceeds maximum size');
          draft.markdown = next.markdown; draft.updated_at = next.updated_at;
          check(); return next;
        }, context));
        check();
        // Notification follows the stored SDK commit, never a draft or failed write.
        try { options.changed(plan, action); }
        catch { log.warn('Plan change notification unavailable', { operation: 'plan.notify_failed' }); }
        const text = action === 'update' ? 'Plan updated.' : action === 'edit' ? `Edited plan for ${chat}.`
          : action === 'patch' ? `Patched plan for ${chat}.` : `Updated plan for ${chat}.`;
        return { output: [{ type: 'text', text }], details: structuredPlanDetails(plan) };
      } catch {
        checkOwner();
        throw Error('Plan operation failed');
      }
    },
  });
}
