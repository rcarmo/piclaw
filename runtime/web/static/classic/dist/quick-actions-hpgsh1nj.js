import{t,o,i,n,e}from"./app-z5v3n7bb.js";import{we,xe,Qt}from"./app-79kme4sa.js";import{U,H}from"./app-xk696jzx.js";import{s}from"./app-139cy0ee.js";function T(g,...m){let h=String(g||"").trim().toLowerCase();if(!h)return!0;return m.some((r)=>String(r||"").toLowerCase().includes(h))}function B(g){if(!Array.isArray(g))return null;return new Set(g.map((m)=>String(m||"").trim().toLowerCase()).filter(Boolean))}function D({filter:g="",setStatus:m,mergeSettingsData:h}){let{t:r}=s(),[k,v]=t(()=>U.map((a)=>a.id)),[A,C]=t([]),[u,Q]=t([]),[W,b]=t(!0),[p,f]=t(!1),S=n(async()=>{b(!0);try{let[a,c]=await Promise.all([xe(),we("web:default").catch(()=>({commands:[]}))]),l=H(a?.settings),d=Array.isArray(c?.commands)?c.commands:[];Q(d),v(Array.isArray(l.workspaceCommands)?l.workspaceCommands:U.map((y)=>y.id)),C(Array.isArray(l.slashCommands)?l.slashCommands:d.map((y)=>String(y?.name||"").trim()).filter(Boolean))}catch(a){m?.(String(a?.message||a),"error")}finally{b(!1)}},[m]);o(()=>{S()},[S]);let w=i(()=>B(k),[k]),q=i(()=>B(A),[A]),x=i(()=>U.filter((a)=>T(g,a.label,a.description,...a.keywords||[])),[g]),L=i(()=>u.filter((a)=>T(g,a?.name,a?.description,a?.source)),[u,g]),E=n((a)=>{v((c)=>{let l=new Set((Array.isArray(c)?c:[]).map((d)=>String(d||"").trim()).filter(Boolean));if(l.has(a))l.delete(a);else l.add(a);return U.map((d)=>d.id).filter((d)=>l.has(d))})},[]),M=n((a)=>{C((c)=>{let l=new Set((Array.isArray(c)?c:[]).map((d)=>String(d||"").trim()).filter(Boolean));if(l.has(a))l.delete(a);else l.add(a);return u.map((d)=>String(d?.name||"").trim()).filter((d)=>d&&l.has(d))})},[u]),P=n(()=>{v(U.map((a)=>a.id)),C(u.map((a)=>String(a?.name||"").trim()).filter(Boolean))},[u]),O=n(async()=>{if(p)return;f(!0),m?.(r("settings.quickActions.savingToast"),"info");try{let a=await Qt({workspaceCommands:k,slashCommands:A}),c=H(a?.settings);h?.({quickActions:c}),window.dispatchEvent(new CustomEvent("piclaw:quick-actions-settings-updated",{detail:{settings:c}})),m?.(r("settings.quickActions.savedToast"),"success")}catch(a){m?.(String(a?.message||a),"error")}finally{f(!1)}},[h,p,m,A,k]);if(W)return e`<div class="settings-loading">${r("settings.quickActions.loading")}</div>`;return e`
        <div class="settings-section">
            <h3>${r("settings.quickActions.heading")}</h3>
            <p class="settings-hint">
                ${r("settings.quickActions.intro")}
            </p>

            <div class="settings-actions">
                <button class="settings-addon-btn" onClick=${P} disabled=${p}>${r("settings.quickActions.enableAll")}</button>
                <button class="settings-addon-btn settings-addon-btn-install" onClick=${O} disabled=${p}>
                    ${p?r("settings.quickActions.saving"):r("settings.quickActions.saveApply")}
                </button>
            </div>

            <h3 style="margin-top:8px;">${r("settings.quickActions.workspaceCommands")}</h3>
            <div class="settings-subsection-list">
                ${x.map((a)=>{let c=w?w.has(a.id.toLowerCase()):!0;return e`
                        <label class="settings-checkbox-row" key=${a.id}>
                            <input type="checkbox" checked=${c} onChange=${()=>E(a.id)} />
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
                            <input type="checkbox" checked=${l} onChange=${()=>M(c)} />
                            <div>
                                <div><code>${c}</code></div>
                                <div class="settings-hint" style="margin:2px 0 0 0;">${a?.description||r("settings.quickActions.slashFallback")}</div>
                            </div>
                        </label>
                    `})}
                ${L.length===0&&e`<div class="settings-hint">${String(g||"").trim()?r("settings.quickActions.noSlashMatch"):r("settings.quickActions.noSlashCommands")}</div>`}
            </div>
        </div>
    `}export{D as QuickActionsSection};

//# debugId=B79EA82C63ABEABB64756E2164756E21
//# sourceMappingURL=quick-actions-hpgsh1nj.js.map
