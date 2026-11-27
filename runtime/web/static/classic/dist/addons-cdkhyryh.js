import{t,o,r,e}from"./app-863dk79s.js";import{s}from"./app-wq98hqjx.js";function H({setStatus:d,filter:T=""}){let{t:i}=s(),[k,L]=t(null),[R,N]=t(!0),[c,u]=t(null),[S,C]=t(!1),[U,A]=t({runtime:"",windowsNative:!1}),[v,E]=t([]),[y,F]=t([]);function P(){let n=new URLSearchParams;try{let a=(localStorage.getItem("piclaw_addons_catalog_url")||"").trim(),g=(localStorage.getItem("piclaw_addons_catalog_urls")||"").split(/\r?\n/).map((m)=>m.trim()).filter(Boolean),p=localStorage.getItem("piclaw_addons_repo_url");if(a)n.append("catalog_url",a);for(let m of g)n.append("catalog_url",m);if(p)n.set("repo_url",p)}catch(a){}let l=n.toString();return l?`?${l}`:""}let f=r(async()=>{try{let[n,l]=await Promise.all([fetch(`/agent/addons${P()}`),fetch("/agent/settings-data")]),a=await n.json();if(a.error)throw Error(a.error);L(a.addons||[]),E(a.sources||[]),F(a.failed_sources||[]);let g=await l.json().catch(()=>({})),p=typeof g?.runtimePlatform==="string"?g.runtimePlatform:"";A({runtime:p,windowsNative:p==="win32"})}catch(n){L(null),d?.(String(n.message||n),"error")}finally{N(!1)}},[d]);o(()=>{f()},[]);let x=r(async(n)=>{if(c)return;u({slug:n,action:"install"}),d?.(i("settings.addons.installing",{slug:n}),"info");try{let l=await fetch(`/agent/addons/install${P()}`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({slug:n})}),a=await l.json().catch(()=>null);if(!l.ok||!a||a.error){d?.(typeof a?.error==="string"&&a.error.trim()?a.error:"Couldn't install add-on (HTTP "+l.status+"). Check its installed state before trying again.","error");return}C(!0);let g=[a.message,a.warning].filter(Boolean).join(" ");d?.(g||i("settings.addons.installedToast"),"success"),await f()}catch(l){d?.("Connection lost while installing the add-on. Check its installed state before trying again.","error")}finally{u(null)}},[c,f,d]),I=r(async(n)=>{if(c)return;u({slug:n,action:"remove"}),d?.(i("settings.addons.removing",{slug:n}),"info");try{let l=await fetch(`/agent/addons/uninstall${P()}`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({slug:n})}),a=await l.json().catch(()=>null);if(!l.ok||!a||a.error){d?.(typeof a?.error==="string"&&a.error.trim()?a.error:"Couldn't remove add-on (HTTP "+l.status+"). Check its installed state before trying again.","error");return}C(!0);let g=[a.message,a.warning].filter(Boolean).join(" ");d?.(g||i("settings.addons.removedToast"),"success"),await f()}catch(l){d?.("Connection lost while removing the add-on. Check its installed state before trying again.","error")}finally{u(null)}},[c,f,d]),O=r(async()=>{if(c)return;u({slug:null,action:"restart"}),d?.(i("settings.addons.restarting"),"info");try{let l=await(await fetch("/agent/addons/restart",{method:"POST"})).json();if(l.error){d?.(l.error,"error"),u(null);return}d?.(l.message||i("settings.addons.restarting"),"success"),C(!1),(async(g=30,p=2000)=>{for(let m=0;m<g;m++){await new Promise((h)=>setTimeout(h,p));try{if((await fetch("/agent/addons",{signal:AbortSignal.timeout(3000)})).ok){await f(),u(null),d?.(i("settings.addons.restartComplete"),"success");return}}catch(h){}}u(null),d?.(i("settings.addons.restartTimeout"),"warning")})()}catch(n){d?.(String(n.message||n),"error"),u(null)}},[c,d,f]);if(R)return e`<div class="settings-loading">${i("settings.addons.fetching")}</div>`;if(!k)return e`<div class="settings-section"><p class="settings-hint">${i("settings.addons.loadFailed")}</p></div>`;let w=T.toLowerCase(),j=w?k.filter((n)=>n.slug.toLowerCase().includes(w)||(n.description||"").toLowerCase().includes(w)||(n.tags||[]).some((l)=>l.toLowerCase().includes(w))):k,_=c?.slug||null,B=c?c.action==="remove"?i("settings.addons.removing",{slug:c.slug}):c.action==="restart"?i("settings.addons.restarting"):i("settings.addons.installing",{slug:c.slug}):"";return e`
        <div class=${`settings-section settings-addon-panel${c?" busy":""}`} aria-busy=${c?"true":"false"}>
            <div class="settings-addon-toolbar">
                <div>
                    <p class="settings-hint">
                        ${v.length<=1?e`${i("settings.addons.catalogFromPre")} <a href="https://github.com/rcarmo/piclaw-addons" target="_blank">rcarmo/piclaw-addons</a>.`:e`${i("settings.addons.catalogMerged",{count:v.length})}`}
                        ${" "}${i("settings.addons.installNote")}
                    </p>
                    ${y.length>0&&e`
                        <div class="settings-addon-error" role="alert">
                            ${y.length>1?i("settings.addons.failedFetchPlural",{count:y.length}):i("settings.addons.failedFetchSingular",{count:y.length})}
                            ${y.map((n)=>e` <code style="font-size:0.82em;word-break:break-all">${n}</code>`)}
                        </div>
                    `}
                    ${v.length>1&&e`
                        <details class="settings-hint" style="margin-top:4px">
                            <summary style="cursor:pointer">${i("settings.addons.activeSources",{count:v.length})}</summary>
                            <ul style="margin:4px 0 0 16px;font-size:0.82em">
                                ${v.map((n)=>e`<li style="word-break:break-all"><code>${n}</code></li>`)}
                            </ul>
                        </details>
                    `}
                    ${U.windowsNative&&e`
                        <div class="settings-addon-error" role="alert">
                            ${i("settings.addons.windowsWarning")}
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
                ${j.map((n)=>{let l=(n.skills||[]).length>0,a=n.type==="extension",g=(n.tags||[]).some((b)=>String(b).toLowerCase()==="core"),p=l&&a?i("settings.addons.typeExtSkill"):l?i("settings.addons.typeSkill"):i("settings.addons.typeExt"),m=l&&!a?"settings-tag-skill":"",h=typeof n.homepage==="string"&&n.homepage.trim()?n.homepage.trim():"";return e`
                    <div class=${`settings-addon-card${n.installed?" installed":""}${g?" core":""}`}>
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
                            ${h?e`<a class="settings-addon-name-link" href=${h} target="_blank" rel="noopener noreferrer">${n.slug}</a>`:e`<strong>${n.slug}</strong>`}
                            ${l&&e`<span class=${`settings-tag settings-tag-type ${m}`}>${p}</span>`}
                            <span class="settings-addon-version">${n.installed?n.installedVersion||"?":n.version||""}</span>
                            ${n.installKind&&e`<span class="settings-tag">${n.installKind}</span>`}
                            ${n.hasUpdate&&e`<span class="settings-tag settings-tag-skill">\u2191 ${n.version}</span>`}
                            <div class="settings-addon-actions">
                                ${n.installed?e`
                                    ${n.hasUpdate&&e`<button class="settings-addon-btn settings-addon-btn-upgrade" disabled=${Boolean(c)} onClick=${()=>x(n.slug)}>${_===n.slug?"…":i("settings.addons.update")}</button>`}
                                    <button class="settings-addon-btn settings-addon-btn-remove" disabled=${Boolean(c)} onClick=${()=>I(n.slug)}>${_===n.slug?"…":i("settings.addons.remove")}</button>
                                `:e`
                                    <button class="settings-addon-btn settings-addon-btn-install" disabled=${Boolean(c)} onClick=${()=>x(n.slug)}>${_===n.slug?"…":i("settings.addons.install")}</button>
                                `}
                            </div>
                        </div>
                        <div class="settings-addon-card-body">${n.description}</div>
                        <div class="settings-addon-card-footer">
                            <div class="settings-addon-tags">${(n.tags||[]).map((b)=>e`<span class="settings-tag">${b}</span>`)}${(n.skills||[]).map((b)=>e`<span class="settings-tag settings-tag-skill">\ud83d\udcdd ${b}</span>`)}</div>
                        </div>
                    </div>
                `})}
                ${j.length===0&&e`<p class="settings-hint">${i("settings.addons.noMatch",{filter:T})}</p>`}
            </div>
            ${S&&e`
                <div class="settings-addon-restart-notice" role="status" aria-live="polite">
                    <span>${i("settings.addons.restartNotice")}</span>
                    <button class="settings-addon-btn settings-addon-btn-restart-now" type="button" disabled=${Boolean(c)} onClick=${O}>${i("settings.addons.restartNow")}</button>
                </div>
            `}
        </div>
    `}export{H as AddonsSection};

//# debugId=FAF20B0E018B7E6664756E2164756E21
//# sourceMappingURL=addons-cdkhyryh.js.map
