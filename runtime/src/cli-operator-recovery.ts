import Database from 'bun:sqlite';
import { constants, closeSync, fsyncSync, lstatSync, openSync, realpathSync, rmSync, writeFileSync, chmodSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { getStoreDir, getWorkspaceDir } from './core/config-context.js';
import { readAccessConfig } from './core/config-access.js';
import { getWebRuntimeConfig } from './core/config-web.js';
import { readKeychainBootstrapKeyMaterial } from './core/config-secrets.js';
import { acquireRuntimeLock } from './runtime/single-instance.js';
import { createVerifiedSqliteBackup } from './db/backup.js';
import { inspectOperatorRecovery, issueOperatorRecovery, type OperatorRecoveryInput } from './secure/operator-recovery.js';

export function parseOperatorRecoveryArgs(args: string[]): { action:'preview'|'issue'|'serve'; apply: boolean; input?: OperatorRecoveryInput; recoveryId?:string; origin?:string; backup?: string; output?: string } {
  const [action, ...flags] = args;
  if (action !== 'preview' && action !== 'issue' && action !== 'serve') throw new Error('Use account-recovery preview|issue|serve.');
  const values = new Map<string,string>();
  const booleanFlags = ['--writers-stopped','--key-backup-confirmed'];
  const allowed = action==='serve'?['--recovery-id','--origin','--confirm','--writers-stopped']:['--user-id','--username','--method','--origin', ...(action === 'issue' ? ['--backup','--output','--confirm',...booleanFlags] : [])];
  for (let i=0;i<flags.length;i++) {
    const flag = flags[i]!;
    if (!allowed.includes(flag) || values.has(flag)) throw new Error('Unknown or duplicate recovery option.');
    const value = booleanFlags.includes(flag) ? 'yes' : flags[++i];
    if (!value || value.startsWith('--')) throw new Error('Missing recovery option value.');
    values.set(flag,value);
  }
  if(action==='serve'){const recoveryId=values.get('--recovery-id'),origin=values.get('--origin');if(!recoveryId||!origin||!values.has('--writers-stopped')||values.get('--confirm')!==`SERVE RECOVERY ${recoveryId}`)throw new Error('Serve requires --recovery-id, --origin, --writers-stopped and --confirm "SERVE RECOVERY <id>".');return {action,apply:false,recoveryId,origin};}
  const input = {userId:values.get('--user-id')!,username:values.get('--username')!,method:values.get('--method') as 'totp'|'passkey',origin:values.get('--origin')!};
  if (!input.userId || !input.username || !input.origin || !['totp','passkey'].includes(input.method)) throw new Error('Exact user ID, username, method and HTTPS origin are required.');
  if (action === 'issue' && (!values.get('--backup') || !values.get('--output') || !values.has('--writers-stopped') || !values.has('--key-backup-confirmed') || values.get('--confirm') !== `RECOVER ${input.username}`)) {
    throw new Error('Issue requires --backup, --output, --writers-stopped, --key-backup-confirmed and --confirm "RECOVER <username>".');
  }
  return {action,apply:action==='issue',input,backup:values.get('--backup'),output:values.get('--output')};
}

function protectedDestination(path: string, source: string): string {
  const parent = realpathSync(dirname(resolve(path))), stat = lstatSync(parent);
  if (!stat.isDirectory() || (stat.mode & 0o077) !== 0 || (process.getuid && stat.uid !== process.getuid())) throw new Error('Backup and grant require an existing owner-only directory (0700).');
  const destination = join(parent, resolve(path).split('/').at(-1)!);
  if ([source,source+'-wal',source+'-shm',join(dirname(source),'runtime.lock')].includes(destination)) throw new Error('Recovery outputs cannot replace runtime state.');
  try { lstatSync(destination); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return destination; throw error; }
  throw new Error('Recovery output already exists. Choose a new path.');
}

/** Explicit operator CLI only: never starts/migrates the normal runtime or prints grant secrets. */
export function handleOperatorRecovery(args: string[]): void|Promise<void> {
  const options = parseOperatorRecoveryArgs(args), config = readAccessConfig();
  if (config.mode !== 'family-shared') throw new Error('Offline recovery requires configured family-shared mode; it cannot activate a deployment.');
  if(options.action==='serve')return import('./secure/operator-recovery-server.js').then(({serveOperatorRecovery})=>serveOperatorRecovery({recoveryId:options.recoveryId!,origin:options.origin!}));
  const input=options.input!;
  const policy = getWebRuntimeConfig().passkeyMode;
  if ((input.method === 'passkey' && policy === 'totp-only') || (input.method === 'totp' && policy === 'passkey-only')) throw new Error('Recovery method is disabled by configured authentication policy.');
  if (input.method === 'totp' && !readKeychainBootstrapKeyMaterial()) throw new Error('TOTP recovery requires the existing factor-encryption bootstrap key.');
  const requestedSource = join(getStoreDir(),'messages.db');
  if (!lstatSync(requestedSource).isFile()) throw new Error('Existing regular, non-symlink database required.');
  const source = realpathSync(requestedSource);
  const lock = acquireRuntimeLock({lockPath:join(dirname(source),'runtime.lock'),disabled:false,maintenance:true});
  let db: Database | undefined, output: string | undefined, outputCreated = false, committed = false;
  try {
    db = new Database(source,{readwrite:true,create:false,strict:true});
    db.exec('PRAGMA busy_timeout=0');
    const preview = inspectOperatorRecovery(db,input);
    if (!options.apply) { console.log(JSON.stringify({workspace:getWorkspaceDir(),database:source,...preview,warning:'Offline issue removes this administrator’s factors and logins. Backup/key coordination required; startup remains gated.'})); return; }
    const backup = protectedDestination(options.backup!,source); output = protectedDestination(options.output!,source);
    if (backup === output) throw new Error('Backup and grant output must differ.');
    // O_EXCL + NOFOLLOW reserves the secret destination before any destructive write.
    const fd = openSync(output,constants.O_CREAT|constants.O_EXCL|constants.O_WRONLY|constants.O_NOFOLLOW,0o600); outputCreated = true;
    try {
      const version = (db.query('PRAGMA data_version').get() as {data_version:number}).data_version;
      createVerifiedSqliteBackup(db,source,backup); chmodSync(backup,0o600);
      const result = db.transaction(() => {
        if ((db!.query('PRAGMA data_version').get() as {data_version:number}).data_version !== version) throw new Error('Database changed during backup. Stop every writer and retry with new output paths.');
        return issueOperatorRecovery(db!,input,grant => { writeFileSync(fd,JSON.stringify(grant)+'\n'); fsyncSync(fd); });
      }).immediate();
      committed = true;
      console.log(JSON.stringify({...result,backup,output,warning:'Grant is in the protected file only. Startup remains gated; no service was started or restarted.'}));
    } finally { closeSync(fd); }
  } finally {
    try { db?.close(); }
    finally {
      try { if (outputCreated && !committed && output) rmSync(output,{force:true}); }
      finally { lock.release(); }
    }
  }
}
