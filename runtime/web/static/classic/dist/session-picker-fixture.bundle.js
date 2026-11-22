import{d,t,o,i,e}from"./app-3vj62mns.js";import"./app-x56a5szh.js";import{Xe}from"./app-xq4gxwc0.js";import{ct}from"./app-wwh20186.js";import"./app-wjg40tw4.js";ct(import.meta.url,["tb1hf44k","3vj62mns","x56a5szh","xq4gxwc0","wwh20186","wjg40tw4","djfstd6r","es4mt8m7","8n6e66b1","bf69xg8m","0hhq7csb"],[["./session-picker-fixture.bundle.js",1,2,3,4,5],["./app-3vj62mns.js"],["./app-x56a5szh.js",4,7],["./app-xq4gxwc0.js",1,2,9,4,5],["./app-wwh20186.js"],["./app-wjg40tw4.js",1],["./a2ui-renderer-executor-djfstd6r.js",10,7],["./app-es4mt8m7.js"],["./api-8n6e66b1.js",2],["./app-bf69xg8m.js"],["./app-0hhq7csb.js",7]],0);
var v=Array.from({length:30},(p,n)=>{let a=Math.floor(n/5),u=n%5===0,c=`web:root-${a}`;return{chat_jid:u?c:`${c}:branch:${n}`,root_chat_jid:c,branch_id:u?`root-${a}`:`branch-${n}`,parent_branch_id:u?null:`root-${a}`,agent_name:n===1||n===2?"duplicate":n===24?"root-2":`session-${String(n).padStart(2,"0")}`,model:["openai/gpt-5.4","local/qwen","anthropic/claude"][n%3],context_tokens:n===8?42000:null,context_window:n===8?128000:null,context_percent:n===8?32.8125:null,is_active:n===1||n===8,archived_at:n>=25?"2026-08-30T00:00:00Z":null}});function y(){let[p,n]=t("web:root-0"),[a,u]=t("none"),[c,h]=t({});o(()=>{let s=(l)=>h(l.detail);return window.addEventListener("fixture-session-activity",s),()=>window.removeEventListener("fixture-session-activity",s)},[]);let g=i(()=>v.map((s)=>({...s,last_activity_at:c[s.chat_jid]})),[c]),r=(s,l)=>{if(u(`${s}:${l||p}`),l)n(l);return!0};return e`
    <main class="session-picker-fixture">
      <output id="session-picker-action">${a}</output>
      <${Xe}
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

//# debugId=2D6F28CCF67816E364756E2164756E21
//# sourceMappingURL=session-picker-fixture.bundle.js.map
