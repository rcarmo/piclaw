import { createContext } from "preact";
import type { ComponentChildren } from "preact";
import { useCallback, useContext, useEffect, useMemo, useState } from "preact/hooks";
import { DARK_THEME, LIGHT_THEME, getSystemTheme, type Theme } from "./theme";

export const ThemeContext = createContext<Theme>(DARK_THEME);

export interface ThemeControl {
  mode: "dark" | "light";
  setMode: (mode: "dark" | "light") => void;
  toggleMode: () => void;
}

export const ThemeControlContext = createContext<ThemeControl>({
  mode: "dark",
  setMode: () => {},
  toggleMode: () => {},
});

interface ThemeProviderProps {
  children: ComponentChildren;
}

export function ThemeProvider({ children }: ThemeProviderProps) {
  const [mode, setModeState] = useState<"dark" | "light">(getSystemTheme());
  const [manualOverride, setManualOverride] = useState(false);

  useEffect(() => {
    const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = (event: MediaQueryListEvent) => {
      if (!manualOverride) {
        setModeState(event.matches ? "dark" : "light");
      }
    };

    setModeState(mediaQuery.matches ? "dark" : "light");
    mediaQuery.addEventListener("change", onChange);
    return () => mediaQuery.removeEventListener("change", onChange);
  }, [manualOverride]);

  const setMode = useCallback((newMode: "dark" | "light") => {
    setManualOverride(true);
    setModeState(newMode);
  }, []);

  const toggleMode = useCallback(() => {
    setManualOverride(true);
    setModeState((prev) => (prev === "dark" ? "light" : "dark"));
  }, []);

  const theme = useMemo(() => (mode === "dark" ? DARK_THEME : LIGHT_THEME), [mode]);

  // Sync CSS custom properties so CSS-var-based rules track JS theme changes
  useEffect(() => {
    const root = document.documentElement;
    root.style.setProperty("--bg", theme.bg);
    root.style.setProperty("--bg-sidebar", theme.bgSidebar);
    root.style.setProperty("--bg-terminal", theme.bgTerminal);
    root.style.setProperty("--bg-status", theme.bgStatus);
    root.style.setProperty("--border", theme.border);
    root.style.setProperty("--text", theme.text);
    root.style.setProperty("--text-muted", theme.textMuted);
    root.style.setProperty("--accent", theme.accent);
    root.style.setProperty("--success", theme.success);
    root.style.setProperty("--error", theme.error);
    root.style.setProperty("--handle", theme.handle);
    root.style.setProperty("--handle-hover", theme.handleHover);
    root.style.setProperty("--input-bg", theme.inputBg);
    root.style.setProperty("--input-border", theme.inputBorder);
  }, [theme]);

  const control: ThemeControl = useMemo(() => ({ mode, setMode, toggleMode }), [mode, setMode, toggleMode]);

  return (
    <ThemeControlContext.Provider value={control}>
      <ThemeContext.Provider value={theme}>{children}</ThemeContext.Provider>
    </ThemeControlContext.Provider>
  );
}

export function useThemeControl() {
  return useContext(ThemeControlContext);
}
