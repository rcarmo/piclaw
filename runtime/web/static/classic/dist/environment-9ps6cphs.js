import{t,o,i,r,e}from"./app-863dk79s.js";import{rn,ut}from"./app-r6ty9k25.js";import{s}from"./app-wq98hqjx.js";function b(g={}){let v=g.environmentSettings||g.settings||g.environment||{};return{variables:Array.isArray(v.variables)?v.variables:[],overrides:v.overrides&&typeof v.overrides==="object"?v.overrides:{},count:Number(v.count||0),overrideCount:Number(v.overrideCount||0),keychainEnvNames:Array.isArray(v.keychainEnvNames)?v.keychainEnvNames:[]}}function R({settingsData:g,filter:v="",setStatus:m,mergeSettingsData:k}){let{t:c}=s(),[p,x]=t(()=>b(g||{})),[N,h]=t({}),[u,E]=t(""),[w,C]=t(""),[A,f]=t(null);o(()=>{x(b(g||{})),h({})},[g]);let y=r((n)=>{let a=b({environmentSettings:n?.settings||n});return x(a),k?.({environmentSettings:a}),h({}),a},[k]),j=r(async()=>{try{let n=await rn();if(n?.ok)y(n.settings);m?.(c("settings.environment.refreshedToast"),"info")}catch(n){m?.(String(n?.message||n),"error")}},[y,m]),S=r(async(n,a)=>{let l=String(n||"").trim();if(!l)return;f(l);try{let d=await ut({action:"set",name:l,value:String(a??"")});if(d?.ok)y(d.settings);if(m?.(c("settings.environment.savedToast",{name:l}),"info"),l===u.trim())E(""),C("")}catch(d){m?.(String(d?.message||d),"error")}finally{f(null)}},[y,u,m]),I=r(async(n)=>{let a=String(n||"").trim();if(!a)return;f(a);try{let l=await ut({action:"clear",name:a});if(l?.ok)y(l.settings);m?.(c("settings.environment.clearedToast",{name:a}),"info")}catch(l){m?.(String(l?.message||l),"error")}finally{f(null)}},[y,m]),O=i(()=>{let n=String(v||"").trim().toLowerCase(),a=Array.isArray(p.variables)?p.variables:[];if(!n)return a;return a.filter((l)=>`${l?.name||""} ${l?.value||""} ${l?.source||""}`.toLowerCase().includes(n))},[p.variables,v]),L=r((n,a)=>{h((l)=>({...l||{},[n]:a}))},[]);return e`
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
                        onInput=${(n)=>E(n.target.value)}
                    />
                    <input
                        type="text"
                        value=${w}
                        placeholder=${c("settings.environment.valuePlaceholder")}
                        spellcheck="false"
                        onInput=${(n)=>C(n.target.value)}
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
                ${O.map((n)=>{let a=String(n?.name||""),l=Object.prototype.hasOwnProperty.call(N,a)?N[a]:n.value,d=l!==n.value,P=A===a;return e`
                        <div class="settings-tool-row settings-env-row" key=${a}>
                            <span class="settings-tool-name" title=${a}>${a}</span>
                            <input
                                type="text"
                                value=${l}
                                spellcheck="false"
                                onInput=${(T)=>L(a,T.target.value)}
                                style="min-width:0; width:100%; font-family:var(--font-mono, monospace);"
                            />
                            <span class="settings-tool-kind" title=${n.overridden?c("settings.environment.overridden"):c("settings.environment.inherited")}>
                                ${n.overridden?c("settings.environment.kindOverride"):c("settings.environment.kindProcess")}
                            </span>
                            <span style="display:flex; gap:6px; justify-content:flex-end;">
                                <button type="button" disabled=${P||!d} onClick=${()=>S(a,l)}>${c("settings.environment.save")}</button>
                                <button type="button" disabled=${P||!n.overridden} onClick=${()=>I(a)}>${c("settings.environment.clear")}</button>
                            </span>
                        </div>
                    `})}
                ${O.length===0&&e`<p class="settings-hint">${String(v||"").trim()?c("settings.environment.noMatch",{filter:v}):c("settings.environment.empty")}</p>`}
            </div>
        </div>
    `}export{R as EnvironmentSection};

//# debugId=D23882858C63EF6064756E2164756E21
//# sourceMappingURL=environment-9ps6cphs.js.map
