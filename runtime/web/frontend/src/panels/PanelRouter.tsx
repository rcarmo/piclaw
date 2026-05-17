import { WorkspacePanel } from "./WorkspacePanel";
import { SearchPanel } from "./SearchPanel";
import { AddonsPanel } from "./AddonsPanel";
import { AgentPanel } from "./AgentPanel";
import { TasksPanel } from "./TasksPanel";
import { SettingsPanel } from "./SettingsPanel";
import { ScratchpadPanel } from "./ScratchpadPanel";

interface PanelRouterProps {
  activePanel: string;
  onPageSelect?: (url: string, name: string) => void;
}

export function PanelRouter({ activePanel, onPageSelect }: PanelRouterProps) {
  switch (activePanel) {
    case "explorer":
    case "files":
      return <WorkspacePanel />;
    case "search":
      return <SearchPanel />;
    case "extensions":
      return <AddonsPanel />;
    case "agent":
      return <AgentPanel />;
    case "tasks":
      return <TasksPanel />;
    case "scratchpad":
      return <ScratchpadPanel />;
    case "settings":
      return <SettingsPanel />;
    default:
      return <Placeholder text="Select a panel" />;
  }
}

function Placeholder({ text }: { text: string }) {
  return (
    <div className="panel-placeholder">
      {text}
    </div>
  );
}
