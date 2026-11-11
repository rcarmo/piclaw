import { useEffect, useMemo } from "preact/hooks";
import { useSignal } from "@preact/signals";

import {
  filterKeyboardShortcutActions,
  readKeyboardShortcutDrafts,
  resetKeyboardShortcutDraft,
  saveKeyboardShortcutDraft,
  type KeyboardShortcutDrafts,
} from "../../../../../../src/ui/keyboard-shortcut-settings";
import { formatShortcutBindingList, type KeyboardShortcutActionId } from "../../../../../../src/ui/keyboard-shortcuts";
import { registerSettingsPane } from "./pane-registry";
import type { SettingsSectionProps } from "./types";

export function KeyboardSection() {
  const drafts = useSignal<KeyboardShortcutDrafts>(readKeyboardShortcutDrafts());
  const filter = useSignal("");
  const status = useSignal<{ type: "success" | "error"; text: string } | null>(null);

  useEffect(() => {
    const sync = () => { drafts.value = readKeyboardShortcutDrafts(); };
    window.addEventListener("piclaw:keyboard-shortcuts-changed", sync);
    return () => window.removeEventListener("piclaw:keyboard-shortcuts-changed", sync);
  }, [drafts]);

  const visibleActions = useMemo(
    () => filterKeyboardShortcutActions(filter.value, drafts.value)
      .filter((action) => action.id !== "toggleWorkspace" && action.id !== "toggleSessions"),
    [filter.value, drafts.value],
  );

  const updateDraft = (actionId: KeyboardShortcutActionId, value: string) => {
    drafts.value = { ...drafts.value, [actionId]: value };
    status.value = null;
  };

  const saveAction = (actionId: KeyboardShortcutActionId) => {
    const result = saveKeyboardShortcutDraft(actionId, drafts.value[actionId] || "");
    if (!result.ok) {
      status.value = { type: "error", text: `Invalid shortcut: ${result.invalidToken || "unknown"}` };
      return;
    }
    drafts.value = result.drafts;
    status.value = { type: "success", text: "Keyboard shortcut saved." };
  };

  const resetAction = (actionId: KeyboardShortcutActionId) => {
    drafts.value = resetKeyboardShortcutDraft(actionId);
    status.value = { type: "success", text: "Shortcut restored to default." };
  };

  const resetAll = () => {
    drafts.value = resetKeyboardShortcutDraft();
    status.value = { type: "success", text: "All shortcuts restored to defaults." };
  };

  return (
    <section className="settings-panel__section settings-panel__section--narrow settings-panel__section--keyboard">
      <header className="settings-panel__keyboard-header">
        <div>
          <h2 className="settings-panel__section-title">Keyboard</h2>
          <p className="settings-panel__description">Bindings are comma-separated and apply immediately. Escape remains reserved for dismiss and abort.</p>
          <p className="settings-panel__description">Use <code>/help</code> or press <code>?</code> outside an editable field to open this pane.</p>
        </div>
        <button type="button" className="settings-panel__provider-btn" onClick={resetAll}>Reset all shortcuts</button>
      </header>

      <input
        className="settings-panel__input settings-panel__keyboard-filter"
        type="search"
        aria-label="Filter shortcuts"
        placeholder="Filter shortcuts…"
        value={filter.value}
        onInput={(event) => { filter.value = (event.target as HTMLInputElement).value; }}
      />

      {status.value && (
        <div className={`settings-panel__keyboard-status settings-panel__keyboard-status--${status.value.type}`} role="status" aria-live="polite">
          {status.value.text}
        </div>
      )}

      <div className="settings-panel__shortcut-list">
        {visibleActions.map((action) => {
          const inputId = `visual-settings-shortcut-${action.id}`;
          return (
            <article className="settings-panel__shortcut-card" key={action.id}>
              <div className="settings-panel__shortcut-copy">
                <label className="settings-panel__shortcut-title" htmlFor={inputId}>{action.label}</label>
                <p className="settings-panel__description settings-panel__shortcut-description">{action.description}</p>
                <p className="settings-panel__shortcut-default">Default: <code>{formatShortcutBindingList(action.defaultBindings)}</code></p>
              </div>
              <div className="settings-panel__shortcut-controls">
                <input
                  id={inputId}
                  className="settings-panel__input settings-panel__shortcut-input"
                  type="text"
                  value={drafts.value[action.id] || ""}
                  placeholder={formatShortcutBindingList(action.defaultBindings)}
                  onInput={(event) => updateDraft(action.id, (event.target as HTMLInputElement).value)}
                />
                <div className="settings-panel__shortcut-actions">
                  <button type="button" className="settings-panel__provider-btn" onClick={() => saveAction(action.id)}>Save</button>
                  <button type="button" className="settings-panel__provider-btn" onClick={() => resetAction(action.id)}>Default</button>
                </div>
              </div>
            </article>
          );
        })}
        {visibleActions.length === 0 && <p className="settings-panel__description">No shortcuts match your filter.</p>}
      </div>
    </section>
  );
}

registerSettingsPane({
  id: "keyboard",
  label: "Keyboard",
  icon: <i className="codicon codicon-keyboard" />,
  order: 23,
  component: (_props: SettingsSectionProps) => <KeyboardSection />,
});
