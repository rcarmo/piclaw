import{t,o,n,i,r,e}from"./app-863dk79s.js";import{m}from"./app-ajhhww1w.js";import{f}from"./app-2r0psahv.js";function Y(l,c=[]){let h=l.trim();if(!h)return c;try{let b=JSON.parse(h);if(!Array.isArray(b)||b.some((p)=>typeof p!=="string"))throw Error("Command must be a JSON string array.");return b}catch{throw Error("Command must be a valid JSON string array.")}}function G(l,c={}){let h=l.trim();if(!h)return c;try{let b=JSON.parse(h);if(!b||typeof b!=="object"||Array.isArray(b))throw Error("Environment must be a JSON object.");let p={};for(let[y,T]of Object.entries(b)){if(typeof T!=="string")throw Error("Environment values must be strings.");p[y]=T}return p}catch{throw Error("Environment must be a valid JSON object with string values.")}}var Q=()=>globalThis.crypto?.randomUUID?globalThis.crypto.randomUUID():`mcp-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;function B(l=null){let c=l||{};return{id:c.id||Q(),name:c.name||"",enabled:c.enabled!==!1,transport:c.transport||"http",url:c.url||"",auth:c.auth||"bearer",allowHttp:Boolean(c.allowHttp),timeoutSeconds:Number(c.timeoutSeconds||30),revision:Number(c.revision||0),hasSavedCredentials:Boolean(c.hasSavedCredentials),needsCredentialApproval:Boolean(c.needsCredentialApproval),approveCredentialReuse:!1,status:c.status||null,oauth:{clientId:c.oauth?.clientId||"",scope:c.oauth?.scope||"",clientSecretKeychain:""},bearerTokenKeychain:"",command:Array.isArray(c.command)?[...c.command]:[],commandText:Array.isArray(c.command)?JSON.stringify(c.command):"",workdir:c.workdir||"",env:c.env&&typeof c.env==="object"?{...c.env}:{},envText:c.env&&typeof c.env==="object"?JSON.stringify(c.env):"",clearEnvironment:!1,removeEnvironment:[],environmentNames:Array.isArray(c.environmentNames)?c.environmentNames:[]}}function V(l){let c={id:l.id,name:String(l.name||"").trim(),enabled:Boolean(l.enabled),transport:l.transport||"http",url:String(l.url||"").trim(),auth:l.auth||"bearer",allowHttp:Boolean(l.allowHttp),timeoutSeconds:Number(l.timeoutSeconds||30)};if(c.transport==="stdio"){let h=Y(String(l.commandText||""),Array.isArray(l.command)?l.command:[]);if(h.length)c.command=h;if(String(l.workdir||"").trim())c.workdir=String(l.workdir||"").trim();let b=G(String(l.envText||""),l.env||{}),p={};for(let[y,T]of Object.entries(b))if(typeof T==="string")p[y]=T;else if(T!==void 0&&T!==null)p[y]=String(T);if(!l.clearEnvironment&&(String(l.envText||"").trim()||Object.keys(p).length))c.env=p}else{if(c.url=String(l.url||"").trim(),l.auth==="bearer"&&String(l.bearerTokenKeychain||"").trim())c.bearerTokenKeychain=String(l.bearerTokenKeychain||"").trim();if(l.auth==="oauth"){let h={},b=String(l.oauth?.clientId||"").trim(),p=String(l.oauth?.scope||"").trim(),y=String(l.oauth?.clientSecretKeychain||"").trim();if(b)h.clientId=b;if(p)h.scope=p;if(y)h.clientSecretKeychain=y;if(Object.keys(h).length)c.oauth=h}}return c}function X(l){if(!l||typeof l!=="object")return"Unknown status";let c=typeof l.state==="string"?l.state:"unknown",h=typeof l.message==="string"&&l.message.trim()?` · ${l.message}`:"",b=Array.isArray(l.tools)&&l.tools.length?` · ${l.tools.length} tools`:"";return`${c}${h}${b}`}function te({setStatus:l}={}){let c=f("mcp"),[h,b]=t(!0),[p,y]=t(!1),[T,S]=t(""),[E,D]=t([]),[j,K]=t(null),[I,N]=t(null),[d,w]=t(()=>B()),O=n(null),H=n(void 0),[U,P]=t(!1),A=O.current!==null&&JSON.stringify(d)!==JSON.stringify(O.current),M=()=>!A||confirm("Discard unsaved MCP connection changes?"),L=(a)=>{let s=B(a);H.current=a,O.current=s,w(s),P(!1)},u=i(()=>E.find((a)=>a.id===I)||null,[E,I]),k=r(async(a=!1)=>{b(!0),S("");try{let s=await fetch("/agent/settings/mcp",{credentials:"same-origin",cache:"no-store"}),g=await s.json().catch(()=>({}));if(!s.ok||!g?.ok)throw Error(g?.error||`MCP settings failed (${s.status})`);let C=Array.isArray(g.connections)?g.connections:[];if(a)O.current=null;D(C),K(g.migration||null),N((x)=>{if(x&&C.some((R)=>R.id===x))return x;return C[0]?.id||null})}catch(s){let g=s instanceof Error?s.message:String(s);S(g),l?.(g,"error")}finally{b(!1)}},[l]);o(()=>{k()},[k]),o(()=>{if(!O.current||!A&&H.current!==u)L(u)},[u]);let J=(a)=>{if(!M())return!1;return N(a?.id??null),L(a??null),S(""),!0},q=r(async()=>{if(!String(d.name||"").trim()){S("Connection name is required."),l?.("Connection name is required.","error");return}if(d.transport==="http"&&!String(d.url||"").trim()){S("HTTP MCP connections need an endpoint URL."),l?.("HTTP MCP connections need an endpoint URL.","error");return}y(!0),S(""),l?.("Saving MCP connection…","info");try{let s=V(d),g=[];if(s.transport==="stdio"){if(!s.workdir)g.push("workdir");if(d.clearEnvironment)g.push("environment")}else if(s.auth==="oauth"&&!s.oauth?.scope)g.push("oauthScope");let C=await fetch("/agent/settings/mcp",{method:"POST",credentials:"same-origin",headers:{"Content-Type":"application/json"},body:JSON.stringify({action:"save",connection:s,expectedRevision:Number(d.revision||0),...g.length?{clear:g}:{},...s.transport==="stdio"&&!s.env&&!d.clearEnvironment&&d.removeEnvironment.length?{removeEnvironment:d.removeEnvironment}:{},approveCredentialReuse:Boolean(d.approveCredentialReuse)})}),x=await C.json().catch(()=>({}));if(!C.ok||!x?.ok){P(C.status===409);let R=x?.error||"MCP connection could not be saved.";throw Error(R)}l?.("MCP connection saved.","success"),N(x?.connection?.id||s.id||I||null),await k(!0)}catch(s){let g=s instanceof Error?s.message:String(s);S(g),l?.(g,"error")}finally{y(!1)}},[d,k,u,I,l]),z=r(async()=>{if(!u||!M())return;y(!0);try{let a=await fetch("/agent/settings/mcp",{method:"POST",credentials:"same-origin",headers:{"Content-Type":"application/json"},body:JSON.stringify({action:"remove",id:u.id,expectedRevision:Number(u.revision||0)})}),s=await a.json().catch(()=>({}));if(!a.ok||!s?.ok)throw Error(s?.error||"Could not remove the MCP connection.");N(null),l?.("MCP connection removed.","success"),await k(!0)}catch(a){let s=a instanceof Error?a.message:String(a);S(s),l?.(s,"error")}finally{y(!1)}},[k,u,l,A]),F=r(async()=>{if(!u)return;y(!0);try{let a=await fetch("/agent/settings/mcp",{method:"POST",credentials:"same-origin",headers:{"Content-Type":"application/json"},body:JSON.stringify({action:"reconnect",id:u.id})}),s=await a.json().catch(()=>({}));if(!a.ok||!s?.ok)throw Error(s?.error||"Could not reconnect the MCP connection.");l?.("Reconnect requested.","success"),await k()}catch(a){let s=a instanceof Error?a.message:String(a);S(s),l?.(s,"error")}finally{y(!1)}},[k,u,l]),_=r(async()=>{if(!u||p||!M())return;y(!0);try{let a=await fetch("/agent/settings/mcp",{method:"POST",credentials:"same-origin",headers:{"Content-Type":"application/json"},body:JSON.stringify({action:"sign_in",id:u.id})}),s=await a.json().catch(()=>({}));if(!a.ok||!s?.ok)throw Error(s?.error||"OAuth sign-in was not available.");if(s.authorizationUrl)window.location.assign(s.authorizationUrl);else l?.(s.message||"Already signed in.","success"),await k()}catch(a){let s=a instanceof Error?a.message:String(a);S(s),l?.(s,"error")}finally{y(!1)}},[u,l,p,k,A]),W=r(async()=>{if(!u||p)return;y(!0);try{let a=await fetch("/agent/settings/mcp",{method:"POST",credentials:"same-origin",headers:{"Content-Type":"application/json"},body:JSON.stringify({action:"sign_out",id:u.id,expectedRevision:u.revision})}),s=await a.json().catch(()=>({}));if(!a.ok||!s?.ok)throw Error(s?.error||"OAuth sign-out failed.");l?.("OAuth sign-out completed.","success"),await k()}catch(a){let s=a instanceof Error?a.message:String(a);S(s),l?.(s,"error")}finally{y(!1)}},[k,u,l,p]),v=!h&&!p;return e`
        <div class="settings-section">
            <h3>MCP</h3>
            ${h&&e`<p class="settings-hint" role="status">Loading MCP connections…</p>`}
            ${T&&e`<p class="mcp-notice settings-error" role="alert">${T}</p>`}
            ${U&&e`<button type="button" class="settings-btn" disabled=${p||h} onClick=${()=>{if(M())k(!0)}}>Reload saved connection</button>`}
            ${j?.diagnostics?.length>0&&e`
                <div class="settings-row settings-dense-row" style="display:block">
                    <strong>Imported disabled entries</strong>
                    <ul style="margin:8px 0 0 1.2rem; padding:0;">
                        ${j.diagnostics.map((a)=>e`<li key=${a.name}>
                            <strong>${a.name}</strong>: ${a.fields?.join(", ")||"fields"} — ${a.reason}
                        </li>`)}
                    </ul>
                </div>
            `}

            <div class="settings-row settings-dense-row">
                <label for=${c("server")}>Server</label>
                <select id=${c("server")} value=${I??""} disabled=${!v||!E.length} onChange=${(a)=>{let s=a.currentTarget;if(!J(E.find((g)=>g.id===s.value)))s.value=I??""}}>
                    <option value="" disabled>${E.length?"Choose a server":"No servers configured"}</option>
                    ${E.map((a)=>e`<option key=${a.id} value=${a.id}>${a.name}${E.some((s)=>s!==a&&s.name===a.name)?" ("+a.id+")":""}${a.enabled?"":" — Disabled"}</option>`)}
                </select>
                <button type="button" class="settings-btn" onClick=${()=>J(null)} disabled=${!v}>Add server</button>
            </div>
            <p class="settings-hint">Enabled servers are available in Code Mode across this instance.</p>
            <h4>${u?"Server settings: "+u.name:"New server"}</h4>
            <div class="settings-row settings-dense-row settings-dense-row-checkbox">
                <label class="settings-dense-check" for=${c("new-connection-toggle")}>
                    <input id=${c("new-connection-toggle")} type="checkbox" checked=${Boolean(d.enabled)} disabled=${!v} onChange=${(a)=>w((s)=>({...s,enabled:a.currentTarget.checked}))} />
                    <span>Enabled</span>
                </label>
            </div>

            <div class="settings-row settings-dense-row">
                <label for=${c("name")}>Name</label>
                <input id=${c("name")} type="text" value=${d.name||""} disabled=${!v} onInput=${(a)=>w((s)=>({...s,name:a.currentTarget.value}))} placeholder="my-mcp-server" />
            </div>

            <div class="settings-row settings-dense-row">
                <label for=${c("transport")}>Transport</label>
                <select id=${c("transport")} value=${d.transport||"http"} disabled=${!v} onChange=${(a)=>w((s)=>({...s,transport:a.currentTarget.value}))}>
                    <option value="http">HTTP</option>
                    <option value="stdio">stdio</option>
                </select>
            </div>

            <div class="settings-row settings-dense-row">
                <label for=${c("url")}>URL</label>
                <input id=${c("url")} type="text" value=${d.url||""} disabled=${!v||d.transport!=="http"} onInput=${(a)=>w((s)=>({...s,url:a.currentTarget.value}))} placeholder="https://example.test/mcp" />
            </div>

            <div class="settings-row settings-dense-row">
                <label for=${c("auth")}>Authentication</label>
                <select id=${c("auth")} value=${d.auth||"bearer"} disabled=${!v||d.transport!=="http"} onChange=${(a)=>w((s)=>({...s,auth:a.currentTarget.value}))}>
                    <option value="none">No authentication</option>
                    <option value="bearer">Bearer token</option>
                    <option value="oauth">OAuth</option>
                </select>
            </div>

            ${d.transport==="http"&&e`
                <div class="settings-row settings-dense-row settings-dense-row-checkbox">
                    <label class="settings-dense-check" for=${c("allow-http")}>
                        <input id=${c("allow-http")} type="checkbox" checked=${Boolean(d.allowHttp)} disabled=${!v} onChange=${(a)=>w((s)=>({...s,allowHttp:a.currentTarget.checked}))} />
                        <span>Allow insecure HTTP</span>
                    </label>
                </div>
            `}

            ${d.transport==="http"&&d.auth==="bearer"&&e`
                <div class="settings-row settings-dense-row">
                    <label for=${c("bearer-keychain")}>Bearer token keychain reference</label>
                    <input id=${c("bearer-keychain")} type="text" value=${d.bearerTokenKeychain||""} disabled=${!v} onInput=${(a)=>w((s)=>({...s,bearerTokenKeychain:a.currentTarget.value}))} placeholder="my-server/token" />
                </div>
            `}

            ${d.transport==="http"&&d.auth==="oauth"&&e`
                <div class="settings-row settings-dense-row">
                    <label for=${c("oauth-client-id")}>OAuth client ID</label>
                    <input id=${c("oauth-client-id")} type="text" value=${d.oauth?.clientId||""} disabled=${!v} onInput=${(a)=>w((s)=>({...s,oauth:{...s.oauth,clientId:a.currentTarget.value}}))} placeholder="client-id" />
                </div>
                <div class="settings-row settings-dense-row">
                    <label for=${c("oauth-scope")}>OAuth scope</label>
                    <input id=${c("oauth-scope")} type="text" value=${d.oauth?.scope||""} disabled=${!v} onInput=${(a)=>w((s)=>({...s,oauth:{...s.oauth,scope:a.currentTarget.value}}))} placeholder="mcp.read mcp.write" />
                </div>
                <div class="settings-row settings-dense-row">
                    <label for=${c("oauth-secret-keychain")}>OAuth client secret keychain</label>
                    <input id=${c("oauth-secret-keychain")} type="text" value=${d.oauth?.clientSecretKeychain||""} disabled=${!v} onInput=${(a)=>w((s)=>({...s,oauth:{...s.oauth,clientSecretKeychain:a.currentTarget.value}}))} placeholder="my-server/oauth-secret" />
                </div>
                <div class="settings-row settings-dense-row" style="gap:8px; flex-wrap:wrap;">
                    <button type="button" class="settings-btn" disabled=${!u||p} onClick=${_}>Sign in</button>
                    <button type="button" class="settings-btn" disabled=${!u||p} onClick=${W}>Sign out</button>
                </div>
            `}

            ${d.transport==="stdio"&&e`
                <div class="settings-row settings-dense-row">
                    <label for=${c("stdio-command")}>Command</label>
                    <input id=${c("stdio-command")} type="text" value=${d.commandText||""} disabled=${!v} onInput=${(a)=>w((s)=>({...s,commandText:a.currentTarget.value}))} placeholder='["bun","run","server.ts"]' />
                </div>
                <div class="settings-row settings-dense-row">
                    <label for=${c("workdir")}>Work directory</label>
                    <input id=${c("workdir")} type="text" value=${d.workdir||""} disabled=${!v} onInput=${(a)=>w((s)=>({...s,workdir:a.currentTarget.value}))} placeholder="/workspace/project" />
                </div>
                <div class="settings-row settings-dense-row">
                    <label for=${c("stdio-env")}>Environment JSON</label>
                    <textarea id=${c("stdio-env")} rows="3" value=${d.envText||""} disabled=${!v||d.clearEnvironment} onInput=${(a)=>w((s)=>({...s,envText:a.currentTarget.value}))} placeholder='{"KEY":"keychain:server/token"}'></textarea>
                    <span class="settings-hint">Leave blank to keep the saved environment. Enter a JSON object to replace it.</span>
                    ${d.environmentNames.length>0&&e`
                        <label class="settings-dense-check"><input type="checkbox" disabled=${!v} checked=${d.clearEnvironment} onChange=${(a)=>w((s)=>({...s,clearEnvironment:a.currentTarget.checked}))} /> Clear saved environment</label>
                        <details><summary>Remove individual saved entries</summary>
                            ${d.environmentNames.map((a)=>e`<label key=${a} class="settings-dense-check"><input type="checkbox" disabled=${!v||d.clearEnvironment||Boolean(d.envText.trim())} checked=${d.removeEnvironment.includes(a)} onChange=${(s)=>w((g)=>({...g,removeEnvironment:s.currentTarget.checked?[...g.removeEnvironment,a]:g.removeEnvironment.filter((C)=>C!==a)}))} /> Remove ${a}</label>`)}
                        </details>
                    `}
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
                    disabled=${!v}
                    onChange=${(a)=>w((s)=>({...s,timeoutSeconds:Number(a||30)}))}
                />
                <span class="settings-hint" style="margin:0">Seconds</span>
            </div>

            <div class="settings-row settings-dense-row" style="gap:8px; flex-wrap:wrap;">
                <button type="button" class="settings-btn" disabled=${!v||!d.name} onClick=${q}>${p?"Saving…":"Save connection"}</button>
                <button type="button" class="settings-btn" disabled=${!u||p} onClick=${F}>Reconnect</button>
                <button type="button" class="settings-btn danger" disabled=${!u||p} onClick=${z}>Remove</button>
            </div>

            ${u?.status&&e`
                <div class="settings-row" style="display:block;" role="status">
                    <strong>Status</strong>
                    <p class="settings-hint" style="margin:8px 0 0 0">${X(u.status)}</p>
                </div>
            `}
            ${u?.needsCredentialApproval&&e`
                <div class="settings-row settings-dense-row settings-dense-row-checkbox">
                    <label class="settings-dense-check" for=${c("approve-reuse")}>
                        <input id=${c("approve-reuse")} type="checkbox" checked=${Boolean(d.approveCredentialReuse)} disabled=${!v} onChange=${(a)=>w((s)=>({...s,approveCredentialReuse:a.currentTarget.checked}))} />
                        <span>Approve credential reuse for this endpoint or command</span>
                    </label>
                </div>
            `}
        </div>
    `}export{te as McpSection};

//# debugId=50967AFE67C0D0F564756E2164756E21
//# sourceMappingURL=mcp-jbhezw34.js.map
