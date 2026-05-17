import type { ModelEntry } from "./types";
import { formatTokenWindow } from "../../utils/format";
import { getEffectiveContextWindow } from "../../utils/context-budget";

interface ModelPickerProps {
  models: ModelEntry[];
  activeModel: string;
  onSelectModel: (id: string) => void;
}

export function ModelPicker({ models, activeModel, onSelectModel }: ModelPickerProps) {
  return (
    <div
      data-model-picker
      className="model-picker"
    >
      {models.map((entry) => {
        const isCurrent = entry.id === activeModel;
        const effectiveCtx = entry.context_window ? getEffectiveContextWindow(entry.context_window) : null;
        const ctxK = effectiveCtx ? formatTokenWindow(effectiveCtx) : "";
        return (
          <div
            key={entry.id}
            className={`model-picker__item${isCurrent ? " model-picker__item--active" : ""}`}
            role="button"
            tabIndex={0}
            onClick={() => onSelectModel(entry.id)}
            onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onSelectModel(entry.id); } }}
          >
            <span className="model-picker__item__check">
              {isCurrent ? "✓" : ""}
            </span>
            <span className="model-picker__item__name">{entry.id}</span>
            {ctxK && <span className="model-picker__item__ctx">{ctxK}</span>}
          </div>
        );
      })}
    </div>
  );
}
