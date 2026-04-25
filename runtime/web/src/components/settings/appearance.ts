// @ts-nocheck
import { html, useState, useEffect, useCallback } from '../../vendor/preact-htm.js';
import { applyThemeFromEvent } from '../../ui/theme.js';

export function ThemeSection({ themes, colorKeys }) {
    const [currentTheme, setCurrentTheme] = useState('');
    const [currentTint, setCurrentTint] = useState('');

    useEffect(() => {
        setCurrentTheme(document.documentElement.dataset.colorTheme || 'default');
        setCurrentTint(document.documentElement.dataset.tint || '');
    }, []);

    const apply = useCallback((name, tint) => {
        applyThemeFromEvent({ theme: name, tint: tint || null });
        setCurrentTheme(name);
        setCurrentTint(tint || '');
    }, []);

    const keys = colorKeys || [];
    const presets = themes || [];

    return html`
        <div class="settings-section">
            <!-- Tint picker for Default theme -->
            <div class="settings-tint-row">
                <label class="settings-tint-label">
                    <input type="radio" name="settings-theme"
                        checked=${currentTheme === 'default'}
                        onChange=${() => apply('default', currentTint)} />
                    <strong>Default</strong>
                    <span class="settings-hint" style="margin:0 0 0 6px">auto (light/dark)</span>
                </label>
                <div class="settings-tint-picker">
                    <label class="settings-hint" style="margin:0">Tint:</label>
                    <input type="color"
                        value=${currentTint || '#1d9bf0'}
                        onInput=${e => {
                            const hex = e.target.value;
                            setCurrentTint(hex);
                            if (currentTheme === 'default') {
                                applyThemeFromEvent({ theme: 'default', tint: hex });
                            }
                        }} />
                    ${currentTint && html`
                        <button class="settings-tint-clear" onClick=${() => { setCurrentTint(''); apply('default', ''); }}
                            title="Clear tint">\u2715</button>
                    `}
                    <span class="settings-tint-hex">${currentTint || 'none'}</span>
                </div>
            </div>

            <!-- Other themes -->
            <table class="settings-table settings-borderless settings-theme-table">
                <thead>
                    <tr>
                        <th></th><th>Theme</th><th>Mode</th>
                        ${keys.map(k => html`<th class="settings-swatch-header">${k.replace(/([A-Z])/g, ' $1').trim()}</th>`)}
                    </tr>
                </thead>
                <tbody>
                    ${presets.filter(t => t.name !== 'default').map(t => html`
                        <tr class=${t.name === currentTheme ? 'settings-row-active' : ''}>
                            <td><input type="radio" name="settings-theme" checked=${t.name === currentTheme} onChange=${() => apply(t.name, '')} /></td>
                            <td><strong>${t.label}</strong></td>
                            <td>${t.mode}</td>
                            ${keys.map(k => {
                                const c = t.colors?.[k];
                                return html`<td class="settings-swatch-cell">
                                    ${c ? html`<span class="settings-color-swatch" style=${'background:' + c} title=${c}></span>` : '\u2014'}
                                </td>`;
                            })}
                        </tr>
                    `)}
                </tbody>
            </table>
        </div>
    `;
}
