export interface ChatSwipeCandidate {
  chat_jid?: unknown;
  agent_name?: unknown;
  archived_at?: unknown;
  is_active?: unknown;
}

export interface ChatSwipeTargetState {
  active: boolean;
  horizontalLocked: boolean;
  cancelled: boolean;
  startX: number;
  startY: number;
  lastX: number;
  lastY: number;
  startedAt: number;
}

export interface ChatSwipeWheelState {
  lastTriggeredAt: number;
  accumX: number;
}

function hasClosest(target: unknown): target is { closest: (selector: string) => Element | null } {
  return Boolean(target && typeof (target as { closest?: unknown }).closest === 'function');
}

export function hasActiveTextSelection(runtimeWindow: (Window & typeof globalThis) | null | undefined = typeof window !== 'undefined' ? window : null): boolean {
  if (!runtimeWindow || typeof runtimeWindow.getSelection !== 'function') return false;
  try {
    const selection = runtimeWindow.getSelection();
    if (!selection || selection.isCollapsed) return false;
    return String(selection.toString() || '').trim().length > 0;
  } catch {
    return false;
  }
}

export function createChatSwipeTouchState(): ChatSwipeTargetState {
  return {
    active: false,
    horizontalLocked: false,
    cancelled: false,
    startX: 0,
    startY: 0,
    lastX: 0,
    lastY: 0,
    startedAt: 0,
  };
}

export function createChatSwipeWheelState(): ChatSwipeWheelState {
  return {
    lastTriggeredAt: 0,
    accumX: 0,
  };
}

export function resetChatSwipeTouchState(state: ChatSwipeTargetState | null | undefined): void {
  if (!state) return;
  state.active = false;
  state.horizontalLocked = false;
  state.cancelled = false;
  state.startX = 0;
  state.startY = 0;
  state.lastX = 0;
  state.lastY = 0;
  state.startedAt = 0;
}

const INTERACTIVE_SELECTOR = [
  'input',
  'textarea',
  'select',
  'button',
  'label',
  'a[href]',
  '[contenteditable="true"]',
  '[role="button"]',
  '[data-no-chat-swipe]',
  '.compose-box',
  '.compose-model-popup',
  '.compose-session-popup',
  '.workspace-explorer',
  '.editor-pane-container',
  '.dock-panel',
  '.terminal-pane-content',
  '.attachment-preview-modal',
  '.rename-branch-overlay',
  '.agent-request-modal',
  '.post-content',
  '.post-file-refs',
  '.adaptive-card-container',
  '.adaptive-card-container input',
  '.adaptive-card-container textarea',
  '.adaptive-card-container select',
  '.adaptive-card-container button',
].join(', ');

/**
 * Elements inside the timeline that should NOT block swipe.
 * If the interactive match is inside one of these containers, allow swipe.
 */
const SWIPE_PASSTHROUGH_ANCESTOR = [
  '.agent-thinking',
  '.agent-status-panel',
  '.agent-thinking-intent',
].join(', ');

export function isEligibleChatSwipeTarget(target: unknown): boolean {
  if (!target || !hasClosest(target)) return false;
  const interactiveMatch = target.closest(INTERACTIVE_SELECTOR);
  if (!interactiveMatch) return true;
  // Allow swipe if the interactive element is inside a passthrough container
  // (drafts, thoughts, intents have buttons but should still be swipeable)
  return Boolean(interactiveMatch.closest(SWIPE_PASSTHROUGH_ANCESTOR));
}

export function resolveSwipeableChatAgents(candidates: unknown, currentChatJid: string): string[] {
  if (!Array.isArray(candidates)) return currentChatJid ? [currentChatJid] : [];
  const seen = new Set<string>();
  const candidateRows = candidates
    .filter((candidate): candidate is ChatSwipeCandidate => Boolean(candidate && typeof candidate === 'object'))
    .filter((candidate) => {
      const chatJid = typeof candidate.chat_jid === 'string' ? candidate.chat_jid.trim() : '';
      if (!chatJid || seen.has(chatJid)) return false;
      if (candidate.archived_at) return false;
      seen.add(chatJid);
      return true;
    });

  // Stable sort: active first, then alphabetically by chat_jid.
  // Must NOT depend on currentChatJid so the carousel order stays consistent
  // as the user navigates between agents.
  candidateRows.sort((a, b) => {
    if (Boolean(a.is_active) !== Boolean(b.is_active)) return a.is_active ? -1 : 1;
    return String(a.chat_jid).localeCompare(String(b.chat_jid));
  });

  const rows = candidateRows.map((candidate) => String(candidate.chat_jid).trim());

  if (currentChatJid && !seen.has(currentChatJid)) {
    rows.unshift(currentChatJid);
  }
  return rows;
}

export function resolveAdjacentSwipeChatJid(options: {
  candidates: unknown;
  currentChatJid: string;
  direction: 'next' | 'prev';
}): string | null {
  const rows = resolveSwipeableChatAgents(options.candidates, options.currentChatJid);
  if (rows.length <= 1) return null;
  const currentIndex = rows.indexOf(options.currentChatJid);
  if (currentIndex < 0) return rows[0] ?? null;
  const nextIndex = options.direction === 'next'
    ? (currentIndex + 1) % rows.length
    : (currentIndex - 1 + rows.length) % rows.length;
  return rows[nextIndex] ?? null;
}

export interface SwipeNeighbours {
  prev: { chatJid: string; name: string } | null;
  next: { chatJid: string; name: string } | null;
}

function candidateName(candidates: ChatSwipeCandidate[], chatJid: string): string {
  const c = candidates.find((x) => x.chat_jid === chatJid);
  if (!c) return chatJid.replace(/^[^:]+:/, '');
  const raw = typeof c.agent_name === 'string' ? c.agent_name.trim() : '';
  return raw || chatJid.replace(/^[^:]+:/, '');
}

export function resolveSwipeNeighbours(options: {
  candidates: ChatSwipeCandidate[];
  currentChatJid: string;
}): SwipeNeighbours {
  const rows = resolveSwipeableChatAgents(options.candidates, options.currentChatJid);
  if (rows.length <= 1) return { prev: null, next: null };
  const idx = rows.indexOf(options.currentChatJid);
  if (idx < 0) return { prev: null, next: null };
  const prevJid = rows[(idx - 1 + rows.length) % rows.length]!;
  const nextJid = rows[(idx + 1) % rows.length]!;
  return {
    prev: { chatJid: prevJid, name: candidateName(options.candidates, prevJid) },
    next: { chatJid: nextJid, name: candidateName(options.candidates, nextJid) },
  };
}

export function shouldTriggerTouchChatSwipe(options: {
  dx: number;
  dy: number;
  elapsedMs?: number;
  minDistancePx?: number;
  axisRatio?: number;
}): boolean {
  const minDistancePx = Number.isFinite(options.minDistancePx) ? Number(options.minDistancePx) : 72;
  const axisRatio = Number.isFinite(options.axisRatio) ? Number(options.axisRatio) : 1.35;
  return Math.abs(options.dx) >= minDistancePx
    && Math.abs(options.dx) > Math.abs(options.dy) * axisRatio;
}

/* ────────────────────────────────────────────────────────────────────────────
 * Visual swipe indicator
 * ──────────────────────────────────────────────────────────────────────────── */

function ensureIndicatorElement(_container: HTMLElement): HTMLElement {
  let indicator = document.querySelector('.chat-swipe-indicator') as HTMLElement | null;
  if (!indicator) {
    indicator = document.createElement('div');
    indicator.className = 'chat-swipe-indicator';
    indicator.innerHTML =
      '<span class="chat-swipe-chevron"></span>' +
      '<span class="chat-swipe-name"></span>';
    document.body.appendChild(indicator);
  }
  return indicator;
}

function showIndicator(
  indicator: HTMLElement,
  dx: number,
  _containerWidth: number,
  neighbours: SwipeNeighbours,
): void {
  const absDx = Math.abs(dx);
  const progress = Math.min(absDx / 100, 1);
  const willTrigger = absDx >= 72; // matches shouldTriggerTouchChatSwipe minDistancePx

  indicator.style.display = 'flex';
  indicator.style.opacity = String(Math.min(progress * 2.5, 1));
  indicator.classList.toggle('chat-swipe-indicator--ready', willTrigger);

  const isNext = dx < 0;
  const target = isNext ? neighbours.next : neighbours.prev;

  const chevron = indicator.querySelector('.chat-swipe-chevron') as HTMLElement | null;
  if (chevron) {
    chevron.textContent = isNext ? '›' : '‹';
    chevron.style.order = isNext ? '2' : '0';
  }

  const nameEl = indicator.querySelector('.chat-swipe-name') as HTMLElement | null;
  if (nameEl) nameEl.textContent = target?.name ?? '';
}

function hideIndicator(indicator: HTMLElement): void {
  indicator.style.display = 'none';
  indicator.style.opacity = '0';
}

/* ────────────────────────────────────────────────────────────────────────────
 * Native-listener hook for chat swipe navigation
 *
 * Attaches touchstart/touchmove/touchend/touchcancel as native (non-passive)
 * event listeners on the timeline DOM element. Preact synthetic events are
 * passive on iOS scroll containers, so they cannot preventDefault and the
 * browser's own scroll/back-swipe gesture wins.
 * ──────────────────────────────────────────────────────────────────────────── */

export interface UseChatSwipeNavigationOptions {
  /** Ref whose `.current` is the timeline DOM element. */
  timelineRef: { current: HTMLElement | null };
  /** Full agent list (active + current). */
  activeChatAgents: ChatSwipeCandidate[];
  /** Current chat jid. */
  currentChatJid: string;
  /** Called with the next chat_jid to switch to. */
  onSwitch: (nextChatJid: string) => void;
  /** Return true when the device is iOS/iPadOS. */
  isIOSDevice: () => boolean;
  /** Return true for macOS Safari (trackpad wheel). */
  isLikelySafari?: () => boolean;
}

/**
 * Imperative setup — call from a useEffect. Returns a cleanup function.
 */
export function attachChatSwipeNavigation(options: UseChatSwipeNavigationOptions): () => void {
  const {
    timelineRef,
    activeChatAgents,
    currentChatJid,
    onSwitch,
    isIOSDevice: checkIOS,
    isLikelySafari,
  } = options;

  const el = timelineRef.current;
  if (!el) return () => {};

  const isIOS = checkIOS();
  const isSafari = typeof isLikelySafari === 'function' ? isLikelySafari() : false;

  if (!isIOS && !isSafari) return () => {};

  const state = createChatSwipeTouchState();
  const wheelState = createChatSwipeWheelState();
  let indicator: HTMLElement | null = null;
  let neighbours: SwipeNeighbours = { prev: null, next: null };
  // Track whether the current contact was initiated by a pen/stylus.
  // Apple Pencil on iPad fires both pointer and touch events; swipe
  // navigation should only respond to finger touches.
  let lastPointerDownWasPen = false;

  function refreshNeighbours() {
    neighbours = resolveSwipeNeighbours({
      candidates: activeChatAgents,
      currentChatJid,
    });
  }

  refreshNeighbours();

  function getIndicator(): HTMLElement {
    if (!indicator) {
      indicator = ensureIndicatorElement(el!);
    }
    return indicator;
  }

  function doSwitch(direction: 'next' | 'prev') {
    const target = direction === 'next' ? neighbours.next : neighbours.prev;
    if (target) onSwitch(target.chatJid);
  }

  /* ── touch handlers (iOS) ── */

  function onPointerDown(event: PointerEvent) {
    lastPointerDownWasPen = String(event.pointerType || '').toLowerCase() === 'pen';
  }

  function onTouchStart(event: TouchEvent) {
    resetChatSwipeTouchState(state);
    refreshNeighbours();
    if (!isIOS) return;
    if (event.touches.length !== 1) return;
    // Apple Pencil generates touch events alongside pointer events;
    // swipe navigation should only respond to finger touches.
    if (lastPointerDownWasPen) return;
    if (hasActiveTextSelection()) return;
    if (!isEligibleChatSwipeTarget(event.target)) return;
    const touch = event.touches[0];
    state.active = true;
    state.startX = touch.clientX;
    state.startY = touch.clientY;
    state.lastX = touch.clientX;
    state.lastY = touch.clientY;
    state.startedAt = Date.now();
  }

  function onTouchMove(event: TouchEvent) {
    if (!state.active || state.cancelled) return;
    if (hasActiveTextSelection()) {
      state.cancelled = true;
      hideIndicator(getIndicator());
      return;
    }
    const touch = event.touches[0];
    if (!touch) return;
    state.lastX = touch.clientX;
    state.lastY = touch.clientY;
    const dx = state.lastX - state.startX;
    const dy = state.lastY - state.startY;

    if (!state.horizontalLocked) {
      // If vertical motion dominates early, cancel the swipe
      if (Math.abs(dy) > 16 && Math.abs(dy) >= Math.abs(dx)) {
        state.cancelled = true;
        hideIndicator(getIndicator());
        return;
      }
      // Lock to horizontal once we have a clear horizontal bias
      if (Math.abs(dx) > 12 && Math.abs(dx) > Math.abs(dy) * 1.15) {
        state.horizontalLocked = true;
      }
    }

    if (state.horizontalLocked) {
      // Prevent vertical scroll while swiping horizontally
      if (event.cancelable) event.preventDefault();
      showIndicator(getIndicator(), dx, el!.clientWidth, neighbours);
    }
  }

  function onTouchEnd() {
    if (!state.active) return;
    const dx = state.lastX - state.startX;
    const dy = state.lastY - state.startY;
    const shouldNavigate = !state.cancelled && shouldTriggerTouchChatSwipe({ dx, dy });

    hideIndicator(getIndicator());
    resetChatSwipeTouchState(state);
    if (shouldNavigate) {
      doSwitch(dx < 0 ? 'next' : 'prev');
    }
  }

  function onTouchCancel() {
    hideIndicator(getIndicator());
    resetChatSwipeTouchState(state);
  }

  /* ── wheel handler (macOS Safari trackpad) ── */

  function onWheel(event: WheelEvent) {
    if (isIOS) return;
    if (!isSafari) return;
    if (!isEligibleChatSwipeTarget(event.target)) return;
    const deltaX = event.deltaX;
    const deltaY = event.deltaY;
    if (!Number.isFinite(deltaX) || Math.abs(deltaX) < 72) return;
    if (Math.abs(deltaX) <= Math.abs(deltaY) * 1.35) return;
    if (event.cancelable) event.preventDefault();
    const now = Date.now();
    if (now - wheelState.lastTriggeredAt < 450) return;
    wheelState.lastTriggeredAt = now;
    doSwitch(deltaX > 0 ? 'next' : 'prev');
  }

  /* ── attach listeners ── */

  el.addEventListener('pointerdown', onPointerDown, { passive: true });
  el.addEventListener('touchstart', onTouchStart, { passive: true });
  el.addEventListener('touchmove', onTouchMove, { passive: false });
  el.addEventListener('touchend', onTouchEnd, { passive: true });
  el.addEventListener('touchcancel', onTouchCancel, { passive: true });
  el.addEventListener('wheel', onWheel, { passive: false });

  return () => {
    el.removeEventListener('pointerdown', onPointerDown);
    el.removeEventListener('touchstart', onTouchStart);
    el.removeEventListener('touchmove', onTouchMove);
    el.removeEventListener('touchend', onTouchEnd);
    el.removeEventListener('touchcancel', onTouchCancel);
    el.removeEventListener('wheel', onWheel);
    if (indicator) {
      hideIndicator(indicator);
      indicator.remove();
      indicator = null;
    }
  };
}
