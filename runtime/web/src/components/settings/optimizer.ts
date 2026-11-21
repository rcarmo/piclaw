import { html, useCallback, useEffect, useState } from '../../vendor/preact-htm.js';
import { useSettingsFieldIds } from './field-ids.js';
import { NumberStepper } from './number-stepper.js';

const endpoint = '/agent/addons/api/token-optimizer/config';
const modes = [['off', 'Off'], ['observe', 'Watch only'], ['active', 'On']];
const judgeOptions = [['generative', 'Generation model'], ['classifier', 'Classifier'], ['cascade', 'Classifier, then generation model']];
const modeName = (value: string) => modes.find(([mode]) => mode === value)?.[1] ?? 'Off';

function presetOf(policy) {
    if (!policy.reduceOutputs || !policy.offloadOutputs || policy.pruning !== 'propose' ||
        policy.savers.toolPrefilter || policy.savers.localToolDrops || policy.savers.novelty) return 'custom';
    if (policy.microSkills === 'envfacts' && policy.toolJudge === 'none' &&
        !policy.autoToolPicks && !policy.outputSummaries && !policy.inferenceInObserve) return 'basic';
    if (policy.microSkills === 'both' && policy.toolJudge === 'generative') return 'assisted';
    return 'custom';
}

function applyPreset(policy, preset: string) {
    const basic = preset === 'basic';
    return { ...policy, reduceOutputs: true, offloadOutputs: true, pruning: 'propose',
        microSkills: basic ? 'envfacts' : 'both', toolJudge: basic ? 'none' : 'generative',
        ...(basic ? { outputSummaries: false, autoToolPicks: false, inferenceInObserve: false } : {}),
        savers: { ...policy.savers, toolPrefilter: false, localToolDrops: false, novelty: false } };
}

export function OptimizerSection() {
    const id = useSettingsFieldIds('optimizer');
    const [data, setData] = useState<any>(null), [draft, setDraft] = useState<any>(null);
    const [activity, setActivity] = useState<any[]>([]), [custom, setCustom] = useState(false);
    const [error, setError] = useState(''), [busy, setBusy] = useState(false), [notice, setNotice] = useState('');
    const [activityError, setActivityError] = useState(''), [activityNotice, setActivityNotice] = useState('');

    const accept = useCallback(value => {
        if (!value?.ok || !value.config) throw Error(value?.error || 'Optimisation settings unavailable');
        setData(value); setDraft(structuredClone(value.config)); setActivity(value.status ?? []); setCustom(false);
    }, []);
    const load = useCallback(async () => {
        setBusy(true); setError(''); setNotice('');
        try {
            const response = await fetch(endpoint), value = await response.json();
            if (!response.ok) throw Error(value?.error || 'Optimisation settings unavailable');
            accept(value);
        } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
        finally { setBusy(false); }
    }, [accept]);
    useEffect(() => { void load(); }, [load]);

    const dirty = draft && JSON.stringify(draft) !== JSON.stringify(data.config);
    const reload = () => { if (!dirty || confirm('Discard unsaved optimisation settings and reload?')) void load(); };
    const read = (path: string) => path.split('.').reduce((value, key) => value?.[key], draft);
    const patch = (path: string, value: any) => {
        setNotice('');
        setDraft(previous => {
            const next = structuredClone(previous), keys = path.split('.');
            let current = next;
            for (const part of keys.slice(0, -1)) current = current[part] ??= {};
            current[keys.at(-1)!] = value;
            return next;
        });
    };
    const write = async (body, maintenance = false, message = '') => {
        setBusy(true);
        const reportError = maintenance ? setActivityError : setError;
        const reportNotice = maintenance ? setActivityNotice : setNotice;
        reportError(''); reportNotice('');
        try {
            const response = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
            const value = await response.json();
            if (!response.ok || !value?.ok) throw Error(value?.error || 'Settings changed; reload before saving');
            // Maintenance snapshots are authoritative for activity only. Keep the
            // edit baseline revision, so a concurrent edit still conflicts on save.
            if (maintenance) setActivity(value.status ?? []);
            else accept(value);
            reportNotice(message);
        } catch (e) { reportError(e instanceof Error ? e.message : String(e)); }
        finally { setBusy(false); }
    };
    const save = () => write({ config: draft, expectedRevision: data.revision }, false, 'Saved. Changes apply at the next eligible SDK boundary.');
    const action = (agentId: string, name: string, message: string, confirmation?: string) => {
        if (confirmation && !confirm(confirmation)) return;
        void write({ action: name, agentId }, true, message);
    };
    const select = (label: string, key: string, value: string, options: string[][], change, hint = '', blocked?: string) => html`
        <div class="settings-row settings-dense-row">
            <label for=${id(key)}>${label}</label>
            <select id=${id(key)} value=${value} disabled=${busy} aria-describedby=${hint ? id(`${key}-help`) : undefined} onChange=${event => change(event.currentTarget.value)}>
                ${options.map(([option, caption]) => html`<option value=${option} disabled=${option === blocked}>${caption}</option>`)}
            </select>
            ${hint && html`<span id=${id(`${key}-help`)} class="settings-hint">${hint}</span>`}
        </div>`;
    const field = (label: string, path: string, options: string[][], hint = '') => select(label, path, read(path) ?? '', options, value => patch(path, value), hint);
    const check = (label: string, path: string, hint = '') => html`
        <div class="settings-row settings-dense-row settings-dense-row-checkbox">
            <label class="settings-dense-check" for=${id(path)}><input id=${id(path)} type="checkbox" checked=${Boolean(read(path))} disabled=${busy} aria-describedby=${hint ? id(`${path}-help`) : undefined} onChange=${event => patch(path, event.currentTarget.checked)} /><span>${label}</span></label>
            ${hint && html`<span id=${id(`${path}-help`)} class="settings-hint">${hint}</span>`}
        </div>`;
    const number = (label: string, path: string, min = 1, max = 100000, unit = 1, step = 1) => html`
        <div class="settings-row settings-dense-row"><label for=${id(path)}>${label}</label><${NumberStepper} id=${id(path)} label=${label} value=${read(path) / unit} min=${min} max=${max} step=${step} disabled=${busy} onChange=${value => patch(path, unit === 1 ? value : Math.round(value * unit))} /></div>`;
    const model = (label: string, path: string, type = 'chat', fallback = 'Use shared model', hint = '') => {
        const value = read(path), selected = value ? JSON.stringify(value) : '';
        const choices = data.models.filter(model => (model.type || 'chat') === type).map(model => [JSON.stringify({ provider: model.provider, id: model.id }), `${model.provider}/${model.id}`]);
        if (value && !choices.some(([key]) => key === selected)) choices.unshift([selected, `${value.provider}/${value.id} (unavailable)`]);
        return select(label, path, selected, [['', fallback], ...choices], choice => patch(path, choice ? JSON.parse(choice) : null), hint);
    };
    const disclosure = (label: string, body) => html`<details class="settings-optimizer-details"><summary>${label}</summary><div class="settings-optimizer-details-body">${body}</div></details>`;

    if (!draft) return html`<div class="settings-section"><p class="settings-hint" role=${error ? 'alert' : 'status'}>${error || 'Loading optimisation settings…'}</p>${error && html`<div class="settings-row"><button type="button" disabled=${busy} onClick=${load}>Retry</button></div>`}</div>`;
    const policy = draft.policy;
    const mode = policy.enabled ? policy.mode : 'off', oversight = policy.oversightMode ?? 'off';
    const preset = custom ? 'custom' : presetOf(policy);
    const enabled = mode !== 'off', overseeing = oversight !== 'off';
    const modelOversight = overseeing && policy.loop === 'judge';
    const paidFacts = ['both', 'distiller'].includes(policy.microSkills);
    const toolJudge = policy.pruning !== 'off' && policy.toolJudge !== 'none';
    const assisted = enabled && (paidFacts || toolJudge || policy.offloadOutputs && policy.outputSummaries);
    const needsGeneration = enabled && (paidFacts || policy.offloadOutputs && policy.outputSummaries || toolJudge && policy.toolJudge !== 'classifier');
    const needsClassifier = enabled && toolJudge && policy.toolJudge !== 'generative' || modelOversight && policy.judge !== 'generative';
    const audits = needsClassifier || enabled && policy.pruning !== 'off' && (policy.savers.toolPrefilter || policy.savers.localToolDrops) || modelOversight && policy.savers.localLoop;
    const pausedAgent = activity.find(state => state.accounting?.authPaused);

    return html`<div class="settings-section settings-dense-form settings-optimizer">
        <section class="settings-optimizer-group" aria-labelledby=${id('optimisation-heading')}>
            <h3 id=${id('optimisation-heading')}>Token optimisation</h3>
            ${select('Optimisation mode', 'mode', mode, modes, value => {
                setNotice(''); setDraft(previous => ({ ...previous, policy: { ...previous.policy, enabled: value !== 'off', mode: value } }));
            }, mode === 'off' ? (draft.hasEnabled ? 'No new optimisation is applied.' : 'Start with Watch only. On becomes available after you save.') : mode === 'observe' ? 'See what would change without applying it.' : 'Apply eligible changes on upcoming requests.', !draft.hasEnabled ? 'active' : undefined)}
            ${enabled && html`
                ${select('Optimisation preset', 'preset', preset, [['basic', 'Basic'], ['assisted', 'Model-assisted'], ['custom', 'Custom']], value => {
                    setCustom(value === 'custom');
                    if (value !== 'custom') { setNotice(''); setDraft(previous => ({ ...previous, policy: applyPreset(previous.policy, value) })); }
                }, preset === 'basic' ? 'Learn from evidence, shorten output and suggest unused tools without extra optimisation model calls.' : preset === 'assisted' ? 'Basic plus model-written facts and task-aware tool picks. These calls use the shared budget.' : 'Choose features below, or select Basic for a model-free starting point.')}
                ${preset === 'custom' && html`
                    <h4>Tool output</h4>
                    ${check('Reduce test and compiler output', 'policy.reduceOutputs', 'Scripts keep full results.')}
                    ${check('Store long tool outputs', 'policy.offloadOutputs', 'Keep searchable copies and show a preview on eligible requests.')}
                    ${policy.offloadOutputs && check('Summarise stored outputs with a model', 'policy.outputSummaries', 'Sends output text to the selected model and may add time and cost.')}
                    <h4>Learned facts</h4>
                    ${field('Repository facts', 'policy.microSkills', [['off', 'Off'], ['envfacts', 'From tool evidence'], ['distiller', 'Model-written'], ['both', 'Both']])}
                    <h4>Tool selection</h4>
                    ${field('Unused tools', 'policy.pruning', [['off', 'Leave alone'], ['propose', 'Suggest hiding'], ['auto', 'Hide eligible tools automatically']])}
                    ${policy.pruning !== 'off' && field('Task-aware tool judge', 'policy.toolJudge', [['none', 'Off'], ...judgeOptions])}
                `}
                ${needsGeneration && model('Optimisation model', 'policy.generativeModel', 'chat', 'Choose a model', 'Shared generation model for facts, summaries and judges unless a task overrides it.')}
                ${toolJudge && check('Pick tools before new prompts', 'policy.autoToolPicks', 'Can add a model call and invalidate the prompt cache.')}
                ${assisted && mode === 'observe' && check('Allow optimisation model calls while watching', 'policy.inferenceInObserve', 'Off means Watch only makes no optimisation model calls.')}
                ${policy.offloadOutputs && disclosure('Stored outputs', html`
                    <p class="settings-hint">Store eligible output when either threshold is exceeded.</p>
                    ${number('Size threshold (KiB)', 'policy.offload.bytes', 1, 256, 1024, 0.5)}
                    ${number('Line threshold', 'policy.offload.lines', 10, 5000)}
                    ${number('Keep copies (days)', 'policy.offload.retentionDays', 1, 30)}`)}
                ${preset === 'custom' && disclosure('Optimisation details', html`
                    ${policy.microSkills !== 'off' && html`${number('Maximum learned facts', 'policy.maxFacts', 1, 100)}${number('Fact context token limit', 'policy.maxFactTokens', 1, 16000)}`}
                    ${paidFacts && html`${number('Evidence checks between fact proposals', 'policy.proposeEvery', 1, 1000)}${check('Propose facts only on changed evidence', 'policy.savers.novelty')}${model('Fact writer', 'policy.models.proposer')}`}
                    ${policy.pruning !== 'off' && html`${check('Local tool prefilter', 'policy.savers.toolPrefilter')}${check('Allow validated local tool drops', 'policy.savers.localToolDrops')}`}
                    ${toolJudge && policy.toolJudge !== 'classifier' && model('Tool judge model', 'policy.models.toolJudge')}
                    ${toolJudge && policy.toolJudge !== 'generative' && model('Tool classifier', 'policy.models.toolClassifier', 'classifier')}`)}
            `}
        </section>
        <section class="settings-optimizer-group" aria-labelledby=${id('oversight-heading')}>
            <h3 id=${id('oversight-heading')}>Task oversight</h3>
            ${field('Oversight mode', 'policy.oversightMode', modes, oversight === 'off' ? 'Independent of token optimisation.' : oversight === 'observe' ? 'Record advice without sending it.' : 'Send advice at a safe point in the current task.')}
            ${overseeing && html`
                ${check('Check task progress', 'policy.goalChecks', 'Local checks make no model calls.')}
                ${field('Loop checks', 'policy.loop', [['off', 'Off'], ['rules', 'Local rules'], ['judge', 'Model-assisted']], 'Model-assisted checks use the shared budget.')}
                ${policy.loop !== 'off' && disclosure('Oversight details', html`
                    ${field('When to step in', 'policy.level', [['conservative', 'Patiently'], ['default', 'Normally'], ['aggressive', 'Early']])}
                    ${number('Maximum nudges per prompt', 'policy.redirects', 1, 10)}
                    ${modelOversight && html`
                        ${field('Loop judge type', 'policy.judge', judgeOptions)}
                        ${policy.judge !== 'classifier' && model('Loop judge model', 'policy.models.loopJudge')}
                        ${policy.judge !== 'classifier' && !policy.savers.templates && model('Nudge writer', 'policy.models.writer')}
                        ${policy.judge !== 'generative' && model('Loop classifier', 'policy.models.loopClassifier', 'classifier')}
                        ${oversight === 'observe' && check('Allow oversight model calls while watching', 'policy.oversightInferenceInObserve', 'Off means Watch only makes no oversight model calls.')}
                        ${policy.goalChecks && check('Share the active Plan item with the judge', 'policy.sharePlanWithJudge', 'Sends one bounded, redacted current-task item, not the whole Plan or prompt.')}
                        ${check('Use template nudges', 'policy.savers.templates')}
                        ${check('Reuse identical judgements', 'policy.savers.reuse')}
                        ${check('Compact repeated failures before judging', 'policy.savers.compact')}
                        ${check('Skip the judge when a run is clearly fine', 'policy.savers.localLoop')}
                        ${policy.savers.localLoop && check('Let a validated local classifier identify stuck runs', 'policy.savers.authorizeLocalStuck')}
                    `}`)}
            `}
        </section>
        ${(enabled || overseeing) && disclosure('Shared models and limits', html`
            <p class="settings-hint">Optimisation and oversight model calls share these limits.</p>
            ${model('Shared generation model', 'policy.generativeModel', 'chat', 'None')}
            ${needsClassifier && model('Shared classifier model', 'policy.classifierModel', 'classifier', 'None')}
            ${number('Model calls per Agent session', 'policy.budget.callsPerSession')}
            ${number('Model calls per day', 'policy.budget.callsPerDay')}
            ${number('Response tokens per call', 'policy.budget.maxOutputTokens', 1, 32000)}
            ${number('Time limit per call (seconds)', 'policy.budget.deadlineMs', 0.001, 180, 1000)}
            <div class="settings-row settings-dense-row"><label for=${id('cost-cap')}>Spending cap per session (USD)</label><input id=${id('cost-cap')} type="number" min="0" step="0.01" placeholder="No cap" value=${policy.budget.maxCostPerSession ?? ''} disabled=${busy} onChange=${event => patch('policy.budget.maxCostPerSession', event.currentTarget.value === '' ? null : Number(event.currentTarget.value))} /></div>
            ${audits && number('Model audit (%)', 'policy.savers.auditPercent', 0, 20)}
        `)}
        <div class="settings-optimizer-save">
            <div class="settings-row"><button type="button" disabled=${busy || !dirty} onClick=${save}>Save settings</button><button type="button" disabled=${busy} onClick=${reload}>Reload saved settings</button>${dirty && html`<span class="settings-hint">Unsaved changes</span>`}</div>
            ${error && html`<p class="settings-hint" role="alert">${error}</p>`}
            ${notice && html`<p class="settings-hint" role="status">${notice}</p>`}
        </div>
        <section class="settings-optimizer-group settings-optimizer-activity" aria-labelledby=${id('activity-heading')}>
            <h3 id=${id('activity-heading')}>Agent activity</h3>
            <p class="settings-hint">Shows saved modes and recent activity. Maintenance does not save settings edits.</p>
            ${activityError && html`<p class="settings-hint" role="alert">${activityError}</p>`}
            ${activityNotice && html`<p class="settings-hint" role="status">${activityNotice}</p>`}
            ${pausedAgent && html`<div class="settings-row"><span class="settings-hint">Model calls are paused. Check provider sign-in under Models.</span><button type="button" disabled=${busy} onClick=${() => action(pausedAgent.agentId, 'retry_models', 'Model calls can resume.')}>Retry paused model calls</button></div>`}
            ${!activity.length && html`<p class="settings-hint">No optimiser activity yet.</p>`}
            ${activity.map(state => {
                const hidden = state.hiddenTools ?? [], suggested = state.proposedTools ?? [], facts = state.facts ?? [], nudges = state.nudges ?? [];
                const acts = hidden.length || state.factsInContext || facts.length || state.hasRetainedCopies;
                const label = `${state.label} · Optimisation ${modeName(state.policy?.mode)} · Oversight ${modeName(state.policy?.oversightMode)}`;
                return html`<div key=${state.agentId}>${disclosure(label, html`
                    <p class="settings-hint">${state.accounting?.calls ?? 0} / ${state.policy?.budget?.callsPerSession ?? data.config.policy.budget.callsPerSession} model calls this session · ${state.accounting?.dailyCalls ?? 0} / ${state.policy?.budget?.callsPerDay ?? data.config.policy.budget.callsPerDay} today</p>
                    ${state.lastError && html`<p class="settings-hint">${state.lastError}</p>`}
                    ${(hidden.length || suggested.length) ? disclosure('Tools', html`<p class="settings-hint">Hidden: ${hidden.join(', ') || 'none'} · Suggested: ${suggested.join(', ') || 'none'}</p>`) : null}
                    ${facts.length > 0 && disclosure(`Learned facts (${facts.length})`, html`<ul>${facts.map(fact => html`<li>${fact.claim || fact.id}</li>`)}</ul>`)}
                    ${nudges.length > 0 && disclosure(`Recent nudges (${nudges.length})`, html`<ul>${nudges.map(nudge => html`<li>${nudge.status === 'simulated' ? 'Would have sent' : nudge.status === 'queued' || nudge.status === 'consumed' ? 'Sent' : 'Not sent'} · ${nudge.text || nudge.reason || 'Loop check'}</li>`)}</ul>`)}
                    ${acts ? disclosure('Maintenance', html`<div class="settings-row">
                        ${hidden.length > 0 && html`<button type="button" disabled=${busy} onClick=${() => action(state.agentId, 'restore', 'Hidden tools restored.')}>Restore hidden tools</button>`}
                        ${state.factsInContext > 0 && html`<button type="button" disabled=${busy} onClick=${() => action(state.agentId, 'remove_context', 'Learned context removed from this Agent.')}>Remove learned context</button>`}
                        ${facts.length > 0 && html`<button type="button" disabled=${busy} onClick=${() => action(state.agentId, 'stale_facts', 'Shared facts marked stale.', 'Mark shared learned facts stale? Other Agents using the same facts are affected. History is unchanged.')}>Mark shared facts stale</button>`}
                        ${state.hasRetainedCopies && html`<button type="button" disabled=${busy} onClick=${() => action(state.agentId, 'forget_outputs', 'Retained copies forgotten for this Agent.', 'Forget this Agent’s retained output and MCP recall copies? Original committed history is unchanged.')}>Forget retained copies</button>`}
                    </div>`) : null}
                `)}</div>`;
            })}
        </section>
    </div>`;
}
