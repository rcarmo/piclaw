import { useEffect } from "preact/hooks";
import { useSignal, useComputed } from "@preact/signals";
import { formatBytesCompact } from "../utils/format";

interface StatsData {
  cpu_percent: number;
  ram_percent: number;
  swap_percent: number | null;
  buffer_cache_bytes: number;
  vram_percent: number | null;
  gpu_provider: string | null;
  process_memory?: {
    rss_bytes: number;
  };
}

type MetricSeverity = "normal" | "warning" | "error";

export function formatClock(date: Date): string {
  const dayName = new Intl.DateTimeFormat("en-GB", { weekday: "short" }).format(date);
  const day = date.getDate();
  const month = new Intl.DateTimeFormat("en-GB", { month: "short" }).format(date);
  const year = date.getFullYear();
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  return `${dayName}, ${day} ${month} ${year} \u2014 ${hours}:${minutes}`;
}



function percentSeverity(value: number | null): MetricSeverity {
  if (value == null || Number.isNaN(value)) return "normal";
  if (value > 85) return "error";
  if (value >= 60) return "warning";
  return "normal";
}

function swapSeverity(value: number | null): MetricSeverity {
  if (value != null && value > 0) return "warning";
  return "normal";
}

function valueClassName(severity: MetricSeverity): string {
  if (severity === "error") return "sys-stats__value sys-stats__value--error";
  if (severity === "warning") return "sys-stats__value sys-stats__value--warning";
  return "sys-stats__value";
}

function Metric({ icon, title, value, severity = "normal", label }: {
  icon: string; title: string; value: string; severity?: MetricSeverity; label?: string;
}) {
  return (
    <span className="sys-stats__metric" title={title}>
      <span className={`sys-stats__icon codicon ${icon}`} aria-hidden="true" />
      {label && <span className="sys-stats__label">{label}</span>}
      <span className={valueClassName(severity)}>{value}</span>
    </span>
  );
}

function buildMetrics(stats: StatsData | null, withLabels = false) {
  if (!stats) {
    return [
      <Metric key="cpu" icon="codicon-pulse" title="CPU" value="--" label={withLabels ? "CPU" : undefined} />,
      <Metric key="ram" icon="codicon-circuit-board" title="RAM" value="--" label={withLabels ? "RAM" : undefined} />,
    ];
  }

  const rss = formatBytesCompact(stats.process_memory?.rss_bytes ?? 0);
  const swapValue = stats.swap_percent != null ? `${stats.swap_percent}%` : "--";
  const metrics = [
    <Metric key="cpu" icon="codicon-pulse" title="CPU usage" value={`${stats.cpu_percent}%`} severity={percentSeverity(stats.cpu_percent)} label={withLabels ? "CPU" : undefined} />,
    <Metric key="ram" icon="codicon-circuit-board" title="RAM usage" value={`${stats.ram_percent}%`} severity={percentSeverity(stats.ram_percent)} label={withLabels ? "RAM" : undefined} />,
    <Metric key="rss" icon="codicon-package" title="Process RSS" value={rss} label={withLabels ? "RSS" : undefined} />,
    <Metric key="swp" icon="codicon-arrow-swap" title="Swap usage" value={swapValue} severity={swapSeverity(stats.swap_percent)} label={withLabels ? "SWP" : undefined} />,
    <Metric key="buf" icon="codicon-database" title="Buffer/cache" value={formatBytesCompact(stats.buffer_cache_bytes)} label={withLabels ? "BUF" : undefined} />,
  ];
  if (stats.gpu_provider) {
    metrics.push(
      <Metric key="gpu" icon="codicon-server-process" title={`GPU VRAM (${stats.gpu_provider})`} value={stats.vram_percent != null ? `${stats.vram_percent}%` : "--"} severity={percentSeverity(stats.vram_percent)} label={withLabels ? "GPU" : undefined} />
    );
  }
  return metrics;
}

function StatsDisplay({ stats, isStale }: { stats: StatsData | null; isStale: boolean }) {
  return (
    <span className="sys-stats">
      {isStale && <span className="sys-stats__stale" title="System stats unavailable">⚠</span>}
      {buildMetrics(stats)}
    </span>
  );
}

function StatsBar({ stats, isStale }: { stats: StatsData | null; isStale: boolean }) {
  return (
    <span className="sys-stats sys-stats--bar">
      {isStale && <span className="sys-stats__stale" title="System stats unavailable">⚠</span>}
      {buildMetrics(stats, true)}
    </span>
  );
}

export function SystemStats() {
  const stats = useSignal<StatsData | null>(null);
  const statsError = useSignal(false);
  const lastStatsSuccess = useSignal(0);
  const statsPollTick = useSignal(0);
  const isStale = useComputed(() => {
    void statsPollTick.value;
    return statsError.value && lastStatsSuccess.value > 0 && Date.now() - lastStatsSuccess.value > 15000;
  });

  useEffect(() => {
    const fetchStats = async () => {
      try {
        const res = await fetch("/agent/system-metrics");
        if (res.ok) {
          stats.value = await res.json() as StatsData;
          statsError.value = false;
          lastStatsSuccess.value = Date.now();
          statsPollTick.value += 1;
        } else {
          statsError.value = true;
          statsPollTick.value += 1;
        }
      } catch (err) {
        console.warn("[SystemStats] fetch failed:", err);
        statsError.value = true;
        statsPollTick.value += 1;
      }
    };
    fetchStats();
    const interval = setInterval(fetchStats, 10_000);
    return () => clearInterval(interval);
  }, [stats]);

  return (
    <span className="sys-stats-bar">
      {/* Inline metrics for wide screens */}
      <span className="sys-stats-bar__inline">
        <StatsDisplay stats={stats.value} isStale={isStale.value} />
      </span>
      {/* Stats bar for narrow screens */}
      <span className="sys-stats-bar__compact">
        <StatsBar stats={stats.value} isStale={isStale.value} />
      </span>
    </span>
  );
}
