export function shouldIgnoreMismatchedTurn(
  turnId: unknown,
  currentTurnId: unknown,
): boolean {
  return Boolean(turnId) && Boolean(currentTurnId) && turnId !== currentTurnId;
}

/** Terminal events must name the live owner; older native phase events cannot
 * take ownership back after a newer turn has already been observed. */
export function shouldIgnoreAgentStatus(
  incoming: Record<string, any>,
  current: Record<string, any> | null,
): boolean {
  const turn = incoming.turn_id || incoming.turnId;
  const liveTurn = current?.turn_id || current?.turnId;
  if (['done', 'error', 'idle'].includes(incoming.type)) {
    return Boolean(liveTurn) && turn !== liveTurn;
  }
  if (!turn || !liveTurn || turn === liveTurn) return false;
  // Public SDK task IDs keep coalesced/replayed run observations ordered even
  // when projection timestamps coincide or a watch is reattached later.
  if (Number.isSafeInteger(incoming.task_id) && Number.isSafeInteger(current?.task_id)) {
    return incoming.task_id < current!.task_id;
  }
  const started = Date.parse(incoming.started_at);
  const liveStarted = Date.parse(current?.started_at);
  return Number.isFinite(started) && Number.isFinite(liveStarted) && started < liveStarted;
}

export function shouldAdoptIncomingTurn(
  turnId: unknown,
  currentTurnId: unknown,
): boolean {
  return Boolean(turnId) && !Boolean(currentTurnId);
}

export function resolveSteerQueuedTurnId(
  turnId: unknown,
  currentTurnId: unknown,
): unknown {
  return turnId || currentTurnId || null;
}

export function readPersistedIntermediateTurnId(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object') return null;
  const interaction = payload as Record<string, unknown>;
  const data = interaction.data && typeof interaction.data === 'object'
    ? interaction.data as Record<string, unknown>
    : interaction;
  const blocks = Array.isArray(data.content_blocks) ? data.content_blocks : [];
  for (const block of blocks) {
    if (!block || typeof block !== 'object') continue;
    const record = block as Record<string, unknown>;
    if (record.type !== 'agent_turn_marker') continue;
    const turnId = typeof record.turn_id === 'string' ? record.turn_id.trim() : '';
    const kind = record.kind;
    const cause = record.cause;
    const valid = kind === 'draft_snapshot'
      ? cause === 'interrupted_text_start' && record.followed_by_tool_use !== true
      : kind === 'intermediate' && (
          (cause === 'tool_use' && record.followed_by_tool_use === true)
          || ((cause === 'completed_boundary' || cause === 'failed_boundary') && record.followed_by_tool_use !== true)
        );
    if (valid && turnId) return turnId;
  }
  return null;
}
