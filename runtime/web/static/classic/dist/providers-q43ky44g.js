import{t,r,e}from"./app-863dk79s.js";import{E}from"./app-r6ty9k25.js";import{l,s}from"./app-wq98hqjx.js";function x(f){switch(f){case"oauth":return"OAuth";case"api_key":return l("settings.providers.authApiKey");case"custom":return l("settings.providers.authConfigured");default:return l("settings.providers.authConfigured")}}function N({providers:f,setStatus:a}){let{t:o}=s(),[c,u]=t(null),[C,y]=t(null),[p,m]=t({}),b=r((i,n)=>{m((d)=>({...d,[i]:n}))},[]),A=r(async(i)=>{let n=(p.apiKey||"").trim();if(!n){a?.(o("settings.providers.apiKeyEmpty"),"error");return}u(i),a?.(o("settings.providers.configuringToast",{provider:i}),"info");try{let d=JSON.stringify({provider:i,method:"api_key",api_key:n}),g=await E("default",`/login __step2 ${d}`,null,[]);if(g?.command?.status==="error"){a?.(g.command.message,"error");return}a?.(g?.command?.message||o("settings.providers.configured",{provider:i}),"success"),y(null),m({})}catch(d){a?.(String(d.message||d),"error")}finally{u(null)}},[p,a]),K=r(async(i,n)=>{u(i),a?.(o("settings.providers.configuringToast",{provider:i}),"info");try{let d={provider:i,method:"custom"};for(let k of n.customFields||[])d[k.key]=(p[k.key]||"").trim();let g=JSON.stringify(d),v=await E("default",`/login __step2 ${g}`,null,[]);if(v?.command?.status==="error"){a?.(v.command.message,"error");return}a?.(v?.command?.message||o("settings.providers.configured",{provider:i}),"success"),y(null),m({})}catch(d){a?.(String(d.message||d),"error")}finally{u(null)}},[p,a]),O=r(async(i)=>{u(i),a?.(o("settings.providers.startingOAuth",{provider:i}),"info");try{let n=JSON.stringify({provider:i}),g=(await E("default",`/login __step1 ${n}`,null,[]))?.command?.message||"";if(g.includes("http")){let v=g.match(/(https?:\/\/[^\s)]+)/);if(v)window.open(v[1],"_blank","noopener"),a?.(o("settings.providers.oauthOpened"),"success");else a?.(g,"success")}else a?.(g||o("settings.providers.oauthStarted",{provider:i}),"success")}catch(n){a?.(String(n.message||n),"error")}finally{u(null)}},[a]),w=r(async(i)=>{if(c)return;u(i),a?.(o("settings.providers.loggingOut",{provider:i}),"info");try{await E("default",`/logout ${i}`,null,[]),a?.(o("settings.providers.loggedOut",{provider:i}),"success")}catch(n){a?.(String(n.message||n),"error")}finally{u(null)}},[c,a]),_=f||[],P=(i)=>C===i,h=(i)=>{y((n)=>n===i?null:i),m({})};return e`
        <div class="settings-section">
            <h3>${o("settings.providers.heading")}</h3>
            <div class="settings-provider-list">
                ${_.map((i)=>e`
                    <div class=${`settings-provider-card${i.configured?" configured":""}`}>
                        <div class="settings-provider-card-header" onClick=${()=>!i.configured&&h(i.id)}>
                            <div class="settings-provider-card-title">
                                <strong>${i.name}</strong>
                                <span class="settings-provider-id">${i.id}</span>
                                ${i.configured&&e`<span class="settings-tag settings-tag-skill">${x(i.authType)}</span>`}
                            </div>
                            <div class="settings-provider-card-meta">
                                ${!i.configured&&i.hasOAuth&&e`<span class="settings-tag">OAuth</span>`}
                                ${!i.configured&&i.hasApiKey&&e`<span class="settings-tag">API Key</span>`}
                                ${i.isCustom&&e`<span class="settings-tag">${o("settings.providers.tagCustom")}</span>`}
                            </div>
                            <div class="settings-provider-card-actions">
                                ${i.configured?e`
                                    <button class="settings-addon-btn settings-addon-btn-remove"
                                        disabled=${c===i.id} onClick=${(n)=>{n.stopPropagation(),w(i.id)}}
                                    >${c===i.id?"…":o("settings.providers.logout")}</button>
                                    <button class="settings-addon-btn"
                                        disabled=${c===i.id} onClick=${(n)=>{n.stopPropagation(),h(i.id)}}
                                    >${o("settings.providers.reconfigure")}</button>
                                `:e`
                                    <button class="settings-addon-btn settings-addon-btn-install"
                                        disabled=${c===i.id} onClick=${(n)=>{n.stopPropagation(),h(i.id)}}
                                    >${o("settings.providers.setUp")}</button>
                                `}
                            </div>
                        </div>

                        ${P(i.id)&&e`
                            <div class="settings-provider-setup">
                                <p class="settings-hint settings-provider-setup-hint">${o("settings.providers.setupHint")}</p>
                                ${i.hasOAuth&&e`
                                    <div class="settings-provider-method">
                                        <button class="settings-addon-btn settings-addon-btn-install"
                                            disabled=${c===i.id}
                                            onClick=${()=>O(i.id)}>
                                            ${c===i.id?o("settings.providers.starting"):o("settings.providers.signInOAuth")}
                                        </button>
                                    </div>
                                `}
                                ${i.hasApiKey&&e`
                                    <div class="settings-provider-method">
                                        <div class="settings-provider-field-row">
                                            <label>${o("settings.providers.apiKeyLabel")}</label>
                                            <input type="password" value=${p.apiKey||""}
                                                onInput=${(n)=>b("apiKey",n.target.value)}
                                                placeholder=${i.apiKeyHint||o("settings.providers.apiKeyPlaceholder")} />
                                            <button class="settings-addon-btn settings-addon-btn-install"
                                                disabled=${c===i.id||!(p.apiKey||"").trim()}
                                                onClick=${()=>A(i.id)}>
                                                ${c===i.id?"…":o("settings.providers.save")}
                                            </button>
                                        </div>
                                    </div>
                                `}
                                ${i.isCustom&&e`
                                    <div class="settings-provider-method">
                                        ${(i.customFields||[]).map((n)=>e`
                                            <div class="settings-provider-field-row">
                                                <label>${n.label}${n.required?" *":""}</label>
                                                <input type="text" value=${p[n.key]||""}
                                                    onInput=${(d)=>b(n.key,d.target.value)}
                                                    placeholder=${n.placeholder||""} />
                                            </div>
                                        `)}
                                        <div class="settings-provider-form-actions">
                                            <button class="settings-addon-btn settings-addon-btn-install"
                                                disabled=${c===i.id}
                                                onClick=${()=>K(i.id,i)}>
                                                ${c===i.id?o("settings.providers.configuring"):o("settings.providers.saveConfig")}
                                            </button>
                                        </div>
                                    </div>
                                `}
                            </div>
                        `}
                    </div>
                `)}
            </div>
        </div>
    `}export{N as ProvidersSection};

//# debugId=D9F14ACBB8FD38C664756E2164756E21
//# sourceMappingURL=providers-q43ky44g.js.map
