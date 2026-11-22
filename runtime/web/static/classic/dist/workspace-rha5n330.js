import{t,o,r,i,n,e}from"./app-k38vseyk.js";import{Ot,Nt,Bt,jt,Ut}from"./app-9mz0mtm4.js";import{re,On}from"./app-t39h1rzq.js";import{p}from"./app-pvk63zk3.js";import{m}from"./app-dwc7n5xq.js";import{s}from"./app-w58mksdq.js";function q(d,g){let b=(w)=>String(w||"").split(/\r?\n/).map((a)=>a.trim()).filter(Boolean);return{roots:b(d),ignorePatterns:b(g)}}function L(d){return{roots:Array.isArray(d?.roots)?d.roots.join(`
`):"",ignorePatterns:Array.isArray(d?.ignorePatterns)?d.ignorePatterns.join(`
`):""}}function G({setStatus:d}){let[g,b]=t(""),[w,a]=t(""),[I,z]=t(null),[v,A]=t(null),[f,M]=t(null),[D,y]=t(""),[x,E]=t("load"),h=r(!0),S=n((l)=>{let u=L(l);b(u.roots),a(u.ignorePatterns),z(l)},[]);o(()=>(h.current=!0,Nt().then((l)=>{if(!h.current)return;S(l.policy),A(l.status||null),y("")}).catch((l)=>{if(!h.current)return;let u=String(l?.message||l);y(u),d?.(u,"error")}).finally(()=>{if(h.current)E("")}),()=>{h.current=!1}),[S,d]);let C=i(()=>q(g,w),[g,w]),R=I!==null&&JSON.stringify(C)!==JSON.stringify(I),_=n(async(l)=>{E(l),y("");try{if(l==="preview"){let u=await Bt(C);if(h.current)M(u.preview||null)}else if(l==="save"){let u=await jt(C);if(h.current)S(u.policy),A(u.status||null),M(null),d?.("Workspace indexing policy saved. Refresh queued.")}else{let u=await Ut();if(h.current)A(u.status||null),d?.("Workspace index refresh queued.")}}catch(u){if(!h.current)return;let W=String(u?.message||u);y(W),d?.(W,"error")}finally{if(h.current)E("")}},[S,C,d]),T=Boolean(x);return e`
        <section class="workspace-indexing-settings" aria-labelledby="workspace-indexing-heading" aria-busy=${T?"true":"false"}>
            <h3 id="workspace-indexing-heading">Indexing</h3>
            <p class="settings-hint">Choose workspace-relative roots and exclusions for full-text search. Changes require an explicit save.</p>
            <div class="workspace-indexing-fields">
                <label>
                    <span>Indexed roots</span>
                    <textarea aria-label="Indexed roots" rows="5" value=${g}
                        placeholder="notes\n.pi/skills" disabled=${x==="load"}
                        onInput=${(l)=>b(l.target.value)}></textarea>
                    <small class="settings-hint">One workspace-relative path per line. An empty saved list indexes nothing.</small>
                </label>
                <label>
                    <span>Ignore patterns</span>
                    <textarea aria-label="Index ignore patterns" rows="5" value=${w}
                        placeholder="# one pattern per line\n**/node_modules/**\n*.tmp" disabled=${x==="load"}
                        onInput=${(l)=>a(l.target.value)}></textarea>
                    <small class="settings-hint">Supports <code>*</code>, <code>**</code>, <code>?</code> and <code>#</code> comments. Negation and imported rule files are rejected.</small>
                </label>
            </div>
            <div class="workspace-indexing-actions">
                <button type="button" disabled=${T} onClick=${()=>_("preview")}>${x==="preview"?"Previewing…":"Preview"}</button>
                <button type="button" disabled=${T||!R} onClick=${()=>_("save")}>${x==="save"?"Saving…":"Save"}</button>
                <button type="button" disabled=${T} onClick=${()=>_("refresh")}>${x==="refresh"?"Queuing…":"Refresh now"}</button>
                ${R&&e`<span class="settings-hint" role="status">Unsaved changes</span>`}
            </div>
            ${v&&e`
                <div class="workspace-indexing-status" role="status" aria-live="polite">
                    <strong>Index ${String(v.state||"unknown").replaceAll("_"," ")}</strong>
                    <span>${Number(v.indexed_file_count||0).toLocaleString()} indexed files</span>
                    ${v.last_indexed_at&&e`<span>Last indexed ${v.last_indexed_at}</span>`}
                </div>
            `}
            ${(D||v?.last_error)&&e`
                <p class="workspace-indexing-error" role="alert">${D||v.last_error}</p>
            `}
            ${f&&e`
                <div class="workspace-indexing-preview" aria-live="polite">
                    <strong>Preview: ${f.includedFiles} files included, ${f.excludedEntries} entries excluded</strong>
                    <span>${f.scannedEntries} entries checked in ${f.elapsedMs} ms${f.truncated?" (bounded preview stopped at its limit)":""}.</span>
                    ${Array.isArray(f.samples)&&f.samples.length>0&&e`
                        <details>
                            <summary>Sample decisions and reasons</summary>
                            <ul>
                                ${f.samples.slice(0,30).map((l)=>e`
                                    <li><code>${l.path}</code> — ${l.included?"included":"excluded"}: ${l.reason}${l.rule?` (${l.rule})`:""}</li>
                                `)}
                            </ul>
                        </details>
                    `}
                </div>
            `}
        </section>
    `}function j(d={}){let g=d.workspaceSettings||{};return{webTerminalEnabled:g.webTerminalEnabled!==!1,vncAllowDirect:g.vncAllowDirect!==!1,sanitizeSvgFences:g.sanitizeSvgFences!==!1,treeMaxDepth:g.treeMaxDepth??4,treeMaxEntries:g.treeMaxEntries??5000}}function ie({settingsData:d,setStatus:g,mergeSettingsData:b}){let w=m("workspace"),{t:a}=s(),[I,z]=t(!0),[v,A]=t(!0),[f,M]=t(!0),[D,y]=t(4),[x,E]=t(5000),[h,S]=t(60),[C,R]=t(3),[_,T]=t(!1),[l,u]=t(!1),W=r(""),P=r(null),F=r(null),N=r(null),H=r(!0);o(()=>(H.current=!0,()=>{if(H.current=!1,P.current)clearTimeout(P.current);if(F.current)clearTimeout(F.current);if(N.current)clearTimeout(N.current)}),[]);let O=n((c)=>{let k=j(c),J=re();z(k.webTerminalEnabled),A(k.vncAllowDirect),M(k.sanitizeSvgFences),y(k.treeMaxDepth),E(k.treeMaxEntries),S(J.refreshIntervalSec),R(J.folderPreviewDepth),W.current=JSON.stringify(k)},[]);o(()=>{O(d||{})},[d,O]);let B=i(()=>JSON.stringify(j({workspaceSettings:{webTerminalEnabled:I,vncAllowDirect:v,sanitizeSvgFences:f,treeMaxDepth:D,treeMaxEntries:x}})),[I,v,f,D,x]);o(()=>{if(B===W.current)return;if(P.current)clearTimeout(P.current);return P.current=setTimeout(async()=>{if(!H.current)return;try{let c=await Ot(JSON.parse(B));if(!H.current||!c?.ok||!c?.settings)return;if(W.current=B,b?.({workspaceSettings:c.settings}),g?.(null),T(!0),F.current)clearTimeout(F.current);F.current=setTimeout(()=>{if(H.current)T(!1)},4000)}catch(c){g?.(String(c?.message||c),"error")}},800),()=>{if(P.current)clearTimeout(P.current)}},[B,b,g]);let V=n((c)=>{let k=On(c);if(S(k.refreshIntervalSec),R(k.folderPreviewDepth),u(!0),N.current)clearTimeout(N.current);N.current=setTimeout(()=>{if(H.current)u(!1)},3000)},[]);return e`
        <div class="settings-section">
            <${G} setStatus=${g} />

            ${_&&e`
                <div class="settings-general-applied-notice" role="status" aria-live="polite">
                    ${a("settings.workspace.serverApplied")}
                </div>
            `}
            ${l&&e`
                <div class="settings-general-applied-notice" role="status" aria-live="polite">
                    ${a("settings.workspace.browserApplied")}
                </div>
            `}

            <h3>${a("settings.workspace.access")}</h3>
            <div class="settings-row settings-dense-row settings-dense-row-checkbox">
                <label class="settings-dense-check" for=${w("terminal")}>
                    <input id=${w("terminal")} type="checkbox" checked=${I} onChange=${(c)=>z(c.target.checked)} />
                    <span>${a("settings.workspace.enableTerminal")}</span>
                </label>
            </div>
            <div class="settings-row settings-dense-row settings-dense-row-checkbox">
                <label class="settings-dense-check" for=${w("vnc")}>
                    <input id=${w("vnc")} type="checkbox" checked=${v} onChange=${(c)=>A(c.target.checked)} />
                    <span>${a("settings.workspace.allowVnc")}</span>
                </label>
            </div>
            <p class="settings-hint">${a("settings.workspace.accessHint")}</p>

            <h3 style="margin-top:20px">Timeline SVG</h3>
            <div class="settings-row settings-dense-row settings-dense-row-checkbox">
                <label class="settings-dense-check" for=${w("svg")}>
                    <input id=${w("svg")} type="checkbox" checked=${f} onChange=${(c)=>M(c.target.checked)} />
                    <span>Sanitize SVG code fences</span>
                </label>
                <span class="settings-hint">Enabled by default: fenced SVG is rendered as a bounded static image. Disable only for trusted SVG that needs timeline interaction; its source will run in this page.</span>
            </div>

            <h3 style="margin-top:20px">${a("settings.workspace.guardrails")}</h3>
            <div class="settings-row settings-dense-row">
                <label>${a("settings.workspace.maxDepth")}</label>
                <${p}
                    label=${a("settings.workspace.maxDepthAria")}
                    value=${D}
                    min=${1}
                    max=${8}
                    fallback=${4}
                    width="80px"
                    onChange=${y}
                />
                <span class="settings-hint">${a("settings.workspace.maxDepthHintPre")} <code>/workspace/tree</code> ${a("settings.workspace.maxDepthHintPost")}</span>
            </div>
            <div class="settings-row settings-dense-row">
                <label>${a("settings.workspace.maxEntries")}</label>
                <${p}
                    label=${a("settings.workspace.maxEntriesAria")}
                    value=${x}
                    min=${250}
                    max=${5000}
                    step=${250}
                    fallback=${5000}
                    width="92px"
                    onChange=${E}
                />
                <span class="settings-hint">${a("settings.workspace.maxEntriesHint")}</span>
            </div>

            <h3 style="margin-top:20px">${a("settings.workspace.thisBrowser")}</h3>
            <div class="settings-row settings-dense-row">
                <label>${a("settings.workspace.refreshInterval")}</label>
                <${p}
                    label=${a("settings.workspace.refreshIntervalAria")}
                    value=${h}
                    min=${15}
                    max=${300}
                    step=${15}
                    fallback=${60}
                    width="92px"
                    onChange=${(c)=>V({refreshIntervalSec:c})}
                />
            </div>
            <div class="settings-row settings-dense-row">
                <label>${a("settings.workspace.folderDepth")}</label>
                <${p}
                    label=${a("settings.workspace.folderDepthAria")}
                    value=${C}
                    min=${0}
                    max=${8}
                    fallback=${3}
                    width="80px"
                    onChange=${(c)=>V({folderPreviewDepth:c})}
                />
                <span class="settings-hint">${a("settings.workspace.folderDepthHintPre")} <code>0</code> ${a("settings.workspace.folderDepthHintPost")}</span>
            </div>
            <p class="settings-hint">${a("settings.workspace.footerHint")}</p>
        </div>
    `}export{ie as WorkspaceSection};

//# debugId=284ED4D2E7CE186764756E2164756E21
//# sourceMappingURL=workspace-rha5n330.js.map
