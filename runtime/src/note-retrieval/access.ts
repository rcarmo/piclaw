import { lstatSync, realpathSync, readSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Database } from 'bun:sqlite';
import { getRuntimeConfigPaths } from '../core/config-context.js';
import { readAccessConfig } from '../core/config-access.js';
import { getExecutionIdentity } from '../core/execution-context.js';
import { getChatJid } from '../core/chat-context.js';
import { getDatabaseBinding, getDb } from '../db/connection.js';

export class NoteIndexDenied extends Error { constructor() { super('Note index access denied.'); this.name = 'NoteIndexDenied'; } }
export interface NoteBinding { version: 1; mode: 'single-user'; workspace: string; store: string; data: string; database: string; databaseIdentity: string; identities: string[] }
const identityOf = (path: string) => { const stat = lstatSync(path); if (stat.isSymbolicLink()) throw new NoteIndexDenied(); return `${stat.dev}:${stat.ino}`; };
function expectedRoots(): Omit<NoteBinding, 'identities' | 'databaseIdentity'> {
  const paths = getRuntimeConfigPaths();
  const [workspace, store, data] = [paths.workspaceDir, paths.storeDir, paths.dataDir].map(p => realpathSync(p));
  return { version: 1, mode: 'single-user', workspace, store, data, database: realpathSync(resolve(store, 'messages.db')) };
}
export function admitNoteIndexMetadata() {
  const identity = getExecutionIdentity(); let revoked = false;
  const paths = getRuntimeConfigPaths();
  const roots = [paths.workspaceDir, paths.storeDir, paths.dataDir];
  const validate = () => {
    try {
      const current = getRuntimeConfigPaths();
      const currentRoots = [current.workspaceDir, current.storeDir, current.dataDir];
      if (revoked || readAccessConfig(current.configPath).mode !== 'single-user' || getExecutionIdentity() !== identity
        || roots.some((root, i) => root !== currentRoots[i])
        || (identity && (identity.mode !== 'single-user' || !Object.isFrozen(identity) || !Object.isFrozen(identity.provenance)
          || identity.provenance.ownerUserId !== 'default' || identity.provenance.actorUserId !== 'default'
          || identity.rootChatJid !== 'web:default' || identity.provenance.chatJid !== getChatJid('')))) throw new NoteIndexDenied();
    } catch { revoked = true; throw new NoteIndexDenied(); }
  };
  validate(); return validate;
}
/** Parent capture only. A serialised binding alone never grants a writer API. */
export function captureNoteIndexBinding(): NoteBinding {
  return admitNoteIndexStore().binding;
}
/** Metadata/control operations pin the same roots and live DB instance as the writer parent. */
export function admitNoteIndexStore(): { binding: NoteBinding; database: Database; validate: () => void } {
  const access=admitNoteIndexMetadata(),database=getDb(),roots=expectedRoots();
  const opened=getDatabaseBinding();
  if(!opened||realpathSync(opened.path)!==roots.database||opened.identity!==identityOf(roots.database))throw new NoteIndexDenied();
  const binding:NoteBinding={...roots,databaseIdentity:opened.identity,identities:[roots.workspace,roots.store,roots.data,roots.database].map(identityOf)};
  let revoked=false;
  const validate=()=>{
    try{
      access();const current=expectedRoots(),openedNow=getDatabaseBinding();const expected:NoteBinding={...current,databaseIdentity:identityOf(current.database),identities:[current.workspace,current.store,current.data,current.database].map(identityOf)};
      const file=(database.query('PRAGMA database_list').all() as Array<{name:string;file:string}>).find(row=>row.name==='main')?.file;
      if(revoked||getDb()!==database||!openedNow||openedNow.identity!==binding.databaseIdentity||JSON.stringify(expected)!==JSON.stringify(binding)||!file||realpathSync(file)!==binding.database)throw new NoteIndexDenied();
    }catch{revoked=true;throw new NoteIndexDenied();}
  };
  validate();return {binding,database,validate};
}
/** Consumes only inherited fd 3. No query/CLI argument can supply writer authority. */
export function receiveNoteIndexBinding(): { binding: NoteBinding; validate: () => void; bindDatabase: (db: Database) => void } {
  const access = admitNoteIndexMetadata();
  if (getExecutionIdentity()) throw new NoteIndexDenied();
  let binding: NoteBinding;
  try {
    const bytes = Buffer.alloc(8193); let used = 0;
    while (used < bytes.length) { const count = readSync(3, bytes, used, bytes.length - used, null); if (!count) break; used += count; }
    if (!used || used > 8192) throw new NoteIndexDenied();
    binding = JSON.parse(bytes.subarray(0, used).toString('utf8'));
  } catch { throw new NoteIndexDenied(); }
  let database: Database | undefined; let revoked = false;
  const validate = () => {
    try {
      access();
      const roots=expectedRoots();
      const expected:NoteBinding={...roots,databaseIdentity:identityOf(roots.database),identities:[roots.workspace,roots.store,roots.data,roots.database].map(identityOf)};
      if (revoked || JSON.stringify(expected) !== JSON.stringify(binding) || (database && getDb() !== database)) throw new NoteIndexDenied();
      if (database) {
        const file = (database.query('PRAGMA database_list').all() as Array<{ name: string; file: string }>).find(row => row.name === 'main')?.file;
        if (!file || realpathSync(file) !== binding.database) throw new NoteIndexDenied();
      }
    } catch { revoked = true; throw new NoteIndexDenied(); }
  };
  validate(); return { binding, validate, bindDatabase: db => { database = db; validate(); } };
}
