import { initTheme, selectLocalTheme } from "../../../web/src/ui/theme";
import { WEB_THEME_PRESETS } from "../../../src/core/ui-theme-catalogue";
import { workspaceChartColor } from "../../../web/src/ui/workspace-chart-colors";
const skin =
  new URLSearchParams(location.search).get("skin") === "visual"
    ? "visual"
    : "classic";
const file = (name: string, path: string, size: number) => ({
  name,
  path,
  size,
  type: "file",
  mtime: null,
});
const src = {
  name: "src",
  path: "src",
  type: "dir",
  size: 7000,
  mtime: null,
  children: [
    {
      name: "lib",
      path: "src/lib",
      type: "dir",
      size: 4000,
      mtime: null,
      children: [file("main.ts", "src/lib/main.ts", 4000)],
    },
    file("notes.md", "src/notes.md", 2000),
    file("app.css", "src/app.css", 1000),
  ],
};
const root = {
  name: "workspace",
  path: ".",
  type: "dir",
  size: 12000,
  mtime: null,
  children: [
    src,
    file("image.png", "image.png", 3000),
    file("README.md", "README.md", 2000),
  ],
};
const series = [
  5, 12, 8, 20, 34, 22, 46, 30, 57, 61, 43, 70, 58, 80, 63, 72, 52, 59, 74, 65,
  50, 66, 58, 77, 62, 70, 48, 57, 69, 64,
];
const metrics = {
  cpu_percent: 64,
  ram_percent: 45,
  swap_percent: 8,
  cpu_series: series,
  ram_series: series.map((n) => n * 0.6),
  swap_series: series.map((n) => n * 0.12),
  vram_percent: 30,
  vram_series: series.map((n) => n * 0.4),
  vram_total_bytes: 8000000000,
  vram_used_bytes: 3000000000,
  gpu_provider: "fixture",
  buffer_cache_bytes: 2000000000,
  buffer_cache_series_bytes: series.map((n) => n * 10000000),
  process_rss_series_bytes: series.map((n) => n * 3000000),
  process_memory: { rss_bytes: 320000000 },
  swap_total_bytes: 1000000000,
  swap_used_bytes: 100000000,
  sample_interval_ms: 60000,
};
const calls: string[] = [];
window.fetch = (async (input) => {
  const u = new URL(String(input), location.href);
  calls.push(u.pathname);
  if (u.pathname === "/workspace/tree")
    return Response.json({
      root: u.searchParams.get("path") === "src" ? src : root,
      truncated: false,
    });
  if (u.pathname === "/workspace/stat")
    return Response.json({
      path: u.searchParams.get("path"),
      size: u.searchParams.get("path") === "src" ? 7000 : 12000,
    });
  if (u.pathname === "/agent/status") return Response.json({
    status: { status: "idle", data: null }, model: null, context: null,
    metrics, agent_name: "Fixture", errors: [],
  });
  if (u.pathname === "/workspace/index-status")
    return Response.json({ status: "ready" });
  return Response.json({});
}) as typeof fetch;
localStorage.setItem("piclaw_system_meters_collapsed", "false");
localStorage.setItem("workspaceFolderPreviewDepth", "3");
initTheme({ skin });
selectLocalTheme("synthwave-84-full");
const host = document.getElementById("explorer-host")!;
if (skin === "classic") {
  const { html, render } = await import("../../../web/src/vendor/preact-htm");
  const { WorkspaceExplorer } =
    await import("../../../web/src/components/workspace-explorer");
  render(
    html`<${WorkspaceExplorer}
      enabled=${true}
      showHidden=${true}
      currentChatJid="web:fixture"
      onOpenEditor=${() => {}}
    />`,
    host,
  );
} else {
  const { h, render } = await import("preact");
  const { useState } = await import("preact/hooks");
  const { FileTree } =
    await import("../../../web/static/visual/frontend/src/components/FileTree");
  const { FolderPreview } =
    await import("../../../web/static/visual/frontend/src/panels/workspace/FolderPreview");
  function Explorer() {
    const [node, setNode] = useState(src);
    return h(
      "div",
      {},
      h(FileTree, { onFileSelect: setNode }),
      h(FolderPreview, { node, onMutate: () => {} }),
    );
  }
  render(h(Explorer, {}), host);
  const { SystemStats } =
    await import("../../../web/static/visual/frontend/src/components/SystemStats");
  render(h(SystemStats, { stats: metrics, isStale: false }), document.getElementById("visual-stats")!);
}
const { html, render } = await import("../../../web/src/vendor/preact-htm");
const { SystemMetersHud } =
  await import("../../../web/src/components/system-meters-hud");
render(
  html`<${SystemMetersHud} mode="overlay" />`,
  document.getElementById("meter-host")!,
);
const { importVSCodeTheme, applyTheme, resetTheme } =
  await import("../../../web/static/visual/frontend/src/utils/theme-importer");
Object.assign(window, {
  workspaceTheme: {
    selectLocalTheme,
    presets: WEB_THEME_PRESETS,
    calls,
    workspaceChartColor,
    importVSCodeTheme,
    applyTheme,
    resetTheme,
  },
});
