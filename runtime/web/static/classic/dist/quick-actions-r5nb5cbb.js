import{t,o,i,n,e}from"./app-p2arjngp.js";import{be,ve,qt}from"./app-43bh51ak.js";import{B,j}from"./app-z391zb72.js";import{s}from"./app-dg3gg17f.js";function T(g,...m){let h=String(g||"").trim().toLowerCase();if(!h)return!0;return m.some((r)=>String(r||"").toLowerCase().includes(h))}function Q(g){if(!Array.isArray(g))return null;return new Set(g.map((m)=>String(m||"").trim().toLowerCase()).filter(Boolean))}function G({filter:g="",setStatus:m,mergeSettingsData:h}){let{t:r}=s(),[k,v]=t(()=>B.map((a)=>a.id)),[A,C]=t([]),[u,W]=t([]),[E,b]=t(!0),[p,f]=t(!1),S=n(async()=>{b(!0);try{let[a,c]=await Promise.all([ve(),be("web:default").catch(()=>({commands:[]}))]),l=j(a?.settings),d=Array.isArray(c?.commands)?c.commands:[];W(d),v(Array.isArray(l.workspaceCommands)?l.workspaceCommands:B.map((y)=>y.id)),C(Array.isArray(l.slashCommands)?l.slashCommands:d.map((y)=>String(y?.name||"").trim()).filter(Boolean))}catch(a){m?.(String(a?.message||a),"error")}finally{b(!1)}},[m]);o(()=>{S()},[S]);let w=i(()=>Q(k),[k]),q=i(()=>Q(A),[A]),x=i(()=>B.filter((a)=>T(g,a.label,a.description,...a.keywords||[])),[g]),L=i(()=>u.filter((a)=>T(g,a?.name,a?.description,a?.source)),[u,g]),M=n((a)=>{v((c)=>{let l=new Set((Array.isArray(c)?c:[]).map((d)=>String(d||"").trim()).filter(Boolean));if(l.has(a))l.delete(a);else l.add(a);return B.map((d)=>d.id).filter((d)=>l.has(d))})},[]),P=n((a)=>{C((c)=>{let l=new Set((Array.isArray(c)?c:[]).map((d)=>String(d||"").trim()).filter(Boolean));if(l.has(a))l.delete(a);else l.add(a);return u.map((d)=>String(d?.name||"").trim()).filter((d)=>d&&l.has(d))})},[u]),O=n(()=>{v(B.map((a)=>a.id)),C(u.map((a)=>String(a?.name||"").trim()).filter(Boolean))},[u]),_=n(async()=>{if(p)return;f(!0),m?.(r("settings.quickActions.savingToast"),"info");try{let a=await qt({workspaceCommands:k,slashCommands:A}),c=j(a?.settings);h?.({quickActions:c}),window.dispatchEvent(new CustomEvent("piclaw:quick-actions-settings-updated",{detail:{settings:c}})),m?.(r("settings.quickActions.savedToast"),"success")}catch(a){m?.(String(a?.message||a),"error")}finally{f(!1)}},[h,p,m,A,k]);if(E)return e`<div class="settings-loading">${r("settings.quickActions.loading")}</div>`;return e`
        <div class="settings-section">
            <h3>${r("settings.quickActions.heading")}</h3>
            <p class="settings-hint">
                ${r("settings.quickActions.intro")}
            </p>

            <div class="settings-actions">
                <button class="settings-addon-btn" onClick=${O} disabled=${p}>${r("settings.quickActions.enableAll")}</button>
                <button class="settings-addon-btn settings-addon-btn-install" onClick=${_} disabled=${p}>
                    ${p?r("settings.quickActions.saving"):r("settings.quickActions.saveApply")}
                </button>
            </div>

            <h3 style="margin-top:8px;">${r("settings.quickActions.workspaceCommands")}</h3>
            <div class="settings-subsection-list">
                ${x.map((a)=>{let c=w?w.has(a.id.toLowerCase()):!0;return e`
                        <label class="settings-checkbox-row" key=${a.id}>
                            <input type="checkbox" checked=${c} onChange=${()=>M(a.id)} />
                            <div>
                                <div>${a.label}</div>
                                <div class="settings-hint" style="margin:2px 0 0 0;">${a.description}</div>
                            </div>
                        </label>
                    `})}
                ${x.length===0&&e`<div class="settings-hint">${r("settings.quickActions.noWorkspaceMatch")}</div>`}
            </div>

            <h3 style="margin-top:20px;">${r("settings.quickActions.slashCommands")}</h3>
            <div class="settings-subsection-list">
                ${L.map((a)=>{let c=String(a?.name||"").trim(),l=q?q.has(c.toLowerCase()):!0;return e`
                        <label class="settings-checkbox-row" key=${c}>
                            <input type="checkbox" checked=${l} onChange=${()=>P(c)} />
                            <div>
                                <div><code>${c}</code></div>
                                <div class="settings-hint" style="margin:2px 0 0 0;">${a?.description||r("settings.quickActions.slashFallback")}</div>
                            </div>
                        </label>
                    `})}
                ${L.length===0&&e`<div class="settings-hint">${String(g||"").trim()?r("settings.quickActions.noSlashMatch"):r("settings.quickActions.noSlashCommands")}</div>`}
            </div>
        </div>
    `}export{G as QuickActionsSection};

//# debugId=09AA7DAAFC053A9264756E2164756E21
//# sourceMappingURL=quick-actions-r5nb5cbb.js.map
