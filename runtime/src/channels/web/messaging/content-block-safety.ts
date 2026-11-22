/** Internal timeline metadata that public callers must not be allowed to forge. */
const INTERNAL_CONTENT_BLOCK_TYPES = new Set([
  "addon_local_dispatch",
  "restart_handoff",
  "self_continuation",
  "control_intent",
  "turn_outcome_marker",
  "agent_turn_marker",
  "agent_message_role",
  "a2ui_surface",
  "a2ui_submission",
]);

const MODEL_FORBIDDEN_CONTENT_BLOCK_TYPES = new Set([
  "addon_local_dispatch",
  "control_intent",
  "turn_outcome_marker",
  "agent_turn_marker",
  "agent_message_role",
  "a2ui_surface",
  "a2ui_submission",
]);

/** Strip agent-owned metadata from public user-controlled content blocks. */
export function sanitizePublicInboundContentBlocks(value: unknown): unknown[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return value.filter((block) => {
    if (!block || typeof block !== "object" || Array.isArray(block)) return true;
    const type = typeof (block as { type?: unknown }).type === "string"
      ? (block as { type: string }).type
      : "";
    return !INTERNAL_CONTENT_BLOCK_TYPES.has(type);
  });
}

/** Strip control authority from model-authored messages while retaining agent presentation metadata. */
export function sanitizeModelPostedContentBlocks(value: unknown): unknown[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return value.filter((block) => (
    !block
    || typeof block !== "object"
    || Array.isArray(block)
    || !MODEL_FORBIDDEN_CONTENT_BLOCK_TYPES.has(String((block as { type?: unknown }).type ?? ""))
  ));
}

/** Strict persistence validation for already-resolved service-effect blocks. */
export function validateServiceEffectContentBlocks(
  value: unknown,
): readonly Readonly<Record<string, unknown>>[] | null {
  if (!Array.isArray(value)) return null;
  if (value.some((block) => !block || typeof block !== "object" || Array.isArray(block))) return null;
  if (sanitizePublicInboundContentBlocks(value)?.length !== value.length) return null;
  return Object.freeze(value.map((block) => Object.freeze({ ...(block as Record<string, unknown>) })));
}
