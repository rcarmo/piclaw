import { useSignal } from "@preact/signals";
import { useEffect, useMemo, useState } from "preact/hooks";
import { type SettingsData, type WatchdogPhase, type CompactionBackoff, type SettingsSectionProps } from "./types";
import { NumberStepper } from "./NumberStepper";
import { registerSettingsPane } from "./pane-registry";
import { getChatJid } from "../../api/chat-jid";
import {
  formatModelCatalogueContextWindow,
  normaliseModelCatalogue,
} from "../../../../../../src/ui/model-catalogue";

interface CompactionModelsPayload {
  current?: string | null;
  model_options?: unknown[];
  models?: string[];
  provider_diagnostics?: { providers?: Array<{ provider: string; auth_configured?: boolean }> };
}

interface CompactionProbeResult {
  ok?: boolean;
  model?: string;
  contextWindow?: number | null;
  stage?: string;
  timeToFirstTokenMs?: number | null;
  durationMs?: number;
  error?: string;
}

function normalizeSmartCompactionMethod(value: unknown): "selective" | "pipelined" {
  const normalized = String(value ?? "").trim().toLowerCase().replace(/[\s-]+/g, "_");
  return normalized === "pipelined" || normalized === "traditional_pipelined" ? "pipelined" : "selective";
}

export function CompactionSection({
  data,
  onSaveCompaction,
}: {
  data: SettingsData;
  onSaveCompaction: (field: string, value: unknown) => void;
}) {
  const autoCompactionEnabled = useSignal(data.autoCompactionEnabled ?? true);
  const processingMethod = useSignal<"selective" | "pipelined">(
    normalizeSmartCompactionMethod(data.smartCompactionMethod)
  );
  const compactionModel = useSignal(data.compactionModel ?? "");
  const [modelPayload, setModelPayload] = useState<CompactionModelsPayload | null>(null);
  const [probeBusy, setProbeBusy] = useState(false);
  const [probeResult, setProbeResult] = useState<CompactionProbeResult | null>(null);
  const remoteCompactionEnabled = useSignal(data.remoteCompactionEnabled ?? false);
  const remoteCompactionTimeoutSec = useSignal(data.remoteCompactionTimeoutSec ?? 60);
  const timeoutSec = useSignal(data.compactionTimeoutSec ?? 300);
  const backoffBase = useSignal(data.compactionBackoffBaseMin ?? 0);
  const backoffMax = useSignal(data.compactionBackoffMaxMin ?? 0);
  const thresholdPercent = useSignal(data.compactionThresholdPercent ?? 80);
  const watchdogTimeout = useSignal(data.progressWatchdogTimeoutSec ?? 300);
  const toolsInput = useSignal((data.toolResultCompactionTools ?? []).join(", "));
  const semanticSummaryMaxInputChars = useSignal(data.toolResultSemanticSummaryMaxInputChars ?? 4000);
  const semanticSummaryMaxTokens = useSignal(data.toolResultSemanticSummaryMaxTokens ?? 512);
  const semanticSummaryTimeoutSec = useSignal(data.toolResultSemanticSummaryTimeoutSec ?? 30);
  const resetStatus = useSignal<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    fetch(`/agent/models?chat_jid=${encodeURIComponent(getChatJid())}`, { credentials: "same-origin", signal: controller.signal })
      .then(async (response) => response.ok ? await response.json() : Promise.reject(new Error(`HTTP ${response.status}`)))
      .then((payload) => setModelPayload(payload as CompactionModelsPayload))
      .catch(() => { if (!controller.signal.aborted) setModelPayload({ models: [], model_options: [] }); });
    return () => controller.abort();
  }, []);

  const catalogue = useMemo(() => normaliseModelCatalogue(modelPayload ?? {}), [modelPayload]);
  const providerAuthById = useMemo(() => new Map(
    (modelPayload?.provider_diagnostics?.providers ?? []).map((provider) => [provider.provider, Boolean(provider.auth_configured)]),
  ), [modelPayload]);
  const configuredModelMissing = Boolean(compactionModel.value && !catalogue.some((entry) => entry.key === compactionModel.value));
  const effectiveProbeModel = compactionModel.value || modelPayload?.current || "";

  async function handleProbe() {
    if (!effectiveProbeModel || probeBusy) return;
    setProbeBusy(true);
    setProbeResult(null);
    try {
      const response = await fetch("/agent/settings/compaction/probe", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: effectiveProbeModel }),
      });
      const payload = await response.json().catch(() => ({})) as CompactionProbeResult;
      setProbeResult(payload);
    } catch (error) {
      setProbeResult({ ok: false, model: effectiveProbeModel, error: error instanceof Error ? error.message : String(error) });
    } finally {
      setProbeBusy(false);
    }
  }

  async function handleResetBackoff(chatJid: string) {
    try {
      const res = await fetch("/agent/settings/compaction/reset-backoff", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chatJid }),
      });
      if (!res.ok) throw new Error("Reset failed");
      resetStatus.value = `Reset ✓ (${chatJid})`;
      setTimeout(() => (resetStatus.value = null), 2500);
    } catch {
      resetStatus.value = "Reset failed";
      setTimeout(() => (resetStatus.value = null), 3000);
    }
  }

  function saveToolsFromInput() {
    const tools = toolsInput.value
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    onSaveCompaction("toolResultCompactionTools", tools);
  }

  return (
    <section className="settings-panel__section">
      <h2 className="settings-panel__section-title">Compaction</h2>

      <h3 className="settings-panel__subsection-title">Automatic compaction</h3>

      <div className="settings-panel__field settings-panel__checkbox-row">
        <input
          id="autoCompactionEnabled"
          type="checkbox"
          checked={autoCompactionEnabled.value}
          onChange={(e) => {
            const value = (e.target as HTMLInputElement).checked;
            autoCompactionEnabled.value = value;
            onSaveCompaction("autoCompactionEnabled", value);
          }}
        />
        <label htmlFor="autoCompactionEnabled" className="settings-panel__label">
          Enable automatic compaction
        </label>
        <span className="settings-panel__description">Piclaw-managed pre-prompt/idle compaction. The upstream agent auto-compactor stays suppressed internally.</span>
      </div>

      <div className="settings-panel__field">
        <label className="settings-panel__label" htmlFor="smartCompactionMethod">Processing method</label>
        <div className="settings-panel__field-content">
          <select
            id="smartCompactionMethod"
            className="settings-panel__input"
            value={processingMethod.value}
            onChange={(event) => {
              const value = normalizeSmartCompactionMethod((event.target as HTMLSelectElement).value);
              processingMethod.value = value;
              onSaveCompaction("smartCompactionMethod", value);
            }}
          >
            <option value="selective">Selective</option>
            <option value="pipelined">Pipelined</option>
          </select>
          <span className="settings-panel__description">
            {processingMethod.value === "pipelined"
              ? "Canonicalize and classify every discarded source event with an auditable coverage ledger before summarizing."
              : "Extract the highest-value continuity excerpts and use complete progressive coverage when the bounded prompt cannot represent all source."}
          </span>
        </div>
      </div>

      <div className="settings-panel__field compaction-model-picker">
        <label className="settings-panel__label" htmlFor="compactionModel">Compaction model</label>
        <div className="settings-panel__field-content">
          <select
            id="compactionModel"
            className="settings-panel__input"
            value={compactionModel.value}
            aria-describedby="compactionModelHint"
            onChange={(event) => {
              const value = (event.target as HTMLSelectElement).value;
              compactionModel.value = value;
              setProbeResult(null);
              onSaveCompaction("compactionModel", value);
            }}
          >
            <option value="">Use active model{modelPayload?.current ? ` (${modelPayload.current})` : ""}</option>
            {configuredModelMissing && <option value={compactionModel.value}>Unavailable: {compactionModel.value}</option>}
            {catalogue.map((entry) => (
              <option key={entry.key} value={entry.key}>
                {entry.displayName} — {entry.key} · {formatModelCatalogueContextWindow(entry.contextWindow) || "unknown context"} · {providerAuthById.get(entry.provider) ? "credentials configured" : "credentials not configured"}
              </option>
            ))}
          </select>
          <button type="button" className="settings-panel__provider-btn" disabled={!effectiveProbeModel || probeBusy} onClick={handleProbe}>
            {probeBusy ? "Testing…" : "Test compaction model"}
          </button>
          <span id="compactionModelHint" className="settings-panel__description">Strict local smart-compaction model. If configured but unavailable, compaction stops and preserves the session instead of falling back.</span>
          {configuredModelMissing && <span className="settings-panel__description" role="alert">Configured model is not currently available. It remains selected so you can repair it explicitly.</span>}
          {probeResult && (
            <span className={`settings-panel__description compaction-model-probe-result ${probeResult.ok ? "success" : "error"}`} role="status" aria-live="polite">
              {probeResult.ok
                ? `${probeResult.model} ready · ${probeResult.contextWindow?.toLocaleString() || "unknown"} context · TTFT ${probeResult.timeToFirstTokenMs ?? "n/a"}ms · ${probeResult.durationMs}ms total`
                : `${probeResult.model || effectiveProbeModel}: ${probeResult.stage ? `${probeResult.stage} · ` : ""}${probeResult.error || "Probe failed"}`}
            </span>
          )}
        </div>
      </div>

      <h3 className="settings-panel__subsection-title">Provider-native compaction</h3>

      <div className="settings-panel__field settings-panel__checkbox-row">
        <input
          id="remoteCompactionEnabled"
          type="checkbox"
          checked={remoteCompactionEnabled.value}
          onChange={(e) => {
            const value = (e.target as HTMLInputElement).checked;
            remoteCompactionEnabled.value = value;
            onSaveCompaction("remoteCompactionEnabled", value);
          }}
        />
        <label htmlFor="remoteCompactionEnabled" className="settings-panel__label">
          Attempt provider-native compaction first
        </label>
        <span className="settings-panel__description">
          Opt-in for explicitly supported providers only ({(data.remoteCompactionSupportedProviders ?? ["openai"]).join(", ")}). Any unsupported endpoint, timeout, malformed response, authentication limitation, or provider failure falls back atomically to {processingMethod.value}.
        </span>
      </div>

      <div className="settings-panel__field">
        <label className="settings-panel__label">Provider-native timeout (sec)</label>
        <NumberStepper value={remoteCompactionTimeoutSec} min={1} max={300} step={5} onSave={(v) => onSaveCompaction("remoteCompactionTimeoutSec", v)} />
        <span className="settings-panel__description">Deadline for the remote pre-pass before the selected local fallback runs.</span>
      </div>

      <h3 className="settings-panel__subsection-title">Execution limits</h3>

      <div className="settings-panel__field">
        <label className="settings-panel__label">Compaction timeout (sec)</label>
        <NumberStepper value={timeoutSec} min={1} max={3600} step={10} onSave={(v) => onSaveCompaction("compactionTimeoutSec", v)} />
        <span className="settings-panel__description">Single wall-clock deadline for deterministic preparation, provider prefill/streaming, and settlement. Local provider requests inherit the remaining time.</span>
      </div>

      <div className="settings-panel__field">
        <label className="settings-panel__label">Automatic threshold (%)</label>
        <NumberStepper value={thresholdPercent} min={10} max={95} step={1} onSave={(v) => onSaveCompaction("compactionThresholdPercent", v)} />
        <span className="settings-panel__description">Start automatic compaction when active context reaches this percentage of its effective window.</span>
      </div>

      <div className="settings-panel__field">
        <label className="settings-panel__label">Failure backoff base (min)</label>
        <NumberStepper value={backoffBase} min={1} max={1440} step={5} onSave={(v) => onSaveCompaction("compactionBackoffBaseMin", v)} />
        <span className="settings-panel__description">First suppression window after a compaction failure.</span>
      </div>

      <div className="settings-panel__field">
        <label className="settings-panel__label">Failure backoff max (min)</label>
        <NumberStepper value={backoffMax} min={1} max={10080} step={10} onSave={(v) => onSaveCompaction("compactionBackoffMaxMin", v)} />
        <span className="settings-panel__description">Upper bound for exponential suppression after repeated failures.</span>
      </div>

      <h3 className="settings-panel__subsection-title">Tool result compaction</h3>

      <div className="settings-panel__field settings-panel__checkbox-row">
        <input
          id="toolResultCompactionEnabled"
          type="checkbox"
          checked={data.toolResultCompactionEnabled ?? false}
          onChange={(e) =>
            onSaveCompaction(
              "toolResultCompactionEnabled",
              (e.target as HTMLInputElement).checked
            )
          }
        />
        <label htmlFor="toolResultCompactionEnabled" className="settings-panel__label">
          Enable tool result compaction
        </label>
        <span className="settings-panel__description">Compress large tool outputs before they are stored in the context window.</span>
      </div>

      <div className="settings-panel__field">
        <label className="settings-panel__label">Compacted tools</label>
        <div className="settings-panel__field-content">
          <input
            className="settings-panel__input"
            type="text"
            value={toolsInput.value}
            onInput={(e) => (toolsInput.value = (e.target as HTMLInputElement).value)}
            onBlur={saveToolsFromInput}
            placeholder="e.g. read, bash, grep"
          />
          <span className="settings-panel__description">Comma-separated list of tool names whose results should be compacted. Leave empty to compact all tools.</span>
        </div>
      </div>

      <h3 className="settings-panel__subsection-title">Semantic summarization</h3>

      <div className="settings-panel__field settings-panel__checkbox-row">
        <input
          id="toolResultSemanticSummaryEnabled"
          type="checkbox"
          checked={data.toolResultSemanticSummaryEnabled ?? false}
          onChange={(e) =>
            onSaveCompaction(
              "toolResultSemanticSummaryEnabled",
              (e.target as HTMLInputElement).checked
            )
          }
        />
        <label htmlFor="toolResultSemanticSummaryEnabled" className="settings-panel__label">
          Enable semantic summarization
        </label>
        <span className="settings-panel__description">Use a model to semantically summarize large tool results instead of truncating them.</span>
      </div>

      <div className="settings-panel__field">
        <label className="settings-panel__label">Max input chars</label>
        <NumberStepper value={semanticSummaryMaxInputChars} min={500} max={200000} step={500} onSave={(v) => onSaveCompaction("toolResultSemanticSummaryMaxInputChars", v)} />
        <span className="settings-panel__description">Maximum characters of tool output to feed into the summarizer.</span>
      </div>

      <div className="settings-panel__field">
        <label className="settings-panel__label">Max output tokens</label>
        <NumberStepper value={semanticSummaryMaxTokens} min={64} max={4096} step={64} onSave={(v) => onSaveCompaction("toolResultSemanticSummaryMaxTokens", v)} />
        <span className="settings-panel__description">Token budget for the summary response.</span>
      </div>

      <div className="settings-panel__field">
        <label className="settings-panel__label">Summarization timeout (sec)</label>
        <NumberStepper value={semanticSummaryTimeoutSec} min={1} max={300} step={5} onSave={(v) => onSaveCompaction("toolResultSemanticSummaryTimeoutSec", v)} />
        <span className="settings-panel__description">Abort slow summarization requests after this many seconds.</span>
      </div>

      <h3 className="settings-panel__subsection-title">Stall watchdog</h3>

      <div className="settings-panel__field settings-panel__checkbox-row">
        <input
          id="progressWatchdogEnabled"
          type="checkbox"
          checked={data.progressWatchdogEnabled ?? false}
          onChange={(e) =>
            onSaveCompaction(
              "progressWatchdogEnabled",
              (e.target as HTMLInputElement).checked
            )
          }
        />
        <label htmlFor="progressWatchdogEnabled" className="settings-panel__label">
          Enable watchdog
        </label>
        <span className="settings-panel__description">Disabled by default. When enabled, a helper process terminates the runtime if an active phase stops heartbeating.</span>
      </div>

      <div className="settings-panel__field">
        <label className="settings-panel__label">Watchdog timeout (sec)</label>
        <NumberStepper value={watchdogTimeout} min={0} max={3600} step={10} onSave={(v) => onSaveCompaction("progressWatchdogTimeoutSec", v)} />
        <span className="settings-panel__description">How long an active phase can go without a heartbeat before the watchdog kills the runtime.</span>
      </div>

      <h3 className="settings-panel__subsection-title">Active compaction suppressions</h3>
      {resetStatus.value && (
        <p className="settings-panel__description" style={{ color: "var(--accent)" }}>{resetStatus.value}</p>
      )}
      {(data.compactionBackoffs ?? []).length === 0 ? (
        <p className="settings-panel__description">No chats are currently under compaction backoff.</p>
      ) : (
        <table className="settings-panel__table">
          <thead>
            <tr><th>Chat</th><th>Failures</th><th>Backoff until</th><th>Last error</th><th></th></tr>
          </thead>
          <tbody>
            {(data.compactionBackoffs ?? []).map((entry: CompactionBackoff, i: number) => (
              <tr key={i}>
                <td>{entry.chatJid ?? "—"}</td>
                <td>{entry.failureCount ?? "—"}</td>
                <td>{entry.backoffUntil ?? "—"}</td>
                <td>{entry.lastErrorMessage ?? "—"}</td>
                <td>
                  <button
                    className="settings-panel__button settings-panel__button--small"
                    onClick={() => handleResetBackoff(entry.chatJid)}
                  >
                    Reset
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <h3 className="settings-panel__subsection-title">Live watchdog phases</h3>
      {(data.progressWatchdogPhases ?? []).length === 0 ? (
        <p className="settings-panel__description">No active watchdog phases.</p>
      ) : (
        <table className="settings-panel__table">
          <thead>
            <tr><th>Chat</th><th>Phase</th><th>Started</th><th>Last heartbeat</th></tr>
          </thead>
          <tbody>
            {(data.progressWatchdogPhases ?? []).map((phase: WatchdogPhase, i: number) => (
              <tr key={i}>
                <td>{phase.chat ?? "—"}</td>
                <td>{phase.phase ?? "—"}</td>
                <td>{phase.started ?? "—"}</td>
                <td>{phase.lastHeartbeat ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

registerSettingsPane({
  id: "compaction",
  label: "Compaction",
  icon: <i className="codicon codicon-archive" />,
  order: 20,
  component: ({ data, saveSetting }: SettingsSectionProps) => (
    <CompactionSection data={data} onSaveCompaction={(field, value) => saveSetting("compaction", field, value)} />
  ),
});
