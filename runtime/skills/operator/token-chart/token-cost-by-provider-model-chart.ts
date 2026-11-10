#!/usr/bin/env bun
/**
 * token-cost-by-provider-model-chart.ts
 *
 * Generates a stacked SVG chart of estimated token cost grouped by provider + model.
 *
 * SCRIPT_JDOC:
 * {
 *   "summary": "Generate a stacked SVG chart of estimated token cost by provider and model.",
 *   "aliases": ["token cost chart"],
 *   "domains": ["operations", "charts"],
 *   "verbs": ["generate", "chart"],
 *   "nouns": ["token cost", "provider", "model"],
 *   "keywords": ["token", "cost", "chart", "provider", "model"],
 *   "examples": ["generate token cost chart"],
 *   "kind": "read-only",
 *   "weight": "standard",
 *   "role": "entrypoint"
 * }
 */

import { existsSync } from "fs";
import Database from "bun:sqlite";
import { computeChartYAxis } from "./chart-axis-scale";
import { PROVIDER_MODEL_PRICING_REFERENCE_TAG, resolveProviderModelPricing } from "./provider-model-pricing-reference";

export interface ProviderModelEstimatedCostChartDataPoint {
  day: string;
  total: number | null;
}

export interface ProviderModelEstimatedCostChartResult {
  svg: string;
  csv: string;
  dayTotals: ProviderModelEstimatedCostChartDataPoint[];
  seriesCount: number;
  totalEstimatedCost: number | null;
  knownSubtotal: number;
  unpricedGroups: number;
  pricingReferenceTag: string;
}

function formatCompactUsd(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return "$0";
  if (value >= 1_000) {
    const v = value / 1_000;
    return `$${v.toFixed(v >= 100 ? 0 : 1).replace(/\.0$/, "")}K`;
  }
  if (value >= 100) return `$${value.toFixed(0)}`;
  if (value >= 10) return `$${value.toFixed(1).replace(/\.0$/, "")}`;
  if (value >= 1) return `$${value.toFixed(2).replace(/0$/, "").replace(/\.$/, "")}`;
  if (value >= 0.1) return `$${value.toFixed(3).replace(/0+$/, "").replace(/\.$/, "")}`;
  return `$${value.toFixed(4).replace(/0+$/, "").replace(/\.$/, "")}`;
}

function formatFixedUsd(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: value >= 10 ? 2 : 4,
    maximumFractionDigits: 4,
  }).format(value);
}

function splitSeriesKey(key: `${string} / ${string}`): { provider: string; model: string } {
  const [provider, ...rest] = key.split(" / ");
  return { provider, model: rest.join(" / ") || "(unknown)" };
}

function compareProviderNames(a: string, b: string): number {
  const order = ["github-copilot", "openai-codex", "azure-openai", "azure-foundry", "(unknown)"];
  const ai = order.indexOf(a);
  const bi = order.indexOf(b);
  if (ai >= 0 && bi >= 0 && ai !== bi) return ai - bi;
  if (ai >= 0 && bi < 0) return -1;
  if (bi >= 0 && ai < 0) return 1;
  return a.localeCompare(b);
}

function estimateCostUsd(provider: string, model: string, usage: {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
}): number | null {
  const pricing = resolveProviderModelPricing(provider, model);
  if (!pricing) return null;
  return (
    (usage.inputTokens / 1_000_000) * pricing.inputPerMTok +
    (usage.outputTokens / 1_000_000) * pricing.outputPerMTok +
    (usage.cacheReadTokens / 1_000_000) * pricing.cacheReadPerMTok +
    (usage.cacheWriteTokens / 1_000_000) * pricing.cacheWritePerMTok
  );
}

export function generateProviderModelEstimatedCostChart(options: {
  days?: number;
  dbPath?: string;
  now?: Date;
}): ProviderModelEstimatedCostChartResult {
  const daysArg = Number.parseInt(String(options.days ?? 7), 10);
  const days = Number.isFinite(daysArg) && daysArg > 0 ? daysArg : 7;
  const dbPath = options.dbPath ?? "/workspace/.piclaw/store/messages.db";
  const now = options.now ?? new Date();

  const startDay = new Date(now);
  startDay.setUTCHours(0, 0, 0, 0);
  startDay.setUTCDate(startDay.getUTCDate() - (days - 1));

  const dayKeys: string[] = [];
  for (let i = 0; i < days; i += 1) {
    const d = new Date(startDay);
    d.setUTCDate(startDay.getUTCDate() + i);
    dayKeys.push(d.toISOString().slice(0, 10));
  }

  const emptyResult: ProviderModelEstimatedCostChartResult = {
    svg: `<?xml version="1.0" encoding="UTF-8"?><svg xmlns="http://www.w3.org/2000/svg" width="1700" height="860" viewBox="0 0 1700 860"><style>.title{font:700 28px system-ui,-apple-system,Segoe UI,sans-serif;fill:#f8fafc;}.subtitle{font:400 14px system-ui,-apple-system,Segoe UI,sans-serif;fill:#94a3b8;}</style><rect fill="#0b1020" x="0" y="0" width="1700" height="860" rx="18"/><text class="title" x="90" y="42">Estimated cost by provider + model — last ${days} days</text><text class="subtitle" x="90" y="64">Usage database unavailable; costs unknown. Pricing reference tag ${PROVIDER_MODEL_PRICING_REFERENCE_TAG}.</text></svg>`,
    csv: "day,provider,model,estimated_cost_usd\n",
    dayTotals: dayKeys.map((day) => ({ day, total: null })),
    seriesCount: 0,
    totalEstimatedCost: null,
    knownSubtotal: 0,
    unpricedGroups: 0,
    pricingReferenceTag: PROVIDER_MODEL_PRICING_REFERENCE_TAG,
  };

  if (!existsSync(dbPath)) {
    return emptyResult;
  }

  const db = new Database(dbPath, { readonly: true });

  type SeriesKey = `${string} / ${string}`;
  const rows = db
    .query(
      `SELECT substr(run_at,1,10) AS day,
              COALESCE(provider,'(unknown)') AS provider,
              COALESCE(model,'(unknown)') AS model,
              SUM(COALESCE(input_tokens,0)) AS input_tokens,
              SUM(COALESCE(output_tokens,0)) AS output_tokens,
              SUM(COALESCE(cache_read_tokens,0)) AS cache_read_tokens,
              SUM(COALESCE(cache_write_tokens,0)) AS cache_write_tokens
       FROM token_usage
       WHERE run_at >= ? AND run_at <= ?
       GROUP BY day, COALESCE(provider,'(unknown)'), COALESCE(model,'(unknown)')
       ORDER BY day, provider, model`
    )
    .all(`${dayKeys[0]}T00:00:00Z`, now.toISOString()) as Array<{
    day: string;
    provider: string;
    model: string;
    input_tokens: number;
    output_tokens: number;
    cache_read_tokens: number;
    cache_write_tokens: number;
  }>;

  db.close();

  const seriesSet = new Set<SeriesKey>();
  const totalsBySeries = new Map<SeriesKey, number>();

  const observations = rows.map(row => ({...row, cost: estimateCostUsd(row.provider,row.model,{
    inputTokens:Number(row.input_tokens || 0),outputTokens:Number(row.output_tokens || 0),
    cacheReadTokens:Number(row.cache_read_tokens || 0),cacheWriteTokens:Number(row.cache_write_tokens || 0),
  })}));
  const unpricedByDay = new Map<string,number>();
  for (const row of observations) {
    if(row.cost === null){unpricedByDay.set(row.day,(unpricedByDay.get(row.day) || 0)+1);continue;}
    const key = `${row.provider} / ${row.model}` as SeriesKey;
    seriesSet.add(key);
    totalsBySeries.set(key,(totalsBySeries.get(key) || 0)+row.cost);
  }
  const unpricedGroups = [...unpricedByDay.values()].reduce((sum,n)=>sum+n,0);
  const series = Array.from(seriesSet).sort((a, b) => {
    const left = splitSeriesKey(a);
    const right = splitSeriesKey(b);
    const byProvider = compareProviderNames(left.provider, right.provider);
    if (byProvider !== 0) return byProvider;
    const byTotal = (totalsBySeries.get(b) || 0) - (totalsBySeries.get(a) || 0);
    if (byTotal !== 0) return byTotal;
    return left.model.localeCompare(right.model);
  });

  const values = new Map<string, Map<SeriesKey, number>>();
  for (const day of dayKeys) {
    values.set(day, new Map(series.map((key) => [key, 0])));
  }

  for (const row of observations) {
    if(row.cost !== null)values.get(row.day)?.set(`${row.provider} / ${row.model}`,row.cost);
  }

  const totalsByDay = new Map<string, number>();
  for (const day of dayKeys) {
    let total = 0;
    for (const key of series) {
      total += values.get(day)?.get(key) || 0;
    }
    totalsByDay.set(day, total);
  }

  const maxDayTotal = Math.max(0, ...Array.from(totalsByDay.values()));
  const yScale = computeChartYAxis(maxDayTotal || 1);
  const yMax = yScale.yMax;

  const providerBaseHue: Record<string, number> = {
    "github-copilot": 215,
    "openai-codex": 12,
    "azure-openai": 280,
    "azure-foundry": 150,
    "(unknown)": 0,
  };

  const colors = new Map<SeriesKey, string>();
  const providerSeries = new Map<string, SeriesKey[]>();
  for (const key of series) {
    const { provider } = splitSeriesKey(key);
    const group = providerSeries.get(provider) || [];
    group.push(key);
    providerSeries.set(provider, group);
  }
  for (const [provider, keys] of providerSeries) {
    const baseHue = providerBaseHue[provider] ?? 0;
    const count = keys.length;
    keys.forEach((key, index) => {
      const ratio = count <= 1 ? 0 : index / (count - 1);
      const sat = 78 - ratio * 18;
      const light = 46 + ratio * 24;
      colors.set(key, `hsl(${baseHue.toFixed(1)} ${sat.toFixed(1)}% ${light.toFixed(1)}%)`);
    });
  }

  const width = 1700;
  const marginLeft = 90;
  const marginRight = 50;
  const marginTop = 80;
  const chartHeight = 670;
  const legendTop = marginTop + chartHeight + 80;
  const plotX0 = marginLeft;
  const plotY0 = marginTop;
  const plotY1 = marginTop + chartHeight;
  const chartWidth = width - marginLeft - marginRight;
  const barWidth = 120;
  const barGap = days > 1 ? (chartWidth - barWidth * days) / (days - 1) : 0;
  const legendCols = 3;
  const legendWidth = chartWidth;
  const colGap = 24;
  const colWidth = (legendWidth - colGap * (legendCols - 1)) / legendCols;
  const rowHeight = 22;
  const legendRows = Math.max(1, Math.ceil(series.length / legendCols));
  const legendHeight = legendRows * rowHeight;
  const height = legendTop + legendHeight + 70;

  const knownSubtotal = [...totalsByDay.values()].reduce((sum,value)=>sum+value,0);
  const totalEstimatedCost = unpricedGroups ? null : knownSubtotal;
  const svg = new Array<string>();
  svg.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`);
  svg.push(`<style>
  .bg { fill: #0b1020; }
  .title { font: 700 28px system-ui, -apple-system, Segoe UI, sans-serif; fill: #f8fafc; }
  .subtitle { font: 400 14px system-ui, -apple-system, Segoe UI, sans-serif; fill: #94a3b8; }
  .axis { stroke: #334155; stroke-width: 1; }
  .grid { stroke: #1e293b; stroke-width: 1; }
  .tick { font: 12px system-ui, -apple-system, Segoe UI, sans-serif; fill: #94a3b8; }
  .xlabel { font: 12px system-ui, -apple-system, Segoe UI, sans-serif; fill: #cbd5e1; }
  .toplabel { font: 12px system-ui, -apple-system, Segoe UI, sans-serif; fill: #e2e8f0; }
  .legend-title { font: 600 16px system-ui, -apple-system, Segoe UI, sans-serif; fill: #f8fafc; }
  .legend-text { font: 13px system-ui, -apple-system, Segoe UI, sans-serif; fill: #cbd5e1; }
  .legend-sub { font: 12px system-ui, -apple-system, Segoe UI, sans-serif; fill: #94a3b8; }
  .note { font: 11px system-ui, -apple-system, Segoe UI, sans-serif; fill: #64748b; }
</style>`);
  svg.push(`<desc>API-equivalent catalogue estimates, not provider bills. Unknown pricing is never zero. Dots mark observed known zero.</desc>`);
  svg.push(`<rect class="bg" x="0" y="0" width="${width}" height="${height}" rx="18"/>`);
  svg.push(`<text class="title" x="${marginLeft}" y="42">Estimated cost by provider + model — last ${days} days</text>`);
  svg.push(`<text class="subtitle" x="${marginLeft}" y="64">Known subtotal; ${unpricedGroups} unpriced series-days • pricing reference tag ${PROVIDER_MODEL_PRICING_REFERENCE_TAG} • UTC dates</text>`);

  for (const value of yScale.ticks) {
    const y = plotY1 - chartHeight * (value / yMax);
    svg.push(`<line class="grid" x1="${plotX0}" y1="${y.toFixed(1)}" x2="${plotX0 + chartWidth}" y2="${y.toFixed(1)}"/>`);
    svg.push(`<text class="tick" x="${marginLeft - 10}" y="${(y + 4).toFixed(1)}" text-anchor="end">${formatCompactUsd(value)}</text>`);
  }
  svg.push(`<line class="axis" x1="${plotX0}" y1="${plotY1}" x2="${plotX0 + chartWidth}" y2="${plotY1}"/>`);
  svg.push(`<line class="axis" x1="${plotX0}" y1="${plotY0}" x2="${plotX0}" y2="${plotY1}"/>`);

  for (let dayIndex = 0; dayIndex < dayKeys.length; dayIndex += 1) {
    const day = dayKeys[dayIndex];
    const x = plotX0 + dayIndex * (barWidth + barGap);
    let cumulative = 0;
    for (let i = series.length - 1; i >= 0; i -= 1) {
      const key = series[i];
      const value = values.get(day)?.get(key) || 0;
      if (value <= 0) continue;
      const y0 = plotY1 - chartHeight * (cumulative / yMax);
      const next = cumulative + value;
      const y1 = plotY1 - chartHeight * (next / yMax);
      const heightPx = Math.max(1, y0 - y1);
      svg.push(
        `<rect x="${x.toFixed(1)}" y="${y1.toFixed(1)}" width="${barWidth}" height="${heightPx.toFixed(1)}" fill="${colors.get(key)}"><title>${day} • ${key} • ${formatFixedUsd(value)}</title></rect>`
      );
      cumulative = next;
    }
    const dayDate = new Date(`${day}T00:00:00Z`);
    const label = dayDate.toLocaleDateString("en-US", { month: "short", day: "2-digit", timeZone: "UTC" });
    svg.push(`<text class="xlabel" x="${(x + barWidth / 2).toFixed(1)}" y="${plotY1 + 22}" text-anchor="middle">${label}</text>`);
    const dayTotal = totalsByDay.get(day) || 0;
    const observed = observations.some(row=>row.day===day && row.cost!==null);
    if(observed && dayTotal===0)svg.push(`<circle data-known-zero="${day}" cx="${(x+barWidth/2).toFixed(1)}" cy="${plotY1}" r="3" fill="#94a3b8"/>`);
    const dayLabel = unpricedByDay.has(day) ? observed ? `${formatCompactUsd(dayTotal)} known + ?` : "unknown" : observed ? formatCompactUsd(dayTotal) : "—";
    const totalLabelY = plotY1 - chartHeight * (dayTotal / yMax) - 8;
    svg.push(`<text class="toplabel" x="${(x + barWidth / 2).toFixed(1)}" y="${totalLabelY.toFixed(1)}" text-anchor="middle">${dayLabel}</text>`);
  }

  svg.push(`<text class="legend-title" x="${marginLeft}" y="${legendTop - 22}">Provider / model</text>`);
  svg.push(`<text class="legend-sub" x="${marginLeft}" y="${legendTop - 4}">7-day estimated cost</text>`);

  const legendSwatchSize = 12;
  const legendLabelXOffset = 20;
  const legendValueWidth = 72;
  const legendGap = 10;
  const legendLabelWidth = Math.min(colWidth - legendLabelXOffset - legendValueWidth - legendGap, 250);

  for (let i = 0; i < series.length; i += 1) {
    const col = i % legendCols;
    const row = Math.floor(i / legendCols);
    const x = marginLeft + col * (colWidth + colGap);
    const itemTop = legendTop + row * rowHeight;
    const swatchY = itemTop + 2;
    const textY = itemTop + 15;
    const key = series[i];
    const { provider, model } = splitSeriesKey(key);
    const labelText = `${provider} / ${model}`;
    const label = labelText.length > 32 ? `${labelText.slice(0, 31)}…` : labelText;
    const valueX = x + legendLabelXOffset + legendLabelWidth + legendGap + legendValueWidth;
    svg.push(`<rect x="${x}" y="${swatchY}" width="${legendSwatchSize}" height="${legendSwatchSize}" rx="2" fill="${colors.get(key)}"/>`);
    svg.push(`<text class="legend-text" x="${x + legendLabelXOffset}" y="${textY}">${label}</text>`);
    svg.push(`<text class="legend-sub" x="${valueX}" y="${textY}" text-anchor="end">${formatCompactUsd(totalsBySeries.get(key) || 0)}</text>`);
  }

  svg.push(`<text class="note" x="${marginLeft}" y="${height - 28}">Estimated total over ${days} days: ${totalEstimatedCost===null ? `unknown; known subtotal ${formatFixedUsd(knownSubtotal)}` : formatFixedUsd(totalEstimatedCost)} • Series: ${series.length} • Reference tag ${PROVIDER_MODEL_PRICING_REFERENCE_TAG}</text>`);
  svg.push(`</svg>`);

  const csvLines = ["day,provider,model,estimated_cost_usd"];
  for (const row of observations)csvLines.push(`${row.day},${JSON.stringify(row.provider)},${JSON.stringify(row.model)},${row.cost===null?'':row.cost.toFixed(6)}`);

  return {
    svg: svg.join(""),
    csv: `${csvLines.join("\n")}\n`,
    dayTotals: dayKeys.map((day) => ({ day, total: unpricedByDay.has(day) ? null : totalsByDay.get(day) || 0 })),
    seriesCount: series.length,
    totalEstimatedCost,
    knownSubtotal,
    unpricedGroups,
    pricingReferenceTag: PROVIDER_MODEL_PRICING_REFERENCE_TAG,
  };
}
