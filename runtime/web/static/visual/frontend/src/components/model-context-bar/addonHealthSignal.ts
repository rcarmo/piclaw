import { signal } from "@preact/signals";
import type { AddonApiStatus } from "./types";

/**
 * Shared module-level signal for add-on API health status.
 * Updated by useStatusPolling on each poll cycle.
 * Consumed by AddonHealthBadge (status bar) and AddonsPanel.
 */
export const addonHealthSignal = signal<AddonApiStatus | null>(null);
