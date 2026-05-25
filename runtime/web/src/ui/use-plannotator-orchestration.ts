import type { PlannotatorSession } from './plannotator-types.js';

type StateSetter<T> = (next: T | ((prev: T) => T)) => void;

interface RefBox<T> {
  current: T;
}

type SendAgentMessageFn = (
  agentId: string,
  content: string,
  threadId: string | null,
  attachments: any[],
  queueMode: string | null,
  chatJid: string,
) => Promise<any>;

type ToastFn = (title: string, detail?: string | null, kind?: string, durationMs?: number) => void;

/** Close the Plannotator panel without sending any message to the agent. */
export function closePlannotatorPanelSession(options: {
  plannotatorAbortRef: RefBox<AbortController | null>;
  setPlannotatorSession: StateSetter<PlannotatorSession | null>;
}): void {
  const { plannotatorAbortRef, setPlannotatorSession } = options;
  if (plannotatorAbortRef.current) {
    plannotatorAbortRef.current.abort();
    plannotatorAbortRef.current = null;
  }
  setPlannotatorSession(null);
}

/** Open the Plannotator panel with a given session payload. */
export function openPlannotatorPanelSession(options: {
  session: PlannotatorSession;
  setPlannotatorSession: StateSetter<PlannotatorSession | null>;
}): void {
  const { session, setPlannotatorSession } = options;
  setPlannotatorSession(session);
}

/** Serialize annotations and suggestions into readable text for agent messages. */
function serializeAnnotationsAndSuggestions(session: PlannotatorSession | null): string {
  if (!session) return '';
  const parts: string[] = [];

  if (session.annotations.length > 0) {
    parts.push('Anotações:');
    for (const ann of session.annotations) {
      const prefix = ann.lineNumber != null ? `linha ${ann.lineNumber}: ` : '';
      parts.push(`- ${prefix}${ann.text}`);
    }
  }

  if (session.suggestions.length > 0) {
    parts.push('Sugestões de alteração:');
    for (const sug of session.suggestions) {
      const prefix = sug.lineNumber != null ? `linha ${sug.lineNumber}: ` : '';
      parts.push(`- ${prefix}\`${sug.originalText}\` → \`${sug.replacementText}\``);
    }
  }

  return parts.join('\n');
}

export interface ApprovePlannotatorOptions {
  plannotatorSession: PlannotatorSession | null;
  currentChatJid: string;
  isComposeBoxAgentActive: boolean;
  sendAgentMessage: SendAgentMessageFn;
  handleMessageResponse: (response: any) => void;
  setPlannotatorSession: StateSetter<PlannotatorSession | null>;
  showIntentToast: ToastFn;
}

/** Send an approval message to the agent and close the panel. */
export async function approvePlannotatorSession(options: ApprovePlannotatorOptions): Promise<void> {
  const {
    plannotatorSession,
    currentChatJid,
    isComposeBoxAgentActive,
    sendAgentMessage,
    handleMessageResponse,
    setPlannotatorSession,
    showIntentToast,
  } = options;

  const extras = serializeAnnotationsAndSuggestions(plannotatorSession);
  const content = extras ? `✓ Aprovado\n\nNotas:\n${extras}` : '✓ Aprovado';

  try {
    const response = await sendAgentMessage(
      'default',
      content,
      null,
      [],
      isComposeBoxAgentActive ? 'queue' : null,
      currentChatJid,
    );
    handleMessageResponse(response);
    setPlannotatorSession(null);
    showIntentToast(
      response?.queued === 'followup' ? 'Aprovação em fila' : 'Aprovado',
      response?.queued === 'followup'
        ? 'A aprovação foi colocada em fila porque o agente está ocupado.'
        : 'Aprovação enviada ao agente.',
      'info',
      3000,
    );
  } catch (error: any) {
    showIntentToast('Erro ao aprovar', error?.message || 'Não foi possível enviar a aprovação.', 'warning');
  }
}

export interface RejectPlannotatorOptions {
  plannotatorSession: PlannotatorSession | null;
  comment: string;
  currentChatJid: string;
  isComposeBoxAgentActive: boolean;
  sendAgentMessage: SendAgentMessageFn;
  handleMessageResponse: (response: any) => void;
  setPlannotatorSession: StateSetter<PlannotatorSession | null>;
  showIntentToast: ToastFn;
}

/** Send a rejection message to the agent (with comment + annotations) and close the panel. */
export async function rejectPlannotatorSession(options: RejectPlannotatorOptions): Promise<void> {
  const {
    plannotatorSession,
    comment,
    currentChatJid,
    isComposeBoxAgentActive,
    sendAgentMessage,
    handleMessageResponse,
    setPlannotatorSession,
    showIntentToast,
  } = options;

  const parts: string[] = ['✕ Rejeitado'];
  if (comment.trim()) {
    parts.push(`\nMotivo: ${comment.trim()}`);
  }
  const extras = serializeAnnotationsAndSuggestions(plannotatorSession);
  if (extras) {
    parts.push(`\n${extras}`);
  }
  const content = parts.join('\n');

  try {
    const response = await sendAgentMessage(
      'default',
      content,
      null,
      [],
      isComposeBoxAgentActive ? 'queue' : null,
      currentChatJid,
    );
    handleMessageResponse(response);
    setPlannotatorSession(null);
    showIntentToast(
      response?.queued === 'followup' ? 'Rejeição em fila' : 'Rejeitado',
      response?.queued === 'followup'
        ? 'A rejeição foi colocada em fila porque o agente está ocupado.'
        : 'Rejeição enviada ao agente.',
      'info',
      3000,
    );
  } catch (error: any) {
    showIntentToast('Erro ao rejeitar', error?.message || 'Não foi possível enviar a rejeição.', 'warning');
  }
}

/** Build a PlannotatorSession from a raw SSE plannotator_review_request payload. */
export function buildPlannotatorSessionFromSsePayload(data: any): PlannotatorSession | null {
  const content = typeof data?.content === 'string' ? data.content.trim() : '';
  if (!content) return null;

  const contentType = (['plan', 'diff', 'message', 'file'] as const).includes(data?.contentType)
    ? (data.contentType as PlannotatorSession['contentType'])
    : 'message';

  return {
    id: `plannotator-${Date.now()}`,
    title: typeof data?.title === 'string' && data.title.trim()
      ? data.title.trim()
      : 'Review do Agente',
    contentType,
    content,
    sourceMessageId: typeof data?.sourceMessageId === 'string' ? data.sourceMessageId : undefined,
    sourcePath: typeof data?.sourcePath === 'string' ? data.sourcePath : undefined,
    annotations: [],
    suggestions: [],
  };
}

/** Build a PlannotatorSession from a Post object in the timeline. */
export function buildPlannotatorSessionFromPost(post: any): PlannotatorSession | null {
  const content = typeof post?.content === 'string' ? post.content.trim() : '';
  if (!content) return null;

  return {
    id: `plannotator-${Date.now()}`,
    title: post?.plan ? 'Plano do Agente' : 'Mensagem do Agente',
    contentType: post?.plan ? 'plan' : 'message',
    content,
    sourceMessageId: post?.id != null ? String(post.id) : undefined,
    annotations: [],
    suggestions: [],
  };
}

/** Build a PlannotatorSession from a workspace file path + content. */
export function buildPlannotatorSessionFromFile(path: string, content: string): PlannotatorSession {
  const filename = path.split('/').pop() || path;
  return {
    id: `plannotator-${Date.now()}`,
    title: `Ficheiro — ${filename}`,
    contentType: 'file',
    content,
    sourcePath: path,
    annotations: [],
    suggestions: [],
  };
}

/**
 * Check whether a post qualifies to show the "Review →" button.
 * Criteria: agent message that either has plan:true or contains a code block of ≥ 3 lines.
 */
export function postQualifiesForPlannotator(post: any): boolean {
  if (!post || post.role !== 'agent') return false;
  if (post.plan === true) return true;
  const content = typeof post.content === 'string' ? post.content : '';
  return /```[\s\S]{30,}/.test(content);
}

/**
 * Find the last agent post in a list that qualifies for Plannotator review.
 * Used by slash commands /plannotate and /review.
 */
export function findLastReviewablePost(posts: any[]): any | null {
  if (!Array.isArray(posts)) return null;
  for (let i = posts.length - 1; i >= 0; i--) {
    if (postQualifiesForPlannotator(posts[i])) return posts[i];
  }
  return null;
}
