import { Icon } from "./Icon";

const PANELS = [
  { id: "explorer", icon: "files", label: "Workspace" },
  { id: "search", icon: "search", label: "Search" },
  { id: "extensions", icon: "extensions", label: "Addons" },
  { id: "tasks", icon: "tasklist", label: "Tasks" },
  { id: "scratchpad", icon: "notebook", label: "Scratchpad" },
  { id: "agent", icon: "dashboard", label: "Dashboard" },
  { id: "settings", icon: "gear", label: "Settings", alignBottom: true },
] as const;

interface ActivityBarProps {
  activePanel: string;
  onPanelChange: (id: string) => void;
}

export function ActivityBar({ activePanel, onPanelChange }: ActivityBarProps) {
  return (
    <nav
      className="activity-bar"
      aria-label="Activity bar"
    >
      {PANELS.map((panel) => {
        const active = panel.id === activePanel;

        return (
          <button
            key={panel.id}
            type="button"
            className={`activity-bar__button ${active ? "is-active" : ""} ${"alignBottom" in panel && panel.alignBottom ? "is-bottom" : ""}`}
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
