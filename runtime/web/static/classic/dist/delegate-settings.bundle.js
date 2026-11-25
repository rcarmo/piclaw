function q(A){let{html:s,useState:i,useEffect:D,useCallback:P,registerSettingsPane:R,notifySettingsPanesChanged:I}=A,B="/agent/addons/api/delegate",O=`
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
`;function x(n,l){return n<l?-1:n===l?0:1}async function S(n,l={}){let r=await fetch(`/agent/addons/api/delegate/${n}`,l),g=await r.json().catch(()=>({}));if(!r.ok||g?.ok===!1)throw Error(g?.error||`HTTP ${r.status}`);return g}function N(){let[n,l]=i(null),[r,g]=i(""),[k,z]=i("name"),[c,p]=i(!1),[E,d]=i(""),[m,u]=i(!1),h=P(async(e=!1,a)=>{p(!0),d(""),u(!1);try{let t=await S("models",e?{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({refresh:!0}),signal:a}:{signal:a});if(a?.aborted)return;if(l(t),e)d("Model list refreshed.")}catch(t){if(!a?.aborted)u(!0),d(t instanceof Error?t.message:"Could not load Delegate models.")}finally{if(!a?.aborted)p(!1)}},[]);D(()=>{let e=new AbortController;return h(!1,e.signal),()=>e.abort()},[h]);async function L(e,a,t){if(c)return;p(!0),d(""),u(!1);try{if(l(await S("config",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({[a?"add_model":"remove_model"]:e})})),!a&&t.ownerDocument.activeElement===t)t.closest(".delegate-settings")?.querySelector("#delegate-model-search")?.focus({preventScroll:!0});d(`${a?"Added":"Removed"} ${e}.`)}catch(o){u(!0),d(o instanceof Error?o.message:"Could not change the Delegate whitelist.")}finally{p(!1)}}if(!n)return s`<div class="delegate-settings"><style>${`
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
`}</style>
    <p role=${m?"alert":"status"}>${E||"Loading Delegate models…"}</p>
    ${m&&s`<button type="button" disabled=${c} onClick=${()=>h()}>Retry</button>`}
  </div>`;let b=new Set(n.config.approved_models),y=new Map(n.available.map((e)=>[e.id,e.tier])),f=new Map(n.candidates.map((e)=>[e.id,e.tier])),_=new Map(n.models.map((e)=>[e.id,e])),w=r.trim().toLowerCase().split(/\s+/).filter(Boolean),v=[..._.values()].filter((e)=>{let a=`${e.id} ${e.name??""}`.toLowerCase();return w.every((t)=>a.includes(t))}).sort((e,a)=>x(e.id,a.id)),H=[...b].sort((e,a)=>{if(k==="rank"){let t=f.get(e)??Number.MAX_SAFE_INTEGER,o=f.get(a)??Number.MAX_SAFE_INTEGER;if(t!==o)return t-o}return x(e,a)}),M=(e)=>e===void 0?"Not currently available":`Rank ${e}`,C=(e,a,t=!1)=>{let o=b.has(e),T=c||!t&&(o||!y.has(e));return s`<li key=${e} class="delegate-model">
      <span><code>${e}</code>${a&&s`<br /><span class="settings-addon-help">${a}</span>`}</span>
      ${(t||y.has(e))&&s`<button type="button" aria-disabled=${T} onClick=${(j)=>{if(!T)L(e,!t,j.currentTarget)}}
        aria-label=${t?`Remove ${e} from whitelist`:o?`${e} is on the whitelist`:`Add ${e} to whitelist`}
        title=${t?"Remove from whitelist":o?"Already on the whitelist":"Add to whitelist"}>${t?"−":o?"✓":"+"}</button>`}
    </li>`};return s`<div class="delegate-settings" aria-busy=${c}><style>${`
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
`}</style>
    <section class="settings-addon-section">
      <h4 id="delegate-available-label">Available models</h4>
      <p class="settings-addon-help" id="delegate-search-help">Search by provider, model ID or display name. Use + to approve an exact model. New models are never approved automatically.</p>
      <div class="settings-addon-field">
        <label class="settings-addon-label" for="delegate-model-search">Search models</label>
        <div class="settings-addon-control-group">
          <input id="delegate-model-search" class="settings-addon-control" type="search" aria-controls="delegate-available"
            aria-describedby="delegate-search-help" placeholder="Search models…" value=${r} onInput=${(e)=>g(e.currentTarget.value)} />
          <button type="button" disabled=${c} onClick=${()=>h(!0)}>Refresh models</button>
        </div>
      </div>
      <p class="settings-addon-help" role="status">${v.length} ${v.length===1?"model":"models"}${w.length?" found":" available"}.</p>
      <div class="delegate-scroll" id="delegate-available" role="region" aria-labelledby="delegate-available-label" tabIndex=${0}>
        ${v.length?s`<ul class="delegate-models">${v.map((e)=>C(e.id,e.reason??M(y.get(e.id))))}</ul>`:s`<p class="settings-addon-help">${w.length?"No models match your search.":"No models are currently available."}</p>`}
      </div>
    </section>
    <section class="settings-addon-section">
      <h4 id="delegate-whitelist-label">Delegate whitelist</h4>
      <p class="settings-addon-help">${b.size} approved · ${f.size} ready. Only available models can run.</p>
      ${b.size?s`
        <div class="settings-addon-field">
          <label class="settings-addon-label" for="delegate-whitelist-sort">Sort whitelist</label>
          <select id="delegate-whitelist-sort" class="settings-addon-control" value=${k}
            onChange=${(e)=>z(e.currentTarget.value==="rank"?"rank":"name")}>
            <option value="name">Model name (A–Z)</option>
            <option value="rank">Rank (low to high)</option>
          </select>
        </div>
        <div class="delegate-scroll" role="region" aria-labelledby="delegate-whitelist-label" tabIndex=${0}>
          <ul class="delegate-models">${H.map((e)=>C(e,M(f.get(e)),!0))}</ul>
        </div>`:s`<p class="settings-addon-help">No models are approved.</p>`}
    </section>
    <div class=${m?"settings-addon-error":"settings-addon-status"} role=${m?"alert":"status"}>${E}</div>
  </div>`}R({id:"delegate",label:"Delegate",icon:s`<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><path d="M7 7h10v10H7z"/><path d="M4 4h4m8 0h4M4 20h4m8 0h4"/></svg>`,component:N,order:30.25}),I()}export{q as registerDelegateSettings};

//# debugId=D60649EB3A94234264756E2164756E21
//# sourceMappingURL=delegate-settings.bundle.js.map
