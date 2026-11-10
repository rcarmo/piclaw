import '../helpers.js';
import{test,expect}from'bun:test';import{Database}from'bun:sqlite';import{mkdtempSync,rmSync}from'node:fs';import{join}from'node:path';import{tmpdir}from'node:os';
import{fileURLToPath}from'node:url';
import{generateProviderModelEstimatedCostChart}from'../../skills/operator/token-chart/token-cost-by-provider-model-chart.ts';import{resolveProviderModelPricing}from'../../skills/operator/token-chart/provider-model-pricing-reference.ts';
const now=new Date('2026-11-10T12:00:00.000Z');
function fixture(rows:[string,string][],run:(path:string)=>void){const dir=mkdtempSync(join(tmpdir(),'unpriced-chart-')),path=join(dir,'messages.db');try{const db=new Database(path);db.exec('CREATE TABLE token_usage(run_at TEXT,provider TEXT,model TEXT,input_tokens INTEGER,output_tokens INTEGER,cache_read_tokens INTEGER,cache_write_tokens INTEGER,total_tokens INTEGER)');for(const[p,m]of rows)db.query('INSERT INTO token_usage VALUES(?,?,?,1000000,0,0,0,1000000)').run(now.toISOString(),p,m);db.close();run(path);}finally{rmSync(dir,{recursive:true,force:true});}}
test('unknown pricing is unavailable, not a free tariff',()=>{expect(resolveProviderModelPricing('unpriced-provider','unpriced-model')).toBeNull();});
test('unknown-only activity keeps CSV gaps and total unknown',()=>fixture([['unpriced-provider','unpriced-model']],path=>{const r=generateProviderModelEstimatedCostChart({days:1,dbPath:path,now});expect(r.totalEstimatedCost).toBeNull();expect(r.knownSubtotal).toBe(0);expect(r.unpricedGroups).toBe(1);expect(r.dayTotals).toEqual([{day:'2026-11-10',total:null}]);expect(r.csv).toContain('"unpriced-model",\n');expect(r.svg).toContain('unknown; known subtotal');expect(r.svg).not.toContain('No rows found');}));
test('known subtotal is independent of unpriced groups; documented free zero remains a real series',()=>fixture([['openai','gpt-6.1-sol'],['milkv-local','gemma4-e4b-qat-mtp'],['unpriced-provider','unpriced-model']],path=>{const r=generateProviderModelEstimatedCostChart({days:1,dbPath:path,now});expect(r.totalEstimatedCost).toBeNull();expect(r.knownSubtotal).toBe(2);expect(r.seriesCount).toBe(2);expect(r.csv).toContain('"gemma4-e4b-qat-mtp",0.000000');expect(r.unpricedGroups).toBe(1);}));
test('documented free-only activity retains an explicit zero marker and complete zero total',()=>fixture([['milkv-local','gemma4-e4b-qat-mtp']],path=>{const r=generateProviderModelEstimatedCostChart({days:1,dbPath:path,now});expect(r.totalEstimatedCost).toBe(0);expect(r.knownSubtotal).toBe(0);expect(r.unpricedGroups).toBe(0);expect(r.seriesCount).toBe(1);expect(r.svg).toContain('data-known-zero="2026-11-10"');}));
test('token-only mode does not require unused monetary columns',()=>fixture([['unpriced-provider','unpriced-model']],path=>{
 const script=fileURLToPath(new URL('../../skills/operator/token-chart/token-chart.ts',import.meta.url));
 const child=Bun.spawnSync([process.execPath,script,'--source','db'],{env:{...process.env,PICLAW_STORE:join(path,'..')},stdout:'pipe',stderr:'pipe'});
 expect(child.exitCode,child.stderr.toString()).toBe(0);expect(child.stderr.toString()).not.toContain('Failed to read token_usage');expect(child.stdout.toString()).toContain('total 1M');
}));

test('future unpriced records cannot contaminate the requested period',()=>fixture([['openai','gpt-6.1-sol']],path=>{
 const db=new Database(path);db.query('INSERT INTO token_usage VALUES(?,?,?,1000000,0,0,0,1000000)').run('2026-11-11T00:00:00.000Z','unpriced-provider','future-model');db.close();
 const r=generateProviderModelEstimatedCostChart({days:1,dbPath:path,now});expect(r.totalEstimatedCost).toBe(2);expect(r.unpricedGroups).toBe(0);expect(r.csv).not.toContain('future-model');
}));

test('missing database does not fabricate a zero observation',()=>{const r=generateProviderModelEstimatedCostChart({days:1,dbPath:'/does/not/exist',now});expect(r.totalEstimatedCost).toBeNull();expect(r.csv.trim().split('\n')).toHaveLength(1);expect(r.svg).toContain('costs unknown');});
