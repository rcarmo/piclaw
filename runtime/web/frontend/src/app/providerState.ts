/**
 * providerState.ts — Global signal for provider configuration status.
 * Populated by useStatusPolling from /agent/models oobe field.
 */
import { signal } from "@preact/signals";

/**
 * `null`  = not yet determined (initial state)
 * `true`  = provider is configured and ready
 * `false` = no provider configured (OOBE not complete)
 */
export const providerConfigured = signal<boolean | null>(null);
