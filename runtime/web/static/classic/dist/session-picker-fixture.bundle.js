import{f,t,o,i,e}from"./app-c7xgjke0.js";import"./app-7bepgq8r.js";import"./app-p5k2h1w4.js";import{Xe}from"./app-am2tztm4.js";import{at}from"./app-8f7dkwd2.js";import"./app-dr786pqe.js";at(import.meta.url,["pqhbdh48","c7xgjke0","7bepgq8r","p5k2h1w4","am2tztm4","8f7dkwd2","dr786pqe","5sv5q7g3","q9sxvzr1","ve7jvgxg","vf1bgthg","qg78536j"],[["./session-picker-fixture.bundle.js",1,2,3,4,5,6],["./app-c7xgjke0.js"],["./app-7bepgq8r.js",5,8],["./app-p5k2h1w4.js",2,5,8],["./app-am2tztm4.js",1,3,10,5,6],["./app-8f7dkwd2.js"],["./app-dr786pqe.js",1],["./a2ui-renderer-executor-5sv5q7g3.js",11,8],["./app-q9sxvzr1.js"],["./api-ve7jvgxg.js",3,2],["./app-vf1bgthg.js"],["./app-qg78536j.js",8]],0);
var v=Array.from({length:30},(d,n)=>{let a=Math.floor(n/5),u=n%5===0,c=`web:root-${a}`;return{chat_jid:u?c:`${c}:branch:${n}`,root_chat_jid:c,branch_id:u?`root-${a}`:`branch-${n}`,parent_branch_id:u?null:`root-${a}`,agent_name:n===1||n===2?"duplicate":n===24?"root-2":`session-${String(n).padStart(2,"0")}`,model:["openai/gpt-5.4","local/qwen","anthropic/claude"][n%3],context_tokens:n===8?42000:null,context_window:n===8?128000:null,context_percent:n===8?32.8125:null,is_active:n===1||n===8,archived_at:n>=25?"2026-08-30T00:00:00Z":null}});function y(){let[d,n]=t("web:root-0"),[a,u]=t("none"),[c,p]=t({});o(()=>{let s=(l)=>p(l.detail);return window.addEventListener("fixture-session-activity",s),()=>window.removeEventListener("fixture-session-activity",s)},[]);let g=i(()=>v.map((s)=>({...s,last_activity_at:c[s.chat_jid]})),[c]),r=(s,l)=>{if(u(`${s}:${l||d}`),l)n(l);return!0};return e`
    <main class="session-picker-fixture">
      <output id="session-picker-action">${a}</output>
      <${Xe}
        currentChatJid=${d}
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
  `}var h=document.createElement("style");h.textContent="html,body,#session-picker-fixture-root{margin:0;width:100%;height:100%;overflow:hidden}.session-picker-fixture{position:relative;width:100%;height:100%;display:flex;align-items:flex-end;background:var(--bg-primary,#111827)}.session-picker-fixture>.compose-box{width:100%}#session-picker-action{position:fixed;top:4px;left:4px;z-index:2;font:12px monospace;color:var(--text-primary,#fff)}";document.head.appendChild(h);var m=document.getElementById("session-picker-fixture-root")||document.body.appendChild(document.createElement("div"));m.id="session-picker-fixture-root";f(e`<${y} />`,m);

//# debugId=EDF9A3F8F91BBD4064756E2164756E21
//# sourceMappingURL=session-picker-fixture.bundle.js.map
