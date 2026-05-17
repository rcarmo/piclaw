import type { Tab } from "../app/tabTypes";

interface TabBarProps {
  tabs: Tab[];
  activeTabId: string;
  onSelectTab: (id: string) => void;
  onCloseTab: (id: string) => void;
  clockText?: string;
}

/** Horizontal tab strip rendered above the central pane content area. */
export function TabBar({ tabs, activeTabId, onSelectTab, onCloseTab, clockText }: TabBarProps) {
  return (
    <div className="tab-bar" role="tablist" aria-label="Central pane tabs">
      {tabs.map((tab) => (
        <button
          key={tab.id}
          role="tab"
          type="button"
          aria-selected={tab.id === activeTabId}
          className={`tab-bar__tab${tab.id === activeTabId ? " tab-bar__tab--active" : ""}`}
          onClick={() => onSelectTab(tab.id)}
        >
          {tab.icon && <span className="tab-bar__tab__icon" aria-hidden="true">{tab.icon}</span>}
          <span className="tab-bar__tab__label">{tab.label}</span>
          {tab.closable && (
            <span
              className="tab-bar__tab__close"
              role="button"
              tabIndex={0}
              aria-label={`Close ${tab.label}`}
              onClick={(e) => {
                e.stopPropagation();
                onCloseTab(tab.id);
              }}
            >
              ×
            </span>
          )}
        </button>
      ))}
      {clockText && <span className="tab-bar__clock">{clockText}</span>}
    </div>
  );
}
