import { type Signal } from "@preact/signals";

export function NumberStepper({ value, min, max, step, onSave }: {
  value: Signal<number>;
  min?: number;
  max?: number;
  step?: number;
  onSave: (v: number) => void;
}) {
  const s = step ?? 1;
  const decrement = () => {
    const next = Math.max(min ?? -Infinity, value.value - s);
    value.value = next;
    onSave(next);
  };
  const increment = () => {
    const next = Math.min(max ?? Infinity, value.value + s);
    value.value = next;
    onSave(next);
  };
  return (
    <div className="settings-panel__stepper">
      <button type="button" className="settings-panel__stepper-btn" onClick={decrement}>−</button>
      <input
        className="settings-panel__stepper-value"
        type="number"
        min={min}
        max={max}
        value={value.value}
        onInput={(e) => (value.value = Number((e.target as HTMLInputElement).value))}
        onBlur={() => onSave(value.value)}
      />
      <button type="button" className="settings-panel__stepper-btn" onClick={increment}>+</button>
    </div>
  );
}
