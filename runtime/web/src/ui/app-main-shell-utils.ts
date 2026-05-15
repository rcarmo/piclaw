export function buildMainShellClassName(options: {
  workspaceOpen: boolean;
  editorOpen: boolean;
  chatOnlyMode: boolean;
  zenMode: boolean;
}): string {
  const { workspaceOpen, editorOpen, chatOnlyMode, zenMode } = options;
  return `app-shell${workspaceOpen ? '' : ' workspace-collapsed'}${editorOpen ? ' editor-open' : ''}${chatOnlyMode ? ' chat-only' : ''}${zenMode ? ' zen-mode' : ''}`;
}

export function extractPostedUserMessageId(response: unknown): number | null {
  const rawId = (response as any)?.user_message?.id ?? (response as any)?.row_id;
  if (rawId === null || rawId === undefined || rawId === '') return null;
  const id = Number(rawId);
  return Number.isFinite(id) ? id : null;
}

export function scrollToPostedTimelineMessage(options: {
  id: string | number;
  scrollToBottom?: () => void;
  getElementById?: (id: string) => HTMLElement | null;
  scheduleRaf?: (callback: () => void) => void;
  scheduleTimeout?: (callback: () => void, delayMs: number) => void;
  maxAttempts?: number;
}): void {
  const {
    id,
    scrollToBottom,
    getElementById = (value) => document.getElementById(value),
    scheduleRaf = (callback) => requestAnimationFrame(callback),
    scheduleTimeout = (callback, delayMs) => { setTimeout(callback, delayMs); },
    maxAttempts = 12,
  } = options;

  const highlight = (el: HTMLElement) => {
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    el.classList.add('post-highlight');
    scheduleTimeout(() => el.classList.remove('post-highlight'), 2000);
  };

  const tryScroll = (attemptsRemaining: number) => {
    const element = getElementById(`post-${id}`);
    if (element) {
      highlight(element);
      return;
    }
    if (attemptsRemaining <= 0) {
      scrollToBottom?.();
      return;
    }
    scheduleRaf(() => {
      scheduleTimeout(() => tryScroll(attemptsRemaining - 1), 40);
    });
  };

  tryScroll(maxAttempts);
}

export function handleComposePost(options: {
  response?: unknown;
  viewStateRef: { current: Record<string, unknown> | null | undefined };
  scrollToBottom: () => void;
  scrollPostedMessage?: (id: string | number) => void;
}): void {
  const {
    response,
    viewStateRef,
    scrollToBottom,
    scrollPostedMessage = (id) => scrollToPostedTimelineMessage({ id, scrollToBottom }),
  } = options;

  const { searchQuery: sq, searchOpen: so } = viewStateRef.current || {};
  if (sq || so) return;

  const postedMessageId = extractPostedUserMessageId(response);
  if (postedMessageId) {
    scrollPostedMessage(postedMessageId);
    return;
  }

  scrollToBottom();
}
