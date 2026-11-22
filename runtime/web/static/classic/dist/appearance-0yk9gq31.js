import{t,o,r,i,n,e}from"./app-017vdhd7.js";import{ee,z,te,Pn,Mn}from"./app-p1p0gdrc.js";import{s}from"./app-mbxfp7m6.js";function k(c){let v=Number(c);if(!Number.isFinite(v))return 0;return Math.min(24,Math.max(0,Math.round(v)))}function E(c={}){return{uiTheme:typeof c.uiTheme==="string"&&c.uiTheme.trim()?c.uiTheme.trim():"default",uiTint:typeof c.uiTint==="string"&&c.uiTint.trim()?c.uiTint.trim():"",outputPad:k(c.outputPad)}}function G({themes:c,colorKeys:v,settingsData:x,setStatus:b,mergeSettingsData:S}){let{t:u}=s(),[p,F]=t("default"),[d,w]=t(""),[L,N]=t(Mn),[m,y]=t(0),[R,O]=t(!1),C=r(""),f=r(null),g=r(!0);o(()=>(g.current=!0,()=>{g.current=!1}),[]);let M=n((a)=>{let l=E(a);F(l.uiTheme),w(l.uiTint),y(l.outputPad),z(l.outputPad),C.current=JSON.stringify(l)},[]);o(()=>{if(x){M(x);return}M({uiTheme:document.documentElement.dataset.colorTheme||"default",uiTint:document.documentElement.dataset.tint||"",outputPad:document.documentElement.dataset.outputPad||"0"})},[x,M]);let T=n((a,l,h=m)=>{te({theme:a,tint:l||null,outputPad:h}),F(a||"default"),w(l||""),y(k(h))},[m]),P=i(()=>JSON.stringify(E({uiTheme:p,uiTint:d,outputPad:m})),[p,d,m]);o(()=>{if(P===C.current)return;if(f.current)clearTimeout(f.current);return f.current=setTimeout(async()=>{if(!g.current)return;O(!0);try{let a=await fetch("/agent/settings/general",{method:"POST",headers:{"Content-Type":"application/json"},body:P}),l=await a.json().catch(()=>({}));if(!g.current)return;if(!a.ok||!l?.ok||!l?.settings){b?.(l?.error||"Failed to save appearance settings.","error");return}C.current=P,S?.(l.settings),b?.("Appearance synced across clients.","success")}catch(a){if(!g.current)return;console.warn("[settings/appearance] Failed to persist appearance settings.",a),b?.("Failed to save appearance settings.","error")}finally{if(g.current)O(!1)}},250),()=>{if(f.current)clearTimeout(f.current)}},[P,S,b]);let A=v||[],I=c||[];return e`
        <div class="settings-section settings-appearance">
            <div class="settings-row settings-language-row">
                <${ee} variant="inline" />
            </div>
            ${R&&e`<div class="settings-hint" style="margin:0 0 12px 0;">${u("settings.appearance.syncing")}</div>`}
            <div class="settings-tint-row">
                <label class="settings-tint-label">
                    <input type="radio" name="settings-theme"
                        checked=${p==="default"}
                        onChange=${()=>T("default",d)} />
                    <strong>${u("settings.appearance.default")}</strong>
                    <span class="settings-hint" style="margin:0 0 0 6px">${u("settings.appearance.autoLightDark")}</span>
                </label>
                <div class="settings-tint-picker">
                    <label class="settings-hint" style="margin:0">${u("settings.appearance.tint")}</label>
                    <input type="color"
                        value=${d||"#1d9bf0"}
                        onInput=${(a)=>{let l=a.target.value;if(w(l),p==="default")te({theme:"default",tint:l})}} />
                    ${d&&e`
                        <button class="settings-tint-clear" onClick=${()=>T("default","")}
                            title=${u("settings.appearance.clearTint")}>\u2715</button>
                    `}
                    <span class="settings-tint-hex">${d||u("settings.appearance.none")}</span>
                </div>
            </div>

            <div class="settings-output-pad-row">
                <label class="settings-output-pad-label" for="settings-output-pad">
                    <strong>${u("settings.appearance.outputPadding")}</strong>
                    <span class="settings-hint">${u("settings.appearance.outputPaddingHint")}</span>
                </label>
                <div class="settings-output-pad-control">
                    <input id="settings-output-pad" type="range" min="0" max="24" step="1"
                        value=${m}
                        onInput=${(a)=>{let l=k(a.target.value);y(l),z(l)}} />
                    <input class="settings-output-pad-number" type="number" min="0" max="24" step="1"
                        value=${m}
                        onInput=${(a)=>{let l=k(a.target.value);y(l),z(l)}} />
                    <span class="settings-hint">px</span>
                </div>
            </div>

            <div class="settings-appearance-mode">
                <label for="appearance-mode">Automatic theme mode</label>
                <div class="settings-appearance-mode-control">
                    <select id="appearance-mode" value=${L} aria-describedby="appearance-mode-hint" onChange=${(a)=>{N(a.target.value),Pn(a.target.value)}}><option value="auto">Follow system</option><option value="light">Light</option><option value="dark">Dark</option></select>
                    <p id="appearance-mode-hint" class="settings-hint">For Default, Solarized and GitHub in this browser. Named Light/Dark themes keep their mode.</p>
                </div>
            </div>
            <table class="settings-table settings-borderless settings-theme-table">
                <colgroup><col class="settings-theme-select-col" /><col /><col class="settings-theme-mode-col" /><col class="settings-theme-palette-col" /></colgroup>
                <thead>
                    <tr><th scope="col"><span class="sr-only">Selected</span></th><th scope="col">Theme</th><th scope="col" class="settings-theme-mode-cell">Mode</th><th scope="col">Palette</th></tr>
                </thead>
                <tbody>
                    ${I.filter((a)=>a.name!=="default").map((a)=>e`
                        <tr class=${a.name===p?"settings-row-active":""}
                            style="cursor:pointer" onClick=${()=>T(a.name,"")}>
                            <td><input type="radio" aria-label=${a.label} name="settings-theme" checked=${a.name===p} onChange=${()=>T(a.name,"")} /></td>
                            <td><strong>${a.label}</strong></td>
                            <td class="settings-theme-mode-cell">${a.mode}</td>
                            <td><span class="settings-theme-palette" role="img" aria-label=${`${a.label} palette`}>
                                ${A.map((l)=>{let h=a.colors?.[l];return h?e`<span style=${"background:"+h} title=${`${l.replace(/([A-Z])/g," $1").trim()}: ${h}`}></span>`:null})}
                            </span></td>
                        </tr>
                    `)}
                </tbody>
            </table>
        </div>
    `}export{G as ThemeSection};

//# debugId=9135E71B6C07C35E64756E2164756E21
//# sourceMappingURL=appearance-0yk9gq31.js.map
