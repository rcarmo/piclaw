import{t,o,r,i,n,e}from"./app-ppf3jt10.js";import{s}from"./app-4p6zhgna.js";function Ee(N){if(!N)return"—";try{return new Date(N).toLocaleDateString(void 0,{month:"short",day:"numeric",year:"numeric"})}catch{return N}}var Fe=["secret","token","password","basic"],je=0;function Ie({filter:N=""}){let{t:l}=s(),K=r(null);if(!K.current)K.current=`settings-keychain-${++je}`;let ve=K.current,C=(a)=>`${ve}-keychain-${a}`,L=r(null),B=r(new Map),M=r(new Map),_=r(new Map),G=r(null),F=r(null),[fe,j]=t(""),w=(a,c=null)=>{F.current={kind:a,name:c}},T=(a)=>{w("reveal",a),k(null)},[D,be]=t([]),[q,X]=t(!0),[Z,we]=t(null),[ee,g]=t(null),[f,te]=t(!1),[P,ne]=t(""),[I,se]=t(""),[H,ae]=t(""),[U,ie]=t(""),[V,re]=t(""),[Y,oe]=t("secret"),[z,ce]=t(!1),[J,le]=t({}),[xe,de]=t(null),[O,W]=t(null),[y,k]=t(null),he=r(null),ue=r(null),pe=r(null),b=n(async()=>{X(!0),g(null);try{let c=await(await fetch("/agent/keychain")).json();if(c?.ok)be(c.entries||[]),we(c.status||null);else g(c?.error||l("settings.keychain.loadFailed"))}catch{g(l("settings.keychain.loadFailed"))}finally{X(!1)}},[]);o(()=>{b()},[b]);let Ne=n(async()=>{let a=P.trim(),c=I;if(!a||!c)return;ce(!0);try{let u=await(await fetch("/agent/keychain",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({name:a,secret:c,type:Y,username:H.trim()||void 0,userNote:U,agentNote:V})})).json();if(u?.ok)w("add"),j("Keychain entry saved."),ne(""),se(""),ae(""),ie(""),re(""),oe("secret"),te(!1),await b();else g(u?.error||l("settings.keychain.addFailed"))}catch{g(l("settings.keychain.addFailed"))}finally{ce(!1)}},[P,I,H,U,V,Y,b]),Ce=n(async(a)=>{try{let h=await(await fetch("/agent/keychain",{method:"DELETE",headers:{"Content-Type":"application/json"},body:JSON.stringify({name:a})})).json();if(h?.ok)w("add"),j("Keychain entry deleted."),W(null),k((u)=>u?.name===a?null:u),await b();else g(h?.error||l("settings.keychain.deleteFailed"))}catch{g(l("settings.keychain.deleteFailed"))}},[b]),Pe=n(async(a)=>{let c=a?.name;if(!c)return;let h=J[c]||{},u=Object.prototype.hasOwnProperty.call(h,"userNote")?h.userNote:a.userNote||"",p=Object.prototype.hasOwnProperty.call(h,"agentNote")?h.agentNote:a.agentNote||"";de(c);try{let x=await(await fetch("/agent/keychain/notes",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({name:c,userNote:u,agentNote:p})})).json();if(x?.ok)w("notes",c),j("Keychain notes saved."),le((R)=>{let E={...R||{}};return delete E[c],E}),await b();else g(x?.error||l("settings.keychain.saveNotesFailed"))}catch{g(l("settings.keychain.saveNotesFailed"))}finally{de(null)}},[J,b]),ye=n((a,c,h)=>{le((u)=>({...u||{},[a]:{...(u||{})[a]||{},[c]:h}}))},[]),S=n(async(a,c,h)=>{try{let p=await(await fetch("/agent/keychain/reveal",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({name:a,master_password:c||void 0,totp_code:h||void 0})})).json();if(p?.ok)w("reveal",a),j("Secret revealed."),k({name:a,phase:"revealed",secret:p.secret,username:p.username,masterPassword:c});else if(p?.needs_master_password)k((v)=>({name:a,phase:"password",masterPassword:"",error:v?.name===a&&v?.masterPassword?p.error:null})),requestAnimationFrame(()=>ue.current?.focus());else if(p?.needs_totp)k((v)=>({name:a,phase:"totp",masterPassword:c,totpCode:"",error:v?.name===a&&v?.phase==="totp"&&v?.totpCode?p.error:null})),requestAnimationFrame(()=>pe.current?.focus());else k({name:a,phase:"error",error:p?.error||l("settings.keychain.revealFailed")})}catch{k({name:a,phase:"error",error:l("settings.keychain.revealFailed")})}},[]),Se=n((a)=>{if(y?.name===a&&y?.phase==="revealed"){k(null);return}S(a,null,null)},[y,S]),ge=n((a)=>{let c=y?.masterPassword||"";if(!c)return;S(a,c,null)},[y,S]),ke=n((a)=>{let c=y?.totpCode||"";if(c.length<6)return;S(a,y?.masterPassword,c)},[y,S]),me=n(async(a)=>{try{await navigator.clipboard.writeText(a)}catch{let c=document.createElement("textarea");c.value=a,c.style.position="fixed",c.style.opacity="0",document.body.appendChild(c),c.select(),document.execCommand("copy"),document.body.removeChild(c)}},[]);o(()=>{if(q||!F.current)return;let a=F.current,c=requestAnimationFrame(()=>{F.current=null;let h=a.kind==="reveal"?B:a.kind==="delete"?M:_,u=a.kind==="add"?L.current:h.current.get(a.name),p=a.kind==="notes"&&u?.disabled?u.parentElement?.querySelector("textarea"):u;(p?.isConnected&&!p.disabled?p:L.current)?.focus()});return()=>cancelAnimationFrame(c)},[q,f,y,O,D]),o(()=>{if(!O)return;let a=requestAnimationFrame(()=>G.current?.focus());return()=>cancelAnimationFrame(a)},[O]),o(()=>{if(f)requestAnimationFrame(()=>he.current?.focus())},[f]);let m=N.toLowerCase(),A=i(()=>{if(!m)return D;return D.filter((a)=>a.name.toLowerCase().includes(m)||(a.type||"").toLowerCase().includes(m)||(a.envVar||"").toLowerCase().includes(m)||(a.userNote||"").toLowerCase().includes(m)||(a.agentNote||"").toLowerCase().includes(m))},[D,m]);if(q)return e`<div class="settings-section"><div class="settings-loading">${l("settings.keychain.loading")}</div></div>`;return e`
        <div class="settings-section">
            <div role="status" aria-live="polite" aria-atomic="true">${fe}</div>
            ${ee&&e`
                <div class="settings-keychain-error" role="alert">
                    ${ee}
                    <button class="settings-keychain-dismiss" aria-label="Dismiss keychain error" onClick=${()=>g(null)}>✕</button>
                </div>
            `}
            ${Z?.enabled===!1&&e`<div class="settings-keychain-error" role="status">Keychain storage is disabled. Configure PICLAW_KEYCHAIN_KEY or PICLAW_KEYCHAIN_KEY_FILE on the server before adding secrets.</div>`}
            <div class="settings-keychain-toolbar" style="display:flex; align-items:center; justify-content:space-between; gap:12px; flex-wrap:wrap;">
                <span class="settings-hint" style="margin:0; display:flex; align-items:center; gap:8px; flex-wrap:wrap;">
                    <span>${A.length===1?l("settings.keychain.entryCountSingular",{count:A.length}):l("settings.keychain.entryCountPlural",{count:A.length})}${m?l("settings.keychain.matchingFilter",{filter:N}):""}${l("settings.keychain.encryptedSuffix")}</span>
                    <span style="display:inline-flex; align-items:center; gap:6px;">
                        <span>${l("settings.keychain.clickPrefix")}</span>
                        <span aria-hidden="true" style="display:inline-flex; width:18px; height:18px; align-items:center; justify-content:center; border-radius:999px; border:1px solid var(--border-color, rgba(120,120,120,.22)); background:var(--panel-bg, rgba(255,255,255,.04));">
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
                        </span>
                        <span>${l("settings.keychain.revealSuffix")}</span>
                    </span>
                </span>
                <button ref=${L} class="settings-keychain-add-btn" disabled=${Z?.enabled===!1} aria-expanded=${f} aria-controls=${C("add-form")} onClick=${()=>{if(f)w("add");te(!f)}}>
                    ${f?l("settings.keychain.cancel"):l("settings.keychain.addEntry")}
                </button>
            </div>

            ${f&&e`
                <div id=${C("add-form")} class="settings-keychain-add-form" role="group" aria-label="Add keychain entry" aria-busy=${z}>
                    <div class="settings-keychain-add-row">
                        <input ref=${he} type="text" aria-label="Entry name" required aria-invalid=${P.length>0&&!P.trim()?"true":void 0} placeholder=${l("settings.keychain.namePlaceholder")}
                            value=${P} onInput=${(a)=>ne(a.target.value)}
                            class="settings-keychain-input" />
                        <select aria-label="Entry type" value=${Y} onChange=${(a)=>oe(a.target.value)}
                            class="settings-keychain-select">
                            ${Fe.map((a)=>e`<option value=${a}>${a}</option>`)}
                        </select>
                    </div>
                    <div class="settings-keychain-add-row">
                        <input type="password" aria-label="Entry secret" required placeholder=${l("settings.keychain.secretPlaceholder")}
                            value=${I} onInput=${(a)=>se(a.target.value)}
                            class="settings-keychain-input settings-keychain-secret" />
                        <input type="text" aria-label="Entry username" placeholder=${l("settings.keychain.usernamePlaceholder")}
                            value=${H} onInput=${(a)=>ae(a.target.value)}
                            class="settings-keychain-input" style="max-width:200px" />
                        <button class="settings-keychain-save-btn" onClick=${Ne}
                            disabled=${z||!P.trim()||!I}>
                            ${z?l("settings.keychain.saving"):l("settings.keychain.save")}
                        </button>
                    </div>
                    <div class="settings-keychain-add-row" style="align-items:stretch">
                        <textarea aria-label=${l("settings.keychain.userNote")} placeholder=${l("settings.keychain.userNotePlaceholder")}
                            value=${U} onInput=${(a)=>ie(a.target.value)}
                            class="settings-keychain-input" rows="2" style="resize:vertical; min-height:56px"></textarea>
                        <textarea aria-label=${l("settings.keychain.agentNote")} placeholder=${l("settings.keychain.agentNotePlaceholder")}
                            value=${V} onInput=${(a)=>re(a.target.value)}
                            class="settings-keychain-input" rows="2" style="resize:vertical; min-height:56px"></textarea>
                    </div>
                </div>
            `}

            <div class="settings-keychain-table-wrap">
                <table class="settings-table settings-keychain-table">
                    <thead>
                        <tr>
                            <th>Name</th>
                            <th>Type</th>
                            <th>Env var</th>
                            <th>Updated</th>
                            <th></th>
                        </tr>
                    </thead>
                    <tbody>
                        ${A.length===0&&e`
                            <tr><td colspan="5" class="settings-keychain-empty">
                                ${m?l("settings.keychain.noMatchFilter"):l("settings.keychain.noEntries")}
                            </td></tr>
                        `}
                        ${A.map((a)=>{let c=y?.name===a.name?y:null,h=c?.phase==="revealed",u=c?.phase==="password",p=c?.phase==="totp",v=c?.phase==="error",x=J[a.name]||{},R=Object.prototype.hasOwnProperty.call(x,"userNote")?x.userNote:a.userNote||"",E=Object.prototype.hasOwnProperty.call(x,"agentNote")?x.agentNote:a.agentNote||"",Ae=R!==(a.userNote||"")||E!==(a.agentNote||""),$e=xe===a.name;return e`
                            <tr class="settings-keychain-row" key=${a.name}>
                                <td class="settings-keychain-name">${a.name}<span class="settings-keychain-type-inline">${a.type}</span></td>
                                <td><span class="settings-keychain-type-badge">${a.type}</span></td>
                                <td class="settings-keychain-env">${a.envVar?e`<code>$${a.envVar}</code>`:"—"}</td>
                                <td class="settings-keychain-date">${Ee(a.updatedAt)}</td>
                                <td class="settings-keychain-actions">
                                    <div class="settings-keychain-action-group">
                                    <button ref=${(d)=>{if(d)B.current.set(a.name,d);else B.current.delete(a.name)}} aria-label=${`${h?l("settings.keychain.hideSecret"):l("settings.keychain.revealSecret")}: ${a.name}`} aria-expanded=${Boolean(c)} class=${`settings-keychain-reveal-btn${h?" active":""}`}
                                        onClick=${()=>Se(a.name)}
                                        title=${h?l("settings.keychain.hideSecret"):l("settings.keychain.revealSecret")}>
                                        ${h?e`<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/><path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/><line x1="1" y1="1" x2="23" y2="23"/></svg>`:e`<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>`}
                                    </button>
                                    ${O===a.name?e`
                                            <span class="settings-keychain-confirm">${l("settings.keychain.deleteQ")}
                                                <button ref=${G} aria-label=${`Delete ${a.name}`} class="settings-keychain-confirm-yes" onClick=${()=>Ce(a.name)}>${l("settings.keychain.yes")}</button>
                                                <button class="settings-keychain-confirm-no" onClick=${()=>{w("delete",a.name),W(null)}}>${l("settings.keychain.no")}</button>
                                            </span>
                                        `:e`<button ref=${(d)=>{if(d)M.current.set(a.name,d);else M.current.delete(a.name)}} aria-label=${`Delete ${a.name}`} class="settings-keychain-delete-btn" onClick=${()=>W(a.name)} title=${l("settings.keychain.deleteTitle")}>🗑</button>`}
                                    </div>
                                </td>
                            </tr>
                            <tr class="settings-keychain-notes-row" key=${a.name+"-notes"}>
                                <td colspan="5">
                                    <div class="settings-keychain-notes">
                                        <label class="settings-keychain-note">
                                            <span class="settings-hint" style="margin:0">${l("settings.keychain.userNote")}</span>
                                            <textarea class="settings-keychain-input settings-keychain-note-input" rows="2" placeholder=${l("settings.keychain.userNoteHint")}
                                                value=${R}
                                                onInput=${(d)=>ye(a.name,"userNote",d.target.value)}></textarea>
                                        </label>
                                        <label class="settings-keychain-note">
                                            <span class="settings-hint" style="margin:0">${l("settings.keychain.agentNote")}</span>
                                            <textarea class="settings-keychain-input settings-keychain-note-input" rows="2" placeholder=${l("settings.keychain.agentNoteHint")}
                                                value=${E}
                                                onInput=${(d)=>ye(a.name,"agentNote",d.target.value)}></textarea>
                                        </label>
                                        <button ref=${(d)=>{if(d)_.current.set(a.name,d);else _.current.delete(a.name)}} aria-label=${`${l("settings.keychain.saveNotes")}: ${a.name}`} class="settings-keychain-save-btn" disabled=${!Ae||$e} onClick=${()=>Pe(a)}>
                                            ${$e?l("settings.keychain.saving"):l("settings.keychain.saveNotes")}
                                        </button>
                                    </div>
                                </td>
                            </tr>
                            ${u&&e`
                                <tr class="settings-keychain-prompt-row" key=${a.name+"-pw"}>
                                    <td colspan="5">
                                        <div class="settings-keychain-prompt">
                                            <span class="settings-keychain-prompt-label">${l("settings.keychain.masterPassword")}</span>
                                            <input ref=${ue} aria-label=${l("settings.keychain.masterPassword")} aria-invalid=${c?.error?"true":void 0} aria-describedby=${c?.error?C("reveal-error"):void 0} type="password" autocomplete="off"
                                                placeholder=${l("settings.keychain.masterPasswordPlaceholder")}
                                                class="settings-keychain-prompt-input"
                                                value=${c?.masterPassword||""}
                                                onInput=${(d)=>k((Q)=>({...Q,masterPassword:d.target.value}))}
                                                onKeyDown=${(d)=>{if(d.key==="Enter")ge(a.name);if(d.key==="Escape")d.preventDefault(),d.stopPropagation(),T(a.name)}}
                                            />
                                            <button class="settings-keychain-prompt-submit" onClick=${()=>ge(a.name)}
                                                disabled=${!c?.masterPassword}>${l("settings.keychain.unlock")}</button>
                                            <button class="settings-keychain-prompt-cancel" onClick=${()=>T(a.name)}>${l("settings.keychain.cancel")}</button>
                                            ${c?.error&&e`<span id=${C("reveal-error")} class="settings-keychain-prompt-error" role="alert">${c.error}</span>`}
                                        </div>
                                    </td>
                                </tr>
                            `}
                            ${p&&e`
                                <tr class="settings-keychain-prompt-row" key=${a.name+"-totp"}>
                                    <td colspan="5">
                                        <div class="settings-keychain-prompt">
                                            <span class="settings-keychain-prompt-label">${l("settings.keychain.totpCode")}</span>
                                            <input ref=${pe} aria-label=${l("settings.keychain.totpCode")} aria-invalid=${c?.error?"true":void 0} aria-describedby=${c?.error?C("reveal-error"):void 0} type="text" inputmode="numeric" autocomplete="one-time-code"
                                                maxlength="6" placeholder="000000"
                                                class="settings-keychain-prompt-input" style="width:90px;text-align:center;letter-spacing:0.15em"
                                                value=${c?.totpCode||""}
                                                onInput=${(d)=>k((Q)=>({...Q,totpCode:d.target.value.replace(/\\D/g,"").slice(0,6)}))}
                                                onKeyDown=${(d)=>{if(d.key==="Enter")ke(a.name);if(d.key==="Escape")d.preventDefault(),d.stopPropagation(),T(a.name)}}
                                            />
                                            <button class="settings-keychain-prompt-submit" onClick=${()=>ke(a.name)}
                                                disabled=${(c?.totpCode||"").length<6}>${l("settings.keychain.verify")}</button>
                                            <button class="settings-keychain-prompt-cancel" onClick=${()=>T(a.name)}>${l("settings.keychain.cancel")}</button>
                                            ${c?.error&&e`<span id=${C("reveal-error")} class="settings-keychain-prompt-error" role="alert">${c.error}</span>`}
                                        </div>
                                    </td>
                                </tr>
                            `}
                            ${h&&e`
                                <tr class="settings-keychain-reveal-row" key=${a.name+"-reveal"}>
                                    <td colspan="5">
                                        <div class="settings-keychain-reveal-panel">
                                            ${c.username&&e`
                                                <div class="settings-keychain-reveal-field">
                                                    <span class="settings-keychain-reveal-label">${l("settings.keychain.username")}</span>
                                                    <code class="settings-keychain-reveal-value">${c.username}</code>
                                                    <button class="settings-keychain-copy-btn" onClick=${()=>me(c.username)} title=${l("settings.keychain.copyUsername")}>
                                                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
                                                    </button>
                                                </div>
                                            `}
                                            <div class="settings-keychain-reveal-field">
                                                <span class="settings-keychain-reveal-label">${l("settings.keychain.secret")}</span>
                                                <code class="settings-keychain-reveal-value">${c.secret}</code>
                                                <button class="settings-keychain-copy-btn" onClick=${()=>me(c.secret)} title=${l("settings.keychain.copySecret")}>
                                                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
                                                </button>
                                            </div>
                                        </div>
                                    </td>
                                </tr>
                            `}
                            ${v&&e`
                                <tr class="settings-keychain-reveal-row" key=${a.name+"-error"}>
                                    <td colspan="5">
                                        <div class="settings-keychain-reveal-panel" role="alert" style="color: var(--error-color, #e55)">${c.error}</div>
                                    </td>
                                </tr>
                            `}
                        `})}
                    </tbody>
                </table>
            </div>
        </div>
    `}export{Ie as KeychainSection};

//# debugId=85E5F68C73A9F19A64756E2164756E21
//# sourceMappingURL=keychain-ykvrdtqk.js.map
