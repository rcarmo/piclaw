import { registerToolStatusHintProvider } from "../tool-status-hints.js";

const GENERIC_TOOL_STATUS_ICON_SVG = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"></path></svg>`;

const MESSAGES_STATUS_ICON_SVG = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path></svg>`;

const SCHEDULE_STATUS_ICON_SVG = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><circle cx="12" cy="12" r="10"></circle><path d="M12 6v6l4 2"></path></svg>`;

const SEARCH_STATUS_ICON_SVG = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><circle cx="11" cy="11" r="8"></circle><path d="M21 21l-4.35-4.35"></path></svg>`;

const ATTACH_FILE_STATUS_ICON_SVG = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"></path></svg>`;

const SPECIFIC_ICONS: Record<string, string> = {
  messages: MESSAGES_STATUS_ICON_SVG,
  schedule_task: SCHEDULE_STATUS_ICON_SVG,
  search_workspace: SEARCH_STATUS_ICON_SVG,
  attach_file: ATTACH_FILE_STATUS_ICON_SVG,
};

const TOOLS_WITH_SPECIFIC_PROVIDERS = new Set([
  "read", "write", "edit", "bash", "powershell",
  "bun_run",
  "keychain",
  "ssh",
  "cdp_browser",
  "office_read", "office_write",
  "open_office_viewer",
]);

function isWinTool(name: string): boolean {
  return name.startsWith("win_");
}

function isM365Tool(name: string): boolean {
  return name.startsWith("m365_");
}

registerToolStatusHintProvider({
  id: "generic_tool_fallback",
  buildHints: ({ toolName }) => {
    if (!toolName) return null;
    if (TOOLS_WITH_SPECIFIC_PROVIDERS.has(toolName)) return null;
    if (isWinTool(toolName)) return null;
    if (isM365Tool(toolName)) return null;
    const iconSvg = SPECIFIC_ICONS[toolName] || GENERIC_TOOL_STATUS_ICON_SVG;
    return {
      key: "tool",
      icon_svg: iconSvg,
      label: toolName.replace(/_/g, " "),
      title: toolName,
      kind: "tool",
    };
  },
});
