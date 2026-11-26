#!/usr/bin/env bun
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

type TemplateConfig = {
  width: number;
  height: number;
  title: string;
  subtitle_prefix: string;
  live_summary_title: string;
  cold_rss_title: string;
  cold_elapsed_title: string;
  max_bars: number;
};

type ColdRow = {
  timestamp: string;
  commit: string;
  dirty: string;
  scenario: string;
  elapsedMs: number;
  rssDeltaMb: number;
  toolCount: number | null;
  notes: string;
};

type LiveRow = {
  timestamp: string;
  commit: string;
  dirty: string;
  scenario: string;
  rssMb: number;
  pssMb: number | null;
  cgroupMb: number | null;
  vmhwmMb: number | null;
  heapUsedMb: number | null;
  externalMb: number | null;
  cachedMain: number | null;
  activeChats: number | null;
  prewarmQueue: number | null;
  notes: string;
};

type PostStartSample = {
  rssMb: number;
  heapUsedMb: number;
  externalMb: number;
};

type TableRow = Record<string, string>;

type ChartArea = {
  x: number;
  y: number;
  width: number;
  height: number;
};

const DEFAULT_TEMPLATE: TemplateConfig = {
  width: 1200,
  height: 960,
  title: "Piclaw RAM reduction progress",
  subtitle_prefix: "Generated from docs/performance/memory-footprint-history.md",
  live_summary_title: "Latest live service snapshot",
  cold_rss_title: "Cold-session RSS delta (MB)",
  cold_elapsed_title: "Cold-session elapsed time (ms)",
  max_bars: 10,
};

function parseArgs(argv: string[]) {
  const options = {
    input: "docs/performance/memory-footprint-history.md",
    output: "docs/performance/memory-progress-2026-04-17.svg",
    template: "docs/performance/memory-progress.template.json",
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = argv[i + 1];
    if (arg === "--input" && next) {
      options.input = next;
      i += 1;
      continue;
    }
    if (arg === "--output" && next) {
      options.output = next;
      i += 1;
      continue;
    }
    if (arg === "--template" && next) {
      options.template = next;
      i += 1;
      continue;
    }
  }

  return options;
}

function parseMarkdownTableSection(markdown: string, heading: string): TableRow[] {
  const lines = markdown.split(/\r?\n/);
  const headingIndex = lines.findIndex((line) => line.trim() === heading.trim());
  if (headingIndex < 0) return [];

  let start = headingIndex + 1;
  while (start < lines.length && !lines[start].trim().startsWith("|")) start += 1;
  if (start + 1 >= lines.length) return [];

  const header = splitTableLine(lines[start]);
  const rows: TableRow[] = [];
  for (let i = start + 2; i < lines.length; i += 1) {
    const line = lines[i];
    if (!line.trim().startsWith("|")) break;
    const cells = splitTableLine(line);
    if (cells.length === 0) continue;
    const row: TableRow = {};
    for (let col = 0; col < header.length; col += 1) {
      row[header[col]] = cells[col] ?? "";
    }
    rows.push(row);
  }
  return rows;
}

function splitTableLine(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((cell) => cell.trim());
}

function stripMarkdown(value: string): string {
  return String(value || "")
    .replace(/`/g, "")
    .replace(/\*$/g, "")
    .trim();
}

function parseNumberCell(value: string): number | null {
  const normalized = stripMarkdown(value).replace(/,/g, "");
  const match = normalized.match(/-?\d+(?:\.\d+)?/);
  if (!match) return null;
  const parsed = Number(match[0]);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseIntCell(value: string): number | null {
  const parsed = parseNumberCell(value);
  return parsed === null ? null : Math.round(parsed);
}

function shortScenarioLabel(scenario: string): [string, string] {
  const value = scenario.toLowerCase();
  if (value.includes("empty-workspace")) return ["Empty", "baseline"];
  if (value.includes("before removing workspace-local extensions")) return ["Before", "ext rm"];
  if (value.includes("after removing workspace-local extensions")) return ["After", "ext rm"];
  if (value.includes("background indexing disabled")) return ["BG", "indexer"];
  if (value.includes("redundant per-session startup hooks")) return ["Hook", "trim"];
  if (value.includes("bundled-extension gating") && value.includes("non-web")) return ["Gate", "non-web"];
  if (value.includes("bundled-extension gating") && value.includes("web")) return ["Gate", "web"];
  if (value.includes("lazy-loading") || value.includes("lazy-loaded") || value.includes("office/cdp")) return ["Lazy", "heavy"];
  if (value.includes("provider-bootstrap") || (value.includes("session-shim") && value.includes("azure"))) return ["Azure", "bootstrap"];
  if (value.includes("azure image") || value.includes("image helpers") || value.includes("provider module")) return ["Azure", "images"];
  if (value.includes("aggressive") && value.includes("index")) return ["Indexer", "trim"];

  const words = stripMarkdown(scenario)
    .replace(/benchmark/gi, "")
    .replace(/real/gi, "")
    .replace(/workspace/gi, "")
    .replace(/cold-session/gi, "")
    .split(/\s+/)
    .filter(Boolean);
  return [words[0] ?? "Step", words[1] ?? "update"];
}

function liveScenarioLabel(scenario: string): string {
  const value = scenario.toLowerCase();
  if (value.includes("autorotation") || value.includes("rotating `web:default`") || value.includes("rotating web:default")) {
    return "post rotate";
  }
  if (value.includes("deterministic audit-group refresh")) return "interactive probe";
  if (value.includes("startup warmup disable")) return "bg index baseline";
  return stripMarkdown(scenario)
    .replace(/^live\s+/i, "")
    .replace(/piclaw\.service/gi, "service")
    .slice(0, 28);
}

function parseColdRows(markdown: string): ColdRow[] {
  return parseMarkdownTableSection(markdown, "## Fresh-process cold-session benchmarks")
    .map((row) => ({
      timestamp: stripMarkdown(row["Timestamp (UTC)"] ?? ""),
      commit: stripMarkdown(row["Commit"] ?? ""),
      dirty: stripMarkdown(row["Dirty"] ?? ""),
      scenario: stripMarkdown(row["Scenario"] ?? ""),
      elapsedMs: parseNumberCell(row["Elapsed"] ?? "") ?? 0,
      rssDeltaMb: parseNumberCell(row["RSS delta"] ?? "") ?? 0,
      toolCount: parseIntCell(row["Tool count"] ?? ""),
      notes: stripMarkdown(row["Notes"] ?? ""),
    }))
    .filter((row) => row.scenario && row.elapsedMs > 0 && row.rssDeltaMb > 0);
}

function parseLiveRows(markdown: string): LiveRow[] {
  return parseMarkdownTableSection(markdown, "## Live service snapshots")
    .map((row) => ({
      timestamp: stripMarkdown(row["Timestamp (UTC)"] ?? ""),
      commit: stripMarkdown(row["Commit"] ?? ""),
      dirty: stripMarkdown(row["Dirty"] ?? ""),
      scenario: stripMarkdown(row["Scenario"] ?? ""),
      rssMb: parseNumberCell(row["RSS"] ?? "") ?? 0,
      pssMb: parseNumberCell(row["PSS"] ?? ""),
      cgroupMb: parseNumberCell(row["cgroup current"] ?? ""),
      vmhwmMb: parseNumberCell(row["VmHWM"] ?? ""),
      heapUsedMb: parseNumberCell(row["Heap used"] ?? ""),
      externalMb: parseNumberCell(row["External"] ?? ""),
      cachedMain: parseIntCell(row["Cached main"] ?? ""),
      activeChats: parseIntCell(row["Active chats"] ?? ""),
      prewarmQueue: parseIntCell(row["Prewarm queue"] ?? ""),
      notes: stripMarkdown(row["Notes"] ?? ""),
    }))
    .filter((row) => row.scenario && row.rssMb > 0)
    .sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp));
}

function niceCeil(maxValue: number, tickCount: number): number {
  if (!(maxValue > 0)) return 1;
  const roughStep = maxValue / Math.max(1, tickCount);
  const power = Math.pow(10, Math.floor(Math.log10(roughStep)));
  const normalized = roughStep / power;
  const stepBase = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10;
  const step = stepBase * power;
  return Math.ceil(maxValue / step) * step;
}

function formatPercentDelta(from: number, to: number): string {
  if (!(from > 0)) return "0.0%";
  const pct = ((to - from) / from) * 100;
  const rounded = Math.round(pct * 10) / 10;
  return `${rounded > 0 ? "+" : ""}${rounded.toFixed(1)}%`;
}

function formatNumber(value: number, digits = 1): string {
  return value.toFixed(digits).replace(/\.0$/, "");
}

function escapeXml(value: string): string {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function formatTimeLabel(timestamp: string): string {
  const parsed = Date.parse(timestamp);
  if (!Number.isFinite(parsed)) return timestamp;
  const date = new Date(parsed);
  return `${String(date.getUTCHours()).padStart(2, "0")}:${String(date.getUTCMinutes()).padStart(2, "0")}Z`;
}

function renderGrid(chart: ChartArea, maxValue: number, tickCount: number, axisX: number): string {
  const lines: string[] = [];
  for (let tick = 0; tick <= tickCount; tick += 1) {
    const ratio = tick / tickCount;
    const y = chart.y + chart.height - ratio * chart.height;
    const value = (maxValue / tickCount) * tick;
    lines.push(`<line x1="${chart.x}" y1="${y.toFixed(1)}" x2="${chart.x + chart.width}" y2="${y.toFixed(1)}" stroke="#233045" stroke-width="1"/>`);
    lines.push(`<text x="${axisX}" y="${(y + 4).toFixed(1)}" class="axis">${escapeXml(formatNumber(value))}</text>`);
  }
  return lines.join("\n");
}

function renderBars(rows: ColdRow[], values: number[], chart: ChartArea & { maxValue: number; fill: string; labelY: number; stepY: number; }) {
  const count = rows.length;
  const gap = 14;
  const barWidth = Math.max(24, (chart.width - gap * (count - 1)) / Math.max(1, count));
  const result: string[] = [];

  for (let index = 0; index < count; index += 1) {
    const value = values[index] ?? 0;
    const barHeight = chart.maxValue > 0 ? (value / chart.maxValue) * chart.height : 0;
    const x = chart.x + index * (barWidth + gap);
    const y = chart.y + chart.height - barHeight;
    result.push(`<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${barWidth.toFixed(1)}" height="${barHeight.toFixed(1)}" rx="9" fill="${chart.fill}"/>`);
    result.push(`<text x="${(x + barWidth / 2).toFixed(1)}" y="${(y - 8).toFixed(1)}" text-anchor="middle" class="value">${escapeXml(formatNumber(value))}</text>`);
    result.push(`<text x="${(x + barWidth / 2).toFixed(1)}" y="${chart.stepY}" text-anchor="middle" class="tiny">${escapeXml(`S${index + 1}`)}</text>`);

    const [line1, line2] = shortScenarioLabel(rows[index].scenario);
    result.push(`<text x="${(x + barWidth / 2).toFixed(1)}" y="${chart.labelY}" text-anchor="middle" class="small">${escapeXml(line1)}</text>`);
    result.push(`<text x="${(x + barWidth / 2).toFixed(1)}" y="${chart.labelY + 15}" text-anchor="middle" class="small">${escapeXml(line2)}</text>`);
  }

  return result.join("\n");
}

function yForValue(value: number, maxValue: number, chart: ChartArea): number {
  return chart.y + chart.height - ((value / maxValue) * chart.height);
}

function buildPath(values: number[], maxValue: number, chart: ChartArea): string {
  if (values.length === 0) return "";
  if (values.length === 1) {
    const x = chart.x + chart.width / 2;
    const y = yForValue(values[0] ?? 0, maxValue, chart);
    return `M ${x.toFixed(1)} ${y.toFixed(1)}`;
  }

  const step = chart.width / Math.max(1, values.length - 1);
  const points = values.map((value, index) => ({
    x: chart.x + step * index,
    y: yForValue(value, maxValue, chart),
  }));

  let pathData = `M ${points[0].x.toFixed(1)} ${points[0].y.toFixed(1)}`;
  for (let index = 1; index < points.length; index += 1) {
    const prev = points[index - 1];
    const point = points[index];
    const cx1 = prev.x + (point.x - prev.x) / 3;
    const cx2 = point.x - (point.x - prev.x) / 3;
    pathData += ` C ${cx1.toFixed(1)} ${prev.y.toFixed(1)}, ${cx2.toFixed(1)} ${point.y.toFixed(1)}, ${point.x.toFixed(1)} ${point.y.toFixed(1)}`;
  }
  return pathData;
}

function renderLiveTimeline(rows: LiveRow[], chart: ChartArea): string {
  if (rows.length === 0) return "";

  const rssValues = rows.map((row) => row.rssMb);
  const pssValues = rows.flatMap(row => row.pssMb === null ? [] : [row.pssMb]);
  const maxValue = niceCeil(Math.max(...rssValues, ...pssValues), 4);
  const axisX = chart.x - 34;
  const grid = renderGrid(chart, maxValue, 4, axisX);
  const step = rows.length > 1 ? chart.width / Math.max(1, rows.length - 1) : 0;
  const rssPath = buildPath(rssValues, maxValue, chart);
  const pssPaths: string[] = [];
  for (let first = 0, end = 0; first < rows.length; first = end + 1) {
    end = first;
    while (end < rows.length && rows[end].pssMb !== null) end += 1;
    if (end - first > 1) {
      pssPaths.push(buildPath(rows.slice(first, end).map(row => row.pssMb!), maxValue, {
        ...chart, x: chart.x + step * first, width: step * (end - first - 1),
      }));
    }
  }

  const parts: string[] = [grid];
  parts.push(`<path d="${rssPath}" fill="none" stroke="#60a5fa" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"/>`);
  if (pssPaths.length) parts.push(`<path d="${pssPaths.join(" ")}" fill="none" stroke="#a78bfa" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" opacity="0.95"/>`);

  rows.forEach((row, index) => {
    const x = rows.length > 1 ? chart.x + step * index : chart.x + chart.width / 2;
    const rssY = yForValue(row.rssMb, maxValue, chart);
    parts.push(`<circle cx="${x.toFixed(1)}" cy="${rssY.toFixed(1)}" r="5.5" fill="#60a5fa"/>`);
    if (row.pssMb !== null) parts.push(`<circle cx="${x.toFixed(1)}" cy="${yForValue(row.pssMb, maxValue, chart).toFixed(1)}" r="4.5" fill="#a78bfa"/>`);
    parts.push(`<text x="${x.toFixed(1)}" y="${(rssY - 10).toFixed(1)}" text-anchor="middle" class="value">${escapeXml(formatNumber(row.rssMb))}</text>`);
    parts.push(`<text x="${x.toFixed(1)}" y="${chart.y + chart.height + 24}" text-anchor="middle" class="small">${escapeXml(formatTimeLabel(row.timestamp))}</text>`);
    parts.push(`<text x="${x.toFixed(1)}" y="${chart.y + chart.height + 40}" text-anchor="middle" class="tiny">${escapeXml(liveScenarioLabel(row.scenario))}</text>`);
  });

  return parts.join("\n");
}

function renderLegendItem(x: number, y: number, color: string, label: string): string {
  return `<rect x="${x}" y="${y - 9}" width="14" height="14" rx="4" fill="${color}"/><text x="${x + 22}" y="${y + 2}" class="small">${escapeXml(label)}</text>`;
}

function extractPostStartSample(notes: string): PostStartSample | null {
  const match = notes.match(/post-start sample at\s+(\d+(?:\.\d+)?)\s+MB\s+RSS\s+\/\s+(\d+(?:\.\d+)?)\s+MB\s+heap\s+\/\s+(\d+(?:\.\d+)?)\s+MB\s+external/i);
  if (!match) return null;
  const rssMb = Number(match[1]);
  const heapUsedMb = Number(match[2]);
  const externalMb = Number(match[3]);
  if (![rssMb, heapUsedMb, externalMb].every((value) => Number.isFinite(value))) return null;
  return { rssMb, heapUsedMb, externalMb };
}

function renderMatchedRss(markdown: string, top: number): { height: number; svg: string } {
  const rows = parseMarkdownTableSection(markdown, "## Matched synthetic RSS comparisons").map(row => ({
    label: row["Workload"], baseline: parseNumberCell(row["Baseline RSS (MiB)"]),
    candidate: parseNumberCell(row["Candidate RSS (MiB)"]),
  })).filter(row => row.label && row.baseline !== null && row.candidate !== null);
  if (!rows.length) return { height: 0, svg: "" };
  const height = 88 + 54 * rows.length;
  const max = niceCeil(Math.max(...rows.flatMap(row => [row.baseline!, row.candidate!])), 4);
  const scale = (value: number) => value / max * 630;
  const ticks = Array.from({ length: 5 }, (_, i) => max * i / 4).map(value => {
    const x = 420 + scale(value);
    return `<line x1="${x}" x2="${x}" y1="68" y2="${height - 15}" stroke="#283547"/><text x="${x}" y="62" text-anchor="middle" class="axis">${formatNumber(value, 0)}</text>`;
  }).join("\n");
  const bars = rows.map((row, i) => {
    const y = 75 + i * 54;
    return `<text x="20" y="${y + 22}" class="body">${escapeXml(stripMarkdown(row.label))}</text>` +
      [row.baseline!, row.candidate!].map((value, j) => `<rect x="420" y="${y + j * 18}" width="${scale(value)}" height="12" rx="3" fill="${j ? "#34d399" : "#60a5fa"}"/><text x="${428 + scale(value)}" y="${y + j * 18 + 11}" class="value">${formatNumber(value)}</text>`).join("");
  }).join("\n");
  return { height: height + 12, svg: `<g transform="translate(40 ${top})"><rect width="1120" height="${height}" rx="18" fill="#111827" stroke="#1f2937"/><text x="20" y="29" class="h2">Matched synthetic RSS comparisons · MiB</text><text x="20" y="51" class="small">Independent fixtures; only compare within a row. Separate from live service history.</text>${renderLegendItem(855, 23, "#60a5fa", "Baseline")}${renderLegendItem(960, 23, "#34d399", "Candidate")}${ticks}${bars}</g>` };
}

function renderReadinessCard(markdown: string): string {
  const latest = parseMarkdownTableSection(markdown, "## Installed-service readiness")
    .sort((a, b) => b["Timestamp (UTC)"].localeCompare(a["Timestamp (UTC)"]))[0];
  if (!latest) return "";
  const rss = parseNumberCell(latest["Process RSS (MiB)"]);
  if (rss === null) throw new Error("Latest installed-service readiness row has no process RSS.");
  const commit = stripMarkdown(latest.Commit).slice(0, 8);
  const day = latest["Timestamp (UTC)"].slice(0, 10);
  return `<text x="832" y="132" class="small">Installed service at readiness</text>
  <text x="832" y="172" class="metric">${formatNumber(rss, 2)} MiB RSS</text>
  <text x="832" y="194" class="body">${escapeXml(day)} · ${escapeXml(commit)}</text>
  <text x="832" y="212" class="small">Post-web-start sample; idle unmeasured</text>`;
}

function renderSvg(config: TemplateConfig, inputPath: string, coldRows: ColdRow[], liveRows: LiveRow[], matched: { height: number; svg: string }, readinessCard: string): string {
  if (coldRows.length === 0) throw new Error("No fresh-process cold-session benchmark rows found in memory history.");
  if (liveRows.length === 0) throw new Error("No live-service snapshot rows found in memory history.");

  const displayedColdRows = coldRows.slice(-config.max_bars);
  const baselineCold = coldRows.find((row) => !/empty-workspace/i.test(row.scenario)) ?? coldRows[0];
  const latestCold = displayedColdRows[displayedColdRows.length - 1];
  const firstLive = liveRows[0];
  const latestLive = liveRows[liveRows.length - 1];
  const peakLive = liveRows.reduce((best, row) => row.rssMb > best.rssMb ? row : best, liveRows[0]);
  const latestPostStart = extractPostStartSample(latestLive.notes);

  const rssValues = displayedColdRows.map((row) => row.rssDeltaMb);
  const elapsedValues = displayedColdRows.map((row) => row.elapsedMs);
  const rssMax = niceCeil(Math.max(...rssValues), 3);
  const elapsedMax = niceCeil(Math.max(...elapsedValues), 4);

  const coldRssChange = formatPercentDelta(baselineCold.rssDeltaMb, latestCold.rssDeltaMb);
  const coldElapsedChange = formatPercentDelta(baselineCold.elapsedMs, latestCold.elapsedMs);
  const liveRssChange = formatPercentDelta(firstLive.rssMb, latestLive.rssMb);
  const livePeakDrop = formatPercentDelta(peakLive.rssMb, latestLive.rssMb);
  const subtitleCommit = latestLive.commit || latestCold.commit || "(unknown commit)";

  const coldRssGrid = renderGrid({ x: 70, y: 308, width: 500, height: 210 }, rssMax, 3, 34);
  const coldElapsedGrid = renderGrid({ x: 630, y: 308, width: 500, height: 210 }, elapsedMax, 4, 594);
  const coldRssBars = renderBars(displayedColdRows, rssValues, { x: 88, y: 308, width: 442, height: 210, maxValue: rssMax, fill: "url(#barBlue)", labelY: 545, stepY: 531 });
  const coldElapsedBars = renderBars(displayedColdRows, elapsedValues, { x: 648, y: 308, width: 442, height: 210, maxValue: elapsedMax, fill: "url(#barGreen)", labelY: 545, stepY: 531 });
  const liveTimeline = renderLiveTimeline(liveRows, { x: 90, y: 645, width: 1020, height: 155 });

  const footerLines = [
    `Cold experiments: real-workspace RSS delta ${formatNumber(baselineCold.rssDeltaMb)} MB → ${formatNumber(latestCold.rssDeltaMb)} MB (${coldRssChange}); elapsed ${formatNumber(baselineCold.elapsedMs, 0)} ms → ${formatNumber(latestCold.elapsedMs, 0)} ms (${coldElapsedChange}).`,
    `Live service: ${formatNumber(firstLive.rssMb)} MB RSS at ${formatTimeLabel(firstLive.timestamp)} → ${formatNumber(latestLive.rssMb)} MB at ${formatTimeLabel(latestLive.timestamp)} (${liveRssChange}); peak was ${formatNumber(peakLive.rssMb)} MB at ${formatTimeLabel(peakLive.timestamp)}.`,
    latestPostStart
      ? `Fresh post-start sample from the latest restart: ${formatNumber(latestPostStart.rssMb)} MB RSS / ${formatNumber(latestPostStart.heapUsedMb)} MB heap / ${formatNumber(latestPostStart.externalMb)} MB external.`
      : `Last historical live snapshot: ${formatNumber(latestLive.rssMb)} MB RSS; PSS ${latestLive.pssMb === null ? "not recorded" : formatNumber(latestLive.pssMb) + " MB"}.`,
    `Interpretation: the middle row is ordered experimental progression, while the bottom row is the actual chronological live-service memory history.`,
  ];

  const totalHeight = config.height + matched.height;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${config.width}" height="${totalHeight}" viewBox="0 0 ${config.width} ${totalHeight}" role="img" aria-labelledby="title desc">
  <title id="title">${escapeXml(config.title)}</title>
  <desc id="desc">Cold-session experiments, historical live-service memory, ${readinessCard ? "a separate installed-service readiness sample, " : ""}and matched synthetic comparisons from ${escapeXml(inputPath)}.</desc>
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#0f172a"/>
      <stop offset="100%" stop-color="#111827"/>
    </linearGradient>
    <linearGradient id="barBlue" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#60a5fa"/>
      <stop offset="100%" stop-color="#2563eb"/>
    </linearGradient>
    <linearGradient id="barGreen" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#34d399"/>
      <stop offset="100%" stop-color="#059669"/>
    </linearGradient>
    <filter id="shadow" x="-20%" y="-20%" width="140%" height="140%">
      <feDropShadow dx="0" dy="8" stdDeviation="16" flood-color="#000000" flood-opacity="0.35"/>
    </filter>
    <style>
      .h1 { font: 700 28px ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, sans-serif; fill: #f8fafc; }
      .h2 { font: 700 18px ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, sans-serif; fill: #e5e7eb; }
      .body { font: 13px ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, sans-serif; fill: #cbd5e1; }
      .small { font: 12px ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, sans-serif; fill: #94a3b8; }
      .tiny { font: 11px ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, sans-serif; fill: #7c8aa5; }
      .axis { font: 12px ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, sans-serif; fill: #94a3b8; }
      .value { font: 700 12px ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, sans-serif; fill: #f8fafc; }
      .metric { font: 700 26px ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, sans-serif; fill: #f8fafc; }
    </style>
  </defs>

  <rect x="0" y="0" width="${config.width}" height="${totalHeight}" fill="url(#bg)"/>

  <text x="40" y="48" class="h1">${escapeXml(config.title)}</text>
  <text x="40" y="74" class="body">${escapeXml(config.subtitle_prefix)} · latest historical commit ${escapeXml(subtitleCommit)} · ${displayedColdRows.length} cold experiments · ${liveRows.length} historical snapshots</text>

  <g filter="url(#shadow)">
    <rect x="40" y="100" width="350" height="128" rx="18" fill="#111827" stroke="#1f2937"/>
    <rect x="425" y="100" width="350" height="128" rx="18" fill="#111827" stroke="#1f2937"/>
    <rect x="810" y="100" width="350" height="128" rx="18" fill="#111827" stroke="#1f2937"/>
  </g>

  <text x="62" y="132" class="small">Cold-session improvement vs real workspace baseline</text>
  <text x="62" y="168" class="metric" fill="#60a5fa">${escapeXml(coldRssChange)}</text>
  <text x="62" y="190" class="body">RSS delta ${escapeXml(formatNumber(baselineCold.rssDeltaMb))} → ${escapeXml(formatNumber(latestCold.rssDeltaMb))} MB · elapsed ${escapeXml(formatNumber(baselineCold.elapsedMs, 0))} → ${escapeXml(formatNumber(latestCold.elapsedMs, 0))} ms</text>

  <text x="447" y="132" class="small">Live-service RSS progression (chronological)</text>
  <text x="447" y="168" class="metric" fill="#a78bfa">${escapeXml(liveRssChange)}</text>
  <text x="447" y="190" class="body">${escapeXml(formatNumber(firstLive.rssMb))} → ${escapeXml(formatNumber(latestLive.rssMb))} MB RSS · ${escapeXml(livePeakDrop)} from ${escapeXml(formatNumber(peakLive.rssMb))} MB peak</text>

  ${readinessCard || `<text x="832" y="132" class="small">${escapeXml(config.live_summary_title)}</text>
  <text x="832" y="162" class="small">Live settled</text>
  <text x="832" y="184" class="metric">${escapeXml(formatNumber(latestLive.rssMb))} MB</text>
  <text x="832" y="204" class="body">PSS ${escapeXml(formatNumber(latestLive.pssMb ?? latestLive.rssMb))} · heap ${escapeXml(formatNumber(latestLive.heapUsedMb ?? 0))} · external ${escapeXml(formatNumber(latestLive.externalMb ?? 0))}</text>
  ${latestPostStart ? `<text x="832" y="222" class="small">Fresh post-start ${escapeXml(formatNumber(latestPostStart.rssMb))} RSS · heap ${escapeXml(formatNumber(latestPostStart.heapUsedMb))} · ext ${escapeXml(formatNumber(latestPostStart.externalMb))}</text>` : ""}`}

  <g filter="url(#shadow)">
    <rect x="40" y="240" width="550" height="330" rx="22" fill="#111827" stroke="#1f2937"/>
    <rect x="610" y="240" width="550" height="330" rx="22" fill="#111827" stroke="#1f2937"/>
  </g>

  <text x="60" y="274" class="h2">${escapeXml(config.cold_rss_title)}</text>
  <text x="60" y="294" class="small">Experiment-step progression — ordered by changes, not wall-clock time</text>
  <text x="630" y="274" class="h2">${escapeXml(config.cold_elapsed_title)}</text>
  <text x="630" y="294" class="small">Same experiment steps as left chart; labels S1–S8 match across both plots</text>

  ${coldRssGrid}
  ${coldElapsedGrid}
  ${coldRssBars}
  ${coldElapsedBars}

  <g filter="url(#shadow)">
    <rect x="40" y="600" width="1120" height="250" rx="22" fill="#111827" stroke="#1f2937"/>
  </g>
  <text x="60" y="634" class="h2">Historical live-service memory timeline</text>
  <text x="60" y="654" class="small">Actual chronological service history from the live-snapshot table</text>
  ${renderLegendItem(840, 632, "#60a5fa", "RSS")}
  ${renderLegendItem(920, 632, "#a78bfa", "PSS")}
  ${liveTimeline}

  <g filter="url(#shadow)">
    <rect x="40" y="860" width="1120" height="78" rx="18" fill="#111827" stroke="#1f2937"/>
  </g>
  <text x="60" y="885" class="body">${escapeXml(footerLines[0])}</text>
  <text x="60" y="903" class="body">${escapeXml(footerLines[1])}</text>
  <text x="60" y="921" class="body">${escapeXml(footerLines[2])}</text>
  ${matched.svg}
</svg>`;
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const projectRoot = path.resolve(import.meta.dir, "..", "..");
  const inputPath = path.resolve(projectRoot, options.input);
  const outputPath = path.resolve(projectRoot, options.output);
  const templatePath = path.resolve(projectRoot, options.template);

  const markdown = readFileSync(inputPath, "utf8");
  const template = existsSync(templatePath)
    ? { ...DEFAULT_TEMPLATE, ...JSON.parse(readFileSync(templatePath, "utf8")) as Partial<TemplateConfig> }
    : DEFAULT_TEMPLATE;

  const coldRows = parseColdRows(markdown);
  const liveRows = parseLiveRows(markdown);
  const svg = renderSvg(template, path.relative(projectRoot, inputPath), coldRows, liveRows, renderMatchedRss(markdown, template.height - 5), renderReadinessCard(markdown));
  writeFileSync(outputPath, svg.replace(/[ \t]+$/gm, "") + "\n");
  console.log(JSON.stringify({ output: path.relative(projectRoot, outputPath), cold_rows: coldRows.length, live_rows: liveRows.length }, null, 2));
}

main();
