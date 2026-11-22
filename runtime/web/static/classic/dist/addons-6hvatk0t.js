import{t,o,n,e}from"./app-z5v3n7bb.js";import{s}from"./app-139cy0ee.js";function H({setStatus:d,filter:T=""}){let{t:r}=s(),[k,L]=t(null),[R,N]=t(!0),[c,u]=t(null),[S,C]=t(!1),[U,A]=t({runtime:"",windowsNative:!1}),[v,E]=t([]),[y,F]=t([]);function P(){let a=new URLSearchParams;try{let i=(localStorage.getItem("piclaw_addons_catalog_url")||"").trim(),g=(localStorage.getItem("piclaw_addons_catalog_urls")||"").split(/\r?\n/).map((m)=>m.trim()).filter(Boolean),p=localStorage.getItem("piclaw_addons_repo_url");if(i)a.append("catalog_url",i);for(let m of g)a.append("catalog_url",m);if(p)a.set("repo_url",p)}catch(i){}let l=a.toString();return l?`?${l}`:""}let f=n(async()=>{try{let[a,l]=await Promise.all([fetch(`/agent/addons${P()}`),fetch("/agent/settings-data")]),i=await a.json();if(i.error)throw Error(i.error);L(i.addons||[]),E(i.sources||[]),F(i.failed_sources||[]);let g=await l.json().catch(()=>({})),p=typeof g?.runtimePlatform==="string"?g.runtimePlatform:"";A({runtime:p,windowsNative:p==="win32"})}catch(a){L(null),d?.(String(a.message||a),"error")}finally{N(!1)}},[d]);o(()=>{f()},[]);let x=n(async(a)=>{if(c)return;u({slug:a,action:"install"}),d?.(r("settings.addons.installing",{slug:a}),"info");try{let l=await fetch(`/agent/addons/install${P()}`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({slug:a})}),i=await l.json().catch(()=>null);if(!l.ok||!i||i.error){d?.(typeof i?.error==="string"&&i.error.trim()?i.error:"Couldn't install add-on (HTTP "+l.status+"). Check its installed state before trying again.","error");return}C(!0);let g=[i.message,i.warning].filter(Boolean).join(" ");d?.(g||r("settings.addons.installedToast"),"success"),await f()}catch(l){d?.("Connection lost while installing the add-on. Check its installed state before trying again.","error")}finally{u(null)}},[c,f,d]),I=n(async(a)=>{if(c)return;u({slug:a,action:"remove"}),d?.(r("settings.addons.removing",{slug:a}),"info");try{let l=await fetch(`/agent/addons/uninstall${P()}`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({slug:a})}),i=await l.json().catch(()=>null);if(!l.ok||!i||i.error){d?.(typeof i?.error==="string"&&i.error.trim()?i.error:"Couldn't remove add-on (HTTP "+l.status+"). Check its installed state before trying again.","error");return}C(!0);let g=[i.message,i.warning].filter(Boolean).join(" ");d?.(g||r("settings.addons.removedToast"),"success"),await f()}catch(l){d?.("Connection lost while removing the add-on. Check its installed state before trying again.","error")}finally{u(null)}},[c,f,d]),O=n(async()=>{if(c)return;u({slug:null,action:"restart"}),d?.(r("settings.addons.restarting"),"info");try{let l=await(await fetch("/agent/addons/restart",{method:"POST"})).json();if(l.error){d?.(l.error,"error"),u(null);return}d?.(l.message||r("settings.addons.restarting"),"success"),C(!1),(async(g=30,p=2000)=>{for(let m=0;m<g;m++){await new Promise((h)=>setTimeout(h,p));try{if((await fetch("/agent/addons",{signal:AbortSignal.timeout(3000)})).ok){await f(),u(null),d?.(r("settings.addons.restartComplete"),"success");return}}catch(h){}}u(null),d?.(r("settings.addons.restartTimeout"),"warning")})()}catch(a){d?.(String(a.message||a),"error"),u(null)}},[c,d,f]);if(R)return e`<div class="settings-loading">${r("settings.addons.fetching")}</div>`;if(!k)return e`<div class="settings-section"><p class="settings-hint">${r("settings.addons.loadFailed")}</p></div>`;let w=T.toLowerCase(),j=w?k.filter((a)=>a.slug.toLowerCase().includes(w)||(a.description||"").toLowerCase().includes(w)||(a.tags||[]).some((l)=>l.toLowerCase().includes(w))):k,_=c?.slug||null,B=c?c.action==="remove"?r("settings.addons.removing",{slug:c.slug}):c.action==="restart"?r("settings.addons.restarting"):r("settings.addons.installing",{slug:c.slug}):"";return e`
        <div class=${`settings-section settings-addon-panel${c?" busy":""}`} aria-busy=${c?"true":"false"}>
            <div class="settings-addon-toolbar">
                <div>
                    <p class="settings-hint">
                        ${v.length<=1?e`${r("settings.addons.catalogFromPre")} <a href="https://github.com/rcarmo/piclaw-addons" target="_blank">rcarmo/piclaw-addons</a>.`:e`${r("settings.addons.catalogMerged",{count:v.length})}`}
                        ${" "}${r("settings.addons.installNote")}
                    </p>
                    ${y.length>0&&e`
                        <div class="settings-addon-error" role="alert">
                            ${y.length>1?r("settings.addons.failedFetchPlural",{count:y.length}):r("settings.addons.failedFetchSingular",{count:y.length})}
                            ${y.map((a)=>e` <code style="font-size:0.82em;word-break:break-all">${a}</code>`)}
                        </div>
                    `}
                    ${v.length>1&&e`
                        <details class="settings-hint" style="margin-top:4px">
                            <summary style="cursor:pointer">${r("settings.addons.activeSources",{count:v.length})}</summary>
                            <ul style="margin:4px 0 0 16px;font-size:0.82em">
                                ${v.map((a)=>e`<li style="word-break:break-all"><code>${a}</code></li>`)}
                            </ul>
                        </details>
                    `}
                    ${U.windowsNative&&e`
                        <div class="settings-addon-error" role="alert">
                            ${r("settings.addons.windowsWarning")}
                        </div>
                    `}
                </div>
            </div>
            <div class="settings-addon-list">
                ${c&&e`
                    <div class="settings-addon-panel-overlay" role="status" aria-live="polite" aria-label=${B}>
                        <div class="settings-addon-panel-overlay-card">
                            <div class="settings-spinner"></div>
                            <span>${B}</span>
                        </div>
                    </div>
                `}
                ${j.map((a)=>{let l=(a.skills||[]).length>0,i=a.type==="extension",g=(a.tags||[]).some((b)=>String(b).toLowerCase()==="core"),p=l&&i?r("settings.addons.typeExtSkill"):l?r("settings.addons.typeSkill"):r("settings.addons.typeExt"),m=l&&!i?"settings-tag-skill":"",h=typeof a.homepage==="string"&&a.homepage.trim()?a.homepage.trim():"";return e`
                    <div class=${`settings-addon-card${a.installed?" installed":""}${g?" core":""}`}>
                        ${g&&e`
                            <span class="settings-addon-core-bookmark" role="img" aria-label="Core add-on" title="Core add-on — recommended for most Piclaw installations">
                                <svg viewBox="0 0 28 38" width="28" height="38" aria-hidden="true" focusable="false">
                                    <path d="M0 0h28v38L14 29 0 38Z" fill="currentColor"></path>
                                    <path d="M0 0h28v3H0Z" class="settings-addon-core-bookmark-highlight"></path>
                                    <path d="m14 7 1.9 3.85 4.25.62-3.08 3 0.73 4.22L14 16.7l-3.8 1.99.73-4.22-3.08-3 4.25-.62Z" fill="#fff"></path>
                                </svg>
                            </span>
                        `}
                        <div class="settings-addon-card-header">
                            ${h?e`<a class="settings-addon-name-link" href=${h} target="_blank" rel="noopener noreferrer">${a.slug}</a>`:e`<strong>${a.slug}</strong>`}
                            ${l&&e`<span class=${`settings-tag settings-tag-type ${m}`}>${p}</span>`}
                            <span class="settings-addon-version">${a.installed?a.installedVersion||"?":a.version||""}</span>
                            ${a.installKind&&e`<span class="settings-tag">${a.installKind}</span>`}
                            ${a.hasUpdate&&e`<span class="settings-tag settings-tag-skill">\u2191 ${a.version}</span>`}
                            <div class="settings-addon-actions">
                                ${a.installed?e`
                                    ${a.hasUpdate&&e`<button class="settings-addon-btn settings-addon-btn-upgrade" disabled=${Boolean(c)} onClick=${()=>x(a.slug)}>${_===a.slug?"…":r("settings.addons.update")}</button>`}
                                    <button class="settings-addon-btn settings-addon-btn-remove" disabled=${Boolean(c)} onClick=${()=>I(a.slug)}>${_===a.slug?"…":r("settings.addons.remove")}</button>
                                `:e`
                                    <button class="settings-addon-btn settings-addon-btn-install" disabled=${Boolean(c)} onClick=${()=>x(a.slug)}>${_===a.slug?"…":r("settings.addons.install")}</button>
                                `}
                            </div>
                        </div>
                        <div class="settings-addon-card-body">${a.description}</div>
                        <div class="settings-addon-card-footer">
                            <div class="settings-addon-tags">${(a.tags||[]).map((b)=>e`<span class="settings-tag">${b}</span>`)}${(a.skills||[]).map((b)=>e`<span class="settings-tag settings-tag-skill">\ud83d\udcdd ${b}</span>`)}</div>
                        </div>
                    </div>
                `})}
                ${j.length===0&&e`<p class="settings-hint">${r("settings.addons.noMatch",{filter:T})}</p>`}
            </div>
            ${S&&e`
                <div class="settings-addon-restart-notice" role="status" aria-live="polite">
                    <span>${r("settings.addons.restartNotice")}</span>
                    <button class="settings-addon-btn settings-addon-btn-restart-now" type="button" disabled=${Boolean(c)} onClick=${O}>${r("settings.addons.restartNow")}</button>
                </div>
            `}
        </div>
    `}export{H as AddonsSection};

//# debugId=D40FD949EE4D4D8064756E2164756E21
//# sourceMappingURL=addons-6hvatk0t.js.map
