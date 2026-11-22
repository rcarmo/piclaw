import{t,n,e}from"./app-k38vseyk.js";import{dt}from"./app-pvk63zk3.js";import{_}from"./app-22e91fex.js";import{m}from"./app-dwc7n5xq.js";import{s}from"./app-w58mksdq.js";function r(l,o){try{let i=localStorage.getItem(l);return i===null?o:i==="true"}catch{return o}}function c(l,o){try{localStorage.setItem(l,String(o))}catch(i){}}function g(l,o){try{return localStorage.getItem(l)||o}catch{return o}}function p(l,o){try{localStorage.setItem(l,o)}catch(i){}}function U(){let l=m("developer"),{t:o}=s(),[i,h]=t(()=>r("piclaw_dev_mode",!1)),[w,b]=t(()=>g("piclaw_addons_catalog_url","")),[f,y]=t(()=>g("piclaw_addons_catalog_urls","")),[S,x]=t(()=>g("piclaw_addons_repo_url","")),[v,C]=t(()=>r("piclaw_debug_sse",!1)),[u,k]=t(()=>r("piclaw_debug_tool_calls",!1)),I=n(()=>{let a=!i;h(a),c("piclaw_dev_mode",a)},[i]);return e`
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
                        onInput=${(a)=>{let d=a.target.value;b(d),p("piclaw_addons_catalog_url",d)}}
                        placeholder="https://raw.githubusercontent.com/.../catalog.json" />
                </div>
                <p class="settings-hint" style="margin-top:0">${o("settings.developer.catalogHint")} (<code>rcarmo/piclaw-addons</code>).</p>
                <div class="settings-row settings-dense-row settings-dense-row-wide settings-dense-row-compound">
                    <label for=${l("catalogs")}>${o("settings.developer.additionalCatalogs")}</label>
                    <textarea id=${l("catalogs")}
                        value=${f}
                        onInput=${(a)=>{let d=a.target.value;y(d),p("piclaw_addons_catalog_urls",d)}}
                        placeholder="One URL per line\nhttps://example.com/catalog.json"
                        style="min-height:86px; resize:vertical;"
                    ></textarea>
                </div>
                <p class="settings-hint" style="margin-top:0">${o("settings.developer.additionalHint")}</p>
                <div class="settings-row settings-dense-row settings-dense-row-wide">
                    <label for=${l("repo")}>${o("settings.developer.repoUrl")}</label>
                    <input id=${l("repo")} type="text" value=${S}
                        onInput=${(a)=>{let d=a.target.value;x(d),p("piclaw_addons_repo_url",d)}}
                        placeholder="https://github.com/.../piclaw-addons.git" />
                </div>
                <p class="settings-hint" style="margin-top:0">${o("settings.developer.repoHintPre")} <code>bun add</code> ${o("settings.developer.repoHintPost")}</p>

                <h3 style="margin-top:16px">${o("settings.developer.debug")}</h3>
                <div class="settings-row settings-dense-row settings-dense-row-checkbox">
                    <label class="settings-dense-check" for=${l("log-sse")}>
                        <input id=${l("log-sse")} type="checkbox" checked=${v}
                            onChange=${()=>{let a=!v;C(a),c("piclaw_debug_sse",a)}} />
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
    `}_({id:"developer",label:"Developer",icon:dt,component:U,order:900});

//# debugId=4C0B59E66B6D319464756E2164756E21
//# sourceMappingURL=developer-settings-9n8k741e.js.map
