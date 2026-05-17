import { useComputed } from "@preact/signals";
import { addonHealthSignal } from "./model-context-bar/addonHealthSignal";

/**
 * AddonHealthBadge — subtle status bar indicator shown when addon_api is degraded.
 * Reads from the shared addonHealthSignal (updated by useStatusPolling).
 */
export function AddonHealthBadge({ onOpenAddons }: { onOpenAddons: () => void }) {
  const isDegraded = useComputed(() => {
    const s = addonHealthSignal.value;
    return s !== null && s.healthy === false;
  });

  const tooltipText = useComputed(() => {
    const s = addonHealthSignal.value;
    if (!s || s.healthy !== false) return "";
    const names = s.degraded_addons?.join(", ");
    return names ? `Add-on degraded: ${names}` : "Add-on API degraded";
  });

  if (!isDegraded.value) return null;

  return (
    <button
      type="button"
      className="addon-health-badge"
      title={tooltipText.value}
      aria-label={tooltipText.value}
      onClick={onOpenAddons}
    >
      <span className="addon-health-badge__dot" aria-hidden="true" />
      <span className="addon-health-badge__label">Add-ons</span>
    </button>
  );
}
