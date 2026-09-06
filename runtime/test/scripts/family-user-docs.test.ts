import { expect, test } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

const root=join(import.meta.dir,'../../..');
const paths=['docs/multi-user/user-guide.md','docs/multi-user/administrator-guide.md','docs/multi-user/troubleshooting.md','docs/multi-user/migration-copy.md','docs/multi-user/operator-recovery.md','docs/multi-user/README.md','docs/multi-user/scheduled-execution.md','docs/multi-user/memory-bootstrap.md'];
const read=(path:string)=>readFileSync(resolve(root,path),'utf8');
const stripCode=(text:string)=>text.replace(/^```[^\n]*\n[\s\S]*?^```\s*$/gm,'');
function headings(text:string):string[]{return [...stripCode(text).matchAll(/^#{1,6} (.+)$/gm)].map(m=>m[1]!.toLowerCase().replace(/<[^>]*>/g,'').replace(/[^\p{L}\p{N}\s_-]/gu,'').replace(/\s/g,'-'));}

test('family user/operator documentation links and anchors resolve without duplicate headings',()=>{
  for(const path of paths){
    const text=read(path),anchors=headings(text);expect(new Set(anchors).size).toBe(anchors.length);expect(text.split('\n').length).toBeLessThan(500);
    for(const match of stripCode(text).matchAll(/\[[^\]]*\]\(([^\s)]+)\)/g)){
      const href=match[1]!;if(/^[a-z]+:|^\/\//i.test(href))continue;
      const [file,fragment]=href.split('#');const target=file?resolve(root,dirname(path),decodeURIComponent(file)):resolve(root,path);
      expect(existsSync(target)).toBe(true);
      if(fragment&&target.endsWith('.md'))expect(headings(readFileSync(target,'utf8'))).toContain(decodeURIComponent(fragment));
    }
  }
});

test('family guides cover user controls, destructive effects and gated operator workflows',()=>{
  const user=read(paths[0]!),admin=read(paths[1]!),help=read(paths[2]!);
  const source=['runtime/web/static/family.html','runtime/web/static/login.html','runtime/web/static/invitation.html','runtime/web/src/family-sessions.ts','runtime/web/src/family-administration.ts','runtime/web/src/family-account.ts','runtime/web/src/family-results.ts','runtime/web/src/family-tasks.ts','runtime/web/src/family.ts'].map(read).join('\n');
  for(const label of ['My account','My preferences','My sessions','Sign out','Sign in with a passkey','Verify code','Begin authenticator setup','Create account passkey','Save profile','Save avatar','Add another passkey','Confirm authenticator','Save preferences','Save model defaults','Create root','Save session change','Set home','Archive','Restore','Retry held message','Dismiss legacy input without running']){
    expect(user).toContain(`**${label}**`);expect(source).toContain(label);
  }
  for(const label of ['Download transcript','Prepare transcript','Save text file','Cancel transcript']){
    expect(user).toContain(`**${label}**`);expect(source).toContain(label);
  }
  for(const label of ['Scheduled results','Inspect result','Publish result','Refresh results','Close results','Cancel execution authority']){
    expect(user).toContain(`**${label}**`);expect(source).toContain(label);
  }
  expect(user).toContain('Conversations and saved settings persist on the server');
  const memorySource=read('runtime/web/src/family-memory.ts')+source;
  for(const label of ['Family memory','Preview for family memory','Publish memory','Refresh memory history','Inspect memory','View shared memory','Retry same memory publication','Discard memory draft','Withdraw memory','Close memory']){
    expect(user).toContain(`**${label}**`);expect(memorySource).toContain(label);
  }
  for(const label of ['Prepared tasks','Prepare paused task','Inspect task','Revoke task grant','Refresh tasks','Close tasks','Discard task draft','Retry same preparation']){
    expect(user).toContain(`**${label}**`);expect(source).toContain(label);
  }
  for(const term of ['UTC','128 KiB','100 unrevoked grants','request ID'])expect(user).toContain(term);
  for(const label of ['Run once','Retry same run request']){expect(user).toContain(`**${label}**`);expect(source).toContain(label);}
  for(const term of ['2,000 messages','8 MiB','32,000 characters','partial file','atomic database snapshot'])expect(user).toContain(term);
  for(const label of ['Family administration','Create account','Issue invitation','Issue passkey invitation','Revoke invitation','Reset account','Reset to passkey','Security','Assign home','Tool restrictions','Save tool restrictions']){
    expect(admin).toContain(`**${label}**`);expect(source).toContain(label);
  }
  for(const document of [user,admin]){expect(document).toContain('single-user deployments only');expect(document).toContain('troubleshooting.md');}
  expect(user).toContain('Removing a factor signs out every device');expect(user).toContain('Workspace files are shared');expect(user).toContain('separate browser profiles');expect(user).toContain('100 text messages');expect(user).toContain('2 MiB');
  expect(admin).toContain('last enabled administrator');expect(admin).toContain('recovery-only startup');
  for(const term of ['invitation','Legacy input','Prepared migration copy','Too many attempts','Uncertain','bootstrap key'])expect(help.toLowerCase()).toContain(term.toLowerCase());
  expect(read('README.md')).toContain('docs/multi-user/user-guide.md');expect(read('docs/web-ui.md')).toContain('multi-user/administrator-guide.md');
});
