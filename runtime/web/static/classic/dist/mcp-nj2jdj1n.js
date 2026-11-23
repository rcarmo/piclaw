import{t,o,i,r,e}from"./app-1vedzwvv.js";import{f}from"./app-zc9whw7p.js";import{m}from"./app-y300gnye.js";var M=()=>({mode:"off",maxAgeDays:7,maxItems:128,maxBytes:8388608,profiles:[]});function Y(a,c=[]){let p=a.trim();if(!p)return c;try{let l=JSON.parse(p);if(!Array.isArray(l)||l.some((g)=>typeof g!=="string"))throw Error("Command must be a JSON string array.");return l}catch{throw Error("Command must be a valid JSON string array.")}}function Q(a,c={}){let p=a.trim();if(!p)return c;try{let l=JSON.parse(p);if(!l||typeof l!=="object"||Array.isArray(l))throw Error("Environment must be a JSON object.");let g={};for(let[h,k]of Object.entries(l)){if(typeof k!=="string")throw Error("Environment values must be strings.");g[h]=k}return g}catch{throw Error("Environment must be a valid JSON object with string values.")}}var V=()=>globalThis.crypto?.randomUUID?globalThis.crypto.randomUUID():`mcp-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;function R(a,c=null,p=M()){let l=c||{},g={...M(),...p||{},...l.recall||{}};return{id:l.id||V(),name:l.name||"",workspaceId:l.workspaceId||a||"workspace",access:l.access||null,grantMode:l.access?.kind==="all"?"all":(l.access?.grants?.find((h)=>h.workspaceId===(l.workspaceId||a))?.agentIds??(l.agentIds?.length?l.agentIds:"all"))==="all"?"workspace":"agents",agentIds:Array.isArray(l.access?.grants?.find((h)=>h.workspaceId===(l.workspaceId||a))?.agentIds)?[...l.access.grants.find((h)=>h.workspaceId===(l.workspaceId||a)).agentIds]:Array.isArray(l.agentIds)?[...l.agentIds]:[],enabled:l.enabled!==!1,transport:l.transport||"http",url:l.url||"",auth:l.auth||"bearer",allowHttp:Boolean(l.allowHttp),timeoutSeconds:Number(l.timeoutSeconds||30),revision:Number(l.revision||0),hasSavedCredentials:Boolean(l.hasSavedCredentials),needsCredentialApproval:Boolean(l.needsCredentialApproval),approveCredentialReuse:!1,status:l.status||null,oauth:{clientId:l.oauth?.clientId||"",scope:l.oauth?.scope||"",clientSecretKeychain:""},bearerTokenKeychain:"",command:Array.isArray(l.command)?[...l.command]:[],commandText:Array.isArray(l.command)?JSON.stringify(l.command):"",workdir:l.workdir||"",env:l.env&&typeof l.env==="object"?{...l.env}:{},envText:l.env&&typeof l.env==="object"?JSON.stringify(l.env):"",recall:g}}function A(a){let c=a&&typeof a==="object"?a:{},p={...M(),...c};return{mode:p.mode==="observe"||p.mode==="active"?p.mode:"off",maxAgeDays:Number(p.maxAgeDays||7),maxItems:Number(p.maxItems||128),maxBytes:Number(p.maxBytes||8388608),profiles:Array.isArray(p.profiles)?p.profiles:[]}}function X(a,c){let p={id:a.id,name:String(a.name||"").trim(),workspaceId:String(a.workspaceId||c||"workspace"),agentIds:Array.from(new Set((a.agentIds||[]).filter(Boolean))),enabled:Boolean(a.enabled),transport:a.transport||"http",url:String(a.url||"").trim(),auth:a.auth||"bearer",allowHttp:Boolean(a.allowHttp),timeoutSeconds:Number(a.timeoutSeconds||30),recall:A(a.recall)};if(a.grantMode==="agents"&&!p.agentIds.length)throw Error("Select at least one Agent, or explicitly choose all Agents in this workspace.");let l=a.access?.kind==="workspaces"?a.access.grants.filter((g)=>g.workspaceId!==p.workspaceId):[];if(p.access=a.grantMode==="all"?{kind:"all"}:{kind:"workspaces",grants:[...l,{workspaceId:p.workspaceId,agentIds:a.grantMode==="agents"?p.agentIds:"all"}]},p.transport==="stdio"){let g=Y(String(a.commandText||""),Array.isArray(a.command)?a.command:[]);if(g.length)p.command=g;if(String(a.workdir||"").trim())p.workdir=String(a.workdir||"").trim();let h=Q(String(a.envText||""),a.env||{}),k={};for(let[w,x]of Object.entries(h))if(typeof x==="string")k[w]=x;else if(x!==void 0&&x!==null)k[w]=String(x);if(String(a.envText||"").trim()||Object.keys(k).length)p.env=k}else{if(p.url=String(a.url||"").trim(),a.auth==="bearer"&&String(a.bearerTokenKeychain||"").trim())p.bearerTokenKeychain=String(a.bearerTokenKeychain||"").trim();if(a.auth==="oauth"){let g={},h=String(a.oauth?.clientId||"").trim(),k=String(a.oauth?.scope||"").trim(),w=String(a.oauth?.clientSecretKeychain||"").trim();if(h)g.clientId=h;if(k)g.scope=k;if(w)g.clientSecretKeychain=w;if(Object.keys(g).length)p.oauth=g}}return p}function Z(a){if(!a||typeof a!=="object")return"Unknown status";let c=typeof a.state==="string"?a.state:"unknown",p=typeof a.message==="string"&&a.message.trim()?` · ${a.message}`:"",l=Array.isArray(a.tools)&&a.tools.length?` · ${a.tools.length} tools`:"";return`${c}${p}${l}`}function se({setStatus:a}={}){let c=m("mcp"),[p,l]=t(!0),[g,h]=t(!1),[k,w]=t(""),[x,H]=t(""),[j,L]=t([]),[O,B]=t([]),[P,J]=t(null),[N,D]=t({recall:M()}),[S,E]=t(null),[d,b]=t(()=>R("workspace")),u=i(()=>O.find((n)=>n.id===S)||null,[O,S]),v=r(async()=>{l(!0),w("");try{let n=await fetch("/agent/settings/mcp",{credentials:"same-origin",cache:"no-store"}),s=await n.json().catch(()=>({}));if(!n.ok||!s?.ok)throw Error(s?.error||`MCP settings failed (${n.status})`);let I=Array.isArray(s.connections)?s.connections:[];H(s.workspaceId||"workspace"),L(Array.isArray(s.agents)?s.agents:[]),B(I),J(s.migration||null),D({recall:A(s.defaults?.recall||M())}),E((T)=>{if(T&&I.some((C)=>C.id===T))return T;return I[0]?.id||null}),a?.(null)}catch(n){let s=n instanceof Error?n.message:String(n);w(s),a?.(s,"error")}finally{l(!1)}},[a]);o(()=>{v()},[v]),o(()=>{if(!u){b(R(x,null,N.recall));return}b(R(x,u,N.recall))},[N.recall,u,x]);let K=!u&&!S,U=r(async()=>{if(!String(d.name||"").trim()){w("Connection name is required."),a?.("Connection name is required.","error");return}if(d.transport==="http"&&!String(d.url||"").trim()){w("HTTP MCP connections need an endpoint URL."),a?.("HTTP MCP connections need an endpoint URL.","error");return}h(!0),w(""),a?.("Saving MCP connection…","info");try{let s=X(d,x),I=await fetch("/agent/settings/mcp",{method:"POST",credentials:"same-origin",headers:{"Content-Type":"application/json"},body:JSON.stringify({action:"save",connection:s,expectedRevision:Number((u?.revision??d.revision??0)||0),approveCredentialReuse:Boolean(d.approveCredentialReuse)})}),T=await I.json().catch(()=>({}));if(!I.ok||!T?.ok){let C=T?.error||"MCP connection could not be saved.";throw Error(C)}a?.("MCP connection saved.","success"),E(T?.connection?.id||s.id||S||null),await v()}catch(s){let I=s instanceof Error?s.message:String(s);w(I),a?.(I,"error")}finally{h(!1)}},[d,v,u,S,a,x]),F=r(async()=>{if(!u)return;h(!0);try{let n=await fetch("/agent/settings/mcp",{method:"POST",credentials:"same-origin",headers:{"Content-Type":"application/json"},body:JSON.stringify({action:"remove",id:u.id,expectedRevision:Number(u.revision||0)})}),s=await n.json().catch(()=>({}));if(!n.ok||!s?.ok)throw Error(s?.error||"Could not remove the MCP connection.");E(null),a?.("MCP connection removed.","success"),await v()}catch(n){let s=n instanceof Error?n.message:String(n);w(s),a?.(s,"error")}finally{h(!1)}},[v,u,a]),z=r(async()=>{if(!u)return;h(!0);try{let n=await fetch("/agent/settings/mcp",{method:"POST",credentials:"same-origin",headers:{"Content-Type":"application/json"},body:JSON.stringify({action:"reconnect",id:u.id})}),s=await n.json().catch(()=>({}));if(!n.ok||!s?.ok)throw Error(s?.error||"Could not reconnect the MCP connection.");a?.("Reconnect requested.","success"),await v()}catch(n){let s=n instanceof Error?n.message:String(n);w(s),a?.(s,"error")}finally{h(!1)}},[v,u,a]),W=r(async()=>{if(!u||g)return;h(!0);try{let n=await fetch("/agent/settings/mcp",{method:"POST",credentials:"same-origin",headers:{"Content-Type":"application/json"},body:JSON.stringify({action:"sign_in",id:u.id})}),s=await n.json().catch(()=>({}));if(!n.ok||!s?.ok)throw Error(s?.error||"OAuth sign-in was not available.");if(s.authorizationUrl)window.location.assign(s.authorizationUrl);else a?.(s.message||"Already signed in.","success"),await v()}catch(n){let s=n instanceof Error?n.message:String(n);w(s),a?.(s,"error")}finally{h(!1)}},[u,a,g,v]),_=r(async()=>{if(!u||g)return;h(!0);try{let n=await fetch("/agent/settings/mcp",{method:"POST",credentials:"same-origin",headers:{"Content-Type":"application/json"},body:JSON.stringify({action:"sign_out",id:u.id})}),s=await n.json().catch(()=>({}));if(!n.ok||!s?.ok)throw Error(s?.error||"OAuth sign-out failed.");a?.("OAuth sign-out completed.","success"),await v()}catch(n){let s=n instanceof Error?n.message:String(n);w(s),a?.(s,"error")}finally{h(!1)}},[v,u,a,g]),q=r(async()=>{if(!u||g||!confirm("Forget retained MCP recall copies for this connection? Original SDK history is unchanged."))return;h(!0);try{let n=await fetch("/agent/settings/mcp",{method:"POST",credentials:"same-origin",headers:{"Content-Type":"application/json"},body:JSON.stringify({action:"forget_recall",id:u.id})}),s=await n.json().catch(()=>({}));if(!n.ok||!s?.ok)throw Error(s?.error||"Could not clear MCP recall history.");a?.("MCP recall history was cleared.","success"),await v()}catch(n){let s=n instanceof Error?n.message:String(n);w(s),a?.(s,"error")}finally{h(!1)}},[v,u,a,g]),y=!p&&!g;return e`
        <div class="settings-section">
            <h3>MCP</h3>
            ${p&&e`<p class="settings-hint" role="status">Loading MCP connections…</p>`}
            ${k&&e`<p class="mcp-notice settings-error" role="alert">${k}</p>`}
            ${P?.diagnostics?.length>0&&e`
                <div class="settings-row settings-dense-row" style="display:block">
                    <strong>Imported disabled entries</strong>
                    <ul style="margin:8px 0 0 1.2rem; padding:0;">
                        ${P.diagnostics.map((n)=>e`<li key=${n.name}>
                            <strong>${n.name}</strong>: ${n.fields?.join(", ")||"fields"} — ${n.reason}
                        </li>`)}
                    </ul>
                </div>
            `}

            <div class="settings-row settings-dense-row">
                <label>Workspace</label>
                <span class="settings-hint" style="margin:0">${x||"current workspace"}</span>
            </div>

            <div class="settings-row" style="display:flex; flex-wrap:wrap; gap:12px; align-items:center;">
                <label style="min-width:140px">Connections</label>
                <div style="display:flex; flex-wrap:wrap; gap:8px; align-items:center;">
                    ${O.map((n)=>e`
                        <button
                            type="button"
                            key=${n.id}
                            class=${`settings-btn ${S===n.id?"primary":""}`}
                            onClick=${()=>E(n.id)}
                            disabled=${g}
                        >
                            ${n.name||"Unnamed"}
                        </button>
                    `)}
                    <button type="button" class="settings-btn" onClick=${()=>E(null)} disabled=${g}>New connection</button>
                </div>
            </div>

            <div class="settings-row settings-dense-row settings-dense-row-checkbox">
                <label class="settings-dense-check" for=${c("new-connection-toggle")}>
                    <input id=${c("new-connection-toggle")} type="checkbox" checked=${Boolean(d.enabled)} disabled=${!y} onChange=${(n)=>b((s)=>({...s,enabled:n.currentTarget.checked}))} />
                    <span>Enabled</span>
                </label>
            </div>

            <div class="settings-row settings-dense-row">
                <label for=${c("name")}>Name</label>
                <input id=${c("name")} type="text" value=${d.name||""} disabled=${!y} onInput=${(n)=>b((s)=>({...s,name:n.currentTarget.value}))} placeholder="my-mcp-server" />
            </div>

            <div class="settings-row settings-dense-row">
                <label for=${c("workspace")}>Workspace</label>
                <input id=${c("workspace")} type="text" value=${d.workspaceId||x||"workspace"} disabled=${!0} />
            </div>

            <div class="settings-row settings-dense-row">
                <label for=${c("grant-mode")}>Access</label>
                <select id=${c("grant-mode")} value=${d.grantMode} disabled=${!y} onChange=${(n)=>b((s)=>({...s,grantMode:n.currentTarget.value}))}>
                    <option value="workspace">This workspace, all Agents</option><option value="agents">Selected Agents in this workspace</option><option value="all">All workspaces and Agents</option>
                </select>
            </div>
            <div class="settings-row settings-dense-row">
                <label for=${c("agentIds")}>Selected Agents</label>
                <div id=${c("agentIds")} style="display:flex; flex-wrap:wrap; gap:8px; min-height:32px;">
                    ${j.length===0?e`<span class="settings-hint" style="margin:0">No agents reported.</span>`:j.map((n)=>{let s=d.agentIds.includes(n.id);return e`
                        <label key=${n.id} class="settings-dense-check" style="padding:4px 8px; border:1px solid var(--border-color, rgba(255,255,255,0.12)); border-radius:999px;">
                            <input type="checkbox" checked=${s} disabled=${!y||d.grantMode!=="agents"} onChange=${(I)=>{let T=I.currentTarget.checked;b((C)=>({...C,agentIds:T?Array.from(new Set([...C.agentIds,n.id])):C.agentIds.filter((G)=>G!==n.id)}))}} />
                            <span>${n.label||n.id}</span>
                        </label>
                    `})}
                </div>
            </div>

            <div class="settings-row settings-dense-row">
                <label for=${c("transport")}>Transport</label>
                <select id=${c("transport")} value=${d.transport||"http"} disabled=${!y} onChange=${(n)=>b((s)=>({...s,transport:n.currentTarget.value}))}>
                    <option value="http">HTTP</option>
                    <option value="stdio">stdio</option>
                </select>
            </div>

            <div class="settings-row settings-dense-row">
                <label for=${c("url")}>URL</label>
                <input id=${c("url")} type="text" value=${d.url||""} disabled=${!y||d.transport!=="http"} onInput=${(n)=>b((s)=>({...s,url:n.currentTarget.value}))} placeholder="https://example.test/mcp" />
            </div>

            <div class="settings-row settings-dense-row">
                <label for=${c("auth")}>Authentication</label>
                <select id=${c("auth")} value=${d.auth||"bearer"} disabled=${!y||d.transport!=="http"} onChange=${(n)=>b((s)=>({...s,auth:n.currentTarget.value}))}>
                    <option value="none">No authentication</option>
                    <option value="bearer">Bearer token</option>
                    <option value="oauth">OAuth</option>
                </select>
            </div>

            ${d.transport==="http"&&e`
                <div class="settings-row settings-dense-row settings-dense-row-checkbox">
                    <label class="settings-dense-check" for=${c("allow-http")}>
                        <input id=${c("allow-http")} type="checkbox" checked=${Boolean(d.allowHttp)} disabled=${!y} onChange=${(n)=>b((s)=>({...s,allowHttp:n.currentTarget.checked}))} />
                        <span>Allow insecure HTTP</span>
                    </label>
                </div>
            `}

            ${d.transport==="http"&&d.auth==="bearer"&&e`
                <div class="settings-row settings-dense-row">
                    <label for=${c("bearer-keychain")}>Bearer token keychain reference</label>
                    <input id=${c("bearer-keychain")} type="text" value=${d.bearerTokenKeychain||""} disabled=${!y} onInput=${(n)=>b((s)=>({...s,bearerTokenKeychain:n.currentTarget.value}))} placeholder="my-server/token" />
                </div>
            `}

            ${d.transport==="http"&&d.auth==="oauth"&&e`
                <div class="settings-row settings-dense-row">
                    <label for=${c("oauth-client-id")}>OAuth client ID</label>
                    <input id=${c("oauth-client-id")} type="text" value=${d.oauth?.clientId||""} disabled=${!y} onInput=${(n)=>b((s)=>({...s,oauth:{...s.oauth,clientId:n.currentTarget.value}}))} placeholder="client-id" />
                </div>
                <div class="settings-row settings-dense-row">
                    <label for=${c("oauth-scope")}>OAuth scope</label>
                    <input id=${c("oauth-scope")} type="text" value=${d.oauth?.scope||""} disabled=${!y} onInput=${(n)=>b((s)=>({...s,oauth:{...s.oauth,scope:n.currentTarget.value}}))} placeholder="mcp.read mcp.write" />
                </div>
                <div class="settings-row settings-dense-row">
                    <label for=${c("oauth-secret-keychain")}>OAuth client secret keychain</label>
                    <input id=${c("oauth-secret-keychain")} type="text" value=${d.oauth?.clientSecretKeychain||""} disabled=${!y} onInput=${(n)=>b((s)=>({...s,oauth:{...s.oauth,clientSecretKeychain:n.currentTarget.value}}))} placeholder="my-server/oauth-secret" />
                </div>
                <div class="settings-row settings-dense-row" style="gap:8px; flex-wrap:wrap;">
                    <button type="button" class="settings-btn" disabled=${!u||g} onClick=${W}>Sign in</button>
                    <button type="button" class="settings-btn" disabled=${!u||g} onClick=${_}>Sign out</button>
                </div>
            `}

            ${d.transport==="stdio"&&e`
                <div class="settings-row settings-dense-row">
                    <label for=${c("stdio-command")}>Command</label>
                    <input id=${c("stdio-command")} type="text" value=${d.commandText||""} disabled=${!y} onInput=${(n)=>b((s)=>({...s,commandText:n.currentTarget.value}))} placeholder='["bun","run","server.ts"]' />
                </div>
                <div class="settings-row settings-dense-row">
                    <label for=${c("workdir")}>Work directory</label>
                    <input id=${c("workdir")} type="text" value=${d.workdir||""} disabled=${!y} onInput=${(n)=>b((s)=>({...s,workdir:n.currentTarget.value}))} placeholder="/workspace/project" />
                </div>
                <div class="settings-row settings-dense-row">
                    <label for=${c("stdio-env")}>Environment JSON</label>
                    <textarea id=${c("stdio-env")} rows="3" value=${d.envText||""} disabled=${!y} onInput=${(n)=>b((s)=>({...s,envText:n.currentTarget.value}))} placeholder='{"KEY":"keychain:server/token"}'></textarea>
                </div>
            `}

            <div class="settings-row settings-dense-row">
                <label>Timeout</label>
                <${f}
                    id=${c("timeout")}
                    label="MCP timeout seconds"
                    value=${Number(d.timeoutSeconds||30)}
                    min=${1}
                    max=${300}
                    step=${5}
                    fallback=${30}
                    width="88px"
                    disabled=${!y}
                    onChange=${(n)=>b((s)=>({...s,timeoutSeconds:Number(n||30)}))}
                />
                <span class="settings-hint" style="margin:0">Seconds</span>
            </div>

            <div class="settings-row settings-dense-row">
                <label>Recall</label>
                <div style="display:flex; flex-wrap:wrap; gap:8px; align-items:center;">
                    <select value=${String(d.recall?.mode||"off")} disabled=${!y} onChange=${(n)=>b((s)=>({...s,recall:{...A(s.recall),mode:n.currentTarget.value}}))}>
                        <option value="off">Off</option>
                        <option value="observe">Observe</option>
                        <option value="active">Active</option>
                    </select>

                </div>
            </div>
            <div class="settings-row settings-dense-row">
                <label>Retention</label>
                <${f}
                    id=${c("recall-retention")}
                    label="Recall retention days"
                    value=${Number(d.recall?.maxAgeDays||7)}
                    min=${1}
                    max=${90}
                    fallback=${7}
                    width="88px"
                    disabled=${!y}
                    onChange=${(n)=>b((s)=>({...s,recall:{...A(s.recall),maxAgeDays:Number(n||7)}}))}
                />
                <span class="settings-hint" style="margin:0">days</span>
            </div>
            <div class="settings-row settings-dense-row">
                <label>Recall size</label>
                <${f}
                    id=${c("recall-max-items")}
                    label="Recall max items"
                    value=${Number(d.recall?.maxItems||128)}
                    min=${1}
                    max=${256}
                    fallback=${128}
                    width="90px"
                    disabled=${!y}
                    onChange=${(n)=>b((s)=>({...s,recall:{...A(s.recall),maxItems:Number(n||128)}}))}
                />
                <span class="settings-hint" style="margin:0">items</span>
            </div>
            <div class="settings-row settings-dense-row">
                <label>Recall max bytes</label>
                <${f}
                    id=${c("recall-max-bytes")}
                    label="Recall max bytes"
                    value=${Number(d.recall?.maxBytes||8388608)}
                    min=${4096}
                    max=${16777216}
                    step=${1024}
                    fallback=${8388608}
                    width="115px"
                    disabled=${!y}
                    onChange=${(n)=>b((s)=>({...s,recall:{...A(s.recall),maxBytes:Number(n||8388608)}}))}
                />
                <span class="settings-hint" style="margin:0">bytes</span>
            </div>

            <div class="settings-row settings-dense-row" style="gap:8px; flex-wrap:wrap;">
                <button type="button" class="settings-btn" disabled=${!y||!d.name} onClick=${U}>${g?"Saving…":"Save connection"}</button>
                <button type="button" class="settings-btn" disabled=${!u||g} onClick=${z}>Reconnect</button>
                <button type="button" class="settings-btn danger" disabled=${!u||g} onClick=${F}>Remove</button>
                <button type="button" class="settings-btn" disabled=${!u||g} onClick=${q}>Forget recall</button>
            </div>

            ${u?.status&&e`
                <div class="settings-row" style="display:block;">
                    <strong>Status</strong>
                    <p class="settings-hint" style="margin:8px 0 0 0">${Z(u.status)}</p>
                </div>
            `}
            ${u?.needsCredentialApproval&&e`
                <div class="settings-row settings-dense-row settings-dense-row-checkbox">
                    <label class="settings-dense-check" for=${c("approve-reuse")}>
                        <input id=${c("approve-reuse")} type="checkbox" checked=${Boolean(d.approveCredentialReuse)} disabled=${!y} onChange=${(n)=>b((s)=>({...s,approveCredentialReuse:n.currentTarget.checked}))} />
                        <span>Approve credential reuse for this endpoint or command</span>
                    </label>
                </div>
            `}
            ${K&&e`<p class="settings-hint">Choose an MCP connection or create a new one.</p>`}
        </div>
    `}export{se as McpSection};

//# debugId=F37465ECB802C73564756E2164756E21
//# sourceMappingURL=mcp-nj2jdj1n.js.map
