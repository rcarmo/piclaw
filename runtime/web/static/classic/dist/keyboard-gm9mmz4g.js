import{t,o,i,e}from"./app-017vdhd7.js";import{F,we,Ln,We,Fn,On,Nn}from"./app-138rsget.js";import{s}from"./app-mbxfp7m6.js";function h(){let d=Nn();return Object.fromEntries(Object.entries(d).map(([a,r])=>[a,We(r)]))}function f(d,a){let r=String(d||"").trim().toLowerCase();if(!r)return F;return F.filter((c)=>[c.label,c.description,a[c.id],...c.defaultBindings].some((u)=>String(u||"").toLowerCase().includes(r)))}function y(d,a){let r=String(a||"").trim(),u=(r?r.split(/[\n,]/).map((l)=>l.trim()).filter(Boolean):[]).find((l)=>!we(l));if(u)return{ok:!1,invalidToken:u,drafts:h()};return Fn(d,Ln(r)),{ok:!0,drafts:h()}}function g(d){return On(d),h()}function C({filter:d="",setStatus:a}){let{t:r}=s(),[c,u]=t(h);o(()=>{let n=()=>u(h());return window.addEventListener("piclaw:keyboard-shortcuts-changed",n),()=>window.removeEventListener("piclaw:keyboard-shortcuts-changed",n)},[]);let l=i(()=>f(d,c),[c,d]),p=(n)=>{let b=y(n,c[n]||"");if(!b.ok){a?.(r("settings.keyboard.invalidShortcut",{token:b.invalidToken||""}),"error");return}u(b.drafts),a?.(r("settings.keyboard.saved"),"success")},v=(n)=>{u(g(n)),a?.(r("settings.keyboard.resetOne"),"success")},S=()=>{u(g()),a?.(r("settings.keyboard.resetAllDone"),"success")};return e`
        <div class="settings-section">
            <h3>${r("settings.keyboard.heading")}</h3>
            <p class="settings-hint">
                ${r("settings.keyboard.hint1")}
                <code>Escape</code> ${r("settings.keyboard.hint1b")}
            </p>
            <p class="settings-hint">
                <code>/help</code> ${r("settings.keyboard.hint2mid")} <code>"</code> ${r("settings.keyboard.hint2end")}
            </p>

            <div class="settings-shortcut-toolbar">
                <button type="button" class="settings-addon-btn" onClick=${S}>${r("settings.keyboard.resetAll")}</button>
            </div>

            <div class="settings-shortcut-list">
                ${l.map((n)=>{let b=`settings-shortcut-${n.id}`;return e`
                    <div class="settings-shortcut-card" key=${n.id}>
                        <div class="settings-shortcut-copy">
                            <label class="settings-shortcut-title" for=${b}>${n.label}</label>
                            <div class="settings-hint settings-shortcut-description">${n.description}</div>
                            <div class="settings-shortcut-default">${r("settings.keyboard.defaultColon")} <code>${We(n.defaultBindings)}</code></div>
                        </div>
                        <div class="settings-shortcut-controls">
                            <input
                                id=${b}
                                class="settings-shortcut-input"
                                type="text"
                                value=${c[n.id]||""}
                                placeholder=${We(n.defaultBindings)}
                                onInput=${(k)=>u((K)=>({...K,[n.id]:k.target.value}))}
                            />
                            <div class="settings-shortcut-actions">
                                <button type="button" class="settings-addon-btn settings-addon-btn-install" onClick=${()=>p(n.id)}>${r("settings.keyboard.save")}</button>
                                <button type="button" class="settings-addon-btn" onClick=${()=>v(n.id)}>${r("settings.keyboard.defaultBtn")}</button>
                            </div>
                        </div>
                    </div>
                `})}
                ${l.length===0&&e`<div class="settings-hint">${r("settings.keyboard.noMatch")}</div>`}
            </div>
        </div>
    `}export{C as KeyboardSection};

//# debugId=72E7B760CCF608F964756E2164756E21
//# sourceMappingURL=keyboard-gm9mmz4g.js.map
