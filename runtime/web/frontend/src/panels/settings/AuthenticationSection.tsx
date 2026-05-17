import { useCallback, useEffect } from "preact/hooks";
import { useSignal } from "@preact/signals";
import { useDialog } from "../../hooks/useDialog";
import { CopyButton } from "../../components/CopyButton";
import { registerSettingsPane } from "./pane-registry";
import type { SettingsSectionProps } from "./types";
import { sanitizeSvg } from "../../utils/agent-status";

interface PasskeyEntry {
  id: string;
  name?: string;
  createdAt?: string;
}

function AuthenticationSection({ data, saveSetting }: SettingsSectionProps) {
  const totp = data.instanceTotp ?? {};
  const totpStatus = useSignal<string | null>(null);

  // Passkeys state
  const passkeys = useSignal<PasskeyEntry[]>([]);
  const passkeysLoading = useSignal(true);
  const passkeysError = useSignal<string | null>(null);

  const { showConfirm } = useDialog();

  // ── TOTP ──────────────────────────────────────────────────────────────────

  async function enableTotp() {
    await saveSetting("general", "totp", true);
    totpStatus.value = "TOTP enabled ✓";
    setTimeout(() => (totpStatus.value = null), 3000);
    // Reload settings data by dispatching a reload event (settings panel listens)
    window.dispatchEvent(new CustomEvent("piclaw:reload-settings"));
  }

  async function disableTotp() {
    const confirmed = await showConfirm({
      title: "Disable TOTP?",
      message: "Disabling TOTP removes a layer of security. Anyone with your password will be able to log in without a second factor.",
      confirmLabel: "Disable",
      destructive: true,
    });
    if (!confirmed) return;
    await saveSetting("general", "totp", false);
    totpStatus.value = "TOTP disabled";
    setTimeout(() => (totpStatus.value = null), 3000);
    window.dispatchEvent(new CustomEvent("piclaw:reload-settings"));
  }

  // ── Passkeys ──────────────────────────────────────────────────────────────

  const fetchPasskeys = useCallback(async () => {
    passkeysLoading.value = true;
    passkeysError.value = null;
    try {
      const res = await fetch("/agent/passkeys", {
        method: "GET",
        credentials: "same-origin",
      });
      if (!res.ok) {
        passkeysError.value = `Failed to load passkeys (HTTP ${res.status})`;
        return;
      }
      const json = await res.json() as PasskeyEntry[];
      passkeys.value = Array.isArray(json) ? json : [];
    } catch {
      passkeysError.value = "Failed to load passkeys";
    } finally {
      passkeysLoading.value = false;
    }
  }, []);

  useEffect(() => { fetchPasskeys(); }, [fetchPasskeys]);

  async function deletePasskey(id: string, name?: string) {
    const confirmed = await showConfirm({
      title: `Delete passkey${name ? ` "${name}"` : ""}?`,
      message: "This passkey will be permanently removed.",
      confirmLabel: "Delete",
      destructive: true,
    });
    if (!confirmed) return;
    try {
      await fetch("/agent/passkeys/delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ id }),
      });
      fetchPasskeys();
    } catch {
      passkeysError.value = "Failed to delete passkey";
    }
  }

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <section className="settings-panel__section">
      <h2 className="settings-panel__section-title">Authentication</h2>

      {/* ── TOTP ── */}
      <h3 className="settings-panel__subsection-title">Two-Factor Authentication (TOTP)</h3>

      {totp.configured ? (
        <div className="settings-panel__field">
          <div style={{ display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap" }}>
            <span className="auth-section__badge auth-section__badge--enabled">
              <i className="codicon codicon-check" /> TOTP enabled
            </span>
            <button
              type="button"
              className="settings-panel__provider-btn settings-panel__provider-btn--logout"
              onClick={disableTotp}
            >
              Disable TOTP
            </button>
          </div>
          {totpStatus.value && (
            <p className="settings-panel__description" style={{ marginTop: "8px" }}>
              {totpStatus.value}
            </p>
          )}
        </div>
      ) : (
        <div className="settings-panel__field">
          <p className="settings-panel__description">
            Scan this QR code with your authenticator app, then click Enable.
          </p>

          {totp.qrSvg && (
            <div
              className="auth-section__qr"
              // eslint-disable-next-line react/no-danger
              dangerouslySetInnerHTML={{ __html: sanitizeSvg(totp.qrSvg) }}
            />
          )}

          {totp.secret && (
            <div className="settings-panel__field" style={{ marginTop: "12px" }}>
              <label className="settings-panel__label">Secret key</label>
              <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                <code className="settings-panel__env-var">{totp.secret}</code>
                <CopyButton
                  text={totp.secret}
                  className="settings-panel__provider-btn"
                  title="Copy secret"
                >
                  <i className="codicon codicon-copy" />
                </CopyButton>
              </div>
            </div>
          )}

          {totp.otpauth && (
            <div className="settings-panel__field">
              <label className="settings-panel__label">OTPAuth URI</label>
              <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                <code className="settings-panel__env-var auth-section__otpauth">{totp.otpauth}</code>
                <CopyButton
                  text={totp.otpauth}
                  className="settings-panel__provider-btn"
                  title="Copy OTPAuth URI"
                >
                  <i className="codicon codicon-copy" />
                </CopyButton>
              </div>
            </div>
          )}

          <div style={{ marginTop: "12px" }}>
            <button
              type="button"
              className="settings-panel__provider-btn"
              onClick={enableTotp}
            >
              Enable TOTP
            </button>
          </div>

          {totpStatus.value && (
            <p className="settings-panel__description" style={{ marginTop: "8px" }}>
              {totpStatus.value}
            </p>
          )}
        </div>
      )}

      {/* ── Passkeys ── */}
      <h3 className="settings-panel__subsection-title" style={{ marginTop: "28px" }}>Passkeys</h3>
      <p className="settings-panel__description">
        Passkeys allow passwordless login using biometrics or a hardware key.
      </p>

      <div style={{ margin: "10px 0" }}>
        <a
          href="/auth/webauthn/enrol"
          target="_blank"
          rel="noopener noreferrer"
          className="settings-panel__provider-btn"
          style={{ display: "inline-block", textDecoration: "none" }}
        >
          <i className="codicon codicon-add" /> Enrol new passkey
        </a>
      </div>

      {passkeysError.value && (
        <div className="settings-panel__save-status settings-panel__save-status--error">
          {passkeysError.value}
        </div>
      )}

      {passkeysLoading.value ? (
        <p className="settings-panel__description">Loading passkeys…</p>
      ) : passkeys.value.length === 0 ? (
        <p className="settings-panel__description">No passkeys registered.</p>
      ) : (
        <table className="settings-panel__table">
          <thead>
            <tr>
              <th>ID</th>
              <th>Name</th>
              <th>Created</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {passkeys.value.map((pk) => (
              <tr key={pk.id}>
                <td><code className="settings-panel__env-var">{pk.id.slice(0, 12)}…</code></td>
                <td>{pk.name ?? "—"}</td>
                <td>{pk.createdAt ? new Date(pk.createdAt).toLocaleDateString() : "—"}</td>
                <td>
                  <button
                    type="button"
                    className="settings-panel__provider-btn settings-panel__provider-btn--logout"
                    onClick={() => deletePasskey(pk.id, pk.name)}
                    title="Delete passkey"
                  >
                    <i className="codicon codicon-trash" />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

registerSettingsPane({
  id: "authentication",
  label: "Authentication",
  icon: <i className="codicon codicon-shield" />,
  order: 55,
  component: (props: SettingsSectionProps) => <AuthenticationSection {...props} />,
});
