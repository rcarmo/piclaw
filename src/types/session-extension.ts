/**
 * Timing for when a configuration change should be applied.
 */
export type ApplyTiming = 'immediate' | 'next_session';

/**
 * Specification for a Piclaw session extension.
 * Extensions can be registered late to avoid circular imports.
 */
export interface PiclawSessionExtensionSpec {
    /** Unique identifier for the extension. */
    id: string;
    /**
     * Optional function to create session extensions.
     * Called when a new session is initialized.
     */
    createSessionExtensions?: () => unknown;
    /**
     * Apply configuration changes to the session.
     * @param config - The configuration object to apply.
     * @param timing - When to apply the changes.
     */
    applyConfig?: (config: Record<string, unknown>, timing: ApplyTiming) => void | Promise<void>;
    /**
     * Clear configuration from the session.
     * @param keys - Optional keys to clear; if omitted, clear all.
     */
    clearConfig?: (keys?: string[]) => void | Promise<void>;
    /**
     * Check if there is an active live session.
     * @returns True if a live session exists, false otherwise.
     */
    hasLiveSession?: () => boolean;
}
