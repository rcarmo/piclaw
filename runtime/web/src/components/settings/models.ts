// @ts-nocheck
import { html, useState, useEffect, useCallback } from '../../vendor/preact-htm.js';
import { getAgentModels, sendAgentMessage } from '../../api.js';

const EFFORT_DISPLAY = { off: 'off', minimal: 'minimal', low: 'low', medium: 'medium', high: 'high', xhigh: 'max' };
const DEFAULT_DISPLAY = { off: 'off', minimal: 'minimal', low: 'low', medium: 'medium', high: 'high', xhigh: 'xhigh' };
function isEffortProvider(p) { return typeof p === 'string' && p.toLowerCase() === 'anthropic'; }

function ThinkingSlider({ thinkingLevel, supportsThinking, provider, availableLevels, onSetLevel, disabled }) {
    const displayMap = isEffortProvider(provider) ? EFFORT_DISPLAY : DEFAULT_DISPLAY;
    const levels = (availableLevels && availableLevels.length > 1) ? availableLevels : ['off', 'minimal', 'low', 'medium', 'high'];
    const idx = Math.max(0, levels.indexOf(thinkingLevel ?? 'off'));
    if (!supportsThinking) return html`<div class="settings-thinking-slider"><label>Thinking level</label><p class="settings-hint" style="margin:4px 0 0">Current model does not support thinking.</p></div>`;
    return html`
        <div class="settings-thinking-slider">
            <label>Thinking level: <strong>${displayMap[levels[idx]] || levels[idx]}</strong></label>
            <div class="settings-slider-track">
                <input type="range" min="0" max=${levels.length - 1} step="1" value=${idx} disabled=${disabled}
                    onInput=${(e) => onSetLevel(levels[parseInt(e.target.value, 10)])} />
                <div class="settings-slider-labels">
                    ${levels.map((l, i) => html`<span class=${i === idx ? 'active' : ''} onClick=${() => !disabled && onSetLevel(l)}>${displayMap[l] || l}</span>`)}
                </div>
            </div>
        </div>
    `;
}

export function ModelsSection({ filter = '' }) {
    const [models, setModels] = useState(null);
    const [switching, setSwitching] = useState(false);
    const [thinkingLevel, setThinkingLevel] = useState('off');
    const [supportsThinking, setSupportsThinking] = useState(false);
    const [availableLevels, setAvailableLevels] = useState(['off']);
    const [thinkingBusy, setThinkingBusy] = useState(false);
    const [cheapskateEnabled, setCheapskateEnabled] = useState(false);
    const [cheapskateLoading, setCheapskateLoading] = useState(false);

    const loadModels = useCallback(async () => {
        const data = await getAgentModels();
        setModels(data);
        if (data.thinking_level) setThinkingLevel(data.thinking_level);
        setSupportsThinking(Boolean(data.supports_thinking));
        if (Array.isArray(data.available_thinking_levels) && data.available_thinking_levels.length > 0) {
            setAvailableLevels(data.available_thinking_levels);
        }
        // Check if cheapskate mode is active by looking for free-tier providers
        const hasCheapskate = (data.model_options || []).some(m => {
            const p = (m.provider || '').toLowerCase();
            return p.includes('-free') || p === 'google-free' || p === 'cerebras-free' || p === 'groq-free' || p === 'sambanova-free';
        });
        setCheapskateEnabled(hasCheapskate);
        return data;
    }, []);
    useEffect(() => { loadModels().catch(() => setModels({ models: [], model_options: [] })); }, []);

    const switchModel = useCallback(async (label) => {
        if (switching) return; setSwitching(true);
        try { await sendAgentMessage('default', `/model ${label}`, null, []); await loadModels(); }
        catch (e) { console.error('Failed to switch model:', e); }
        finally { setSwitching(false); }
    }, [switching, loadModels]);

    const setLevel = useCallback(async (level) => {
        if (thinkingBusy) return; setThinkingBusy(true); setThinkingLevel(level);
        try {
            const resp = await sendAgentMessage('default', `/thinking ${level}`, null, []);
            if (resp?.command?.thinking_level) setThinkingLevel(resp.command.thinking_level);
            setSupportsThinking(resp?.command?.supports_thinking !== false);
            // Reload to get updated available levels after model/thinking change
            await loadModels();
        } catch (e) { console.error('Failed to set thinking:', e); await loadModels().catch((e2) => { void e2; }); }
        finally { setThinkingBusy(false); }
    }, [thinkingBusy, loadModels]);

    const toggleCheapskate = useCallback(async () => {
        if (cheapskateLoading) return;
        setCheapskateLoading(true);
        try {
            if (cheapskateEnabled) {
                // Ask agent to rotate back to a paid model
                await sendAgentMessage('default', 'Switch back to the default paid model. Cheapskate mode is being turned off.', null, []);
            } else {
                // Ask agent to activate cheapskate rotation
                await sendAgentMessage('default', 'Activate cheapskate mode — rotate to the best available free-tier model using the cheapskate tool.', null, []);
            }
            await loadModels();
        } catch (e) { console.error('Failed to toggle cheapskate mode:', e); }
        finally { setCheapskateLoading(false); }
    }, [cheapskateEnabled, cheapskateLoading, loadModels]);

    if (!models) return html`<div class="settings-loading">Loading models\u2026</div>`;
    const options = models.model_options || [];
    const current = models.current;
    const currentOption = options.find(m => m.label === current);
    const provider = currentOption?.provider || '';
    const lf = filter.toLowerCase();
    const filtered = lf ? options.filter(m => m.label.toLowerCase().includes(lf) || (m.provider || '').toLowerCase().includes(lf)) : options;

    return html`
        <div class="settings-models-split">
            <div class="settings-cheapskate-bar">
                <label class="settings-toggle-row">
                    <span class="settings-toggle-label">
                        <strong>\uD83D\uDCB0 Cheapskate mode</strong>
                        <span class="settings-hint" style="margin-left:8px;font-weight:normal">
                            Rotate across free-tier providers (Gemini, Cerebras, Groq, SambaNova)
                        </span>
                    </span>
                    <button class=${`settings-toggle-btn ${cheapskateEnabled ? 'active' : ''}`}
                        onClick=${toggleCheapskate} disabled=${cheapskateLoading}
                        title=${cheapskateEnabled ? 'Disable cheapskate mode' : 'Enable cheapskate mode'}>
                        ${cheapskateLoading ? '\u23F3' : cheapskateEnabled ? 'On' : 'Off'}
                    </button>
                </label>
            </div>
            <div class="settings-models-list">
                <table class="settings-table settings-borderless">
                    <thead><tr><th style="width:32px"></th><th>Model</th><th>Provider</th><th>Context</th><th style="text-align:center">Reasoning</th></tr></thead>
                    <tbody>
                        ${filtered.map(m => html`
                            <tr class=${m.label === current ? 'settings-row-active' : ''}>
                                <td><input type="radio" name="settings-model" checked=${m.label === current} disabled=${switching} onChange=${() => switchModel(m.label)} /></td>
                                <td>${m.name || m.label}</td><td>${m.provider}</td>
                                <td>${m.context_window ? (m.context_window / 1000).toFixed(0) + 'K' : '\u2014'}</td>
                                <td style="text-align:center">${m.reasoning ? '\ud83e\udde0' : '\u2014'}</td>
                            </tr>
                        `)}
                        ${filtered.length === 0 && html`<tr><td colspan="5" class="settings-empty">No models match "${filter}"</td></tr>`}
                    </tbody>
                </table>
            </div>
            <div class="settings-models-footer">
                <${ThinkingSlider}
                    thinkingLevel=${thinkingLevel}
                    supportsThinking=${supportsThinking}
                    provider=${provider}
                    availableLevels=${availableLevels}
                    onSetLevel=${setLevel}
                    disabled=${thinkingBusy || switching} />
            </div>
        </div>
    `;
}
