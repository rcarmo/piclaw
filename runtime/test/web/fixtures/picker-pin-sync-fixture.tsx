import { startPickerPinSync } from "../../../web/src/ui/picker-pin-sync";
import {
  readModelCataloguePreferences,
  togglePinnedModelKey,
  MODEL_CATALOGUE_PREFERENCES_EVENT,
  recordRecentModelKey,
} from "../../../web/src/ui/model-catalogue-preferences";
import {
  readSessionPickerPreferences,
  togglePinnedSessionChatJid,
  SESSION_PICKER_PREFERENCES_EVENT,
} from "../../../web/src/ui/session-picker-preferences";

const source = new EventSource("/sse");
source.onerror = () => {};
source.addEventListener("picker_pins_changed", () =>
  window.dispatchEvent(new Event("piclaw:picker-pins-changed")),
);
source.onopen = () => window.dispatchEvent(new Event("piclaw:sse-connected"));
const errors: string[] = [];
const sync = startPickerPinSync({
  onError: (message) => {
    errors.push(message);
    document.getElementById("errors")!.textContent = message;
  },
});
const state = () => ({
  models: readModelCataloguePreferences().pinnedKeys,
  sessions: readSessionPickerPreferences().pinnedChatJids,
});
Object.assign(window, {
  pinFixture: {
    state,
    errors,
    refresh: sync.refresh,
    stop: () => {
      sync.stop();
      source.close();
    },
    model: (key: string) => togglePinnedModelKey(key),
    session: (key: string) => togglePinnedSessionChatJid(key),
    recent: (key: string) => recordRecentModelKey(key),
  },
});
const host = document.getElementById("app")!;
{
  const { html, render, useState, useEffect } =
    await import("../../../web/src/vendor/preact-htm");
  const { ClassicModelPicker } =
    await import("../../../web/src/components/model-picker");
  const { normaliseModelCatalogue } =
    await import("../../../web/src/ui/model-catalogue");
  function Picker() {
    const [prefs, setPrefs] = useState(readModelCataloguePreferences());
    useEffect(() => {
      const fn = () => setPrefs(readModelCataloguePreferences());
      window.addEventListener(MODEL_CATALOGUE_PREFERENCES_EVENT, fn);
      return () =>
        window.removeEventListener(MODEL_CATALOGUE_PREFERENCES_EVENT, fn);
    }, []);
    const entries = normaliseModelCatalogue(
      { models: ["test/a", "test/b"], current: "test/a" },
      prefs,
    );
    return html`<${ClassicModelPicker}
      entries=${entries}
      activeModel="test/a"
      contextUsage=${null}
      onSelect=${() => {}}
      onTogglePin=${(entry: { key: string }) => togglePinnedModelKey(entry.key)}
      onClose=${() => {}}
    />`;
  }
  render(html`<${Picker} />`, host);
}
for (const event of [
  MODEL_CATALOGUE_PREFERENCES_EVENT,
  SESSION_PICKER_PREFERENCES_EVENT,
])
  window.addEventListener(event, () => {
    document.getElementById("state")!.textContent = JSON.stringify(state());
  });
document.getElementById("state")!.textContent = JSON.stringify(state());
