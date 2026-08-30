import { useCallback, useEffect, useId, useMemo, useRef, useState } from "preact/hooks";
import {
  buildModelPickerProjection,
  calculateModelContextFit,
  describeModelContextFit,
  formatModelCatalogueContextWindow,
  formatModelCataloguePricing,
  moveModelPickerActiveKey,
} from "../../../../../../src/ui/model-catalogue";
import type { ModelCatalogueEntry } from "../../../../../../src/ui/model-catalogue";
import type { VisualModelEntry } from "./types";

interface ModelPickerProps {
  models: VisualModelEntry[];
  activeModel: string;
  contextTokens: number | null;
  onSelectModel: (id: string) => void;
  onTogglePin: (id: string) => void;
  onClose: () => void;
  onCompact: () => void;
  onOpenSettings: () => void;
}

const optionId = (instanceId: string, key: string) => `visual-model-option-${encodeURIComponent(instanceId)}-${encodeURIComponent(key)}`;

export function ModelPicker({
  models,
  activeModel,
  contextTokens,
  onSelectModel,
  onTogglePin,
  onClose,
  onCompact,
  onOpenSettings,
}: ModelPickerProps) {
  const [query, setQuery] = useState("");
  const [showBlocked, setShowBlocked] = useState(false);
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const optionRefs = useRef(new Map<string, HTMLButtonElement>());
  const instanceId = useId();
  const searchId = `visual-model-search-${encodeURIComponent(instanceId)}`;
  const resultsId = `visual-model-results-${encodeURIComponent(instanceId)}`;
  const fittedModels = useMemo(() => {
    const hasExactActiveModel = models.some((entry) => entry.key === activeModel);
    return models.map((entry) => ({
      ...entry,
      current: hasExactActiveModel ? entry.key === activeModel : entry.current,
      contextFit: calculateModelContextFit(entry, { tokens: contextTokens }),
    }));
  }, [activeModel, contextTokens, models]);
  const projection = useMemo(
    () => buildModelPickerProjection(fittedModels, { query, showBlocked }),
    [fittedModels, query, showBlocked],
  );
  const selectableEntries = useMemo(
    () => projection.renderedEntries.filter((entry) => entry.contextFit.state !== "blocked"),
    [projection],
  );

  useEffect(() => searchRef.current?.focus(), []);

  useEffect(() => {
    if (selectableEntries.some((entry) => entry.key === activeKey)) return;
    const current = selectableEntries.find((entry) => entry.current);
    setActiveKey(current?.key ?? selectableEntries[0]?.key ?? null);
  }, [activeKey, selectableEntries]);

  useEffect(() => {
    optionRefs.current.get(activeKey ?? "")?.scrollIntoView({ block: "nearest" });
  }, [activeKey]);

  const choose = useCallback((entry: ModelCatalogueEntry | undefined) => {
    if (!entry || entry.contextFit.state === "blocked") return;
    onSelectModel(entry.key);
  }, [onSelectModel]);

  const handleKeyDown = useCallback((event: KeyboardEvent) => {
    if (event.isComposing) return;
    const actions = {
      ArrowDown: "next",
      ArrowUp: "previous",
      Home: "first",
      End: "last",
      PageDown: "page-next",
      PageUp: "page-previous",
    } as const;
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      onClose();
      return;
    }
    if (event.target !== searchRef.current) return;
    if (event.key === "Enter") {
      const entry = projection.renderedEntries.find((candidate) => candidate.key === activeKey);
      if (entry) {
        event.preventDefault();
        if (event.altKey) onTogglePin(entry.key);
        else choose(entry);
      }
      return;
    }
    const action = actions[event.key as keyof typeof actions];
    if (!action || ((event.key === "Home" || event.key === "End") && !event.ctrlKey && !event.metaKey)) return;
    event.preventDefault();
    setActiveKey(moveModelPickerActiveKey(projection.renderedEntries, activeKey, action));
  }, [activeKey, choose, onClose, onTogglePin, projection.renderedEntries]);

  const renderEntry = (entry: ModelCatalogueEntry) => {
    const visualEntry = entry as VisualModelEntry;
    const blocked = entry.contextFit.state === "blocked";
    const selected = entry.current;
    const focused = entry.key === activeKey;
    const badges = [
      formatModelCatalogueContextWindow(entry.contextWindow),
      visualEntry.reasoningKnown && entry.reasoning ? "reasoning" : "",
      ...entry.variants.slice(0, 2),
    ].filter(Boolean);
    return (
      <button
        id={optionId(instanceId, entry.key)}
        key={entry.key}
        type="button"
        role="option"
        aria-label={`${entry.displayName}, ${entry.pinned ? "pinned" : "not pinned"}. Alt+Enter to ${entry.pinned ? "unpin" : "pin"}.`}
        aria-keyshortcuts="Alt+Enter"
        aria-selected={selected}
        aria-disabled={blocked}
        tabIndex={-1}
        class={`model-picker__item${selected ? " model-picker__item--active" : ""}${focused ? " model-picker__item--focused" : ""}${blocked ? " model-picker__item--blocked" : ""}`}
        ref={(node) => {
          if (node) optionRefs.current.set(entry.key, node);
          else optionRefs.current.delete(entry.key);
        }}
        onMouseDown={(event) => event.preventDefault()}
        onMouseEnter={() => !blocked && setActiveKey(entry.key)}
        onClick={() => choose(entry)}
      >
        <span
          class={`model-picker__pin${entry.pinned ? " model-picker__pin--active" : ""}`}
          aria-hidden="true"
          title={entry.pinned ? "Unpin model" : "Pin model"}
          onClick={(event) => { event.preventDefault(); event.stopPropagation(); setActiveKey(entry.key); onTogglePin(entry.key); }}
        >{entry.pinned ? "★" : "☆"}</span>
        <span class="model-picker__item__content">
          <span class="model-picker__item__primary">
            <span class="model-picker__item__name">{entry.displayName}</span>
            {formatModelCataloguePricing(entry.pricing) && <span class="model-picker__item__price">{formatModelCataloguePricing(entry.pricing)}</span>}
          </span>
          {entry.displayName !== entry.key && <span class="model-picker__item__key">{entry.key}</span>}
          {badges.length > 0 && (
            <span class="model-picker__item__badges">
              {badges.map((badge) => <span key={badge} class="model-picker__badge">{badge}</span>)}
            </span>
          )}
          {blocked && <span class="model-picker__item__meta model-picker__item__meta--blocked">{describeModelContextFit(entry)}</span>}
        </span>
      </button>
    );
  };

  return (
    <div class="model-picker model-picker--catalogue" onKeyDown={handleKeyDown}>
      <div class="model-picker__header">
        <label class="model-picker__search-label" for={searchId}>Search models</label>
        <div class="model-picker__search-row">
          <input
            id={searchId}
            ref={searchRef}
            class="model-picker__search"
            type="search"
            role="combobox"
            aria-autocomplete="list"
            aria-expanded="true"
            aria-controls={resultsId}
            aria-activedescendant={activeKey ? optionId(instanceId, activeKey) : undefined}
            placeholder="Search models…"
            value={query}
            onInput={(event) => setQuery(event.currentTarget.value)}
          />
          {query && <button type="button" class="model-picker__clear" aria-label="Clear model search" onClick={() => setQuery("")}>×</button>}
        </div>
        <div class="model-picker__summary" aria-live="polite">
          {projection.totalMatches} {projection.totalMatches === 1 ? "model" : "models"}
        </div>
      </div>
      <div id={resultsId} class="model-picker__results" role="listbox" aria-label="Models">
        {projection.sections.map((section) => !section.collapsed && (
          <section key={section.key} class={`model-picker__section model-picker__section--${section.key}`} role="presentation">
            <div class="model-picker__section-heading" role="presentation">
              <span>{section.label}</span><span>{section.totalCount}</span>
            </div>
            {section.entries.map(renderEntry)}
            {section.groups.map((group) => (
              <div key={group.key} class="model-picker__group" role="group" aria-label={group.label}>
                <div class="model-picker__group-heading" role="presentation">
                  <span>{group.label}</span><span>{group.totalCount}</span>
                </div>
                {group.entries.map(renderEntry)}
              </div>
            ))}
          </section>
        ))}
        {projection.totalMatches === 0 && <div class="model-picker__empty">No models match “{query}”.</div>}
        {projection.hiddenCount > 0 && (
          <div class="model-picker__limit-note">Showing {projection.renderedEntries.length} of {projection.totalMatches}; refine your search to see more.</div>
        )}
      </div>
      <div class="model-picker__footer">
        <div class="model-picker__footer-start">
          {projection.blockedCount > 0 && (
            <button type="button" class="model-picker__action" onClick={() => setShowBlocked((value) => !value)}>
              {showBlocked ? "Hide" : "Show"} incompatible ({projection.blockedCount})
            </button>
          )}
          {projection.blockedCount > 0 && <button type="button" class="model-picker__action" onClick={onCompact}>Compact context</button>}
        </div>
        <button type="button" class="model-picker__action model-picker__action--primary" onClick={onOpenSettings}>Open Models settings</button>
      </div>
    </div>
  );
}
