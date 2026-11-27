import{t,r,e}from"./app-863dk79s.js";import{Ct,Ie,m}from"./app-ajhhww1w.js";import{C}from"./app-5hb18x0y.js";import{f}from"./app-2r0psahv.js";import{s}from"./app-wq98hqjx.js";function g(o,i){try{let c=localStorage.getItem(o);return c===null?i:c==="true"}catch{return i}}function d(o,i){try{localStorage.setItem(o,String(i))}catch(c){}}function k(o,i){try{return localStorage.getItem(o)||i}catch{return i}}function x(o,i){try{localStorage.setItem(o,i)}catch(c){}}function F(o,i,c,a){try{return Ie(localStorage.getItem(o),{fallback:i,min:c,max:a})}catch{return Ie(i,{fallback:i,min:c,max:a})}}function z(o,i){try{localStorage.setItem(o,String(i))}catch(c){}}function P(){let o=f("editor"),{t:i}=s(),[c,a]=t(()=>g("piclaw_vim_mode",!1)),[p,v]=t(()=>g("piclaw_show_whitespace",!0)),[h,u]=t(()=>g("piclaw_md_live_preview",!0)),[_,S]=t(()=>F("piclaw_editor_font_size",13,10,24)),[y,b]=t(()=>k("piclaw_editor_font_family","")),E=r((n,l,I)=>{let w=!l;I(w),d(n,w)},[]);return e`
        <div class="settings-section">
            <h3>${i("settings.editor.heading")}</h3>
            <div class="settings-row settings-dense-row settings-dense-row-checkbox">
                <label class="settings-dense-check" for=${o("vim")}>
                    <input id=${o("vim")} type="checkbox" checked=${c}
                        onChange=${()=>{let n=!c;a(n),d("piclaw_vim_mode",n)}} />
                    <span>${i("settings.editor.vimMode")}</span>
                </label>
            </div>
            <div class="settings-row settings-dense-row settings-dense-row-checkbox">
                <label class="settings-dense-check" for=${o("whitespace")}>
                    <input id=${o("whitespace")} type="checkbox" checked=${p}
                        onChange=${()=>{let n=!p;v(n),d("piclaw_show_whitespace",n)}} />
                    <span>${i("settings.editor.showWhitespace")}</span>
                </label>
            </div>
            <div class="settings-row settings-dense-row settings-dense-row-checkbox">
                <label class="settings-dense-check" for=${o("preview")}>
                    <input id=${o("preview")} type="checkbox" checked=${h}
                        onChange=${()=>{let n=!h;u(n),d("piclaw_md_live_preview",n)}} />
                    <span>${i("settings.editor.livePreview")}</span>
                </label>
            </div>
            <div class="settings-row settings-dense-row">
                <label>${i("settings.editor.fontSize")}</label>
                <${m}
                    label=${i("settings.editor.fontSizeAria")}
                    value=${_}
                    min=${10}
                    max=${24}
                    fallback=${13}
                    width="70px"
                    onChange=${(n)=>{S(n),z("piclaw_editor_font_size",n)}}
                />
            </div>
            <div class="settings-row settings-dense-row settings-dense-row-wide">
                <label for=${o("font-family")}>${i("settings.editor.fontFamily")}</label>
                <input id=${o("font-family")} type="text" value=${y}
                    onInput=${(n)=>{let l=n.target.value;b(l),x("piclaw_editor_font_family",l)}}
                    placeholder=${i("settings.editor.fontFamilyPlaceholder")} />
            </div>
            <p class="settings-hint settings-local-only-hint">${i("settings.editor.localOnlyHint")}</p>
        </div>
    `}C({id:"editor",label:"Editor",icon:Ct,component:P,order:150});

//# debugId=12B876C56A4B090364756E2164756E21
//# sourceMappingURL=editor-settings-77k56wjr.js.map
