import{t,o,n,i,r,e}from"./app-863dk79s.js";import{E,ln,se}from"./app-r6ty9k25.js";import{R}from"./app-9p95t6ms.js";import{ge,O,g,he,st,Ue,$r,D,L,re,ye,On,Bn}from"./app-rtkt64hb.js";import{A}from"./app-wq98hqjx.js";var ve=100;function z(s){return Array.from(new Set(Array.from(s).filter(Boolean))).sort(D)}function $e(s){let f=new Set;for(let l of s){if(l.variants.length===0||!l.variants.some((y)=>["preview","batch","free","fast"].includes(y)))f.add("stable");l.variants.forEach((y)=>f.add(y))}return{providers:z(s.map((l)=>l.provider||"unknown")),publishers:z(s.map((l)=>l.publisher??"")),families:z(s.map((l)=>l.family??"")),variants:z(f)}}function we(s,f={},l=null,y=ve){let c=On(s,f),b=Math.max(1,Math.min(ve,Math.floor(y))),p=c.slice(0,b),k=c.find((w)=>w.key===l)??c.find((w)=>w.current)??c[0]??null,v=[c.find((w)=>w.current)??null,k].filter((w,T,x)=>Boolean(w)&&x.findIndex((I)=>I?.key===w?.key)===T);if(v.filter((w)=>!p.some((T)=>T.key===w.key)).length>0){let w=new Set(v.map((T)=>T.key));p=[...p.filter((T)=>!w.has(T.key)).slice(0,Math.max(0,b-v.length)),...v]}return{groups:Bn(p),renderedEntries:p,totalMatches:c.length,hiddenCount:Math.max(0,c.length-p.length),selectedEntry:k}}function be(s,f,l,y=8){if(s.length===0)return null;let c=s.findIndex((k)=>k.key===f),b=Math.max(1,Math.floor(y)),p=c;if(l==="first")p=0;if(l==="last")p=s.length-1;if(l==="next")p=c<0?0:Math.min(s.length-1,c+1);if(l==="previous")p=c<0?s.length-1:Math.max(0,c-1);if(l==="page-next")p=c<0?0:Math.min(s.length-1,c+b);if(l==="page-previous")p=c<0?s.length-1:Math.max(0,c-b);return s[p]?.key??null}function N(s){if(s==null)return"Unknown";let f=s>=1?2:4;return`$${s.toFixed(f).replace(/0+$/,"").replace(/\.$/,"")}`}function _e(s){if(!s||!Number.isFinite(Date.parse(s)))return"Never";return new Intl.DateTimeFormat(void 0,{dateStyle:"medium",timeStyle:"short"}).format(new Date(s))}function Me(s=typeof window<"u"?window:null){let f=typeof s?.__piclawCurrentChatJid==="string"?s.__piclawCurrentChatJid.trim():"";if(f)return f;try{let l=new URL(s?.location?.href||"http://localhost/").searchParams.get("chat_jid");return l&&l.trim()?l.trim():"web:default"}catch{return"web:default"}}async function ne(s,f,l=E){return l("default",s,null,[],null,f)}function Ne(s){let f=(s?.failed||[]).map((p)=>p.provider?`${p.provider}: ${p.message}`:p.message),l=(s?.skipped||[]).map((p)=>`${p.provider} (log in again)`),y=[f.length?`Failed: ${f.join("; ")}.`:"",l.length?`Skipped: ${l.join(", ")}.`:""].filter(Boolean).join(" ");if(s?.status==="timed_out")return{type:"error",text:"Model catalogue update timed out. The previous catalogues are still in use."};if(s?.status==="failed")return{type:"error",text:`Model catalogues could not be updated. ${y}`.trim()};if(s?.status==="partial")return{type:"warning",text:`Model catalogues updated with problems. ${y}`};let c=Array.isArray(s?.providers)&&s.providers.length?` for ${s.providers.join(", ")}`:"",b=s?.models?` (${s.models.before} → ${s.models.after} models)`:"";return{type:l.length?"warning":"success",text:`Model catalogues updated${c}${b}.${y?` ${y}`:""}`}}async function Ie(s,f={},l=1e4){let y=new AbortController,c=setTimeout(()=>y.abort(),l);try{let b=await fetch(s,{credentials:"same-origin",...f,signal:y.signal}),p=await b.json().catch(()=>({}));if(!b.ok)throw Error(p?.error||`Request failed (HTTP ${b.status})`);return p}finally{clearTimeout(c)}}function oe(s){return`settings-model-option-${encodeURIComponent(s)}`}function je(s){if(!s||typeof s!=="object")return null;return[s.plan,s.availability,s.hint_short].filter(Boolean).join(" · ")||null}function Ce(s="recommended"){return{provider:"",publisher:"",family:"",reasoning:"all",variant:"",sort:s}}function He({filter:s="",onFilterChange:f=null}){let[l,y]=t(()=>Me()),[c,b]=t(null),[p,k]=t(()=>g()),[v,Q]=t(()=>Ce(g().sort)),[w,T]=t(!1),[x,I]=t(""),[X,ae]=t(!0),[ie,Y]=t(null),[le,de]=t(null),[F,U]=t(""),[G,M]=t(null),[ce,ue]=t(!1),ke=n(null),K=n(0),S=n(0),j=n(l);j.current=l;let C=r(async({quiet:a=!1}={})=>{let d=l,m=++K.current;if(!a||!c)ae(!0);if(!a)Y(null);try{let h=await se(d);if(m!==K.current||d!==j.current)return null;let P=g(),V=L(h,{...he(P)});return b(h),k(P),I((H)=>V.some((te)=>te.key===H)?H:V.find((te)=>te.current)?.key??V[0]?.key??""),Y(null),de(null),{payload:h,catalogue:V}}catch(h){if(m!==K.current||d!==j.current)return null;let P=h?.name==="AbortError"?"Models request timed out.":h?.message||"Failed to load models.";if(c)de(`${P} Showing the last loaded catalogue.`);else Y(P);return null}finally{if(m===K.current)ae(!1)}},[l,c]);o(()=>{S.current+=1,U(""),M(null),C()},[l]);let xe=r(async()=>{let a=++S.current;U("catalogues"),M(null);try{let d=await ln();if(a!==S.current)return;if(await C({quiet:!0}),a!==S.current)return;M(Ne(d))}catch(d){if(a===S.current)M({type:"error",text:d?.message||"Model catalogues could not be updated."})}finally{if(a===S.current)U("")}},[C]);o(()=>{let a=(d)=>{let m=typeof d?.detail?.chatJid==="string"?d.detail.chatJid.trim():Me();if(m)y(m)};return window.addEventListener("piclaw:current-chat-changed",a),()=>window.removeEventListener("piclaw:current-chat-changed",a)},[]),o(()=>{let a=(m)=>k(m?.detail||g()),d=(m)=>{if(!m?.key||m.key==="piclaw:model-catalogue-preferences:v1")k(g())};return window.addEventListener(ge,a),window.addEventListener("storage",d),()=>{window.removeEventListener(ge,a),window.removeEventListener("storage",d)}},[]),o(()=>{let a=(h)=>{let P=h?.detail?.chatJid;if(!P||P===l)C({quiet:!0})},d=()=>void C({quiet:!0}),m=R(d,15000);return window.addEventListener("piclaw:model-state-changed",a),window.addEventListener("piclaw:sse-connected",a),window.addEventListener("focus",d),()=>{m(),window.removeEventListener("piclaw:model-state-changed",a),window.removeEventListener("piclaw:sse-connected",a),window.removeEventListener("focus",d)}},[l,C]);let q=i(()=>L(c,{...he(p)}),[c,p]),W=i(()=>$e(q),[q]),_=i(()=>we(q,{query:s,providers:v.provider||null,publishers:v.publisher||null,families:v.family||null,reasoning:v.reasoning==="all"?null:v.reasoning==="yes",variants:v.variant||null,sort:v.sort},x),[q,s,v,x]),u=_.selectedEntry;o(()=>{if(!_.renderedEntries.some((a)=>a.key===x))I(_.renderedEntries[0]?.key??"")},[_.renderedEntries,x]);let J=(a,d)=>{if(Q((m)=>({...m,[a]:d})),a==="sort")k($r(d))},Ee=()=>{Q(Ce(p.sort)),f?.("")},Se=(a)=>{let m={ArrowDown:"next",ArrowUp:"previous",Home:"first",End:"last",PageDown:"page-next",PageUp:"page-previous"}[a.key];if(!m)return;a.preventDefault();let h=be(_.renderedEntries,x,m);I(h),requestAnimationFrame(()=>{(h?document.getElementById(oe(h)):null)?.scrollIntoView?.({block:"nearest"})})},Pe=async()=>{if(!u||F)return;let a=l,d=++S.current;U("switch"),M(null);try{let m=await ne(`/model ${u.key}`,a);if(d!==S.current||a!==j.current)return;if(m?.command===!1||m?.error||m?.command?.status==="error")throw Error(m?.error||m?.command?.message||"Model switch failed.");let h=await se(a);if(d!==S.current||a!==j.current)return;if((L(h,{...he(p)}).find((H)=>H.current)?.key??O(h?.current??h?.model))!==u.key)throw Error("The server did not confirm the model switch.");K.current+=1,b(h),k(Ue(u.key)),M({type:"success",text:`Using ${u.key} for ${a}.`}),window.dispatchEvent(new CustomEvent("piclaw:model-state-changed",{detail:{chatJid:a,payload:h,source:"settings"}})),C({quiet:!0})}catch(m){if(d===S.current&&a===j.current)M({type:"error",text:m?.message||"Model switch failed."}),await C({quiet:!0})}finally{if(d===S.current)U("")}},Te=async(a)=>{if(!u?.current||F)return;U("thinking"),M(null);try{let d=await ne(`/thinking ${a}`,l);if(d?.command===!1||d?.error||d?.command?.status==="error")throw Error(d?.error||d?.command?.message||"Thinking level change failed.");await C({quiet:!0}),M({type:"success",text:"Thinking level updated."})}catch(d){M({type:"error",text:d?.message||"Thinking level change failed."}),await C({quiet:!0})}finally{U("")}},Ae=async()=>{if(F)return;U("compact");try{let a=await ne("/compact",l);if(a?.command===!1||a?.error||a?.command?.status==="error")throw Error(a?.error||a?.command?.message||"Compaction request failed.");M({type:"success",text:"Context compaction requested. Switch after compaction completes."})}catch(a){M({type:"error",text:a?.message||"Compaction request failed."})}finally{U("")}},Fe=async(a)=>{if(ce)return;ue(!0);try{let d=await Ie("/agent/settings/general",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({scopedModelsOnly:Boolean(a)})});if(!d?.ok)throw Error(d?.error||"Failed to save scoped model setting.");await C({quiet:!0})}catch(d){M({type:"error",text:d?.message||"Failed to save scoped model setting."})}finally{ue(!1)}},pe=(a=u?.key)=>{if(!a)return;k(st(a))},me=(a)=>e`
        <div
            id=${oe(a.key)}
            key=${a.key}
            role="option"
            aria-selected=${a.key===x?"true":"false"}
            aria-current=${a.current?"true":void 0}
            class=${`model-catalogue-settings__row${a.key===x?" selected":""}${a.current?" current":""}`}
            onClick=${()=>I(a.key)}
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
            <span class="model-catalogue-settings__row-input-price">${N(a.pricing?.inputPerMillion??null)}</span>
            <span class="model-catalogue-settings__row-output-price">${N(a.pricing?.outputPerMillion??null)}</span>
        </div>
    `,Le=(a)=>e`
        <div class="model-catalogue-settings__group" key=${a.key} role="group" aria-label=${a.label}>
            <div class="model-catalogue-settings__group-heading"><span>${a.label}</span><span>${a.totalCount}</span></div>
            ${a.entries.map(me)}
        </div>
    `,B=c?.provider_diagnostics?.providers?.find((a)=>a.provider===u?.provider),fe=u?.current?je(c?.provider_usage):null,Z=u?.thinkingLevels??[],Re=c?.thinking_level??"",ee=Array.isArray(c?.enabled_model_patterns)?c.enabled_model_patterns:[];if(X&&!c)return e`<div class="settings-loading" role="status">Loading model catalogue…</div>`;return e`
        <div class="model-catalogue-settings">
            <div class="model-catalogue-settings__header">
                <div>
                    <strong>Models for ${l}</strong>
                    <span>${q.length} available · ${_.totalMatches} matched${_.hiddenCount?` · ${_.renderedEntries.length} shown`:""}</span>
                </div>
                <span class="model-catalogue-settings__header-actions">
                    <button type="button" class="settings-btn" onClick=${()=>C()} disabled=${X}>${X?"Refreshing…":"Refresh"}</button>
                    <button type="button" class="settings-btn" title="Fetch the latest model lists from every provider (pi update --models)" onClick=${xe} disabled=${F==="catalogues"}>${F==="catalogues"?"Updating…":"Update catalogues"}</button>
                </span>
            </div>
            ${ie&&e`<div class="model-catalogue-settings__notice error" role="alert">${ie} <button type="button" onClick=${()=>C()}>Retry</button></div>`}
            ${le&&e`<div class="model-catalogue-settings__notice warning" role="status">${le}</div>`}
            ${G&&e`<div class=${`model-catalogue-settings__notice ${G.type}`} role=${G.type==="error"?"alert":"status"}>${G.text}</div>`}

            <div class="model-catalogue-settings__scope">
                <label><input type="checkbox" checked=${Boolean(c?.scoped_models_only)} disabled=${ce} onChange=${(a)=>Fe(a.currentTarget.checked)} /> Use <code>enabledModels</code> to scope the catalogue and picker</label>
                <span>${c?.scoped_models_only?c?.scoped_model_filter_active?"enabledModels filter active":"Scope enabled, but no enabledModels patterns are available":"Showing the full provider catalogue"}</span>
            </div>
            <div class=${`model-catalogue-settings__enabled-models${c?.scoped_model_filter_active?" active":""}`}>
                <strong>enabledModels</strong>
                <span>${ee.length?ee.join(", "):"No patterns reported by the active Pi settings manager."}</span>
                <small>${ee.length?`${q.length} catalogue entries after applying the configured patterns.`:"Configure enabledModels in Pi settings; this toggle only chooses whether Piclaw applies those patterns outside the TUI."}</small>
            </div>

            <div class="model-catalogue-settings__filter-disclosure">
                <button
                    type="button"
                    class="model-catalogue-settings__filter-toggle settings-btn"
                    aria-expanded=${w?"true":"false"}
                    aria-controls="classic-model-catalogue-filters"
                    onClick=${()=>T((a)=>!a)}
                >Filters and sorting</button>
                <div id="classic-model-catalogue-filters" class=${`model-catalogue-settings__filters${w?" expanded":""}`} aria-label="Model catalogue filters">
                    <select aria-label="Provider" value=${v.provider} onChange=${(a)=>J("provider",a.currentTarget.value)}><option value="">All providers</option>${W.providers.map((a)=>e`<option value=${a}>${a}</option>`)}</select>
                    <select aria-label="Publisher" value=${v.publisher} onChange=${(a)=>J("publisher",a.currentTarget.value)}><option value="">All publishers</option>${W.publishers.map((a)=>e`<option value=${a}>${a}</option>`)}</select>
                    <select aria-label="Family" value=${v.family} onChange=${(a)=>J("family",a.currentTarget.value)}><option value="">All families</option>${W.families.map((a)=>e`<option value=${a}>${a}</option>`)}</select>
                    <select aria-label="Reasoning" value=${v.reasoning} onChange=${(a)=>J("reasoning",a.currentTarget.value)}><option value="all">Any reasoning</option><option value="yes">Reasoning</option><option value="no">Non-reasoning</option></select>
                    <select aria-label="Variant" value=${v.variant} onChange=${(a)=>J("variant",a.currentTarget.value)}><option value="">All variants</option>${W.variants.map((a)=>e`<option value=${a}>${a}</option>`)}</select>
                    <select aria-label="Sort models" value=${v.sort} onChange=${(a)=>J("sort",a.currentTarget.value)}><option value="recommended">Recommended</option><option value="name">Name</option><option value="context">Context window</option><option value="input-price">Input price</option><option value="output-price">Output price</option></select>
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
                    aria-activedescendant=${_.renderedEntries.some((a)=>a.key===x)?oe(x):void 0}
                    onKeyDown=${Se}
                >
                    <div class="model-catalogue-settings__columns" aria-hidden="true"><span>Pin</span><span>Model</span><span class="model-catalogue-settings__row-family">Family</span><span class="model-catalogue-settings__row-context">Context</span><span class="model-catalogue-settings__row-mode">Mode</span><span class="model-catalogue-settings__row-input-price">Input / 1M</span><span class="model-catalogue-settings__row-output-price">Output / 1M</span></div>
                    ${_.groups.map((a)=>e`
                        <div class="model-catalogue-settings__provider" key=${a.key} role="group" aria-label=${a.label}>
                            <div class="model-catalogue-settings__provider-heading"><span>${a.label}</span><span>${a.totalCount}</span></div>
                            ${a.entries.map(me)}
                            ${a.publisherGroups.map(Le)}
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
                            <div><dt>Input / 1M</dt><dd>${N(u.pricing?.inputPerMillion??null)}</dd></div>
                            <div><dt>Output / 1M</dt><dd>${N(u.pricing?.outputPerMillion??null)}</dd></div>
                            <div><dt>Cache read / 1M</dt><dd>${N(u.pricing?.cacheReadPerMillion??null)}</dd></div>
                            <div><dt>Cache write / 1M</dt><dd>${N(u.pricing?.cacheWritePerMillion??null)}</dd></div>
                            <div><dt>Last used</dt><dd>${_e(u.lastUsedAt)}</dd></div>
                            <div><dt>Status</dt><dd>${u.current?"Current model":u.pinned?"Pinned":"Available"}</dd></div>
                        </dl>
                        <div class="model-catalogue-settings__thinking">
                            <strong>Thinking levels</strong>
                            ${Z.length?e`
                                <select aria-label="Thinking level" disabled=${!u.current||F} value=${u.current?Re:""} onChange=${(a)=>Te(a.currentTarget.value)}>
                                    ${!u.current&&e`<option value="">Switch to this model to change thinking</option>`}
                                    ${Z.map((a)=>e`<option value=${a.id}>${a.label}</option>`)}
                                </select>
                                <span>${Z.map((a)=>a.label).join(", ")}</span>
                            `:e`<span>No server-provided thinking levels.</span>`}
                        </div>
                        <div class="model-catalogue-settings__diagnostics">
                            <strong>Provider diagnostics</strong>
                            ${B?e`<span>${B.auth_configured?"Authenticated":"Credentials not configured"} · ${B.available_model_count} available of ${B.model_count} advertised${B.auth_source?` · ${B.auth_source}`:""}</span>`:e`<span>No provider diagnostics available.</span>`}
                            ${c?.provider_diagnostics?.composition_error&&e`<span class="error">${c.provider_diagnostics.composition_error}</span>`}
                            ${fe&&e`<span>${fe}</span>`}
                        </div>
                        <div class="model-catalogue-settings__actions">
                            <button type="button" class="settings-btn primary" disabled=${u.current||Boolean(F)} onClick=${Pe}>${u.current?"Current model":F==="switch"?"Switching…":"Use for current chat"}</button>
                            <button type="button" class="settings-btn" disabled=${Boolean(F)} onClick=${Ae}>Compact context</button>
                            <button type="button" class="settings-btn" onClick=${()=>navigator.clipboard?.writeText?.(u.key)}>Copy model key</button>
                            <button type="button" class="settings-btn" onClick=${()=>A({section:"providers"})}>Provider settings</button>
                        </div>
                    `:e`<div class="settings-empty">Select a model to inspect it.</div>`}
                </aside>
            </div>
        </div>
    `}export{He as ModelsSection};

//# debugId=F04D46B05515D05A64756E2164756E21
//# sourceMappingURL=models-4yw82xnt.js.map
