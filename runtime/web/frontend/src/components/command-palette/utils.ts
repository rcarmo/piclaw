import { getMessageUrl } from "../../api/chat-jid";

/**
 * Sends a slash command to the backend message endpoint.
 */
export function sendCommand(command: string) {
  fetch(getMessageUrl(), {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content: command }),
  }).catch((err) => {
    console.warn("[CommandPalette] send failed:", err);
    window.dispatchEvent(
      new CustomEvent("piclaw:status-flash", {
        detail: { message: "Command failed", type: "error" },
      })
    );
  });
}

/**
 * Resolves autocomplete options for a command that uses a remote endpoint.
 */
export async function fetchAutocompleteOptions(
  fetchUrl: string,
  extractField?: string,
  mapLabel?: string
): Promise<string[]> {
  try {
    const res = await fetch(fetchUrl, { credentials: "same-origin" });
    const data = await res.json();
    const raw = extractField ? data[extractField] ?? [] : [];
    if (!Array.isArray(raw)) return [];
    if (mapLabel) return raw.map((item: Record<string, unknown>) => String(item[mapLabel] ?? "")).filter(Boolean);
    return raw;
  } catch (err) {
    console.warn("[CommandPalette] Failed to fetch autocomplete options:", err);
    return [];
  }
}
