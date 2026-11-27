import{d,t,o,i,e}from"./app-863dk79s.js";import"./app-r6ty9k25.js";import{it}from"./app-kyv0p0nc.js";import{pt}from"./app-ah7jc83j.js";import"./app-wq98hqjx.js";pt(import.meta.url,["z2a9dvsh","863dk79s","r6ty9k25","kyv0p0nc","ah7jc83j","wq98hqjx","j01zadv1","nrj3zr11","n2pyvfzg","rtkt64hb","71ej405g"],[["./session-picker-fixture.bundle.js",1,2,3,4,5],["./app-863dk79s.js"],["./app-r6ty9k25.js",4,7],["./app-kyv0p0nc.js",1,2,9,4,5],["./app-ah7jc83j.js"],["./app-wq98hqjx.js",1],["./a2ui-renderer-executor-j01zadv1.js",10,7],["./app-nrj3zr11.js"],["./api-n2pyvfzg.js",2],["./app-rtkt64hb.js"],["./app-71ej405g.js",7]],0);
var v=Array.from({length:30},(p,n)=>{let a=Math.floor(n/5),u=n%5===0,c=`web:root-${a}`;return{chat_jid:u?c:`${c}:branch:${n}`,root_chat_jid:c,branch_id:u?`root-${a}`:`branch-${n}`,parent_branch_id:u?null:`root-${a}`,agent_name:n===1||n===2?"duplicate":n===24?"root-2":`session-${String(n).padStart(2,"0")}`,model:["openai/gpt-5.4","local/qwen","anthropic/claude"][n%3],context_tokens:n===8?42000:null,context_window:n===8?128000:null,context_percent:n===8?32.8125:null,is_active:n===1||n===8,archived_at:n>=25?"2026-08-30T00:00:00Z":null}});function y(){let[p,n]=t("web:root-0"),[a,u]=t("none"),[c,h]=t({});o(()=>{let s=(l)=>h(l.detail);return window.addEventListener("fixture-session-activity",s),()=>window.removeEventListener("fixture-session-activity",s)},[]);let g=i(()=>v.map((s)=>({...s,last_activity_at:c[s.chat_jid]})),[c]),r=(s,l)=>{if(u(`${s}:${l||p}`),l)n(l);return!0};return e`
    <main class="session-picker-fixture">
      <output id="session-picker-action">${a}</output>
      <${it}
        currentChatJid=${p}
        activeChatAgents=${g}
        activeModel="openai/gpt-5.4"
        onSwitchChat=${(s)=>r("switch",s)}
        onRestoreSession=${async(s)=>r("restore",s)}
        onRenameSession=${async()=>r("rename")}
        onCreateSession=${async()=>r("new")}
        onCreateRootSession=${async()=>r("new-root")}
        onDeleteSession=${async(s)=>r("delete",s)}
        onPurgeArchivedSession=${async(s)=>r("purge",s)}
        onPost=${()=>{}}
        onFocus=${()=>{}}
      />
    </main>
  `}var m=document.createElement("style");m.textContent="html,body,#session-picker-fixture-root{margin:0;width:100%;height:100%;overflow:hidden}.session-picker-fixture{position:relative;width:100%;height:100%;display:flex;align-items:flex-end;background:var(--bg-primary,#111827)}.session-picker-fixture>.compose-box{width:100%}#session-picker-action{position:fixed;top:4px;left:4px;z-index:2;font:12px monospace;color:var(--text-primary,#fff)}";document.head.appendChild(m);var f=document.getElementById("session-picker-fixture-root")||document.body.appendChild(document.createElement("div"));f.id="session-picker-fixture-root";d(e`<${y} />`,f);

//# debugId=C25A2A178297989264756E2164756E21
//# sourceMappingURL=session-picker-fixture.bundle.js.map
