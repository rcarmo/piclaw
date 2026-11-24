import{t,r,e}from"./app-1vedzwvv.js";import{Tt}from"./app-jq9cbedb.js";import{C}from"./app-jjd9y3e1.js";import{m}from"./app-y300gnye.js";import{s}from"./app-3fbwg9z4.js";function d(l,o){try{let a=localStorage.getItem(l);return a===null?o:a==="true"}catch{return o}}function c(l,o){try{localStorage.setItem(l,String(o))}catch(a){}}function g(l,o){try{return localStorage.getItem(l)||o}catch{return o}}function p(l,o){try{localStorage.setItem(l,o)}catch(a){}}function U(){let l=m("developer"),{t:o}=s(),[a,h]=t(()=>d("piclaw_dev_mode",!1)),[w,_]=t(()=>g("piclaw_addons_catalog_url","")),[b,f]=t(()=>g("piclaw_addons_catalog_urls","")),[y,S]=t(()=>g("piclaw_addons_repo_url","")),[v,x]=t(()=>d("piclaw_debug_sse",!1)),[u,k]=t(()=>d("piclaw_debug_tool_calls",!1)),I=r(()=>{let n=!a;h(n),c("piclaw_dev_mode",n)},[a]);return e`
        <div class="settings-section">
            <h3>${o("settings.developer.heading")}</h3>
            <div class="settings-row settings-dense-row settings-dense-row-checkbox">
                <label class="settings-dense-check" for=${l("dev-mode")}>
                    <input id=${l("dev-mode")} type="checkbox" checked=${a} onChange=${I} />
                    <span>${o("settings.developer.devMode")}</span>
                </label>
            </div>

            <p class="settings-hint settings-local-only-hint">${o("settings.developer.localHint")}</p>

            ${a&&e`
                <h3 style="margin-top:16px">${o("settings.developer.addonSources")}</h3>
                <div class="settings-row settings-dense-row settings-dense-row-wide">
                    <label for=${l("catalog")}>${o("settings.developer.catalogUrl")}</label>
                    <input id=${l("catalog")} type="text" value=${w}
                        onInput=${(n)=>{let i=n.target.value;_(i),p("piclaw_addons_catalog_url",i)}}
                        placeholder="https://raw.githubusercontent.com/.../catalog.json" />
                </div>
                <p class="settings-hint" style="margin-top:0">${o("settings.developer.catalogHint")} (<code>rcarmo/piclaw-addons</code>).</p>
                <div class="settings-row settings-dense-row settings-dense-row-wide settings-dense-row-compound">
                    <label for=${l("catalogs")}>${o("settings.developer.additionalCatalogs")}</label>
                    <textarea id=${l("catalogs")}
                        value=${b}
                        onInput=${(n)=>{let i=n.target.value;f(i),p("piclaw_addons_catalog_urls",i)}}
                        placeholder="One URL per line\nhttps://example.com/catalog.json"
                        style="min-height:86px; resize:vertical;"
                    ></textarea>
                </div>
                <p class="settings-hint" style="margin-top:0">${o("settings.developer.additionalHint")}</p>
                <div class="settings-row settings-dense-row settings-dense-row-wide">
                    <label for=${l("repo")}>${o("settings.developer.repoUrl")}</label>
                    <input id=${l("repo")} type="text" value=${y}
                        onInput=${(n)=>{let i=n.target.value;S(i),p("piclaw_addons_repo_url",i)}}
                        placeholder="https://github.com/.../piclaw-addons.git" />
                </div>
                <p class="settings-hint" style="margin-top:0">${o("settings.developer.repoHintPre")} <code>bun add</code> ${o("settings.developer.repoHintPost")}</p>

                <h3 style="margin-top:16px">${o("settings.developer.debug")}</h3>
                <div class="settings-row settings-dense-row settings-dense-row-checkbox">
                    <label class="settings-dense-check" for=${l("log-sse")}>
                        <input id=${l("log-sse")} type="checkbox" checked=${v}
                            onChange=${()=>{let n=!v;x(n),c("piclaw_debug_sse",n)}} />
                        <span>${o("settings.developer.logSse")}</span>
                    </label>
                </div>
                <div class="settings-row settings-dense-row settings-dense-row-checkbox">
                    <label class="settings-dense-check" for=${l("log-tools")}>
                        <input id=${l("log-tools")} type="checkbox" checked=${u}
                            onChange=${()=>{let n=!u;k(n),c("piclaw_debug_tool_calls",n)}} />
                        <span>${o("settings.developer.logToolCalls")}</span>
                    </label>
                </div>
                <p class="settings-hint">${o("settings.developer.debugHint")}</p>
            `}
        </div>
    `}C({id:"developer",label:"Developer",icon:Tt,component:U,order:900});

//# debugId=4D8649D71906C22A64756E2164756E21
//# sourceMappingURL=developer-settings-7e2mf6tf.js.map
