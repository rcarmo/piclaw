import{t,n,e}from"./app-c7xgjke0.js";import"./app-7bepgq8r.js";import{P}from"./app-p5k2h1w4.js";import{d,s}from"./app-dr786pqe.js";function T(f){switch(f){case"oauth":return"OAuth";case"api_key":return d("settings.providers.authApiKey");case"custom":return d("settings.providers.authConfigured");default:return d("settings.providers.authConfigured")}}function N({providers:f,setStatus:a}){let{t:r}=s(),[c,u]=t(null),[C,y]=t(null),[p,m]=t({}),b=n((i,o)=>{m((l)=>({...l,[i]:o}))},[]),A=n(async(i)=>{let o=(p.apiKey||"").trim();if(!o){a?.(r("settings.providers.apiKeyEmpty"),"error");return}u(i),a?.(r("settings.providers.configuringToast",{provider:i}),"info");try{let l=JSON.stringify({provider:i,method:"api_key",api_key:o}),g=await P("default",`/login __step2 ${l}`,null,[]);if(g?.command?.status==="error"){a?.(g.command.message,"error");return}a?.(g?.command?.message||r("settings.providers.configured",{provider:i}),"success"),y(null),m({})}catch(l){a?.(String(l.message||l),"error")}finally{u(null)}},[p,a]),K=n(async(i,o)=>{u(i),a?.(r("settings.providers.configuringToast",{provider:i}),"info");try{let l={provider:i,method:"custom"};for(let k of o.customFields||[])l[k.key]=(p[k.key]||"").trim();let g=JSON.stringify(l),v=await P("default",`/login __step2 ${g}`,null,[]);if(v?.command?.status==="error"){a?.(v.command.message,"error");return}a?.(v?.command?.message||r("settings.providers.configured",{provider:i}),"success"),y(null),m({})}catch(l){a?.(String(l.message||l),"error")}finally{u(null)}},[p,a]),O=n(async(i)=>{u(i),a?.(r("settings.providers.startingOAuth",{provider:i}),"info");try{let o=JSON.stringify({provider:i}),g=(await P("default",`/login __step1 ${o}`,null,[]))?.command?.message||"";if(g.includes("http")){let v=g.match(/(https?:\/\/[^\s)]+)/);if(v)window.open(v[1],"_blank","noopener"),a?.(r("settings.providers.oauthOpened"),"success");else a?.(g,"success")}else a?.(g||r("settings.providers.oauthStarted",{provider:i}),"success")}catch(o){a?.(String(o.message||o),"error")}finally{u(null)}},[a]),w=n(async(i)=>{if(c)return;u(i),a?.(r("settings.providers.loggingOut",{provider:i}),"info");try{await P("default",`/logout ${i}`,null,[]),a?.(r("settings.providers.loggedOut",{provider:i}),"success")}catch(o){a?.(String(o.message||o),"error")}finally{u(null)}},[c,a]),_=f||[],x=(i)=>C===i,h=(i)=>{y((o)=>o===i?null:i),m({})};return e`
        <div class="settings-section">
            <h3>${r("settings.providers.heading")}</h3>
            <div class="settings-provider-list">
                ${_.map((i)=>e`
                    <div class=${`settings-provider-card${i.configured?" configured":""}`}>
                        <div class="settings-provider-card-header" onClick=${()=>!i.configured&&h(i.id)}>
                            <div class="settings-provider-card-title">
                                <strong>${i.name}</strong>
                                <span class="settings-provider-id">${i.id}</span>
                                ${i.configured&&e`<span class="settings-tag settings-tag-skill">${T(i.authType)}</span>`}
                            </div>
                            <div class="settings-provider-card-meta">
                                ${!i.configured&&i.hasOAuth&&e`<span class="settings-tag">OAuth</span>`}
                                ${!i.configured&&i.hasApiKey&&e`<span class="settings-tag">API Key</span>`}
                                ${i.isCustom&&e`<span class="settings-tag">${r("settings.providers.tagCustom")}</span>`}
                            </div>
                            <div class="settings-provider-card-actions">
                                ${i.configured?e`
                                    <button class="settings-addon-btn settings-addon-btn-remove"
                                        disabled=${c===i.id} onClick=${(o)=>{o.stopPropagation(),w(i.id)}}
                                    >${c===i.id?"…":r("settings.providers.logout")}</button>
                                    <button class="settings-addon-btn"
                                        disabled=${c===i.id} onClick=${(o)=>{o.stopPropagation(),h(i.id)}}
                                    >${r("settings.providers.reconfigure")}</button>
                                `:e`
                                    <button class="settings-addon-btn settings-addon-btn-install"
                                        disabled=${c===i.id} onClick=${(o)=>{o.stopPropagation(),h(i.id)}}
                                    >${r("settings.providers.setUp")}</button>
                                `}
                            </div>
                        </div>

                        ${x(i.id)&&e`
                            <div class="settings-provider-setup">
                                <p class="settings-hint settings-provider-setup-hint">${r("settings.providers.setupHint")}</p>
                                ${i.hasOAuth&&e`
                                    <div class="settings-provider-method">
                                        <button class="settings-addon-btn settings-addon-btn-install"
                                            disabled=${c===i.id}
                                            onClick=${()=>O(i.id)}>
                                            ${c===i.id?r("settings.providers.starting"):r("settings.providers.signInOAuth")}
                                        </button>
                                    </div>
                                `}
                                ${i.hasApiKey&&e`
                                    <div class="settings-provider-method">
                                        <div class="settings-provider-field-row">
                                            <label>${r("settings.providers.apiKeyLabel")}</label>
                                            <input type="password" value=${p.apiKey||""}
                                                onInput=${(o)=>b("apiKey",o.target.value)}
                                                placeholder=${i.apiKeyHint||r("settings.providers.apiKeyPlaceholder")} />
                                            <button class="settings-addon-btn settings-addon-btn-install"
                                                disabled=${c===i.id||!(p.apiKey||"").trim()}
                                                onClick=${()=>A(i.id)}>
                                                ${c===i.id?"…":r("settings.providers.save")}
                                            </button>
                                        </div>
                                    </div>
                                `}
                                ${i.isCustom&&e`
                                    <div class="settings-provider-method">
                                        ${(i.customFields||[]).map((o)=>e`
                                            <div class="settings-provider-field-row">
                                                <label>${o.label}${o.required?" *":""}</label>
                                                <input type="text" value=${p[o.key]||""}
                                                    onInput=${(l)=>b(o.key,l.target.value)}
                                                    placeholder=${o.placeholder||""} />
                                            </div>
                                        `)}
                                        <div class="settings-provider-form-actions">
                                            <button class="settings-addon-btn settings-addon-btn-install"
                                                disabled=${c===i.id}
                                                onClick=${()=>K(i.id,i)}>
                                                ${c===i.id?r("settings.providers.configuring"):r("settings.providers.saveConfig")}
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

//# debugId=DA17314EA0A7625864756E2164756E21
//# sourceMappingURL=providers-kf8204jg.js.map
