import { expect, test } from 'bun:test';
import { createTempWorkspace } from '../helpers.js';
import { resolve } from 'node:path';

for (const mode of ['success', 'close-failure', 'constructor-failure'] as const) test(`Root close retains checkpoint ownership and terminal certainty: ${mode}`, async () => {
  const ws = createTempWorkspace('root-close-binding-'), failure = mode !== 'success', constructorFailure = mode === 'constructor-failure';
  const script = `
    const fs=require('node:fs'),read=fs.readFileSync,stat=fs.statSync;let poison=false;
    fs.readFileSync=(path,...args)=>path==='/proc/self/mountinfo'?'1 0 0:1 / / rw - zfs fixture rw':read(path,...args);
    fs.statSync=(path,...args)=>{const value=stat(path,...args);return poison&&String(path).endsWith('messages.db')?{...value,ino:value.ino+1}:value};
    const {Database}=await import('bun:sqlite');let worker,peer,peerClosed=false,ready=false,original;
    const transaction=Database.prototype.transaction;Database.prototype.transaction=function(...args){original??=this;return transaction.apply(this,args)};
    globalThis.Worker=class extends EventTarget {
      constructor(){super();worker=this;}
      postMessage(data){if(data.type==='close'){peer.exec('BEGIN IMMEDIATE');if(${failure})this.dispatchEvent(new MessageEvent('message',{data:{type:'close-error',error:'fixture SQLite close failed'}}));}
       else {peer=new Database(data.path);poison=${constructorFailure};queueMicrotask(()=>{this.dispatchEvent(new MessageEvent('message',{data:{type:'ready'}}));ready=true;});}}
      confirm(){peer.exec('ROLLBACK');peer.close();peerClosed=true;this.dispatchEvent(new MessageEvent('message',{data:{type:'closed'}}));}
      terminate(){if(!peerClosed)throw Error('Worker termination preceded SQLite close acknowledgement');}
    };
    const core=await import('./src/db/connection.ts');const {RuntimeStartupCleanupError}=await import('./src/runtime/startup-cleanup-error.ts');
    let initFailed=false;try{core.initDatabase()}catch{initFailed=true}while(!ready)await Bun.sleep(1);
    let closing;try{closing=Promise.resolve(core.closeDatabase())}catch(error){closing=Promise.reject(error)}let unpublished=false,pending=false;
    try{core.getDb()}catch{unpublished=true}try{core.initDatabase()}catch(error){pending=error.message.includes('cleanup is pending')||error instanceof RuntimeStartupCleanupError}
    let rejected=false,first;try{if(!${failure})worker.confirm();await closing}catch(error){rejected=true;first=error}
    let oldClosed=false;try{original.query('SELECT 1').get()}catch{oldClosed=true}
    let held=false,repeated=false;
    if(${failure}){try{core.initDatabase()}catch(error){held=error instanceof RuntimeStartupCleanupError}try{await core.closeDatabase()}catch(error){repeated=error===first}worker.confirm();original.close();}
    console.log(JSON.stringify({initFailed,unpublished,pending,rejected,oldClosed,held,repeated}));
  `;
  const child = Bun.spawn([process.execPath, '--no-env-file', '--eval', script], { cwd: resolve(import.meta.dir, '../..'), env: {
    ...process.env, PICLAW_WORKSPACE: ws.workspace, PICLAW_STORE: ws.store, PICLAW_DATA: ws.data, PICLAW_DB_IN_MEMORY: '0',
  }, stdin: 'ignore', stdout: 'pipe', stderr: 'pipe' });
  try {
    const [exit, out, err] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
    expect(exit, err).toBe(0); expect(JSON.parse(out.trim().split('\n').at(-1)!)).toEqual({ initFailed: constructorFailure, unpublished: true, pending: true, rejected: failure, oldClosed: !failure, held: failure, repeated: failure });
  } finally { if (child.exitCode === null) child.kill(); await child.exited; ws.cleanup(); }
});
