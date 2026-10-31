import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { normaliseModelCatalogue, buildModelPickerProjection } from "../../web/src/ui/model-catalogue";

const source = readFileSync(new URL("../../web/src/components/compose-box.ts", import.meta.url), "utf8");

// Exercise the production closures with controlled backend responses, without a DOM
// or a second implementation of the selection/command logic.
function productionClosure(name: string, end: string, scope: Record<string, unknown>) {
  const start = source.indexOf(`    const ${name} = async (`);
  expect(start).toBeGreaterThan(-1);
  const body = source.slice(start, source.indexOf(end, start));
  return new Function(...Object.keys(scope), `${body}\nreturn ${name};`)(...Object.values(scope));
}

for (const refusal of [null, { error: "Native capacity refused" }, { command: false }, { command: { status: "error", message: "Native capacity refused" } }]) {
  test(`90K / 100K selection reaches backend and preserves ${refusal ? "refusal" : "acceptance"}: ${JSON.stringify(refusal)}`, async () => {
    const [entry] = normaliseModelCatalogue({ model_options: [{ provider: "test", id: "near", context_window: 100_000 }] });
    expect(entry).not.toHaveProperty("contextFit");
    expect(buildModelPickerProjection([entry]).renderedEntries).toEqual([entry]);
    const calls: unknown[][] = [];
    const alerts: string[] = [];
    const recent: string[] = [];
    const popup: boolean[] = [];
    let refreshes = 0;
    const noop = () => {};
    const runModelCommand = productionClosure("runModelCommand", "    const handleSpeechButtonPointerDown", {
      searchMode: false, switchingModel: false,
      currentChatJid: "web:branch", currentChatJidRef: { current: "web:branch" },
      modelCommandGenerationRef: { current: 0 },
      setSubmitError: noop, setSubmitNotice: noop, setSwitchingModel: noop,
      sendMessage: async (...args: unknown[]) => { calls.push(args); return refusal ?? { command: { status: "success" } }; },
      refreshAgentModelStateBestEffort: async (_load: unknown, chat: string, emit: Function, confirm: Function) => {
        refreshes++;
        expect(chat).toBe("web:branch");
        const payload = { current: entry.key, models: [entry.key] };
        emit(payload); confirm(payload); return true;
      },
      loadModels: noop, emitModelState: noop, normaliseModelCatalogue,
      normalizeModelCataloguePreferenceKey: (key: string) => key,
      setModelOptions: noop, normaliseComposeModelCatalogue: normaliseModelCatalogue,
      contextUsage: { tokens: 90_000 }, modelPreferenceRuntime: {},
      recordRecentModelKey: (key: string) => recent.push(key),
      resolveUiOnlyCommandNotice: () => null, onPost: noop,
      console: { error: noop }, alert: (message: string) => alerts.push(message),
    });
    const choose = productionClosure("handleSelectModel", "    const runSessionPopupEntry", {
      switchingModel: false, runModelCommand,
      setShowModelPopup: (value: boolean) => popup.push(value),
      requestAnimationFrame: noop, modelHintRef: { current: null },
      contextUsage: { tokens: 90_000 },
    });
    await choose(entry);
    expect(calls).toEqual([["default", "/model test/near", null, [], null, "web:branch"]]);
    if (refusal) {
      const message = "error" in refusal || typeof refusal.command === "object"
        ? "Native capacity refused" : "Model switch failed.";
      expect(alerts).toEqual([`Failed to switch model: ${message}`]);
      expect(refreshes).toBe(0);
      expect(recent).toEqual([]);
      expect(popup).toEqual([]);
    } else {
      expect(alerts).toEqual([]);
      expect(refreshes).toBe(1);
      expect(recent).toEqual([entry.key]);
      expect(popup).toEqual([false]);
    }
  });
}
