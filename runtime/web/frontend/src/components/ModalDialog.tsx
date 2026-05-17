import { useEffect, useRef, useState } from "preact/hooks";
import { OverlayShell } from "./OverlayShell";

export type ModalDialogMode = "prompt" | "confirm" | "alert";

interface ModalDialogProps {
  mode: ModalDialogMode;
  title: string;
  description?: string;
  placeholder?: string;
  defaultValue?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
  onConfirm: (value?: string) => void;
  onCancel: () => void;
}

export function ModalDialog({
  mode, title, description, placeholder, defaultValue,
  confirmLabel, cancelLabel, destructive = false, onConfirm, onCancel,
}: ModalDialogProps) {
  const [value, setValue] = useState(defaultValue ?? "");
  const inputRef = useRef<HTMLInputElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);
  const titleId = useRef(`modal-title-${Math.random().toString(36).slice(2, 9)}`);
  const descId = useRef(`modal-desc-${Math.random().toString(36).slice(2, 9)}`);

  useEffect(() => { setValue(defaultValue ?? ""); }, [defaultValue]);

  useEffect(() => {
    const t = window.setTimeout(() => {
      if (mode === "prompt") { inputRef.current?.focus(); inputRef.current?.select(); }
      else confirmRef.current?.focus();
    }, 0);
    return () => window.clearTimeout(t);
  }, [mode]);

  const canBackdropClose = !(mode === "confirm" && destructive);
  const submit = () => mode === "prompt" ? onConfirm(value) : onConfirm();

  return (
    <OverlayShell
      open
      onClose={onCancel}
      escape="close"
      backdrop={canBackdropClose ? "close" : "ignore"}
      tier="modal"
      className="modal-dialog__backdrop"
      ariaLabel={title}
    >
      <div
        className="modal-dialog"
        tabIndex={-1}
        aria-labelledby={titleId.current}
        aria-describedby={description ? descId.current : undefined}
        onMouseDown={e => e.stopPropagation()}
      >
        <h2 id={titleId.current} className="modal-dialog__title">{title}</h2>
        {description && <p id={descId.current} className="modal-dialog__description">{description}</p>}
        {mode === "prompt" && (
          <input
            ref={inputRef}
            className="modal-dialog__input"
            type="text"
            value={value}
            placeholder={placeholder}
            onInput={e => setValue((e.target as HTMLInputElement).value)}
            onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); submit(); } }}
          />
        )}
        <div className="modal-dialog__actions">
          {mode !== "alert" && (
            <button type="button" className="modal-dialog__btn" onClick={onCancel}>
              {cancelLabel ?? "Cancel"}
            </button>
          )}
          <button
            ref={confirmRef}
            type="button"
            className={`modal-dialog__btn${destructive ? " modal-dialog__btn--destructive" : " modal-dialog__btn--primary"}`}
            onClick={submit}
          >
            {confirmLabel ?? (mode === "prompt" ? "Save" : mode === "confirm" ? "Confirm" : "OK")}
          </button>
        </div>
      </div>
    </OverlayShell>
  );
}
