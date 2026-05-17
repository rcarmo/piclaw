import { useRef } from "preact/hooks";
import { useDismissableLayer } from "../../hooks/useDismissableLayer";
import { HIGHLIGHT_COLORS } from "../../utils/highlight-serializer";

interface HighlightPopupProps {
  x: number;
  y: number;
  onSelectColor: (color: string) => void;
  onClear: () => void;
  onDismiss: () => void;
}

export function HighlightPopup({
  x,
  y,
  onSelectColor,
  onClear,
  onDismiss,
}: HighlightPopupProps) {
  const popupRef = useRef<HTMLDivElement>(null);

  useDismissableLayer({ ref: popupRef, open: true, onDismiss, outsideEvent: "mousedown" });

  // Offset so popup doesn't go off-screen
  const popupWidth = HIGHLIGHT_COLORS.length * 28 + 60;
  const left = Math.min(x, window.innerWidth - popupWidth - 8);
  const top = Math.max(8, y - 44);

  return (
    <div
      ref={popupRef}
      className="highlight-popup"
      style={{ left: `${left}px`, top: `${top}px` }}
      onMouseDown={(e) => e.stopPropagation()}
    >
      {HIGHLIGHT_COLORS.map((color) => (
        <button
          key={color}
          type="button"
          className="highlight-popup__color"
          style={{ background: color }}
          title="Highlight"
          onClick={(e) => {
            e.stopPropagation();
            onSelectColor(color);
          }}
        />
      ))}
      <button
        type="button"
        className="highlight-popup__clear"
        title="Clear highlight"
        onClick={(e) => {
          e.stopPropagation();
          onClear();
        }}
      >
        ✕
      </button>
    </div>
  );
}
