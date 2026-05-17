import { useState, useEffect } from "preact/hooks";
import { Icon } from "./Icon";
import { getRegisteredPanels, onPanelsChanged } from "./activity-bar-registry";

interface ActivityBarProps {
  activePanel: string;
  onPanelChange: (id: string) => void;
}

export function ActivityBar({ activePanel, onPanelChange }: ActivityBarProps) {
  const [panels, setPanels] = useState(getRegisteredPanels);

  useEffect(() => onPanelsChanged(() => setPanels(getRegisteredPanels())), []);

  return (
    <nav
      className="activity-bar"
      aria-label="Activity bar"
    >
      {panels.map((panel) => {
        const active = panel.id === activePanel;

        return (
          <button
            key={panel.id}
            type="button"
            className={`activity-bar__button ${active ? "is-active" : ""} ${panel.alignBottom ? "is-bottom" : ""}`}
            title={panel.label}
            aria-label={panel.label}
            aria-pressed={active}
            onClick={() => onPanelChange(panel.id)}
          >
            <Icon name={panel.icon} size={24} className="activity-bar__icon" />
          </button>
        );
      })}
    </nav>
  );
}
