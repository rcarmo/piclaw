import { afterAll,beforeAll,expect,test } from "bun:test";
import { resolve } from "node:path";
import { readFileSync } from "node:fs";
import { build } from "esbuild";
import { chromium,webkit,type Browser } from "playwright";

const enabled=process.env.PICLAW_RUN_OPTIONAL_BROWSER_TESTS==="1"&&process.env.PICLAW_E2E_DISPOSABLE==="1";
const browserTest=enabled?test:test.skip,root=resolve(import.meta.dir,"../.."),bundles=new Map<string,string>(),browsers=new Map<string,Browser>();
beforeAll(async()=>{
  if(!enabled)return;
  const classic=`import{html,render,useState,useRef,useEffect}from'./web/src/vendor/preact-htm.js';
    import{QueuedFollowupStack,returnQueuedFollowupToEditor}from'./web/src/components/compose-box.ts';
    import{handleInjectQueuedFollowupAction,handleRemoveQueuedFollowupAction}from'./web/src/ui/app-floating-widget-followup.ts';
    function App(){const[items,setItems]=useState([]),[draft,setDraft]=useState('Original draft'),textarea=useRef(null),ref=useRef(items),dismissed=useRef(new Set());ref.current=items;
      const refresh=async()=>{try{const r=await fetch('/agent/queue-state');if(!r.ok)throw Error('read unavailable');setItems((await r.json()).items);}catch{}};
      const action=async(path,id)=>{const r=await fetch(path,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({row_id:id})});if(!r.ok)throw Error('action unavailable');return r.json();};
      const options=item=>({queuedItem:item,followupQueueItemsRef:ref,dismissedQueueRowIdsRef:dismissed,currentChatJid:'web:queue-browser',refreshQueueState:refresh,setFollowupQueueItems:setItems,showIntentToast(){},steerAgentQueueItem:id=>action('/agent/queue-steer',id),removeAgentQueueItem:id=>action('/agent/queue-remove',id)});
      useEffect(()=>{void refresh();window.addEventListener('piclaw:followup-consumed',refresh);return()=>window.removeEventListener('piclaw:followup-consumed',refresh);},[]);
      return html\`<\${QueuedFollowupStack} items=\${items} onInjectQueuedFollowup=\${item=>handleInjectQueuedFollowupAction(options(item))} onRemoveQueuedFollowup=\${item=>handleRemoveQueuedFollowupAction(options(item))} onReturnQueuedFollowup=\${item=>returnQueuedFollowupToEditor({queuedItem:item,onRemoveQueuedFollowup:item=>handleRemoveQueuedFollowupAction(options(item)),setContent:setDraft,textareaRef:textarea})}/><textarea id='draft' ref=\${textarea} value=\${draft}/>\`;
    }render(html\`<\${App}/>\`,document.getElementById('root'));`;
  const visual=`import{h,render}from'preact';import{useState}from'preact/hooks';import{QueueStack}from'./web/static/visual/frontend/src/components/QueueStack.tsx';function App(){const[draft,setDraft]=useState('Original draft');return h('div',null,h(QueueStack,{onEdit:item=>setDraft(item.content)}),h('textarea',{id:'draft',value:draft}));}render(h(App,{}),document.getElementById('root'));`;
  for(const [skin,contents]of [["classic",classic],["visual",visual]]){
    const result=await build({stdin:{contents,resolveDir:root,loader:"tsx"},bundle:true,format:"esm",platform:"browser",jsx:"automatic",jsxImportSource:"preact",write:false});bundles.set(skin,result.outputFiles[0].text);
  }
  browsers.set("chromium",await chromium.launch({headless:true}));browsers.set("webkit",await webkit.launch({headless:true}));
},30000);
afterAll(async()=>{for(const browser of browsers.values())await browser.close();});
for(const skin of ["classic","visual"])for(const engine of ["chromium","webkit"])for(const touch of [false,true])for(const finalAction of ['remove','return'] as const)browserTest(`${skin}/${engine}/${touch?"touch":"keyboard"}: failed actions and accepted steering/${finalAction} never hide an unplaced SDK item`,async()=>{
  let items=[{row_id:17,content:"Visible SDK input",source:"native_sdk"}],deny=true,denyReads=false,actions=0;
  const server=Bun.serve({hostname:"127.0.0.1",port:0,async fetch(req){
    const path=new URL(req.url).pathname;
    if(path==="/")return new Response('<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/style.css"><div id="root"></div><script type="module" src="/fixture.js"></script>',{headers:{"content-type":"text/html"}});
    if(path==="/fixture.js")return new Response(bundles.get(skin),{headers:{"content-type":"text/javascript"}});
    if(path==="/style.css")return new Response(readFileSync(resolve(root,`web/static/${skin}/dist/app.bundle.css`)),{headers:{"content-type":"text/css"}});
    if(path==="/agent/queue-state")return denyReads?Response.json({error:"offline"},{status:503}):Response.json({count:items.length,items});
    if(path==="/agent/queue-steer"||path==="/agent/queue-remove"){
      actions++;const body=await req.json();expect(body.row_id).toBe(17);
      if(deny){denyReads=true;return Response.json({error:"denied"},{status:403});}
      if(path.endsWith("steer"))return Response.json({status:"ok",queued:"steer",removed:false},{status:201});
      items=[];return Response.json({status:"ok",removed:true});
    }return Response.json({});
  }});
  const page=await browsers.get(engine)!.newPage({viewport:touch?{width:520,height:720}:{width:1100,height:800},hasTouch:touch});const errors:string[]=[];page.on("pageerror",error=>errors.push(error.message));
  try{
    await page.goto(`${server.url}?chat_jid=web:queue-browser`);await page.getByText("Visible SDK input",{exact:true}).waitFor();
    const button=(action:"steer"|"remove"|"return")=>page.locator(skin==="visual"?`.queue-stack__btn--${action==="return"?"edit":action}`:action==="steer"?".compose-queue-stack-steer-btn":action==="return"?".compose-queue-stack [data-action=edit]":".compose-queue-stack-close-btn").first();
    const invoke=async(action:"steer"|"remove"|"return")=>{const before=actions;const target=button(action);if(touch)await target.tap();else{await target.focus();await page.keyboard.press("Enter");}const until=Date.now()+2000;while(actions===before&&Date.now()<until)await page.waitForTimeout(5);expect(actions).toBe(before+1);await page.waitForTimeout(60);};
    await invoke("steer");expect(await page.getByText("Visible SDK input",{exact:true}).count()).toBe(1);
    await invoke("remove");expect(await page.getByText("Visible SDK input",{exact:true}).count()).toBe(1);
    await invoke("return");expect(await page.getByText("Visible SDK input",{exact:true}).count()).toBe(1);expect(await page.locator("#draft").inputValue()).toBe("Original draft");
    deny=false;denyReads=false;await invoke("steer");expect(await page.getByText("Visible SDK input",{exact:true}).count()).toBe(1);
    await invoke(finalAction);await page.getByText("Visible SDK input",{exact:true}).waitFor({state:"detached"});
    expect(await page.locator("#draft").inputValue()).toBe(finalAction==='return'?'Visible SDK input':'Original draft');
    expect(actions).toBe(5);expect(errors).toEqual([]);
  }finally{await page.close();server.stop(true);}
},15000);
