import{t,n,e}from"./app-z5v3n7bb.js";import{Ct}from"./app-npwxc9hf.js";import{C}from"./app-83ghgas7.js";import{m}from"./app-9crnk4mq.js";import{s}from"./app-139cy0ee.js";function r(l,o){try{let i=localStorage.getItem(l);return i===null?o:i==="true"}catch{return o}}function c(l,o){try{localStorage.setItem(l,String(o))}catch(i){}}function g(l,o){try{return localStorage.getItem(l)||o}catch{return o}}function p(l,o){try{localStorage.setItem(l,o)}catch(i){}}function U(){let l=m("developer"),{t:o}=s(),[i,h]=t(()=>r("piclaw_dev_mode",!1)),[w,_]=t(()=>g("piclaw_addons_catalog_url","")),[b,f]=t(()=>g("piclaw_addons_catalog_urls","")),[y,S]=t(()=>g("piclaw_addons_repo_url","")),[v,x]=t(()=>r("piclaw_debug_sse",!1)),[u,k]=t(()=>r("piclaw_debug_tool_calls",!1)),I=n(()=>{let a=!i;h(a),c("piclaw_dev_mode",a)},[i]);return e`
        <div class="settings-section">
            <h3>${o("settings.developer.heading")}</h3>
            <div class="settings-row settings-dense-row settings-dense-row-checkbox">
                <label class="settings-dense-check" for=${l("dev-mode")}>
                    <input id=${l("dev-mode")} type="checkbox" checked=${i} onChange=${I} />
                    <span>${o("settings.developer.devMode")}</span>
                </label>
            </div>

            <p class="settings-hint settings-local-only-hint">${o("settings.developer.localHint")}</p>

            ${i&&e`
                <h3 style="margin-top:16px">${o("settings.developer.addonSources")}</h3>
                <div class="settings-row settings-dense-row settings-dense-row-wide">
                    <label for=${l("catalog")}>${o("settings.developer.catalogUrl")}</label>
                    <input id=${l("catalog")} type="text" value=${w}
                        onInput=${(a)=>{let d=a.target.value;_(d),p("piclaw_addons_catalog_url",d)}}
                        placeholder="https://raw.githubusercontent.com/.../catalog.json" />
                </div>
                <p class="settings-hint" style="margin-top:0">${o("settings.developer.catalogHint")} (<code>rcarmo/piclaw-addons</code>).</p>
                <div class="settings-row settings-dense-row settings-dense-row-wide settings-dense-row-compound">
                    <label for=${l("catalogs")}>${o("settings.developer.additionalCatalogs")}</label>
                    <textarea id=${l("catalogs")}
                        value=${b}
                        onInput=${(a)=>{let d=a.target.value;f(d),p("piclaw_addons_catalog_urls",d)}}
                        placeholder="One URL per line\nhttps://example.com/catalog.json"
                        style="min-height:86px; resize:vertical;"
                    ></textarea>
                </div>
                <p class="settings-hint" style="margin-top:0">${o("settings.developer.additionalHint")}</p>
                <div class="settings-row settings-dense-row settings-dense-row-wide">
                    <label for=${l("repo")}>${o("settings.developer.repoUrl")}</label>
                    <input id=${l("repo")} type="text" value=${y}
                        onInput=${(a)=>{let d=a.target.value;S(d),p("piclaw_addons_repo_url",d)}}
                        placeholder="https://github.com/.../piclaw-addons.git" />
                </div>
                <p class="settings-hint" style="margin-top:0">${o("settings.developer.repoHintPre")} <code>bun add</code> ${o("settings.developer.repoHintPost")}</p>

                <h3 style="margin-top:16px">${o("settings.developer.debug")}</h3>
                <div class="settings-row settings-dense-row settings-dense-row-checkbox">
                    <label class="settings-dense-check" for=${l("log-sse")}>
                        <input id=${l("log-sse")} type="checkbox" checked=${v}
                            onChange=${()=>{let a=!v;x(a),c("piclaw_debug_sse",a)}} />
                        <span>${o("settings.developer.logSse")}</span>
                    </label>
                </div>
                <div class="settings-row settings-dense-row settings-dense-row-checkbox">
                    <label class="settings-dense-check" for=${l("log-tools")}>
                        <input id=${l("log-tools")} type="checkbox" checked=${u}
                            onChange=${()=>{let a=!u;k(a),c("piclaw_debug_tool_calls",a)}} />
                        <span>${o("settings.developer.logToolCalls")}</span>
                    </label>
                </div>
                <p class="settings-hint">${o("settings.developer.debugHint")}</p>
            `}
        </div>
    `}C({id:"developer",label:"Developer",icon:Ct,component:U,order:900});

//# debugId=918F77E94CA3D9A864756E2164756E21
//# sourceMappingURL=developer-settings-3gbv70nj.js.map
