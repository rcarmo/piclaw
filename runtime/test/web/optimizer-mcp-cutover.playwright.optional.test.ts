import {afterAll,beforeAll,expect,test} from 'bun:test';
import {join} from 'node:path';
import {Database} from 'bun:sqlite';
import {chromium,webkit,type Browser} from 'playwright';
import {Value} from 'typebox/value';
import {McpConnectionInputSchema} from '../../durable-engine/src/mcp/connections.ts';
import {TokenOptimizerConfiguration} from '../../durable-engine/src/token-optimizer-config.ts';
import {defaultMcpRecallSettings,outputOffload} from '#token-optimizer/core';
const enabled=process.env.PICLAW_RUN_OPTIONAL_BROWSER_TESTS==='1'&&process.env.PICLAW_E2E_DISPOSABLE==='1';
const browserTest=enabled?test:test.skip,browsers=new Map<string,Browser>();let bundle='';
beforeAll(async()=>{
 if(!enabled)return;
 const built=await Bun.build({entrypoints:[join(import.meta.dir,'fixtures/optimizer-mcp-cutover.ts')],target:'browser',format:'esm'});if(!built.success)throw Error(String(built.logs));bundle=await built.outputs[0].text();
 browsers.set('chromium',await chromium.launch({headless:true,args:['--use-angle=swiftshader','--ozone-platform=headless']}));browsers.set('webkit',await webkit.launch());
},30000);
afterAll(async()=>{for(const browser of browsers.values())await browser.close();});
for(const engine of ['chromium','webkit'])for(const width of [1280,390,320])for(const colorScheme of ['light','dark'] as const)
browserTest(`Classic cutover ${engine}/${width}/${colorScheme}: reference-safe MCP and independent oversight`,async()=>{
 const database=new Database(':memory:');database.exec('CREATE TABLE router_state(key TEXT PRIMARY KEY,value TEXT NOT NULL)');
 const workspaceId='fixture_workspace',config=new TokenOptimizerConfiguration(database,()=>{},workspaceId),mcpPosts:any[]=[],optimizerPosts:any[]=[];
 let revision=1,forceConflict=false,maintenance=0;
 let connection:any={id:'fixture',name:'fixture',workspaceId,agentIds:[],enabled:false,transport:'http',url:'https://fixture.invalid/mcp',auth:'bearer',bearerTokenKeychain:'SAVED_REFERENCE_NOT_IN_BROWSER',allowHttp:false,timeoutSeconds:30,recall:defaultMcpRecallSettings(),access:{kind:'workspaces',grants:[{workspaceId,agentIds:['default']},{workspaceId:'foreign_workspace',agentIds:['foreign_agent']}]}};
 const mcpSnapshot=()=>{const{bearerTokenKeychain,...publicRow}=connection;return{ok:true,workspaceId,connections:[{...publicRow,revision,hasSavedCredentials:!!bearerTokenKeychain,environmentNames:[],needsCredentialApproval:false}],agents:[{id:'default',label:'Default'}],defaults:{recall:defaultMcpRecallSettings()}};};
 const optimizerSnapshot=()=>{const value=config.snapshot();value.policy.offload??=outputOffload(value.policy);return{ok:true,config:value,revision:config.revision(),models:[{provider:'fixture',id:'judge',type:'chat'}],status:[{agentId:'web:default',label:'Default',policy:config.policy(),accounting:{calls:1,dailyCalls:2,authPaused:!maintenance},hiddenTools:[],proposedTools:[],facts:[],nudges:[]}]};};
 const server=Bun.serve({hostname:'127.0.0.1',port:0,async fetch(req){
  const path=new URL(req.url).pathname;
  if(path==='/fixture.js')return new Response(bundle,{headers:{'Content-Type':'text/javascript'}});
  if(path==='/style.css')return new Response(Bun.file(join(import.meta.dir,'../../web/static/classic/dist/app.bundle.css')),{headers:{'Content-Type':'text/css'}});
  if(path==='/agent/settings/mcp'){
   if(req.method==='GET')return Response.json(mcpSnapshot());const body=await req.json() as any;mcpPosts.push(body);
   const next={...connection,...body.connection};if(body.action!=='save'||body.expectedRevision!==revision||!Value.Check(McpConnectionInputSchema,next))return Response.json({error:'Invalid MCP contract or revision'},{status:409});
   connection=next;revision++;return Response.json(mcpSnapshot());
  }
  if(path==='/agent/addons/api/token-optimizer/config'){
   if(req.method==='GET')return Response.json(optimizerSnapshot());const body=await req.json() as any;if(body.action==='retry_models'){maintenance++;return Response.json(optimizerSnapshot());}optimizerPosts.push(body);
   if(forceConflict){forceConflict=false;await config.update(value=>({...value,policy:{...value.policy,maxFacts:value.policy.maxFacts+1}}));}
   try{await config.configure(body.config,{expectedRevision:body.expectedRevision});return Response.json(optimizerSnapshot());}catch{return Response.json({error:'Settings changed; reload before saving'},{status:409});}
  }
  return new Response('<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/style.css"><style>body{margin:0;padding:12px;box-sizing:border-box}#root{max-width:1000px;margin:auto}</style><main id="root"></main><script type="module" src="/fixture.js"></script>',{headers:{'Content-Type':'text/html'}});
 }});
 const page=await browsers.get(engine)!.newPage({viewport:{width,height:900},hasTouch:width<600,colorScheme});
 await page.addInitScript(()=>Object.defineProperty(globalThis.crypto,'randomUUID',{configurable:true,value:undefined}));
 const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
 await page.route('**/*',route=>new URL(route.request().url()).origin===server.url.origin?route.continue():route.abort());
 const checkWidth=async()=>{const dimensions=await page.evaluate(()=>({width:document.documentElement.clientWidth,scroll:document.documentElement.scrollWidth}));expect(dimensions.scroll).toBeLessThanOrEqual(dimensions.width+1);};
 try{
  await page.goto(server.url.href);await page.getByLabel('Name',{exact:true}).waitFor();expect(await page.evaluate(()=>typeof crypto.randomUUID)).toBe('undefined');expect(await page.getByLabel('Bearer token keychain reference').inputValue()).toBe('');expect(await page.locator('body').innerText()).not.toContain('SAVED_REFERENCE_NOT_IN_BROWSER');expect(mcpPosts).toEqual([]);
  await page.getByLabel('Name',{exact:true}).fill('renamed');const save=page.getByRole('button',{name:'Save connection',exact:true});if(width<600)await save.tap();else{await save.focus();await page.keyboard.press('Space');}
  await page.waitForFunction(()=>!(document.querySelector('input[id$="name"]') as HTMLInputElement)?.disabled);expect(mcpPosts).toHaveLength(1);expect(mcpPosts[0].connection).not.toHaveProperty('bearerTokenKeychain');expect(mcpPosts[0].approveCredentialReuse).toBe(false);expect(connection.bearerTokenKeychain).toBe('SAVED_REFERENCE_NOT_IN_BROWSER');expect(connection.recall).toEqual(defaultMcpRecallSettings());expect(connection.access.grants).toEqual([{workspaceId:'foreign_workspace',agentIds:['foreign_agent']},{workspaceId,agentIds:['default']}]);
  await page.getByLabel('Default',{exact:true}).uncheck();await save.click();await page.getByRole('alert').filter({hasText:'Select at least one Agent'}).waitFor();expect(mcpPosts).toHaveLength(1);
  await page.getByLabel('Transport',{exact:true}).selectOption('stdio');await page.getByLabel('Command',{exact:true}).fill('[123]');await page.getByLabel('Access',{exact:true}).selectOption('workspace');await save.click();await page.getByRole('alert').filter({hasText:'Command must be a valid JSON string array'}).waitFor();expect(mcpPosts).toHaveLength(1);await checkWidth();
  await page.goto(server.url.href+'?section=optimizer');
  const optimisation=page.getByLabel('Optimisation mode',{exact:true}),oversight=page.getByLabel('Oversight mode',{exact:true}),saveConfig=page.getByRole('button',{name:'Save settings',exact:true});
  await optimisation.waitFor();expect(await optimisation.inputValue()).toBe('off');expect(await oversight.inputValue()).toBe('off');
  expect(await page.getByLabel('Check task progress',{exact:true}).count()).toBe(0);expect(await page.getByLabel('Optimisation preset',{exact:true}).count()).toBe(0);expect(await optimisation.locator('option[value="active"]').isDisabled()).toBe(true);
  expect(await page.locator('.settings-optimizer .settings-optimizer-group').count()).toBe(3);
  expect(await page.locator('.settings-optimizer :is(input, select):visible').count()).toBe(2);
  expect(await page.getByText('Agent overrides',{exact:true}).count()).toBe(0);expect(optimizerPosts).toEqual([]);await checkWidth();
  await oversight.selectOption('active');await page.getByLabel('Check task progress',{exact:true}).check();await page.getByLabel('Loop checks',{exact:true}).selectOption('judge');await page.getByText('Oversight details',{exact:true}).click();
  const plan=page.getByLabel('Share the active Plan item with the judge',{exact:true});expect(await plan.isChecked()).toBe(false);await plan.check();
  await page.getByText('Shared models and limits',{exact:true}).click();await page.getByLabel('Shared generation model',{exact:true}).selectOption({label:'fixture/judge'});await saveConfig.click();
  await page.getByText('Saved. Changes apply at the next eligible SDK boundary.',{exact:true}).waitFor();expect(config.snapshot().policy.enabled).toBe(false);expect(config.snapshot().policy.oversightMode).toBe('active');expect(config.snapshot().policy.sharePlanWithJudge).toBe(true);
  await optimisation.selectOption('observe');await page.getByLabel('Optimisation preset',{exact:true}).selectOption('basic');
  await page.getByRole('button',{name:'Retry paused model calls',exact:true}).click();await page.getByText('Model calls can resume.',{exact:true}).waitFor();
  expect(maintenance).toBe(1);expect(await optimisation.inputValue()).toBe('observe');expect(await page.getByLabel('Optimisation preset',{exact:true}).inputValue()).toBe('basic');expect(optimizerPosts).toHaveLength(1);
  await saveConfig.click();await page.getByText('Saved. Changes apply at the next eligible SDK boundary.',{exact:true}).waitFor();
  expect(config.snapshot().policy).toMatchObject({mode:'observe',oversightMode:'active',microSkills:'envfacts',offloadOutputs:true,reduceOutputs:true,pruning:'propose',toolJudge:'none',outputSummaries:false,autoToolPicks:false,inferenceInObserve:false});
  expect(await optimisation.locator('option[value="active"]').isDisabled()).toBe(false);
  const activity=page.getByText('Default · Optimisation Watch only · Oversight On',{exact:true});if(width<600)await activity.tap();else{await activity.focus();await page.keyboard.press('Enter');}
  await page.getByText(/model calls this session/).waitFor();
  expect(await page.getByLabel('Default: optimisation',{exact:true}).count()).toBe(0);
  expect(Object.keys(optimizerPosts.at(-1).config).sort()).toEqual(['hasEnabled','policy','version']);
  await optimisation.selectOption('off');await saveConfig.click();await page.getByText('Saved. Changes apply at the next eligible SDK boundary.',{exact:true}).waitFor();expect(config.policy().mode).toBe('off');
  forceConflict=true;await oversight.selectOption('off');await saveConfig.click();await page.getByRole('alert').filter({hasText:'Settings changed; reload before saving'}).waitFor();expect(config.snapshot().policy.oversightMode).toBe('active');expect(await oversight.inputValue()).toBe('off');
  page.once('dialog',dialog=>dialog.accept());await page.getByRole('button',{name:'Reload saved settings',exact:true}).click();await page.waitForFunction(()=>!(document.querySelector('[role="alert"]')));expect(await oversight.inputValue()).toBe('active');await checkWidth();expect(errors).toEqual([]);
 }finally{await page.close();server.stop(true);database.close();}
},30000);
