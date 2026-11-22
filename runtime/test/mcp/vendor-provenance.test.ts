import {expect,test} from 'bun:test';
import {join,resolve} from 'node:path';
const root=resolve(import.meta.dir,'../../durable-engine/vendor/token-economizer');
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
