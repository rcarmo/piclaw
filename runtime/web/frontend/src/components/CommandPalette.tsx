import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import { COMMAND_PARAMS } from "./command-palette-params";
import { CommandList } from "./command-palette/CommandList";
import { useCommandFetch } from "./command-palette/useCommandFetch";
import { useKeyboardNav } from "./command-palette/useKeyboardNav";
import { fetchAutocompleteOptions, sendCommand } from "./command-palette/utils";
import type { CommandPaletteProps, MergedCommand } from "./command-palette/types";

export function CommandPalette({ visible, onClose }: CommandPaletteProps) {
  const [query, setQuery] = useState("");
  const [step, setStep] = useState<"command" | "parameter">("command");
  const [selectedCommand, setSelectedCommand] = useState<string>("");
  const [autoCompleteOptions, setAutoCompleteOptions] = useState<string[]>([]);
  const [paramPlaceholder, setParamPlaceholder] = useState<string>("");
  const [paramAllowEmpty, setParamAllowEmpty] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  const allCommands = useCommandFetch(visible);

  useEffect(() => {
    if (visible) {
      setQuery(""); setStep("command"); setSelectedCommand("");
      setAutoCompleteOptions([]); setParamPlaceholder("");
      const t = window.setTimeout(() => inputRef.current?.focus(), 0);
      return () => window.clearTimeout(t);
    } else {
      setStep("command"); setSelectedCommand(""); setAutoCompleteOptions([]);
    }
  }, [visible]);

  const results = useMemo(() => {
    if (step === "parameter" && autoCompleteOptions.length > 0) {
      const q = query.trim().toLowerCase();
      return q ? autoCompleteOptions.filter((o) => o.toLowerCase().includes(q)) : autoCompleteOptions;
    }
    if (step === "parameter") return [];
    const q = query.trim().toLowerCase();
    if (!q) return allCommands;
    return allCommands.filter(
      (c) => c.label.toLowerCase().includes(q) || (c.description?.toLowerCase().includes(q) ?? false)
    );
  }, [query, allCommands, step, autoCompleteOptions]);

  const handleBack = () => {
    setStep("command"); setSelectedCommand(""); setAutoCompleteOptions([]); setQuery("");
  };

  const enterParameterStep = (name: string, options: string[], placeholder: string, allowEmpty = false) => {
    setSelectedCommand(name); setAutoCompleteOptions(options);
    setParamPlaceholder(placeholder); setParamAllowEmpty(allowEmpty); setStep("parameter");
    setSelectedIndex(0); setQuery("");
    window.setTimeout(() => inputRef.current?.focus(), 0);
  };

  const executeBackendCommand = async (command: MergedCommand) => {
    const name = command.label;
    const param = COMMAND_PARAMS[name];
    if (!param || param.type === "bare") { sendCommand(name); onClose(); return; }
    if (param.type === "autocomplete") {
      const opts = param.options ?? (param.fetch ? await fetchAutocompleteOptions(param.fetch, param.extractField, param.mapLabel) : []);
      const finalOpts = param.allowEmpty ? ["(no parent — root session)", ...opts] : opts;
      enterParameterStep(name, finalOpts, "", param.allowEmpty);
      return;
    }
    if (param.type === "text") {
      enterParameterStep(name, [], param.placeholder ?? "Enter value");
    }
  };

  const executeSelected = () => {
    if (step === "parameter") {
      if (autoCompleteOptions.length > 0) {
        const opt = (results as string[])[selectedIndex];
        if (opt != null) {
          if (opt.startsWith("(no parent")) { sendCommand(selectedCommand); }
          else { sendCommand(`${selectedCommand} ${opt}`); }
          onClose();
        }
      } else {
        const trimmed = query.trim();
        sendCommand(trimmed ? `${selectedCommand} ${trimmed}` : selectedCommand);
        onClose();
      }
      return;
    }
    const command = (results as MergedCommand[])[selectedIndex];
    if (!command) return;
    if (command.handler) { command.handler(); onClose(); }
    else if (command.isBackend) { executeBackendCommand(command); }
    else { onClose(); }
  };

  const { selectedIndex, setSelectedIndex, handleKeyDown } = useKeyboardNav({
    resultsLength: results.length, onExecute: executeSelected,
    onClose, onBack: handleBack, query, step, listRef,
  });

  if (!visible) return null;

  const isParameterStep = step === "parameter";
  const isAutocompleteStep = isParameterStep && autoCompleteOptions.length > 0;
  const isTextStep = isParameterStep && autoCompleteOptions.length === 0;
  const inputPlaceholder = isAutocompleteStep ? `${selectedCommand} > Select option...`
    : isTextStep ? `${selectedCommand} > ${paramPlaceholder}` : "Type a command...";
  const activeOptionId = !isTextStep && results.length > 0 ? `command-palette-option-${selectedIndex}` : undefined;

  return (
    <div className="command-palette-backdrop" onClick={onClose}>
      <div className="command-palette" onClick={(e) => e.stopPropagation()}>
        {isParameterStep && (
          <div className="command-palette__step-indicator">
            <span className="command-palette__step-command">{selectedCommand}</span>
            <span className="command-palette__step-arrow">›</span>
            <span className="command-palette__step-hint">
              {isAutocompleteStep ? "Select option" : paramPlaceholder || "Enter value"}
            </span>
          </div>
        )}
        <input ref={inputRef} className="command-palette__input" placeholder={inputPlaceholder}
          value={query} aria-activedescendant={activeOptionId}
          onInput={(e) => setQuery((e.target as HTMLInputElement).value)}
          onKeyDown={handleKeyDown}
        />
        {isTextStep ? (
          <div className="command-palette__text-hint">
            Press <kbd>Enter</kbd> to send{query.trim() ? `: ${selectedCommand} ${query.trim()}` : ""}
          </div>
        ) : (
          <CommandList results={results} selectedIndex={selectedIndex}
            isAutocompleteStep={isAutocompleteStep} selectedCommand={selectedCommand}
            listRef={listRef}
            onSelectCommand={(cmd) => {
              if (cmd.handler) { cmd.handler(); onClose(); }
              else if (cmd.isBackend) { executeBackendCommand(cmd); }
              else { onClose(); }
            }}
            onSelectOption={(opt) => { sendCommand(`${selectedCommand} ${opt}`); onClose(); }}
          />
        )}
      </div>
    </div>
  );
}
