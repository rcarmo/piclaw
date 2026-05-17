import { useSignal } from "@preact/signals";
import { type SettingsData, type WatchdogPhase, type CompactionBackoff, type SettingsSectionProps } from "./types";
import { NumberStepper } from "./NumberStepper";
import { registerSettingsPane } from "./pane-registry";

export function CompactionSection({
  data,
  onSaveCompaction,
}: {
  data: SettingsData;
  onSaveCompaction: (field: string, value: unknown) => void;
}) {
  const timeoutSec = useSignal(data.compactionTimeoutSec ?? 0);
  const backoffBase = useSignal(data.compactionBackoffBaseMin ?? 0);
  const backoffMax = useSignal(data.compactionBackoffMaxMin ?? 0);
  const watchdogTimeout = useSignal(data.progressWatchdogTimeoutSec ?? 0);
  const toolsInput = useSignal((data.toolResultCompactionTools ?? []).join(", "));
  const semanticSummaryMaxInputChars = useSignal(data.toolResultSemanticSummaryMaxInputChars ?? 4000);
  const semanticSummaryMaxTokens = useSignal(data.toolResultSemanticSummaryMaxTokens ?? 512);
  const semanticSummaryTimeoutSec = useSignal(data.toolResultSemanticSummaryTimeoutSec ?? 30);
  const resetStatus = useSignal<string | null>(null);

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

      <div className="settings-panel__field">
        <label className="settings-panel__label">Compaction timeout (sec)</label>
        <NumberStepper value={timeoutSec} min={1} max={3600} step={10} onSave={(v) => onSaveCompaction("compactionTimeoutSec", v)} />
        <span className="settings-panel__description">Abort a stuck pre-prompt/manual compaction instead of hanging forever.</span>
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
