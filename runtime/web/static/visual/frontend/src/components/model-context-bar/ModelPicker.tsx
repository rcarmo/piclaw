import type { ModelEntry } from "./types";
import { formatTokenWindow } from "../../utils/format";

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
        const ctxK = entry.context_window ? formatTokenWindow(entry.context_window) : "";
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
