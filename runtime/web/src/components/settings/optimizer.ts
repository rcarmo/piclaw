import {html,useCallback,useEffect,useState} from '../../vendor/preact-htm.js';
import {useSettingsFieldIds} from './field-ids.js';
import {NumberStepper} from './number-stepper.js';
const endpoint='/agent/addons/api/token-optimizer/config';
const parts=(path:string)=>/^(agents|oversightAgents)\./.test(path)?[path.slice(0,path.indexOf('.')),path.slice(path.indexOf('.')+1)]:path.split('.');
const modes=[['off','Off'],['observe','Observe — record only'],['active','Active']];
export function OptimizerSection(){
 const id=useSettingsFieldIds('optimizer'),[data,setData]=useState<any>(null),[draft,setDraft]=useState<any>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false),[notice,setNotice]=useState('');
 const accept=useCallback(value=>{if(!value?.ok||!value.config)throw Error(value?.error||'Optimiser settings unavailable');setData(value);setDraft(structuredClone(value.config));},[]);
 const load=useCallback(async()=>{try{const response=await fetch(endpoint),value=await response.json();if(!response.ok)throw Error(value?.error||'Optimiser settings unavailable');accept(value);setError('');}catch(e){setError(e instanceof Error?e.message:String(e));}},[accept]);
 useEffect(()=>{void load();},[load]);
 const patch=(path:string,value:any)=>setDraft(previous=>{const next=structuredClone(previous),keys=parts(path);let current=next;for(const part of keys.slice(0,-1))current=current[part]??={};current[keys.at(-1)!]=value;return next;});
 const write=async(body:any,message:string)=>{setBusy(true);setError('');setNotice('');try{const response=await fetch(endpoint,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}),value=await response.json();if(!response.ok||value.error)throw Error(value.error||'Settings changed; reload before saving');accept(value);setNotice(message);}catch(e){setError(e instanceof Error?e.message:String(e));}finally{setBusy(false);}};
 const save=()=>write({config:draft,expectedRevision:data.revision},'Saved. Changes apply at the next eligible SDK boundary.');
 const action=(agentId:string,name:string)=>{if(name==='forget_outputs'&&!confirm('Forget retained output copies? Original committed history is unchanged.'))return;return write({action:name,agentId},'Action completed.');};
 const field=(label:string,path:string,options:any[])=>html`<div class="settings-row settings-dense-row"><label for=${id(path)}>${label}</label><select id=${id(path)} value=${parts(path).reduce((value,key)=>value?.[key],draft)??''} disabled=${busy} onChange=${event=>patch(path,event.currentTarget.value)}>${options.map(([value,caption])=>html`<option value=${value}>${caption}</option>`)}</select></div>`;
 const check=(label:string,path:string,hint='')=>html`<div class="settings-row settings-dense-row settings-dense-row-checkbox"><label class="settings-dense-check" for=${id(path)}><input id=${id(path)} type="checkbox" checked=${Boolean(parts(path).reduce((value,key)=>value?.[key],draft))} disabled=${busy} onChange=${event=>patch(path,event.currentTarget.checked)} /><span>${label}</span></label>${hint&&html`<span class="settings-hint">${hint}</span>`}</div>`;
 const number=(label:string,path:string,min=1,max=100000)=>html`<div class="settings-row settings-dense-row"><label for=${id(path)}>${label}</label><${NumberStepper} id=${id(path)} label=${label} value=${parts(path).reduce((value,key)=>value?.[key],draft)} min=${min} max=${max} disabled=${busy} onChange=${value=>patch(path,value)} /></div>`;
 const model=(label:string,path:string,type='chat')=>{const value=parts(path).reduce((value,key)=>value?.[key],draft);return html`<div class="settings-row settings-dense-row"><label for=${id(path)}>${label}</label><select id=${id(path)} value=${value?JSON.stringify(value):''} disabled=${busy} onChange=${event=>patch(path,event.currentTarget.value?JSON.parse(event.currentTarget.value):null)}><option value="">None / shared default</option>${(data.models||[]).filter(model=>(model.type||'chat')===type).map(model=>html`<option value=${JSON.stringify({provider:model.provider,id:model.id})}>${model.provider}/${model.id}</option>`)}</select></div>`;};
 if(!draft)return html`<div class="settings-section"><p class="settings-hint" role="status">${error||'Loading optimisation settings…'}</p><button type="button" onClick=${load}>Retry</button></div>`;
 const policy=draft.policy;
 return html`<div class="settings-section settings-dense-form">
  ${error&&html`<p class="settings-hint" role="alert">${error} <button type="button" disabled=${busy} onClick=${load}>Reload saved settings</button></p>`}
  ${notice&&html`<p class="settings-hint" role="status">${notice}</p>`}
  <h3>Token optimisation</h3><p class="settings-hint">Off by default. First enable starts in Observe. Optimisation never grants tool permissions or changes accepted history.</p>
  <div class="settings-row settings-dense-row"><label for=${id('mode')}>Optimisation mode</label><select id=${id('mode')} value=${policy.enabled?policy.mode:'off'} disabled=${busy} onChange=${event=>{const value=event.currentTarget.value;setDraft(previous=>({...previous,policy:{...previous.policy,enabled:value!=='off',mode:value}}));}}>${modes.map(([value,label])=>html`<option value=${value}>${label}</option>`)}</select></div>
  ${check('Use models in optimisation Observe','policy.inferenceInObserve','Off means Observe makes no paid optimisation calls.')}
  ${check('Reduce test/compiler output','policy.reduceOutputs','Keeps original values for scripts and retrieval.')}
  ${check('Retain long tool outputs','policy.offloadOutputs')}
  ${check('Model-written output summaries','policy.outputSummaries','Optional inference uses the selected model and shared optimisation limits.')}
  ${field('Repository facts','policy.microSkills',[['off','Off'],['envfacts','From tool evidence'],['distiller','Model-written'],['both','Both']])}
  ${field('Unused tools','policy.pruning',[['off','Off'],['propose','Suggest hiding'],['auto','Hide eligible tools automatically']])}
  ${field('Task-aware tool judge','policy.toolJudge',[['none','Off'],['generative','Generation model'],['classifier','Classifier'],['cascade','Classifier then generation model']])}
  ${check('Pick tools automatically before idle prompts','policy.autoToolPicks')}
  <h3>Task oversight</h3><p class="settings-hint">Independent of token optimisation. Advice only targets the current task; it cannot start an idle run or declare work complete.</p>
  ${field('Oversight mode','policy.oversightMode',modes)}
  ${check('Check task progress','policy.goalChecks')}
  ${field('Loop checks','policy.loop',[['off','Off'],['rules','Local rules'],['judge','Model-assisted']])}
  ${field('Loop judge','policy.judge',[['generative','Generation model'],['classifier','Classifier'],['cascade','Classifier then generation model']])}
  ${field('When to step in','policy.level',[['conservative','Patiently'],['default','Normally'],['aggressive','Early']])}
  ${check('Allow model calls in oversight Observe','policy.oversightInferenceInObserve')}
  ${check('Share the active Plan item with the judge','policy.sharePlanWithJudge','Explicit opt-in. Sends one bounded, redacted current-task item, not the whole Plan or user prompt.')}
  ${number('Maximum nudges per prompt','policy.redirects',1,10)}
  <details><summary>Models, limits and local call savers</summary>
   ${model('Shared generation model','policy.generativeModel')}${model('Shared classifier model','policy.classifierModel','classifier')}
   ${[['proposer','Fact writer','chat'],['loopJudge','Loop judge','chat'],['writer','Nudge writer','chat'],['toolJudge','Tool judge','chat'],['loopClassifier','Loop classifier','classifier'],['toolClassifier','Tool classifier','classifier']].map(([key,label,type])=>model(label,`policy.models.${key}`,type))}
   ${number('Calls per Agent session','policy.budget.callsPerSession')}${number('Calls per day','policy.budget.callsPerDay')}${number('Maximum response tokens','policy.budget.maxOutputTokens',1,32000)}${number('Call deadline (ms)','policy.budget.deadlineMs',1,180000)}
   <div class="settings-row settings-dense-row"><label for=${id('cost-cap')}>Optional model cost per session</label><input id=${id('cost-cap')} type="number" min="0" step="0.01" value=${policy.budget.maxCostPerSession??''} disabled=${busy} onChange=${event=>patch('policy.budget.maxCostPerSession',event.currentTarget.value===''?null:Number(event.currentTarget.value))} /></div>
   ${number('Offload threshold bytes','policy.offload.bytes',1024,262144)}${number('Offload threshold lines','policy.offload.lines',10,5000)}${number('Retained-output days','policy.offload.retentionDays',1,30)}
   ${number('Maximum learned facts','policy.maxFacts',1,100)}${number('Fact context token limit','policy.maxFactTokens',1,16000)}${number('Fact proposal cadence','policy.proposeEvery',1,1000)}
   ${[['localLoop','Local loop classifier'],['authorizeLocalStuck','Let validated local classifier identify stuck runs'],['toolPrefilter','Local tool prefilter'],['localToolDrops','Allow validated local tool drops'],['reuse','Reuse identical judgements'],['templates','Template nudges'],['novelty','Propose facts only on changed evidence'],['compact','Compact repeated failures before judging']].map(([key,label])=>check(label,`policy.savers.${key}`))}
   ${number('Model audit percentage','policy.savers.auditPercent',0,20)}
  </details>
  <details><summary>Workspace and Agent overrides</summary>
   <p class="settings-hint">An Off ancestor cannot be overridden by an Agent. Optimisation and oversight overrides are independent.</p>
   ${field('This workspace: optimisation',`workspaces.${data.workspaceId}`,[['inherit','Inherit'],...modes])}${field('This workspace: oversight',`oversightWorkspaces.${data.workspaceId}`,[['inherit','Inherit'],...modes])}
   ${(data.agents||[]).map(agent=>{const key=JSON.stringify([data.workspaceId,agent.id]);return html`<div class="settings-section"><strong>${agent.label}</strong>${field('Agent optimisation',`agents.${key}`,[['inherit','Inherit'],...modes])}${field('Agent oversight',`oversightAgents.${key}`,[['inherit','Inherit'],...modes])}</div>`;})}
  </details>
  <div class="settings-row"><button type="button" disabled=${busy} onClick=${save}>${busy?'Saving…':'Save optimisation and oversight'}</button><button type="button" disabled=${busy} onClick=${load}>Reload</button></div>
  <h3>Current sessions</h3>
  ${(data.status||[]).map(state=>html`<details><summary>${state.label} · ${state.accounting?.calls||0} model calls</summary><p class="settings-hint">${state.lastError||''}</p><p class="settings-hint">Hidden: ${(state.hiddenTools||[]).join(', ')||'none'} · Suggested: ${(state.proposedTools||[]).join(', ')||'none'}</p><ul>${(state.facts||[]).map(fact=>html`<li>${fact.claim||fact.id}</li>`)}</ul><div class="settings-row"><button type="button" disabled=${busy} onClick=${()=>action(state.agentId,'restore')}>Restore hidden tools</button><button type="button" disabled=${busy} onClick=${()=>action(state.agentId,'remove_context')}>Remove learned context</button><button type="button" disabled=${busy} onClick=${()=>action(state.agentId,'stale_facts')}>Mark facts stale</button><button type="button" disabled=${busy} onClick=${()=>action(state.agentId,'retry_models')}>Retry model calls</button><button type="button" disabled=${busy} onClick=${()=>action(state.agentId,'forget_outputs')}>Forget retained copies</button></div></details>`)}
 </div>`;
}
