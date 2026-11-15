function ie(O){let{html:d,useState:i,useEffect:T,useCallback:_,registerSettingsPane:z,notifySettingsPanesChanged:F}=O,te="/agent/addons/api/delegate",se=`
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
.delegate-settings .delegate-metrics { display: grid; grid-template-columns: repeat(auto-fit, minmax(130px, 1fr)); gap: .45rem; margin-bottom: .6rem; }
.delegate-settings .delegate-metric { padding: .55rem .65rem; border: 1px solid var(--border-color); border-radius: 7px; background: var(--bg-secondary); }
.delegate-settings .delegate-metric-count { font-size: 1.05rem; font-weight: 600; }
.delegate-settings .delegate-provider-row { display: flex; flex-wrap: wrap; align-items: center; gap: .65rem; margin: .45rem 0; min-width: 0; }
.delegate-settings .delegate-radio { display: inline-flex; align-items: center; gap: .25rem; }
.delegate-settings .delegate-provider-name { font-family: var(--font-mono, monospace); overflow-wrap: anywhere; }
.delegate-settings .delegate-scroll { overflow: auto; border: 1px solid var(--border-color); border-radius: 6px; overflow-wrap: anywhere; }
.delegate-settings .delegate-candidate { display: grid; grid-template-columns: 3rem minmax(0, 1fr); gap: .5rem; padding: .4rem .5rem; border-bottom: 1px solid var(--border-color); }
.delegate-settings .delegate-rejection { padding: .35rem .5rem; border-bottom: 1px solid var(--border-color); }
`;async function M(t,o={}){let l=await fetch(`/agent/addons/api/delegate/${t}`,o),p=await l.json().catch(()=>({}));if(!l.ok||p?.ok===!1)throw Error(p?.error||`HTTP ${l.status}`);return p}function L(t){if(!t)return"never";try{return new Date(t).toLocaleString()}catch{return"unknown"}}function R(t){if(!Number.isFinite(t)||t<=0)return"?";if(t>=1e6)return`${(t/1e6).toFixed(t>=1e7?0:1)}M`;if(t>=1000)return`${Math.round(t/1000)}K`;return String(t)}function U(t,o){return o.has(t)?"search":"exclude"}function q(t,o,l,p){let b=[...p],u=b.filter((c)=>c!==t);if(o==="search"){let c=b.indexOf(t);if(c>=0)u.splice(Math.min(c,u.length),0,t);else u.push(t)}let S=new Set(u);return{searchable_providers:u,excluded_providers:[...l].filter((c)=>!S.has(c))}}function H(){let[t,o]=i(null),[l,p]=i([]),[b,u]=i([]),[S,c]=i(""),[P,C]=i(""),[m,J]=i({}),[E,B]=i({}),[I,K]=i([]),[W,G]=i([]),[A,Q]=i([]),[V,X]=i({providers:[],models:[]}),[y,w]=i(!1),[v,g]=i(""),[f,h]=i(!1);T(()=>{if(!v||f)return;let e=setTimeout(()=>g(""),2500);return()=>clearTimeout(e)},[v,f]);let x=_(async(e=!1,n=!1)=>{w(!0),h(!1),g(e?"Refreshing models…":"");try{let s=e?await M("models",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({refresh:!0})}):await M("models"),a=s.config||{searchable_providers:null,excluded_providers:null,excluded_models:[]};o(a),C(Array.isArray(a.excluded_models)?a.excluded_models.join(`
`):""),p(s.providers||[]),u(s.candidates||[]),J(s.runtime_catalog||{}),B(s.executable_catalog||{}),K(s.runtime_only_models||[]),G(s.unclassified_models||[]),Q(s.rejected_models||[]),X(s.effective_exclusions||{providers:[],models:[]}),g(e?"Model list refreshed.":"")}catch(s){if(h(!0),g(s?.message||"Failed to load delegate settings."),n)throw s}finally{w(!1)}},[]);T(()=>{x(!1)},[x]);let k=_(async(e,n="Saved delegate settings.")=>{let s=t,a={...t,...e};o(a),w(!0),h(!1),g("");let r;try{r=(await M("config",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(e)})).config||a,o(r),C(Array.isArray(r.excluded_models)?r.excluded_models.join(`
`):"")}catch(j){o(s),C(Array.isArray(s?.excluded_models)?s.excluded_models.join(`
`):""),h(!0),g(j?.message||"Failed to save delegate settings."),w(!1);return}try{await x(!1,!0),h(!1),g(n)}catch(j){o(r),h(!0),g(`${n} Refresh failed: ${j?.message||"unknown error"}`)}finally{w(!1)}},[t,x]),Y=_((e,n,s,a)=>{let r=q(e,n,s,a);k(r,`Set ${e} to ${n}.`)},[k]),Z=_(()=>{let e=P.split(/[\n,]+/).map((n)=>n.trim()).filter(Boolean).sort();k({excluded_models:e},"Saved model exclusions.")},[P,k]);if(!t)return d`<div class="delegate-settings"><style>${`
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
.delegate-settings .delegate-metrics { display: grid; grid-template-columns: repeat(auto-fit, minmax(130px, 1fr)); gap: .45rem; margin-bottom: .6rem; }
.delegate-settings .delegate-metric { padding: .55rem .65rem; border: 1px solid var(--border-color); border-radius: 7px; background: var(--bg-secondary); }
.delegate-settings .delegate-metric-count { font-size: 1.05rem; font-weight: 600; }
.delegate-settings .delegate-provider-row { display: flex; flex-wrap: wrap; align-items: center; gap: .65rem; margin: .45rem 0; min-width: 0; }
.delegate-settings .delegate-radio { display: inline-flex; align-items: center; gap: .25rem; }
.delegate-settings .delegate-provider-name { font-family: var(--font-mono, monospace); overflow-wrap: anywhere; }
.delegate-settings .delegate-scroll { overflow: auto; border: 1px solid var(--border-color); border-radius: 6px; overflow-wrap: anywhere; }
.delegate-settings .delegate-candidate { display: grid; grid-template-columns: 3rem minmax(0, 1fr); gap: .5rem; padding: .4rem .5rem; border-bottom: 1px solid var(--border-color); }
.delegate-settings .delegate-rejection { padding: .35rem .5rem; border-bottom: 1px solid var(--border-color); }
`}</style>
    <p class=${f?"settings-addon-error":"settings-addon-status"} role=${f?"alert":"status"}>${v||"Loading delegate settings…"}</p>
    ${v&&d`<button type="button" disabled=${y} onClick=${()=>x(!1)}>Retry</button>`}
  </div>`;let D=new Set(Array.isArray(t.searchable_providers)?t.searchable_providers:l.filter((e)=>e.enabled).map((e)=>e.provider)),ae=new Set(Array.isArray(t.excluded_providers)?t.excluded_providers:l.filter((e)=>e.excluded).map((e)=>e.provider)),N=S.trim().toLowerCase(),ee=l.filter((e)=>!N||e.provider.toLowerCase().includes(N));return d`
    <div class="delegate-settings">
      <style>${`
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
.delegate-settings .delegate-metrics { display: grid; grid-template-columns: repeat(auto-fit, minmax(130px, 1fr)); gap: .45rem; margin-bottom: .6rem; }
.delegate-settings .delegate-metric { padding: .55rem .65rem; border: 1px solid var(--border-color); border-radius: 7px; background: var(--bg-secondary); }
.delegate-settings .delegate-metric-count { font-size: 1.05rem; font-weight: 600; }
.delegate-settings .delegate-provider-row { display: flex; flex-wrap: wrap; align-items: center; gap: .65rem; margin: .45rem 0; min-width: 0; }
.delegate-settings .delegate-radio { display: inline-flex; align-items: center; gap: .25rem; }
.delegate-settings .delegate-provider-name { font-family: var(--font-mono, monospace); overflow-wrap: anywhere; }
.delegate-settings .delegate-scroll { overflow: auto; border: 1px solid var(--border-color); border-radius: 6px; overflow-wrap: anywhere; }
.delegate-settings .delegate-candidate { display: grid; grid-template-columns: 3rem minmax(0, 1fr); gap: .5rem; padding: .4rem .5rem; border-bottom: 1px solid var(--border-color); }
.delegate-settings .delegate-rejection { padding: .35rem .5rem; border-bottom: 1px solid var(--border-color); }
`}</style>
      <section class="settings-addon-section">
      <h4>Catalog status</h4>
      <div class="delegate-metrics">
        <div class="delegate-metric"><div class="delegate-metric-count">${m.model_count||0}</div><div class="settings-addon-help">Registered models</div></div>
        <div class="delegate-metric"><div class="delegate-metric-count">${E.model_count||0}</div><div class="settings-addon-help">Native models</div></div>
        <div class="delegate-metric"><div class="delegate-metric-count">${E.candidate_count||0}</div><div class="settings-addon-help">Approved models</div></div>
        <div class="delegate-metric"><div class="delegate-metric-count">${A.length}</div><div class="settings-addon-help">Rejected</div></div>
        <div class="delegate-metric"><div class="delegate-metric-count">${W.length}</div><div class="settings-addon-help">Unclassified</div></div>
      </div>
      <div class="settings-addon-help">
        <div>Default: <code>${m.current_model||"unavailable"}</code>${m.current_classification?.tier?` · T${m.current_classification.tier} · ${m.current_classification.rule}`:" · unclassified"}</div>
        <div>Native catalogue captured ${L(m.captured_at)}. Model availability is read from the current registered runtime; no child CLI is launched.</div>
      </div>
      </section>

      <section class="settings-addon-section">
      <h4>Approved providers</h4>
      <p class="settings-addon-help" id="delegate-provider-help">
        No provider is approved by default. Delegate can launch models only from providers marked <strong>Approved</strong>. Only currently available, registered native models can be selected.
      </p>
      <div class="settings-addon-field">
        <label class="settings-addon-label" for="delegate-provider-filter">Filter providers</label>
        <div class="settings-addon-control-group">
        <input id="delegate-provider-filter" class="settings-addon-control" aria-describedby="delegate-provider-help" type="search" value=${S} placeholder="Filter providers…" onInput=${(e)=>c(e.target.value)} />
        <button type="button" disabled=${y} onClick=${()=>x(!0)}>Refresh</button>
        </div>
      </div>
      <div>
        ${ee.map((e)=>{let n=U(e.provider,D),s=`delegate-provider-mode-${e.provider}`;return d`
            <div key=${e.provider} class="delegate-provider-row">
              <div role="radiogroup" aria-label=${`${e.provider} mode`} class="settings-addon-control-group">
                ${["approved","exclude"].map((a)=>d`
                  <label key=${a} class="delegate-radio settings-addon-label">
                    <input type="radio" name=${s} value=${a} checked=${n===(a==="approved"?"search":a)} disabled=${y}
                      onChange=${()=>Y(e.provider,a==="approved"?"search":a,l.map((r)=>r.provider),D)} />
                    <span>${a[0].toUpperCase()}${a.slice(1)}</span>
                  </label>`)}
              </div>
              <span class="delegate-provider-name">${e.provider}</span>
              <span class="settings-addon-help">${e.modelCount} models${n==="exclude"?e.defaultExcluded?" · default excluded":" · excluded":""}</span>
            </div>`})}
      </div>
      </section>

      <section class="settings-addon-section">
      <h4>Excluded model patterns</h4>
      <div class="settings-addon-field">
      <label class="settings-addon-label" for="delegate-exclusions">Excluded model patterns</label>
      <p class="settings-addon-help" id="delegate-exclusions-help">
        Hard model exclusions, one per line or comma-separated. Supports exact ids, substrings, or <code>*</code> wildcards. Matching models are blocked from automatic selection, fallback, and explicit model selection. Effective provider exclusions: ${V.providers?.join(", ")||"none"}.
      </p>
      <textarea id="delegate-exclusions" class="settings-addon-control" aria-describedby="delegate-exclusions-help" style="min-height:74px;font-family:var(--font-mono, monospace)" value=${P} disabled=${y} placeholder="gpt-4o\n*/experimental-*" onInput=${(e)=>C(e.target.value)} />
      </div>
      <div class="settings-addon-actions">
        <button type="button" disabled=${y} onClick=${Z}>Save exclusions</button>
      </div>
      </section>

      <section class="settings-addon-section">
      <h4>Approved delegate models</h4>
      <p class="settings-addon-help">
        Delegate can launch only these ${b.length} models, whether selected automatically, requested explicitly by an agent, or used as a fallback. Each model is from an approved provider, matches the ordered model policy, is available in the native runtime, and does not match an exclusion.
      </p>
      <div class="delegate-scroll" style="max-height:180px">
        ${b.slice(0,80).map((e)=>d`
          <div key=${e.id} title=${e.classificationReason} class="delegate-candidate">
            <span class="settings-addon-help">T${e.tier}</span>
            <span>
              <code>${e.id}</code>
              <span class="settings-addon-help"> · ${e.family} · ${e.classificationRule}</span>
              <div class="settings-addon-help">images=${e.supportsImages===!0?"yes":e.supportsImages===!1?"no":"?"} · reasoning=${e.reasoning===!0?"yes":e.reasoning===!1?"no":"?"} · context=${R(e.contextWindow)} · output=${R(e.maxOutputTokens)}</div>
            </span>
          </div>`)}
      </div>
      </section>

      <section class="settings-addon-section">
      <h4>Catalog differences and rejections</h4>
      <p class="settings-addon-help">
        Rejected models cannot be used by Delegate because their provider is unapproved, the model is excluded, or the model is unclassified. Native execution never falls back to a child CLI.
      </p>
      <div class="delegate-scroll" style="max-height:190px">
        ${I.length===0&&A.length===0&&d`<p class="settings-addon-help">No catalog differences or rejected models.</p>`}
        ${I.slice(0,50).map((e)=>d`
          <div key=${`runtime:${e.fullId}`} class="delegate-rejection settings-addon-help">
            <code>${e.fullId}</code> <span>runtime-only · ${e.classification?.status==="classified"?`T${e.classification.tier} ${e.classification.rule}`:e.classification?.reason}</span>
          </div>`)}
        ${A.slice(0,80).map((e)=>d`
          <div key=${`rejected:${e.fullId}`} class="delegate-rejection settings-addon-help">
            <code>${e.fullId}</code> <span>rejected · ${e.rejection_reason}</span>
          </div>`)}
      </div>
      </section>
      ${v&&d`<div class=${f?"settings-addon-error":"settings-addon-status"} role=${f?"alert":"status"}>${v}</div>`}
    </div>`}z({id:"delegate",label:"Delegate",icon:d`<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><path d="M7 7h10v10H7z"/><path d="M4 4h4m8 0h4M4 20h4m8 0h4"/></svg>`,component:H,order:169}),F()}export{ie as registerDelegateSettings};

//# debugId=164817BEFF73BB5964756E2164756E21
//# sourceMappingURL=delegate-settings.bundle.js.map
