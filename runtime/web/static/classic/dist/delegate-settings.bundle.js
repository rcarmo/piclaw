function H(P){let{html:s,useState:r,useEffect:T,useCallback:E,registerSettingsPane:z,notifySettingsPanesChanged:A}=P,N="/agent/addons/api/delegate",j=`
@layer delegate-settings-fallback {
  .delegate-settings { padding: .5rem 0; min-width: 0; }
  .delegate-settings .settings-addon-section { margin-bottom: 20px; min-width: 0; }
  .delegate-settings h4 { margin: 1.2rem 0 .45rem; font-size: .9rem; color: var(--text-primary); border-bottom: 1px solid var(--border-color); padding-bottom: .3rem; }
  .delegate-settings .settings-addon-field { display: flex; flex-direction: column; align-items: flex-start; gap: 6px; min-width: 0; margin-bottom: 12px; }
  .delegate-settings .settings-addon-label { font-size: .84rem; font-weight: 500; color: var(--text-secondary); }
  .delegate-settings .settings-addon-control { box-sizing: border-box; width: 280px; min-width: 0; max-width: 100%; padding: 6px 10px; background: var(--bg-secondary); color: var(--text-primary); border: 1px solid var(--border-color); border-radius: 6px; font-size: .84rem; }
  .delegate-settings .settings-addon-help { font-size: .78rem; color: var(--text-secondary); line-height: 1.45; overflow-wrap: anywhere; }
  .delegate-settings .settings-addon-control-group, .delegate-settings .settings-addon-actions { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; min-width: 0; max-width: 100%; }
  .delegate-settings .settings-addon-control-group > .settings-addon-control { flex: 1 1 160px; }
  .delegate-settings .settings-addon-error { color: var(--danger-color); overflow-wrap: anywhere; }
  .delegate-settings .settings-addon-status { color: var(--text-secondary); overflow-wrap: anywhere; }
  .delegate-settings button { padding: 4px 10px; border: 1px solid var(--border-color); border-radius: 6px; background: var(--bg-secondary); color: var(--text-primary); cursor: pointer; font-size: .82rem; }
  .delegate-settings :is(button, input, textarea):focus-visible { outline: 2px solid var(--accent-color); outline-offset: 2px; }
  .delegate-settings :is(button, input, textarea):disabled { opacity: .5; }
  @media (max-width: 640px) {
    .delegate-settings .settings-addon-field { align-items: stretch; }
    .delegate-settings .settings-addon-control { width: 100%; }
  }
}
/* Pane-owned layout and list limits remain separate from host control styling. */
.delegate-settings .delegate-scroll { overflow: auto; max-height: 18rem; border: 1px solid var(--border-color); border-radius: 6px; overflow-wrap: anywhere; }
.delegate-settings .delegate-models { margin: 0; padding: 0; list-style: none; }
.delegate-settings .delegate-model { display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: center; gap: .5rem; padding: .4rem .5rem; border-bottom: 1px solid var(--border-color); }
.delegate-settings .delegate-model button { min-height: 34px; min-width: 34px; }
.delegate-settings .delegate-model button[aria-disabled=true] { opacity: .5; cursor: default; }
.delegate-settings .delegate-tier { margin: 0; padding: .35rem .5rem; background: var(--bg-secondary); font-size: .82rem; }
`;async function x(n,c={}){let o=await fetch(`/agent/addons/api/delegate/${n}`,c),d=await o.json().catch(()=>({}));if(!o.ok||d?.ok===!1)throw Error(d?.error||`HTTP ${o.status}`);return d}function I(){let[n,c]=r(null),[o,d]=r(""),[g,p]=r(!1),[S,i]=r(""),[m,u]=r(!1),h=E(async(e=!1,t)=>{p(!0),i(""),u(!1);try{let a=await x("models",e?{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({refresh:!0}),signal:t}:{signal:t});if(t?.aborted)return;if(c(a),e)i("Model list refreshed.")}catch(a){if(!t?.aborted)u(!0),i(a instanceof Error?a.message:"Could not load Delegate models.")}finally{if(!t?.aborted)p(!1)}},[]);T(()=>{let e=new AbortController;return h(!1,e.signal),()=>e.abort()},[h]);async function R(e,t,a){if(g)return;p(!0),i(""),u(!1);try{if(c(await x("config",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({[t?"add_model":"remove_model"]:e})})),!t&&a.ownerDocument.activeElement===a)a.closest(".delegate-settings")?.querySelector("#delegate-model-search")?.focus({preventScroll:!0});i(`${t?"Added":"Removed"} ${e}.`)}catch(l){u(!0),i(l instanceof Error?l.message:"Could not change the Delegate whitelist.")}finally{p(!1)}}if(!n)return s`<div class="delegate-settings"><style>${`
@layer delegate-settings-fallback {
  .delegate-settings { padding: .5rem 0; min-width: 0; }
  .delegate-settings .settings-addon-section { margin-bottom: 20px; min-width: 0; }
  .delegate-settings h4 { margin: 1.2rem 0 .45rem; font-size: .9rem; color: var(--text-primary); border-bottom: 1px solid var(--border-color); padding-bottom: .3rem; }
  .delegate-settings .settings-addon-field { display: flex; flex-direction: column; align-items: flex-start; gap: 6px; min-width: 0; margin-bottom: 12px; }
  .delegate-settings .settings-addon-label { font-size: .84rem; font-weight: 500; color: var(--text-secondary); }
  .delegate-settings .settings-addon-control { box-sizing: border-box; width: 280px; min-width: 0; max-width: 100%; padding: 6px 10px; background: var(--bg-secondary); color: var(--text-primary); border: 1px solid var(--border-color); border-radius: 6px; font-size: .84rem; }
  .delegate-settings .settings-addon-help { font-size: .78rem; color: var(--text-secondary); line-height: 1.45; overflow-wrap: anywhere; }
  .delegate-settings .settings-addon-control-group, .delegate-settings .settings-addon-actions { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; min-width: 0; max-width: 100%; }
  .delegate-settings .settings-addon-control-group > .settings-addon-control { flex: 1 1 160px; }
  .delegate-settings .settings-addon-error { color: var(--danger-color); overflow-wrap: anywhere; }
  .delegate-settings .settings-addon-status { color: var(--text-secondary); overflow-wrap: anywhere; }
  .delegate-settings button { padding: 4px 10px; border: 1px solid var(--border-color); border-radius: 6px; background: var(--bg-secondary); color: var(--text-primary); cursor: pointer; font-size: .82rem; }
  .delegate-settings :is(button, input, textarea):focus-visible { outline: 2px solid var(--accent-color); outline-offset: 2px; }
  .delegate-settings :is(button, input, textarea):disabled { opacity: .5; }
  @media (max-width: 640px) {
    .delegate-settings .settings-addon-field { align-items: stretch; }
    .delegate-settings .settings-addon-control { width: 100%; }
  }
}
/* Pane-owned layout and list limits remain separate from host control styling. */
.delegate-settings .delegate-scroll { overflow: auto; max-height: 18rem; border: 1px solid var(--border-color); border-radius: 6px; overflow-wrap: anywhere; }
.delegate-settings .delegate-models { margin: 0; padding: 0; list-style: none; }
.delegate-settings .delegate-model { display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: center; gap: .5rem; padding: .4rem .5rem; border-bottom: 1px solid var(--border-color); }
.delegate-settings .delegate-model button { min-height: 34px; min-width: 34px; }
.delegate-settings .delegate-model button[aria-disabled=true] { opacity: .5; cursor: default; }
.delegate-settings .delegate-tier { margin: 0; padding: .35rem .5rem; background: var(--bg-secondary); font-size: .82rem; }
`}</style>
    <p role=${m?"alert":"status"}>${S||"Loading Delegate models…"}</p>
    ${m&&s`<button type="button" disabled=${g} onClick=${()=>h()}>Retry</button>`}
  </div>`;let b=new Set(n.config.approved_models),y=new Map(n.available.map((e)=>[e.id,e])),C=new Set(n.candidates.map((e)=>e.id)),M=new Map(n.models.map((e)=>[e.id,e])),v=o.trim().toLowerCase().split(/\s+/).filter(Boolean),f=[...M.values()].filter((e)=>{let t=`${e.id} ${e.name??""}`.toLowerCase();return v.every((a)=>t.includes(a))}).sort((e,t)=>e.id<t.id?-1:e.id===t.id?0:1),k=[...b].filter((e)=>!C.has(e)),w=(e,t,a=!1)=>{let l=b.has(e),D=g||!a&&(l||!y.has(e));return s`<li key=${e} class="delegate-model">
      <span><code>${e}</code><br /><span class="settings-addon-help">${t}</span></span>
      ${(a||y.has(e))&&s`<button type="button" aria-disabled=${D} onClick=${(L)=>{if(!D)R(e,!a,L.currentTarget)}}
        aria-label=${a?`Remove ${e} from whitelist`:l?`${e} is on the whitelist`:`Add ${e} to whitelist`}
        title=${a?"Remove from whitelist":l?"Already on the whitelist":"Add to whitelist"}>${a?"−":l?"✓":"+"}</button>`}
    </li>`};return s`<div class="delegate-settings" aria-busy=${g}><style>${`
@layer delegate-settings-fallback {
  .delegate-settings { padding: .5rem 0; min-width: 0; }
  .delegate-settings .settings-addon-section { margin-bottom: 20px; min-width: 0; }
  .delegate-settings h4 { margin: 1.2rem 0 .45rem; font-size: .9rem; color: var(--text-primary); border-bottom: 1px solid var(--border-color); padding-bottom: .3rem; }
  .delegate-settings .settings-addon-field { display: flex; flex-direction: column; align-items: flex-start; gap: 6px; min-width: 0; margin-bottom: 12px; }
  .delegate-settings .settings-addon-label { font-size: .84rem; font-weight: 500; color: var(--text-secondary); }
  .delegate-settings .settings-addon-control { box-sizing: border-box; width: 280px; min-width: 0; max-width: 100%; padding: 6px 10px; background: var(--bg-secondary); color: var(--text-primary); border: 1px solid var(--border-color); border-radius: 6px; font-size: .84rem; }
  .delegate-settings .settings-addon-help { font-size: .78rem; color: var(--text-secondary); line-height: 1.45; overflow-wrap: anywhere; }
  .delegate-settings .settings-addon-control-group, .delegate-settings .settings-addon-actions { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; min-width: 0; max-width: 100%; }
  .delegate-settings .settings-addon-control-group > .settings-addon-control { flex: 1 1 160px; }
  .delegate-settings .settings-addon-error { color: var(--danger-color); overflow-wrap: anywhere; }
  .delegate-settings .settings-addon-status { color: var(--text-secondary); overflow-wrap: anywhere; }
  .delegate-settings button { padding: 4px 10px; border: 1px solid var(--border-color); border-radius: 6px; background: var(--bg-secondary); color: var(--text-primary); cursor: pointer; font-size: .82rem; }
  .delegate-settings :is(button, input, textarea):focus-visible { outline: 2px solid var(--accent-color); outline-offset: 2px; }
  .delegate-settings :is(button, input, textarea):disabled { opacity: .5; }
  @media (max-width: 640px) {
    .delegate-settings .settings-addon-field { align-items: stretch; }
    .delegate-settings .settings-addon-control { width: 100%; }
  }
}
/* Pane-owned layout and list limits remain separate from host control styling. */
.delegate-settings .delegate-scroll { overflow: auto; max-height: 18rem; border: 1px solid var(--border-color); border-radius: 6px; overflow-wrap: anywhere; }
.delegate-settings .delegate-models { margin: 0; padding: 0; list-style: none; }
.delegate-settings .delegate-model { display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: center; gap: .5rem; padding: .4rem .5rem; border-bottom: 1px solid var(--border-color); }
.delegate-settings .delegate-model button { min-height: 34px; min-width: 34px; }
.delegate-settings .delegate-model button[aria-disabled=true] { opacity: .5; cursor: default; }
.delegate-settings .delegate-tier { margin: 0; padding: .35rem .5rem; background: var(--bg-secondary); font-size: .82rem; }
`}</style>
    <section class="settings-addon-section">
      <h4 id="delegate-available-label">Available models</h4>
      <p class="settings-addon-help" id="delegate-search-help">Search by provider, model ID or display name. Use + to approve an exact model. New models are never approved automatically.</p>
      <div class="settings-addon-field">
        <label class="settings-addon-label" for="delegate-model-search">Search models</label>
        <div class="settings-addon-control-group">
          <input id="delegate-model-search" class="settings-addon-control" type="search" aria-controls="delegate-available"
            aria-describedby="delegate-search-help" placeholder="Search models…" value=${o} onInput=${(e)=>d(e.currentTarget.value)} />
          <button type="button" disabled=${g} onClick=${()=>h(!0)}>Refresh models</button>
        </div>
      </div>
      <p class="settings-addon-help" role="status">${f.length} ${f.length===1?"model":"models"}${v.length?" found":" available"}.</p>
      <div class="delegate-scroll" id="delegate-available" role="region" aria-labelledby="delegate-available-label" tabIndex=${0}>
        ${f.length?s`<ul class="delegate-models">${f.map((e)=>{let t=y.get(e.id);return w(e.id,t?`Tier ${t.tier} · ${e.name||t.family}`:e.reason??"Unavailable for Delegate")})}</ul>`:s`<p class="settings-addon-help">${v.length?"No models match your search.":"No models are currently available."}</p>`}
      </div>
    </section>
    <section class="settings-addon-section">
      <h4 id="delegate-whitelist-label">Delegate whitelist</h4>
      <p class="settings-addon-help">${b.size} approved · ${C.size} ready. Delegate still requires a currently available, classified model.</p>
      ${b.size?s`<div class="delegate-scroll" role="region" aria-labelledby="delegate-whitelist-label" tabIndex=${0}>
        ${[1,2,3,4,5].map((e)=>{let t=n.candidates.filter((a)=>a.tier===e);return t.length?s`<h5 class="delegate-tier">Tier ${e}</h5><ul class="delegate-models">
            ${t.map((a)=>w(a.id,`${a.family} · ${a.classificationRule}`,!0))}</ul>`:null})}
        ${k.length?s`<h5 class="delegate-tier">Unavailable</h5><ul class="delegate-models">
          ${k.map((e)=>w(e,M.get(e)?.reason??"Not currently available",!0))}</ul>`:null}
      </div>`:s`<p class="settings-addon-help">No models are approved.</p>`}
    </section>
    <div class=${m?"settings-addon-error":"settings-addon-status"} role=${m?"alert":"status"}>${S}</div>
  </div>`}z({id:"delegate",label:"Delegate",icon:s`<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><path d="M7 7h10v10H7z"/><path d="M4 4h4m8 0h4M4 20h4m8 0h4"/></svg>`,component:I,order:30.25}),A()}export{H as registerDelegateSettings};

//# debugId=A0B540E53232B82C64756E2164756E21
//# sourceMappingURL=delegate-settings.bundle.js.map
