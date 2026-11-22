import{t,o,u,r,i,n,e}from"./app-c7xgjke0.js";import{q,bn,E,vn,$e,z,wn}from"./app-jrfwvagp.js";import{p}from"./app-8f7dkwd2.js";import{Ae,Ln,s}from"./app-dr786pqe.js";var yt=e`<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>`,bt=e`<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="4 17 10 11 4 5"/><line x1="12" y1="19" x2="20" y2="19"/></svg>`;function ae(a,h){if(a===""||a===null||a===void 0)return h;let d=Number(a);return Number.isFinite(d)?d:h}function le(a,{min:h=-1/0,max:d=1/0}={}){let c=Number.isFinite(Number(h))?Number(h):-1/0,v=Number.isFinite(Number(d))?Number(d):1/0;return Math.min(v,Math.max(c,Number(a)))}function _e(a,{fallback:h=0,min:d=-1/0,max:c=1/0}={}){let v=ae(a,h);return le(v,{min:d,max:c})}function Ce(a,{direction:h=1,step:d=1,fallback:c=0,min:v=-1/0,max:b=1/0}={}){let k=_e(a,{fallback:c,min:v,max:b}),w=Math.abs(ae(d,1))||1,P=Number(h)<0?-1:1;return le(k+P*w,{min:v,max:b})}function m({value:a,min:h,max:d,step:c=1,fallback:v,width:b="80px",disabled:k=!1,label:w,id:P,onChange:S}){let x=Number.isFinite(Number(v))?Number(v):_e(a,{fallback:0,min:h,max:d}),[L,D]=t(String(a??x)),B=r(!1);o(()=>{if(!B.current)D(String(a??x))},[a,x]);let K=n((y)=>{B.current=!1;let R=_e(y,{fallback:x,min:h,max:d});D(String(R)),S?.(R)},[x,h,d,S]),F=n((y)=>{B.current=!1;let R=Ce(a,{direction:y,step:c,fallback:x,min:h,max:d});D(String(R)),S?.(R)},[x,d,h,S,c,a]);return e`
        <span class="settings-number-stepper">
            <button
                type="button"
                class="settings-number-step-btn"
                aria-label=${`Decrease ${w||"value"}`}
                title=${`Decrease ${w||"value"}`}
                disabled=${k}
                onClick=${()=>F(-1)}
            >−</button>
            <input
                id=${P}
                aria-label=${w||void 0}
                aria-invalid=${B.current&&(L.trim()===""||!Number.isFinite(Number(L))||h!=null&&Number(L)<h||d!=null&&Number(L)>d)?"true":void 0}
                class="settings-number-input"
                type="text"
                inputmode="numeric"
                pattern="[0-9]*"
                value=${L}
                disabled=${k}
                style=${`width:${b}`}
                onInput=${(y)=>{B.current=!0,D(y.target.value)}}
                onBlur=${(y)=>K(y.target.value)}
                onKeyDown=${(y)=>{if(y.key==="Enter")y.preventDefault(),K(y.target.value),y.target.blur()}}
            />
            <button
                type="button"
                class="settings-number-step-btn"
                aria-label=${`Increase ${w||"value"}`}
                title=${`Increase ${w||"value"}`}
                disabled=${k}
                onClick=${()=>F(1)}
            >+</button>
        </span>
    `}function ce(a,h){let d=String(a||"").trim();if(!d)return"";if(d.startsWith("data:")||d.startsWith("blob:"))return d;return h==="agent"||h==="user"?`/avatar/${h}`:""}function de({value:a,kind:h,label:d,onChange:c}){let{t:v}=s(),b=r(null),[k,w]=t(ce(a,h));o(()=>{w(ce(a,h))},[h,a]);let P=n((S)=>{let x=S.target.files?.[0];if(!x)return;let L=new FileReader;L.onload=()=>{let D=L.result;w(D),c?.(D)},L.readAsDataURL(x)},[c]);return e`
        <button type="button" class="settings-avatar-inline" data-settings-button="unstyled" onClick=${()=>b.current?.click()}
            title=${v("settings.general.avatarUpload")} aria-label=${`${v("settings.general.avatarUpload")}: ${d}`}>
            ${k?e`<img src=${k} alt="" />`:e`<span class="settings-avatar-placeholder" aria-hidden="true">+</span>`}
        </button>
        <input type="file" accept="image/*" ref=${b} style="display:none" tabindex="-1" aria-hidden="true" onChange=${P} />
    `}function ue(a={}){return{userName:a.userName||"",userAvatar:a.userAvatar||"",assistantName:a.assistantName||"",assistantAvatar:a.assistantAvatar||"",workspaceUploadLimitMb:a.workspaceUploadLimitMb??256}}var Me=0;function se({settingsData:a,setStatus:h,mergeSettingsData:d}){let{t:c}=s(),v=r(null);if(!v.current)v.current=`settings-general-${++Me}`;let b=v.current,k=(C)=>`${b}-general-${C}`,[w,P]=t(""),[S,x]=t(""),[L,D]=t(""),[B,K]=t(""),[F,y]=t(256),[R,W]=t(!1),V=r(""),U=r(null),N=r(!0);o(()=>(N.current=!0,()=>{N.current=!1}),[]);let _=n((C)=>{let I=ue(C);P(I.userName),x(I.userAvatar),D(I.assistantName),K(I.assistantAvatar),y(I.workspaceUploadLimitMb),V.current=JSON.stringify(I)},[]);o(()=>{_(a||{})},[a,_]);let H=i(()=>JSON.stringify(ue({userName:w,userAvatar:S,assistantName:L,assistantAvatar:B,workspaceUploadLimitMb:F})),[w,S,L,B,F]);o(()=>{if(H===V.current)return;if(U.current)clearTimeout(U.current);return U.current=setTimeout(async()=>{if(!N.current)return;try{let C=await fetch("/agent/settings/general",{method:"POST",headers:{"Content-Type":"application/json"},body:H}),I=await C.json().catch(()=>({}));if(!N.current)return;if(!C.ok||!I?.ok||!I?.settings)throw Error(I?.error||`Failed to save general settings (${C.status})`);V.current=H,d?.(I.settings),h?.(null),W(!0),setTimeout(()=>{if(N.current)W(!1)},4000)}catch(C){if(console.warn("[settings/general] Failed to persist general settings snapshot.",C),N.current)h?.(String(C?.message||C),"error")}},800),()=>{if(U.current)clearTimeout(U.current)}},[H,d,h]);let Q=typeof window<"u"&&window.isSecureContext;return e`
        <div class="settings-section">
            ${R&&e`
                <div class="settings-general-applied-notice" role="status" aria-live="polite">
                    ${c("settings.appliedNotice")}
                </div>
            `}
            <h3>${c("settings.general.identity")}</h3>
            <div class="settings-row">
                <label for=${k("user")}>${c("settings.general.userLabel")}</label>
                <div class="settings-identity-field">
                    <${de} kind="user" label=${c("settings.general.userLabel")} value=${S} onChange=${x} />
                    <input id=${k("user")} type="text" value=${w} onInput=${(C)=>P(C.target.value)} placeholder=${c("settings.general.yourName")} />
                </div>
            </div>
            <div class="settings-row">
                <label for=${k("agent")}>${c("settings.general.agentLabel")}</label>
                <div class="settings-identity-field">
                    <${de} kind="agent" label=${c("settings.general.agentLabel")} value=${B} onChange=${K} />
                    <input id=${k("agent")} type="text" value=${L} onInput=${(C)=>D(C.target.value)} placeholder=${c("settings.general.agentName")} />
                </div>
            </div>

            <h3 style="margin-top:20px">${c("settings.general.notifications")}</h3>
            ${Q?e`
                <div class="settings-row">
                    <label>${c("settings.general.browserNotifications")}</label>
                    <div style="display:flex; align-items:center; gap:10px;">
                        <span class="settings-hint" style="margin:0">
                            ${c("settings.general.notifSecureHint")}
                        </span>
                    </div>
                </div>
            `:e`
                <div class="settings-row">
                    <label>${c("settings.general.browserNotifications")}</label>
                    <div style="display:flex; align-items:center; gap:10px;">
                        <span class="settings-hint" style="margin:0; color: var(--error-color, #e55)">
                            ${c("settings.general.notifInsecureHint")}
                        </span>
                    </div>
                </div>
            `}

            <h3 style="margin-top:20px">${c("settings.general.instanceConfig")}</h3>
            <div class="settings-row">
                <label for=${k("workspace")}>${c("settings.general.uploadLimit")}</label>
                <${m}
                    id=${k("workspace")}
                    label=${c("settings.general.uploadLimit")}
                    value=${F}
                    min=${1}
                    max=${1024}
                    fallback=${256}
                    width="80px"
                    onChange=${y}
                />
                <span class="settings-hint" style="margin:0">${c("settings.general.uploadLimitHint")}</span>
            </div>

            <section class="settings-about" aria-label="About">
                <h3>About</h3>
                <${wn} versions=${a?.runtimeVersions} />
            </section>
        </div>
    `}var G=[];function J(a){G.push({ts:performance.now(),label:a})}function Le(){if(!G.length)return;let a=G[0].ts,h=G.map((d)=>`+${(d.ts-a).toFixed(1)}ms ${d.label}`);console.info(`[settings-dialog perf]
`+h.join(`
`));try{window.__piclawSettingsPerfLog=h}catch(d){}try{fetch("/agent/client-perf",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({label:"settings-dialog",lines:h})}).catch((d)=>{})}catch(d){}G.length=0}var pe=null;J("module-eval-start");J("imports-done");var ee=new Map,X=new Map;ee.set("general",se);var be={general:()=>Promise.resolve(se),authentication:()=>(p("3fj85m4w"),import("./authentication-3fj85m4w.js")).then((a)=>a.AuthenticationSection),sessions:()=>(p("xgzhxa7b"),import("./sessions-xgzhxa7b.js")).then((a)=>a.SessionsSection),compaction:()=>(p("fsex0yjm"),import("./compaction-fsex0yjm.js")).then((a)=>a.CompactionSection),mcp:()=>(p("we5z85g3"),import("./mcp-we5z85g3.js")).then((a)=>a.McpSection),optimizer:()=>(p("ykd4pm8a"),import("./optimizer-ykd4pm8a.js")).then((a)=>a.OptimizerSection),keyboard:()=>(p("svw46xpk"),import("./keyboard-svw46xpk.js")).then((a)=>a.KeyboardSection),workspace:()=>(p("n1010b2a"),import("./workspace-n1010b2a.js")).then((a)=>a.WorkspaceSection),environment:()=>(p("27qat201"),import("./environment-27qat201.js")).then((a)=>a.EnvironmentSection),providers:()=>(p("kf8204jg"),import("./providers-kf8204jg.js")).then((a)=>a.ProvidersSection),models:()=>(p("v5wy8bf8"),import("./models-v5wy8bf8.js")).then((a)=>a.ModelsSection),theme:()=>(p("4b93brev"),import("./appearance-4b93brev.js")).then((a)=>a.ThemeSection),"scheduled-tasks":()=>(p("73awdcsw"),import("./scheduled-tasks-73awdcsw.js")).then((a)=>a.ScheduledTasksSection),"quick-actions":()=>(p("kvf5ex0s"),import("./quick-actions-kvf5ex0s.js")).then((a)=>a.QuickActionsSection),keychain:()=>(p("nz2gfdp4"),import("./keychain-nz2gfdp4.js")).then((a)=>a.KeychainSection),tools:()=>(p("hwr0cwnj"),import("./tools-hwr0cwnj.js")).then((a)=>a.ToolsSection),addons:()=>(p("k9vsjg3k"),import("./addons-k9vsjg3k.js")).then((a)=>a.AddonsSection)},Z=[{id:"editor",label:"Editor",icon:yt,order:150,load:()=>(p("v67r0adv"),import("./editor-settings-v67r0adv.js"))},{id:"delegate",label:"Delegate",icon:z(),order:30.25,load:()=>import(q("delegate-settings")).then((h)=>h.registerDelegateSettings({html:e,useState:t,useEffect:o,useCallback:n,registerSettingsPane:E,notifySettingsPanesChanged:$e}))},{id:"developer",label:"Developer",icon:bt,order:900,load:()=>(p("75mqhxst"),import("./developer-settings-75mqhxst.js"))}],ie=new Map,ge=(a)=>Object.hasOwn(be,a)||Z.some((h)=>h.id===a)||vn().some((h)=>h.id===a);function Ne(a){let h=ee.get(a);if(h)return Promise.resolve(h);let d=X.get(a);if(d)return d;let c=be[a]().then((v)=>(ee.set(a,v),X.delete(a),v)).catch((v)=>{throw X.delete(a),v});return X.set(a,c),c}function Y(a="Loading…"){return e`
        <div class="settings-loading settings-loading-pane" role="status" aria-live="polite">
            <span class="settings-spinner"></span>
            <span>${a}</span>
        </div>
    `}var Ee=e`<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M8.5 5.9L9.6 2.3h4.8l1.1 3.6 3.7-.8 2.4 4.1-2.6 2.8 2.6 2.8-2.4 4.1-3.7-.8-1.1 3.6H9.6l-1.1-3.6-3.7.8-2.4-4.1L5 12 2.4 9.2l2.4-4.1z"/></svg>`,De=e`<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>`,Ie=e`<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 1 0 3-6.7"/><polyline points="3 4 3 10 9 10"/><path d="M12 7v5l3 3"/></svg>`,Pe=e`<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>`,Te=e`<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16"/><path d="M4 12h16"/><path d="M4 17h16"/><path d="M8 7v10"/><path d="M16 7v10"/></svg>`,Be=e`<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="5" width="20" height="14" rx="2"/><path d="M6 9h.01"/><path d="M10 9h.01"/><path d="M14 9h.01"/><path d="M18 9h.01"/><path d="M8 13h.01"/><path d="M12 13h.01"/><path d="M16 13h.01"/><path d="M7 17h10"/></svg>`,he=e`<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/></svg>`,Fe=e`<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="9" width="14" height="10" rx="2"/><circle cx="9" cy="14" r="1.5" fill="currentColor" stroke="none"/><circle cx="15" cy="14" r="1.5" fill="currentColor" stroke="none"/><line x1="12" y1="9" x2="12" y2="5"/><circle cx="12" cy="4" r="1.5"/></svg>`,Re=e`<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10c1.1 0 2-.9 2-2 0-.53-.21-1.01-.55-1.36-.34-.36-.55-.84-.55-1.37 0-1.1.9-2 2-2h2.36c3.08 0 5.64-2.56 5.64-5.64C22.9 5.85 18.05 2 12 2z"/><circle cx="8" cy="10" r="1.5" fill="currentColor" stroke="none"/><circle cx="12" cy="7" r="1.5" fill="currentColor" stroke="none"/><circle cx="16" cy="10" r="1.5" fill="currentColor" stroke="none"/></svg>`,je=e`<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/><path d="M7 3.5 4 6"/><path d="m17 3.5 3 2.5"/></svg>`,me=z(),Oe=e`<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>`,fe=e`<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="8" cy="14" r="3"/><path d="M11 14h9"/><path d="M16 14v-2"/><path d="M19 14v2"/></svg>`,ze=e`<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="16.5" y1="9.4" x2="7.5" y2="4.21"/><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/></svg>`,ve=[{id:"general",label:"General",icon:Ee,searchable:!1,order:10},{id:"sessions",label:"Sessions",icon:De,searchable:!1,order:12},{id:"compaction",label:"Compaction",icon:Ie,searchable:!1,order:13},{id:"keyboard",label:"Keyboard",icon:Be,searchable:!0,placeholder:"Filter shortcuts…",order:14},{id:"workspace",label:"Workspace",icon:Pe,searchable:!1,order:15},{id:"environment",label:"Environment",icon:Te,searchable:!0,placeholder:"Filter environment…",order:16},{id:"providers",label:"Providers",icon:he,searchable:!1,order:20},{id:"models",label:"Models",icon:Fe,searchable:!0,placeholder:"Filter models…",order:30},{id:"optimizer",label:"Optimisation",icon:me,searchable:!1,order:30.1},{id:"mcp",label:"MCP",icon:he,searchable:!1,order:30.5},{id:"theme",label:"Appearance",icon:Re,searchable:!1,order:11},{id:"scheduled-tasks",label:"Scheduled Tasks",icon:je,searchable:!0,placeholder:"Filter scheduled tasks…",order:65},{id:"quick-actions",label:"Quick Actions",icon:Oe,searchable:!0,placeholder:"Filter quick actions…",order:14.5},{id:"authentication",label:"Authentication",icon:fe,searchable:!1,order:55},{id:"keychain",label:"Keychain",icon:fe,searchable:!0,placeholder:"Filter entries…",order:17},{id:"tools",label:"Tools",icon:me,searchable:!0,placeholder:"Filter tools…",order:31},{id:"addons",label:"Add-ons",icon:ze,searchable:!0,placeholder:"Filter add-ons…",order:90}];function hn({onClose:a=null,variant:h="dialog"}){let d=h==="tab";J("SettingsDialogContent-render-start");let[c,v]=t(()=>{let l=Ln();return l&&ge(l)?l:"general"}),[b,k]=t(pe),[w,P]=t(null),[S,x]=t(""),[,L]=t(0),[D,B]=t(()=>Object.fromEntries(ee.entries())),[K,F]=t(null),[y,R]=t({compact:!1,narrow:!1}),W=r(null),V=r(null),U=r(null),{t:N}=s(),_=(l)=>l?.isExtension?l.label:N(`settings.section.${l.id}`),H=(l)=>l?.isExtension?l.placeholder||N("settings.filter"):N(`settings.placeholder.${l.id}`);o(()=>{J("SettingsDialogContent-mounted"),Le()},[]),o(()=>{if(d||!a)return;let l=(g)=>{if(g.key==="Escape")a()};return window.addEventListener("keydown",l),()=>window.removeEventListener("keydown",l)},[d,a]),o(()=>{let l=(g)=>{let f=Ae(g?.detail?.section);if(f&&ge(f))v(f),x("")};return window.addEventListener("piclaw:open-settings",l),()=>window.removeEventListener("piclaw:open-settings",l)},[]),o(()=>{let l=()=>L((g)=>g+1);return window.addEventListener("piclaw:settings-panes-changed",l),()=>window.removeEventListener("piclaw:settings-panes-changed",l)},[]),o(()=>{fetch("/agent/settings-data").then((l)=>l.json()).then((l)=>{pe=l,k(l)}).catch(()=>k({}))},[]),o(()=>{let l=V.current;if(!l)return;let g=()=>{let f=l.clientWidth||0;R((A)=>{let O={compact:f>0&&f<=860,narrow:f>0&&f<=720};return A.compact===O.compact&&A.narrow===O.narrow?A:O})};if(g(),typeof ResizeObserver==="function"){let f=new ResizeObserver(()=>g());return f.observe(l),()=>f.disconnect()}return window.addEventListener("resize",g),()=>window.removeEventListener("resize",g)},[]);let Q=vn(),C=(l,g=!1)=>({id:l.id,label:l.label,icon:l.icon,searchable:l.searchable||!1,placeholder:l.searchPlaceholder,order:l.order??500,isExtension:!0,isCore:g,component:l.component}),I=Z.map((l)=>C(Q.find((g)=>g.id===l.id)||l,!0)),we=[...ve,...I].sort((l,g)=>(l.order??500)-(g.order??500)),Se=Q.filter((l)=>!Z.some((g)=>g.id===l.id)).map((l)=>C(l)).sort(bn),te=[...we,...Se],M=te.find((l)=>l.id===c)||ve.find((l)=>l.id===c);o(()=>{if(M?.searchable)requestAnimationFrame(()=>W.current?.focus())},[c]),o(()=>{if(M?.isExtension){F(null);let g=Z.find((f)=>f.id===c);if(g&&!M.component&&!ie.has(g.id)){let f=g.load();ie.set(g.id,f),f.then(()=>L((A)=>A+1)).catch((A)=>{ie.delete(g.id),console.error(`[settings-dialog] Failed to load settings pane "${g.id}".`,A),P({text:`${g.label} settings could not be loaded.`,type:"error"})})}return}let l=!1;if(D[c]){F(null);return}return F(c),Ne(c).then((g)=>{if(l)return;B((f)=>f?.[c]?f:{...f||{},[c]:g})}).catch((g)=>{if(l)return;console.error(`[settings-dialog] Failed to lazy-load section "${c}".`,g)}).finally(()=>{if(!l)F((g)=>g===c?null:g)}),()=>{l=!0}},[c,M?.isExtension,D]);let ne=y.narrow&&M?_(M):"";u(()=>{let l=U.current;if(!l)return;let g=()=>{let A=l.querySelector("h3"),O=Boolean(ne)&&A?.textContent?.trim().toLowerCase()===ne.trim().toLowerCase();for(let re of l.querySelectorAll(".settings-pane-title-repeat"))if(re!==A||!O)re.classList.remove("settings-pane-title-repeat");if(O&&!A.classList.contains("settings-pane-title-repeat"))A.classList.add("settings-pane-title-repeat")};g();let f=typeof MutationObserver==="function"?new MutationObserver(g):null;return f?.observe(l,{childList:!0,subtree:!0}),()=>{f?.disconnect();for(let A of l.querySelectorAll(".settings-pane-title-repeat"))A.classList.remove("settings-pane-title-repeat")}},[ne,c]);let T=n((l,g="info")=>{P(l?{text:l,type:g}:null)},[]),ye=n((l)=>{v(l),x("")},[]),j=n((l)=>{k((g)=>({...g||{},...l||{}}))},[]),ke=()=>{if(M?.isExtension){if(!M.component)return Y("Loading pane…");let g=M.component;return e`<${g} filter=${S} />`}let l=D[c];if(!l||K===c)return Y(`${N("settings.loading")}`);switch(c){case"authentication":return e`<${l} settingsData=${b} setStatus=${T} mergeSettingsData=${j} />`;case"general":return e`<${l} settingsData=${b} setStatus=${T} mergeSettingsData=${j} />`;case"sessions":return e`<${l} settingsData=${b} setStatus=${T} mergeSettingsData=${j} />`;case"compaction":return e`<${l} settingsData=${b} setStatus=${T} mergeSettingsData=${j} />`;case"mcp":return e`<${l} />`;case"optimizer":return e`<${l} />`;case"keyboard":return e`<${l} filter=${S} setStatus=${T} />`;case"workspace":return e`<${l} settingsData=${b} setStatus=${T} mergeSettingsData=${j} />`;case"environment":return e`<${l} settingsData=${b} filter=${S} setStatus=${T} mergeSettingsData=${j} />`;case"providers":return e`<${l} providers=${b?.providers} setStatus=${T} />`;case"models":return e`<${l} filter=${S} onFilterChange=${x} />`;case"theme":return e`<${l} themes=${b?.themes} colorKeys=${b?.colorKeys} settingsData=${b} setStatus=${T} mergeSettingsData=${j} />`;case"scheduled-tasks":return e`<${l} filter=${S} setStatus=${T} />`;case"quick-actions":return e`<${l} filter=${S} setStatus=${T} mergeSettingsData=${j} />`;case"keychain":return e`<${l} filter=${S} />`;case"tools":return e`<${l} toolsets=${b?.toolsets} filter=${S} settingsData=${b} mergeSettingsData=${j} />`;case"addons":return e`<${l} setStatus=${T} filter=${S} />`;default:return Y(N("settings.loading"))}},xe=!M;J("SettingsDialogContent-render-end");let oe=e`
            <div ref=${V} data-testid="settings-dialog" class=${`settings-dialog${d?" settings-tab":""}${y.compact?" settings-dialog-compact":""}${y.narrow?" settings-dialog-narrow":""}`}>
                <div class="settings-dialog-header">
                    <span class="settings-dialog-title">${y.narrow&&M?_(M):N("settings.title")}</span>
                    ${M?.searchable&&e`
                        <input ref=${W} type="search" class="settings-header-filter"
                            aria-label=${H(M)}
                            placeholder=${H(M)}
                            value=${S} onInput=${(l)=>x(l.target.value)} />
                    `}
                    ${!d&&e`<button class="settings-dialog-close" onClick=${a} title=${N("settings.close")}>✕</button>`}
                </div>
                <div class="settings-dialog-body">
                    <nav class="settings-nav" aria-label=${N("settings.title")}>
                        ${te.map((l,g)=>{let f=(O)=>O.isExtension&&!O.isCore,A=f(l)&&g>0&&!f(te[g-1]);return e`
                                ${A&&e`<div class="settings-nav-separator" role="separator"></div>`}
                                <button type="button" class=${`settings-nav-item ${l.id===c?"active":""}`}
                                    aria-label=${_(l)} title=${_(l)}
                                    aria-current=${l.id===c?"page":void 0}
                                    onClick=${()=>ye(l.id)}>
                                    <span class="settings-nav-icon">${typeof l.icon==="string"&&l.icon.trim().startsWith("<")?e`<span dangerouslySetInnerHTML=${{__html:l.icon}}></span>`:l.icon}</span>
                                    <span class="settings-nav-label">${_(l)}</span>
                                </button>
                            `})}
                    </nav>
                    <main ref=${U} class=${`settings-content${M?.isExtension&&!M?.isCore?" settings-addon-pane":""}`}>
                        ${xe?Y(N("settings.loading")):ke()}
                    </main>
                </div>
                ${w&&e`
                    <div class=${`settings-status-bar settings-status-bar-${w.type}`} role=${w.type==="error"?"alert":"status"} aria-live=${w.type==="error"?"assertive":"polite"} aria-atomic="true">
                        ${w.type==="info"&&e`<span class="settings-spinner"></span>`}
                        <span>${w.text}</span>
                        ${w.type!=="info"&&e`<button class="settings-status-dismiss" aria-label="Dismiss status message" onClick=${()=>P(null)}>✕</button>`}
                    </div>
                `}
            </div>
    `;if(d)return oe;return e`
        <div class="settings-dialog-backdrop" onClick=${(l)=>{if(l.target===l.currentTarget)a?.()}}>
            ${oe}
        </div>
    `}export{yt,bt,_e,m,hn};

//# debugId=6CDDAFFAC55F32B464756E2164756E21
//# sourceMappingURL=app-kw0x58x3.js.map
