export interface Theme {
  bg: string;
  bgSidebar: string;
  bgTerminal: string;
  bgStatus: string;
  border: string;
  text: string;
  textMuted: string;
  accent: string;
  success: string;
  error: string;
  handleHover: string;
  handle: string;
  inputBg: string;
  inputBorder: string;
}

export const DARK_THEME: Theme = {
  bg: "#1e1e2e",
  bgSidebar: "#181825",
  bgTerminal: "#11111b",
  bgStatus: "#181825",
  border: "#313244",
  text: "#cdd6f4",
  textMuted: "#9399b2",
  accent: "#89b4fa",
  success: "#a6e3a1",
  error: "#f38ba8",
  handleHover: "#89b4fa",
  handle: "#313244",
  inputBg: "#11111b",
  inputBorder: "#45475a",
};

export const LIGHT_THEME: Theme = {
  bg: "#f3f3f3",
  bgSidebar: "#e8e8e8",
  bgTerminal: "#1e1e2e",
  bgStatus: "#dcdcdc",
  border: "#c8c8c8",
  text: "#1a1a1a",
  textMuted: "#4a4a4a",
  accent: "#0078d4",
  success: "#16a34a",
  error: "#d32f2f",
  handleHover: "#0078d4",
  handle: "#c8c8c8",
  inputBg: "#ffffff",
  inputBorder: "#c8c8c8",
};

export function getSystemTheme(): "dark" | "light" {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return "dark";
  }

  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}
