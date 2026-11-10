/** Pi 1.5.2 receipt measurement. Prerequisites and output paths: docs/development/pi-1.5.2-qualification.md. */
if (process.argv.includes('--help')) { console.log('See docs/development/pi-1.5.2-qualification.md; writes current 152 receipts only.'); process.exit(0); }
import {createHash} from 'node:crypto';
import {readFileSync,readlinkSync,mkdtempSync,rmSync} from 'node:fs';
import {join,dirname,resolve} from 'node:path';
import {tmpdir} from 'node:os';
if (!process.getuid || !process.getgid) throw Error('Linux UID/GID and network namespaces are required');
const root=resolve(import.meta.dir, '../../..');
const artifactPath=join(root,'runtime/test/fixtures/earendil-package-admission/cli-artifact-1.5.2.json');
const artifact=JSON.parse(readFileSync(artifactPath,'utf8'));
if (artifact.version !== '1.5.2') throw Error('Exact 1.5.2 CLI artifact required');
const results=[];
for(const provider of ['openai','openai-codex']) for(const mode of ['success','denied','bad-state','cancel','provider-only']) {
 const scratch=mkdtempSync(join(tmpdir(), 'cli152-remaining-')); const started=Date.now();
 try {
  const child=Bun.spawn(['sudo','-n','unshare','--net','/bin/sh','-c','ip link set lo up && exec setpriv --reuid="$1" --regid="$2" --clear-groups --bounding-set=-all --inh-caps=-all --ambient-caps=-all --no-new-privs env -i PATH="$3" HOME=/nonexistent SYNTHETIC_EXPECT_UID="$1" timeout --kill-after=2s 65s "$4" --no-env-file "$5" "$6" "$7" "$8" "$9"','cli152',String(process.getuid()),String(process.getgid()),dirname(process.execPath)+':/usr/bin:/bin',process.execPath,join(root,'runtime/test/agent-control/fixtures/packaged-cli-auth-120.ts'),provider,mode,scratch,readlinkSync('/proc/self/ns/net')],{stdout:'pipe',stderr:'pipe'});
  const [exit,out,err]=await Promise.all([child.exited,new Response(child.stdout).text(),new Response(child.stderr).text()]);
  if(exit)throw Error(provider+'/'+mode+' '+err);
  results.push({...JSON.parse(out.trim().split('\n').at(-1)!),measuredDurationMs:Date.now()-started});
  console.log(provider+'/'+mode+' pass '+(Date.now()-started)+'ms');
 }finally{rmSync(scratch,{recursive:true,force:true});}
}
await Bun.write(join(root,'docs/design/earendil-agent-harness-integration-adr/evidence/receipts/earendil-152-packaged-cli-auth-bun.json'),JSON.stringify({version:'1.5.2',runtime:'Bun '+Bun.version,artifactReceiptSha256:createHash('sha256').update(readFileSync(artifactPath)).digest('hex'),bundleSha256:artifact.bundleSha256,results},null,2)+'\n');
