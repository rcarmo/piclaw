import { useCallback, useEffect } from "preact/hooks";
import { useSignal } from "@preact/signals";
import { getMessageUrl, getChatJid } from "../../api/chat-jid";
import type { ModelInfo, VisualModelEntry } from "./types";
import { normaliseModelCatalogue } from "../../../../../../src/ui/model-catalogue";
import {
  MODEL_CATALOGUE_PREFERENCES_EVENT,
  readModelCataloguePreferences,
  recordRecentModelKey,
  toModelCatalogueNormalisePreferences,
  togglePinnedModelKey,
} from "../../../../../../src/ui/model-catalogue-preferences";

export interface UseModelPickerResult {
  showPicker: ReturnType<typeof useSignal<boolean>>;
  showThinkingPicker: ReturnType<typeof useSignal<boolean>>;
  models: ReturnType<typeof useSignal<VisualModelEntry[]>>;
  handleBadgeClick: (e: Event) => Promise<void>;
  handleSelectModel: (id: string) => Promise<void>;
  handleTogglePin: (id: string) => void;
  handleThinkingClick: (e: Event) => void;
  handleSelectThinking: (level: string) => Promise<void>;
}

const flashStatus = (message: string) => {
  window.dispatchEvent(new CustomEvent("piclaw:status-flash", { detail: { message, type: "error" } }));
};

export function normaliseVisualModelPickerOptions(info: ModelInfo): VisualModelEntry[] {
  const hasStructuredOptions = Array.isArray(info.model_options) && info.model_options.length > 0;
  return normaliseModelCatalogue(info, toModelCatalogueNormalisePreferences(readModelCataloguePreferences())).map((entry) => ({
    ...entry,
    reasoningKnown: hasStructuredOptions,
  }));
}

export function useModelPicker(): UseModelPickerResult {
  const showPicker = useSignal<boolean>(false);
  const showThinkingPicker = useSignal<boolean>(false);
  const models = useSignal<VisualModelEntry[]>([]);

  useEffect(() => {
    const applyPreferences = () => {
      const preferences = readModelCataloguePreferences();
      const pinned = new Set(preferences.pinnedKeys);
      models.value = models.value.map((entry) => ({
        ...entry,
        pinned: pinned.has(entry.key),
        lastUsedAt: preferences.recentByKey[entry.key] ?? null,
      }));
    };
    window.addEventListener(MODEL_CATALOGUE_PREFERENCES_EVENT, applyPreferences);
    window.addEventListener("storage", applyPreferences);
    return () => {
      window.removeEventListener(MODEL_CATALOGUE_PREFERENCES_EVENT, applyPreferences);
      window.removeEventListener("storage", applyPreferences);
    };
  }, []);

  const handleBadgeClick = useCallback(async (e: Event) => {
    e.stopPropagation();
    if (showPicker.value) { showPicker.value = false; return; }
    showPicker.value = true;
    const chatJid = getChatJid();
    try {
      const res = await fetch("/agent/models?chat_jid=" + encodeURIComponent(chatJid));
      if (chatJid !== getChatJid()) return;
      if (res.ok) {
        const info = await res.json() as ModelInfo;
        if (chatJid !== getChatJid()) return;
        models.value = normaliseVisualModelPickerOptions(info);
        window.dispatchEvent(new CustomEvent("piclaw:model-state-changed", { detail: { chatJid, payload: info, source: "picker" } }));
      } else { flashStatus("Model fetch failed"); }
    } catch { if (chatJid === getChatJid()) flashStatus("Model fetch failed"); }
  }, []);

  const handleSelectModel = useCallback(async (id: string) => {
    const chatJid = getChatJid();
    try {
      const res = await fetch(getMessageUrl(), {
        method: "POST", credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: `/model ${id}` }),
      });
      if (chatJid !== getChatJid()) return;
      if (!res.ok) { flashStatus("Model switch failed"); return; }
      const data = await res.json().catch(() => null);
      if (chatJid !== getChatJid()) return;
      if (data?.command === false || data?.error || data?.command?.status === "error") {
        flashStatus(data?.error ?? data?.command?.message ?? "Model switch failed");
        return;
      }
      const confirmedResponse = await fetch("/agent/models?chat_jid=" + encodeURIComponent(chatJid));
      if (chatJid !== getChatJid()) return;
      if (!confirmedResponse.ok) { flashStatus("Could not confirm model switch"); return; }
      const info = await confirmedResponse.json() as ModelInfo;
      if (chatJid !== getChatJid()) return;
      const confirmed = normaliseVisualModelPickerOptions(info);
      models.value = confirmed;
      window.dispatchEvent(new CustomEvent("piclaw:model-state-changed", { detail: { chatJid, payload: info, source: "picker" } }));
      const confirmedCurrent = confirmed.find((entry) => entry.current)?.key ?? info.current;
      if (confirmedCurrent !== id) {
        flashStatus("Model switch was not confirmed");
        return;
      }
      recordRecentModelKey(id);
      showPicker.value = false;
    } catch { if (chatJid === getChatJid()) flashStatus("Model switch failed"); }
  }, []);

  const handleTogglePin = useCallback((id: string) => {
    togglePinnedModelKey(id);
  }, []);

  const handleThinkingClick = useCallback((e: Event) => {
    e.stopPropagation();
    showThinkingPicker.value = !showThinkingPicker.value;
    showPicker.value = false;
  }, []);

  const handleSelectThinking = useCallback(async (level: string) => {
    const chatJid = getChatJid();
    try {
      const res = await fetch(getMessageUrl(), {
        method: "POST", credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: `/thinking ${level}` }),
      });
      const data = await res.json().catch(() => null);
      if (chatJid !== getChatJid()) return;
      if (res.ok && data?.command !== false && data?.command?.status !== "error" && !data?.error) {
        showThinkingPicker.value = false;
        window.dispatchEvent(new CustomEvent("piclaw:model-state-changed", { detail: { chatJid, source: "picker" } }));
      } else flashStatus(data?.error ?? data?.command?.message ?? "Thinking switch failed");
    } catch { if (chatJid === getChatJid()) flashStatus("Thinking switch failed"); }
  }, []);

  return { showPicker, showThinkingPicker, models, handleBadgeClick, handleSelectModel, handleTogglePin, handleThinkingClick, handleSelectThinking };
}
