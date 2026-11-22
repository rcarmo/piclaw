import{t,n,e}from"./app-c7xgjke0.js";import{bt}from"./app-kw0x58x3.js";import{E}from"./app-jrfwvagp.js";import{y}from"./app-8rxq9r6x.js";import{s}from"./app-dr786pqe.js";function r(l,o){try{let i=localStorage.getItem(l);return i===null?o:i==="true"}catch{return o}}function c(l,o){try{localStorage.setItem(l,String(o))}catch(i){}}function g(l,o){try{return localStorage.getItem(l)||o}catch{return o}}function p(l,o){try{localStorage.setItem(l,o)}catch(i){}}function I(){let l=y("developer"),{t:o}=s(),[i,h]=t(()=>r("piclaw_dev_mode",!1)),[w,m]=t(()=>g("piclaw_addons_catalog_url","")),[_,b]=t(()=>g("piclaw_addons_catalog_urls","")),[f,S]=t(()=>g("piclaw_addons_repo_url","")),[v,x]=t(()=>r("piclaw_debug_sse",!1)),[u,C]=t(()=>r("piclaw_debug_tool_calls",!1)),k=n(()=>{let a=!i;h(a),c("piclaw_dev_mode",a)},[i]);return e`
        <div class="settings-section">
            <h3>${o("settings.developer.heading")}</h3>
            <div class="settings-row settings-dense-row settings-dense-row-checkbox">
                <label class="settings-dense-check" for=${l("dev-mode")}>
                    <input id=${l("dev-mode")} type="checkbox" checked=${i} onChange=${k} />
                    <span>${o("settings.developer.devMode")}</span>
                </label>
            </div>

            <p class="settings-hint settings-local-only-hint">${o("settings.developer.localHint")}</p>

            ${i&&e`
                <h3 style="margin-top:16px">${o("settings.developer.addonSources")}</h3>
                <div class="settings-row settings-dense-row settings-dense-row-wide">
                    <label for=${l("catalog")}>${o("settings.developer.catalogUrl")}</label>
                    <input id=${l("catalog")} type="text" value=${w}
                        onInput=${(a)=>{let d=a.target.value;m(d),p("piclaw_addons_catalog_url",d)}}
                        placeholder="https://raw.githubusercontent.com/.../catalog.json" />
                </div>
                <p class="settings-hint" style="margin-top:0">${o("settings.developer.catalogHint")} (<code>rcarmo/piclaw-addons</code>).</p>
                <div class="settings-row settings-dense-row settings-dense-row-wide settings-dense-row-compound">
                    <label for=${l("catalogs")}>${o("settings.developer.additionalCatalogs")}</label>
                    <textarea id=${l("catalogs")}
                        value=${_}
                        onInput=${(a)=>{let d=a.target.value;b(d),p("piclaw_addons_catalog_urls",d)}}
                        placeholder="One URL per line\nhttps://example.com/catalog.json"
                        style="min-height:86px; resize:vertical;"
                    ></textarea>
                </div>
                <p class="settings-hint" style="margin-top:0">${o("settings.developer.additionalHint")}</p>
                <div class="settings-row settings-dense-row settings-dense-row-wide">
                    <label for=${l("repo")}>${o("settings.developer.repoUrl")}</label>
                    <input id=${l("repo")} type="text" value=${f}
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
                            onChange=${()=>{let a=!u;C(a),c("piclaw_debug_tool_calls",a)}} />
                        <span>${o("settings.developer.logToolCalls")}</span>
                    </label>
                </div>
                <p class="settings-hint">${o("settings.developer.debugHint")}</p>
            `}
        </div>
    `}E({id:"developer",label:"Developer",icon:bt,component:I,order:900});

//# debugId=895A9B2D09C8D80B64756E2164756E21
//# sourceMappingURL=developer-settings-75mqhxst.js.map
