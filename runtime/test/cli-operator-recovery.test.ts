import {beforeEach,afterEach,expect,test} from 'bun:test';
import Database from 'bun:sqlite';
import {chmodSync,existsSync,lstatSync,mkdirSync,readFileSync,rmSync,statSync,symlinkSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {createTempWorkspace,setEnv} from './helpers.js';
import {getDb,initDatabase,closeDatabase} from '../src/db/connection.js';
import {getUser} from '../src/db/users.js';
import {createWebSession} from '../src/db/web-sessions.js';
import {provisionFamilyAccount,updateManagedAccount} from '../src/db/account-administration.js';
import {resolveRequestPrincipal} from '../src/channels/web/auth/principal.js';
import {handleOperatorRecovery} from '../src/cli-operator-recovery.js';
import {handleCliOptions} from '../src/cli.js';

let ws:ReturnType<typeof createTempWorkspace>,restore:()=>void, id:string, source:string, privateDir:string, logs:string[], original:typeof console.log;
beforeEach(()=>{
  ws=createTempWorkspace('piclaw-offline-cli-');restore=setEnv({PICLAW_WORKSPACE:ws.workspace,PICLAW_STORE:ws.store,PICLAW_DATA:ws.data});
  mkdirSync(join(ws.workspace,'.piclaw'));writeFileSync(join(ws.workspace,'.piclaw/config.json'),JSON.stringify({domains:{access:{mode:'family-shared'}}}));
  privateDir=join(ws.workspace,'private');mkdirSync(privateDir,{mode:0o700});
  closeDatabase();initDatabase();const db=getDb(), login=createWebSession('old','default',3600,'passkey');
  const actor=resolveRequestPrincipal(new Request('https://family.local',{headers:{cookie:'piclaw_session=fake'}}),{mode:'family-shared',authEnabled:true},{getSession:()=>login,getUser:()=>getUser(db,'default'),getLocalDisplayName:()=>''})!;
  id=provisionFamilyAccount(db,actor,{username:'alice',displayName:'Alice',role:'admin'}).id;
  db.query("INSERT INTO webauthn_credentials(user_id,rp_id,credential_id,public_key) VALUES (?,'family.local','lost','key')").run(id);
  updateManagedAccount(db,actor,id,{enabled:true},{totp:false,passkey:true,rpId:'family.local'});db.exec("UPDATE access_state SET activated_mode='family-shared'");
  source=join(ws.store,'messages.db');db.query('VACUUM INTO ?').run(source);closeDatabase();
  logs=[];original=console.log;console.log=(...args:unknown[])=>{logs.push(args.map(String).join(' '));};
});
afterEach(()=>{console.log=original;closeDatabase();restore();ws.cleanup();process.exitCode=0;});
const args=(action='issue')=>[action,'--user-id',id,'--username','alice','--method','passkey','--origin','https://family.local',...(action==='issue'?['--backup',join(privateDir,'before.sqlite'),'--output',join(privateDir,'grant.json'),'--writers-stopped','--key-backup-confirmed','--confirm','RECOVER alice']:[])];
function inspect(path=source){const db=new Database(path,{readonly:true});try{return {user:getUser(db,id),factors:db.query('SELECT * FROM webauthn_credentials WHERE user_id=?').all(id),events:db.query('SELECT * FROM operator_recovery_events').all(),state:db.query('SELECT * FROM access_state').all()};}finally{db.close();}}

test('offline CLI preview is read-only and issue creates verified private backup/grant without stdout secret or runtime start',async()=>{
  const before=inspect();handleOperatorRecovery(args('preview'));expect(inspect()).toEqual(before);expect(existsSync(join(privateDir,'grant.json'))).toBe(false);
  expect(await handleCliOptions(['account-recovery',...args()])).toBe(true);expect(process.exitCode??0).toBe(0);
  const grant=JSON.parse(readFileSync(join(privateDir,'grant.json'),'utf8'));expect(grant.url).toContain('/auth/invitation#token=');
  const token=new URLSearchParams(new URL(grant.url).hash.slice(1)).get('token')!;expect(logs.join('\n')).not.toContain(token);
  expect(inspect(join(privateDir,'before.sqlite'))).toEqual(before);expect(statSync(join(privateDir,'before.sqlite')).mode&0o777).toBe(0o600);expect(statSync(join(privateDir,'grant.json')).mode&0o777).toBe(0o600);
  expect(inspect().user?.enabled).toBe(false);expect(inspect().factors).toEqual([]);expect(inspect().state).toEqual(before.state);expect(inspect().events).toHaveLength(1);
  expect(existsSync(join(ws.store,'runtime.lock'))).toBe(false);
});

test('missing confirmations, unsafe/existing/symlink outputs and active/stale runtime locks reject before mutation',()=>{
  const before=inspect();expect(()=>handleOperatorRecovery(args().filter(arg=>arg!=='--writers-stopped'))).toThrow();expect(()=>handleOperatorRecovery([...args(),'--user-id',id])).toThrow();
  writeFileSync(join(ws.store,'runtime.lock'),JSON.stringify({pid:process.pid,command:'other'}));expect(()=>handleOperatorRecovery(args())).toThrow('already running');
  writeFileSync(join(ws.store,'runtime.lock'),'{bad');expect(()=>handleOperatorRecovery(args())).toThrow('already running');
  const lockPath=join(ws.store,'runtime.lock'),stale=JSON.stringify({pid:2147483647,command:'dead'}),sourceBefore=readFileSync(source);
  writeFileSync(lockPath,stale);const lockBefore=lstatSync(lockPath);
  expect(()=>handleOperatorRecovery(args())).toThrow('Offline operator cleanup required');
  expect(readFileSync(source)).toEqual(sourceBefore);expect(inspect()).toEqual(before);
  expect(readFileSync(lockPath,'utf8')).toBe(stale);expect(lstatSync(lockPath).ino).toBe(lockBefore.ino);expect(lstatSync(lockPath).dev).toBe(lockBefore.dev);
  expect(existsSync(join(privateDir,'before.sqlite'))).toBe(false);expect(existsSync(join(privateDir,'grant.json'))).toBe(false);
  // Explicit offline operator cleanup of this disposable fixture only.
  rmSync(lockPath);
  chmodSync(privateDir,0o755);expect(()=>handleOperatorRecovery(args())).toThrow('owner-only');chmodSync(privateDir,0o700);
  const unrelated=join(privateDir,'keep');writeFileSync(unrelated,'unchanged');symlinkSync(unrelated,join(privateDir,'grant.json'));expect(()=>handleOperatorRecovery(args())).toThrow('already exists');
  expect(readFileSync(unrelated,'utf8')).toBe('unchanged');expect(inspect()).toEqual(before);expect(existsSync(join(privateDir,'before.sqlite'))).toBe(false);
});

test('busy SQLite and failed write roll back, keep backup and release maintenance lock',()=>{
  const before=inspect(), writer=new Database(source);writer.exec('BEGIN IMMEDIATE');
  try {expect(()=>handleOperatorRecovery(args())).toThrow();}finally{writer.exec('ROLLBACK');writer.close();}
  expect(inspect()).toEqual(before);expect(existsSync(join(privateDir,'grant.json'))).toBe(false);expect(existsSync(join(ws.store,'runtime.lock'))).toBe(false);
  const db=new Database(source);db.exec("CREATE TRIGGER fail_audit BEFORE INSERT ON operator_recovery_events BEGIN SELECT RAISE(ABORT,'audit failed'); END");db.close();
  const next=args().map(value=>value.endsWith('before.sqlite')?join(privateDir,'second.sqlite'):value);
  expect(()=>handleOperatorRecovery(next)).toThrow('audit failed');expect(inspect()).toEqual(before);expect(existsSync(join(privateDir,'grant.json'))).toBe(false);expect(existsSync(join(privateDir,'second.sqlite'))).toBe(true);expect(existsSync(join(ws.store,'runtime.lock'))).toBe(false);
});

test('single-user/mismatched store and missing file cannot activate, create or migrate state',()=>{
  const before=inspect();writeFileSync(join(ws.workspace,'.piclaw/config.json'),JSON.stringify({domains:{access:{mode:'single-user'}}}));expect(()=>handleOperatorRecovery(args())).toThrow('configured family');expect(inspect()).toEqual(before);
  writeFileSync(join(ws.workspace,'.piclaw/config.json'),JSON.stringify({domains:{access:{mode:'family-shared'}}}));const db=new Database(source);db.exec("UPDATE access_state SET activated_mode='single-user'");db.close();expect(()=>handleOperatorRecovery(args())).toThrow('already-migrated');
  expect(existsSync(join(privateDir,'grant.json'))).toBe(false);expect(existsSync(join(privateDir,'before.sqlite'))).toBe(false);
});
