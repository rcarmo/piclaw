/** Pi 1.6.0 receipt measurement. Prerequisites and output paths: docs/development/pi-1.6.0-qualification.md. */
if (process.argv.includes('--help')) { console.log('See docs/development/pi-1.6.0-qualification.md; writes current 160 receipts only.'); process.exit(0); }
import {createHash} from 'node:crypto';
import {readFileSync,readlinkSync,mkdtempSync,rmSync} from 'node:fs';
import {join,dirname,resolve} from 'node:path';
import {tmpdir} from 'node:os';
if (!process.getuid || !process.getgid) throw Error('Linux UID/GID and network namespaces are required');
const root=resolve(import.meta.dir, '../../..');
const release = process.argv.includes('--release=1.7.0') ? '1.7.0' : process.argv.includes('--release=1.6.1') ? '1.6.1' : '1.6.0';
const witness = release.replaceAll('.','');
const artifactPath=join(root,`runtime/test/fixtures/earendil-package-admission/cli-artifact-${release}.json`);
const artifactBytes = readFileSync(artifactPath);
const artifact=JSON.parse(artifactBytes.toString('utf8'));
if (artifact.version !== release) throw Error(`Exact ${release} CLI artifact required`);
const artifactReceiptSha256=createHash('sha256').update(artifactBytes).digest('hex');
const results=[];
for(const provider of ['openai','openai-codex']) for(const mode of ['success','denied','bad-state','cancel','provider-only']) {
 const scratch=mkdtempSync(join(tmpdir(), 'cli160-remaining-')); const started=Date.now();
 try {
  const child=Bun.spawn(['sudo','-n','unshare','--net','/bin/sh','-c','ip link set lo up && exec setpriv --reuid="$1" --regid="$2" --clear-groups --bounding-set=-all --inh-caps=-all --ambient-caps=-all --no-new-privs env -i PATH="$3" HOME=/nonexistent SYNTHETIC_EXPECT_UID="$1" timeout --kill-after=2s 65s "$4" --no-env-file "$5" "$6" "$7" "$8" "$9" "${10}" "${11}"','cli-synthetic',String(process.getuid()),String(process.getgid()),dirname(process.execPath)+':/usr/bin:/bin',process.execPath,join(root,'runtime/test/agent-control/fixtures/packaged-cli-auth-120.ts'),provider,mode,scratch,readlinkSync('/proc/self/ns/net'),release,artifactReceiptSha256],{stdout:'pipe',stderr:'pipe'});
  const [exit,out,err]=await Promise.all([child.exited,new Response(child.stdout).text(),new Response(child.stderr).text()]);
  if(exit)throw Error(provider+'/'+mode+' '+err);
  results.push({...JSON.parse(out.trim().split('\n').at(-1)!),measuredDurationMs:Date.now()-started});
  console.log(provider+'/'+mode+' pass '+(Date.now()-started)+'ms');
 }finally{rmSync(scratch,{recursive:true,force:true});}
}
await Bun.write(join(root,`docs/design/earendil-agent-harness-integration-adr/evidence/receipts/earendil-${witness}-packaged-cli-auth-bun.json`),JSON.stringify({version:release,runtime:'Bun '+Bun.version,artifactReceiptSha256,bundleSha256:artifact.bundleSha256,results},null,2)+'\n');
