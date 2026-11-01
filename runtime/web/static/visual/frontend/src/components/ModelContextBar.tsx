import { useRef } from "preact/hooks";
import { useComputed } from "@preact/signals";
import { useDismissableLayer } from "../hooks/useDismissableLayer";
import type { UseStatusPollingResult } from "./model-context-bar/useStatusPolling";
import { useCompaction } from "./model-context-bar/useCompaction";
import { useModelPicker } from "./model-context-bar/useModelPicker";
import { ModelPicker } from "./model-context-bar/ModelPicker";
import { ThinkingPicker } from "./model-context-bar/ThinkingPicker";
import { ContextRing } from "./model-context-bar/ContextRing";
import { providerConfigured } from "../app/providerState";
import { formatVisualLatestRunUsage, formatVisualProviderUsage } from "./model-context-bar/telemetry";

export function ModelContextBar({ polling }: { polling: UseStatusPollingResult }) {
  const {
    agentStatus, agentContext, isStale,
    currentModel, currentThinkingLevel,
    providerUsage, modelSelectionKnown, modelInfo,
    fetchContext,
  } = polling;

  const { isCompacting, compactElapsed, handleCompact } = useCompaction(fetchContext);

  const {
    showPicker, showThinkingPicker, models,
    handleBadgeClick, handleSelectModel, handleTogglePin, handleThinkingClick, handleSelectThinking,
  } = useModelPicker();

  const contextTokens = useComputed(() => agentContext.value?.tokens ?? null);
  const contextWindow = useComputed(() => agentContext.value?.contextWindow ?? null);
  const contextPercent = useComputed(() => agentContext.value?.percent ?? null);
  const thinkingLevels = useComputed(() => {
    const levels = modelInfo.value?.available_thinking_levels;
    return Array.isArray(levels) ? levels.filter((level): level is string => typeof level === 'string') : [];
  });

  const modelName = modelSelectionKnown.value ? currentModel.value ?? "" : agentStatus.value?.data?.model ?? "";
  const thinkingLevel = modelSelectionKnown.value ? currentThinkingLevel.value : agentStatus.value?.data?.thinking_level || "";
  const activeModel = currentModel.value ?? modelName;
  const providerUsageMeta = formatVisualProviderUsage(providerUsage.value);
  const latestRunUsageMeta = formatVisualLatestRunUsage(agentContext.value, activeModel || null);

  const pickerOpen = showPicker.value || showThinkingPicker.value;
  const pickerWrapRef = useRef<HTMLSpanElement>(null);
  const modelBadgeRef = useRef<HTMLSpanElement>(null);
  const dismissPickers = () => { showPicker.value = false; showThinkingPicker.value = false; };
  const closeModelPicker = () => {
    showPicker.value = false;
    requestAnimationFrame(() => modelBadgeRef.current?.focus());
  };
  useDismissableLayer({ ref: pickerWrapRef, open: pickerOpen, onDismiss: dismissPickers, outsideEvent: "click" });

  return (
    <span
      ref={pickerWrapRef}
      data-model-picker
      className={`model-badge-wrapper${isStale.value ? " model-badge-wrapper--stale" : ""}`}
    >
      {providerConfigured.value === false && (
        <span
          className="no-provider-badge"
          role="button"
          tabIndex={0}
          title="No AI provider configured — click to set up"
          onClick={() => window.dispatchEvent(new CustomEvent("piclaw:show-wizard"))}
          onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); window.dispatchEvent(new CustomEvent("piclaw:show-wizard")); } }}
        >
          ⚠ No provider
        </span>
      )}
      {showPicker.value && (
        <ModelPicker
          models={models.value ?? []}
          activeModel={activeModel}
          onSelectModel={(id) => handleSelectModel(id, (m) => { currentModel.value = m; })}
          onTogglePin={handleTogglePin}
          onClose={closeModelPicker}
          onCompact={() => {
            showPicker.value = false;
            void handleCompact(new Event("click"), fetchContext);
          }}
          onOpenSettings={() => {
            showPicker.value = false;
            window.dispatchEvent(new CustomEvent("piclaw:open-settings", { detail: { section: "models" } }));
          }}
        />
      )}
      {isCompacting.value && (
        <span className="compaction-badge">⟳ Compacting... {compactElapsed.value}s</span>
      )}
      <span
        ref={modelBadgeRef}
        className={`model-badge${!modelName ? " model-badge--empty" : ""}`}
        role="button"
        tabIndex={0}
        onClick={(e) => handleBadgeClick(e, modelName, (l) => { currentThinkingLevel.value = l; }, (m) => { currentModel.value = m; })}
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); handleBadgeClick(e, modelName, (l) => { currentThinkingLevel.value = l; }, (m) => { currentModel.value = m; }); } }}
        title={modelName ? `${modelName}${thinkingLevel ? ` • ${thinkingLevel}` : ""} — click to switch model` : "No model selected — click to choose"}
      >
        {modelName ? (
          <span className="model-badge__name-wrapper">
            <span className="model-badge__provider">{modelName.includes("/") ? modelName.split("/")[0] + "/" : ""}</span>
            <span className="model-badge__name">{modelName.split("/").pop() || modelName}</span>
          </span>
        ) : (
          <span className="model-badge__empty">Select model…</span>
        )}
      </span>
      {thinkingLevel && (
        <span data-model-picker className="thinking-badge-wrapper">
          <span
            className="thinking-badge"
            role="button"
            tabIndex={0}
            onClick={handleThinkingClick}
            onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); handleThinkingClick(e); } }}
            title="Click to change thinking level"
          >
            {thinkingLevel}
          </span>
          {showThinkingPicker.value && (
            <ThinkingPicker
              thinkingLevels={thinkingLevels.value ?? []}
              currentLevel={modelInfo.value?.thinking_level ?? thinkingLevel}
              onSelectThinking={handleSelectThinking}
            />
          )}
        </span>
      )}
      <ContextRing
        percent={contextPercent.value}
        tokens={contextTokens.value}
        contextWindow={contextWindow.value}
        onClick={(e) => handleCompact(e, fetchContext)}
      />
      {providerUsageMeta && (
        <span className="usage-badge" title={providerUsageMeta.title}>
          {providerUsageMeta.label}
        </span>
      )}
      {latestRunUsageMeta && (
        <span className="usage-badge" title={latestRunUsageMeta.title}>
          {latestRunUsageMeta.label}
        </span>
      )}
    </span>
  );
}
