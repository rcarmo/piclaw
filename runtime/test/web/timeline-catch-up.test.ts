import {expect,test} from 'bun:test';
import {fetchContiguousTimeline} from '../../web/src/ui/use-timeline.js';
const rows=(from:number,to:number)=>Array.from({length:to-from+1},(_,n)=>({id:from+n}));
test('cache return fills all newer pages before joining cached history',async()=>{
 const calls:Array<{limit:number;before:number|null}>=[];const result=await fetchContiguousTimeline(rows(1,20),async(limit:number,before:number|null)=>{calls.push({limit,before});const end=before===null?145:before-1;return{posts:rows(Math.max(1,end-limit+1),end).reverse(),has_more:end-limit>=1};});
 expect(calls).toEqual([{limit:50,before:null},{limit:50,before:96},{limit:50,before:46}]);expect(result!.posts.map(row=>row.id).sort((a,b)=>a-b)).toEqual(rows(1,145).map(row=>row.id));
});
test('bounded catch-up drops disconnected cached rows instead of a phantom gap',async()=>{
 let requests=0;const result=await fetchContiguousTimeline([{id:1}],async(limit:number,before:number|null)=>{requests++;const end=before===null?10000:before-1;return{posts:rows(end-limit+1,end),has_more:true};});expect(requests).toBe(10);expect(result!.posts).toHaveLength(500);expect(result!.posts.some(row=>row.id===1)).toBe(false);expect(result!.has_more).toBe(true);
});
test('stale chat or realtime mutation cancels catch-up without publishing partial data',async()=>{
 let current=true;expect(await fetchContiguousTimeline([{id:1}],async()=>{current=false;return{posts:rows(50,100),has_more:true};},()=>current)).toBeNull();
});
test('a failed page remains rejected so a later refresh can retry rather than cement a gap',async()=>{
 await expect(fetchContiguousTimeline([{id:1}],async()=>{throw Error('synthetic network');})).rejects.toThrow('synthetic network');
});
test('a malformed page never clears the cached timeline as an authoritative empty result',async()=>{
 await expect(fetchContiguousTimeline([{id:1}],async()=>({ok:true}))).rejects.toThrow('Invalid timeline page');
});
test('an isolated SSE newest ID does not move the verified contiguous boundary',async()=>{
 const cache=[...rows(1,20),{id:145}],calls:number[]=[];
 const result=await fetchContiguousTimeline(cache,async(limit:number,before:number|null)=>{const end=before===null?145:before-1;calls.push(end);return{posts:rows(Math.max(1,end-limit+1),end),has_more:end-limit>=1};},()=>true,20);
 expect(calls).toEqual([145,95,45]);expect(result!.posts.map(row=>row.id).sort((a,b)=>a-b)).toEqual(rows(1,145).map(row=>row.id));
});
test('without a verified boundary catch-up proves the oldest retained suffix rather than an SSE maximum',async()=>{
 const cache=[...rows(1,20),{id:145}],calls:number[]=[];const result=await fetchContiguousTimeline(cache,async(limit:number,before:number|null)=>{const end=before===null?145:before-1;calls.push(end);return{posts:rows(Math.max(1,end-limit+1),end),has_more:end-limit>=1};});expect(calls).toEqual([145,95,45]);expect(result!.posts).toHaveLength(145);
});
test('an unverified zero boundary with individual rows uses the conservative oldest suffix',async()=>{
 const calls:number[]=[],result=await fetchContiguousTimeline([{id:1},{id:145}],async(limit:number,before:number|null)=>{const end=before===null?145:before-1;calls.push(end);return{posts:rows(Math.max(1,end-limit+1),end),has_more:end-limit>=1};},()=>true,0);expect(calls).toEqual([145,95,45]);expect(result!.posts).toHaveLength(145);
});
test('reconnect revalidates an older cached A2UI form even when the newest page joins the timeline', async () => {
 const form=(state:string,revision:number)=>({id:25,data:{content_blocks:[{type:'a2ui_surface',state,revision}]}});
 const cache=[...rows(1,120).filter(row=>row.id!==25),form('active',1)];
 const completed=form('completed',2);
 const calls:(number|null)[]=[];
 const result=await fetchContiguousTimeline(cache,async(limit:number,before:number|null)=>{
   calls.push(before);
   const end=before===null?120:before-1;
   return {posts:rows(Math.max(1,end-limit+1),end).map(row=>row.id===25?completed:row).reverse(),has_more:end>limit};
 },()=>true,120);
 expect(calls).toEqual([null,71]);
 expect(result?.posts.find(row=>row.id===25)).toEqual(completed);
 expect(result?.posts).toHaveLength(120);
});

test('an older active form beyond the catch-up cap is not restored from cache', async () => {
 const stale={id:25,data:{content_blocks:[{type:'a2ui_surface',state:'active',revision:1}]}};
 let calls=0;
 const result=await fetchContiguousTimeline([stale,{id:1000}],async(limit:number,before:number|null)=>{
   calls++;
   const end=before===null?1000:before-1;
   return {posts:rows(end-limit+1,end).reverse(),has_more:true};
 },()=>true,1000);
 expect(calls).toBe(10);
 expect(result?.posts).toHaveLength(500);
 expect(result?.posts).not.toContain(stale);
});

test('an SSE mutation during a multi-page catch-up invalidates the whole candidate',async()=>{
 let version=0,calls=0;expect(await fetchContiguousTimeline(rows(1,20),async(limit:number,before:number|null)=>{if(++calls===2)version++;const end=before===null?145:before-1;return{posts:rows(end-limit+1,end),has_more:true};},()=>version===0,20)).toBeNull();expect(calls).toBe(2);
});
