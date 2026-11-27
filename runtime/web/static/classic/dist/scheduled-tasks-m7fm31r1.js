import{t,o,i,r,e}from"./app-863dk79s.js";import{Gt,Jt}from"./app-z0yp0vw5.js";import{l,s}from"./app-wq98hqjx.js";var G=["all","active","paused","completed"];function p(n){if(!n)return"—";let u=new Date(n);if(Number.isNaN(u.getTime()))return n;return u.toLocaleString(void 0,{month:"short",day:"numeric",hour:"2-digit",minute:"2-digit"})}function K(n){let u=Number(n);if(!Number.isFinite(u))return"—";if(u<1000)return`${Math.round(u)}ms`;return`${(u/1000).toFixed(u<1e4?1:0)}s`}function A(n){if(!n)return"—";if(n.schedule_type==="once")return`once · ${p(n.schedule_value)}`;if(n.schedule_type==="interval")return`interval · ${n.schedule_value}`;if(n.schedule_type==="cron")return`cron · ${n.schedule_value}`;return`${n.schedule_type||"schedule"} · ${n.schedule_value||"—"}`}function E(n){let u=n?.task_kind||"agent";return u==="internal"?l("settings.tasks.internalProtected"):u}function M(n){return(n?.task_kind||"agent")==="internal"}function Q(n){if(!n)return"";let u=String(n).replace(/\s+/g," ").trim();return u.length>180?`${u.slice(0,179)}…`:u}function m({children:n,type:u="neutral"}){return e`<span class=${`settings-task-pill settings-task-pill-${u}`}>${n}</span>`}function V({task:n}){let{t:u}=s(),d=Array.isArray(n?.recent_run_logs)?n.recent_run_logs:[];if(!d.length)return e`<p class="settings-hint">${u("settings.tasks.noRunLogs")}</p>`;return e`
        <div class="settings-task-run-list">
            ${d.map((g)=>e`
                <div class=${`settings-task-run-row settings-task-run-${g.status||"unknown"}`}>
                    <div class="settings-task-run-meta">
                        <${m} type=${g.status==="error"?"error":"success"}>${g.status||"unknown"}<//>
                        <span>${p(g.run_at)}</span>
                        <span>${K(g.duration_ms)}</span>
                    </div>
                    <div class="settings-task-run-summary">
                        ${g.error_summary||Q(g.error)||g.result_summary||g.result||u("settings.tasks.noSummary")}
                    </div>
                </div>
            `)}
        </div>
    `}function W({task:n,onAction:u}){let{t:d}=s();if(!n)return e`<div class="settings-task-detail-empty">${d("settings.tasks.selectPrompt")}</div>`;let g=M(n);return e`
        <div class="settings-task-detail">
            <div class="settings-task-detail-header">
                <div>
                    <h4>${n.summary||n.id}</h4>
                    <code>${n.id}</code>
                </div>
                <div class="settings-task-detail-actions">
                    ${n.status==="active"&&e`<button onClick=${()=>u("pause",n)}>${d("settings.tasks.pause")}</button>`}
                    ${n.status==="paused"&&e`<button onClick=${()=>u("resume",n)}>${d("settings.tasks.resume")}</button>`}
                    <button class="danger" onClick=${()=>u("delete",n)}>${d("settings.tasks.delete")}</button>
                </div>
            </div>
            <div class="settings-task-detail-grid">
                <span>${d("settings.tasks.status")}</span><strong>${n.status||"—"}</strong>
                <span>${d("settings.tasks.kind")}</span><strong>${E(n)}</strong>
                <span>${d("settings.tasks.schedule")}</span><strong>${A(n)}</strong>
                <span>${d("settings.tasks.nextRun")}</span><strong>${p(n.next_run)}</strong>
                <span>${d("settings.tasks.lastRun")}</span><strong>${p(n.last_run)}</strong>
                <span>${d("settings.tasks.lastResult")}</span><strong>${n.latest_run_log?.status||n.last_result||"—"}</strong>
                <span>${d("settings.tasks.chat")}</span><code>${n.chat_jid||"—"}</code>
                <span>${d("settings.tasks.model")}</span><code>${n.model||"default"}</code>
                ${n.cwd&&e`<span>${d("settings.tasks.cwd")}</span><code>${n.cwd}</code>`}
                ${n.timeout_sec&&e`<span>${d("settings.tasks.timeout")}</span><strong>${n.timeout_sec}s</strong>`}
                ${g&&e`<span>${d("settings.tasks.protection")}</span><strong>${d("settings.tasks.protectionHint")}</strong>`}
            </div>
            <div class="settings-task-command-block">
                <strong>${n.task_kind==="shell"?d("settings.tasks.command"):d("settings.tasks.prompt")}</strong>
                <pre>${n.command||n.prompt||n.command_summary||n.prompt_summary||n.summary||"—"}</pre>
            </div>
            <h4>${d("settings.tasks.recentRuns")}</h4>
            <${V} task=${n} />
        </div>
    `}function ss({filter:n="",setStatus:u}){let{t:d}=s(),[g,j]=t([]),[T,z]=t({active:0,paused:0,completed:0}),[b,H]=t("all"),[w,O]=t(""),[h,x]=t(!0),[_,I]=t(null),[S,P]=t(null),[L,R]=t(null),[N,D]=t(!1),v=r(async(a={})=>{x(!0),I(null);try{let c=await Gt({status:b,chatJid:w.trim()||void 0,limit:50,includeRunLogs:!0,runLogLimit:5});j(c.tasks||[]),z(c.counts||{active:0,paused:0,completed:0});let F=a.selectedId||S,f=(c.tasks||[]).find((k)=>k.id===F)||(c.tasks||[])[0]||null;P(f?.id||null),R(f)}catch(c){I(c?.message||d("settings.tasks.loadFailed"))}finally{x(!1)}},[b,w,S]);o(()=>{v()},[v]);let C=String(n||"").trim().toLowerCase(),y=i(()=>{if(!C)return g;return g.filter((a)=>[a.id,a.chat_jid,a.status,a.task_kind,a.schedule_type,a.schedule_value,a.summary,a.prompt_summary,a.command_summary,a.latest_run_log?.error_summary].some((c)=>String(c||"").toLowerCase().includes(C)))},[g,C]),J=r((a)=>{P(a?.id||null),R(a||null)},[]),U=r(async(a,c,F={})=>{if(!c||N)return;let f=M(c),k=c.summary||c.command_summary||c.prompt_summary||c.id,q=a==="delete"?d("settings.tasks.confirmDelete",{id:c.id})+`

${k}`:(a==="pause"?d("settings.tasks.confirmPause",{id:c.id}):d("settings.tasks.confirmResume",{id:c.id}))+`

${k}`;if(!window.confirm(q))return;if(f&&!window.confirm(d("settings.tasks.confirmProtected",{id:c.id,action:a})))return;D(!0),u?.(a==="delete"?d("settings.tasks.deleting",{id:c.id}):a==="pause"?d("settings.tasks.pausing",{id:c.id}):d("settings.tasks.resuming",{id:c.id}),"info");try{await Jt(a,c.id,{allowInternal:f,...F}),u?.(a==="delete"?d("settings.tasks.deletedToast",{id:c.id}):a==="pause"?d("settings.tasks.pausedToast",{id:c.id}):d("settings.tasks.resumedToast",{id:c.id}),"success"),await v({selectedId:a==="delete"?null:c.id})}catch(B){u?.(B?.message||d("settings.tasks.actionFailed",{action:a}),"error")}finally{D(!1)}},[N,v,u]);return e`
        <div class="settings-section settings-scheduled-tasks-section">
            <div class="settings-task-toolbar">
                <div class="settings-task-counts">
                    <${m} type="active">${d("settings.tasks.activeLabel")} ${T.active||0}<//>
                    <${m} type="paused">${d("settings.tasks.pausedLabel")} ${T.paused||0}<//>
                    <${m} type="completed">${d("settings.tasks.completedLabel")} ${T.completed||0}<//>
                </div>
                <div class="settings-task-filters">
                    <select value=${b} onChange=${(a)=>H(a.target.value)}>
                        ${G.map((a)=>e`<option value=${a}>${a==="all"?d("settings.tasks.allStatuses"):a}</option>`)}
                    </select>
                    <input type="text" placeholder=${d("settings.tasks.filterChatPlaceholder")} value=${w} onInput=${(a)=>O(a.target.value)} />
                    <button onClick=${()=>v()} disabled=${h}>${d("settings.tasks.refresh")}</button>
                </div>
            </div>

            ${h&&e`<div class="settings-loading settings-loading-pane"><span class="settings-spinner"></span><span>${d("settings.tasks.loading")}</span></div>`}
            ${_&&e`<div class="settings-error-state">${_}</div>`}
            ${!h&&!_&&g.length===0&&e`
                <div class="settings-empty-state">
                    <strong>${d("settings.tasks.noneFound")}</strong>
                    <p>${d("settings.tasks.noneFoundHint")}</p>
                </div>
            `}
            ${!h&&!_&&g.length>0&&e`
                <div class="settings-task-layout">
                    <div class="settings-task-list" role="listbox" aria-label=${d("settings.tasks.listLabel")}>
                        ${y.map((a)=>e`
                            <button class=${`settings-task-row ${a.id===S?"active":""}`} onClick=${()=>J(a)}>
                                <span class="settings-task-row-main">
                                    <strong>${a.summary||a.id}</strong>
                                    <span>${A(a)}</span>
                                </span>
                                <span class="settings-task-row-meta">
                                    <${m} type=${a.status||"neutral"}>${a.status}<//>
                                    <${m}>${E(a)}<//>
                                </span>
                                <span class="settings-task-row-times">${d("settings.tasks.next")} ${p(a.next_run)} · ${d("settings.tasks.last")} ${p(a.last_run)}${a.latest_run_log?.status?` · ${a.latest_run_log.status}`:""}</span>
                            </button>
                        `)}
                        ${y.length===0&&e`<p class="settings-hint">${d("settings.tasks.noMatch",{filter:n})}</p>`}
                    </div>
                    <${W} task=${L&&y.some((a)=>a.id===L.id)?L:y[0]} onAction=${U} />
                </div>
            `}
        </div>
    `}export{ss as ScheduledTasksSection};

//# debugId=E1650A2591B46AB864756E2164756E21
//# sourceMappingURL=scheduled-tasks-m7fm31r1.js.map
