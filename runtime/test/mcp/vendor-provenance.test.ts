import {expect,test} from 'bun:test';
import {join,resolve} from 'node:path';
const root=resolve(import.meta.dir,'../../durable-engine/vendor/token-economizer');
test('archived optimiser sources are not install inputs; MCP retains the reviewed pure helpers',async()=>{
 const repo=resolve(import.meta.dir,'../../..'),main=await Bun.file(join(repo,'package.json')).json(),engine=await Bun.file(join(repo,'runtime/durable-engine/package.json')).json();
 expect(main.files.some((path:string)=>path.includes('vendor/token-economizer'))).toBe(false);
 for(const pkg of [main,engine])expect(Object.keys(pkg.imports??{}).some(key=>key.startsWith('#token-optimizer/'))).toBe(false);
 const mcp=resolve(import.meta.dir,'../../durable-engine/src/mcp');
 for(const [moved,upstream] of [['recall-output.ts','src/core/output/mcp.ts'],['recall-secrets.ts','src/core/output/mcp-recall/secrets.ts'],['APACHE-LICENSE','LICENSE'],['APACHE-NOTICE','NOTICE']]){
  expect(await Bun.file(join(mcp,moved!)).text()).toBe(await Bun.file(join(root,upstream!)).text());
 }
 expect(await Bun.file(join(mcp,'recall-privacy-upstream.ts')).text()).toBe((await Bun.file(join(root,'src/core/output/mcp-recall/privacy.ts')).text()).replace('./secrets.ts','./recall-secrets.ts'));
});
test('all 109 imported files match upstream or their explicitly recorded, bounded adaptations',async()=>{
 const source=await Bun.file(join(root,'SOURCE.json')).json(),modifications=await Bun.file(join(root,'MODIFICATIONS.json')).json();
 expect(source.file_count).toBe(109);expect(Object.keys(source.sha256)).toHaveLength(109);expect(modifications.commit).toBe(source.upstream_commit);expect(modifications.productionEngineUnchanged).toBe(false);
 expect(modifications.adaptedTests.map((row:any)=>row.path).sort()).toEqual(['test/boundaries.test.ts','test/durable.test.ts','test/incremental.test.ts']);
 expect(modifications.engineAdaptations.map((row:any)=>row.path).sort()).toEqual(['src/core/sessions.ts','src/pi-durable/controller.ts','src/pi-durable/domain.ts','src/pi-durable/fold.ts']);
 expect(modifications.hostFixes.some((row:any)=>row.commit==='6d1cd82928daecda1e530483a750cee9dd5378b2')).toBe(true);
 const adapted=new Map<string,string>([...modifications.adaptedTests,...modifications.engineAdaptations].map((row:any)=>[row.path,row.sha256]));
 for(const[path,hash]of Object.entries(source.sha256)){const actual=new Bun.CryptoHasher('sha256').update(await Bun.file(join(root,path)).bytes()).digest('hex');expect(actual,path).toBe(adapted.get(path)??hash);}
 expect(new Bun.CryptoHasher('sha256').update(await Bun.file(join(root,'NOTICE')).bytes()).digest('hex')).toBe('b13ad82143cf3148f4a840f32efb2da7426da7a87924bc964e252d3bd1bdf443');
});
