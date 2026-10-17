import {beforeEach,afterEach,expect,test} from 'bun:test';
import Database from 'bun:sqlite';
import {createHash,createHmac} from 'node:crypto';
import {chmodSync,existsSync,lstatSync,mkdirSync,readFileSync,rmSync,statSync,symlinkSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {createTempWorkspace,setEnv} from './helpers.js';
import {getDb,initDatabase,closeDatabase} from '../src/db/connection.js';
import {handleAccessMigration} from '../src/cli-access-migration.js';
import {handleCliOptions} from '../src/cli.js';
import {readAccessState,validateAccessStartup} from '../src/db/access-state.js';
import {readAccessMigrationInventory} from '../src/db/access-migration-plan.js';
import {adoptedJsonl} from './agent-pool/adopted-session-fixture.js';
import {RESOURCE_MIGRATION_POLICY} from '../src/db/access-resource-migration.js';
import {MIGRATION_INPUT_POLICY} from '../src/db/migration-input-holds.js';

let ws:ReturnType<typeof createTempWorkspace>,restore:()=>void,source:string,dir:string,original:typeof console.log,logs:string[];
beforeEach(()=>{
  ws=createTempWorkspace('piclaw-copy-cli-');restore=setEnv({PICLAW_WORKSPACE:ws.workspace,PICLAW_STORE:ws.store,PICLAW_DATA:ws.data});
  mkdirSync(join(ws.workspace,'.piclaw'));writeFileSync(join(ws.workspace,'.piclaw/config.json'),JSON.stringify({domains:{access:{mode:'single-user'}}}));dir=join(ws.workspace,'private');mkdirSync(dir,{mode:0o700});
  closeDatabase();initDatabase();const db=getDb();db.exec("INSERT INTO chats(jid,name,last_message_time) VALUES ('web:default','main','now'); INSERT INTO chat_branches(branch_id,chat_jid,root_chat_jid,agent_name,created_at,updated_at) VALUES ('root','web:default','web:default','main','now','now');");
  db.query("INSERT INTO messages(id,chat_jid,sender,content,timestamp) VALUES ('message','web:default','user',?,'now')").run('PRIVATE_TRANSCRIPT');source=join(ws.store,'messages.db');db.query('VACUUM INTO ?').run(source);closeDatabase();logs=[];original=console.log;console.log=(...args:unknown[])=>{logs.push(args.map(String).join(' '));};
});
afterEach(()=>{console.log=original;restore();ws.cleanup();process.exitCode=0;});
const digest=()=>createHash('sha256').update(readFileSync(source)).digest('hex');
async function preview(){await handleAccessMigration(['preview','--output',join(dir,'inventory.json')]);const inventory=JSON.parse(readFileSync(join(dir,'inventory.json'),'utf8'));for(const row of inventory.plan.assignments)row.owner_user_id='default';writeFileSync(join(dir,'plan.json'),JSON.stringify(inventory.plan));return inventory;}
const args=()=>['prepare-copy','--plan',join(dir,'plan.json'),'--destination',join(dir,'prepared.sqlite'),'--writers-stopped','--backup-set-confirmed','--confirm','PREPARE OWNERSHIP COPY'];

test('CLI creates verified copy only, preserves source bytes and keeps transcript out of inventory/stdout',async()=>{
  const before=digest();await preview();expect(readFileSync(join(dir,'inventory.json'),'utf8')).not.toContain('PRIVATE_TRANSCRIPT');
  expect(await handleCliOptions(['access-migration',...args()])).toBe(true);expect(process.exitCode??0).toBe(0);expect(digest()).toBe(before);
  const copy=new Database(join(dir,'prepared.sqlite'),{readonly:true}), originalDb=new Database(source,{readonly:true});
  try{expect(copy.query('SELECT content FROM messages').get()).toEqual({content:'PRIVATE_TRANSCRIPT'});expect(()=>readAccessState(copy)).toThrow('Prepared migration copy');expect(readAccessState(originalDb).activatedMode).toBe('single-user');expect(originalDb.query('SELECT * FROM session_roots').all()).toEqual([]);expect(copy.query('SELECT owner_user_id FROM session_roots').get()).toEqual({owner_user_id:'default'});}finally{copy.close();originalDb.close();}
  expect(statSync(join(dir,'prepared.sqlite')).mode&0o777).toBe(0o600);expect(statSync(join(dir,'inventory.json')).mode&0o777).toBe(0o600);expect(logs.join('\n')).not.toContain('PRIVATE_TRANSCRIPT');expect(existsSync(join(ws.store,'runtime.lock'))).toBe(false);
});
test('changed source or bad plan cannot prepare; existing/symlink/unsafe destinations are not overwritten',async()=>{
  await preview();const before=digest();await expect(handleAccessMigration(args().filter(value=>value!=='--writers-stopped'))).rejects.toThrow();
  const target=join(dir,'prepared.sqlite');symlinkSync(source,target);await expect(handleAccessMigration(args())).rejects.toThrow('already exists');expect(digest()).toBe(before);
  chmodSync(dir,0o755);await expect(handleAccessMigration(args())).rejects.toThrow('owner-only');chmodSync(dir,0o700);
  const db=new Database(source);db.exec("UPDATE chat_branches SET agent_name='newname'");db.close();
  await expect(handleAccessMigration(args().map(value=>value===target?join(dir,'new.sqlite'):value))).rejects.toThrow('changed');expect(existsSync(join(dir,'new.sqlite'))).toBe(false);
});
test('active/stale locks and failed destination migration leave no partial output',async()=>{
  await preview();const before=digest();writeFileSync(join(ws.store,'runtime.lock'),JSON.stringify({pid:process.pid}));await expect(handleAccessMigration(args())).rejects.toThrow('already running');
  const lockPath=join(ws.store,'runtime.lock'),stale=JSON.stringify({pid:2147483647});writeFileSync(lockPath,stale);const lockBefore=lstatSync(lockPath);
  await expect(handleAccessMigration(args())).rejects.toThrow('Offline operator cleanup required');
  expect(digest()).toBe(before);expect(readFileSync(lockPath,'utf8')).toBe(stale);expect(lstatSync(lockPath).ino).toBe(lockBefore.ino);expect(lstatSync(lockPath).dev).toBe(lockBefore.dev);
  expect(existsSync(join(dir,'prepared.sqlite'))).toBe(false);
  // Explicit offline operator cleanup of this disposable fixture only.
  rmSync(lockPath);
  const db=new Database(source);db.exec("CREATE TRIGGER reject_copy BEFORE INSERT ON session_roots BEGIN SELECT RAISE(ABORT,'copy failed'); END");
  const revised=readAccessMigrationInventory(db).plan;revised.assignments[0]!.owner_user_id='default';writeFileSync(join(dir,'plan.json'),JSON.stringify(revised));db.close();
  await expect(handleAccessMigration(args())).rejects.toThrow('copy failed');expect(existsSync(join(dir,'prepared.sqlite'))).toBe(false);expect(existsSync(join(ws.store,'runtime.lock'))).toBe(false);
  const check=new Database(source,{readonly:true});try{expect(check.query('SELECT * FROM session_roots').all()).toEqual([]);expect(readAccessState(check).activatedMode).toBe('single-user');}finally{check.close();}
  expect(digest()).not.toBe(before); // Only the test's intentional trigger changed the source.
});

test('version-two plan captures a hash-checked child tree into copy provenance without changing source files or enabling startup',async()=>{
  const db=new Database(source);db.exec("INSERT INTO chats(jid,name,last_message_time) VALUES ('web:child','child','now'); INSERT INTO chat_branches(branch_id,chat_jid,root_chat_jid,parent_branch_id,agent_name,created_at,updated_at) VALUES ('child','web:child','web:default','root','child','now','now')");db.close();
  const sessions=join(ws.data,'sessions'),parentDir=join(sessions,'web_default'),childDir=join(sessions,'web_child');mkdirSync(parentDir,{recursive:true});mkdirSync(childDir,{recursive:true});
  const parent=join(parentDir,'parent.jsonl');writeFileSync(parent,'parent');const fixture=adoptedJsonl(ws.workspace,parent),file=join(childDir,'child.jsonl');writeFileSync(file,fixture.jsonl);
  const inventory=await preview();const plan={...inventory.plan,version:2,child_sessions:[{chat_jid:'web:child',file,sha256:fixture.sha256}]};writeFileSync(join(dir,'plan.json'),JSON.stringify(plan));const before=digest();
  await handleAccessMigration(args());expect(digest()).toBe(before);expect(readFileSync(file,'utf8')).toBe(fixture.jsonl);
  const copy=new Database(join(dir,'prepared.sqlite'),{readonly:true});try{const row=copy.query("SELECT seed_json,materialised_at FROM owned_fork_operations WHERE target_branch_id='child'").get() as any;expect(JSON.parse(row.seed_json)).toEqual({version:1,mode:'adopted_jsonl',sha256:fixture.sha256,jsonl:fixture.jsonl});expect(row.materialised_at).toBeNull();expect(()=>readAccessState(copy)).toThrow();}finally{copy.close();}
  expect(logs.join('\n')).not.toContain('ADOPTED_PRIVATE');
});

test('child adoption refuses hash/path/parent/pending-seed mismatches and never leaves a partial copy',async()=>{
  const db=new Database(source);db.exec("INSERT INTO chats(jid,name,last_message_time) VALUES ('web:child','child','now'); INSERT INTO chat_branches(branch_id,chat_jid,root_chat_jid,parent_branch_id,agent_name,created_at,updated_at) VALUES ('child','web:child','web:default','root','child','now','now')");db.close();
  const parentDir=join(ws.data,'sessions','web_default'),childDir=join(ws.data,'sessions','web_child');mkdirSync(parentDir,{recursive:true});mkdirSync(childDir,{recursive:true});const parent=join(parentDir,'parent.jsonl');writeFileSync(parent,'parent');
  const fixture=adoptedJsonl(ws.workspace,parent),file=join(childDir,'child.jsonl');writeFileSync(file,fixture.jsonl);const inventory=await preview();
  for(const entry of [{chat_jid:'web:child',file,sha256:'0'.repeat(64)},{chat_jid:'web:default',file,sha256:fixture.sha256},{chat_jid:'web:child',file:parent,sha256:fixture.sha256}]){writeFileSync(join(dir,'plan.json'),JSON.stringify({...inventory.plan,version:2,child_sessions:[entry]}));await expect(handleAccessMigration(args())).rejects.toThrow();expect(existsSync(join(dir,'prepared.sqlite'))).toBe(false);}
  writeFileSync(join(dir,'plan.json'),JSON.stringify({...inventory.plan,version:2,child_sessions:[{chat_jid:'web:child',file,sha256:fixture.sha256}]}));writeFileSync(join(childDir,'.branch-seed.json'),'{}');await expect(handleAccessMigration(args())).rejects.toThrow('Pending legacy');
});

test('version-three copy revokes only copied login state and quarantines media without changing source',async()=>{
  const db=new Database(source);db.query("INSERT INTO web_sessions(token,user_id,created_at,expires_at,session_id) VALUES ('SOURCE_SECRET','default','now','later','source-login')").run();db.query("INSERT INTO media(filename,content_type,data) VALUES ('private.png','image/png',?)").run(new Uint8Array([1]));db.close();
  const inventory=await preview(),before=digest();writeFileSync(join(dir,'plan.json'),JSON.stringify({...inventory.plan,version:3,child_sessions:[],resource_policy:RESOURCE_MIGRATION_POLICY}));await handleAccessMigration(args());expect(digest()).toBe(before);
  const copy=new Database(join(dir,'prepared.sqlite'),{readonly:true}),originalDb=new Database(source,{readonly:true});
  try {expect(copy.query('SELECT count(*) n FROM web_sessions').get()).toEqual({n:0});expect(originalDb.query('SELECT count(*) n FROM web_sessions').get()).toEqual({n:1});expect(copy.query('SELECT reason FROM migration_media_quarantine').get()).toEqual({reason:'unlinked'});expect(()=>readAccessState(copy)).toThrow();}finally{copy.close();originalDb.close();}
  expect(logs.join('\n')).not.toContain('SOURCE_SECRET');expect(readFileSync(join(dir,'inventory.json'),'utf8')).not.toContain('SOURCE_SECRET');
});

test('version-four protected legacy proof import is copy-only, not logged, and rejects unexpected secret input',async()=>{
  const secret='JBSWY3DPEHPK3PXP';
  // Known RFC-compatible fixture key bytes; no external secrets/configuration are read.
  const key=Buffer.from('48656c6c6f21deadbeef','hex'),counter=Buffer.alloc(8);counter.writeBigUInt64BE(BigInt(Math.floor(Date.now()/30_000)));const digestCode=createHmac('sha1',key).update(counter).digest();const code=(digestCode.readUInt32BE(digestCode[digestCode.length-1]!&15)%0x80000000%1_000_000).toString().padStart(6,'0');
  const restoreKey=setEnv({PICLAW_KEYCHAIN_KEY:'fixture-copy-key'});
  try {
    const inventory=await preview(),before=digest(),file=join(dir,'legacy.json');writeFileSync(file,JSON.stringify({secret,code}),{mode:0o600});
    const value={...inventory.plan,version:4,child_sessions:[],resource_policy:RESOURCE_MIGRATION_POLICY,factor_policy:{passkeys:'preserve-immutable-handles',legacy_totp:'import-default'}};
    writeFileSync(join(dir,'plan.json'),JSON.stringify(value));await expect(handleAccessMigration(args())).rejects.toThrow('Protected TOTP');expect(existsSync(join(dir,'prepared.sqlite'))).toBe(false);
    await handleAccessMigration([...args(),'--legacy-totp-file',file]);expect(digest()).toBe(before);expect(logs.join('\n')).not.toContain(secret);expect(logs.join('\n')).not.toContain(code);expect(readFileSync(join(dir,'inventory.json'),'utf8')).not.toContain(secret);
    const copy=new Database(join(dir,'prepared.sqlite'),{readonly:true}),originalDb=new Database(source,{readonly:true});
    try{expect(copy.query('SELECT user_id FROM user_totp_factors').get()).toEqual({user_id:'default'});expect(originalDb.query('SELECT count(*) n FROM user_totp_factors').get()).toEqual({n:0});expect(()=>readAccessState(copy)).toThrow();}finally{copy.close();originalDb.close();}
    value.factor_policy.legacy_totp='none';writeFileSync(join(dir,'plan.json'),JSON.stringify(value));await expect(handleAccessMigration([...args().map(v=>v===join(dir,'prepared.sqlite')?join(dir,'another.sqlite'):v),'--legacy-totp-file',file])).rejects.toThrow('Protected TOTP');
    expect(existsSync(file)).toBe(true);
  }finally{restoreKey();}
});

test('version-five copy records legacy holds then promotes into a separate startable family database',async()=>{
  const sourceDb=new Database(source);sourceDb.exec("UPDATE messages SET timestamp='2026-09-06T00:00:00.000Z'");sourceDb.close();
  const inventory=await preview(),before=digest();writeFileSync(join(dir,'plan.json'),JSON.stringify({...inventory.plan,version:5,child_sessions:[],resource_policy:RESOURCE_MIGRATION_POLICY,factor_policy:{passkeys:'preserve-immutable-handles',legacy_totp:'none'},input_policy:MIGRATION_INPUT_POLICY}));await handleAccessMigration(args());expect(digest()).toBe(before);
  const preparedPath=join(dir,'prepared.sqlite'),preparedBefore=createHash('sha256').update(readFileSync(preparedPath)).digest('hex');
  const copy=new Database(preparedPath,{readonly:true});try{expect(copy.query('SELECT message_id,chat_jid,owner_user_id FROM migration_input_holds').get()).toEqual({message_id:'message',chat_jid:'web:default',owner_user_id:'default'});expect(copy.query('SELECT * FROM message_execution_authorities').all()).toEqual([]);expect(copy.query('SELECT * FROM migration_input_dismissals').all()).toEqual([]);expect(()=>readAccessState(copy)).toThrow();}finally{copy.close();}
  writeFileSync(join(ws.workspace,'.piclaw/config.json'),JSON.stringify({domains:{access:{mode:'family-shared'}}}));const promotedPath=join(dir,'promoted.sqlite');
  await handleAccessMigration(['promote-copy','--prepared',preparedPath,'--destination',promotedPath,'--source-snapshot',inventory.snapshot,'--writers-stopped','--backup-set-confirmed','--confirm','PROMOTE FAMILY COPY']);
  expect(digest()).toBe(before);expect(createHash('sha256').update(readFileSync(preparedPath)).digest('hex')).toBe(preparedBefore);expect(statSync(promotedPath).mode&0o777).toBe(0o600);
  const promoted=new Database(promotedPath,{readonly:true});try{expect(readAccessState(promoted).activatedMode).toBe('family-shared');expect(validateAccessStartup(promoted,join(ws.workspace,'.piclaw/config.json')).effectiveMode).toBe('family-shared');expect(promoted.query('SELECT source_snapshot,plan_version FROM access_migration_promotion').get()).toEqual({source_snapshot:inventory.snapshot,plan_version:5});}finally{promoted.close();}
});

test('promotion requires explicit family config reviewed snapshot confirmations and a fresh destination',async()=>{
  const sourceDb=new Database(source);sourceDb.exec("UPDATE messages SET timestamp='2026-09-06T00:00:00.000Z'");sourceDb.close();
  const inventory=await preview();writeFileSync(join(dir,'plan.json'),JSON.stringify({...inventory.plan,version:5,child_sessions:[],resource_policy:RESOURCE_MIGRATION_POLICY,factor_policy:{passkeys:'preserve-immutable-handles',legacy_totp:'none'},input_policy:MIGRATION_INPUT_POLICY}));await handleAccessMigration(args());
  const prepared=join(dir,'prepared.sqlite'),target=join(dir,'promoted.sqlite'),base=['promote-copy','--prepared',prepared,'--destination',target,'--source-snapshot',inventory.snapshot,'--writers-stopped','--backup-set-confirmed','--confirm','PROMOTE FAMILY COPY'];
  await expect(handleAccessMigration(base)).rejects.toThrow('explicit domains.access.mode');
  writeFileSync(join(ws.workspace,'.piclaw/config.json'),JSON.stringify({domains:{access:{mode:'family-shared'}}}));
  await expect(handleAccessMigration(base.filter(value=>value!=='--writers-stopped'))).rejects.toThrow();
  await expect(handleAccessMigration(base.map(value=>value===inventory.snapshot?'0'.repeat(64):value))).rejects.toThrow('does not match');expect(existsSync(target)).toBe(false);
  await expect(handleAccessMigration(base.map(value=>value===target?prepared:value))).rejects.toThrow();
  writeFileSync(target,'existing');await expect(handleAccessMigration(base)).rejects.toThrow('already exists');expect(readFileSync(target,'utf8')).toBe('existing');
});
