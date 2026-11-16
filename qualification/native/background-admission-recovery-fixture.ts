import { expect } from 'bun:test';
import type { Database } from 'bun:sqlite';
import { cpSync,existsSync,mkdirSync,readFileSync,rmSync,writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createVerifiedSqliteBackup,verifySqliteBackup } from '../../runtime/src/db/backup.js';
import { captureNativeRecoveryUnit,verifyNativeRecoveryUnit,type RecoveryEnvironment } from '../../runtime/scripts/lib/native-recovery-unit.js';
import { qualifyNativeRecoveryUnit } from '../../runtime/durable-engine/src/recovery-unit-qualification.js';
/** Source is the quiescent isolated native factory, never a production profile.
 * Capture/qualification see selected offline copies only. */
export async function backgroundAdmissionRecoveryFixture(root:Database,workspace:string,dataDir:string,configuration:string,completed=false,expectedInputs=1,expectedAnswers=completed?1:0,coreRevision='1f893deeb5f15bb34cbdb3593da5f9171d9ae3e6'){
  const base=join(workspace,'background-admission-recovery');mkdirSync(base,{mode:0o700});
  const source=join(base,'source.sqlite'),answers=join(base,'answers'),files=join(base,'files'),addons=join(base,'addons');
  for(const path of [answers,files,addons])mkdirSync(path,{mode:0o700});
  const sourcePath=(root.query('PRAGMA database_list').all() as {name:string;file:string}[]).find(row=>row.name==='main')!.file;
  createVerifiedSqliteBackup(root,sourcePath,source);cpSync(join(dataDir,'durable-answers'),answers,{recursive:true});
  const config=join(base,'configuration.json');writeFileSync(config,readFileSync(configuration),{mode:0o600});
  const environment:RecoveryEnvironment={runtime:{coreRevision,sdkVersion:'1.4.0',bunVersion:Bun.version},addonWorkspace:addons,
    configurations:[{id:'operation-policy-fixture',path:config}],credentialReferences:[],credentialReferenceAvailable:()=>{throw Error('Keyless fixture has no credential references');}};
  const output=join(base,'unit'),manifest=await captureNativeRecoveryUnit({database:source,answers,workspace:files,output,environment});
  expect(manifest.references.map(row=>row.owner).sort()).toEqual([...Array.from({length:expectedAnswers},()=> 'native-answer' as const),...Array.from({length:expectedInputs},()=> 'native-background-input' as const)]);
  expect(await verifyNativeRecoveryUnit(output,environment)).toEqual(manifest);
  expect((await qualifyNativeRecoveryUnit(output,environment,join(base,'qualified'))).scheduling).toBe('paused');
  const payload=manifest.references.find(row=>row.owner==='native-background-input')!,path=join(answers,payload.file.slice('payloads/'.length)),saved=readFileSync(path);
  rmSync(path);expect(verifySqliteBackup(source).integrityCheck).toBe('ok');
  await expect(captureNativeRecoveryUnit({database:source,answers,workspace:files,output:join(base,'missing'),environment})).rejects.toThrow('payload missing');
  expect(existsSync(join(base,'missing/manifest.json'))).toBe(false);
  const tampered=JSON.parse(saved.toString('utf8'));tampered.prompt='must not replace immutable accepted input';writeFileSync(path,JSON.stringify(tampered),{mode:0o600});
  await expect(captureNativeRecoveryUnit({database:source,answers,workspace:files,output:join(base,'changed'),environment})).rejects.toThrow('Invalid native background');
  expect(existsSync(join(base,'changed/manifest.json'))).toBe(false);writeFileSync(path,saved,{mode:0o600});
  expect(await verifyNativeRecoveryUnit(output,environment)).toEqual(manifest);
}
