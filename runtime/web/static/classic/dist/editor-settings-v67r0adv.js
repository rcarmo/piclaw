import{t,n,e}from"./app-c7xgjke0.js";import{yt,_e,m}from"./app-kw0x58x3.js";import{E}from"./app-jrfwvagp.js";import{y}from"./app-8rxq9r6x.js";import{s}from"./app-dr786pqe.js";function g(o,i){try{let c=localStorage.getItem(o);return c===null?i:c==="true"}catch{return i}}function d(o,i){try{localStorage.setItem(o,String(i))}catch(c){}}function k(o,i){try{return localStorage.getItem(o)||i}catch{return i}}function x(o,i){try{localStorage.setItem(o,i)}catch(c){}}function F(o,i,c,a){try{return _e(localStorage.getItem(o),{fallback:i,min:c,max:a})}catch{return _e(i,{fallback:i,min:c,max:a})}}function z(o,i){try{localStorage.setItem(o,String(i))}catch(c){}}function P(){let o=y("editor"),{t:i}=s(),[c,a]=t(()=>g("piclaw_vim_mode",!1)),[p,v]=t(()=>g("piclaw_show_whitespace",!0)),[h,u]=t(()=>g("piclaw_md_live_preview",!0)),[f,_]=t(()=>F("piclaw_editor_font_size",13,10,24)),[S,b]=t(()=>k("piclaw_editor_font_family","")),C=n((r,l,I)=>{let w=!l;I(w),d(r,w)},[]);return e`
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
                    <input id=${o("whitespace")} type="checkbox" checked=${p}
                        onChange=${()=>{let r=!p;v(r),d("piclaw_show_whitespace",r)}} />
                    <span>${i("settings.editor.showWhitespace")}</span>
                </label>
            </div>
            <div class="settings-row settings-dense-row settings-dense-row-checkbox">
                <label class="settings-dense-check" for=${o("preview")}>
                    <input id=${o("preview")} type="checkbox" checked=${h}
                        onChange=${()=>{let r=!h;u(r),d("piclaw_md_live_preview",r)}} />
                    <span>${i("settings.editor.livePreview")}</span>
                </label>
            </div>
            <div class="settings-row settings-dense-row">
                <label>${i("settings.editor.fontSize")}</label>
                <${m}
                    label=${i("settings.editor.fontSizeAria")}
                    value=${f}
                    min=${10}
                    max=${24}
                    fallback=${13}
                    width="70px"
                    onChange=${(r)=>{_(r),z("piclaw_editor_font_size",r)}}
                />
            </div>
            <div class="settings-row settings-dense-row settings-dense-row-wide">
                <label for=${o("font-family")}>${i("settings.editor.fontFamily")}</label>
                <input id=${o("font-family")} type="text" value=${S}
                    onInput=${(r)=>{let l=r.target.value;b(l),x("piclaw_editor_font_family",l)}}
                    placeholder=${i("settings.editor.fontFamilyPlaceholder")} />
            </div>
            <p class="settings-hint settings-local-only-hint">${i("settings.editor.localOnlyHint")}</p>
        </div>
    `}E({id:"editor",label:"Editor",icon:yt,component:P,order:150});

//# debugId=D22B21D9AC5C9B3A64756E2164756E21
//# sourceMappingURL=editor-settings-v67r0adv.js.map
