import{t,o,i,n,e}from"./app-qr16549r.js";import{Wt,et}from"./app-xrhr0nn5.js";import{s}from"./app-pjkx5abb.js";function b(g={}){let v=g.environmentSettings||g.settings||g.environment||{};return{variables:Array.isArray(v.variables)?v.variables:[],overrides:v.overrides&&typeof v.overrides==="object"?v.overrides:{},count:Number(v.count||0),overrideCount:Number(v.overrideCount||0),keychainEnvNames:Array.isArray(v.keychainEnvNames)?v.keychainEnvNames:[]}}function R({settingsData:g,filter:v="",setStatus:m,mergeSettingsData:k}){let{t:c}=s(),[p,x]=t(()=>b(g||{})),[N,h]=t({}),[u,E]=t(""),[w,C]=t(""),[A,f]=t(null);o(()=>{x(b(g||{})),h({})},[g]);let y=n((r)=>{let a=b({environmentSettings:r?.settings||r});return x(a),k?.({environmentSettings:a}),h({}),a},[k]),j=n(async()=>{try{let r=await Wt();if(r?.ok)y(r.settings);m?.(c("settings.environment.refreshedToast"),"info")}catch(r){m?.(String(r?.message||r),"error")}},[y,m]),S=n(async(r,a)=>{let l=String(r||"").trim();if(!l)return;f(l);try{let d=await et({action:"set",name:l,value:String(a??"")});if(d?.ok)y(d.settings);if(m?.(c("settings.environment.savedToast",{name:l}),"info"),l===u.trim())E(""),C("")}catch(d){m?.(String(d?.message||d),"error")}finally{f(null)}},[y,u,m]),I=n(async(r)=>{let a=String(r||"").trim();if(!a)return;f(a);try{let l=await et({action:"clear",name:a});if(l?.ok)y(l.settings);m?.(c("settings.environment.clearedToast",{name:a}),"info")}catch(l){m?.(String(l?.message||l),"error")}finally{f(null)}},[y,m]),O=i(()=>{let r=String(v||"").trim().toLowerCase(),a=Array.isArray(p.variables)?p.variables:[];if(!r)return a;return a.filter((l)=>`${l?.name||""} ${l?.value||""} ${l?.source||""}`.toLowerCase().includes(r))},[p.variables,v]),L=n((r,a)=>{h((l)=>({...l||{},[r]:a}))},[]);return e`
        <div class="settings-section">
            <div style="display:flex; align-items:flex-start; justify-content:space-between; gap:12px; margin-bottom:12px;">
                <div>
                    <h3 style="margin-top:0">${c("settings.environment.heading")}</h3>
                    <p class="settings-hint" style="margin-top:4px">
                        ${c("settings.environment.introPre")} <code>process.env</code>${c("settings.environment.introPost")}
                    </p>
                </div>
                <button type="button" class="settings-secondary-btn" onClick=${j}>${c("settings.environment.refresh")}</button>
            </div>

            <div class="settings-row" style="align-items:flex-start; gap:10px;">
                <label>${c("settings.environment.addOverride")}</label>
                <div class="settings-env-add">
                    <input
                        type="text"
                        value=${u}
                        placeholder="VARIABLE_NAME"
                        spellcheck="false"
                        onInput=${(r)=>E(r.target.value)}
                    />
                    <input
                        type="text"
                        value=${w}
                        placeholder=${c("settings.environment.valuePlaceholder")}
                        spellcheck="false"
                        onInput=${(r)=>C(r.target.value)}
                    />
                    <button
                        type="button"
                        disabled=${!u.trim()||A===u.trim()}
                        onClick=${()=>S(u,w)}
                    >${c("settings.environment.save")}</button>
                </div>
            </div>

            <p class="settings-hint">
                ${c("settings.environment.countLine",{count:p.count,overrides:p.overrideCount,keychain:p.keychainEnvNames.length})}
            </p>

            <div class="settings-tool-list" style="max-height:58vh; overflow:auto;">
                ${O.map((r)=>{let a=String(r?.name||""),l=Object.prototype.hasOwnProperty.call(N,a)?N[a]:r.value,d=l!==r.value,P=A===a;return e`
                        <div class="settings-tool-row settings-env-row" key=${a}>
                            <span class="settings-tool-name" title=${a}>${a}</span>
                            <input
                                type="text"
                                value=${l}
                                spellcheck="false"
                                onInput=${(T)=>L(a,T.target.value)}
                                style="min-width:0; width:100%; font-family:var(--font-mono, monospace);"
                            />
                            <span class="settings-tool-kind" title=${r.overridden?c("settings.environment.overridden"):c("settings.environment.inherited")}>
                                ${r.overridden?c("settings.environment.kindOverride"):c("settings.environment.kindProcess")}
                            </span>
                            <span style="display:flex; gap:6px; justify-content:flex-end;">
                                <button type="button" disabled=${P||!d} onClick=${()=>S(a,l)}>${c("settings.environment.save")}</button>
                                <button type="button" disabled=${P||!r.overridden} onClick=${()=>I(a)}>${c("settings.environment.clear")}</button>
                            </span>
                        </div>
                    `})}
                ${O.length===0&&e`<p class="settings-hint">${String(v||"").trim()?c("settings.environment.noMatch",{filter:v}):c("settings.environment.empty")}</p>`}
            </div>
        </div>
    `}export{R as EnvironmentSection};

//# debugId=5119F4C60183DF4564756E2164756E21
//# sourceMappingURL=environment-qwnzph9a.js.map
