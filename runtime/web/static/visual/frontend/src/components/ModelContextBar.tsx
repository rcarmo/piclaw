import { useEffect, useRef } from "preact/hooks";
import { useComputed } from "@preact/signals";
import { useDismissableLayer } from "../hooks/useDismissableLayer";
import { useStatusPolling } from "./model-context-bar/useStatusPolling";
import { useCompaction } from "./model-context-bar/useCompaction";
import { useModelPicker } from "./model-context-bar/useModelPicker";
import { ModelPicker } from "./model-context-bar/ModelPicker";
import { ThinkingPicker } from "./model-context-bar/ThinkingPicker";
import { ContextRing } from "./model-context-bar/ContextRing";
import { providerConfigured } from "../app/providerState";

export function ModelContextBar() {
  const {
    agentStatus, agentContext, isStale,
    currentModel, currentThinkingLevel, modelContextWindow,
    usageLabel, providerUsage,
    fetchContext,
  } = useStatusPolling();

  const { isCompacting, compactElapsed, handleCompact } = useCompaction(fetchContext);

  const {
    showPicker, showThinkingPicker, models, thinkingLevels,
    handleBadgeClick, handleSelectModel, handleThinkingClick, handleSelectThinking,
  } = useModelPicker();

  const contextTokens = useComputed(() => agentContext.value?.tokens ?? 0);
  const contextWindow = useComputed(() => agentContext.value?.contextWindow ?? modelContextWindow.value ?? 0);
  const contextPercent = useComputed(() => {
    const w = contextWindow.value, t = contextTokens.value;
    return agentContext.value?.percent ?? (w > 0 ? (t / w) * 100 : 0);
  });

  const modelName = agentStatus.value?.data?.model ?? currentModel.value ?? "";
  const thinkingLevel = agentStatus.value?.data?.thinking_level || currentThinkingLevel.value || "";
  const activeModel = currentModel.value ?? modelName;

  const pickerOpen = showPicker.value || showThinkingPicker.value;
  const pickerWrapRef = useRef<HTMLSpanElement>(null);
  const dismissPickers = () => { showPicker.value = false; showThinkingPicker.value = false; };
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
        />
      )}
      {isCompacting.value && (
        <span className="compaction-badge">⟳ Compacting... {compactElapsed.value}s</span>
      )}
      <span
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
              currentLevel={thinkingLevel}
              onSelectThinking={handleSelectThinking}
            />
          )}
        </span>
      )}
      <ContextRing
        tokens={contextTokens.value}
        contextWindow={contextWindow.value}
        onClick={(e) => handleCompact(e, fetchContext)}
      />
      {usageLabel.value && (
        <span
          className="usage-badge"
          title={[
            providerUsage.value?.provider ? `Provider: ${(providerUsage.value as Record<string, unknown>).provider}` : "",
            providerUsage.value?.plan ? `Plan: ${(providerUsage.value as Record<string, unknown>).plan}` : "",
          ].filter(Boolean).join("\n")}
        >
          {usageLabel.value}
        </span>
      )}
    </span>
  );
}
