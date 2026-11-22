import{t,o,r,i,n,e}from"./app-017vdhd7.js";import{E,Gt,Y}from"./app-0zpdk33j.js";import{re}from"./app-6kn29n7g.js";import{ae,M,y,ce,Qe,Pe,cr,R,P,J,le,Sn,kn}from"./app-9ah8dw8m.js";import{A}from"./app-mbxfp7m6.js";var $e=100;function z(s){return Array.from(new Set(Array.from(s).filter(Boolean))).sort(R)}function ye(s){let m=new Set;for(let l of s){if(l.variants.length===0||!l.variants.some((h)=>["preview","batch","free","fast"].includes(h)))m.add("stable");l.variants.forEach((h)=>m.add(h))}return{providers:z(s.map((l)=>l.provider||"unknown")),publishers:z(s.map((l)=>l.publisher??"")),families:z(s.map((l)=>l.family??"")),variants:z(m)}}function we(s,m={},l=null,h=$e){let c=Sn(s,m),b=Math.max(1,Math.min($e,Math.floor(h))),p=c.slice(0,b),x=c.find((w)=>w.key===l)??c.find((w)=>w.current)??c[0]??null,f=[c.find((w)=>w.current)??null,x].filter((w,L,S)=>Boolean(w)&&S.findIndex((j)=>j?.key===w?.key)===L);if(f.filter((w)=>!p.some((L)=>L.key===w.key)).length>0){let w=new Set(f.map((L)=>L.key));p=[...p.filter((L)=>!w.has(L.key)).slice(0,Math.max(0,b-f.length)),...f]}return{groups:kn(p),renderedEntries:p,totalMatches:c.length,hiddenCount:Math.max(0,c.length-p.length),selectedEntry:x}}function be(s,m,l,h=8){if(s.length===0)return null;let c=s.findIndex((x)=>x.key===m),b=Math.max(1,Math.floor(h)),p=c;if(l==="first")p=0;if(l==="last")p=s.length-1;if(l==="next")p=c<0?0:Math.min(s.length-1,c+1);if(l==="previous")p=c<0?s.length-1:Math.max(0,c-1);if(l==="page-next")p=c<0?0:Math.min(s.length-1,c+b);if(l==="page-previous")p=c<0?s.length-1:Math.max(0,c-b);return s[p]?.key??null}function I(s){if(s==null)return"Unknown";let m=s>=1?2:4;return`$${s.toFixed(m).replace(/0+$/,"").replace(/\.$/,"")}`}function _e(s){if(!s||!Number.isFinite(Date.parse(s)))return"Never";return new Intl.DateTimeFormat(void 0,{dateStyle:"medium",timeStyle:"short"}).format(new Date(s))}function Me(s=typeof window<"u"?window:null){let m=typeof s?.__piclawCurrentChatJid==="string"?s.__piclawCurrentChatJid.trim():"";if(m)return m;try{let l=new URL(s?.location?.href||"http://localhost/").searchParams.get("chat_jid");return l&&l.trim()?l.trim():"web:default"}catch{return"web:default"}}async function oe(s,m,l=E){return l("default",s,null,[],null,m)}function Ne(s){let m=(s?.failed||[]).map((p)=>p.provider?`${p.provider}: ${p.message}`:p.message),l=(s?.skipped||[]).map((p)=>`${p.provider} (log in again)`),h=[m.length?`Failed: ${m.join("; ")}.`:"",l.length?`Skipped: ${l.join(", ")}.`:""].filter(Boolean).join(" ");if(s?.status==="timed_out")return{type:"error",text:"Model catalogue update timed out. The previous catalogues are still in use."};if(s?.status==="failed")return{type:"error",text:`Model catalogues could not be updated. ${h}`.trim()};if(s?.status==="partial")return{type:"warning",text:`Model catalogues updated with problems. ${h}`};let c=Array.isArray(s?.providers)&&s.providers.length?` for ${s.providers.join(", ")}`:"",b=s?.models?` (${s.models.before} → ${s.models.after} models)`:"";return{type:l.length?"warning":"success",text:`Model catalogues updated${c}${b}.${h?` ${h}`:""}`}}async function Ie(s,m={},l=1e4){let h=new AbortController,c=setTimeout(()=>h.abort(),l);try{let b=await fetch(s,{credentials:"same-origin",...m,signal:h.signal}),p=await b.json().catch(()=>({}));if(!b.ok)throw Error(p?.error||`Request failed (HTTP ${b.status})`);return p}finally{clearTimeout(c)}}function se(s){return`settings-model-option-${encodeURIComponent(s)}`}function je(s){if(!s||typeof s!=="object")return null;return[s.plan,s.availability,s.hint_short].filter(Boolean).join(" · ")||null}function Ce(s="recommended"){return{provider:"",publisher:"",family:"",reasoning:"all",variant:"",sort:s}}function He({filter:s="",onFilterChange:m=null}){let[l,h]=t(()=>Me()),[c,b]=t(null),[p,x]=t(()=>y()),[f,Q]=t(()=>Ce(y().sort)),[w,L]=t(!1),[S,j]=t(""),[X,ie]=t(!0),[de,Z]=t(null),[ue,pe]=t(null),[U,N]=t(""),[G,C]=t(null),[ge,me]=t(!1),ke=r(null),K=r(0),T=r(0),q=r(l);q.current=l;let k=n(async({quiet:a=!1}={})=>{let d=l,g=++K.current;if(!a||!c)ie(!0);if(!a)Z(null);try{let v=await Y(d);if(g!==K.current||d!==q.current)return null;let F=y(),V=P(v,{...ce(F)});return b(v),x(F),j((H)=>V.some((ne)=>ne.key===H)?H:V.find((ne)=>ne.current)?.key??V[0]?.key??""),Z(null),pe(null),{payload:v,catalogue:V}}catch(v){if(g!==K.current||d!==q.current)return null;let F=v?.name==="AbortError"?"Models request timed out.":v?.message||"Failed to load models.";if(c)pe(`${F} Showing the last loaded catalogue.`);else Z(F);return null}finally{if(g===K.current)ie(!1)}},[l,c]);o(()=>{T.current+=1,N(""),C(null),k()},[l]);let xe=n(async()=>{let a=++T.current;N("catalogues"),C(null);try{let d=await Gt();if(a!==T.current)return;if(await k({quiet:!0}),a!==T.current)return;C(Ne(d))}catch(d){if(a===T.current)C({type:"error",text:d?.message||"Model catalogues could not be updated."})}finally{if(a===T.current)N("")}},[k]);o(()=>{let a=(d)=>{let g=typeof d?.detail?.chatJid==="string"?d.detail.chatJid.trim():Me();if(g)h(g)};return window.addEventListener("piclaw:current-chat-changed",a),()=>window.removeEventListener("piclaw:current-chat-changed",a)},[]),o(()=>{let a=(g)=>x(g?.detail||y()),d=(g)=>{if(!g?.key||g.key==="piclaw:model-catalogue-preferences:v1")x(y())};return window.addEventListener(ae,a),window.addEventListener("storage",d),()=>{window.removeEventListener(ae,a),window.removeEventListener("storage",d)}},[]),o(()=>{let a=(v)=>{let F=v?.detail?.chatJid;if(!F||F===l)k({quiet:!0})},d=()=>void k({quiet:!0}),g=re(d,15000);return window.addEventListener("piclaw:model-state-changed",a),window.addEventListener("piclaw:sse-connected",a),window.addEventListener("focus",d),()=>{g(),window.removeEventListener("piclaw:model-state-changed",a),window.removeEventListener("piclaw:sse-connected",a),window.removeEventListener("focus",d)}},[l,k]);let D=i(()=>P(c,{...ce(p)}),[c,p]),W=i(()=>ye(D),[D]),_=i(()=>we(D,{query:s,providers:f.provider||null,publishers:f.publisher||null,families:f.family||null,reasoning:f.reasoning==="all"?null:f.reasoning==="yes",variants:f.variant||null,sort:f.sort},S),[D,s,f,S]),u=_.selectedEntry;o(()=>{if(!_.renderedEntries.some((a)=>a.key===S))j(_.renderedEntries[0]?.key??"")},[_.renderedEntries,S]);let B=(a,d)=>{if(Q((g)=>({...g,[a]:d})),a==="sort")x(cr(d))},Ee=()=>{Q(Ce(p.sort)),m?.("")},Se=(a)=>{let g={ArrowDown:"next",ArrowUp:"previous",Home:"first",End:"last",PageDown:"page-next",PageUp:"page-previous"}[a.key];if(!g)return;a.preventDefault();let v=be(_.renderedEntries,S,g);j(v),requestAnimationFrame(()=>{(v?document.getElementById(se(v)):null)?.scrollIntoView?.({block:"nearest"})})},Te=async()=>{if(!u||U)return;let a=l,d=++T.current;N("switch"),C(null);try{let g=await oe(`/model ${u.key}`,a);if(d!==T.current||a!==q.current)return;if(g?.command===!1||g?.error||g?.command?.status==="error")throw Error(g?.error||g?.command?.message||"Model switch failed.");let v=await Y(a);if(d!==T.current||a!==q.current)return;if((P(v,{...ce(p)}).find((H)=>H.current)?.key??M(v?.current??v?.model))!==u.key)throw Error("The server did not confirm the model switch.");K.current+=1,b(v),x(Pe(u.key)),C({type:"success",text:`Using ${u.key} for ${a}.`}),window.dispatchEvent(new CustomEvent("piclaw:model-state-changed",{detail:{chatJid:a,payload:v,source:"settings"}})),k({quiet:!0})}catch(g){if(d===T.current&&a===q.current)C({type:"error",text:g?.message||"Model switch failed."}),await k({quiet:!0})}finally{if(d===T.current)N("")}},Ae=async(a)=>{if(!u?.current||U)return;N("thinking"),C(null);try{let d=await oe(`/thinking ${a}`,l);if(d?.command===!1||d?.error||d?.command?.status==="error")throw Error(d?.error||d?.command?.message||"Thinking level change failed.");await k({quiet:!0}),C({type:"success",text:"Thinking level updated."})}catch(d){C({type:"error",text:d?.message||"Thinking level change failed."}),await k({quiet:!0})}finally{N("")}},Fe=async()=>{if(U)return;N("compact");try{let a=await oe("/compact",l);if(a?.command===!1||a?.error||a?.command?.status==="error")throw Error(a?.error||a?.command?.message||"Compaction request failed.");C({type:"success",text:"Context compaction requested. Switch after compaction completes."})}catch(a){C({type:"error",text:a?.message||"Compaction request failed."})}finally{N("")}},Le=async(a)=>{if(ge)return;me(!0);try{let d=await Ie("/agent/settings/general",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({scopedModelsOnly:Boolean(a)})});if(!d?.ok)throw Error(d?.error||"Failed to save scoped model setting.");await k({quiet:!0})}catch(d){C({type:"error",text:d?.message||"Failed to save scoped model setting."})}finally{me(!1)}},fe=(a=u?.key)=>{if(!a)return;x(Qe(a))},ve=(a)=>e`
        <div
            id=${se(a.key)}
            key=${a.key}
            role="option"
            aria-selected=${a.key===S?"true":"false"}
            aria-current=${a.current?"true":void 0}
            class=${`model-catalogue-settings__row${a.key===S?" selected":""}${a.current?" current":""}`}
            onClick=${()=>j(a.key)}
        >
            <button
                type="button"
                class="model-catalogue-settings__pin"
                aria-label=${a.pinned?`Unpin ${a.displayName}`:`Pin ${a.displayName}`}
                aria-pressed=${a.pinned?"true":"false"}
                title=${a.pinned?"Unpin model":"Pin model"}
                onClick=${(d)=>{d.stopPropagation(),fe(a.key)}}
            >${a.pinned?"★":"☆"}</button>
            <span class="model-catalogue-settings__row-main">
                <strong>${a.displayName}</strong>
                <code>${a.key}</code>
                <span class="model-catalogue-settings__row-mobile-meta">
                    <span>${J(a.contextWindow)||"Unknown context"}</span>
                    <span>${a.reasoning?"Reasoning":"Standard"}</span>
                    ${le(a.pricing)&&e`<span>${le(a.pricing)}</span>`}
                </span>
            </span>
            <span class="model-catalogue-settings__row-family">${a.family||a.publisher||"—"}</span>
            <span class="model-catalogue-settings__row-context">${J(a.contextWindow)||"Unknown"}</span>
            <span class="model-catalogue-settings__row-mode">${a.reasoning?"Reasoning":"Standard"}</span>
            <span class="model-catalogue-settings__row-input-price">${I(a.pricing?.inputPerMillion??null)}</span>
            <span class="model-catalogue-settings__row-output-price">${I(a.pricing?.outputPerMillion??null)}</span>
        </div>
    `,Re=(a)=>e`
        <div class="model-catalogue-settings__group" key=${a.key} role="group" aria-label=${a.label}>
            <div class="model-catalogue-settings__group-heading"><span>${a.label}</span><span>${a.totalCount}</span></div>
            ${a.entries.map(ve)}
        </div>
    `,O=c?.provider_diagnostics?.providers?.find((a)=>a.provider===u?.provider),he=u?.current?je(c?.provider_usage):null,ee=u?.thinkingLevels??[],Ue=c?.thinking_level??"",te=Array.isArray(c?.enabled_model_patterns)?c.enabled_model_patterns:[];if(X&&!c)return e`<div class="settings-loading" role="status">Loading model catalogue…</div>`;return e`
        <div class="model-catalogue-settings">
            <div class="model-catalogue-settings__header">
                <div>
                    <strong>Models for ${l}</strong>
                    <span>${D.length} available · ${_.totalMatches} matched${_.hiddenCount?` · ${_.renderedEntries.length} shown`:""}</span>
                </div>
                <span class="model-catalogue-settings__header-actions">
                    <button type="button" class="settings-btn" onClick=${()=>k()} disabled=${X}>${X?"Refreshing…":"Refresh"}</button>
                    <button type="button" class="settings-btn" title="Fetch the latest model lists from every provider (pi update --models)" onClick=${xe} disabled=${U==="catalogues"}>${U==="catalogues"?"Updating…":"Update catalogues"}</button>
                </span>
            </div>
            ${de&&e`<div class="model-catalogue-settings__notice error" role="alert">${de} <button type="button" onClick=${()=>k()}>Retry</button></div>`}
            ${ue&&e`<div class="model-catalogue-settings__notice warning" role="status">${ue}</div>`}
            ${G&&e`<div class=${`model-catalogue-settings__notice ${G.type}`} role=${G.type==="error"?"alert":"status"}>${G.text}</div>`}

            <div class="model-catalogue-settings__scope">
                <label><input type="checkbox" checked=${Boolean(c?.scoped_models_only)} disabled=${ge} onChange=${(a)=>Le(a.currentTarget.checked)} /> Use <code>enabledModels</code> to scope the catalogue and picker</label>
                <span>${c?.scoped_models_only?c?.scoped_model_filter_active?"enabledModels filter active":"Scope enabled, but no enabledModels patterns are available":"Showing the full provider catalogue"}</span>
            </div>
            <div class=${`model-catalogue-settings__enabled-models${c?.scoped_model_filter_active?" active":""}`}>
                <strong>enabledModels</strong>
                <span>${te.length?te.join(", "):"No patterns reported by the active Pi settings manager."}</span>
                <small>${te.length?`${D.length} catalogue entries after applying the configured patterns.`:"Configure enabledModels in Pi settings; this toggle only chooses whether Piclaw applies those patterns outside the TUI."}</small>
            </div>

            <div class="model-catalogue-settings__filter-disclosure">
                <button
                    type="button"
                    class="model-catalogue-settings__filter-toggle settings-btn"
                    aria-expanded=${w?"true":"false"}
                    aria-controls="classic-model-catalogue-filters"
                    onClick=${()=>L((a)=>!a)}
                >Filters and sorting</button>
                <div id="classic-model-catalogue-filters" class=${`model-catalogue-settings__filters${w?" expanded":""}`} aria-label="Model catalogue filters">
                    <select aria-label="Provider" value=${f.provider} onChange=${(a)=>B("provider",a.currentTarget.value)}><option value="">All providers</option>${W.providers.map((a)=>e`<option value=${a}>${a}</option>`)}</select>
                    <select aria-label="Publisher" value=${f.publisher} onChange=${(a)=>B("publisher",a.currentTarget.value)}><option value="">All publishers</option>${W.publishers.map((a)=>e`<option value=${a}>${a}</option>`)}</select>
                    <select aria-label="Family" value=${f.family} onChange=${(a)=>B("family",a.currentTarget.value)}><option value="">All families</option>${W.families.map((a)=>e`<option value=${a}>${a}</option>`)}</select>
                    <select aria-label="Reasoning" value=${f.reasoning} onChange=${(a)=>B("reasoning",a.currentTarget.value)}><option value="all">Any reasoning</option><option value="yes">Reasoning</option><option value="no">Non-reasoning</option></select>
                    <select aria-label="Variant" value=${f.variant} onChange=${(a)=>B("variant",a.currentTarget.value)}><option value="">All variants</option>${W.variants.map((a)=>e`<option value=${a}>${a}</option>`)}</select>
                    <select aria-label="Sort models" value=${f.sort} onChange=${(a)=>B("sort",a.currentTarget.value)}><option value="recommended">Recommended</option><option value="name">Name</option><option value="context">Context window</option><option value="input-price">Input price</option><option value="output-price">Output price</option></select>
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
                    aria-activedescendant=${_.renderedEntries.some((a)=>a.key===S)?se(S):void 0}
                    onKeyDown=${Se}
                >
                    <div class="model-catalogue-settings__columns" aria-hidden="true"><span>Pin</span><span>Model</span><span class="model-catalogue-settings__row-family">Family</span><span class="model-catalogue-settings__row-context">Context</span><span class="model-catalogue-settings__row-mode">Mode</span><span class="model-catalogue-settings__row-input-price">Input / 1M</span><span class="model-catalogue-settings__row-output-price">Output / 1M</span></div>
                    ${_.groups.map((a)=>e`
                        <div class="model-catalogue-settings__provider" key=${a.key} role="group" aria-label=${a.label}>
                            <div class="model-catalogue-settings__provider-heading"><span>${a.label}</span><span>${a.totalCount}</span></div>
                            ${a.entries.map(ve)}
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
                            <button type="button" class="settings-btn" onClick=${()=>fe()}>${u.pinned?"Unpin":"Pin"}</button>
                        </div>
                        <dl class="model-catalogue-settings__facts">
                            <div><dt>Access provider</dt><dd>${u.provider||"Unknown"}</dd></div>
                            <div><dt>Publisher</dt><dd>${u.publisher||"Unknown"}</dd></div>
                            <div><dt>Family</dt><dd>${u.family||"Unknown"}</dd></div>
                            <div><dt>Context window</dt><dd>${J(u.contextWindow)||"Unknown"}</dd></div>
                            <div><dt>Context fit</dt><dd>Unknown until the backend checks the model switch.</dd></div>
                            <div><dt>Reasoning</dt><dd>${u.reasoning?"Supported":"Not advertised"}</dd></div>
                            <div><dt>Variants</dt><dd>${u.variants.length?u.variants.join(", "):"Stable"}</dd></div>
                            <div><dt>Input / 1M</dt><dd>${I(u.pricing?.inputPerMillion??null)}</dd></div>
                            <div><dt>Output / 1M</dt><dd>${I(u.pricing?.outputPerMillion??null)}</dd></div>
                            <div><dt>Cache read / 1M</dt><dd>${I(u.pricing?.cacheReadPerMillion??null)}</dd></div>
                            <div><dt>Cache write / 1M</dt><dd>${I(u.pricing?.cacheWritePerMillion??null)}</dd></div>
                            <div><dt>Last used</dt><dd>${_e(u.lastUsedAt)}</dd></div>
                            <div><dt>Status</dt><dd>${u.current?"Current model":u.pinned?"Pinned":"Available"}</dd></div>
                        </dl>
                        <div class="model-catalogue-settings__thinking">
                            <strong>Thinking levels</strong>
                            ${ee.length?e`
                                <select aria-label="Thinking level" disabled=${!u.current||U} value=${u.current?Ue:""} onChange=${(a)=>Ae(a.currentTarget.value)}>
                                    ${!u.current&&e`<option value="">Switch to this model to change thinking</option>`}
                                    ${ee.map((a)=>e`<option value=${a.id}>${a.label}</option>`)}
                                </select>
                                <span>${ee.map((a)=>a.label).join(", ")}</span>
                            `:e`<span>No server-provided thinking levels.</span>`}
                        </div>
                        <div class="model-catalogue-settings__diagnostics">
                            <strong>Provider diagnostics</strong>
                            ${O?e`<span>${O.auth_configured?"Authenticated":"Credentials not configured"} · ${O.available_model_count} available of ${O.model_count} advertised${O.auth_source?` · ${O.auth_source}`:""}</span>`:e`<span>No provider diagnostics available.</span>`}
                            ${c?.provider_diagnostics?.composition_error&&e`<span class="error">${c.provider_diagnostics.composition_error}</span>`}
                            ${he&&e`<span>${he}</span>`}
                        </div>
                        <div class="model-catalogue-settings__actions">
                            <button type="button" class="settings-btn primary" disabled=${u.current||Boolean(U)} onClick=${Te}>${u.current?"Current model":U==="switch"?"Switching…":"Use for current chat"}</button>
                            <button type="button" class="settings-btn" disabled=${Boolean(U)} onClick=${Fe}>Compact context</button>
                            <button type="button" class="settings-btn" onClick=${()=>navigator.clipboard?.writeText?.(u.key)}>Copy model key</button>
                            <button type="button" class="settings-btn" onClick=${()=>A({section:"providers"})}>Provider settings</button>
                        </div>
                    `:e`<div class="settings-empty">Select a model to inspect it.</div>`}
                </aside>
            </div>
        </div>
    `}export{He as ModelsSection};

//# debugId=B1FAAADE693CD2CB64756E2164756E21
//# sourceMappingURL=models-xsn1s20d.js.map
