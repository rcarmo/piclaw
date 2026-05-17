import { FALLBACK_THINKING_LEVELS } from "./types";

interface ThinkingPickerProps {
  thinkingLevels: string[];
  currentLevel: string;
  onSelectThinking: (level: string) => void;
}

export function ThinkingPicker({ thinkingLevels, currentLevel, onSelectThinking }: ThinkingPickerProps) {
  const levels = thinkingLevels.length ? thinkingLevels : FALLBACK_THINKING_LEVELS;
  return (
    <div
      data-model-picker
      className="thinking-picker"
    >
      {levels.map((level) => {
        const isActive = level === currentLevel;
        return (
          <div
            key={level}
            className={`thinking-picker__item${isActive ? " thinking-picker__item--active" : ""}`}
            role="button"
            tabIndex={0}
            onClick={(ev) => { ev.stopPropagation(); onSelectThinking(level); }}
            onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); e.stopPropagation(); onSelectThinking(level); } }}
          >
            <span className="thinking-picker__item__check">{isActive ? "✓" : ""}</span>
            <span>{level}</span>
          </div>
        );
      })}
    </div>
  );
}
