export interface CommandPaletteProps {
  visible: boolean;
  onClose: () => void;
}

export interface BackendCommand {
  name: string;
  description: string;
  source: string;
}

export interface MergedCommand {
  id: string;
  label: string;
  description?: string;
  category: string;
  keybinding?: string;
  handler?: () => void;
  isBackend: boolean;
}

export const CATEGORY_BADGE_CLASS: Record<string, string> = {
  navigation: "command-palette__badge--navigation",
  terminal: "command-palette__badge--terminal",
  session: "command-palette__badge--session",
  theme: "command-palette__badge--theme",
  general: "command-palette__badge--general",
  core: "command-palette__badge--core",
  extension: "command-palette__badge--extension",
  skill: "command-palette__badge--skill",
  template: "command-palette__badge--template",
};
