import type { Signal } from "@preact/signals";
import { TerminalComponent } from "../components/TerminalComponent";

interface TerminalPanelProps {
  terminalMaximized: Signal<boolean>;
  terminalVisible: Signal<boolean>;
  onDragStart: (e: MouseEvent) => void;
  /** When true, renders as a full-height tab (no drag handle, no close button). */
  tabMode?: boolean;
}

const activateOnEnterOrSpace = (e: KeyboardEvent, handler: () => void) => {
  if (e.key === "Enter" || e.key === " ") {
    e.preventDefault();
    handler();
  }
};

export function TerminalPanel({ terminalMaximized, terminalVisible, onDragStart, tabMode = false }: TerminalPanelProps) {
  return (
    <>
      {!tabMode && (
        <div
          className="app-layout__term-drag-handle"
          onMouseDown={onDragStart}
        />
      )}
      {!tabMode && (
        <div className="terminal__header">
          <span className="terminal__title">Terminal</span>
          <div className="terminal__actions">
          <span
            className="terminal__btn"
            role="button"
            tabIndex={0}
            onClick={() => { terminalMaximized.value = !terminalMaximized.value; }}
            onKeyDown={(e) => activateOnEnterOrSpace(e, () => { terminalMaximized.value = !terminalMaximized.value; })}
            title={terminalMaximized.value ? "Restore" : "Maximize"}
            aria-label={terminalMaximized.value ? "Restore" : "Maximize"}
          >
            <i className={terminalMaximized.value ? "codicon codicon-screen-normal" : "codicon codicon-screen-full"} />
          </span>
          <span
            className="terminal__btn"
            role="button"
            tabIndex={0}
            onClick={() => { window.open("/static/terminal.html", "_blank"); }}
            onKeyDown={(e) => activateOnEnterOrSpace(e, () => { window.open("/static/terminal.html", "_blank"); })}
            title="Open in new tab"
            aria-label="Open in new tab"
          >
            <i className="codicon codicon-link-external" />
          </span>
          <span
            className="terminal__btn"
            role="button"
            tabIndex={0}
            onClick={() => { window.open("/static/terminal.html", "piclaw-terminal", "width=800,height=600,menubar=no,toolbar=no"); }}
            onKeyDown={(e) => activateOnEnterOrSpace(e, () => { window.open("/static/terminal.html", "piclaw-terminal", "width=800,height=600,menubar=no,toolbar=no"); })}
            title="Pop out to window"
            aria-label="Pop out to window"
          >
            <i className="codicon codicon-multiple-windows" />
          </span>
          <span
            className="terminal__btn"
            role="button"
            tabIndex={0}
            onClick={() => { terminalVisible.value = false; terminalMaximized.value = false; }}
            onKeyDown={(e) => activateOnEnterOrSpace(e, () => { terminalVisible.value = false; terminalMaximized.value = false; })}
            title="Close (Ctrl+`)"
            aria-label="Close (Ctrl+`)"
          >
            &#x2715;
          </span>
        </div>
      </div>
      )}
      <TerminalComponent />
    </>
  );
}
