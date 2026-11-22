import{t,o,r,i,n,e}from"./app-c7xgjke0.js";import"./app-7bepgq8r.js";import{P,Zt,ie}from"./app-p5k2h1w4.js";import{de}from"./app-ja1gxpeb.js";import{ge,j,v,he,et,Fe,fr,N,B,re,ye,Tn,En}from"./app-vf1bgthg.js";import{T}from"./app-dr786pqe.js";var ve=100;function H(s){return Array.from(new Set(Array.from(s).filter(Boolean))).sort(N)}function $e(s){let m=new Set;for(let l of s){if(l.variants.length===0||!l.variants.some((y)=>["preview","batch","free","fast"].includes(y)))m.add("stable");l.variants.forEach((y)=>m.add(y))}return{providers:H(s.map((l)=>l.provider||"unknown")),publishers:H(s.map((l)=>l.publisher??"")),families:H(s.map((l)=>l.family??"")),variants:H(m)}}function we(s,m={},l=null,y=ve){let c=Tn(s,m),b=Math.max(1,Math.min(ve,Math.floor(y))),p=c.slice(0,b),k=c.find((w)=>w.key===l)??c.find((w)=>w.current)??c[0]??null,f=[c.find((w)=>w.current)??null,k].filter((w,A,x)=>Boolean(w)&&x.findIndex((U)=>U?.key===w?.key)===A);if(f.filter((w)=>!p.some((A)=>A.key===w.key)).length>0){let w=new Set(f.map((A)=>A.key));p=[...p.filter((A)=>!w.has(A.key)).slice(0,Math.max(0,b-f.length)),...f]}return{groups:En(p),renderedEntries:p,totalMatches:c.length,hiddenCount:Math.max(0,c.length-p.length),selectedEntry:k}}function be(s,m,l,y=8){if(s.length===0)return null;let c=s.findIndex((k)=>k.key===m),b=Math.max(1,Math.floor(y)),p=c;if(l==="first")p=0;if(l==="last")p=s.length-1;if(l==="next")p=c<0?0:Math.min(s.length-1,c+1);if(l==="previous")p=c<0?s.length-1:Math.max(0,c-1);if(l==="page-next")p=c<0?0:Math.min(s.length-1,c+b);if(l==="page-previous")p=c<0?s.length-1:Math.max(0,c-b);return s[p]?.key??null}function R(s){if(s==null)return"Unknown";let m=s>=1?2:4;return`$${s.toFixed(m).replace(/0+$/,"").replace(/\.$/,"")}`}function _e(s){if(!s||!Number.isFinite(Date.parse(s)))return"Never";return new Intl.DateTimeFormat(void 0,{dateStyle:"medium",timeStyle:"short"}).format(new Date(s))}function Me(s=typeof window<"u"?window:null){let m=typeof s?.__piclawCurrentChatJid==="string"?s.__piclawCurrentChatJid.trim():"";if(m)return m;try{let l=new URL(s?.location?.href||"http://localhost/").searchParams.get("chat_jid");return l&&l.trim()?l.trim():"web:default"}catch{return"web:default"}}async function te(s,m,l=P){return l("default",s,null,[],null,m)}function Ne(s){let m=(s?.failed||[]).map((p)=>p.provider?`${p.provider}: ${p.message}`:p.message),l=(s?.skipped||[]).map((p)=>`${p.provider} (log in again)`),y=[m.length?`Failed: ${m.join("; ")}.`:"",l.length?`Skipped: ${l.join(", ")}.`:""].filter(Boolean).join(" ");if(s?.status==="timed_out")return{type:"error",text:"Model catalogue update timed out. The previous catalogues are still in use."};if(s?.status==="failed")return{type:"error",text:`Model catalogues could not be updated. ${y}`.trim()};if(s?.status==="partial")return{type:"warning",text:`Model catalogues updated with problems. ${y}`};let c=Array.isArray(s?.providers)&&s.providers.length?` for ${s.providers.join(", ")}`:"",b=s?.models?` (${s.models.before} → ${s.models.after} models)`:"";return{type:l.length?"warning":"success",text:`Model catalogues updated${c}${b}.${y?` ${y}`:""}`}}async function Ie(s,m={},l=1e4){let y=new AbortController,c=setTimeout(()=>y.abort(),l);try{let b=await fetch(s,{credentials:"same-origin",...m,signal:y.signal}),p=await b.json().catch(()=>({}));if(!b.ok)throw Error(p?.error||`Request failed (HTTP ${b.status})`);return p}finally{clearTimeout(c)}}function ne(s){return`settings-model-option-${encodeURIComponent(s)}`}function je(s){if(!s||typeof s!=="object")return null;return[s.plan,s.availability,s.hint_short].filter(Boolean).join(" · ")||null}function Ce(s="recommended"){return{provider:"",publisher:"",family:"",reasoning:"all",variant:"",sort:s}}function He({filter:s="",onFilterChange:m=null}){let[l,y]=t(()=>Me()),[c,b]=t(null),[p,k]=t(()=>v()),[f,z]=t(()=>Ce(v().sort)),[w,A]=t(!1),[x,U]=t(""),[Q,oe]=t(!0),[ae,X]=t(null),[se,le]=t(null),[F,L]=t(""),[V,M]=t(null),[ce,ue]=t(!1),ke=r(null),O=r(0),E=r(0),I=r(l);I.current=l;let C=n(async({quiet:a=!1}={})=>{let d=l,g=++O.current;if(!a||!c)oe(!0);if(!a)X(null);try{let h=await ie(d);if(g!==O.current||d!==I.current)return null;let S=v(),K=B(h,{...he(S)});return b(h),k(S),U((W)=>K.some((ee)=>ee.key===W)?W:K.find((ee)=>ee.current)?.key??K[0]?.key??""),X(null),le(null),{payload:h,catalogue:K}}catch(h){if(g!==O.current||d!==I.current)return null;let S=h?.name==="AbortError"?"Models request timed out.":h?.message||"Failed to load models.";if(c)le(`${S} Showing the last loaded catalogue.`);else X(S);return null}finally{if(g===O.current)oe(!1)}},[l,c]);o(()=>{E.current+=1,L(""),M(null),C()},[l]);let xe=n(async()=>{let a=++E.current;L("catalogues"),M(null);try{let d=await Zt();if(a!==E.current)return;if(await C({quiet:!0}),a!==E.current)return;M(Ne(d))}catch(d){if(a===E.current)M({type:"error",text:d?.message||"Model catalogues could not be updated."})}finally{if(a===E.current)L("")}},[C]);o(()=>{let a=(d)=>{let g=typeof d?.detail?.chatJid==="string"?d.detail.chatJid.trim():Me();if(g)y(g)};return window.addEventListener("piclaw:current-chat-changed",a),()=>window.removeEventListener("piclaw:current-chat-changed",a)},[]),o(()=>{let a=(g)=>k(g?.detail||v()),d=(g)=>{if(!g?.key||g.key==="piclaw:model-catalogue-preferences:v1")k(v())};return window.addEventListener(ge,a),window.addEventListener("storage",d),()=>{window.removeEventListener(ge,a),window.removeEventListener("storage",d)}},[]),o(()=>{let a=(h)=>{let S=h?.detail?.chatJid;if(!S||S===l)C({quiet:!0})},d=()=>void C({quiet:!0}),g=de(d,15000);return window.addEventListener("piclaw:model-state-changed",a),window.addEventListener("piclaw:sse-connected",a),window.addEventListener("focus",d),()=>{g(),window.removeEventListener("piclaw:model-state-changed",a),window.removeEventListener("piclaw:sse-connected",a),window.removeEventListener("focus",d)}},[l,C]);let q=i(()=>B(c,{...he(p)}),[c,p]),G=i(()=>$e(q),[q]),_=i(()=>we(q,{query:s,providers:f.provider||null,publishers:f.publisher||null,families:f.family||null,reasoning:f.reasoning==="all"?null:f.reasoning==="yes",variants:f.variant||null,sort:f.sort},x),[q,s,f,x]),u=_.selectedEntry;o(()=>{if(!_.renderedEntries.some((a)=>a.key===x))U(_.renderedEntries[0]?.key??"")},[_.renderedEntries,x]);let J=(a,d)=>{if(z((g)=>({...g,[a]:d})),a==="sort")k(fr(d))},Ee=()=>{z(Ce(p.sort)),m?.("")},Se=(a)=>{let g={ArrowDown:"next",ArrowUp:"previous",Home:"first",End:"last",PageDown:"page-next",PageUp:"page-previous"}[a.key];if(!g)return;a.preventDefault();let h=be(_.renderedEntries,x,g);U(h),requestAnimationFrame(()=>{(h?document.getElementById(ne(h)):null)?.scrollIntoView?.({block:"nearest"})})},Pe=async()=>{if(!u||F)return;let a=l,d=++E.current;L("switch"),M(null);try{let g=await te(`/model ${u.key}`,a);if(d!==E.current||a!==I.current)return;if(g?.command===!1||g?.error||g?.command?.status==="error")throw Error(g?.error||g?.command?.message||"Model switch failed.");let h=await ie(a);if(d!==E.current||a!==I.current)return;if((B(h,{...he(p)}).find((W)=>W.current)?.key??j(h?.current??h?.model))!==u.key)throw Error("The server did not confirm the model switch.");O.current+=1,b(h),k(Fe(u.key)),M({type:"success",text:`Using ${u.key} for ${a}.`}),window.dispatchEvent(new CustomEvent("piclaw:model-state-changed",{detail:{chatJid:a,payload:h,source:"settings"}})),C({quiet:!0})}catch(g){if(d===E.current&&a===I.current)M({type:"error",text:g?.message||"Model switch failed."}),await C({quiet:!0})}finally{if(d===E.current)L("")}},Te=async(a)=>{if(!u?.current||F)return;L("thinking"),M(null);try{let d=await te(`/thinking ${a}`,l);if(d?.command===!1||d?.error||d?.command?.status==="error")throw Error(d?.error||d?.command?.message||"Thinking level change failed.");await C({quiet:!0}),M({type:"success",text:"Thinking level updated."})}catch(d){M({type:"error",text:d?.message||"Thinking level change failed."}),await C({quiet:!0})}finally{L("")}},Ae=async()=>{if(F)return;L("compact");try{let a=await te("/compact",l);if(a?.command===!1||a?.error||a?.command?.status==="error")throw Error(a?.error||a?.command?.message||"Compaction request failed.");M({type:"success",text:"Context compaction requested. Switch after compaction completes."})}catch(a){M({type:"error",text:a?.message||"Compaction request failed."})}finally{L("")}},Le=async(a)=>{if(ce)return;ue(!0);try{let d=await Ie("/agent/settings/general",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({scopedModelsOnly:Boolean(a)})});if(!d?.ok)throw Error(d?.error||"Failed to save scoped model setting.");await C({quiet:!0})}catch(d){M({type:"error",text:d?.message||"Failed to save scoped model setting."})}finally{ue(!1)}},pe=(a=u?.key)=>{if(!a)return;k(et(a))},me=(a)=>e`
        <div
            id=${ne(a.key)}
            key=${a.key}
            role="option"
            aria-selected=${a.key===x?"true":"false"}
            aria-current=${a.current?"true":void 0}
            class=${`model-catalogue-settings__row${a.key===x?" selected":""}${a.current?" current":""}`}
            onClick=${()=>U(a.key)}
        >
            <button
                type="button"
                class="model-catalogue-settings__pin"
                aria-label=${a.pinned?`Unpin ${a.displayName}`:`Pin ${a.displayName}`}
                aria-pressed=${a.pinned?"true":"false"}
                title=${a.pinned?"Unpin model":"Pin model"}
                onClick=${(d)=>{d.stopPropagation(),pe(a.key)}}
            >${a.pinned?"★":"☆"}</button>
            <span class="model-catalogue-settings__row-main">
                <strong>${a.displayName}</strong>
                <code>${a.key}</code>
                <span class="model-catalogue-settings__row-mobile-meta">
                    <span>${re(a.contextWindow)||"Unknown context"}</span>
                    <span>${a.reasoning?"Reasoning":"Standard"}</span>
                    ${ye(a.pricing)&&e`<span>${ye(a.pricing)}</span>`}
                </span>
            </span>
            <span class="model-catalogue-settings__row-family">${a.family||a.publisher||"—"}</span>
            <span class="model-catalogue-settings__row-context">${re(a.contextWindow)||"Unknown"}</span>
            <span class="model-catalogue-settings__row-mode">${a.reasoning?"Reasoning":"Standard"}</span>
            <span class="model-catalogue-settings__row-input-price">${R(a.pricing?.inputPerMillion??null)}</span>
            <span class="model-catalogue-settings__row-output-price">${R(a.pricing?.outputPerMillion??null)}</span>
        </div>
    `,Re=(a)=>e`
        <div class="model-catalogue-settings__group" key=${a.key} role="group" aria-label=${a.label}>
            <div class="model-catalogue-settings__group-heading"><span>${a.label}</span><span>${a.totalCount}</span></div>
            ${a.entries.map(me)}
        </div>
    `,D=c?.provider_diagnostics?.providers?.find((a)=>a.provider===u?.provider),fe=u?.current?je(c?.provider_usage):null,Y=u?.thinkingLevels??[],Ue=c?.thinking_level??"",Z=Array.isArray(c?.enabled_model_patterns)?c.enabled_model_patterns:[];if(Q&&!c)return e`<div class="settings-loading" role="status">Loading model catalogue…</div>`;return e`
        <div class="model-catalogue-settings">
            <div class="model-catalogue-settings__header">
                <div>
                    <strong>Models for ${l}</strong>
                    <span>${q.length} available · ${_.totalMatches} matched${_.hiddenCount?` · ${_.renderedEntries.length} shown`:""}</span>
                </div>
                <span class="model-catalogue-settings__header-actions">
                    <button type="button" class="settings-btn" onClick=${()=>C()} disabled=${Q}>${Q?"Refreshing…":"Refresh"}</button>
                    <button type="button" class="settings-btn" title="Fetch the latest model lists from every provider (pi update --models)" onClick=${xe} disabled=${F==="catalogues"}>${F==="catalogues"?"Updating…":"Update catalogues"}</button>
                </span>
            </div>
            ${ae&&e`<div class="model-catalogue-settings__notice error" role="alert">${ae} <button type="button" onClick=${()=>C()}>Retry</button></div>`}
            ${se&&e`<div class="model-catalogue-settings__notice warning" role="status">${se}</div>`}
            ${V&&e`<div class=${`model-catalogue-settings__notice ${V.type}`} role=${V.type==="error"?"alert":"status"}>${V.text}</div>`}

            <div class="model-catalogue-settings__scope">
                <label><input type="checkbox" checked=${Boolean(c?.scoped_models_only)} disabled=${ce} onChange=${(a)=>Le(a.currentTarget.checked)} /> Use <code>enabledModels</code> to scope the catalogue and picker</label>
                <span>${c?.scoped_models_only?c?.scoped_model_filter_active?"enabledModels filter active":"Scope enabled, but no enabledModels patterns are available":"Showing the full provider catalogue"}</span>
            </div>
            <div class=${`model-catalogue-settings__enabled-models${c?.scoped_model_filter_active?" active":""}`}>
                <strong>enabledModels</strong>
                <span>${Z.length?Z.join(", "):"No patterns reported by the active Pi settings manager."}</span>
                <small>${Z.length?`${q.length} catalogue entries after applying the configured patterns.`:"Configure enabledModels in Pi settings; this toggle only chooses whether Piclaw applies those patterns outside the TUI."}</small>
            </div>

            <div class="model-catalogue-settings__filter-disclosure">
                <button
                    type="button"
                    class="model-catalogue-settings__filter-toggle settings-btn"
                    aria-expanded=${w?"true":"false"}
                    aria-controls="classic-model-catalogue-filters"
                    onClick=${()=>A((a)=>!a)}
                >Filters and sorting</button>
                <div id="classic-model-catalogue-filters" class=${`model-catalogue-settings__filters${w?" expanded":""}`} aria-label="Model catalogue filters">
                    <select aria-label="Provider" value=${f.provider} onChange=${(a)=>J("provider",a.currentTarget.value)}><option value="">All providers</option>${G.providers.map((a)=>e`<option value=${a}>${a}</option>`)}</select>
                    <select aria-label="Publisher" value=${f.publisher} onChange=${(a)=>J("publisher",a.currentTarget.value)}><option value="">All publishers</option>${G.publishers.map((a)=>e`<option value=${a}>${a}</option>`)}</select>
                    <select aria-label="Family" value=${f.family} onChange=${(a)=>J("family",a.currentTarget.value)}><option value="">All families</option>${G.families.map((a)=>e`<option value=${a}>${a}</option>`)}</select>
                    <select aria-label="Reasoning" value=${f.reasoning} onChange=${(a)=>J("reasoning",a.currentTarget.value)}><option value="all">Any reasoning</option><option value="yes">Reasoning</option><option value="no">Non-reasoning</option></select>
                    <select aria-label="Variant" value=${f.variant} onChange=${(a)=>J("variant",a.currentTarget.value)}><option value="">All variants</option>${G.variants.map((a)=>e`<option value=${a}>${a}</option>`)}</select>
                    <select aria-label="Sort models" value=${f.sort} onChange=${(a)=>J("sort",a.currentTarget.value)}><option value="recommended">Recommended</option><option value="name">Name</option><option value="context">Context window</option><option value="input-price">Input price</option><option value="output-price">Output price</option></select>
                    <button type="button" class="settings-btn" onClick=${Ee}>Reset filters</button>
                </div>
            </div>

            <div class="model-catalogue-settings__workspace">
                <div
                    ref=${ke}
                    class="model-catalogue-settings__list"
                    role="listbox"
                    tabIndex="0"
                    aria-label="Model catalogue"
                    aria-activedescendant=${_.renderedEntries.some((a)=>a.key===x)?ne(x):void 0}
                    onKeyDown=${Se}
                >
                    <div class="model-catalogue-settings__columns" aria-hidden="true"><span>Pin</span><span>Model</span><span class="model-catalogue-settings__row-family">Family</span><span class="model-catalogue-settings__row-context">Context</span><span class="model-catalogue-settings__row-mode">Mode</span><span class="model-catalogue-settings__row-input-price">Input / 1M</span><span class="model-catalogue-settings__row-output-price">Output / 1M</span></div>
                    ${_.groups.map((a)=>e`
                        <div class="model-catalogue-settings__provider" key=${a.key} role="group" aria-label=${a.label}>
                            <div class="model-catalogue-settings__provider-heading"><span>${a.label}</span><span>${a.totalCount}</span></div>
                            ${a.entries.map(me)}
                            ${a.publisherGroups.map(Re)}
                        </div>
                    `)}
                    ${_.totalMatches===0&&e`<div class="settings-empty">No models match the current search and filters.</div>`}
                    ${_.hiddenCount>0&&e`<div class="model-catalogue-settings__limit">Showing ${_.renderedEntries.length} of ${_.totalMatches}. Refine the search or filters to see the rest.</div>`}
                </div>

                <aside class="model-catalogue-settings__detail" aria-live="polite">
                    ${u?e`
                        <div class="model-catalogue-settings__detail-title">
                            <div><h3>${u.displayName}</h3><code>${u.key}</code></div>
                            <button type="button" class="settings-btn" onClick=${()=>pe()}>${u.pinned?"Unpin":"Pin"}</button>
                        </div>
                        <dl class="model-catalogue-settings__facts">
                            <div><dt>Access provider</dt><dd>${u.provider||"Unknown"}</dd></div>
                            <div><dt>Publisher</dt><dd>${u.publisher||"Unknown"}</dd></div>
                            <div><dt>Family</dt><dd>${u.family||"Unknown"}</dd></div>
                            <div><dt>Context window</dt><dd>${re(u.contextWindow)||"Unknown"}</dd></div>
                            <div><dt>Context fit</dt><dd>Unknown until the backend checks the model switch.</dd></div>
                            <div><dt>Reasoning</dt><dd>${u.reasoning?"Supported":"Not advertised"}</dd></div>
                            <div><dt>Variants</dt><dd>${u.variants.length?u.variants.join(", "):"Stable"}</dd></div>
                            <div><dt>Input / 1M</dt><dd>${R(u.pricing?.inputPerMillion??null)}</dd></div>
                            <div><dt>Output / 1M</dt><dd>${R(u.pricing?.outputPerMillion??null)}</dd></div>
                            <div><dt>Cache read / 1M</dt><dd>${R(u.pricing?.cacheReadPerMillion??null)}</dd></div>
                            <div><dt>Cache write / 1M</dt><dd>${R(u.pricing?.cacheWritePerMillion??null)}</dd></div>
                            <div><dt>Last used</dt><dd>${_e(u.lastUsedAt)}</dd></div>
                            <div><dt>Status</dt><dd>${u.current?"Current model":u.pinned?"Pinned":"Available"}</dd></div>
                        </dl>
                        <div class="model-catalogue-settings__thinking">
                            <strong>Thinking levels</strong>
                            ${Y.length?e`
                                <select aria-label="Thinking level" disabled=${!u.current||F} value=${u.current?Ue:""} onChange=${(a)=>Te(a.currentTarget.value)}>
                                    ${!u.current&&e`<option value="">Switch to this model to change thinking</option>`}
                                    ${Y.map((a)=>e`<option value=${a.id}>${a.label}</option>`)}
                                </select>
                                <span>${Y.map((a)=>a.label).join(", ")}</span>
                            `:e`<span>No server-provided thinking levels.</span>`}
                        </div>
                        <div class="model-catalogue-settings__diagnostics">
                            <strong>Provider diagnostics</strong>
                            ${D?e`<span>${D.auth_configured?"Authenticated":"Credentials not configured"} · ${D.available_model_count} available of ${D.model_count} advertised${D.auth_source?` · ${D.auth_source}`:""}</span>`:e`<span>No provider diagnostics available.</span>`}
                            ${c?.provider_diagnostics?.composition_error&&e`<span class="error">${c.provider_diagnostics.composition_error}</span>`}
                            ${fe&&e`<span>${fe}</span>`}
                        </div>
                        <div class="model-catalogue-settings__actions">
                            <button type="button" class="settings-btn primary" disabled=${u.current||Boolean(F)} onClick=${Pe}>${u.current?"Current model":F==="switch"?"Switching…":"Use for current chat"}</button>
                            <button type="button" class="settings-btn" disabled=${Boolean(F)} onClick=${Ae}>Compact context</button>
                            <button type="button" class="settings-btn" onClick=${()=>navigator.clipboard?.writeText?.(u.key)}>Copy model key</button>
                            <button type="button" class="settings-btn" onClick=${()=>T({section:"providers"})}>Provider settings</button>
                        </div>
                    `:e`<div class="settings-empty">Select a model to inspect it.</div>`}
                </aside>
            </div>
        </div>
    `}export{He as ModelsSection};

//# debugId=37445A4E7FE1257164756E2164756E21
//# sourceMappingURL=models-v5wy8bf8.js.map
