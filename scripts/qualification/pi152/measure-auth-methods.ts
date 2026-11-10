/** Measure only synthetic public SDK1.5.2 auth methods; no real accounts or inference. */
import {dirname,join,resolve} from 'node:path';
import {readlinkSync} from 'node:fs';
const root=resolve(import.meta.dir,'../../..');
const cases=[
 {name:'provider-devices',file:'provider-device-matrix-120.mjs',args:[],timeout:30000,namespace:false},
 {name:'codex-device',file:'codex-device-flow-120.mjs',args:['success','denied','malformed_device','malformed_token','cancel','slow_down'],timeout:20000,namespace:false},
 {name:'provider-browser',file:'provider-browser-matrix-120.mjs',args:[],timeout:30000,namespace:true},
];
for(const c of cases){
 const file=join(root,'runtime/test/agent-control/fixtures',c.file),path=dirname(process.execPath)+':/usr/bin:/bin';
 const command=c.namespace?['sudo','-n','unshare','--net','/bin/sh','-c',
 'ip link set lo up && exec setpriv --reuid="$1" --regid="$2" --clear-groups --bounding-set=-all --inh-caps=-all --ambient-caps=-all --no-new-privs env -i PATH="$3" HOME=/nonexistent PI_OFFLINE=1 PI_TELEMETRY=0 OTEL_SDK_DISABLED=true PI_OAUTH_CALLBACK_HOST=127.0.0.1 SYNTHETIC_PARENT_NETNS="$4" SYNTHETIC_EXPECT_UID="$1" timeout --kill-after=2s 25s "$5" --no-env-file "$6"',
 'auth152',String(process.getuid!()),String(process.getgid!()),path,readlinkSync('/proc/self/ns/net'),process.execPath,file]:[process.execPath,'--no-env-file',file,...c.args];
 const child=Bun.spawn(command,{cwd:root,env:{PATH:path,HOME:'/nonexistent',TMPDIR:process.env.TMPDIR,PI_OFFLINE:'1',PI_TELEMETRY:'0',OTEL_SDK_DISABLED:'true'},stdin:'ignore',stdout:'pipe',stderr:'pipe'});
 const timer=setTimeout(()=>child.kill('SIGKILL'),c.timeout);
 try{
  const[exit,out,err]=await Promise.all([child.exited,new Response(child.stdout).text(),new Response(child.stderr).text()]);
  if(exit!==0||err)throw Error(c.name+' failed: '+err+'\n'+out);
  const receipt=JSON.parse(out.trim());
  if(receipt.version!=='1.5.2'||!receipt.results.length||receipt.results.some((row:{status:string})=>row.status!=='pass'))throw Error('Invalid measured receipt '+c.name);
  await Bun.write(join(root,'docs/design/earendil-agent-harness-integration-adr/evidence/receipts',`earendil-152-${c.name}-bun.json`),JSON.stringify(receipt,null,2)+'\n');
  console.log(c.name+' measured '+receipt.results.length+' cases'+(receipt.copyCodeResults?' plus '+receipt.copyCodeResults.length+' copy-code cases':''));
 }finally{clearTimeout(timer);if(child.exitCode===null)child.kill('SIGKILL');await child.exited;}
}
