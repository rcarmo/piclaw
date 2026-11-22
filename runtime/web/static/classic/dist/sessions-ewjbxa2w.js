import{t,o,r,i,n,e}from"./app-k38vseyk.js";import{p}from"./app-pvk63zk3.js";import{m}from"./app-dwc7n5xq.js";import{s}from"./app-w58mksdq.js";function N(g={}){return{sessionIsolation:g.sessionIsolation||"none",toolUseBudget:g.toolUseBudget??64}}function H({settingsData:g,setStatus:v,mergeSettingsData:w}){let b=m("sessions"),{t:a}=s(),[h,B]=t(64),[y,T]=t("none"),[R,I]=t(!1),S=r(""),d=r(null),c=r(!0);o(()=>(c.current=!0,()=>{c.current=!1}),[]);let x=n((l)=>{let u=N(l);B(u.toolUseBudget),T(u.sessionIsolation),S.current=JSON.stringify(u)},[]);o(()=>{x(g||{})},[g,x]);let f=i(()=>JSON.stringify(N({toolUseBudget:h,sessionIsolation:y})),[h,y]);return o(()=>{if(f===S.current)return;if(d.current)clearTimeout(d.current);return d.current=setTimeout(async()=>{if(!c.current)return;try{let l=await fetch("/agent/settings/general",{method:"POST",headers:{"Content-Type":"application/json"},body:f}),u=await l.json().catch(()=>({}));if(!c.current)return;if(!l.ok||!u?.ok||!u?.settings)throw Error(u?.error||`Failed to save session settings (${l.status})`);S.current=f,w?.(u.settings),v?.(null),I(!0),setTimeout(()=>{if(c.current)I(!1)},4000)}catch(l){if(console.warn("[settings/sessions] Failed to persist session settings.",l),c.current)v?.(String(l?.message||l),"error")}},800),()=>{if(d.current)clearTimeout(d.current)}},[f,w,v]),e`
        <div class="settings-section">
            ${R&&e`
                <div class="settings-general-applied-notice" role="status" aria-live="polite">
                    ${a("settings.appliedNotice")}
                </div>
            `}
            <h3 style="margin-top:20px">${a("settings.sessions.agentBehaviour")}</h3>
            <div class="settings-row settings-dense-row">
                <label>${a("settings.sessions.toolBudget")}</label>
                <${p}
                    label=${a("settings.sessions.toolBudgetAria")}
                    value=${h}
                    min=${8}
                    max=${512}
                    fallback=${64}
                    width="80px"
                    onChange=${B}
                />
                <span class="settings-hint">${a("settings.sessions.toolBudgetHint")}</span>
            </div>
            <div class="settings-row settings-dense-row">
                <label for=${b("isolation")}>${a("settings.sessions.isolation")}</label>
                <select id=${b("isolation")} value=${y} onChange=${(l)=>T(l.target.value)}>
                    <option value="none">${a("settings.sessions.isolationNone")}</option>
                    <option value="summary">${a("settings.sessions.isolationSummary")}</option>
                    <option value="full">${a("settings.sessions.isolationFull")}</option>
                </select>
            </div>

        </div>
    `}export{H as SessionsSection};

//# debugId=9F5FCE6505A380A064756E2164756E21
//# sourceMappingURL=sessions-ewjbxa2w.js.map
