import{t,o,r,i,n,e}from"./app-0h4wyc77.js";import{p}from"./app-yacmwv03.js";import{m}from"./app-q36g8ssr.js";import{s}from"./app-ahzvmhbs.js";function O(d={}){return{autoCompactionEnabled:Boolean(d.autoCompactionEnabled??!0),localLitePromptProfileEnabled:Boolean(d.localLitePromptProfileEnabled??!1),progressWatchdogEnabled:Boolean(d.progressWatchdogEnabled??!1),progressWatchdogTimeoutSec:d.progressWatchdogTimeoutSec??300,progressWatchdogPhases:Array.isArray(d.progressWatchdogPhases)?d.progressWatchdogPhases:[]}}function H(d){let g=String(d||"").trim();if(!g)return"—";let b=new Date(g);if(Number.isNaN(b.getTime()))return g;return b.toLocaleString()}function j({settingsData:d,setStatus:g,mergeSettingsData:b}){let h=m("compaction"),{t:c}=s(),[w,T]=t(!0),[W,C]=t(!1),[v,S]=t(!1),[E,x]=t(300),[L,N]=t([]),[B,A]=t(!1),y=r(""),f=r(null),u=r(!0);o(()=>(u.current=!0,()=>{u.current=!1}),[]);let P=n((a)=>{let l=O(a);T(l.autoCompactionEnabled),C(l.localLitePromptProfileEnabled),S(l.progressWatchdogEnabled),x(l.progressWatchdogTimeoutSec),N(l.progressWatchdogPhases),y.current=JSON.stringify({autoCompactionEnabled:l.autoCompactionEnabled,localLitePromptProfileEnabled:l.localLitePromptProfileEnabled,progressWatchdogEnabled:l.progressWatchdogEnabled,progressWatchdogTimeoutSec:l.progressWatchdogTimeoutSec})},[]);o(()=>{P(d||{})},[d,P]);let k=i(()=>JSON.stringify({autoCompactionEnabled:w,localLitePromptProfileEnabled:W,progressWatchdogEnabled:v,progressWatchdogTimeoutSec:E}),[w,W,v,E]);return o(()=>{if(k===y.current)return;if(f.current)clearTimeout(f.current);return f.current=setTimeout(async()=>{if(!u.current)return;try{g?.(c("settings.compaction.saving"),"info");let a=await fetch("/agent/settings/compaction",{method:"POST",headers:{"Content-Type":"application/json"},body:k}),l=await a.json().catch(()=>({}));if(!u.current)return;if(!a.ok||!l?.ok||!l?.settings){g?.(l?.error||c("settings.compaction.saveFailed"),"error");return}y.current=k,b?.(l.settings),P({...d||{},...l.settings||{}}),g?.(c("settings.compaction.saved"),"success"),A(!0),setTimeout(()=>{if(u.current)A(!1),g?.(null)},4000)}catch(a){if(console.warn("[settings/compaction] Failed to persist compaction settings.",a),u.current)g?.(c("settings.compaction.saveFailed"),"error")}},800),()=>{if(f.current)clearTimeout(f.current)}},[k,b,g,P,d]),e`
        <div class="settings-section settings-dense-form">
            ${B&&e`
                <div class="settings-general-applied-notice" role="status" aria-live="polite">
                    ${c("settings.compaction.saved")}
                </div>
            `}

            <h3>Local models</h3>
            <div class="settings-row settings-dense-row settings-dense-row-checkbox">
                <label class="settings-dense-check" for=${h("check-1")}>
                    <input id=${h("check-1")} type="checkbox" checked=${W} onChange=${(a)=>C(Boolean(a.target.checked))} />
                    <span>Local-lite prompt</span>
                </label>
                <span class="settings-hint">Off by default. When enabled, local endpoints use a compact prompt without changing tool availability. Changes apply on the next turn.</span>
            </div>
            <h3>${c("settings.compaction.autoHeading")}</h3>
            <div class="settings-row settings-dense-row settings-dense-row-checkbox">
                <label class="settings-dense-check" for=${h("check-2")}>
                    <input id=${h("check-2")} type="checkbox" checked=${w} onChange=${(a)=>T(Boolean(a.target.checked))} />
                    <span>${c("settings.compaction.enableAutomatic")}</span>
                </label>
                <span class="settings-hint">Native compaction uses the active conversation model and SDK thresholds. Changes apply at the next compaction decision; already accepted maintenance is not cancelled.</span>
            </div>
            <p class="settings-hint">Use Optimisation for tool-output reduction, retained originals and model-written summaries.</p>
            <h3 style="margin-top:20px">${c("settings.compaction.watchdogHeading")}</h3>
            <div class="settings-row settings-dense-row settings-dense-row-checkbox">
                <label class="settings-dense-check" for=${h("check-5")}>
                    <input id=${h("check-5")} type="checkbox" checked=${v} onChange=${(a)=>S(Boolean(a.target.checked))} />
                    <span>${c("settings.compaction.enableWatchdog")}</span>
                </label>
                <span class="settings-hint">${c("settings.compaction.enableWatchdogHint")}</span>
            </div>
            <div class="settings-row settings-dense-row">
                <label>${c("settings.compaction.watchdogTimeout")}</label>
                <${p}
                    label=${c("settings.compaction.watchdogTimeoutAria")}
                    value=${E}
                    min=${0}
                    max=${3600}
                    fallback=${300}
                    width="90px"
                    disabled=${!v}
                    onChange=${x}
                />
                <span class="settings-hint" style="margin:0">${c("settings.compaction.watchdogTimeoutHint")}</span>
            </div>

            <h3 style="margin-top:20px">${c("settings.compaction.phasesHeading")}</h3>
            ${L.length===0?e`
                <p class="settings-hint">${c("settings.compaction.noPhases")}</p>
            `:e`
                <div class="settings-table-wrapper">
                    <table class="settings-table">
                        <thead>
                            <tr>
                                <th>Chat</th>
                                <th>Phase</th>
                                <th>Started</th>
                                <th>Last heartbeat</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${L.map((a)=>e`
                                <tr>
                                    <td><code>${a.chatJid}</code></td>
                                    <td>${a.phase}</td>
                                    <td>${H(a.startedAt)}</td>
                                    <td>${H(a.lastProgressAt)}</td>
                                </tr>
                            `)}
                        </tbody>
                    </table>
                </div>
            `}
        </div>
    `}export{j as CompactionSection};

//# debugId=28FCEAF924DE4AC064756E2164756E21
//# sourceMappingURL=compaction-ahbxg7tf.js.map
