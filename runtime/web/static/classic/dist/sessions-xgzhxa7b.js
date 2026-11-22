import{t,o,r,i,n,e}from"./app-c7xgjke0.js";import{m}from"./app-kw0x58x3.js";import{y}from"./app-8rxq9r6x.js";import{s}from"./app-dr786pqe.js";function N(g={}){return{sessionIsolation:g.sessionIsolation||"none",toolUseBudget:g.toolUseBudget??64}}function H({settingsData:g,setStatus:f,mergeSettingsData:w}){let b=y("sessions"),{t:a}=s(),[v,B]=t(64),[h,T]=t("none"),[R,I]=t(!1),S=r(""),p=r(null),c=r(!0);o(()=>(c.current=!0,()=>{c.current=!1}),[]);let x=n((l)=>{let u=N(l);B(u.toolUseBudget),T(u.sessionIsolation),S.current=JSON.stringify(u)},[]);o(()=>{x(g||{})},[g,x]);let d=i(()=>JSON.stringify(N({toolUseBudget:v,sessionIsolation:h})),[v,h]);return o(()=>{if(d===S.current)return;if(p.current)clearTimeout(p.current);return p.current=setTimeout(async()=>{if(!c.current)return;try{let l=await fetch("/agent/settings/general",{method:"POST",headers:{"Content-Type":"application/json"},body:d}),u=await l.json().catch(()=>({}));if(!c.current)return;if(!l.ok||!u?.ok||!u?.settings)throw Error(u?.error||`Failed to save session settings (${l.status})`);S.current=d,w?.(u.settings),f?.(null),I(!0),setTimeout(()=>{if(c.current)I(!1)},4000)}catch(l){if(console.warn("[settings/sessions] Failed to persist session settings.",l),c.current)f?.(String(l?.message||l),"error")}},800),()=>{if(p.current)clearTimeout(p.current)}},[d,w,f]),e`
        <div class="settings-section">
            ${R&&e`
                <div class="settings-general-applied-notice" role="status" aria-live="polite">
                    ${a("settings.appliedNotice")}
                </div>
            `}
            <h3 style="margin-top:20px">${a("settings.sessions.agentBehaviour")}</h3>
            <div class="settings-row settings-dense-row">
                <label>${a("settings.sessions.toolBudget")}</label>
                <${m}
                    label=${a("settings.sessions.toolBudgetAria")}
                    value=${v}
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
                <select id=${b("isolation")} value=${h} onChange=${(l)=>T(l.target.value)}>
                    <option value="none">${a("settings.sessions.isolationNone")}</option>
                    <option value="summary">${a("settings.sessions.isolationSummary")}</option>
                    <option value="full">${a("settings.sessions.isolationFull")}</option>
                </select>
            </div>

        </div>
    `}export{H as SessionsSection};

//# debugId=39269F1BF571860864756E2164756E21
//# sourceMappingURL=sessions-xgzhxa7b.js.map
