import{t,n,e}from"./app-z5v3n7bb.js";import{At,Te,p}from"./app-npwxc9hf.js";import{C}from"./app-83ghgas7.js";import{m}from"./app-9crnk4mq.js";import{s}from"./app-139cy0ee.js";function g(o,i){try{let c=localStorage.getItem(o);return c===null?i:c==="true"}catch{return i}}function d(o,i){try{localStorage.setItem(o,String(i))}catch(c){}}function k(o,i){try{return localStorage.getItem(o)||i}catch{return i}}function x(o,i){try{localStorage.setItem(o,i)}catch(c){}}function F(o,i,c,a){try{return Te(localStorage.getItem(o),{fallback:i,min:c,max:a})}catch{return Te(i,{fallback:i,min:c,max:a})}}function z(o,i){try{localStorage.setItem(o,String(i))}catch(c){}}function P(){let o=m("editor"),{t:i}=s(),[c,a]=t(()=>g("piclaw_vim_mode",!1)),[h,u]=t(()=>g("piclaw_show_whitespace",!0)),[w,f]=t(()=>g("piclaw_md_live_preview",!0)),[_,S]=t(()=>F("piclaw_editor_font_size",13,10,24)),[y,b]=t(()=>k("piclaw_editor_font_family","")),E=n((r,l,I)=>{let v=!l;I(v),d(r,v)},[]);return e`
        <div class="settings-section">
            <h3>${i("settings.editor.heading")}</h3>
            <div class="settings-row settings-dense-row settings-dense-row-checkbox">
                <label class="settings-dense-check" for=${o("vim")}>
                    <input id=${o("vim")} type="checkbox" checked=${c}
                        onChange=${()=>{let r=!c;a(r),d("piclaw_vim_mode",r)}} />
                    <span>${i("settings.editor.vimMode")}</span>
                </label>
            </div>
            <div class="settings-row settings-dense-row settings-dense-row-checkbox">
                <label class="settings-dense-check" for=${o("whitespace")}>
                    <input id=${o("whitespace")} type="checkbox" checked=${h}
                        onChange=${()=>{let r=!h;u(r),d("piclaw_show_whitespace",r)}} />
                    <span>${i("settings.editor.showWhitespace")}</span>
                </label>
            </div>
            <div class="settings-row settings-dense-row settings-dense-row-checkbox">
                <label class="settings-dense-check" for=${o("preview")}>
                    <input id=${o("preview")} type="checkbox" checked=${w}
                        onChange=${()=>{let r=!w;f(r),d("piclaw_md_live_preview",r)}} />
                    <span>${i("settings.editor.livePreview")}</span>
                </label>
            </div>
            <div class="settings-row settings-dense-row">
                <label>${i("settings.editor.fontSize")}</label>
                <${p}
                    label=${i("settings.editor.fontSizeAria")}
                    value=${_}
                    min=${10}
                    max=${24}
                    fallback=${13}
                    width="70px"
                    onChange=${(r)=>{S(r),z("piclaw_editor_font_size",r)}}
                />
            </div>
            <div class="settings-row settings-dense-row settings-dense-row-wide">
                <label for=${o("font-family")}>${i("settings.editor.fontFamily")}</label>
                <input id=${o("font-family")} type="text" value=${y}
                    onInput=${(r)=>{let l=r.target.value;b(l),x("piclaw_editor_font_family",l)}}
                    placeholder=${i("settings.editor.fontFamilyPlaceholder")} />
            </div>
            <p class="settings-hint settings-local-only-hint">${i("settings.editor.localOnlyHint")}</p>
        </div>
    `}C({id:"editor",label:"Editor",icon:At,component:P,order:150});

//# debugId=5A2D7D6EE774CB8D64756E2164756E21
//# sourceMappingURL=editor-settings-t13mnfp4.js.map
