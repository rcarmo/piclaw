import { useCallback, useEffect } from "preact/hooks";
import { useSignal } from "@preact/signals";
import { getMessageUrl, getChatJid } from "../../api/chat-jid";
import type { ModelInfo, VisualModelEntry } from "./types";
import { FALLBACK_MODELS, FALLBACK_THINKING_LEVELS } from "./types";
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
  thinkingLevels: ReturnType<typeof useSignal<string[]>>;
  handleBadgeClick: (e: Event, currentModelName: string, onThinkingLevel: (l: string) => void, onCurrentModel: (m: string) => void) => Promise<void>;
  handleSelectModel: (id: string, onCurrentModel: (m: string) => void) => Promise<void>;
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

function fallbackModelCatalogue(current: string): VisualModelEntry[] {
  return normaliseVisualModelPickerOptions({
    current,
    models: [],
    model_options: FALLBACK_MODELS.map((entry) => ({
      provider: entry.id.split("/")[0],
      id: entry.id.split("/").slice(1).join("/"),
      label: entry.id,
      context_window: entry.context_window,
    })),
    thinking_level: null,
    thinking_level_label: null,
    supports_thinking: false,
    available_thinking_levels: [],
  });
}

export function useModelPicker(): UseModelPickerResult {
  const showPicker = useSignal<boolean>(false);
  const showThinkingPicker = useSignal<boolean>(false);
  const models = useSignal<VisualModelEntry[]>([]);
  const thinkingLevels = useSignal<string[]>([]);

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

  const handleBadgeClick = useCallback(async (
    e: Event,
    currentModelName: string,
    onThinkingLevel: (l: string) => void,
    onCurrentModel: (m: string) => void,
  ) => {
    e.stopPropagation();
    if (showPicker.value) { showPicker.value = false; return; }
    showPicker.value = true;
    if (!models.value.length) models.value = fallbackModelCatalogue(currentModelName);
    try {
      const res = await fetch("/agent/models?chat_jid=" + encodeURIComponent(getChatJid()));
      if (res.ok) {
        const info = await res.json() as ModelInfo;
        const catalogue = normaliseVisualModelPickerOptions(info);
        if (catalogue.length) models.value = catalogue;
        onCurrentModel(catalogue.find((entry) => entry.current)?.key ?? info.current ?? currentModelName);
        if (info.thinking_level_label || info.thinking_level) {
          onThinkingLevel(info.thinking_level_label ?? info.thinking_level!);
        }
        thinkingLevels.value = info.available_thinking_level_labels?.length
          ? info.available_thinking_level_labels
          : (info.available_thinking_levels?.length ? info.available_thinking_levels : FALLBACK_THINKING_LEVELS);
      } else { flashStatus("Model fetch failed"); }
    } catch { flashStatus("Model fetch failed"); }
  }, []);

  const handleSelectModel = useCallback(async (id: string, onCurrentModel: (m: string) => void) => {
    const chatJid = getChatJid();
    try {
      const res = await fetch(getMessageUrl(), {
        method: "POST", credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: `/model ${id}` }),
      });
      if (!res.ok) { flashStatus("Model switch failed"); return; }
      const data = await res.json().catch(() => null);
      if (data?.command === false || data?.error || data?.command?.status === "error") {
        flashStatus(data?.error ?? data?.command?.message ?? "Model switch failed");
        return;
      }
      const confirmedResponse = await fetch("/agent/models?chat_jid=" + encodeURIComponent(chatJid));
      if (!confirmedResponse.ok) { flashStatus("Could not confirm model switch"); return; }
      const info = await confirmedResponse.json() as ModelInfo;
      const confirmed = normaliseVisualModelPickerOptions(info);
      const confirmedCurrent = confirmed.find((entry) => entry.current)?.key ?? info.current;
      if (confirmedCurrent !== id) {
        if (confirmed.length) models.value = confirmed;
        flashStatus("Model switch was not confirmed");
        return;
      }
      models.value = confirmed;
      recordRecentModelKey(id);
      onCurrentModel(confirmedCurrent);
      showPicker.value = false;
      window.dispatchEvent(new CustomEvent("piclaw:model-state-changed", { detail: { chatJid, payload: info, source: "picker" } }));
    } catch { flashStatus("Model switch failed"); }
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
    try {
      const res = await fetch(getMessageUrl(), {
        method: "POST", credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: `/thinking ${level}` }),
      });
      const data = await res.json().catch(() => null);
      if (res.ok && data?.command?.status !== "error" && !data?.error) {
        showThinkingPicker.value = false;
        window.dispatchEvent(new CustomEvent("piclaw:model-state-changed", { detail: { chatJid: getChatJid(), source: "picker" } }));
      } else flashStatus(data?.error ?? data?.command?.message ?? "Thinking switch failed");
    } catch { flashStatus("Thinking switch failed"); }
  }, []);

  return { showPicker, showThinkingPicker, models, thinkingLevels, handleBadgeClick, handleSelectModel, handleTogglePin, handleThinkingClick, handleSelectThinking };
}
