import{t,o,i,n,e}from"./app-0h4wyc77.js";import{Mt,Dt}from"./app-vvpb3dcy.js";import{l,s}from"./app-ahzvmhbs.js";var G=["all","active","paused","completed"];function p(a){if(!a)return"—";let u=new Date(a);if(Number.isNaN(u.getTime()))return a;return u.toLocaleString(void 0,{month:"short",day:"numeric",hour:"2-digit",minute:"2-digit"})}function K(a){let u=Number(a);if(!Number.isFinite(u))return"—";if(u<1000)return`${Math.round(u)}ms`;return`${(u/1000).toFixed(u<1e4?1:0)}s`}function A(a){if(!a)return"—";if(a.schedule_type==="once")return`once · ${p(a.schedule_value)}`;if(a.schedule_type==="interval")return`interval · ${a.schedule_value}`;if(a.schedule_type==="cron")return`cron · ${a.schedule_value}`;return`${a.schedule_type||"schedule"} · ${a.schedule_value||"—"}`}function E(a){let u=a?.task_kind||"agent";return u==="internal"?l("settings.tasks.internalProtected"):u}function M(a){return(a?.task_kind||"agent")==="internal"}function Q(a){if(!a)return"";let u=String(a).replace(/\s+/g," ").trim();return u.length>180?`${u.slice(0,179)}…`:u}function m({children:a,type:u="neutral"}){return e`<span class=${`settings-task-pill settings-task-pill-${u}`}>${a}</span>`}function V({task:a}){let{t:u}=s(),d=Array.isArray(a?.recent_run_logs)?a.recent_run_logs:[];if(!d.length)return e`<p class="settings-hint">${u("settings.tasks.noRunLogs")}</p>`;return e`
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
    `}function W({task:a,onAction:u}){let{t:d}=s();if(!a)return e`<div class="settings-task-detail-empty">${d("settings.tasks.selectPrompt")}</div>`;let g=M(a);return e`
        <div class="settings-task-detail">
            <div class="settings-task-detail-header">
                <div>
                    <h4>${a.summary||a.id}</h4>
                    <code>${a.id}</code>
                </div>
                <div class="settings-task-detail-actions">
                    ${a.status==="active"&&e`<button onClick=${()=>u("pause",a)}>${d("settings.tasks.pause")}</button>`}
                    ${a.status==="paused"&&e`<button onClick=${()=>u("resume",a)}>${d("settings.tasks.resume")}</button>`}
                    <button class="danger" onClick=${()=>u("delete",a)}>${d("settings.tasks.delete")}</button>
                </div>
            </div>
            <div class="settings-task-detail-grid">
                <span>${d("settings.tasks.status")}</span><strong>${a.status||"—"}</strong>
                <span>${d("settings.tasks.kind")}</span><strong>${E(a)}</strong>
                <span>${d("settings.tasks.schedule")}</span><strong>${A(a)}</strong>
                <span>${d("settings.tasks.nextRun")}</span><strong>${p(a.next_run)}</strong>
                <span>${d("settings.tasks.lastRun")}</span><strong>${p(a.last_run)}</strong>
                <span>${d("settings.tasks.lastResult")}</span><strong>${a.latest_run_log?.status||a.last_result||"—"}</strong>
                <span>${d("settings.tasks.chat")}</span><code>${a.chat_jid||"—"}</code>
                <span>${d("settings.tasks.model")}</span><code>${a.model||"default"}</code>
                ${a.cwd&&e`<span>${d("settings.tasks.cwd")}</span><code>${a.cwd}</code>`}
                ${a.timeout_sec&&e`<span>${d("settings.tasks.timeout")}</span><strong>${a.timeout_sec}s</strong>`}
                ${g&&e`<span>${d("settings.tasks.protection")}</span><strong>${d("settings.tasks.protectionHint")}</strong>`}
            </div>
            <div class="settings-task-command-block">
                <strong>${a.task_kind==="shell"?d("settings.tasks.command"):d("settings.tasks.prompt")}</strong>
                <pre>${a.command||a.prompt||a.command_summary||a.prompt_summary||a.summary||"—"}</pre>
            </div>
            <h4>${d("settings.tasks.recentRuns")}</h4>
            <${V} task=${a} />
        </div>
    `}function ss({filter:a="",setStatus:u}){let{t:d}=s(),[g,j]=t([]),[T,z]=t({active:0,paused:0,completed:0}),[b,H]=t("all"),[w,O]=t(""),[h,x]=t(!0),[_,I]=t(null),[S,P]=t(null),[L,R]=t(null),[N,D]=t(!1),v=n(async(r={})=>{x(!0),I(null);try{let c=await Mt({status:b,chatJid:w.trim()||void 0,limit:50,includeRunLogs:!0,runLogLimit:5});j(c.tasks||[]),z(c.counts||{active:0,paused:0,completed:0});let F=r.selectedId||S,f=(c.tasks||[]).find((k)=>k.id===F)||(c.tasks||[])[0]||null;P(f?.id||null),R(f)}catch(c){I(c?.message||d("settings.tasks.loadFailed"))}finally{x(!1)}},[b,w,S]);o(()=>{v()},[v]);let C=String(a||"").trim().toLowerCase(),y=i(()=>{if(!C)return g;return g.filter((r)=>[r.id,r.chat_jid,r.status,r.task_kind,r.schedule_type,r.schedule_value,r.summary,r.prompt_summary,r.command_summary,r.latest_run_log?.error_summary].some((c)=>String(c||"").toLowerCase().includes(C)))},[g,C]),J=n((r)=>{P(r?.id||null),R(r||null)},[]),U=n(async(r,c,F={})=>{if(!c||N)return;let f=M(c),k=c.summary||c.command_summary||c.prompt_summary||c.id,q=r==="delete"?d("settings.tasks.confirmDelete",{id:c.id})+`

${k}`:(r==="pause"?d("settings.tasks.confirmPause",{id:c.id}):d("settings.tasks.confirmResume",{id:c.id}))+`

${k}`;if(!window.confirm(q))return;if(f&&!window.confirm(d("settings.tasks.confirmProtected",{id:c.id,action:r})))return;D(!0),u?.(r==="delete"?d("settings.tasks.deleting",{id:c.id}):r==="pause"?d("settings.tasks.pausing",{id:c.id}):d("settings.tasks.resuming",{id:c.id}),"info");try{await Dt(r,c.id,{allowInternal:f,...F}),u?.(r==="delete"?d("settings.tasks.deletedToast",{id:c.id}):r==="pause"?d("settings.tasks.pausedToast",{id:c.id}):d("settings.tasks.resumedToast",{id:c.id}),"success"),await v({selectedId:r==="delete"?null:c.id})}catch(B){u?.(B?.message||d("settings.tasks.actionFailed",{action:r}),"error")}finally{D(!1)}},[N,v,u]);return e`
        <div class="settings-section settings-scheduled-tasks-section">
            <div class="settings-task-toolbar">
                <div class="settings-task-counts">
                    <${m} type="active">${d("settings.tasks.activeLabel")} ${T.active||0}<//>
                    <${m} type="paused">${d("settings.tasks.pausedLabel")} ${T.paused||0}<//>
                    <${m} type="completed">${d("settings.tasks.completedLabel")} ${T.completed||0}<//>
                </div>
                <div class="settings-task-filters">
                    <select value=${b} onChange=${(r)=>H(r.target.value)}>
                        ${G.map((r)=>e`<option value=${r}>${r==="all"?d("settings.tasks.allStatuses"):r}</option>`)}
                    </select>
                    <input type="text" placeholder=${d("settings.tasks.filterChatPlaceholder")} value=${w} onInput=${(r)=>O(r.target.value)} />
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
                        ${y.map((r)=>e`
                            <button class=${`settings-task-row ${r.id===S?"active":""}`} onClick=${()=>J(r)}>
                                <span class="settings-task-row-main">
                                    <strong>${r.summary||r.id}</strong>
                                    <span>${A(r)}</span>
                                </span>
                                <span class="settings-task-row-meta">
                                    <${m} type=${r.status||"neutral"}>${r.status}<//>
                                    <${m}>${E(r)}<//>
                                </span>
                                <span class="settings-task-row-times">${d("settings.tasks.next")} ${p(r.next_run)} · ${d("settings.tasks.last")} ${p(r.last_run)}${r.latest_run_log?.status?` · ${r.latest_run_log.status}`:""}</span>
                            </button>
                        `)}
                        ${y.length===0&&e`<p class="settings-hint">${d("settings.tasks.noMatch",{filter:a})}</p>`}
                    </div>
                    <${W} task=${L&&y.some((r)=>r.id===L.id)?L:y[0]} onAction=${U} />
                </div>
            `}
        </div>
    `}export{ss as ScheduledTasksSection};

//# debugId=D783E06B26D5693D64756E2164756E21
//# sourceMappingURL=scheduled-tasks-grfx75qx.js.map
