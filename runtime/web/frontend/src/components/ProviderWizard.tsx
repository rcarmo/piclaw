/**
 * ProviderWizard.tsx — Provider setup wizard using direct /login commands.
 *
 * OAuth flow:
 *   POST /login __step1 {"provider":"github-copilot"}
 *   → extract OAuth URL from command.message
 *   → open URL, user completes OAuth
 *   POST /login __step2 {"provider":"github-copilot","method":"oauth_check"}
 *   → command.status === "success"
 *
 * API Key flow:
 *   POST /login __step2 {"provider":"anthropic","method":"api_key","api_key":"sk-..."}
 *   → command.status === "success"
 */
import { useCallback, useEffect } from "preact/hooks";
import { useSignal } from "@preact/signals";
import { getMessageUrl } from "../api/chat-jid";
import type { Provider } from "../panels/settings/types";
import { CustomSelect } from "./CustomSelect";
import { safeSetItem } from "../utils/storage";

interface ProviderWizardProps {
  onDismiss: () => void;
  providerId?: string;
}

type WizardStep =
  | "idle"
  | "oauth-starting"
  | "oauth-waiting"
  | "apikey-input"
  | "custom-config"
  | "verifying"
  | "done"
  | "error";

interface CustomField {
  id: string;
  label: string;
  placeholder: string;
  required: boolean;
}

// ── API helper ────────────────────────────────────────────────────

async function sendCommand(content: string): Promise<{ status: string; message: string; contentBlocks?: Array<Record<string, unknown>> }> {
  const res = await fetch(getMessageUrl(), {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json() as { command?: { status?: string; message?: string; contentBlocks?: Array<Record<string, unknown>> } };
  return {
    status: data.command?.status ?? "error",
    message: data.command?.message ?? "",
    contentBlocks: data.command?.contentBlocks,
  };
}

// ── Component ────────────────────────────────────────────────────

export function ProviderWizard({ onDismiss, providerId }: ProviderWizardProps) {
  const step = useSignal<WizardStep>("idle");
  const errorMsg = useSignal<string | null>(null);
  const activeProvider = useSignal<string>(providerId ?? "");
  const oauthUrl = useSignal<string | null>(null);
  const oauthInstructions = useSignal<string | null>(null);
  const apiKeyInput = useSignal<string>("");
  const providers = useSignal<Provider[]>([]);
  const selectedApiProvider = useSignal<string>("");
  const showMore = useSignal<boolean>(false);
  const customFields = useSignal<CustomField[]>([]);
  const customFieldValues = useSignal<Record<string, string>>({});
  const customActionData = useSignal<Record<string, string>>({});

  const TIER1_IDS = ["github-copilot", "anthropic", "openai-codex", "openai"];

  // Fetch provider list once for API key dropdown / provider metadata
  useEffect(() => {
    fetch("/agent/settings-data", { credentials: "same-origin" })
      .then((r) => r.json())
      .then((data: { providers?: Provider[] }) => {
        const list = data.providers ?? [];
        providers.value = list;
        // Pre-select first API key provider in dropdown
        const first = list.find((p) => p.hasApiKey);
        if (first && !selectedApiProvider.value) {
          selectedApiProvider.value = first.id;
        }
      })
      .catch(() => { /* ignore */ });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── OAuth flow ──────────────────────────────────────────────────

  const startOAuth = useCallback(async (id: string) => {
    step.value = "oauth-starting";
    errorMsg.value = null;
    activeProvider.value = id;
    oauthUrl.value = null;
    oauthInstructions.value = null;

    try {
      const result = await sendCommand(`/login __step1method ${JSON.stringify({ provider: id, action: "oauth" })}`);
      // Extract OAuth URL from message text or from adaptive card Action.OpenUrl
      let foundUrl: string | null = null;
      const urlMatch = result.message.match(/(https?:\/\/[^\s)]+)/);
      if (urlMatch) foundUrl = urlMatch[1];
      if (!foundUrl && result.contentBlocks) {
        for (const block of result.contentBlocks) {
          const payload = block.payload as Record<string, unknown> | undefined;
          const actions = (payload?.actions ?? block.actions) as Array<Record<string, unknown>> | undefined;
          if (actions) {
            for (const a of actions) {
              if (a.type === "Action.OpenUrl" && typeof a.url === "string") {
                foundUrl = a.url;
                break;
              }
            }
          }
          if (foundUrl) break;
        }
      }
      if (foundUrl) {
        oauthUrl.value = foundUrl;
      } else if (result.status === "error") {
        errorMsg.value = result.message || "Failed to start OAuth flow.";
        step.value = "error";
        return;
      }
      // Extract instructions (device code) from adaptive card TextBlock with isSubtle
      if (result.contentBlocks) {
        for (const block of result.contentBlocks) {
          const payload = block.payload as Record<string, unknown> | undefined;
          const bodyItems = (payload?.body ?? []) as Array<Record<string, unknown>>;
          for (const item of bodyItems) {
            if (item.type === "TextBlock" && item.isSubtle && typeof item.text === "string" && item.text.length > 0) {
              oauthInstructions.value = item.text;
              break;
            }
          }
          if (oauthInstructions.value) break;
        }
      }
      step.value = "oauth-waiting";
    } catch (err) {
      errorMsg.value = String(err);
      step.value = "error";
    }
  }, [step, errorMsg, activeProvider, oauthUrl]);

  const verifyOAuth = useCallback(async () => {
    const id = activeProvider.value;
    step.value = "verifying";
    errorMsg.value = null;

    try {
      const result = await sendCommand(`/login __step2 ${JSON.stringify({ provider: id, method: "oauth_check" })}`);
      if (result.status === "success") {
        step.value = "done";
        setTimeout(() => {
          window.dispatchEvent(new CustomEvent("piclaw:check-provider"));
          onDismiss();
        }, 2000);
      } else {
        errorMsg.value = result.message || "Verification failed. Have you completed the sign-in?";
        step.value = "oauth-waiting";
      }
    } catch (err) {
      errorMsg.value = String(err);
      step.value = "oauth-waiting";
    }
  }, [activeProvider, step, errorMsg, onDismiss]);

  // ── Custom config flow ──────────────────────────────────────────

  const startCustomConfig = useCallback(async (id: string) => {
    step.value = "verifying"; // show spinner while loading form
    errorMsg.value = null;
    activeProvider.value = id;
    customFields.value = [];
    customFieldValues.value = {};
    customActionData.value = {};

    try {
      const result = await sendCommand(`/login __step1method ${JSON.stringify({ provider: id, action: "configure" })}`);
      const fields: CustomField[] = [];
      let actionData: Record<string, string> = {};

      if (result.contentBlocks) {
        for (const block of result.contentBlocks) {
          const payload = block.payload as Record<string, unknown> | undefined;
          const body = payload?.body as Array<Record<string, unknown>> | undefined;
          if (body) {
            for (const item of body) {
              if (item.type === "Input.Text" && typeof item.id === "string") {
                fields.push({
                  id: item.id as string,
                  label: typeof item.label === "string" ? item.label : item.id as string,
                  placeholder: typeof item.placeholder === "string" ? item.placeholder : "",
                  required: typeof item.label === "string" ? item.label.endsWith("*") : false,
                });
              }
            }
            const actions = payload?.actions as Array<Record<string, unknown>> | undefined;
            if (actions) {
              for (const a of actions) {
                if (a.type === "Action.Submit" && typeof a.data === "object" && a.data !== null) {
                  // Extract string values from action data (skip intent key, we build the command ourselves)
                  for (const [k, v] of Object.entries(a.data as Record<string, unknown>)) {
                    if (typeof v === "string") actionData[k] = v;
                  }
                  break;
                }
              }
            }
          }
        }
      }

      if (fields.length === 0 && result.status === "error") {
        errorMsg.value = result.message || "Failed to load configuration form.";
        step.value = "error";
        return;
      }

      // Initialize field values to empty
      const initValues: Record<string, string> = {};
      for (const f of fields) initValues[f.id] = "";
      customFields.value = fields;
      customFieldValues.value = initValues;
      customActionData.value = actionData;
      step.value = "custom-config";
    } catch (err) {
      errorMsg.value = String(err);
      step.value = "error";
    }
  }, [step, errorMsg, activeProvider, customFields, customFieldValues, customActionData]);

  const saveCustomConfig = useCallback(async () => {
    const id = activeProvider.value;
    const values = customFieldValues.value;
    const actionData = customActionData.value;

    step.value = "verifying";
    errorMsg.value = null;

    try {
      const payload = { provider: id, method: "configure", ...actionData };
      // Merge field values (skip empty optional fields)
      for (const f of customFields.value) {
        const val = values[f.id]?.trim();
        if (val) payload[f.id as keyof typeof payload] = val as never;
      }
      const result = await sendCommand(`/login __step2 ${JSON.stringify(payload)}`);
      if (result.status === "success") {
        step.value = "done";
        setTimeout(() => {
          window.dispatchEvent(new CustomEvent("piclaw:check-provider"));
          onDismiss();
        }, 2000);
      } else {
        errorMsg.value = result.message || "Failed to save configuration.";
        step.value = "custom-config";
      }
    } catch (err) {
      errorMsg.value = String(err);
      step.value = "custom-config";
    }
  }, [activeProvider, customFieldValues, customFields, customActionData, step, errorMsg, onDismiss]);

  // ── API Key flow ────────────────────────────────────────────────

  const showApiKeyInput = useCallback((id?: string) => {
    step.value = "apikey-input";
    errorMsg.value = null;
    apiKeyInput.value = "";
    if (id) {
      activeProvider.value = id;
      selectedApiProvider.value = id;
    }
  }, [step, errorMsg, apiKeyInput, activeProvider, selectedApiProvider]);

  const saveApiKey = useCallback(async () => {
    const id = selectedApiProvider.value || activeProvider.value;
    const key = apiKeyInput.value.trim();
    if (!id || !key) return;

    step.value = "verifying";
    errorMsg.value = null;

    try {
      const result = await sendCommand(
        `/login __step2 ${JSON.stringify({ provider: id, method: "api_key", api_key: key })}`
      );
      if (result.status === "success") {
        step.value = "done";
        setTimeout(() => {
          window.dispatchEvent(new CustomEvent("piclaw:check-provider"));
          onDismiss();
        }, 2000);
      } else {
        errorMsg.value = result.message || "Failed to save API key.";
        step.value = "apikey-input";
      }
    } catch (err) {
      errorMsg.value = String(err);
      step.value = "apikey-input";
    }
  }, [selectedApiProvider, activeProvider, apiKeyInput, step, errorMsg, onDismiss]);

  // ── Misc handlers ───────────────────────────────────────────────

  const handleRetry = useCallback(() => {
    step.value = "idle";
    errorMsg.value = null;
    oauthUrl.value = null;
    apiKeyInput.value = "";
    // If triggered from Settings for a specific provider, keep it selected
    if (providerId) {
      activeProvider.value = providerId;
    } else {
      activeProvider.value = "";
    }
  }, [step, errorMsg, oauthUrl, apiKeyInput, activeProvider, providerId]);

  const handleSkip = useCallback(() => {
    safeSetItem("piclaw_wizard_dismissed", "1");
    onDismiss();
  }, [onDismiss]);

  // Auto-start when triggered from Settings with a specific provider (only once)
  const autoStarted = useSignal(false);
  useEffect(() => {
    if (!providerId || step.value !== "idle" || autoStarted.value) return;
    const provider = providers.value.find((p) => p.id === providerId);
    if (providers.value.length === 0) return; // wait for fetch

    autoStarted.value = true;

    if (provider?.hasOAuth && !provider?.hasApiKey) {
      startOAuth(providerId);
    } else if (!provider?.hasOAuth && provider?.hasApiKey) {
      showApiKeyInput(providerId);
    } else if (provider?.hasOAuth && provider?.hasApiKey) {
      // Both available — stay on idle to let user choose
      activeProvider.value = providerId;
    } else if (provider?.isCustom) {
      startCustomConfig(providerId);
    } else {
      showApiKeyInput(providerId);
    }
  }, [providerId, providers.value, step.value]); // eslint-disable-line react-hooks/exhaustive-deps

  const currentStep = step.value;
  const apiKeyProviders = providers.value.filter((p) => p.hasApiKey);

  return (
    <div className="provider-wizard">
      <div className="provider-wizard__content">
        <div className="provider-wizard__header">
          <span className="provider-wizard__icon">🔧</span>
          <h2 className="provider-wizard__title">Set up your AI provider</h2>
          {currentStep === "idle" && (
            <p className="provider-wizard__subtitle">Choose how to connect to get started:</p>
          )}
        </div>

        {/* ── Error ── */}
        {currentStep === "error" && (
          <div className="provider-wizard__step">
            <div className="provider-wizard__card-error">{errorMsg.value}</div>
            <button type="button" className="provider-wizard__btn provider-wizard__btn--secondary" onClick={handleRetry}>
              ← Try again
            </button>
          </div>
        )}

        {/* ── OAuth starting / verifying ── */}
        {(currentStep === "oauth-starting" || currentStep === "verifying") && (
          <div className="provider-wizard__step provider-wizard__step--loading">
            <span className="provider-wizard__spinner" aria-label="Loading" />
            <p className="provider-wizard__loading-text">
              {currentStep === "oauth-starting" ? "Starting sign-in…" : "Verifying…"}
            </p>
          </div>
        )}

        {/* ── OAuth waiting ── */}
        {currentStep === "oauth-waiting" && (
          <div className="provider-wizard__step">
            <div className="provider-wizard__step-title">
              🔐 Sign in with {activeProvider.value || "your provider"}
            </div>
            <ol className="provider-wizard__steps-list">
              <li>Click the link below to open the sign-in page.</li>
              <li>Complete the login in your browser.</li>
              <li>Return here and click <strong>I've signed in</strong>.</li>
            </ol>
            {oauthUrl.value && (
              <p className="provider-wizard__oauth-link">
                <a href={oauthUrl.value} target="_blank" rel="noopener noreferrer" className="provider-wizard__btn provider-wizard__btn--primary">
                  Open sign-in page ↗
                </a>
              </p>
            )}
            {oauthInstructions.value && (
              <div className="provider-wizard__device-code">
                <p>{oauthInstructions.value}</p>
              </div>
            )}
            {errorMsg.value && (
              <div className="provider-wizard__card-error">{errorMsg.value}</div>
            )}
            <div className="provider-wizard__actions">
              <button
                type="button"
                className="provider-wizard__btn provider-wizard__btn--primary"
                onClick={verifyOAuth}
              >
                I've signed in → Verify
              </button>
              <button
                type="button"
                className="provider-wizard__btn provider-wizard__btn--secondary"
                onClick={handleRetry}
              >
                ← Back
              </button>
            </div>
          </div>
        )}

        {/* ── API Key input ── */}
        {currentStep === "apikey-input" && (
          <div className="provider-wizard__step">
            <div className="provider-wizard__step-title">🔑 Enter API key</div>
            {errorMsg.value && (
              <div className="provider-wizard__card-error">{errorMsg.value}</div>
            )}
            {apiKeyProviders.length > 0 && (
              <div className="provider-wizard__field">
                <label className="provider-wizard__label" htmlFor="api-provider-select">
                  Provider
                </label>
                <CustomSelect
                  id="api-provider-select"
                  className="provider-wizard__select"
                  options={apiKeyProviders.map((p) => ({ value: p.id, label: p.name }))}
                  value={selectedApiProvider.value}
                  onChange={(v) => { selectedApiProvider.value = v; }}
                />
              </div>
            )}
            {apiKeyProviders.length === 0 && activeProvider.value && (
              <p className="provider-wizard__hint">Provider: <strong>{activeProvider.value}</strong></p>
            )}
            <div className="provider-wizard__field">
              <label className="provider-wizard__label" htmlFor="api-key-input">
                API Key
              </label>
              <input
                id="api-key-input"
                type="password"
                className="provider-wizard__input"
                placeholder="Enter key…"
                value={apiKeyInput.value}
                onInput={(e) => { apiKeyInput.value = (e.target as HTMLInputElement).value; }}
                onKeyDown={(e) => { if (e.key === "Enter") saveApiKey(); }}
                autoFocus
              />
            </div>
            <div className="provider-wizard__actions">
              <button
                type="button"
                className="provider-wizard__btn provider-wizard__btn--primary"
                disabled={!apiKeyInput.value.trim()}
                onClick={saveApiKey}
              >
                Save
              </button>
              <button
                type="button"
                className="provider-wizard__btn provider-wizard__btn--secondary"
                onClick={handleRetry}
              >
                ← Back
              </button>
            </div>
          </div>
        )}

        {/* ── Custom config form ── */}
        {currentStep === "custom-config" && (
          <div className="provider-wizard__step">
            <div className="provider-wizard__step-title">
              🔧 Configure {providers.value.find((p) => p.id === activeProvider.value)?.name ?? activeProvider.value}
            </div>
            {errorMsg.value && (
              <div className="provider-wizard__card-error">{errorMsg.value}</div>
            )}
            {customFields.value.map((field) => (
              <div key={field.id} className="provider-wizard__field">
                <label className="provider-wizard__label" htmlFor={`custom-field-${field.id}`}>
                  {field.label}
                </label>
                <input
                  id={`custom-field-${field.id}`}
                  type="text"
                  className="provider-wizard__input"
                  placeholder={field.placeholder}
                  value={customFieldValues.value[field.id] ?? ""}
                  onInput={(e) => {
                    customFieldValues.value = {
                      ...customFieldValues.value,
                      [field.id]: (e.target as HTMLInputElement).value,
                    };
                  }}
                />
              </div>
            ))}
            <div className="provider-wizard__actions">
              <button
                type="button"
                className="provider-wizard__btn provider-wizard__btn--primary"
                disabled={customFields.value
                  .filter((f) => f.required)
                  .some((f) => !customFieldValues.value[f.id]?.trim())}
                onClick={saveCustomConfig}
              >
                Save
              </button>
              <button
                type="button"
                className="provider-wizard__btn provider-wizard__btn--secondary"
                onClick={handleRetry}
              >
                ← Back
              </button>
            </div>
          </div>
        )}

        {/* ── Done ── */}
        {currentStep === "done" && (
          <div className="provider-wizard__step provider-wizard__step--done">
            <span className="provider-wizard__done-icon">✓</span>
            <p className="provider-wizard__loading-text">Connected! Loading…</p>
          </div>
        )}

        {/* ── Idle: provider cards ── */}
        {currentStep === "idle" && activeProvider.value && providers.value.find((p) => p.id === activeProvider.value)?.hasOAuth && providers.value.find((p) => p.id === activeProvider.value)?.hasApiKey && (
          <div className="provider-wizard__cards">
            <div className="provider-wizard__card">
              <div className="provider-wizard__card-icon">🔐</div>
              <div className="provider-wizard__card-body">
                <div className="provider-wizard__card-title">OAuth Sign-in</div>
                <div className="provider-wizard__card-desc">Sign in with {activeProvider.value} via browser</div>
              </div>
              <div className="provider-wizard__card-actions">
                <button type="button" className="provider-wizard__btn provider-wizard__btn--primary" onClick={() => startOAuth(activeProvider.value!)}>Sign in with OAuth</button>
              </div>
            </div>
            <div className="provider-wizard__card">
              <div className="provider-wizard__card-icon">🔑</div>
              <div className="provider-wizard__card-body">
                <div className="provider-wizard__card-title">API Key</div>
                <div className="provider-wizard__card-desc">Enter your {activeProvider.value} API key directly</div>
              </div>
              <div className="provider-wizard__card-actions">
                <button type="button" className="provider-wizard__btn provider-wizard__btn--primary" onClick={() => showApiKeyInput(activeProvider.value!)}>Enter API Key</button>
              </div>
            </div>
          </div>
        )}
        {currentStep === "idle" && !(activeProvider.value && providers.value.find((p) => p.id === activeProvider.value)?.hasOAuth && providers.value.find((p) => p.id === activeProvider.value)?.hasApiKey) && (
          <>
            {/* Tier 1: Featured providers — always shown as cards */}
            <div className="provider-wizard__cards">
              {providers.value
                .filter((p) => !p.configured && TIER1_IDS.includes(p.id))
                .sort((a, b) => TIER1_IDS.indexOf(a.id) - TIER1_IDS.indexOf(b.id))
                .map((p) => (
                  <div key={p.id} className="provider-wizard__card">
                    <div className="provider-wizard__card-icon">{p.hasOAuth ? "🔐" : "🔑"}</div>
                    <div className="provider-wizard__card-body">
                      <div className="provider-wizard__card-title">{p.name}</div>
                      <div className="provider-wizard__card-desc">
                        {p.hasOAuth && p.hasApiKey ? "OAuth or API key" : p.hasOAuth ? "OAuth sign-in" : "API key"}
                      </div>
                    </div>
                    <div className="provider-wizard__card-actions">
                      {p.hasOAuth && p.hasApiKey ? (
                        <>
                          <button type="button" className="provider-wizard__btn provider-wizard__btn--primary" onClick={() => startOAuth(p.id)}>OAuth</button>
                          <button type="button" className="provider-wizard__btn provider-wizard__btn--secondary" onClick={() => showApiKeyInput(p.id)}>API Key</button>
                        </>
                      ) : p.hasOAuth ? (
                        <button type="button" className="provider-wizard__btn provider-wizard__btn--primary" onClick={() => startOAuth(p.id)}>Connect</button>
                      ) : (
                        <button type="button" className="provider-wizard__btn provider-wizard__btn--secondary" onClick={() => showApiKeyInput(p.id)}>Enter API Key</button>
                      )}
                    </div>
                  </div>
                ))}
            </div>

            {/* Tier 2: More providers — collapsed behind toggle */}
            {providers.value.filter((p) => !p.configured && !p.isCustom && p.hasApiKey && !TIER1_IDS.includes(p.id)).length > 0 && (
              <>
                <button
                  type="button"
                  className="provider-wizard__show-more"
                  onClick={() => { showMore.value = !showMore.value; }}
                >
                  {showMore.value ? "Hide providers ▲" : "Show more providers ▼"}
                </button>
                {showMore.value && (
                  <div className="provider-wizard__compact-list">
                    {providers.value
                      .filter((p) => !p.configured && !p.isCustom && p.hasApiKey && !TIER1_IDS.includes(p.id))
                      .map((p) => (
                        <div key={p.id} className="provider-wizard__compact-row">
                          <span className="provider-wizard__compact-name">{p.name}</span>
                          <button
                            type="button"
                            className="provider-wizard__btn provider-wizard__btn--secondary"
                            onClick={() => showApiKeyInput(p.id)}
                          >
                            Enter API Key
                          </button>
                        </div>
                      ))}
                  </div>
                )}
              </>
            )}

            {/* Tier 3: Custom/Advanced providers */}
            {providers.value.some((p) => !p.configured && p.isCustom) && (
              <>
                <div className="provider-wizard__custom-note">
                  <span>Custom providers (Ollama, OpenAI-compatible, etc.):</span>
                </div>
                <div className="provider-wizard__compact-list">
                  {providers.value
                    .filter((p) => !p.configured && p.isCustom)
                    .map((p) => (
                      <div key={p.id} className="provider-wizard__compact-row">
                        <span className="provider-wizard__compact-name">{p.name}</span>
                        <button
                          type="button"
                          className="provider-wizard__btn provider-wizard__btn--secondary"
                          onClick={() => startCustomConfig(p.id)}
                        >
                          Configure
                        </button>
                      </div>
                    ))}
                </div>
              </>
            )}
          </>
        )}

        {currentStep === "idle" && (
          <button type="button" className="provider-wizard__skip" onClick={handleSkip}>
            Skip for now
          </button>
        )}
      </div>
    </div>
  );
}
