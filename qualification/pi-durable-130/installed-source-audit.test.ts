import{test,expect}from'bun:test';import{mkdtempSync,mkdirSync,cpSync,rmSync,writeFileSync,readFileSync,symlinkSync}from'node:fs';import{dirname,join,resolve}from'node:path';import{applicationAddonSourceProfiles,auditInstalledApplicationAddonSources,loadApplicationExtensionCatalog}from'../../runtime/durable-engine/src/host-extension-catalog';import{SettingsManager}from'../../node_modules/@earendil-works/pi-coding-agent';
const source=process.env.DURABLE_ADDONS_ROOT;if(!source)throw Error('Pinned public add-on source required');
function fixture(){
  const cwd=mkdtempSync(join(import.meta.dir,'.qualification-audit-'));
  const expected=auditInstalledApplicationAddonSources(cwd).expectedProfiles;
  // This gate proves every pinned backend byte; browser/vendor assets are not execution proof.
  for(const profile of Object.values(applicationAddonSourceProfiles)){
    const dir=profile.name.replace('@rcarmo/piclaw-addon-','');
    for(const file of new Set(['package.json',...Object.keys(profile.files)])){
      const target=join(cwd,'.pi/extensions/node_modules',profile.name,file);
      mkdirSync(dirname(target),{recursive:true});cpSync(resolve(source!,'addons',dir,file),target);
    }
  }
  mkdirSync(join(cwd,'agent'));return{cwd,expected};
}
function cleanup(cwd:string){rmSync(cwd,{recursive:true,force:true});}
test('shared pre-evaluation audit accepts canonical backend source for all 23 packages including resource-only packages',()=>{const f=fixture();try{const result=auditInstalledApplicationAddonSources(f.cwd);expect(result.profiles.length).toBe(23);expect(result.profiles.map(p=>p.name).sort()).toEqual(f.expected.map(p=>p.name).sort());expect(result.profiles.filter(p=>p.entry.endsWith('/package.json')).length).toBe(2);}finally{cleanup(f.cwd);}});
test('legacy EML alias alone remains supported but alias plus canonical is rejected',()=>{const f=fixture();try{const root=join(f.cwd,'.pi/extensions/node_modules'),canonical=join(root,'@rcarmo/piclaw-addon-eml-viewer'),alias=join(root,'piclaw-addon-eml-viewer');cpSync(canonical,alias,{recursive:true});expect(()=>auditInstalledApplicationAddonSources(f.cwd)).toThrow('Unqualified installed add-on package before evaluation');rmSync(canonical,{recursive:true});expect(auditInstalledApplicationAddonSources(f.cwd).profiles.length).toBe(23);}finally{cleanup(f.cwd);}});
test('extra alias for each of the 23 packages fails the same gate',()=>{const f=fixture();try{for(const p of f.expected){const alias=join(f.cwd,'.pi/extensions/node_modules/unqualified-alias');mkdirSync(alias);writeFileSync(join(alias,'package.json'),JSON.stringify({name:p.name,version:p.version}));expect(()=>auditInstalledApplicationAddonSources(f.cwd)).toThrow('Unqualified installed add-on package before evaluation');rmSync(alias,{recursive:true});}}finally{cleanup(f.cwd);}});
test('shadows, source mutations, wrong manifests and escaped roots remain rejected',()=>{const f=fixture();try{const pkg=join(f.cwd,'.pi/extensions/node_modules/@rcarmo/piclaw-addon-plan-sidebar'),file=join(pkg,'index.ts'),original=readFileSync(file);writeFileSync(join(pkg,'compat/chat-context.js'),'throw Error("must not evaluate")');expect(()=>auditInstalledApplicationAddonSources(f.cwd)).toThrow();rmSync(join(pkg,'compat/chat-context.js'));writeFileSync(file,'throw Error("must not evaluate")');expect(()=>auditInstalledApplicationAddonSources(f.cwd)).toThrow();writeFileSync(file,original);const manifest=join(pkg,'package.json'),bytes=readFileSync(manifest);const j=JSON.parse(bytes.toString());j.version='999.0.0';writeFileSync(manifest,JSON.stringify(j));expect(()=>auditInstalledApplicationAddonSources(f.cwd)).toThrow();writeFileSync(manifest,bytes);const moved=pkg+'-saved';cpSync(pkg,moved,{recursive:true});rmSync(pkg,{recursive:true});symlinkSync(moved,pkg);expect(()=>auditInstalledApplicationAddonSources(f.cwd)).toThrow();}finally{cleanup(f.cwd);}});
test('audit and actual loader reject the same duplicate before any factory evaluation',async()=>{const f=fixture();try{const root=join(f.cwd,'.pi/extensions/node_modules');cpSync(join(root,'@rcarmo/piclaw-addon-eml-viewer'),join(root,'piclaw-addon-eml-viewer'),{recursive:true});expect(()=>auditInstalledApplicationAddonSources(f.cwd)).toThrow('Unqualified installed add-on package before evaluation');await expect(loadApplicationExtensionCatalog({cwd:f.cwd,agentDir:join(f.cwd,'agent'),settingsManager:SettingsManager.inMemory()})).rejects.toThrow('Unqualified installed add-on package before evaluation');}finally{cleanup(f.cwd);}});

test('retired Regrets0.2.3 cannot re-enter legacy execution through the loader',async()=>{
  const f=fixture();
  try{
    const pkg=join(f.cwd,'.pi/extensions/node_modules/@rcarmo/piclaw-addon-late-night-regrets');
    const manifest=JSON.parse(readFileSync(join(pkg,'package.json'),'utf8'));
    manifest.version='0.2.3';writeFileSync(join(pkg,'package.json'),JSON.stringify(manifest));
    writeFileSync(join(pkg,'index.ts'),'throw Error("RETIRED_REGRETS_MUST_NOT_EVALUATE")');
    expect(()=>auditInstalledApplicationAddonSources(f.cwd)).toThrow('Unqualified installed add-on package before evaluation');
    await expect(loadApplicationExtensionCatalog({cwd:f.cwd,agentDir:join(f.cwd,'agent'),settingsManager:SettingsManager.inMemory()})).rejects.toThrow('Unqualified installed add-on package before evaluation');
  }finally{cleanup(f.cwd);}
});

test('actual SDK Harness emits native spans through the add-on adapter without content or execution ownership', async()=>{
 const {openFixture,context}=await import('./src/fixture.ts');
 const {Harness,MemoryStorage}=await import('../../runtime/durable-engine/qualification/durable.ts');
 const {pathToFileURL}=await import('node:url');
 const helper=pathToFileURL(join(source!,'addons/observability/native-telemetry.ts')).href;
 const {createOtelTelemetryContext}=await import(helper);
 const api=await import(import.meta.resolve('@opentelemetry/api',helper));
 const sdk=await import(import.meta.resolve('@opentelemetry/sdk-trace-base',helper));
 const exporter=new sdk.InMemorySpanExporter(),provider=new sdk.BasicTracerProvider({spanProcessors:[new sdk.SimpleSpanProcessor(exporter)]});
 const telemetry=createOtelTelemetryContext(()=>provider.getTracer('native-integration'),()=>api.metrics.getMeter('native-integration'));
 const f=await openFixture({acquired:true});await f.close();
 const harness=await Harness.open(new MemoryStorage(),{models:f.models,registry:f.registry,telemetry,settings:{retry:{enabled:false},compaction:{enabled:false}}},context);
 try{
  const root=await harness.root(context,{agent:{model:{provider:'qualification',modelId:'synthetic'},extensions:[],tools:[]}});
  const result=await root.submit({type:'input',requestId:'observability-adapter',content:'PRIVATE PROMPT MUST NOT BE EXPORTED'},context);
  expect((await result.wait(context)).status).toBe('done');expect(f.host.modelCalls).toBe(1);
 }finally{await harness.close(context);}
 await provider.forceFlush();
 const spans=exporter.getFinishedSpans();expect(spans.some((s:any)=>s.name==='pi.durable.submit')).toBe(true);expect(spans.some((s:any)=>s.name==='pi.durable.phase')).toBe(true);
 expect(JSON.stringify(spans.map((s:any)=>({name:s.name,attributes:s.attributes,events:s.events,status:s.status})))).not.toContain('PRIVATE PROMPT');
 const runtime=readFileSync(new URL('../../runtime/durable-engine/src/default-application-runtime.ts',import.meta.url),'utf8');
 expect(runtime).toContain('telemetry: observability?.addon.createNativeTelemetryContext()');
 expect(runtime).toContain('observability?.addon.shutdownObservabilityRuntime()');
 await provider.shutdown();
});
