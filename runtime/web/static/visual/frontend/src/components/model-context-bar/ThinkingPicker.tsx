interface ThinkingPickerProps {
  thinkingLevels: string[];
  currentLevel: string;
  onSelectThinking: (level: string) => void;
}

export function ThinkingPicker({ thinkingLevels, currentLevel, onSelectThinking }: ThinkingPickerProps) {
  return (
    <div
      data-model-picker
      className="thinking-picker"
    >
      {thinkingLevels.length === 0 && <div className="model-picker__empty">Thinking levels unavailable.</div>}
      {thinkingLevels.map((level) => {
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
