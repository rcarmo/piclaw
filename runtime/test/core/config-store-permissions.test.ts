import {expect,spyOn,test} from 'bun:test';
import * as fs from 'node:fs';
import {join} from 'node:path';
import {createTempWorkspace} from '../helpers.js';
import {preparePrivateJsonConfig} from '../../src/core/config-store.js';
test('startup config privacy migration preserves bytes, inode and repeated-read identity',()=>{
 const fixture=createTempWorkspace('private-config-');try{const path=join(fixture.workspace,'config.json'),text='{"private":"SYNTHETIC_KEEP_BYTES"}\n';expect(preparePrivateJsonConfig(path)).toBe('absent');fs.writeFileSync(path,text,{mode:0o644});const before=fs.statSync(path);expect(preparePrivateJsonConfig(path)).toBe('migrated');expect(fs.statSync(path).mode&0o777).toBe(0o600);expect(fs.statSync(path).ino).toBe(before.ino);expect(fs.readFileSync(path,'utf8')).toBe(text);expect(preparePrivateJsonConfig(path)).toBe('unchanged');}finally{fixture.cleanup();}
});
test('startup config privacy migration never follows links or changes non-regular inputs',()=>{
 const fixture=createTempWorkspace('private-config-links-');try{const original=join(fixture.workspace,'original.json'),symlink=join(fixture.workspace,'link.json'),hard=join(fixture.workspace,'hard.json');fs.writeFileSync(original,'ORIGINAL',{mode:0o644});fs.symlinkSync(original,symlink);expect(preparePrivateJsonConfig(symlink)).toBe('unavailable');expect(fs.statSync(original).mode&0o777).toBe(0o644);fs.linkSync(original,hard);expect(preparePrivateJsonConfig(hard)).toBe('unavailable');expect(fs.statSync(original).mode&0o777).toBe(0o644);expect(fs.readFileSync(original,'utf8')).toBe('ORIGINAL');expect(preparePrivateJsonConfig(fixture.workspace)).toBe('unavailable');}finally{fixture.cleanup();}
});
test('a foreign descriptor owner cannot trigger a config permission change',()=>{
 const fixture=createTempWorkspace('private-config-owner-'),path=join(fixture.workspace,'config.json');fs.writeFileSync(path,'UNCHANGED',{mode:0o644});const stat=fs.statSync(path),read=spyOn(fs,'fstatSync').mockReturnValue({...stat,uid:stat.uid+1,isFile:()=>true} as fs.Stats);
 try{expect(preparePrivateJsonConfig(path)).toBe('unavailable');expect(fs.statSync(path).mode&0o777).toBe(0o644);expect(fs.readFileSync(path,'utf8')).toBe('UNCHANGED');}finally{read.mockRestore();fixture.cleanup();}
});
