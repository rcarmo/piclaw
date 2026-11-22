/** Render the admitted A2UI catalog in Classic's Preact timeline. */
import { html, useCallback, useLayoutEffect, useMemo, useRef, useState } from '../vendor/preact-htm.js';
import { a2uiBindingPath, actionValidationExpressions, a2uiTopologyDrafts, buildA2uiAction, isA2uiActionValue, prepareA2uiActionEvaluation, readA2uiValue, type A2uiActionRequest } from '../../../src/channels/web/a2ui/action.js';
import { a2uiRendererContext } from '../ui/a2ui-renderer-peer.js';
import { evaluateA2uiFunction, reportA2uiRendererError } from '../ui/a2ui-agent-function.js';
import { useA2uiValueFunctions } from '../ui/use-a2ui-value-functions.js';
import { readClassicActionFunction, readClassicFunctionCall } from '../../../src/channels/web/a2ui/function-call.js';
import { A2uiExpressionFailure, A2UI_LOCAL_EXPRESSION_ERROR, coerceA2uiBoolean, hasA2uiAgentFunction, type A2uiRemoteValueResolver } from '../../../src/channels/web/a2ui/functions.js';
import { a2uiActionEvaluationSite, a2uiRpcArgumentKey } from '../../../src/channels/web/a2ui/rpc-json.js';
import { checkA2uiComponent } from '../../../src/channels/web/a2ui/checks.js';
import { a2uiDraftsFor, discardOldA2uiDraft, readA2uiDraft, readA2uiDraftSteps, rememberA2uiDraftEdit, subscribeA2uiDraft } from '../ui/a2ui-drafts.js';
import { affectsA2uiCollection, overlayA2uiModel, projectA2uiTemplates } from '../../../src/channels/web/a2ui/templates.js';
import { setA2uiOverlay } from '../../../src/channels/web/a2ui/data-path.js';
import { a2uiDateTimeDisplay, a2uiDateTimeType } from '../../../src/channels/web/a2ui/date-time.js';
import { presentProviderAuth } from '../ui/provider-auth-presentation.js';
import { a2uiIconPaths } from './a2ui-icon-paths.js';
import { a2uiAria } from './a2ui-accessibility.js';
import { A2uiChoicePicker } from './a2ui-choice-picker.js';
import { A2uiPlayback } from './a2ui-playback.js';
import { A2uiModal } from './a2ui-modal.js';
import { renderA2uiText } from './a2ui-text.js';
import { A2uiTabs } from './a2ui-tabs.js';
import { A2uiTotpDialog, readTotpPresentation, type TotpPresentation } from './a2ui-totp-dialog.js';
import { a2uiSliderRange, readA2uiImageUrl, readA2uiLink, readA2uiLinkTarget, readA2uiPlaybackUrl, type A2uiSurfaceBlock } from '../../../src/channels/web/a2ui/surface.js';

const remoteField = (value: unknown) => !!readClassicFunctionCall(value) && hasA2uiAgentFunction(value);

type Submit = (request: A2uiActionRequest, options?: { signal?: AbortSignal }) => Promise<unknown>;
let nextCheckPrefix = 0;
const NO_EDITS=new Map<string,unknown>();

export function A2uiSurface({ block, source, onSubmit }: {
    block: A2uiSurfaceBlock;
    source: Pick<A2uiActionRequest, 'chat_jid' | 'post_id' | 'thread_id'>;
    onSubmit?: Submit;
}) {
    const [checkPrefix] = useState(() => `a2ui-check-${++nextCheckPrefix}`);
    const tracksDraft = block.owner === 'agent' && !!onSubmit;
    const syncDraft = tracksDraft && block.surface.sendDataModel === true;
    const { chat_jid: chat } = source;
    const {surfaceId} = block.surface;
    const [edits, setEdits] = useState(() => new Map<string, unknown>(tracksDraft
        ? Array.from(readA2uiDraft(chat, surfaceId, block.revision) ?? [], ([path, edit]) => [path, edit.value]) : []));
    useLayoutEffect(() => {
        if (!tracksDraft) return;
        discardOldA2uiDraft(chat, surfaceId, block.revision);
        return subscribeA2uiDraft(chat, surfaceId, (revision, draft) => {
            if (revision === block.revision) setEdits(new Map(Array.from(draft, ([path, edit]) => [path, edit.value])));
        });
    }, [tracksDraft, chat, surfaceId, block.revision]);
    const projection: ReturnType<typeof projectA2uiTemplates> | undefined=useMemo(()=>{
        try { return projectA2uiTemplates(overlayA2uiModel(block.surface,edits)); }
        catch { return undefined; } // An invalid stored surface still has a plain-text fallback.
    },[block.surface,edits]);
    const snapshot=projection?.snapshot ?? block.surface;
    const [pending, setPending] = useState(false);
    const [error, setError] = useState('');
    const [totp, setTotp] = useState<{ presentation: TotpPresentation; request: A2uiActionRequest } | null>(null);
    const dismissTotp = useCallback(() => setTotp(null), []);
    const lastAttempt = useRef<{ key: string; request: A2uiActionRequest } | null>(null);
    const inFlight = useRef(false);
    const privateInput = useRef<HTMLInputElement | null>(null);
    const disabled = block.state !== 'active' || !onSubmit;
    const valueFunctions = useA2uiValueFunctions(projection,NO_EDITS,{...source,revision:block.revision},!disabled && block.owner==='agent');
    const components = new Map((projection?.snapshot.components ?? []).map(item => [item.id, item]));
    const functionLifetime = useRef<AbortController | null>(null);
    const invalidProjection = !projection;
    useLayoutEffect(() => {
        if (disabled || block.owner !== 'agent') return;
        const lifetime = new AbortController();
        functionLifetime.current = lifetime;
        if (invalidProjection) void reportA2uiRendererError({source:{...source,revision:block.revision},snapshot:block.surface,signal:lifetime.signal},
            {code:'INTEGRITY_ERROR',surfaceId,message:'The renderer could not reconstruct the surface.'});
        return () => { functionLifetime.current=null; lifetime.abort(); };
    }, [disabled, block.owner, chat, source.post_id, source.thread_id, surfaceId, block.revision, invalidProjection]);
    function edit(id: string, path: string | undefined, value: unknown) {
        if (!path || disabled || inFlight.current) return;
        const instance=projection?.instances.get(id);
        const collection=affectsA2uiCollection(path,projection?.collectionPaths ?? [],snapshot.dataModel);
        const next=new Map<string,unknown>(edits);
        setA2uiOverlay(next,path,value);
        try {
            const model=overlayA2uiModel(block.surface,next);
            if (collection) projectA2uiTemplates(model);
        } catch { setError('This edit cannot be applied to the form.'); return; }
        if (tracksDraft && instance && isA2uiActionValue(value)) {
            if (!rememberA2uiDraftEdit(chat,surfaceId,block.revision,path,{
                component_id:instance.id,...(instance.instancePath ? {instance_path:instance.instancePath} : {}),value,
            },syncDraft,collection)) { setError('This form has too many pending edits.'); return; }
        } else setEdits(next);
        setError('');
    }
    async function submit(event: Event, componentId: string) {
        event.stopPropagation();
        const instance = projection?.instances.get(componentId);
        if (disabled || !onSubmit || !instance || inFlight.current) return;
        const action = components.get(componentId)?.action as {event?: {name?:string;context?:Record<string,unknown>;userMessage?:unknown};functionCall?:unknown} | undefined;
        const functionCall = readClassicActionFunction(action);
        const derivesRemotely=remoteField(action?.event?.userMessage) || Object.values(action?.event?.context ?? {}).some(remoteField);
        const staleEvidence=[...(valueFunctions.receipts?.values() ?? [])].some(receipt=>receipt.refreshAfter<=Date.now());
        const needsFunctionLifetime=!!functionCall || derivesRemotely || staleEvidence;
        const signal=needsFunctionLifetime ? functionLifetime.current?.signal : undefined;
        if (needsFunctionLifetime && !signal) return;
        inFlight.current = true;
        setPending(true);
        setError('');
        try {
            if (functionCall && signal) {
                await evaluateA2uiFunction(action?.functionCall,{snapshot,edits:NO_EDITS,instance,source:{...source,revision:block.revision},signal,action:true});
                return;
            }
            const cancels=action?.event?.name==='cancel';
            const steps=tracksDraft ? readA2uiDraftSteps(chat,surfaceId,block.revision) : [];
            const own=syncDraft && !cancels ? steps : a2uiTopologyDrafts(block.surface,steps);
            const others=block.owner==='agent' && !cancels ? a2uiDraftsFor(chat)?.filter(draft=>draft.surface_id!==surfaceId) ?? [] : [];
            const currentDrafts=own.length ? [...others.slice(-6),{surface_id:surfaceId,revision:block.revision,edits:[...own]}] : others;
            const evaluation=derivesRemotely || staleEvidence ? prepareA2uiActionEvaluation(block.surface,instance.id,edits,instance.instancePath,own) : undefined;
            const settledSites=new Map<string,{id:string;key:string;value:unknown}[]>();
            if (derivesRemotely && signal && evaluation) {
                for (const {site,value} of evaluation.derived) {
                    if (!remoteField(value)) continue;
                    const orderedReceipts: {id:string;key:string;value:unknown}[]=[];
                    await evaluateA2uiFunction(value,{snapshot:evaluation.projection.snapshot,edits:evaluation.declaredEdits,
                        instance,source:{...source,revision:block.revision},signal,action:true,orderedReceipts,
                        evaluationSite:a2uiActionEvaluationSite(instance.id,instance.instancePath,site),
                    });
                    settledSites.set(site,orderedReceipts);
                }
                signal.throwIfAborted();
            }
            const resolveDerived=(site:string): A2uiRemoteValueResolver | undefined=>{
                const resolved=settledSites.get(site);
                if (!resolved) return;
                let index=0;
                return (catalogId,name,args)=>{
                    const receipt=resolved[index++];
                    if (receipt?.key===a2uiRpcArgumentKey(catalogId,name,args)) return receipt.value;
                };
            };
            const currentReceipts=new Map<string,{id:string;value:unknown;refreshAfter:number}>(valueFunctions.receipts);
            if (staleEvidence && signal && evaluation) {
                const memo=new Map<string,Promise<unknown>>();
                for (const candidate of actionValidationExpressions(evaluation)) {
                    await evaluateA2uiFunction(candidate.value,{snapshot:evaluation.projection.snapshot,edits:evaluation.declaredEdits,
                        instance:candidate.instance,source:{...source,revision:block.revision},signal,memo,receipts:currentReceipts,
                    });
                }
                signal.throwIfAborted();
            }
            const used=new Set<string>();
            const resolveForEvent: A2uiRemoteValueResolver = (catalogId,name,args)=>{
                const receipt=currentReceipts.get(a2uiRpcArgumentKey(catalogId,name,args));
                if (!receipt) return;
                used.add(receipt.id);
                return receipt.value;
            };
            let message: ReturnType<typeof buildA2uiAction>;
            try {
                message=buildA2uiAction(block.surface,instance.id,edits,new Date().toISOString(),instance.instancePath,own,undefined,resolveForEvent,resolveDerived);
            } catch (error) {
                const lifetime=functionLifetime.current;
                if (error instanceof A2uiExpressionFailure && lifetime && error.message===A2UI_LOCAL_EXPRESSION_ERROR)
                    await reportA2uiRendererError({source:{...source,revision:block.revision},snapshot,signal:lifetime.signal},
                        {code:'EXECUTION_ERROR',surfaceId,message:error.message});
                throw error;
            }
            const rpc_receipts=[...used].sort();
            const rpc_derived_receipts=Object.fromEntries([...settledSites].map(([site,items])=>[site,items.map(item=>item.id)]));
            const key = JSON.stringify([componentId,message.action.context,message.action.userMessage,currentDrafts,rpc_receipts,rpc_derived_receipts]);
            if (!lastAttempt.current || lastAttempt.current.key !== key) {
                lastAttempt.current = { key, request: { ...source, revision: block.revision, request_id: Array.from(crypto.getRandomValues(new Uint8Array(16)), byte => byte.toString(16).padStart(2, '0')).join(''), message,
                    ...(instance.instancePath ? { instance_path: instance.instancePath } : {}), ...(currentDrafts?.length ? { a2ui_drafts: currentDrafts } : {}),
                    ...(rpc_receipts.length ? {rpc_receipts} : {}),
                    ...(settledSites.size ? {rpc_derived_receipts} : {}),
                    ...(block.owner === 'agent' || block.owner === 'recovery' ? a2uiRendererContext(chat) : {}) } };
            }
            const request = lastAttempt.current.request;
            const value = block.owner === 'login' && componentId === 'save' ? privateInput.current?.value : undefined;
            if (privateInput.current) privateInput.current.value = '';
            const response = await onSubmit(value !== undefined ? { ...request, private_value: value } : request);
            if (block.owner === 'login') presentProviderAuth(response, onSubmit);
            if (block.owner === 'totp') {
                const presentation = readTotpPresentation(response);
                if (!presentation) throw new Error('TOTP setup is unavailable. Run /totp again.');
                setTotp({ presentation, request });
            }
        } catch (err) {
            if (!signal?.aborted) setError(err instanceof Error ? err.message : 'Unable to submit this form.');
        } finally {
            inFlight.current = false;
            setPending(false);
        }
    }

    function renderComponent(id: unknown, depth: number, openModal?: (event: Event) => void, inlineText = false): unknown {
        const item = typeof id === 'string' ? components.get(id) : undefined;
        if (!item || depth > 24) return null;
        const instance = projection?.instances.get(item.id);
        const read = (value: unknown) => {
            if (value && typeof value==='object') {
                if (valueFunctions.expressions.has(value)) return valueFunctions.values?.get(value);
                if (valueFunctions.localResults.values.has(value)) return valueFunctions.localResults.values.get(value);
            }
            return readA2uiValue(snapshot,value,undefined,instance?.instancePath,instance?.scope);
        };
        const text = (value: unknown) => {
            const resolved = read(value);
            return typeof resolved === 'string' ? resolved : typeof resolved === 'number' && Number.isFinite(resolved) ? String(resolved) : '';
        };
        const path = a2uiBindingPath(item.value);
        const locked = disabled || pending || !path;
        const child = (childId: unknown) => renderComponent(childId, depth + 1);
        const label = text(item.label);
        const rules=Array.isArray(item['@checks']) ? item['@checks'] : [];
        const settledRules=rules.filter(rule=>!rule?.condition || !valueFunctions.expressions.has(rule.condition) || valueFunctions.values?.has(rule.condition));
        const checksPending=settledRules.length!==rules.length && !disabled;
        const findings=checkA2uiComponent(checksPending ? {...item,'@checks':settledRules} : item,condition=>{
            if (condition && typeof condition==='object') {
                const failure=valueFunctions.localResults.failures.get(condition) ?? valueFunctions.failures?.get(condition);
                if (failure) throw new A2uiExpressionFailure(failure);
            }
            return read(condition);
        });
        const invalid = findings.some(finding => finding.severity === 'error');
        const errorId = `${checkPrefix}-${encodeURIComponent(item.id)}`;
        const aria = { ...a2uiAria(item['@accessibility'], read), ...(invalid ? {'aria-invalid':'true', 'aria-errormessage':errorId} : {}) };
        const checked = (control: unknown) => Array.isArray(item['@checks']) && item['@checks'].length ? html`
            <div class="a2ui-checked" key=${id}>${control}
                <div id=${errorId} role="status">${findings.map((finding, index) => html`
                    <p key=${index} class=${finding.severity === 'error' ? 'a2ui-error' : 'a2ui-caption'}>${finding.message}</p>`)}</div>
            </div>` : control;
        const groupRole = aria['aria-label'] ? 'group' : undefined;
        switch (item.component) {
            case 'Text': {
                const formatted = renderA2uiText(text(item.text), inlineText);
                const tag = formatted.block ? 'div' : 'span';
                return html`<${tag} key=${id} role=${groupRole} ...${aria} class=${item.variant === 'caption' ? 'a2ui-caption' : ''}>${formatted.content}</${tag}>`;
            }
            case 'Icon': {
                const name = read(item.name);
                // Nested expressions belong to an authored descriptor, never to the returned data.
                const resolvePath=(part:unknown)=>name===item.name ? read(part) : part;
                const path = typeof name === 'string' && Object.hasOwn(a2uiIconPaths, name) ? a2uiIconPaths[name]
                    : name && typeof name === 'object' && Object.hasOwn(name, 'svgPath') ? resolvePath((name as { svgPath: unknown }).svgPath) : undefined;
                if (typeof path !== 'string' || path.length > 4096 || !/^[Mm][MmZzLlHhVvCcSsQqTtAa0-9eE.,+\-\s]+$/.test(path)) return null;
                return html`<svg key=${id} class="a2ui-icon" viewBox="0 0 24 24" aria-hidden=${aria['aria-label'] ? undefined : 'true'} role=${aria['aria-label'] ? 'img' : undefined} ...${aria} focusable="false"><path d=${path}></path></svg>`;
            }
            case 'Image': {
                const src = readA2uiImageUrl(read(item.url), window.location.origin);
                const alt = text(item.description);
                if (!src) return alt ? html`<span role=${groupRole} ...${aria}>${alt}</span>` : null;
                const size = typeof item.variant === 'string' && ['icon', 'avatar', 'smallFeature', 'mediumFeature', 'largeFeature', 'header'].includes(item.variant)
                    ? item.variant : 'mediumFeature';
                const fit = item.fit === 'scaleDown' ? 'scale-down' : item.fit === 'cover' || item.fit === 'contain' || item.fit === 'none' ? item.fit : 'fill';
                return html`<img key=${id} class=${`a2ui-image a2ui-image-${size}`} src=${src} alt=${alt} ...${aria}
                    loading="lazy" decoding="async" referrerpolicy="no-referrer" style=${{ objectFit: fit }} />`;
            }
            case 'AudioPlayer':
            case 'Video': {
                const kind = item.component === 'AudioPlayer' ? 'audio' : 'video';
                const origin = window.location.origin;
                const source = readA2uiPlaybackUrl(read(item.url), origin, kind);
                const description = text(item.description);
                if (!source) return description || null;
                const poster = kind === 'video' ? readA2uiImageUrl(read(item.posterUrl), origin) : undefined;
                return html`<${A2uiPlayback} key=${JSON.stringify([item.id, source.url, poster])} kind=${kind} source=${source.url}
                    external=${source.external} label=${description} poster=${poster} aria=${aria} />`;
            }
            case 'Card': return html`<div key=${id} role=${groupRole} ...${aria} class="a2ui-card">${child(item.child)}</div>`;
            case 'Row':
            case 'Column': {
                const direction = item.component === 'Row' ? 'row' : 'column';
                const align = typeof item.align === 'string' ? ({ center: 'center', start: 'start', end: 'end', stretch: 'stretch' })[item.align] : undefined;
                const justify = typeof item.justify === 'string' ? ({ center: 'center', start: 'start', end: 'end', stretch: 'stretch', spaceBetween: 'space-between', spaceAround: 'space-around', spaceEvenly: 'space-evenly' })[item.justify] : undefined;
                return html`<div key=${id} role=${groupRole} ...${aria} class=${`a2ui-${direction}`} style=${{ alignItems: align, justifyContent: justify }}>
                    ${Array.isArray(item.children) ? item.children.map(childId => {
                        const weight = components.get(childId)?.weight;
                        return typeof weight === 'number' && weight >= 0
                            ? html`<div key=${childId} class="a2ui-weighted" style=${{ flexGrow: weight }}>${child(childId)}</div>`
                            : child(childId);
                    }) : null}</div>`;
            }
            case 'Modal': {
                const trigger = typeof item.trigger === 'string' ? components.get(item.trigger) : undefined;
                if (!trigger) return null;
                const title = trigger.component === 'Button' && typeof trigger.child === 'string' ? components.get(trigger.child) : trigger;
                const dialogLabel = text(title?.text) || 'Details';
                return html`<${A2uiModal} key=${id} label=${dialogLabel} aria=${aria} buttonTrigger=${trigger.component === 'Button'}
                    renderTrigger=${(open: (event: Event) => void) => renderComponent(trigger.id, depth + 1, open)}
                    renderContent=${() => child(item.content)} />`;
            }
            case 'Tabs': {
                if (!Array.isArray(item.tabs)) return null;
                const tabs = item.tabs.map(tab => ({ child: tab.child, title: text(tab.title) }));
                return html`<${A2uiTabs} key=${id} tabs=${tabs} aria=${aria} renderChild=${child} />`;
            }
            case 'List': {
                const direction = item.direction === 'horizontal' ? 'a2ui-list-horizontal' : '';
                const align = item.align === 'start' || item.align === 'center' || item.align === 'end' ? item.align : 'stretch';
                return html`<div key=${id} role="list" ...${aria} class=${`a2ui-list ${direction}`} style=${{ alignItems: align }}>
                    ${Array.isArray(item.children) && item.children.map(childId => html`<div key=${childId} role="listitem">${child(childId)}</div>`)}</div>`;
            }
            case 'Divider': return html`<hr key=${id} ...${aria} aria-orientation=${item.axis==='vertical' ? 'vertical' : undefined}
                class=${item.axis==='vertical' ? 'a2ui-divider-vertical' : ''} />`;
            case 'Button': {
                const buttonContent = () => renderComponent(item.child, depth + 1, undefined, true);
                const isLink = readA2uiLinkTarget(item.action) !== undefined;
                const functionBlocked = !isLink && !!readClassicActionFunction(item.action) && block.owner !== 'agent';
                const link = readA2uiLink(item.action, read);
                const buttonChild = typeof item.child === 'string' ? components.get(item.child) : undefined;
                const name = buttonChild?.component === 'Icon' ? read(buttonChild.name) : undefined;
                const buttonLabel = buttonChild?.component !== 'Icon' ? undefined : typeof name === 'string' && Object.hasOwn(a2uiIconPaths, name)
                    ? name.replace(/([A-Z])/g, ' $1').replace(/^./, char => char.toUpperCase()) : link ? 'Open link' : 'Action';
                const buttonClass = `a2ui-button a2ui-button-${item.variant || 'default'}`;
                if (link && !disabled && !invalid && !checksPending) return checked(html`<a key=${id} class=${buttonClass} href=${link} aria-label=${buttonLabel} ...${aria}
                    aria-haspopup=${openModal ? 'dialog' : undefined} onClick=${openModal}
                    target="_blank" rel="noopener noreferrer">${buttonContent()}</a>`);
                if (block.owner === 'login' && (id === 'continue' || id === 'check')) return null;
                return checked(html`<button key=${id} type="button" class=${buttonClass}
                disabled=${disabled} aria-disabled=${pending || disabled || invalid || checksPending || isLink || functionBlocked} aria-label=${buttonLabel} ...${aria} aria-haspopup=${openModal ? 'dialog' : undefined}
                onClick=${(event: Event) => {
                    if (pending || disabled || invalid || checksPending || isLink || functionBlocked) return;
                    openModal?.(event);
                    void submit(event, item.id);
                }}>${buttonContent()}</button>`);
            }
            case 'TextField': {
                if (block.owner === 'login' && item.variant === 'obscured') return checked(html`<label key=${id} class="a2ui-field">${label}
                    <input ref=${privateInput} ...${aria} disabled=${disabled || pending} type="password" autocomplete="off" maxlength="4096" placeholder=${text(item.placeholder)} />
                </label>`);
                const value = text(item.value);
                const placeholder = text(item.placeholder);
                const onInput = (event: Event) => edit(item.id, path, (event.currentTarget as HTMLInputElement).value);
                if (item.variant==='obscured') {
                    const noticeId=`${errorId}-mask`;
                    return checked(html`<div key=${id} class="a2ui-field">
                        <label class="a2ui-field">${label}<input type="password" autocomplete="off" ...${aria} aria-describedby=${noticeId}
                            disabled=${locked} value=${value} placeholder=${placeholder} maxLength="4096" onInput=${onInput} /></label>
                        <span id=${noticeId} class="a2ui-caption">Masked on screen only. Do not enter passwords or keys; this value can be sent to the agent and saved in chat.</span>
                    </div>`);
                }
                return checked(html`<label key=${id} class="a2ui-field">${label}${item.variant === 'longText'
                    ? html`<textarea ...${aria} disabled=${locked} value=${value} placeholder=${placeholder} maxLength="4096" onInput=${onInput}></textarea>`
                    : html`<input type=${item.variant === 'number' ? 'number' : 'text'} ...${aria} disabled=${locked} value=${value}
                        placeholder=${placeholder} maxLength="4096" onInput=${onInput} />`}</label>`);
            }
            case 'DateTimeInput': {
                const type = a2uiDateTimeType(item);
                if (!type) return null;
                const value = a2uiDateTimeDisplay(read(item.value), type) ?? '';
                const min = a2uiDateTimeDisplay(read(item.min), type);
                const max = a2uiDateTimeDisplay(read(item.max), type);
                return checked(html`<label key=${id} class="a2ui-field">${label}
                    <input type=${type} aria-label=${label || (type === 'datetime-local' ? 'Date and time' : type === 'date' ? 'Date' : 'Time')} ...${aria}
                        disabled=${locked} min=${min} max=${max} step=${type === 'date' ? undefined : 'any'} value=${value}
                        onChange=${(event: Event) => edit(item.id, path, (event.currentTarget as HTMLInputElement).value)} />
                </label>`);
            }
            case 'Slider': {
                const range = a2uiSliderRange(item);
                if (!range) return null;
                const value = read(item.value);
                return checked(html`<label key=${id} class="a2ui-field">${label}
                    <input type="range" aria-label=${label || 'Value'} ...${aria} disabled=${locked} min=${range.min} max=${range.max}
                        step=${range.step ?? 'any'} value=${typeof value === 'number' ? value : range.min}
                        onInput=${(event: Event) => edit(item.id, path, (event.currentTarget as HTMLInputElement).valueAsNumber)} />
                </label>`);
            }
            case 'CheckBox': return checked(html`<label key=${id} class="a2ui-checkbox"><input type="checkbox" ...${aria} disabled=${locked}
                checked=${coerceA2uiBoolean(read(item.value))} onChange=${(event: Event) => edit(item.id, path, (event.currentTarget as HTMLInputElement).checked)} />${label}</label>`);
            case 'ChoicePicker': {
                const selected = read(item.value);
                const choices = Array.isArray(selected) ? selected : [];
                const multiple = item.variant === 'multipleSelection';
                if (!block.owner || block.owner === 'agent' || item.displayStyle !== undefined || item.filterable === true) {
                    const options = Array.isArray(item.options) ? item.options.map(option => ({ value: option.value, label: text(option.label) })) : [];
                    return checked(html`<${A2uiChoicePicker} key=${id} label=${label} aria=${aria} options=${options} selected=${choices} multiple=${multiple}
                        chips=${item.displayStyle === 'chips'} filterable=${item.filterable === true} disabled=${locked}
                        onChange=${(value: string[]) => edit(item.id, path, value)} />`);
                }
                return checked(html`<label key=${id} class="a2ui-field">${label}
                    <select multiple=${multiple} disabled=${locked} aria-label=${label || 'Choose an option'} ...${aria}
                        value=${multiple ? undefined : choices[0] ?? ''} onChange=${(event: Event) => edit(item.id, path,
                            Array.from((event.currentTarget as HTMLSelectElement).selectedOptions, option => option.value).filter(Boolean))}>
                        ${!multiple && html`<option value="">Select an option</option>`}
                        ${Array.isArray(item.options) && item.options.map(option => html`<option key=${option.value} value=${option.value}
                            selected=${multiple ? choices.includes(option.value) : undefined}>${text(option.label)}</option>`)}
                    </select></label>`);
            }
            default: return null;
        }
    }
    return html`<section class="a2ui-surface" data-no-session-dashboard-shortcut="" aria-busy=${pending || valueFunctions.busy} onClick=${(event: Event) => event.stopPropagation()}>
        ${renderComponent('root', 0) || block.fallback_text}
        ${totp && !disabled && html`<${A2uiTotpDialog} presentation=${totp.presentation} dismiss=${dismissTotp}
            confirm=${async (code: string) => {
                const reply = await onSubmit!({ ...totp.request, private_code: code });
                if ((reply as { totp_result?: string } | undefined)?.totp_result !== 'success') throw new Error('TOTP was not confirmed.');
            }} />`}
        ${error && html`<p class="a2ui-error" role="alert">${error}</p>`}
    </section>`;
}
