import{t,o,i,r,e}from"./app-1vedzwvv.js";import{xe,Se,Yt}from"./app-n8nzkwkj.js";import{j,H}from"./app-x2ckvj8c.js";import{s}from"./app-3fbwg9z4.js";function T(g,...m){let h=String(g||"").trim().toLowerCase();if(!h)return!0;return m.some((c)=>String(c||"").toLowerCase().includes(h))}function B(g){if(!Array.isArray(g))return null;return new Set(g.map((m)=>String(m||"").trim().toLowerCase()).filter(Boolean))}function D({filter:g="",setStatus:m,mergeSettingsData:h}){let{t:c}=s(),[k,v]=t(()=>j.map((n)=>n.id)),[A,C]=t([]),[u,Q]=t([]),[W,b]=t(!0),[p,f]=t(!1),S=r(async()=>{b(!0);try{let[n,a]=await Promise.all([Se(),xe("web:default").catch(()=>({commands:[]}))]),l=H(n?.settings),d=Array.isArray(a?.commands)?a.commands:[];Q(d),v(Array.isArray(l.workspaceCommands)?l.workspaceCommands:j.map((y)=>y.id)),C(Array.isArray(l.slashCommands)?l.slashCommands:d.map((y)=>String(y?.name||"").trim()).filter(Boolean))}catch(n){m?.(String(n?.message||n),"error")}finally{b(!1)}},[m]);o(()=>{S()},[S]);let w=i(()=>B(k),[k]),q=i(()=>B(A),[A]),x=i(()=>j.filter((n)=>T(g,n.label,n.description,...n.keywords||[])),[g]),L=i(()=>u.filter((n)=>T(g,n?.name,n?.description,n?.source)),[u,g]),E=r((n)=>{v((a)=>{let l=new Set((Array.isArray(a)?a:[]).map((d)=>String(d||"").trim()).filter(Boolean));if(l.has(n))l.delete(n);else l.add(n);return j.map((d)=>d.id).filter((d)=>l.has(d))})},[]),M=r((n)=>{C((a)=>{let l=new Set((Array.isArray(a)?a:[]).map((d)=>String(d||"").trim()).filter(Boolean));if(l.has(n))l.delete(n);else l.add(n);return u.map((d)=>String(d?.name||"").trim()).filter((d)=>d&&l.has(d))})},[u]),P=r(()=>{v(j.map((n)=>n.id)),C(u.map((n)=>String(n?.name||"").trim()).filter(Boolean))},[u]),O=r(async()=>{if(p)return;f(!0),m?.(c("settings.quickActions.savingToast"),"info");try{let n=await Yt({workspaceCommands:k,slashCommands:A}),a=H(n?.settings);h?.({quickActions:a}),window.dispatchEvent(new CustomEvent("piclaw:quick-actions-settings-updated",{detail:{settings:a}})),m?.(c("settings.quickActions.savedToast"),"success")}catch(n){m?.(String(n?.message||n),"error")}finally{f(!1)}},[h,p,m,A,k]);if(W)return e`<div class="settings-loading">${c("settings.quickActions.loading")}</div>`;return e`
        <div class="settings-section">
            <h3>${c("settings.quickActions.heading")}</h3>
            <p class="settings-hint">
                ${c("settings.quickActions.intro")}
            </p>

            <div class="settings-actions">
                <button class="settings-addon-btn" onClick=${P} disabled=${p}>${c("settings.quickActions.enableAll")}</button>
                <button class="settings-addon-btn settings-addon-btn-install" onClick=${O} disabled=${p}>
                    ${p?c("settings.quickActions.saving"):c("settings.quickActions.saveApply")}
                </button>
            </div>

            <h3 style="margin-top:8px;">${c("settings.quickActions.workspaceCommands")}</h3>
            <div class="settings-subsection-list">
                ${x.map((n)=>{let a=w?w.has(n.id.toLowerCase()):!0;return e`
                        <label class="settings-checkbox-row" key=${n.id}>
                            <input type="checkbox" checked=${a} onChange=${()=>E(n.id)} />
                            <div>
                                <div>${n.label}</div>
                                <div class="settings-hint" style="margin:2px 0 0 0;">${n.description}</div>
                            </div>
                        </label>
                    `})}
                ${x.length===0&&e`<div class="settings-hint">${c("settings.quickActions.noWorkspaceMatch")}</div>`}
            </div>

            <h3 style="margin-top:20px;">${c("settings.quickActions.slashCommands")}</h3>
            <div class="settings-subsection-list">
                ${L.map((n)=>{let a=String(n?.name||"").trim(),l=q?q.has(a.toLowerCase()):!0;return e`
                        <label class="settings-checkbox-row" key=${a}>
                            <input type="checkbox" checked=${l} onChange=${()=>M(a)} />
                            <div>
                                <div><code>${a}</code></div>
                                <div class="settings-hint" style="margin:2px 0 0 0;">${n?.description||c("settings.quickActions.slashFallback")}</div>
                            </div>
                        </label>
                    `})}
                ${L.length===0&&e`<div class="settings-hint">${String(g||"").trim()?c("settings.quickActions.noSlashMatch"):c("settings.quickActions.noSlashCommands")}</div>`}
            </div>
        </div>
    `}export{D as QuickActionsSection};

//# debugId=AB8E0E41AB68129C64756E2164756E21
//# sourceMappingURL=quick-actions-4z8rjs14.js.map
