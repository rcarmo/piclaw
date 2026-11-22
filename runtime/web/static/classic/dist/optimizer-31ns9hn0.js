import{t,o,n,e}from"./app-0h4wyc77.js";import{p}from"./app-yacmwv03.js";import{m}from"./app-q36g8ssr.js";var oe="/agent/addons/api/token-optimizer/config",G=[["off","Off"],["observe","Watch only"],["active","On"]],ie=[["generative","Generation model"],["classifier","Classifier"],["cascade","Classifier, then generation model"]],ne=(a)=>G.find(([k])=>k===a)?.[1]??"Off";function fe(a){if(!a.reduceOutputs||!a.offloadOutputs||a.pruning!=="propose"||a.savers.toolPrefilter||a.savers.localToolDrops||a.savers.novelty)return"custom";if(a.microSkills==="envfacts"&&a.toolJudge==="none"&&!a.autoToolPicks&&!a.outputSummaries&&!a.inferenceInObserve)return"basic";if(a.microSkills==="both"&&a.toolJudge==="generative")return"assisted";return"custom"}function me(a,k){let M=k==="basic";return{...a,reduceOutputs:!0,offloadOutputs:!0,pruning:"propose",microSkills:M?"envfacts":"both",toolJudge:M?"none":"generative",...M?{outputSummaries:!1,autoToolPicks:!1,inferenceInObserve:!1}:{},savers:{...a.savers,toolPrefilter:!1,localToolDrops:!1,novelty:!1}}}function ye(){let a=m("optimizer"),[k,M]=t(null),[O,I]=t(null),[B,Q]=t([]),[ae,V]=t(!1),[x,W]=t(""),[y,R]=t(!1),[X,j]=t(""),[Y,le]=t(""),[Z,re]=t(""),U=n((s)=>{if(!s?.ok||!s.config)throw Error(s?.error||"Optimisation settings unavailable");M(s),I(structuredClone(s.config)),Q(s.status??[]),V(!1)},[]),A=n(async()=>{R(!0),W(""),j("");try{let s=await fetch(oe),i=await s.json();if(!s.ok)throw Error(i?.error||"Optimisation settings unavailable");U(i)}catch(s){W(s instanceof Error?s.message:String(s))}finally{R(!1)}},[U]);o(()=>{A()},[A]);let H=O&&JSON.stringify(O)!==JSON.stringify(k.config),ce=()=>{if(!H||confirm("Discard unsaved optimisation settings and reload?"))A()},z=(s)=>s.split(".").reduce((i,d)=>i?.[d],O),N=(s,i)=>{j(""),I((d)=>{let r=structuredClone(d),u=s.split("."),c=r;for(let g of u.slice(0,-1))c=c[g]??={};return c[u.at(-1)]=i,r})},ee=async(s,i=!1,d="")=>{R(!0);let r=i?le:W,u=i?re:j;r(""),u("");try{let c=await fetch(oe,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(s)}),g=await c.json();if(!c.ok||!g?.ok)throw Error(g?.error||"Settings changed; reload before saving");if(i)Q(g.status??[]);else U(g);u(d)}catch(c){r(c instanceof Error?c.message:String(c))}finally{R(!1)}},de=()=>ee({config:O,expectedRevision:k.revision},!1,"Saved. Changes apply at the next eligible SDK boundary."),L=(s,i,d,r)=>{if(r&&!confirm(r))return;ee({action:i,agentId:s},!0,d)},D=(s,i,d,r,u,c="",g)=>e`
        <div class="settings-row settings-dense-row">
            <label for=${a(i)}>${s}</label>
            <select id=${a(i)} value=${d} disabled=${y} aria-describedby=${c?a(`${i}-help`):void 0} onChange=${(f)=>u(f.currentTarget.value)}>
                ${r.map(([f,v])=>e`<option value=${f} disabled=${f===g}>${v}</option>`)}
            </select>
            ${c&&e`<span id=${a(`${i}-help`)} class="settings-hint">${c}</span>`}
        </div>`,C=(s,i,d,r="")=>D(s,i,z(i)??"",d,(u)=>N(i,u),r),h=(s,i,d="")=>e`
        <div class="settings-row settings-dense-row settings-dense-row-checkbox">
            <label class="settings-dense-check" for=${a(i)}><input id=${a(i)} type="checkbox" checked=${Boolean(z(i))} disabled=${y} aria-describedby=${d?a(`${i}-help`):void 0} onChange=${(r)=>N(i,r.currentTarget.checked)} /><span>${s}</span></label>
            ${d&&e`<span id=${a(`${i}-help`)} class="settings-hint">${d}</span>`}
        </div>`,b=(s,i,d=1,r=1e5,u=1,c=1)=>e`
        <div class="settings-row settings-dense-row"><label for=${a(i)}>${s}</label><${p} id=${a(i)} label=${s} value=${z(i)/u} min=${d} max=${r} step=${c} disabled=${y} onChange=${(g)=>N(i,u===1?g:Math.round(g*u))} /></div>`,S=(s,i,d="chat",r="Use shared model",u="")=>{let c=z(i),g=c?JSON.stringify(c):"",f=k.models.filter((v)=>(v.type||"chat")===d).map((v)=>[JSON.stringify({provider:v.provider,id:v.id}),`${v.provider}/${v.id}`]);if(c&&!f.some(([v])=>v===g))f.unshift([g,`${c.provider}/${c.id} (unavailable)`]);return D(s,i,g,[["",r],...f],(v)=>N(i,v?JSON.parse(v):null),u)},w=(s,i)=>e`<details class="settings-optimizer-details"><summary>${s}</summary><div class="settings-optimizer-details-body">${i}</div></details>`;if(!O)return e`<div class="settings-section"><p class="settings-hint" role=${x?"alert":"status"}>${x||"Loading optimisation settings…"}</p>${x&&e`<div class="settings-row"><button type="button" disabled=${y} onClick=${A}>Retry</button></div>`}</div>`;let l=O.policy,J=l.enabled?l.mode:"off",F=l.oversightMode??"off",E=ae?"custom":fe(l),T=J!=="off",K=F!=="off",_=K&&l.loop==="judge",q=["both","distiller"].includes(l.microSkills),P=l.pruning!=="off"&&l.toolJudge!=="none",pe=T&&(q||P||l.offloadOutputs&&l.outputSummaries),ue=T&&(q||l.offloadOutputs&&l.outputSummaries||P&&l.toolJudge!=="classifier"),te=T&&P&&l.toolJudge!=="generative"||_&&l.judge!=="generative",ge=te||T&&l.pruning!=="off"&&(l.savers.toolPrefilter||l.savers.localToolDrops)||_&&l.savers.localLoop,se=B.find((s)=>s.accounting?.authPaused);return e`<div class="settings-section settings-dense-form settings-optimizer">
        <section class="settings-optimizer-group" aria-labelledby=${a("optimisation-heading")}>
            <h3 id=${a("optimisation-heading")}>Token optimisation</h3>
            ${D("Optimisation mode","mode",J,G,(s)=>{j(""),I((i)=>({...i,policy:{...i.policy,enabled:s!=="off",mode:s}}))},J==="off"?O.hasEnabled?"No new optimisation is applied.":"Start with Watch only. On becomes available after you save.":J==="observe"?"See what would change without applying it.":"Apply eligible changes on upcoming requests.",!O.hasEnabled?"active":void 0)}
            ${T&&e`
                ${D("Optimisation preset","preset",E,[["basic","Basic"],["assisted","Model-assisted"],["custom","Custom"]],(s)=>{if(V(s==="custom"),s!=="custom")j(""),I((i)=>({...i,policy:me(i.policy,s)}))},E==="basic"?"Learn from evidence, shorten output and suggest unused tools without extra optimisation model calls.":E==="assisted"?"Basic plus model-written facts and task-aware tool picks. These calls use the shared budget.":"Choose features below, or select Basic for a model-free starting point.")}
                ${E==="custom"&&e`
                    <h4>Tool output</h4>
                    ${h("Reduce test and compiler output","policy.reduceOutputs","Scripts keep full results.")}
                    ${h("Store long tool outputs","policy.offloadOutputs","Keep searchable copies and show a preview on eligible requests.")}
                    ${l.offloadOutputs&&h("Summarise stored outputs with a model","policy.outputSummaries","Sends output text to the selected model and may add time and cost.")}
                    <h4>Learned facts</h4>
                    ${C("Repository facts","policy.microSkills",[["off","Off"],["envfacts","From tool evidence"],["distiller","Model-written"],["both","Both"]])}
                    <h4>Tool selection</h4>
                    ${C("Unused tools","policy.pruning",[["off","Leave alone"],["propose","Suggest hiding"],["auto","Hide eligible tools automatically"]])}
                    ${l.pruning!=="off"&&C("Task-aware tool judge","policy.toolJudge",[["none","Off"],...ie])}
                `}
                ${ue&&S("Optimisation model","policy.generativeModel","chat","Choose a model","Shared generation model for facts, summaries and judges unless a task overrides it.")}
                ${P&&h("Pick tools before new prompts","policy.autoToolPicks","Can add a model call and invalidate the prompt cache.")}
                ${pe&&J==="observe"&&h("Allow optimisation model calls while watching","policy.inferenceInObserve","Off means Watch only makes no optimisation model calls.")}
                ${l.offloadOutputs&&w("Stored outputs",e`
                    <p class="settings-hint">Store eligible output when either threshold is exceeded.</p>
                    ${b("Size threshold (KiB)","policy.offload.bytes",1,256,1024,0.5)}
                    ${b("Line threshold","policy.offload.lines",10,5000)}
                    ${b("Keep copies (days)","policy.offload.retentionDays",1,30)}`)}
                ${E==="custom"&&w("Optimisation details",e`
                    ${l.microSkills!=="off"&&e`${b("Maximum learned facts","policy.maxFacts",1,100)}${b("Fact context token limit","policy.maxFactTokens",1,16000)}`}
                    ${q&&e`${b("Evidence checks between fact proposals","policy.proposeEvery",1,1000)}${h("Propose facts only on changed evidence","policy.savers.novelty")}${S("Fact writer","policy.models.proposer")}`}
                    ${l.pruning!=="off"&&e`${h("Local tool prefilter","policy.savers.toolPrefilter")}${h("Allow validated local tool drops","policy.savers.localToolDrops")}`}
                    ${P&&l.toolJudge!=="classifier"&&S("Tool judge model","policy.models.toolJudge")}
                    ${P&&l.toolJudge!=="generative"&&S("Tool classifier","policy.models.toolClassifier","classifier")}`)}
            `}
        </section>
        <section class="settings-optimizer-group" aria-labelledby=${a("oversight-heading")}>
            <h3 id=${a("oversight-heading")}>Task oversight</h3>
            ${C("Oversight mode","policy.oversightMode",G,F==="off"?"Independent of token optimisation.":F==="observe"?"Record advice without sending it.":"Send advice at a safe point in the current task.")}
            ${K&&e`
                ${h("Check task progress","policy.goalChecks","Local checks make no model calls.")}
                ${C("Loop checks","policy.loop",[["off","Off"],["rules","Local rules"],["judge","Model-assisted"]],"Model-assisted checks use the shared budget.")}
                ${l.loop!=="off"&&w("Oversight details",e`
                    ${C("When to step in","policy.level",[["conservative","Patiently"],["default","Normally"],["aggressive","Early"]])}
                    ${b("Maximum nudges per prompt","policy.redirects",1,10)}
                    ${_&&e`
                        ${C("Loop judge type","policy.judge",ie)}
                        ${l.judge!=="classifier"&&S("Loop judge model","policy.models.loopJudge")}
                        ${l.judge!=="classifier"&&!l.savers.templates&&S("Nudge writer","policy.models.writer")}
                        ${l.judge!=="generative"&&S("Loop classifier","policy.models.loopClassifier","classifier")}
                        ${F==="observe"&&h("Allow oversight model calls while watching","policy.oversightInferenceInObserve","Off means Watch only makes no oversight model calls.")}
                        ${l.goalChecks&&h("Share the active Plan item with the judge","policy.sharePlanWithJudge","Sends one bounded, redacted current-task item, not the whole Plan or prompt.")}
                        ${h("Use template nudges","policy.savers.templates")}
                        ${h("Reuse identical judgements","policy.savers.reuse")}
                        ${h("Compact repeated failures before judging","policy.savers.compact")}
                        ${h("Skip the judge when a run is clearly fine","policy.savers.localLoop")}
                        ${l.savers.localLoop&&h("Let a validated local classifier identify stuck runs","policy.savers.authorizeLocalStuck")}
                    `}`)}
            `}
        </section>
        ${(T||K)&&w("Shared models and limits",e`
            <p class="settings-hint">Optimisation and oversight model calls share these limits.</p>
            ${S("Shared generation model","policy.generativeModel","chat","None")}
            ${te&&S("Shared classifier model","policy.classifierModel","classifier","None")}
            ${b("Model calls per Agent session","policy.budget.callsPerSession")}
            ${b("Model calls per day","policy.budget.callsPerDay")}
            ${b("Response tokens per call","policy.budget.maxOutputTokens",1,32000)}
            ${b("Time limit per call (seconds)","policy.budget.deadlineMs",0.001,180,1000)}
            <div class="settings-row settings-dense-row"><label for=${a("cost-cap")}>Spending cap per session (USD)</label><input id=${a("cost-cap")} type="number" min="0" step="0.01" placeholder="No cap" value=${l.budget.maxCostPerSession??""} disabled=${y} onChange=${(s)=>N("policy.budget.maxCostPerSession",s.currentTarget.value===""?null:Number(s.currentTarget.value))} /></div>
            ${ge&&b("Model audit (%)","policy.savers.auditPercent",0,20)}
        `)}
        <div class="settings-optimizer-save">
            <div class="settings-row"><button type="button" disabled=${y||!H} onClick=${de}>Save settings</button><button type="button" disabled=${y} onClick=${ce}>Reload saved settings</button>${H&&e`<span class="settings-hint">Unsaved changes</span>`}</div>
            ${x&&e`<p class="settings-hint" role="alert">${x}</p>`}
            ${X&&e`<p class="settings-hint" role="status">${X}</p>`}
        </div>
        <section class="settings-optimizer-group settings-optimizer-activity" aria-labelledby=${a("activity-heading")}>
            <h3 id=${a("activity-heading")}>Agent activity</h3>
            <p class="settings-hint">Shows saved modes and recent activity. Maintenance does not save settings edits.</p>
            ${Y&&e`<p class="settings-hint" role="alert">${Y}</p>`}
            ${Z&&e`<p class="settings-hint" role="status">${Z}</p>`}
            ${se&&e`<div class="settings-row"><span class="settings-hint">Model calls are paused. Check provider sign-in under Models.</span><button type="button" disabled=${y} onClick=${()=>L(se.agentId,"retry_models","Model calls can resume.")}>Retry paused model calls</button></div>`}
            ${!B.length&&e`<p class="settings-hint">No optimiser activity yet.</p>`}
            ${B.map((s)=>{let i=s.hiddenTools??[],d=s.proposedTools??[],r=s.facts??[],u=s.nudges??[],c=i.length||s.factsInContext||r.length||s.hasRetainedCopies,g=`${s.label} · Optimisation ${ne(s.policy?.mode)} · Oversight ${ne(s.policy?.oversightMode)}`;return e`<div key=${s.agentId}>${w(g,e`
                    <p class="settings-hint">${s.accounting?.calls??0} / ${s.policy?.budget?.callsPerSession??k.config.policy.budget.callsPerSession} model calls this session · ${s.accounting?.dailyCalls??0} / ${s.policy?.budget?.callsPerDay??k.config.policy.budget.callsPerDay} today</p>
                    ${s.lastError&&e`<p class="settings-hint">${s.lastError}</p>`}
                    ${i.length||d.length?w("Tools",e`<p class="settings-hint">Hidden: ${i.join(", ")||"none"} · Suggested: ${d.join(", ")||"none"}</p>`):null}
                    ${r.length>0&&w(`Learned facts (${r.length})`,e`<ul>${r.map((f)=>e`<li>${f.claim||f.id}</li>`)}</ul>`)}
                    ${u.length>0&&w(`Recent nudges (${u.length})`,e`<ul>${u.map((f)=>e`<li>${f.status==="simulated"?"Would have sent":f.status==="queued"||f.status==="consumed"?"Sent":"Not sent"} · ${f.text||f.reason||"Loop check"}</li>`)}</ul>`)}
                    ${c?w("Maintenance",e`<div class="settings-row">
                        ${i.length>0&&e`<button type="button" disabled=${y} onClick=${()=>L(s.agentId,"restore","Hidden tools restored.")}>Restore hidden tools</button>`}
                        ${s.factsInContext>0&&e`<button type="button" disabled=${y} onClick=${()=>L(s.agentId,"remove_context","Learned context removed from this Agent.")}>Remove learned context</button>`}
                        ${r.length>0&&e`<button type="button" disabled=${y} onClick=${()=>L(s.agentId,"stale_facts","Shared facts marked stale.","Mark shared learned facts stale? Other Agents using the same facts are affected. History is unchanged.")}>Mark shared facts stale</button>`}
                        ${s.hasRetainedCopies&&e`<button type="button" disabled=${y} onClick=${()=>L(s.agentId,"forget_outputs","Retained copies forgotten for this Agent.","Forget this Agent’s retained output and MCP recall copies? Original committed history is unchanged.")}>Forget retained copies</button>`}
                    </div>`):null}
                `)}</div>`})}
        </section>
    </div>`}export{ye as OptimizerSection};

//# debugId=37B2E52E6C8A979B64756E2164756E21
//# sourceMappingURL=optimizer-31ns9hn0.js.map
