export interface ActivityBarPanelDefinition {
  id: string;
  label: string;
  icon: string;
  order?: number;
  alignBottom?: boolean;
  badge?: number;
}

const panels: ActivityBarPanelDefinition[] = [];
const listeners: Set<() => void> = new Set();

function notify() { listeners.forEach(cb => cb()); }

export function registerActivityBarPanel(def: ActivityBarPanelDefinition): () => void {
  const existing = panels.findIndex(p => p.id === def.id);
  if (existing >= 0) panels[existing] = def;
  else panels.push(def);
  notify();
  return () => unregisterActivityBarPanel(def.id);
}

export function unregisterActivityBarPanel(id: string): void {
  const idx = panels.findIndex(p => p.id === id);
  if (idx >= 0) { panels.splice(idx, 1); notify(); }
}

export function getRegisteredPanels(): ActivityBarPanelDefinition[] {
  return [...panels].sort((a, b) => (a.order ?? 50) - (b.order ?? 50));
}

export function onPanelsChanged(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

// Register built-in panels
registerActivityBarPanel({ id: "explorer", icon: "files", label: "Workspace", order: 10 });
registerActivityBarPanel({ id: "search", icon: "search", label: "Search", order: 20 });
registerActivityBarPanel({ id: "extensions", icon: "extensions", label: "Addons", order: 30 });
registerActivityBarPanel({ id: "tasks", icon: "tasklist", label: "Tasks", order: 40 });
registerActivityBarPanel({ id: "scratchpad", icon: "notebook", label: "Scratchpad", order: 50 });
registerActivityBarPanel({ id: "agent", icon: "dashboard", label: "Dashboard", order: 60 });
registerActivityBarPanel({ id: "settings", icon: "gear", label: "Settings", order: 100, alignBottom: true });
