/** Stable palette slots: CSS variables repaint existing charts on theme changes,
 * including monochrome AS/400, without rebuilding geometry. */
export function workspaceChartColor(path: string, depth = 0): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < path.length; i++)
    hash = Math.imul(hash ^ path.charCodeAt(i), 0x01000193) >>> 0;
  const base = `var(--chart-${(hash % 6) + 1})`;
  const shade = Math.min(30, Math.max(0, depth) * 10);
  return shade
    ? `color-mix(in srgb, ${base} ${100 - shade}%, var(--bg-secondary))`
    : base;
}
