import type { RefObject } from "preact";
import type { MergedCommand } from "./types";
import { CATEGORY_BADGE_CLASS } from "./types";

interface CommandListProps {
  results: MergedCommand[] | string[];
  selectedIndex: number;
  isAutocompleteStep: boolean;
  selectedCommand: string;
  listRef: RefObject<HTMLUListElement>;
  onSelectCommand: (command: MergedCommand) => void;
  onSelectOption: (option: string) => void;
}

/**
 * Presentational component that renders the filtered command list or the
 * autocomplete option list. Has no state of its own.
 */
export function CommandList({
  results,
  selectedIndex,
  isAutocompleteStep,
  selectedCommand,
  listRef,
  onSelectCommand,
  onSelectOption,
}: CommandListProps) {
  if (isAutocompleteStep) {
    const options = results as string[];
    return (
      <ul ref={listRef} className="command-palette__results" role="listbox" aria-label="Options">
        {options.map((option, index) => (
          <li
            key={option}
            id={`command-palette-option-${index}`}
            role="option"
            aria-selected={index === selectedIndex}
            className={`command-palette__row ${index === selectedIndex ? "is-active" : ""}`}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => onSelectOption(option)}
          >
            <span className="command-palette__row-content">
              <span className="command-palette__label">{option}</span>
            </span>
          </li>
        ))}
        {options.length === 0 && (
          <li className="command-palette__empty">No matching options</li>
        )}
      </ul>
    );
  }

  const commands = results as MergedCommand[];
  return (
    <ul ref={listRef} className="command-palette__results" role="listbox" aria-label="Commands">
      {commands.map((command, index) => {
        const badgeClass = CATEGORY_BADGE_CLASS[command.category] ?? "command-palette__badge--default";
        return (
          <li
            key={command.id}
            id={`command-palette-option-${index}`}
            role="option"
            aria-selected={index === selectedIndex}
            className={`command-palette__row ${index === selectedIndex ? "is-active" : ""}`}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => onSelectCommand(command)}
          >
            <span className="command-palette__row-content">
              <span className="command-palette__label">{command.label}</span>
              {command.description && (
                <span className="command-palette__description">
                  {command.description}
                </span>
              )}
            </span>
            <span className="command-palette__row-meta">
              <span className={`command-palette__badge ${badgeClass}`}>
                {command.category}
              </span>
              {command.keybinding && (
                <span className="command-palette__keybinding command-palette__keybinding--static">
                  {command.keybinding}
                </span>
              )}
            </span>
          </li>
        );
      })}
      {commands.length === 0 && (
        <li className="command-palette__empty">No matching commands</li>
      )}
    </ul>
  );
}
