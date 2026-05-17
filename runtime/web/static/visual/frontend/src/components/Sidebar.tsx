import type { ComponentChildren } from "preact";

interface SidebarProps {
  title: string;
  children: ComponentChildren;
}

export function Sidebar({ title, children }: SidebarProps) {
  return (
    <aside className="sidebar">
      <header className="sidebar__header">
        <span className="sidebar__title">
          {title.toUpperCase()}
        </span>
      </header>
      <div className="sidebar__content">
        {children}
      </div>
    </aside>
  );
}
