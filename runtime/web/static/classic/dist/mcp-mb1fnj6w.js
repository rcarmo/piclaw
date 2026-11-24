import{t,o,n,i,r,e}from"./app-1vedzwvv.js";import{f}from"./app-jq9cbedb.js";import{m}from"./app-y300gnye.js";var O=()=>({mode:"off",maxAgeDays:7,maxItems:128,maxBytes:8388608,profiles:[]});function se(l,p=[]){let g=l.trim();if(!g)return p;try{let c=JSON.parse(g);if(!Array.isArray(c)||c.some((u)=>typeof u!=="string"))throw Error("Command must be a JSON string array.");return c}catch{throw Error("Command must be a valid JSON string array.")}}function ae(l,p={}){let g=l.trim();if(!g)return p;try{let c=JSON.parse(g);if(!c||typeof c!=="object"||Array.isArray(c))throw Error("Environment must be a JSON object.");let u={};for(let[v,C]of Object.entries(c)){if(typeof C!=="string")throw Error("Environment values must be strings.");u[v]=C}return u}catch{throw Error("Environment must be a valid JSON object with string values.")}}var re=()=>globalThis.crypto?.randomUUID?globalThis.crypto.randomUUID():`mcp-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;function J(l,p=null,g=O()){let c=p||{},u={...O(),...g||{},...c.recall||{}};return{id:c.id||re(),name:c.name||"",workspaceId:c.workspaceId||l||"workspace",access:c.access||null,grantMode:c.access?.kind==="all"?"all":(c.access?.grants?.find((v)=>v.workspaceId===(c.workspaceId||l))?.agentIds??(c.agentIds?.length?c.agentIds:"all"))==="all"?"workspace":"agents",agentIds:Array.isArray(c.access?.grants?.find((v)=>v.workspaceId===(c.workspaceId||l))?.agentIds)?[...c.access.grants.find((v)=>v.workspaceId===(c.workspaceId||l)).agentIds]:Array.isArray(c.agentIds)?[...c.agentIds]:[],enabled:c.enabled!==!1,transport:c.transport||"http",url:c.url||"",auth:c.auth||"bearer",allowHttp:Boolean(c.allowHttp),timeoutSeconds:Number(c.timeoutSeconds||30),revision:Number(c.revision||0),hasSavedCredentials:Boolean(c.hasSavedCredentials),needsCredentialApproval:Boolean(c.needsCredentialApproval),approveCredentialReuse:!1,status:c.status||null,oauth:{clientId:c.oauth?.clientId||"",scope:c.oauth?.scope||"",clientSecretKeychain:""},bearerTokenKeychain:"",command:Array.isArray(c.command)?[...c.command]:[],commandText:Array.isArray(c.command)?JSON.stringify(c.command):"",workdir:c.workdir||"",env:c.env&&typeof c.env==="object"?{...c.env}:{},envText:c.env&&typeof c.env==="object"?JSON.stringify(c.env):"",clearEnvironment:!1,removeEnvironment:[],environmentNames:Array.isArray(c.environmentNames)?c.environmentNames:[],recall:u}}function A(l){let p=l&&typeof l==="object"?l:{},g={...O(),...p};return{mode:g.mode==="observe"||g.mode==="active"?g.mode:"off",maxAgeDays:Number(g.maxAgeDays||7),maxItems:Number(g.maxItems||128),maxBytes:Number(g.maxBytes||8388608),profiles:Array.isArray(g.profiles)?g.profiles:[]}}function oe(l,p){let g={id:l.id,name:String(l.name||"").trim(),workspaceId:String(l.workspaceId||p||"workspace"),agentIds:Array.from(new Set((l.agentIds||[]).filter(Boolean))),enabled:Boolean(l.enabled),transport:l.transport||"http",url:String(l.url||"").trim(),auth:l.auth||"bearer",allowHttp:Boolean(l.allowHttp),timeoutSeconds:Number(l.timeoutSeconds||30),recall:A(l.recall)};if(l.grantMode==="agents"&&!g.agentIds.length)throw Error("Select at least one Agent, or explicitly choose all Agents in this workspace.");let c=l.access?.kind==="workspaces"?l.access.grants.filter((u)=>u.workspaceId!==g.workspaceId):[];if(g.access=l.grantMode==="all"?{kind:"all"}:{kind:"workspaces",grants:[...c,{workspaceId:g.workspaceId,agentIds:l.grantMode==="agents"?g.agentIds:"all"}]},g.transport==="stdio"){let u=se(String(l.commandText||""),Array.isArray(l.command)?l.command:[]);if(u.length)g.command=u;if(String(l.workdir||"").trim())g.workdir=String(l.workdir||"").trim();let v=ae(String(l.envText||""),l.env||{}),C={};for(let[k,I]of Object.entries(v))if(typeof I==="string")C[k]=I;else if(I!==void 0&&I!==null)C[k]=String(I);if(!l.clearEnvironment&&(String(l.envText||"").trim()||Object.keys(C).length))g.env=C}else{if(g.url=String(l.url||"").trim(),l.auth==="bearer"&&String(l.bearerTokenKeychain||"").trim())g.bearerTokenKeychain=String(l.bearerTokenKeychain||"").trim();if(l.auth==="oauth"){let u={},v=String(l.oauth?.clientId||"").trim(),C=String(l.oauth?.scope||"").trim(),k=String(l.oauth?.clientSecretKeychain||"").trim();if(v)u.clientId=v;if(C)u.scope=C;if(k)u.clientSecretKeychain=k;if(Object.keys(u).length)g.oauth=u}}return g}function ie(l){if(!l||typeof l!=="object")return"Unknown status";let p=typeof l.state==="string"?l.state:"unknown",g=typeof l.message==="string"&&l.message.trim()?` · ${l.message}`:"",c=Array.isArray(l.tools)&&l.tools.length?` · ${l.tools.length} tools`:"";return`${p}${g}${c}`}function pe({setStatus:l}={}){let p=m("mcp"),[g,c]=t(!0),[u,v]=t(!1),[C,k]=t(""),[I,z]=t(""),[D,W]=t([]),[H,_]=t([]),[B,q]=t(null),[L,G]=t({recall:O()}),[E,R]=t(null),[d,y]=t(()=>J("workspace")),M=n(null),[Y,K]=t(!1),j=M.current!==null&&JSON.stringify(d)!==JSON.stringify(M.current),P=()=>!j||confirm("Discard unsaved MCP connection changes?"),U=(s)=>{M.current=s,y(s),K(!1)},h=i(()=>H.find((s)=>s.id===E)||null,[H,E]),x=r(async(s=!1)=>{c(!0),k("");try{let a=await fetch("/agent/settings/mcp",{credentials:"same-origin",cache:"no-store"}),b=await a.json().catch(()=>({}));if(!a.ok||!b?.ok)throw Error(b?.error||`MCP settings failed (${a.status})`);let T=Array.isArray(b.connections)?b.connections:[];if(z(b.workspaceId||"workspace"),W(Array.isArray(b.agents)?b.agents:[]),s)M.current=null;_(T),q(b.migration||null),G({recall:A(b.defaults?.recall||O())}),R((S)=>{if(S&&T.some((N)=>N.id===S))return S;return T[0]?.id||null})}catch(a){let b=a instanceof Error?a.message:String(a);k(b),l?.(b,"error")}finally{c(!1)}},[l]);o(()=>{x()},[x]),o(()=>{if(!j||!M.current)U(J(I,h,L.recall))},[L.recall,h,I]);let F=(s)=>{if(!P())return;R(s?.id??null),U(J(I,s,L.recall)),k("")},Q=!h&&!E,V=r(async()=>{if(!String(d.name||"").trim()){k("Connection name is required."),l?.("Connection name is required.","error");return}if(d.transport==="http"&&!String(d.url||"").trim()){k("HTTP MCP connections need an endpoint URL."),l?.("HTTP MCP connections need an endpoint URL.","error");return}v(!0),k(""),l?.("Saving MCP connection…","info");try{let a=oe(d,I),b=[];if(a.transport==="stdio"){if(!a.workdir)b.push("workdir");if(d.clearEnvironment)b.push("environment")}else if(a.auth==="oauth"&&!a.oauth?.scope)b.push("oauthScope");let T=await fetch("/agent/settings/mcp",{method:"POST",credentials:"same-origin",headers:{"Content-Type":"application/json"},body:JSON.stringify({action:"save",connection:a,expectedRevision:Number(d.revision||0),...b.length?{clear:b}:{},...a.transport==="stdio"&&!a.env&&!d.clearEnvironment&&d.removeEnvironment.length?{removeEnvironment:d.removeEnvironment}:{},approveCredentialReuse:Boolean(d.approveCredentialReuse)})}),S=await T.json().catch(()=>({}));if(!T.ok||!S?.ok){K(T.status===409);let N=S?.error||"MCP connection could not be saved.";throw Error(N)}l?.("MCP connection saved.","success"),R(S?.connection?.id||a.id||E||null),await x(!0)}catch(a){let b=a instanceof Error?a.message:String(a);k(b),l?.(b,"error")}finally{v(!1)}},[d,x,h,E,l,I]),X=r(async()=>{if(!h||!P())return;v(!0);try{let s=await fetch("/agent/settings/mcp",{method:"POST",credentials:"same-origin",headers:{"Content-Type":"application/json"},body:JSON.stringify({action:"remove",id:h.id,expectedRevision:Number(h.revision||0)})}),a=await s.json().catch(()=>({}));if(!s.ok||!a?.ok)throw Error(a?.error||"Could not remove the MCP connection.");R(null),l?.("MCP connection removed.","success"),await x(!0)}catch(s){let a=s instanceof Error?s.message:String(s);k(a),l?.(a,"error")}finally{v(!1)}},[x,h,l,j]),Z=r(async()=>{if(!h)return;v(!0);try{let s=await fetch("/agent/settings/mcp",{method:"POST",credentials:"same-origin",headers:{"Content-Type":"application/json"},body:JSON.stringify({action:"reconnect",id:h.id})}),a=await s.json().catch(()=>({}));if(!s.ok||!a?.ok)throw Error(a?.error||"Could not reconnect the MCP connection.");l?.("Reconnect requested.","success"),await x()}catch(s){let a=s instanceof Error?s.message:String(s);k(a),l?.(a,"error")}finally{v(!1)}},[x,h,l]),ee=r(async()=>{if(!h||u||!P())return;v(!0);try{let s=await fetch("/agent/settings/mcp",{method:"POST",credentials:"same-origin",headers:{"Content-Type":"application/json"},body:JSON.stringify({action:"sign_in",id:h.id})}),a=await s.json().catch(()=>({}));if(!s.ok||!a?.ok)throw Error(a?.error||"OAuth sign-in was not available.");if(a.authorizationUrl)window.location.assign(a.authorizationUrl);else l?.(a.message||"Already signed in.","success"),await x()}catch(s){let a=s instanceof Error?s.message:String(s);k(a),l?.(a,"error")}finally{v(!1)}},[h,l,u,x,j]),te=r(async()=>{if(!h||u)return;v(!0);try{let s=await fetch("/agent/settings/mcp",{method:"POST",credentials:"same-origin",headers:{"Content-Type":"application/json"},body:JSON.stringify({action:"sign_out",id:h.id,expectedRevision:h.revision})}),a=await s.json().catch(()=>({}));if(!s.ok||!a?.ok)throw Error(a?.error||"OAuth sign-out failed.");l?.("OAuth sign-out completed.","success"),await x()}catch(s){let a=s instanceof Error?s.message:String(s);k(a),l?.(a,"error")}finally{v(!1)}},[x,h,l,u]),ne=r(async()=>{if(!h||u||!confirm("Forget retained MCP recall copies for this connection? Original SDK history is unchanged."))return;v(!0);try{let s=await fetch("/agent/settings/mcp",{method:"POST",credentials:"same-origin",headers:{"Content-Type":"application/json"},body:JSON.stringify({action:"forget_recall",id:h.id})}),a=await s.json().catch(()=>({}));if(!s.ok||!a?.ok)throw Error(a?.error||"Could not clear MCP recall history.");l?.("MCP recall history was cleared.","success"),await x()}catch(s){let a=s instanceof Error?s.message:String(s);k(a),l?.(a,"error")}finally{v(!1)}},[x,h,l,u]),w=!g&&!u;return e`
        <div class="settings-section">
            <h3>MCP</h3>
            ${g&&e`<p class="settings-hint" role="status">Loading MCP connections…</p>`}
            ${C&&e`<p class="mcp-notice settings-error" role="alert">${C}</p>`}
            ${Y&&e`<button type="button" class="settings-btn" disabled=${u||g} onClick=${()=>{if(P())x(!0)}}>Reload saved connection</button>`}
            ${B?.diagnostics?.length>0&&e`
                <div class="settings-row settings-dense-row" style="display:block">
                    <strong>Imported disabled entries</strong>
                    <ul style="margin:8px 0 0 1.2rem; padding:0;">
                        ${B.diagnostics.map((s)=>e`<li key=${s.name}>
                            <strong>${s.name}</strong>: ${s.fields?.join(", ")||"fields"} — ${s.reason}
                        </li>`)}
                    </ul>
                </div>
            `}

            <div class="settings-row settings-dense-row">
                <label>Workspace</label>
                <span class="settings-hint" style="margin:0">${I||"current workspace"}</span>
            </div>

            <div class="settings-row" style="display:flex; flex-wrap:wrap; gap:12px; align-items:center;">
                <label style="min-width:140px">Connections</label>
                <div style="display:flex; flex-wrap:wrap; gap:8px; align-items:center;">
                    ${H.map((s)=>e`
                        <button
                            type="button"
                            key=${s.id}
                            class=${`settings-btn ${E===s.id?"primary":""}`}
                            aria-pressed=${E===s.id}
                            onClick=${()=>F(s)}
                            disabled=${u}
                        >
                            ${s.name||"Unnamed"}
                        </button>
                    `)}
                    <button type="button" class="settings-btn" onClick=${()=>F(null)} disabled=${u}>New connection</button>
                </div>
            </div>

            <div class="settings-row settings-dense-row settings-dense-row-checkbox">
                <label class="settings-dense-check" for=${p("new-connection-toggle")}>
                    <input id=${p("new-connection-toggle")} type="checkbox" checked=${Boolean(d.enabled)} disabled=${!w} onChange=${(s)=>y((a)=>({...a,enabled:s.currentTarget.checked}))} />
                    <span>Enabled</span>
                </label>
            </div>

            <div class="settings-row settings-dense-row">
                <label for=${p("name")}>Name</label>
                <input id=${p("name")} type="text" value=${d.name||""} disabled=${!w} onInput=${(s)=>y((a)=>({...a,name:s.currentTarget.value}))} placeholder="my-mcp-server" />
            </div>

            <div class="settings-row settings-dense-row">
                <label for=${p("workspace")}>Workspace</label>
                <input id=${p("workspace")} type="text" value=${d.workspaceId||I||"workspace"} disabled=${!0} />
            </div>

            <div class="settings-row settings-dense-row">
                <label for=${p("grant-mode")}>Access</label>
                <select id=${p("grant-mode")} value=${d.grantMode} disabled=${!w} onChange=${(s)=>y((a)=>({...a,grantMode:s.currentTarget.value}))}>
                    <option value="workspace">This workspace, all Agents</option><option value="agents">Selected Agents in this workspace</option><option value="all">All workspaces and Agents</option>
                </select>
            </div>
            <div class="settings-row settings-dense-row">
                <label for=${p("agentIds")}>Selected Agents</label>
                <div id=${p("agentIds")} style="display:flex; flex-wrap:wrap; gap:8px; min-height:32px;">
                    ${D.length===0?e`<span class="settings-hint" style="margin:0">No agents reported.</span>`:D.map((s)=>{let a=d.agentIds.includes(s.id);return e`
                        <label key=${s.id} class="settings-dense-check" style="padding:4px 8px; border:1px solid var(--border-color, rgba(255,255,255,0.12)); border-radius:999px;">
                            <input type="checkbox" checked=${a} disabled=${!w||d.grantMode!=="agents"} onChange=${(b)=>{let T=b.currentTarget.checked;y((S)=>({...S,agentIds:T?Array.from(new Set([...S.agentIds,s.id])):S.agentIds.filter((N)=>N!==s.id)}))}} />
                            <span>${s.label||s.id}</span>
                        </label>
                    `})}
                </div>
            </div>

            <div class="settings-row settings-dense-row">
                <label for=${p("transport")}>Transport</label>
                <select id=${p("transport")} value=${d.transport||"http"} disabled=${!w} onChange=${(s)=>y((a)=>({...a,transport:s.currentTarget.value}))}>
                    <option value="http">HTTP</option>
                    <option value="stdio">stdio</option>
                </select>
            </div>

            <div class="settings-row settings-dense-row">
                <label for=${p("url")}>URL</label>
                <input id=${p("url")} type="text" value=${d.url||""} disabled=${!w||d.transport!=="http"} onInput=${(s)=>y((a)=>({...a,url:s.currentTarget.value}))} placeholder="https://example.test/mcp" />
            </div>

            <div class="settings-row settings-dense-row">
                <label for=${p("auth")}>Authentication</label>
                <select id=${p("auth")} value=${d.auth||"bearer"} disabled=${!w||d.transport!=="http"} onChange=${(s)=>y((a)=>({...a,auth:s.currentTarget.value}))}>
                    <option value="none">No authentication</option>
                    <option value="bearer">Bearer token</option>
                    <option value="oauth">OAuth</option>
                </select>
            </div>

            ${d.transport==="http"&&e`
                <div class="settings-row settings-dense-row settings-dense-row-checkbox">
                    <label class="settings-dense-check" for=${p("allow-http")}>
                        <input id=${p("allow-http")} type="checkbox" checked=${Boolean(d.allowHttp)} disabled=${!w} onChange=${(s)=>y((a)=>({...a,allowHttp:s.currentTarget.checked}))} />
                        <span>Allow insecure HTTP</span>
                    </label>
                </div>
            `}

            ${d.transport==="http"&&d.auth==="bearer"&&e`
                <div class="settings-row settings-dense-row">
                    <label for=${p("bearer-keychain")}>Bearer token keychain reference</label>
                    <input id=${p("bearer-keychain")} type="text" value=${d.bearerTokenKeychain||""} disabled=${!w} onInput=${(s)=>y((a)=>({...a,bearerTokenKeychain:s.currentTarget.value}))} placeholder="my-server/token" />
                </div>
            `}

            ${d.transport==="http"&&d.auth==="oauth"&&e`
                <div class="settings-row settings-dense-row">
                    <label for=${p("oauth-client-id")}>OAuth client ID</label>
                    <input id=${p("oauth-client-id")} type="text" value=${d.oauth?.clientId||""} disabled=${!w} onInput=${(s)=>y((a)=>({...a,oauth:{...a.oauth,clientId:s.currentTarget.value}}))} placeholder="client-id" />
                </div>
                <div class="settings-row settings-dense-row">
                    <label for=${p("oauth-scope")}>OAuth scope</label>
                    <input id=${p("oauth-scope")} type="text" value=${d.oauth?.scope||""} disabled=${!w} onInput=${(s)=>y((a)=>({...a,oauth:{...a.oauth,scope:s.currentTarget.value}}))} placeholder="mcp.read mcp.write" />
                </div>
                <div class="settings-row settings-dense-row">
                    <label for=${p("oauth-secret-keychain")}>OAuth client secret keychain</label>
                    <input id=${p("oauth-secret-keychain")} type="text" value=${d.oauth?.clientSecretKeychain||""} disabled=${!w} onInput=${(s)=>y((a)=>({...a,oauth:{...a.oauth,clientSecretKeychain:s.currentTarget.value}}))} placeholder="my-server/oauth-secret" />
                </div>
                <div class="settings-row settings-dense-row" style="gap:8px; flex-wrap:wrap;">
                    <button type="button" class="settings-btn" disabled=${!h||u} onClick=${ee}>Sign in</button>
                    <button type="button" class="settings-btn" disabled=${!h||u} onClick=${te}>Sign out</button>
                </div>
            `}

            ${d.transport==="stdio"&&e`
                <div class="settings-row settings-dense-row">
                    <label for=${p("stdio-command")}>Command</label>
                    <input id=${p("stdio-command")} type="text" value=${d.commandText||""} disabled=${!w} onInput=${(s)=>y((a)=>({...a,commandText:s.currentTarget.value}))} placeholder='["bun","run","server.ts"]' />
                </div>
                <div class="settings-row settings-dense-row">
                    <label for=${p("workdir")}>Work directory</label>
                    <input id=${p("workdir")} type="text" value=${d.workdir||""} disabled=${!w} onInput=${(s)=>y((a)=>({...a,workdir:s.currentTarget.value}))} placeholder="/workspace/project" />
                </div>
                <div class="settings-row settings-dense-row">
                    <label for=${p("stdio-env")}>Environment JSON</label>
                    <textarea id=${p("stdio-env")} rows="3" value=${d.envText||""} disabled=${!w||d.clearEnvironment} onInput=${(s)=>y((a)=>({...a,envText:s.currentTarget.value}))} placeholder='{"KEY":"keychain:server/token"}'></textarea>
                    <span class="settings-hint">Leave blank to keep the saved environment. Enter a JSON object to replace it.</span>
                    ${d.environmentNames.length>0&&e`
                        <label class="settings-dense-check"><input type="checkbox" disabled=${!w} checked=${d.clearEnvironment} onChange=${(s)=>y((a)=>({...a,clearEnvironment:s.currentTarget.checked}))} /> Clear saved environment</label>
                        <details><summary>Remove individual saved entries</summary>
                            ${d.environmentNames.map((s)=>e`<label key=${s} class="settings-dense-check"><input type="checkbox" disabled=${!w||d.clearEnvironment||Boolean(d.envText.trim())} checked=${d.removeEnvironment.includes(s)} onChange=${(a)=>y((b)=>({...b,removeEnvironment:a.currentTarget.checked?[...b.removeEnvironment,s]:b.removeEnvironment.filter((T)=>T!==s)}))} /> Remove ${s}</label>`)}
                        </details>
                    `}
                </div>
            `}

            <div class="settings-row settings-dense-row">
                <label>Timeout</label>
                <${f}
                    id=${p("timeout")}
                    label="MCP timeout seconds"
                    value=${Number(d.timeoutSeconds||30)}
                    min=${1}
                    max=${300}
                    step=${5}
                    fallback=${30}
                    width="88px"
                    disabled=${!w}
                    onChange=${(s)=>y((a)=>({...a,timeoutSeconds:Number(s||30)}))}
                />
                <span class="settings-hint" style="margin:0">Seconds</span>
            </div>

            <div class="settings-row settings-dense-row">
                <label>Recall</label>
                <div style="display:flex; flex-wrap:wrap; gap:8px; align-items:center;">
                    <select value=${String(d.recall?.mode||"off")} disabled=${!w} onChange=${(s)=>y((a)=>({...a,recall:{...A(a.recall),mode:s.currentTarget.value}}))}>
                        <option value="off">Off</option>
                        <option value="observe">Observe</option>
                        <option value="active">Active</option>
                    </select>

                </div>
            </div>
            <div class="settings-row settings-dense-row">
                <label>Retention</label>
                <${f}
                    id=${p("recall-retention")}
                    label="Recall retention days"
                    value=${Number(d.recall?.maxAgeDays||7)}
                    min=${1}
                    max=${90}
                    fallback=${7}
                    width="88px"
                    disabled=${!w}
                    onChange=${(s)=>y((a)=>({...a,recall:{...A(a.recall),maxAgeDays:Number(s||7)}}))}
                />
                <span class="settings-hint" style="margin:0">days</span>
            </div>
            <div class="settings-row settings-dense-row">
                <label>Recall size</label>
                <${f}
                    id=${p("recall-max-items")}
                    label="Recall max items"
                    value=${Number(d.recall?.maxItems||128)}
                    min=${1}
                    max=${256}
                    fallback=${128}
                    width="90px"
                    disabled=${!w}
                    onChange=${(s)=>y((a)=>({...a,recall:{...A(a.recall),maxItems:Number(s||128)}}))}
                />
                <span class="settings-hint" style="margin:0">items</span>
            </div>
            <div class="settings-row settings-dense-row">
                <label>Recall max bytes</label>
                <${f}
                    id=${p("recall-max-bytes")}
                    label="Recall max bytes"
                    value=${Number(d.recall?.maxBytes||8388608)}
                    min=${4096}
                    max=${16777216}
                    step=${1024}
                    fallback=${8388608}
                    width="115px"
                    disabled=${!w}
                    onChange=${(s)=>y((a)=>({...a,recall:{...A(a.recall),maxBytes:Number(s||8388608)}}))}
                />
                <span class="settings-hint" style="margin:0">bytes</span>
            </div>

            <div class="settings-row settings-dense-row" style="gap:8px; flex-wrap:wrap;">
                <button type="button" class="settings-btn" disabled=${!w||!d.name} onClick=${V}>${u?"Saving…":"Save connection"}</button>
                <button type="button" class="settings-btn" disabled=${!h||u} onClick=${Z}>Reconnect</button>
                <button type="button" class="settings-btn danger" disabled=${!h||u} onClick=${X}>Remove</button>
                <button type="button" class="settings-btn" disabled=${!h||u} onClick=${ne}>Forget recall</button>
            </div>

            ${h?.status&&e`
                <div class="settings-row" style="display:block;" role="status">
                    <strong>Status</strong>
                    <p class="settings-hint" style="margin:8px 0 0 0">${ie(h.status)}</p>
                </div>
            `}
            ${h?.needsCredentialApproval&&e`
                <div class="settings-row settings-dense-row settings-dense-row-checkbox">
                    <label class="settings-dense-check" for=${p("approve-reuse")}>
                        <input id=${p("approve-reuse")} type="checkbox" checked=${Boolean(d.approveCredentialReuse)} disabled=${!w} onChange=${(s)=>y((a)=>({...a,approveCredentialReuse:s.currentTarget.checked}))} />
                        <span>Approve credential reuse for this endpoint or command</span>
                    </label>
                </div>
            `}
            ${Q&&e`<p class="settings-hint">Choose an MCP connection or create a new one.</p>`}
        </div>
    `}export{pe as McpSection};

//# debugId=1979F0E66D7B257664756E2164756E21
//# sourceMappingURL=mcp-mb1fnj6w.js.map
