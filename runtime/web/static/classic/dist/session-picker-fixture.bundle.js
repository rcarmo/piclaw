import{d,t,o,i,e}from"./app-ppf3jt10.js";import"./app-k2cxxgyd.js";import{Je}from"./app-bkgef2mt.js";import{nt}from"./app-as1dvhqj.js";import"./app-4p6zhgna.js";nt(import.meta.url,["ndmf5fnj","ppf3jt10","k2cxxgyd","bkgef2mt","as1dvhqj","4p6zhgna","rzyk9mq5","p5ay9pwg","1agp6d1x","gvvd015k","ejky252v"],[["./session-picker-fixture.bundle.js",1,2,3,4,5],["./app-ppf3jt10.js"],["./app-k2cxxgyd.js",4,7],["./app-bkgef2mt.js",1,2,9,4,5],["./app-as1dvhqj.js"],["./app-4p6zhgna.js",1],["./a2ui-renderer-executor-rzyk9mq5.js",10,7],["./app-p5ay9pwg.js"],["./api-1agp6d1x.js",2],["./app-gvvd015k.js"],["./app-ejky252v.js",7]],0);
var v=Array.from({length:30},(p,n)=>{let a=Math.floor(n/5),u=n%5===0,c=`web:root-${a}`;return{chat_jid:u?c:`${c}:branch:${n}`,root_chat_jid:c,branch_id:u?`root-${a}`:`branch-${n}`,parent_branch_id:u?null:`root-${a}`,agent_name:n===1||n===2?"duplicate":n===24?"root-2":`session-${String(n).padStart(2,"0")}`,model:["openai/gpt-5.4","local/qwen","anthropic/claude"][n%3],context_tokens:n===8?42000:null,context_window:n===8?128000:null,context_percent:n===8?32.8125:null,is_active:n===1||n===8,archived_at:n>=25?"2026-08-30T00:00:00Z":null}});function y(){let[p,n]=t("web:root-0"),[a,u]=t("none"),[c,h]=t({});o(()=>{let s=(l)=>h(l.detail);return window.addEventListener("fixture-session-activity",s),()=>window.removeEventListener("fixture-session-activity",s)},[]);let g=i(()=>v.map((s)=>({...s,last_activity_at:c[s.chat_jid]})),[c]),r=(s,l)=>{if(u(`${s}:${l||p}`),l)n(l);return!0};return e`
    <main class="session-picker-fixture">
      <output id="session-picker-action">${a}</output>
      <${Je}
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

//# debugId=9B95E2AB9B6BD2C664756E2164756E21
//# sourceMappingURL=session-picker-fixture.bundle.js.map
