/** Test-only projection of palette CSS roles; the Classic terminal uses buildTerminalTheme and its contrast safeguards. */
export function terminalThemeFromCss(
  doc: Document = document,
): Record<string, string> {
  const style = getComputedStyle(doc.documentElement);
  const read = (key: string, fallback: string) =>
    style.getPropertyValue(key).trim() || fallback;
  const foreground = read("--term-fg", read("--text-primary", "#e7e9ea"));
  const background = read("--bg-terminal", read("--bg-secondary", "#16181c"));
  const result: Record<string, string> = {
    foreground,
    background,
    cursor: read("--accent-color", "#1d9bf0"),
    cursorAccent: background,
    selectionBackground: read(
      "--selection-background",
      "rgba(29, 155, 240, 0.28)",
    ),
  };
  for (const name of [
    "black",
    "red",
    "green",
    "yellow",
    "blue",
    "magenta",
    "cyan",
    "white",
  ]) {
    result[name] = read(`--term-${name}`, foreground);
    result[`bright${name[0].toUpperCase()}${name.slice(1)}`] = read(
      `--term-bright-${name}`,
      result[name],
    );
  }
  return result;
}
