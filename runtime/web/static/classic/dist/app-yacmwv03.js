import{t,o,a,r,i,n,e}from"./app-0h4wyc77.js";import{O,dn,C,pn,we,N,fn}from"./app-0a9qttcy.js";import{u}from"./app-5vk2s7g2.js";import{ye,$n,s}from"./app-ahzvmhbs.js";var ut=e`<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>`,dt=e`<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="4 17 10 11 4 5"/><line x1="12" y1="19" x2="20" y2="19"/></svg>`;function ae(l,m){if(l===""||l===null||l===void 0)return m;let g=Number(l);return Number.isFinite(g)?g:m}function le(l,{min:m=-1/0,max:g=1/0}={}){let d=Number.isFinite(Number(m))?Number(m):-1/0,v=Number.isFinite(Number(g))?Number(g):1/0;return Math.min(v,Math.max(d,Number(l)))}function ve(l,{fallback:m=0,min:g=-1/0,max:d=1/0}={}){let v=ae(l,m);return le(v,{min:g,max:d})}function Le(l,{direction:m=1,step:g=1,fallback:d=0,min:v=-1/0,max:b=1/0}={}){let k=ve(l,{fallback:d,min:v,max:b}),w=Math.abs(ae(g,1))||1,T=Number(m)<0?-1:1;return le(k+T*w,{min:v,max:b})}function p({value:l,min:m,max:g,step:d=1,fallback:v,width:b="80px",disabled:k=!1,label:w,id:T,onChange:S}){let x=Number.isFinite(Number(v))?Number(v):ve(l,{fallback:0,min:m,max:g}),[A,I]=t(String(l??x)),F=r(!1);o(()=>{if(!F.current)I(String(l??x))},[l,x]);let K=n((y)=>{F.current=!1;let j=ve(y,{fallback:x,min:m,max:g});I(String(j)),S?.(j)},[x,m,g,S]),R=n((y)=>{F.current=!1;let j=Le(l,{direction:y,step:d,fallback:x,min:m,max:g});I(String(j)),S?.(j)},[x,g,m,S,d,l]);return e`
        <span class="settings-number-stepper">
            <button
                type="button"
                class="settings-number-step-btn"
                aria-label=${`Decrease ${w||"value"}`}
                title=${`Decrease ${w||"value"}`}
                disabled=${k}
                onClick=${()=>R(-1)}
            >−</button>
            <input
                id=${T}
                aria-label=${w||void 0}
                aria-invalid=${F.current&&(A.trim()===""||!Number.isFinite(Number(A))||m!=null&&Number(A)<m||g!=null&&Number(A)>g)?"true":void 0}
                class="settings-number-input"
                type="text"
                inputmode="numeric"
                pattern="[0-9]*"
                value=${A}
                disabled=${k}
                style=${`width:${b}`}
                onInput=${(y)=>{F.current=!0,I(y.target.value)}}
                onBlur=${(y)=>K(y.target.value)}
                onKeyDown=${(y)=>{if(y.key==="Enter")y.preventDefault(),K(y.target.value),y.target.blur()}}
            />
            <button
                type="button"
                class="settings-number-step-btn"
                aria-label=${`Increase ${w||"value"}`}
                title=${`Increase ${w||"value"}`}
                disabled=${k}
                onClick=${()=>R(1)}
            >+</button>
        </span>
    `}function ce(l,m){let g=String(l||"").trim();if(!g)return"";if(g.startsWith("data:")||g.startsWith("blob:"))return g;return m==="agent"||m==="user"?`/avatar/${m}`:""}function de({value:l,kind:m,label:g,onChange:d}){let{t:v}=s(),b=r(null),[k,w]=t(ce(l,m));o(()=>{w(ce(l,m))},[m,l]);let T=n((S)=>{let x=S.target.files?.[0];if(!x)return;let A=new FileReader;A.onload=()=>{let I=A.result;w(I),d?.(I)},A.readAsDataURL(x)},[d]);return e`
        <button type="button" class="settings-avatar-inline" data-settings-button="unstyled" onClick=${()=>b.current?.click()}
            title=${v("settings.general.avatarUpload")} aria-label=${`${v("settings.general.avatarUpload")}: ${g}`}>
            ${k?e`<img src=${k} alt="" />`:e`<span class="settings-avatar-placeholder" aria-hidden="true">+</span>`}
        </button>
        <input type="file" accept="image/*" ref=${b} style="display:none" tabindex="-1" aria-hidden="true" onChange=${T} />
    `}function ue(l={}){return{userName:l.userName||"",userAvatar:l.userAvatar||"",assistantName:l.assistantName||"",assistantAvatar:l.assistantAvatar||"",workspaceUploadLimitMb:l.workspaceUploadLimitMb??256}}var Ne=0;function se({settingsData:l,setStatus:m,mergeSettingsData:g}){let{t:d}=s(),v=r(null);if(!v.current)v.current=`settings-general-${++Ne}`;let b=v.current,k=(M)=>`${b}-general-${M}`,[w,T]=t(""),[S,x]=t(""),[A,I]=t(""),[F,K]=t(""),[R,y]=t(256),[j,W]=t(!1),V=r(""),U=r(null),E=r(!0);o(()=>(E.current=!0,()=>{E.current=!1}),[]);let _=n((M)=>{let P=ue(M);T(P.userName),x(P.userAvatar),I(P.assistantName),K(P.assistantAvatar),y(P.workspaceUploadLimitMb),V.current=JSON.stringify(P)},[]);o(()=>{_(l||{})},[l,_]);let H=i(()=>JSON.stringify(ue({userName:w,userAvatar:S,assistantName:A,assistantAvatar:F,workspaceUploadLimitMb:R})),[w,S,A,F,R]);o(()=>{if(H===V.current)return;if(U.current)clearTimeout(U.current);return U.current=setTimeout(async()=>{if(!E.current)return;try{let M=await fetch("/agent/settings/general",{method:"POST",headers:{"Content-Type":"application/json"},body:H}),P=await M.json().catch(()=>({}));if(!E.current)return;if(!M.ok||!P?.ok||!P?.settings)throw Error(P?.error||`Failed to save general settings (${M.status})`);V.current=H,g?.(P.settings),m?.(null),W(!0),setTimeout(()=>{if(E.current)W(!1)},4000)}catch(M){if(console.warn("[settings/general] Failed to persist general settings snapshot.",M),E.current)m?.(String(M?.message||M),"error")}},800),()=>{if(U.current)clearTimeout(U.current)}},[H,g,m]);let Q=typeof window<"u"&&window.isSecureContext;return e`
        <div class="settings-section">
            ${j&&e`
                <div class="settings-general-applied-notice" role="status" aria-live="polite">
                    ${d("settings.appliedNotice")}
                </div>
            `}
            <h3>${d("settings.general.identity")}</h3>
            <div class="settings-row">
                <label for=${k("user")}>${d("settings.general.userLabel")}</label>
                <div class="settings-identity-field">
                    <${de} kind="user" label=${d("settings.general.userLabel")} value=${S} onChange=${x} />
                    <input id=${k("user")} type="text" value=${w} onInput=${(M)=>T(M.target.value)} placeholder=${d("settings.general.yourName")} />
                </div>
            </div>
            <div class="settings-row">
                <label for=${k("agent")}>${d("settings.general.agentLabel")}</label>
                <div class="settings-identity-field">
                    <${de} kind="agent" label=${d("settings.general.agentLabel")} value=${F} onChange=${K} />
                    <input id=${k("agent")} type="text" value=${A} onInput=${(M)=>I(M.target.value)} placeholder=${d("settings.general.agentName")} />
                </div>
            </div>

            <h3 style="margin-top:20px">${d("settings.general.notifications")}</h3>
            ${Q?e`
                <div class="settings-row">
                    <label>${d("settings.general.browserNotifications")}</label>
                    <div style="display:flex; align-items:center; gap:10px;">
                        <span class="settings-hint" style="margin:0">
                            ${d("settings.general.notifSecureHint")}
                        </span>
                    </div>
                </div>
            `:e`
                <div class="settings-row">
                    <label>${d("settings.general.browserNotifications")}</label>
                    <div style="display:flex; align-items:center; gap:10px;">
                        <span class="settings-hint" style="margin:0; color: var(--error-color, #e55)">
                            ${d("settings.general.notifInsecureHint")}
                        </span>
                    </div>
                </div>
            `}

            <h3 style="margin-top:20px">${d("settings.general.instanceConfig")}</h3>
            <div class="settings-row">
                <label for=${k("workspace")}>${d("settings.general.uploadLimit")}</label>
                <${p}
                    id=${k("workspace")}
                    label=${d("settings.general.uploadLimit")}
                    value=${R}
                    min=${1}
                    max=${1024}
                    fallback=${256}
                    width="80px"
                    onChange=${y}
                />
                <span class="settings-hint" style="margin:0">${d("settings.general.uploadLimitHint")}</span>
            </div>

            <section class="settings-about" aria-label="About">
                <h3>About</h3>
                <${fn} versions=${l?.runtimeVersions} />
            </section>
        </div>
    `}var G=[];function J(l){G.push({ts:performance.now(),label:l})}function Ae(){if(!G.length)return;let l=G[0].ts,m=G.map((g)=>`+${(g.ts-l).toFixed(1)}ms ${g.label}`);console.info(`[settings-dialog perf]
`+m.join(`
`));try{window.__piclawSettingsPerfLog=m}catch(g){}try{fetch("/agent/client-perf",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({label:"settings-dialog",lines:m})}).catch((g)=>{})}catch(g){}G.length=0}var pe=null;J("module-eval-start");J("imports-done");var ee=new Map,X=new Map;ee.set("general",se);var be={general:()=>Promise.resolve(se),authentication:()=>(u("62qe65nk"),import("./authentication-62qe65nk.js")).then((l)=>l.AuthenticationSection),sessions:()=>(u("hmt1nq7y"),import("./sessions-hmt1nq7y.js")).then((l)=>l.SessionsSection),compaction:()=>(u("ahbxg7tf"),import("./compaction-ahbxg7tf.js")).then((l)=>l.CompactionSection),mcp:()=>(u("tj3jj0zr"),import("./mcp-tj3jj0zr.js")).then((l)=>l.McpSection),optimizer:()=>(u("31ns9hn0"),import("./optimizer-31ns9hn0.js")).then((l)=>l.OptimizerSection),keyboard:()=>(u("nm17y8zx"),import("./keyboard-nm17y8zx.js")).then((l)=>l.KeyboardSection),workspace:()=>(u("2eqjg3tv"),import("./workspace-2eqjg3tv.js")).then((l)=>l.WorkspaceSection),environment:()=>(u("fay6x9gp"),import("./environment-fay6x9gp.js")).then((l)=>l.EnvironmentSection),providers:()=>(u("sdwttf0s"),import("./providers-sdwttf0s.js")).then((l)=>l.ProvidersSection),models:()=>(u("s7etksaz"),import("./models-s7etksaz.js")).then((l)=>l.ModelsSection),theme:()=>(u("qzt9hh23"),import("./appearance-qzt9hh23.js")).then((l)=>l.ThemeSection),"scheduled-tasks":()=>(u("grfx75qx"),import("./scheduled-tasks-grfx75qx.js")).then((l)=>l.ScheduledTasksSection),"quick-actions":()=>(u("pxqpd38y"),import("./quick-actions-pxqpd38y.js")).then((l)=>l.QuickActionsSection),keychain:()=>(u("p3an9zqs"),import("./keychain-p3an9zqs.js")).then((l)=>l.KeychainSection),tools:()=>(u("m5dhm584"),import("./tools-m5dhm584.js")).then((l)=>l.ToolsSection),addons:()=>(u("14qre5h1"),import("./addons-14qre5h1.js")).then((l)=>l.AddonsSection)},Z=[{id:"editor",label:"Editor",icon:ut,order:150,load:()=>(u("rgf0y066"),import("./editor-settings-rgf0y066.js"))},{id:"delegate",label:"Delegate",icon:N(),order:30.25,load:()=>import(O("delegate-settings")).then((m)=>m.registerDelegateSettings({html:e,useState:t,useEffect:o,useCallback:n,registerSettingsPane:C,notifySettingsPanesChanged:we}))},{id:"developer",label:"Developer",icon:dt,order:900,load:()=>(u("a7vkp8qe"),import("./developer-settings-a7vkp8qe.js"))}],ie=new Map,ge=(l)=>Object.hasOwn(be,l)||Z.some((m)=>m.id===l)||pn().some((m)=>m.id===l);function Ee(l){let m=ee.get(l);if(m)return Promise.resolve(m);let g=X.get(l);if(g)return g;let d=be[l]().then((v)=>(ee.set(l,v),X.delete(l),v)).catch((v)=>{throw X.delete(l),v});return X.set(l,d),d}function Y(l="Loading…"){return e`
        <div class="settings-loading settings-loading-pane" role="status" aria-live="polite">
            <span class="settings-spinner"></span>
            <span>${l}</span>
        </div>
    `}var De=e`<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M8.5 5.9L9.6 2.3h4.8l1.1 3.6 3.7-.8 2.4 4.1-2.6 2.8 2.6 2.8-2.4 4.1-3.7-.8-1.1 3.6H9.6l-1.1-3.6-3.7.8-2.4-4.1L5 12 2.4 9.2l2.4-4.1z"/></svg>`,Ie=e`<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>`,Pe=e`<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 1 0 3-6.7"/><polyline points="3 4 3 10 9 10"/><path d="M12 7v5l3 3"/></svg>`,Te=e`<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>`,Be=e`<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16"/><path d="M4 12h16"/><path d="M4 17h16"/><path d="M8 7v10"/><path d="M16 7v10"/></svg>`,Fe=e`<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="5" width="20" height="14" rx="2"/><path d="M6 9h.01"/><path d="M10 9h.01"/><path d="M14 9h.01"/><path d="M18 9h.01"/><path d="M8 13h.01"/><path d="M12 13h.01"/><path d="M16 13h.01"/><path d="M7 17h10"/></svg>`,he=e`<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/></svg>`,Re=e`<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="9" width="14" height="10" rx="2"/><circle cx="9" cy="14" r="1.5" fill="currentColor" stroke="none"/><circle cx="15" cy="14" r="1.5" fill="currentColor" stroke="none"/><line x1="12" y1="9" x2="12" y2="5"/><circle cx="12" cy="4" r="1.5"/></svg>`,je=e`<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10c1.1 0 2-.9 2-2 0-.53-.21-1.01-.55-1.36-.34-.36-.55-.84-.55-1.37 0-1.1.9-2 2-2h2.36c3.08 0 5.64-2.56 5.64-5.64C22.9 5.85 18.05 2 12 2z"/><circle cx="8" cy="10" r="1.5" fill="currentColor" stroke="none"/><circle cx="12" cy="7" r="1.5" fill="currentColor" stroke="none"/><circle cx="16" cy="10" r="1.5" fill="currentColor" stroke="none"/></svg>`,Oe=e`<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/><path d="M7 3.5 4 6"/><path d="m17 3.5 3 2.5"/></svg>`,me=N(),ze=e`<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>`,fe=e`<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="8" cy="14" r="3"/><path d="M11 14h9"/><path d="M16 14v-2"/><path d="M19 14v2"/></svg>`,qe=e`<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="16.5" y1="9.4" x2="7.5" y2="4.21"/><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/></svg>`,$e=[{id:"general",label:"General",icon:De,searchable:!1,order:10},{id:"sessions",label:"Sessions",icon:Ie,searchable:!1,order:12},{id:"compaction",label:"Compaction",icon:Pe,searchable:!1,order:13},{id:"keyboard",label:"Keyboard",icon:Fe,searchable:!0,placeholder:"Filter shortcuts…",order:14},{id:"workspace",label:"Workspace",icon:Te,searchable:!1,order:15},{id:"environment",label:"Environment",icon:Be,searchable:!0,placeholder:"Filter environment…",order:16},{id:"providers",label:"Providers",icon:he,searchable:!1,order:20},{id:"models",label:"Models",icon:Re,searchable:!0,placeholder:"Filter models…",order:30},{id:"optimizer",label:"Optimisation",icon:me,searchable:!1,order:30.1},{id:"mcp",label:"MCP",icon:he,searchable:!1,order:30.5},{id:"theme",label:"Appearance",icon:je,searchable:!1,order:11},{id:"scheduled-tasks",label:"Scheduled Tasks",icon:Oe,searchable:!0,placeholder:"Filter scheduled tasks…",order:65},{id:"quick-actions",label:"Quick Actions",icon:ze,searchable:!0,placeholder:"Filter quick actions…",order:14.5},{id:"authentication",label:"Authentication",icon:fe,searchable:!1,order:55},{id:"keychain",label:"Keychain",icon:fe,searchable:!0,placeholder:"Filter entries…",order:17},{id:"tools",label:"Tools",icon:me,searchable:!0,placeholder:"Filter tools…",order:31},{id:"addons",label:"Add-ons",icon:qe,searchable:!0,placeholder:"Filter add-ons…",order:90}];function ln({onClose:l=null,variant:m="dialog"}){let g=m==="tab";J("SettingsDialogContent-render-start");let[d,v]=t(()=>{let c=$n();return c&&ge(c)?c:"general"}),[b,k]=t(pe),[w,T]=t(null),[S,x]=t(""),[,A]=t(0),[I,F]=t(()=>Object.fromEntries(ee.entries())),[K,R]=t(null),[y,j]=t({compact:!1,narrow:!1}),W=r(null),V=r(null),U=r(null),{t:E}=s(),_=(c)=>c?.isExtension?c.label:E(`settings.section.${c.id}`),H=(c)=>c?.isExtension?c.placeholder||E("settings.filter"):E(`settings.placeholder.${c.id}`);o(()=>{J("SettingsDialogContent-mounted"),Ae()},[]),o(()=>{if(g||!l)return;let c=(h)=>{if(h.key==="Escape")l()};return window.addEventListener("keydown",c),()=>window.removeEventListener("keydown",c)},[g,l]),o(()=>{let c=(h)=>{let f=ye(h?.detail?.section);if(f&&ge(f))v(f),x("")};return window.addEventListener("piclaw:open-settings",c),()=>window.removeEventListener("piclaw:open-settings",c)},[]),o(()=>{let c=()=>A((h)=>h+1);return window.addEventListener("piclaw:settings-panes-changed",c),()=>window.removeEventListener("piclaw:settings-panes-changed",c)},[]),o(()=>{fetch("/agent/settings-data").then((c)=>c.json()).then((c)=>{pe=c,k(c)}).catch(()=>k({}))},[]),o(()=>{let c=V.current;if(!c)return;let h=()=>{let f=c.clientWidth||0;j((D)=>{let q={compact:f>0&&f<=860,narrow:f>0&&f<=720};return D.compact===q.compact&&D.narrow===q.narrow?D:q})};if(h(),typeof ResizeObserver==="function"){let f=new ResizeObserver(()=>h());return f.observe(c),()=>f.disconnect()}return window.addEventListener("resize",h),()=>window.removeEventListener("resize",h)},[]);let Q=pn(),M=(c,h=!1)=>({id:c.id,label:c.label,icon:c.icon,searchable:c.searchable||!1,placeholder:c.searchPlaceholder,order:c.order??500,isExtension:!0,isCore:h,component:c.component}),P=Z.map((c)=>M(Q.find((h)=>h.id===c.id)||c,!0)),Se=[...$e,...P].sort((c,h)=>(c.order??500)-(h.order??500)),ke=Q.filter((c)=>!Z.some((h)=>h.id===c.id)).map((c)=>M(c)).sort(dn),te=[...Se,...ke],L=te.find((c)=>c.id===d)||$e.find((c)=>c.id===d);o(()=>{if(L?.searchable)requestAnimationFrame(()=>W.current?.focus())},[d]),o(()=>{if(L?.isExtension){R(null);let h=Z.find((f)=>f.id===d);if(h&&!L.component&&!ie.has(h.id)){let f=h.load();ie.set(h.id,f),f.then(()=>A((D)=>D+1)).catch((D)=>{ie.delete(h.id),console.error(`[settings-dialog] Failed to load settings pane "${h.id}".`,D),T({text:`${h.label} settings could not be loaded.`,type:"error"})})}return}let c=!1;if(I[d]){R(null);return}return R(d),Ee(d).then((h)=>{if(c)return;F((f)=>f?.[d]?f:{...f||{},[d]:h})}).catch((h)=>{if(c)return;console.error(`[settings-dialog] Failed to lazy-load section "${d}".`,h)}).finally(()=>{if(!c)R((h)=>h===d?null:h)}),()=>{c=!0}},[d,L?.isExtension,I]);let ne=y.narrow&&L?_(L):"";a(()=>{let c=U.current;if(!c)return;let h=()=>{let D=c.querySelector("h3"),q=Boolean(ne)&&D?.textContent?.trim().toLowerCase()===ne.trim().toLowerCase();for(let re of c.querySelectorAll(".settings-pane-title-repeat"))if(re!==D||!q)re.classList.remove("settings-pane-title-repeat");if(q&&!D.classList.contains("settings-pane-title-repeat"))D.classList.add("settings-pane-title-repeat")};h();let f=typeof MutationObserver==="function"?new MutationObserver(h):null;return f?.observe(c,{childList:!0,subtree:!0}),()=>{f?.disconnect();for(let D of c.querySelectorAll(".settings-pane-title-repeat"))D.classList.remove("settings-pane-title-repeat")}},[ne,d]);let B=n((c,h="info")=>{T(c?{text:c,type:h}:null)},[]),xe=n((c)=>{v(c),x("")},[]),z=n((c)=>{k((h)=>({...h||{},...c||{}}))},[]),Ce=()=>{if(L?.isExtension){if(!L.component)return Y("Loading pane…");let h=L.component;return e`<${h} filter=${S} />`}let c=I[d];if(!c||K===d)return Y(`${E("settings.loading")}`);switch(d){case"authentication":return e`<${c} settingsData=${b} setStatus=${B} mergeSettingsData=${z} />`;case"general":return e`<${c} settingsData=${b} setStatus=${B} mergeSettingsData=${z} />`;case"sessions":return e`<${c} settingsData=${b} setStatus=${B} mergeSettingsData=${z} />`;case"compaction":return e`<${c} settingsData=${b} setStatus=${B} mergeSettingsData=${z} />`;case"mcp":return e`<${c} />`;case"optimizer":return e`<${c} />`;case"keyboard":return e`<${c} filter=${S} setStatus=${B} />`;case"workspace":return e`<${c} settingsData=${b} setStatus=${B} mergeSettingsData=${z} />`;case"environment":return e`<${c} settingsData=${b} filter=${S} setStatus=${B} mergeSettingsData=${z} />`;case"providers":return e`<${c} providers=${b?.providers} setStatus=${B} />`;case"models":return e`<${c} filter=${S} onFilterChange=${x} />`;case"theme":return e`<${c} themes=${b?.themes} colorKeys=${b?.colorKeys} settingsData=${b} setStatus=${B} mergeSettingsData=${z} />`;case"scheduled-tasks":return e`<${c} filter=${S} setStatus=${B} />`;case"quick-actions":return e`<${c} filter=${S} setStatus=${B} mergeSettingsData=${z} />`;case"keychain":return e`<${c} filter=${S} />`;case"tools":return e`<${c} toolsets=${b?.toolsets} filter=${S} settingsData=${b} mergeSettingsData=${z} />`;case"addons":return e`<${c} setStatus=${B} filter=${S} />`;default:return Y(E("settings.loading"))}},Me=!L;J("SettingsDialogContent-render-end");let oe=e`
            <div ref=${V} data-testid="settings-dialog" class=${`settings-dialog${g?" settings-tab":""}${y.compact?" settings-dialog-compact":""}${y.narrow?" settings-dialog-narrow":""}`}>
                <div class="settings-dialog-header">
                    <span class="settings-dialog-title">${y.narrow&&L?_(L):E("settings.title")}</span>
                    ${L?.searchable&&e`
                        <input ref=${W} type="search" class="settings-header-filter"
                            aria-label=${H(L)}
                            placeholder=${H(L)}
                            value=${S} onInput=${(c)=>x(c.target.value)} />
                    `}
                    ${!g&&e`<button class="settings-dialog-close" onClick=${l} title=${E("settings.close")}>✕</button>`}
                </div>
                <div class="settings-dialog-body">
                    <nav class="settings-nav" aria-label=${E("settings.title")}>
                        ${te.map((c,h)=>{let f=(q)=>q.isExtension&&!q.isCore,D=f(c)&&h>0&&!f(te[h-1]);return e`
                                ${D&&e`<div class="settings-nav-separator" role="separator"></div>`}
                                <button type="button" class=${`settings-nav-item ${c.id===d?"active":""}`}
                                    aria-label=${_(c)} title=${_(c)}
                                    aria-current=${c.id===d?"page":void 0}
                                    onClick=${()=>xe(c.id)}>
                                    <span class="settings-nav-icon">${typeof c.icon==="string"&&c.icon.trim().startsWith("<")?e`<span dangerouslySetInnerHTML=${{__html:c.icon}}></span>`:c.icon}</span>
                                    <span class="settings-nav-label">${_(c)}</span>
                                </button>
                            `})}
                    </nav>
                    <main ref=${U} class=${`settings-content${L?.isExtension&&!L?.isCore?" settings-addon-pane":""}`}>
                        ${Me?Y(E("settings.loading")):Ce()}
                    </main>
                </div>
                ${w&&e`
                    <div class=${`settings-status-bar settings-status-bar-${w.type}`} role=${w.type==="error"?"alert":"status"} aria-live=${w.type==="error"?"assertive":"polite"} aria-atomic="true">
                        ${w.type==="info"&&e`<span class="settings-spinner"></span>`}
                        <span>${w.text}</span>
                        ${w.type!=="info"&&e`<button class="settings-status-dismiss" aria-label="Dismiss status message" onClick=${()=>T(null)}>✕</button>`}
                    </div>
                `}
            </div>
    `;if(g)return oe;return e`
        <div class="settings-dialog-backdrop" onClick=${(c)=>{if(c.target===c.currentTarget)l?.()}}>
            ${oe}
        </div>
    `}export{ut,dt,ve,p,ln};

//# debugId=8758AA4357056C0E64756E2164756E21
//# sourceMappingURL=app-yacmwv03.js.map
