import assert from 'node:assert/strict';
import {readFileSync,readlinkSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';

// Fail before any SDK import/profile access in the ordinary host namespace.
assert.ok(process.versions.bun);
assert.ok(process.env.SYNTHETIC_PARENT_NETNS);
assert.notEqual(readlinkSync('/proc/self/ns/net'),process.env.SYNTHETIC_PARENT_NETNS,'A distinct network namespace is required');
assert.deepEqual(readFileSync('/proc/net/dev','utf8').trim().split('\n').slice(2).map(l=>l.split(':')[0].trim()),['lo']);
assert.equal(readFileSync('/proc/net/route','utf8').trim().split('\n').length,1);
assert.equal(process.getuid(),Number(process.env.SYNTHETIC_EXPECT_UID));assert.notEqual(process.getuid(),0);
const status=readFileSync('/proc/self/status','utf8');
for(const field of ['CapInh','CapPrm','CapEff','CapBnd','CapAmb'])assert.match(status,new RegExp(field+':\\s+0{16}(?:\\n|$)'));
assert.match(status,/NoNewPrivs:\s+1(?:\n|$)/);assert.match(status,/Groups:\s*\n/);
const provider=process.argv[2];assert.ok(['meta','xai'].includes(provider));
const originalFetch=globalThis.fetch;let bootstrapRequests=0;
const deny=()=>{bootstrapRequests++;throw Error('Unexpected import network');};
globalThis.fetch=Object.assign(deny,{preconnect:deny});
const root=import.meta.resolve('@earendil-works/pi-ai');
assert.equal(JSON.parse(readFileSync(fileURLToPath(new URL('../package.json',root)),'utf8')).version,'1.6.0');
const pins=JSON.parse(readFileSync(new URL('./provider-oauth-160-hashes.json',import.meta.url),'utf8'));
assert.equal(pins.version,'1.6.0');
for(const[file,sha]of Object.entries(pins.files))assert.equal(createHash('sha256').update(readFileSync(fileURLToPath(new URL(file,root)))).digest('hex'),sha);
const {builtinProviders}=await import('@earendil-works/pi-ai/providers/all');assert.equal(bootstrapRequests,0);
const oauth=builtinProviders().find(p=>p.id===provider)?.auth.oauth;assert.ok(oauth);
const modes=['success','denied','malformed-device','unsafe-uri','malformed-token','poll-cancel','initial-wait-cancel','pending-wait-cancel','expiry','refresh-denied','refresh-cancel',...(provider==='xai'?['refresh-rotate']:[])];
const results=[];
const meta=provider==='meta',client=meta?'1031625952748946':'b1a00492-073a-47ea-816f-4c329264a828';
const deviceUrl=meta?'https://auth.meta.com/oidc/device/authorization/':'https://auth.x.ai/oauth2/device/code';
const pollUrl=meta?'https://auth.meta.com/oidc/device/token/':'https://auth.x.ai/oauth2/token';
const mintUrl='https://api.meta.ai/muse-code/key',verification=meta?'https://auth.meta.com/verify':'https://auth.x.ai/verify';
try{
 for(const mode of modes){
  const controller=new AbortController(),counts={device:0,poll:0,mint:0,refresh:0,unexpected:0};
  let deviceEvent=false,progress=0,abortObserved=false,settled=false,lateEvents=0,lateRequests=0,timer,deadline=false;
  const watchdog=setTimeout(()=>{deadline=true;controller.abort(new Error('Fixture watchdog'));},10000);
  const cancelSoon=()=>{timer=setTimeout(()=>controller.abort(),25);};
  const blocked=signal=>new Promise((_resolve,reject)=>{
   signal.addEventListener('abort',()=>{abortObserved=true;reject(new DOMException('Synthetic abort','AbortError'));},{once:true});
   queueMicrotask(()=>controller.abort());
  });
  const json=(data,status=200)=>Response.json(data,{status});
  try{
   globalThis.fetch=Object.assign(async(input,init)=>{
    if(settled){lateRequests++;throw Error('Late provider request');}
    const url=String(input),headers=new Headers(init?.headers);assert.ok(init?.signal);init.signal.throwIfAborted();
    assert.equal(init.method,'POST');assert.equal(headers.get('accept'),'application/json');
    if(meta&&url===mintUrl){
     counts.mint++;assert.equal(headers.get('authorization'),'Bearer synthetic-meta-identity');
     assert.equal(headers.get('content-type'),'application/json');assert.equal(headers.get('x-api-version'),'1.0.0');assert.equal(init.body,'{}');
     if(mode==='refresh-cancel')return blocked(init.signal);
     if(mode==='refresh-denied')return json({error:'expired'},403);
     return json({api_key:counts.mint===1?'synthetic-meta-key':'synthetic-meta-rotated-key'});
    }
    if(url!==deviceUrl&&url!==pollUrl){counts.unexpected++;throw Error('Unexpected provider endpoint');}
    assert.equal(headers.get('content-type'),'application/x-www-form-urlencoded');
    const body=new URLSearchParams(init.body);assert.equal(body.get('client_id'),client);
    if(url===deviceUrl){
     counts.device++;
     assert.deepEqual([...body.keys()].sort(),meta?['client_id']:['client_id','referrer','scope']);
     if(!meta){assert.equal(body.get('referrer'),'pi');assert.equal(body.get('scope'),'openid profile email offline_access grok-cli:access api:access');}
     if(mode==='malformed-device')return json({device_code:'synthetic-device'});
     return json({device_code:'synthetic-device',user_code:'SYNTHETIC-CODE',verification_uri:mode==='unsafe-uri'?'javascript:alert(1)':verification,verification_uri_complete:mode==='unsafe-uri'?'javascript:alert(1)':verification+'?synthetic=1',interval:1,expires_in:mode==='expiry'?0.1:60});
    }
    if(body.get('grant_type')==='refresh_token'){
     assert.equal(meta,false);counts.refresh++;
     assert.deepEqual([...body.keys()].sort(),['client_id','grant_type','refresh_token']);assert.equal(body.get('refresh_token'),'synthetic-xai-refresh');
     if(mode==='refresh-cancel')return blocked(init.signal);
     if(mode==='refresh-denied')return json({error:'invalid_grant'},400);
     // Successful refresh may deliberately omit refresh_token on xAI.
     return json({access_token:'synthetic-xai-rotated',...(mode==='refresh-rotate'?{refresh_token:'synthetic-xai-refresh-rotated'}:{}),expires_in:3600});
    }
    counts.poll++;assert.deepEqual([...body.keys()].sort(),['client_id','device_code','grant_type']);
    assert.equal(body.get('grant_type'),'urn:ietf:params:oauth:grant-type:device_code');assert.equal(body.get('device_code'),'synthetic-device');
    if(mode==='poll-cancel')return blocked(init.signal);
    if(mode==='pending-wait-cancel'){cancelSoon();return json({error:'authorization_pending'},400);}
    if(mode==='expiry')return json({error:'authorization_pending'},400);
    if(mode==='denied')return json({error:'access_denied'},400);
    if(mode==='malformed-token')return json({unsupported:true});
    return json(meta?{access_token:'synthetic-meta-identity'}:{access_token:'synthetic-xai-access',refresh_token:'synthetic-xai-refresh',expires_in:3600});
   },{preconnect(){counts.unexpected++;throw Error('No preconnect');}});
   const interaction={signal:controller.signal,prompt:async()=>{throw Error('Device-only provider must not prompt');},notify(event){
    if(settled){lateEvents++;throw Error('Late provider event');}
    if(event.type==='progress'){assert.equal(meta,true);assert.equal(event.message,'Enabling Meta Model API access...');progress++;return;}
    assert.equal(event.type,'device_code');assert.equal(deviceEvent,false);deviceEvent=true;
    assert.equal(event.userCode,'SYNTHETIC-CODE');assert.equal(event.verificationUri,verification+'?synthetic=1');
    assert.equal(event.intervalSeconds,1);assert.equal(event.expiresInSeconds,mode==='expiry'?0.1:60);
    if(mode==='initial-wait-cancel')cancelSoon();
   }};
   const previous={type:'oauth',access:'synthetic-previous',refresh:meta?'synthetic-meta-identity':'synthetic-xai-refresh',expires:1};
   const previousBytes=JSON.stringify(previous),refreshOnly=mode.startsWith('refresh-'),started=Date.now();
   const operation=refreshOnly?oauth.refresh(previous,controller.signal):oauth.login(interaction);
   if(mode==='success'||mode==='refresh-rotate'){
    const credential=await operation;assert.equal(credential.type,'oauth');
    assert.equal(credential.access,meta?'synthetic-meta-key':mode==='refresh-rotate'?'synthetic-xai-rotated':'synthetic-xai-access');
    assert.equal(credential.refresh,meta?'synthetic-meta-identity':mode==='refresh-rotate'?'synthetic-xai-refresh-rotated':'synthetic-xai-refresh');
    const lifetime=meta?86400000:3300000;assert.ok(credential.expires>=started+lifetime&&credential.expires<=Date.now()+lifetime);
    assert.deepEqual(await oauth.toAuth(credential),{apiKey:credential.access});
    if(!refreshOnly){
     const before=JSON.stringify(credential),refreshed=await oauth.refresh(credential,controller.signal);
     assert.equal(refreshed.access,meta?'synthetic-meta-rotated-key':'synthetic-xai-rotated');assert.equal(refreshed.refresh,credential.refresh);
     assert.equal(JSON.stringify(credential),before);assert.deepEqual(await oauth.toAuth(refreshed),{apiKey:refreshed.access});
    }
   }else await assert.rejects(operation,mode.includes('cancel')?/cancel|abort/i:mode==='denied'?/denied/i:mode==='expiry'?/timed out/i:mode==='refresh-denied'?/expired|invalid_grant/i:/invalid|untrusted|failed/i);
   assert.equal(JSON.stringify(previous),previousBytes);assert.equal(deadline,false,'No watchdog-driven result is a passing scenario');
   settled=true;const snapshot={...counts};await Bun.sleep(25);assert.deepEqual(counts,snapshot);assert.equal(lateEvents,0);assert.equal(lateRequests,0);assert.equal(counts.unexpected,0);
   assert.equal(counts.device,refreshOnly?0:1);
   const polled=!refreshOnly&&!['malformed-device','unsafe-uri','initial-wait-cancel','expiry'].includes(mode);
   // A timer can wake just before the millisecond deadline; a still-pending
   // grant must expire either way, never turn into a synthetic success.
   if(mode==='expiry')assert.ok(counts.poll<=1);else assert.equal(counts.poll,polled?1:0);
   assert.equal(deviceEvent,!refreshOnly&&!['malformed-device','unsafe-uri'].includes(mode));
   if(meta){assert.equal(counts.mint,mode==='success'?2:refreshOnly?1:0);assert.equal(progress,mode==='success'?1:0);}
   else assert.equal(counts.refresh,mode==='success'||refreshOnly?1:0);
   if(mode==='poll-cancel'||mode==='refresh-cancel')assert.equal(abortObserved,true);
   results.push({provider,mode,status:'pass',requests:counts,deviceEventObserved:deviceEvent,transportCancellationObserved:abortObserved,lateEvents,lateRequests});
  }finally{clearTimeout(watchdog);clearTimeout(timer);controller.abort();}
 }
 console.log(JSON.stringify({version:'1.6.0',runtime:`Bun ${Bun.version}`,scope:'public_meta_xai_device_refresh_only',provider,results,sdkFileSha256:pins.files,bootstrapRequests,credentialPersistence:'none',inference:'not_invoked',networkGuard:'distinct_loopback_only_namespace_exact_fetch',privilegesDropped:true}));
}finally{globalThis.fetch=originalFetch;}
