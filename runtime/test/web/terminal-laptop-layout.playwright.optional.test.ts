import {beforeAll,afterAll,expect,test} from 'bun:test';
import {join} from 'node:path';
import {chromium,webkit} from 'playwright';
const enabled=process.env.PICLAW_RUN_OPTIONAL_BROWSER_TESTS==='1', browserTest=enabled?test:test.skip;
let server:ReturnType<typeof Bun.serve>;
beforeAll(async()=>{
 if(!enabled)return;
 const build=await Bun.build({entrypoints:[join(import.meta.dir,'fixtures/terminal-laptop-layout.ts')],target:'browser',format:'esm'});
 if(!build.success)throw Error(build.logs.join('\n'));const js=await build.outputs[0].text();
 server=Bun.serve({hostname:'127.0.0.1',port:0,fetch(req){const url=new URL(req.url);
 if(url.pathname==='/fixture.js')return new Response(js,{headers:{'content-type':'text/javascript'}});
 if(url.pathname.startsWith('/static/'))return new Response(Bun.file(join(import.meta.dir,'../../web',url.pathname)));
 if(url.pathname==='/terminal/session')return Response.json({enabled:false});
 return new Response(`<!doctype html><meta name="viewport" content="width=device-width"><link rel="stylesheet" href="/static/${url.searchParams.get('skin')==='visual'?'visual':'classic'}/css/styles.css"><style>html,body,#app{height:100%;margin:0}</style><div id="app"></div><script type="module" src="/fixture.js"></script>`,{headers:{'content-type':'text/html'}});
 }});
},30000);
afterAll(()=>server?.stop(true));
for(const [engineName,engine]of Object.entries({chromium,webkit})) for(const skin of ['classic']) browserTest(`${engineName}/${skin}: terminal takes two thirds without clipping the conversation`,async()=>{
 const browser=await engine.launch({headless:true}),page=await browser.newPage({viewport:{width:1366,height:900}});
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/*',r=>new URL(r.request().url()).origin===server.url.origin?r.continue():r.abort());
 try{
 await page.goto(`${server.url}?skin=${skin}`);await page.waitForFunction(()=>Boolean((window as any).terminalLayout?.terminal?.terminal));
 const splitter=page.locator('.editor-splitter');
 for(const colorScheme of ['light','dark'] as const) for(const width of [1280,1366,1440]){
 await page.emulateMedia({colorScheme});
 await page.setViewportSize({width,height:900});
 const box=await splitter.boundingBox();expect(box).not.toBeNull();
 await page.mouse.move(box!.x+2,300);await page.mouse.down();await page.mouse.move(Math.round(width*2/3)+2,300,{steps:5});await page.mouse.up();
 const geometry=await page.evaluate(()=>{
 const chat=document.querySelector('.container')!,pane=document.querySelector('.editor-pane-container')!,input=document.querySelector('textarea')!,actions=document.querySelector('.compose-actions')!;
 const c=chat.getBoundingClientRect(),p=pane.getBoundingClientRect(),a=actions.getBoundingClientRect(),i=input.getBoundingClientRect();
 return{pane:p.width,chat:c.width,right:c.right,inputRight:i.right,actionsRight:a.right,chatScroll:chat.scrollWidth,chatClient:chat.clientWidth,terminalCols:(window as any).terminalLayout.terminal.terminal.cols};
 });
 expect(Math.abs(geometry.pane-width*2/3)).toBeLessThan(4);
 expect(geometry.right).toBeLessThanOrEqual(width+1);
 expect(geometry.chat).toBeGreaterThanOrEqual(320);
 expect(geometry.inputRight).toBeLessThanOrEqual(width+1);
 expect(geometry.actionsRight).toBeLessThanOrEqual(width+1);
 expect(geometry.chatScroll).toBeLessThanOrEqual(geometry.chatClient+1);
 await page.evaluate(width=>(window as any).terminalLayout.restore(Math.round(width*2/3)),width);
 expect(Math.abs((await page.locator('.editor-pane-container').boundingBox())!.width-width*2/3)).toBeLessThan(4);
 }
 // Opening the workspace after a wide terminal must not push chat off-screen.
 await page.evaluate(()=>{(window as any).terminalLayout.shell.classList.remove('workspace-collapsed');});
 await page.waitForTimeout(200);
 expect(await page.locator('.container').evaluate(el=>el.getBoundingClientRect().right)).toBeLessThanOrEqual(1441);
 expect(await page.locator('.container').evaluate(el=>el.getBoundingClientRect().width)).toBeGreaterThanOrEqual(320);
 // A decoration ruler must not draw a permanent one-pixel rail. Native
 // scrollback remains available, including after output fills the viewport.
 expect(await page.evaluate(()=>(window as any).terminalLayout.terminal.terminal.options.overviewRuler.width||0)).toBe(0);
 expect(await page.locator('.xterm-decoration-overview-ruler').evaluateAll(nodes=>nodes.every(el=>el.getBoundingClientRect().width===0))).toBe(true);
 await page.evaluate(async()=>{const terminal=(window as any).terminalLayout.terminal.terminal;await new Promise<void>(resolve=>terminal.write(Array.from({length:120},(_,i)=>`Line ${i}\r\n`).join(''),resolve));terminal.scrollToTop();});
 expect(await page.evaluate(()=>(window as any).terminalLayout.terminal.terminal.buffer.active.viewportY)).toBe(0);
 expect(await page.evaluate(()=>(window as any).terminalLayout.terminal.terminal.buffer.active.baseY)).toBeGreaterThan(0);
 expect(errors).toEqual([]);
 }finally{await browser.close();}
},30000);
