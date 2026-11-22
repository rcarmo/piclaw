import{t,o,i,n,e}from"./app-c7xgjke0.js";import{m}from"./app-kw0x58x3.js";import{y}from"./app-8rxq9r6x.js";var M=()=>({mode:"off",maxAgeDays:7,maxItems:128,maxBytes:8388608,profiles:[]});function Y(r,c=[]){let p=r.trim();if(!p)return c;try{let l=JSON.parse(p);if(!Array.isArray(l)||l.some((g)=>typeof g!=="string"))throw Error("Command must be a JSON string array.");return l}catch{throw Error("Command must be a valid JSON string array.")}}function Q(r,c={}){let p=r.trim();if(!p)return c;try{let l=JSON.parse(p);if(!l||typeof l!=="object"||Array.isArray(l))throw Error("Environment must be a JSON object.");let g={};for(let[h,k]of Object.entries(l)){if(typeof k!=="string")throw Error("Environment values must be strings.");g[h]=k}return g}catch{throw Error("Environment must be a valid JSON object with string values.")}}var V=()=>globalThis.crypto?.randomUUID?globalThis.crypto.randomUUID():`mcp-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;function R(r,c=null,p=M()){let l=c||{},g={...M(),...p||{},...l.recall||{}};return{id:l.id||V(),name:l.name||"",workspaceId:l.workspaceId||r||"workspace",access:l.access||null,grantMode:l.access?.kind==="all"?"all":(l.access?.grants?.find((h)=>h.workspaceId===(l.workspaceId||r))?.agentIds??(l.agentIds?.length?l.agentIds:"all"))==="all"?"workspace":"agents",agentIds:Array.isArray(l.access?.grants?.find((h)=>h.workspaceId===(l.workspaceId||r))?.agentIds)?[...l.access.grants.find((h)=>h.workspaceId===(l.workspaceId||r)).agentIds]:Array.isArray(l.agentIds)?[...l.agentIds]:[],enabled:l.enabled!==!1,transport:l.transport||"http",url:l.url||"",auth:l.auth||"bearer",allowHttp:Boolean(l.allowHttp),timeoutSeconds:Number(l.timeoutSeconds||30),revision:Number(l.revision||0),hasSavedCredentials:Boolean(l.hasSavedCredentials),needsCredentialApproval:Boolean(l.needsCredentialApproval),approveCredentialReuse:!1,status:l.status||null,oauth:{clientId:l.oauth?.clientId||"",scope:l.oauth?.scope||"",clientSecretKeychain:""},bearerTokenKeychain:"",command:Array.isArray(l.command)?[...l.command]:[],commandText:Array.isArray(l.command)?JSON.stringify(l.command):"",workdir:l.workdir||"",env:l.env&&typeof l.env==="object"?{...l.env}:{},envText:l.env&&typeof l.env==="object"?JSON.stringify(l.env):"",recall:g}}function A(r){let c=r&&typeof r==="object"?r:{},p={...M(),...c};return{mode:p.mode==="observe"||p.mode==="active"?p.mode:"off",maxAgeDays:Number(p.maxAgeDays||7),maxItems:Number(p.maxItems||128),maxBytes:Number(p.maxBytes||8388608),profiles:Array.isArray(p.profiles)?p.profiles:[]}}function X(r,c){let p={id:r.id,name:String(r.name||"").trim(),workspaceId:String(r.workspaceId||c||"workspace"),agentIds:Array.from(new Set((r.agentIds||[]).filter(Boolean))),enabled:Boolean(r.enabled),transport:r.transport||"http",url:String(r.url||"").trim(),auth:r.auth||"bearer",allowHttp:Boolean(r.allowHttp),timeoutSeconds:Number(r.timeoutSeconds||30),recall:A(r.recall)};if(r.grantMode==="agents"&&!p.agentIds.length)throw Error("Select at least one Agent, or explicitly choose all Agents in this workspace.");let l=r.access?.kind==="workspaces"?r.access.grants.filter((g)=>g.workspaceId!==p.workspaceId):[];if(p.access=r.grantMode==="all"?{kind:"all"}:{kind:"workspaces",grants:[...l,{workspaceId:p.workspaceId,agentIds:r.grantMode==="agents"?p.agentIds:"all"}]},p.transport==="stdio"){let g=Y(String(r.commandText||""),Array.isArray(r.command)?r.command:[]);if(g.length)p.command=g;if(String(r.workdir||"").trim())p.workdir=String(r.workdir||"").trim();let h=Q(String(r.envText||""),r.env||{}),k={};for(let[v,x]of Object.entries(h))if(typeof x==="string")k[v]=x;else if(x!==void 0&&x!==null)k[v]=String(x);if(String(r.envText||"").trim()||Object.keys(k).length)p.env=k}else{if(p.url=String(r.url||"").trim(),r.auth==="bearer"&&String(r.bearerTokenKeychain||"").trim())p.bearerTokenKeychain=String(r.bearerTokenKeychain||"").trim();if(r.auth==="oauth"){let g={},h=String(r.oauth?.clientId||"").trim(),k=String(r.oauth?.scope||"").trim(),v=String(r.oauth?.clientSecretKeychain||"").trim();if(h)g.clientId=h;if(k)g.scope=k;if(v)g.clientSecretKeychain=v;if(Object.keys(g).length)p.oauth=g}}return p}function Z(r){if(!r||typeof r!=="object")return"Unknown status";let c=typeof r.state==="string"?r.state:"unknown",p=typeof r.message==="string"&&r.message.trim()?` · ${r.message}`:"",l=Array.isArray(r.tools)&&r.tools.length?` · ${r.tools.length} tools`:"";return`${c}${p}${l}`}function se({setStatus:r}={}){let c=y("mcp"),[p,l]=t(!0),[g,h]=t(!1),[k,v]=t(""),[x,H]=t(""),[j,L]=t([]),[O,B]=t([]),[P,J]=t(null),[N,D]=t({recall:M()}),[S,E]=t(null),[d,b]=t(()=>R("workspace")),u=i(()=>O.find((s)=>s.id===S)||null,[O,S]),f=n(async()=>{l(!0),v("");try{let s=await fetch("/agent/settings/mcp",{credentials:"same-origin",cache:"no-store"}),a=await s.json().catch(()=>({}));if(!s.ok||!a?.ok)throw Error(a?.error||`MCP settings failed (${s.status})`);let I=Array.isArray(a.connections)?a.connections:[];H(a.workspaceId||"workspace"),L(Array.isArray(a.agents)?a.agents:[]),B(I),J(a.migration||null),D({recall:A(a.defaults?.recall||M())}),E((T)=>{if(T&&I.some((C)=>C.id===T))return T;return I[0]?.id||null}),r?.(null)}catch(s){let a=s instanceof Error?s.message:String(s);v(a),r?.(a,"error")}finally{l(!1)}},[r]);o(()=>{f()},[f]),o(()=>{if(!u){b(R(x,null,N.recall));return}b(R(x,u,N.recall))},[N.recall,u,x]);let K=!u&&!S,U=n(async()=>{if(!String(d.name||"").trim()){v("Connection name is required."),r?.("Connection name is required.","error");return}if(d.transport==="http"&&!String(d.url||"").trim()){v("HTTP MCP connections need an endpoint URL."),r?.("HTTP MCP connections need an endpoint URL.","error");return}h(!0),v(""),r?.("Saving MCP connection…","info");try{let a=X(d,x),I=await fetch("/agent/settings/mcp",{method:"POST",credentials:"same-origin",headers:{"Content-Type":"application/json"},body:JSON.stringify({action:"save",connection:a,expectedRevision:Number((u?.revision??d.revision??0)||0),approveCredentialReuse:Boolean(d.approveCredentialReuse)})}),T=await I.json().catch(()=>({}));if(!I.ok||!T?.ok){let C=T?.error||"MCP connection could not be saved.";throw Error(C)}r?.("MCP connection saved.","success"),E(T?.connection?.id||a.id||S||null),await f()}catch(a){let I=a instanceof Error?a.message:String(a);v(I),r?.(I,"error")}finally{h(!1)}},[d,f,u,S,r,x]),F=n(async()=>{if(!u)return;h(!0);try{let s=await fetch("/agent/settings/mcp",{method:"POST",credentials:"same-origin",headers:{"Content-Type":"application/json"},body:JSON.stringify({action:"remove",id:u.id,expectedRevision:Number(u.revision||0)})}),a=await s.json().catch(()=>({}));if(!s.ok||!a?.ok)throw Error(a?.error||"Could not remove the MCP connection.");E(null),r?.("MCP connection removed.","success"),await f()}catch(s){let a=s instanceof Error?s.message:String(s);v(a),r?.(a,"error")}finally{h(!1)}},[f,u,r]),z=n(async()=>{if(!u)return;h(!0);try{let s=await fetch("/agent/settings/mcp",{method:"POST",credentials:"same-origin",headers:{"Content-Type":"application/json"},body:JSON.stringify({action:"reconnect",id:u.id})}),a=await s.json().catch(()=>({}));if(!s.ok||!a?.ok)throw Error(a?.error||"Could not reconnect the MCP connection.");r?.("Reconnect requested.","success"),await f()}catch(s){let a=s instanceof Error?s.message:String(s);v(a),r?.(a,"error")}finally{h(!1)}},[f,u,r]),W=n(async()=>{if(!u||g)return;h(!0);try{let s=await fetch("/agent/settings/mcp",{method:"POST",credentials:"same-origin",headers:{"Content-Type":"application/json"},body:JSON.stringify({action:"sign_in",id:u.id})}),a=await s.json().catch(()=>({}));if(!s.ok||!a?.ok)throw Error(a?.error||"OAuth sign-in was not available.");if(a.authorizationUrl)window.location.assign(a.authorizationUrl);else r?.(a.message||"Already signed in.","success"),await f()}catch(s){let a=s instanceof Error?s.message:String(s);v(a),r?.(a,"error")}finally{h(!1)}},[u,r,g,f]),_=n(async()=>{if(!u||g)return;h(!0);try{let s=await fetch("/agent/settings/mcp",{method:"POST",credentials:"same-origin",headers:{"Content-Type":"application/json"},body:JSON.stringify({action:"sign_out",id:u.id})}),a=await s.json().catch(()=>({}));if(!s.ok||!a?.ok)throw Error(a?.error||"OAuth sign-out failed.");r?.("OAuth sign-out completed.","success"),await f()}catch(s){let a=s instanceof Error?s.message:String(s);v(a),r?.(a,"error")}finally{h(!1)}},[f,u,r,g]),q=n(async()=>{if(!u||g||!confirm("Forget retained MCP recall copies for this connection? Original SDK history is unchanged."))return;h(!0);try{let s=await fetch("/agent/settings/mcp",{method:"POST",credentials:"same-origin",headers:{"Content-Type":"application/json"},body:JSON.stringify({action:"forget_recall",id:u.id})}),a=await s.json().catch(()=>({}));if(!s.ok||!a?.ok)throw Error(a?.error||"Could not clear MCP recall history.");r?.("MCP recall history was cleared.","success"),await f()}catch(s){let a=s instanceof Error?s.message:String(s);v(a),r?.(a,"error")}finally{h(!1)}},[f,u,r,g]),w=!p&&!g;return e`
        <div class="settings-section">
            <h3>MCP</h3>
            ${p&&e`<p class="settings-hint" role="status">Loading MCP connections…</p>`}
            ${k&&e`<p class="mcp-notice settings-error" role="alert">${k}</p>`}
            ${P?.diagnostics?.length>0&&e`
                <div class="settings-row settings-dense-row" style="display:block">
                    <strong>Imported disabled entries</strong>
                    <ul style="margin:8px 0 0 1.2rem; padding:0;">
                        ${P.diagnostics.map((s)=>e`<li key=${s.name}>
                            <strong>${s.name}</strong>: ${s.fields?.join(", ")||"fields"} — ${s.reason}
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
                    ${O.map((s)=>e`
                        <button
                            type="button"
                            key=${s.id}
                            class=${`settings-btn ${S===s.id?"primary":""}`}
                            onClick=${()=>E(s.id)}
                            disabled=${g}
                        >
                            ${s.name||"Unnamed"}
                        </button>
                    `)}
                    <button type="button" class="settings-btn" onClick=${()=>E(null)} disabled=${g}>New connection</button>
                </div>
            </div>

            <div class="settings-row settings-dense-row settings-dense-row-checkbox">
                <label class="settings-dense-check" for=${c("new-connection-toggle")}>
                    <input id=${c("new-connection-toggle")} type="checkbox" checked=${Boolean(d.enabled)} disabled=${!w} onChange=${(s)=>b((a)=>({...a,enabled:s.currentTarget.checked}))} />
                    <span>Enabled</span>
                </label>
            </div>

            <div class="settings-row settings-dense-row">
                <label for=${c("name")}>Name</label>
                <input id=${c("name")} type="text" value=${d.name||""} disabled=${!w} onInput=${(s)=>b((a)=>({...a,name:s.currentTarget.value}))} placeholder="my-mcp-server" />
            </div>

            <div class="settings-row settings-dense-row">
                <label for=${c("workspace")}>Workspace</label>
                <input id=${c("workspace")} type="text" value=${d.workspaceId||x||"workspace"} disabled=${!0} />
            </div>

            <div class="settings-row settings-dense-row">
                <label for=${c("grant-mode")}>Access</label>
                <select id=${c("grant-mode")} value=${d.grantMode} disabled=${!w} onChange=${(s)=>b((a)=>({...a,grantMode:s.currentTarget.value}))}>
                    <option value="workspace">This workspace, all Agents</option><option value="agents">Selected Agents in this workspace</option><option value="all">All workspaces and Agents</option>
                </select>
            </div>
            <div class="settings-row settings-dense-row">
                <label for=${c("agentIds")}>Selected Agents</label>
                <div id=${c("agentIds")} style="display:flex; flex-wrap:wrap; gap:8px; min-height:32px;">
                    ${j.length===0?e`<span class="settings-hint" style="margin:0">No agents reported.</span>`:j.map((s)=>{let a=d.agentIds.includes(s.id);return e`
                        <label key=${s.id} class="settings-dense-check" style="padding:4px 8px; border:1px solid var(--border-color, rgba(255,255,255,0.12)); border-radius:999px;">
                            <input type="checkbox" checked=${a} disabled=${!w||d.grantMode!=="agents"} onChange=${(I)=>{let T=I.currentTarget.checked;b((C)=>({...C,agentIds:T?Array.from(new Set([...C.agentIds,s.id])):C.agentIds.filter((G)=>G!==s.id)}))}} />
                            <span>${s.label||s.id}</span>
                        </label>
                    `})}
                </div>
            </div>

            <div class="settings-row settings-dense-row">
                <label for=${c("transport")}>Transport</label>
                <select id=${c("transport")} value=${d.transport||"http"} disabled=${!w} onChange=${(s)=>b((a)=>({...a,transport:s.currentTarget.value}))}>
                    <option value="http">HTTP</option>
                    <option value="stdio">stdio</option>
                </select>
            </div>

            <div class="settings-row settings-dense-row">
                <label for=${c("url")}>URL</label>
                <input id=${c("url")} type="text" value=${d.url||""} disabled=${!w||d.transport!=="http"} onInput=${(s)=>b((a)=>({...a,url:s.currentTarget.value}))} placeholder="https://example.test/mcp" />
            </div>

            <div class="settings-row settings-dense-row">
                <label for=${c("auth")}>Authentication</label>
                <select id=${c("auth")} value=${d.auth||"bearer"} disabled=${!w||d.transport!=="http"} onChange=${(s)=>b((a)=>({...a,auth:s.currentTarget.value}))}>
                    <option value="none">No authentication</option>
                    <option value="bearer">Bearer token</option>
                    <option value="oauth">OAuth</option>
                </select>
            </div>

            ${d.transport==="http"&&e`
                <div class="settings-row settings-dense-row settings-dense-row-checkbox">
                    <label class="settings-dense-check" for=${c("allow-http")}>
                        <input id=${c("allow-http")} type="checkbox" checked=${Boolean(d.allowHttp)} disabled=${!w} onChange=${(s)=>b((a)=>({...a,allowHttp:s.currentTarget.checked}))} />
                        <span>Allow insecure HTTP</span>
                    </label>
                </div>
            `}

            ${d.transport==="http"&&d.auth==="bearer"&&e`
                <div class="settings-row settings-dense-row">
                    <label for=${c("bearer-keychain")}>Bearer token keychain reference</label>
                    <input id=${c("bearer-keychain")} type="text" value=${d.bearerTokenKeychain||""} disabled=${!w} onInput=${(s)=>b((a)=>({...a,bearerTokenKeychain:s.currentTarget.value}))} placeholder="my-server/token" />
                </div>
            `}

            ${d.transport==="http"&&d.auth==="oauth"&&e`
                <div class="settings-row settings-dense-row">
                    <label for=${c("oauth-client-id")}>OAuth client ID</label>
                    <input id=${c("oauth-client-id")} type="text" value=${d.oauth?.clientId||""} disabled=${!w} onInput=${(s)=>b((a)=>({...a,oauth:{...a.oauth,clientId:s.currentTarget.value}}))} placeholder="client-id" />
                </div>
                <div class="settings-row settings-dense-row">
                    <label for=${c("oauth-scope")}>OAuth scope</label>
                    <input id=${c("oauth-scope")} type="text" value=${d.oauth?.scope||""} disabled=${!w} onInput=${(s)=>b((a)=>({...a,oauth:{...a.oauth,scope:s.currentTarget.value}}))} placeholder="mcp.read mcp.write" />
                </div>
                <div class="settings-row settings-dense-row">
                    <label for=${c("oauth-secret-keychain")}>OAuth client secret keychain</label>
                    <input id=${c("oauth-secret-keychain")} type="text" value=${d.oauth?.clientSecretKeychain||""} disabled=${!w} onInput=${(s)=>b((a)=>({...a,oauth:{...a.oauth,clientSecretKeychain:s.currentTarget.value}}))} placeholder="my-server/oauth-secret" />
                </div>
                <div class="settings-row settings-dense-row" style="gap:8px; flex-wrap:wrap;">
                    <button type="button" class="settings-btn" disabled=${!u||g} onClick=${W}>Sign in</button>
                    <button type="button" class="settings-btn" disabled=${!u||g} onClick=${_}>Sign out</button>
                </div>
            `}

            ${d.transport==="stdio"&&e`
                <div class="settings-row settings-dense-row">
                    <label for=${c("stdio-command")}>Command</label>
                    <input id=${c("stdio-command")} type="text" value=${d.commandText||""} disabled=${!w} onInput=${(s)=>b((a)=>({...a,commandText:s.currentTarget.value}))} placeholder='["bun","run","server.ts"]' />
                </div>
                <div class="settings-row settings-dense-row">
                    <label for=${c("workdir")}>Work directory</label>
                    <input id=${c("workdir")} type="text" value=${d.workdir||""} disabled=${!w} onInput=${(s)=>b((a)=>({...a,workdir:s.currentTarget.value}))} placeholder="/workspace/project" />
                </div>
                <div class="settings-row settings-dense-row">
                    <label for=${c("stdio-env")}>Environment JSON</label>
                    <textarea id=${c("stdio-env")} rows="3" value=${d.envText||""} disabled=${!w} onInput=${(s)=>b((a)=>({...a,envText:s.currentTarget.value}))} placeholder='{"KEY":"keychain:server/token"}'></textarea>
                </div>
            `}

            <div class="settings-row settings-dense-row">
                <label>Timeout</label>
                <${m}
                    id=${c("timeout")}
                    label="MCP timeout seconds"
                    value=${Number(d.timeoutSeconds||30)}
                    min=${1}
                    max=${300}
                    step=${5}
                    fallback=${30}
                    width="88px"
                    disabled=${!w}
                    onChange=${(s)=>b((a)=>({...a,timeoutSeconds:Number(s||30)}))}
                />
                <span class="settings-hint" style="margin:0">Seconds</span>
            </div>

            <div class="settings-row settings-dense-row">
                <label>Recall</label>
                <div style="display:flex; flex-wrap:wrap; gap:8px; align-items:center;">
                    <select value=${String(d.recall?.mode||"off")} disabled=${!w} onChange=${(s)=>b((a)=>({...a,recall:{...A(a.recall),mode:s.currentTarget.value}}))}>
                        <option value="off">Off</option>
                        <option value="observe">Observe</option>
                        <option value="active">Active</option>
                    </select>

                </div>
            </div>
            <div class="settings-row settings-dense-row">
                <label>Retention</label>
                <${m}
                    id=${c("recall-retention")}
                    label="Recall retention days"
                    value=${Number(d.recall?.maxAgeDays||7)}
                    min=${1}
                    max=${90}
                    fallback=${7}
                    width="88px"
                    disabled=${!w}
                    onChange=${(s)=>b((a)=>({...a,recall:{...A(a.recall),maxAgeDays:Number(s||7)}}))}
                />
                <span class="settings-hint" style="margin:0">days</span>
            </div>
            <div class="settings-row settings-dense-row">
                <label>Recall size</label>
                <${m}
                    id=${c("recall-max-items")}
                    label="Recall max items"
                    value=${Number(d.recall?.maxItems||128)}
                    min=${1}
                    max=${256}
                    fallback=${128}
                    width="90px"
                    disabled=${!w}
                    onChange=${(s)=>b((a)=>({...a,recall:{...A(a.recall),maxItems:Number(s||128)}}))}
                />
                <span class="settings-hint" style="margin:0">items</span>
            </div>
            <div class="settings-row settings-dense-row">
                <label>Recall max bytes</label>
                <${m}
                    id=${c("recall-max-bytes")}
                    label="Recall max bytes"
                    value=${Number(d.recall?.maxBytes||8388608)}
                    min=${4096}
                    max=${16777216}
                    step=${1024}
                    fallback=${8388608}
                    width="115px"
                    disabled=${!w}
                    onChange=${(s)=>b((a)=>({...a,recall:{...A(a.recall),maxBytes:Number(s||8388608)}}))}
                />
                <span class="settings-hint" style="margin:0">bytes</span>
            </div>

            <div class="settings-row settings-dense-row" style="gap:8px; flex-wrap:wrap;">
                <button type="button" class="settings-btn" disabled=${!w||!d.name} onClick=${U}>${g?"Saving…":"Save connection"}</button>
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
                        <input id=${c("approve-reuse")} type="checkbox" checked=${Boolean(d.approveCredentialReuse)} disabled=${!w} onChange=${(s)=>b((a)=>({...a,approveCredentialReuse:s.currentTarget.checked}))} />
                        <span>Approve credential reuse for this endpoint or command</span>
                    </label>
                </div>
            `}
            ${K&&e`<p class="settings-hint">Choose an MCP connection or create a new one.</p>`}
        </div>
    `}export{se as McpSection};

//# debugId=A858ECA0FA1BCC9E64756E2164756E21
//# sourceMappingURL=mcp-we5z85g3.js.map
