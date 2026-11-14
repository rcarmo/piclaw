import { ApiAccessSection } from './api-access.js';
import { useTranslation } from '../../utils/i18n.js';
import { html, useEffect, useRef } from '../../vendor/preact-htm.js';
import { h, render } from 'preact';
import { PasskeySettings } from '../../../shared/passkey-settings.js';

/** Separate Preact root: Classic's vendored hooks must not mix with Visual hooks. */
let authenticationInstanceId = 0;
export function AuthenticationSection({ settingsData, setStatus, mergeSettingsData }) {
    const { t } = useTranslation();
    const fieldPrefix = useRef(null);
    if (!fieldPrefix.current) fieldPrefix.current = `settings-authentication-${++authenticationInstanceId}`;
    const fieldId = (name) => `${fieldPrefix.current}-${name}`;
    const totpSetup = settingsData?.instanceTotp || { configured: false };
  const root = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const element = root.current;
    if (!element) return;
    render(h(PasskeySettings, {}), element);
    return () => render(null, element);
  }, []);
    return html`<div class="settings-section"><h3>${t('settings.section.authentication')}</h3>
            <div class="settings-totp-panel">
                <div class="settings-totp-header">
                    <div>
                        <strong>${t('settings.general.totpTitle')}</strong>
                        <div class="settings-hint" style="margin:6px 0 0 0;">
                            ${totpSetup.configured
                                ? t('settings.general.totpConfiguredHint')
                                : t('settings.general.totpUnconfiguredHint')}
                        </div>
                    </div>
                </div>
                ${totpSetup.configured ? html`
                    <div class="settings-totp-grid">
                        <div class="settings-totp-qr" dangerouslySetInnerHTML=${{ __html: totpSetup.qrSvg }}></div>
                        <div class="settings-totp-meta">
                            <div class="settings-row settings-row-vertical">
                                <label for=${fieldId('issuer')}>${t('settings.general.issuer')}</label>
                                <input id=${fieldId('issuer')} type="text" readonly value=${totpSetup.issuer || ''} />
                            </div>
                            <div class="settings-row settings-row-vertical">
                                <label for=${fieldId('totp-label')}>${t('settings.general.label')}</label>
                                <input id=${fieldId('totp-label')} type="text" readonly value=${totpSetup.label || ''} />
                            </div>
                            <div class="settings-row settings-row-vertical">
                                <label for=${fieldId('totp-secret')}>${t('settings.general.secret')}</label>
                                <input id=${fieldId('totp-secret')} type="text" readonly value=${totpSetup.secret || ''} />
                            </div>
                        </div>
                    </div>
                ` : null}
            </div>
            <p class="settings-hint">${t('settings.authentication.totpManage')}</p>
            <div ref=${root}></div>
            <${ApiAccessSection} settingsData=${settingsData} setStatus=${setStatus} mergeSettingsData=${mergeSettingsData} />
        </div>`;
}
