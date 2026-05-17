/** Represents a single tab in the central pane tab bar. */
export interface Tab {
  id: string;
  label: string;
  icon?: string;
  closable: boolean;
  type: "chat" | "widget" | "terminal";
  /** Widget HTML content (only for widget tabs). */
  widgetHtml?: string;
  /** Widget iframe source URL (for iframe-based widgets). */
  widgetSrc?: string;
  /** Widget kind identifier (for behavior-specific handling). */
  widgetKind?: string;
}
