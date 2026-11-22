/** Tombstones only. Never render, forward or reconstruct the retired payloads. */
export function isRetiredContentBlock(value: unknown): boolean {
  const type = value && typeof value === 'object' ? (value as { type?: unknown }).type : null;
  return type === 'adaptive_card' || type === 'adaptive_card_submission';
}
