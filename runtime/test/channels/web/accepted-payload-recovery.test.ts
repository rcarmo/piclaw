import { describe, expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { readApplicationMessagePayload } from '../../../durable-engine/src/accepted-payload-recovery.ts';

function fixture() {
  const db = new Database(':memory:');
  db.exec(`CREATE TABLE messages(id TEXT,chat_jid TEXT,content TEXT);
    CREATE TABLE submissions(id INTEGER PRIMARY KEY,record TEXT);
    CREATE TABLE entries(id INTEGER PRIMARY KEY,record TEXT);`);
  for (const table of ['piclaw_durable_bindings_v1','piclaw_durable_intent_bindings_v1'])
    db.exec(`CREATE TABLE ${table}(conversation_id INTEGER,operation_id TEXT,source_seq INTEGER,branch_id TEXT,request_id TEXT,request_hash TEXT,chat_jid TEXT,source_id TEXT,payload_ref TEXT,incarnation TEXT,submission_id INTEGER)`);
  const proof = { incarnation:'inc',conversationId:23,chatJid:'chat',branchId:'branch',operationId:'op',sourceSeq:2,sourceId:'steer',payloadRef:'queued-source:steer',requestId:'queued-steer:steer',requestHash:'hash' };
  function bind(table: string, change: Record<string,unknown> = {}) {
    const p = {...proof,...change};
    db.query(`INSERT INTO ${table} VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run(p.conversationId,p.operationId,p.sourceSeq,p.branchId,p.requestId,p.requestHash,p.chatJid,p.sourceId,p.payloadRef,p.incarnation,7);
  }
  function entry(change: Record<string,unknown> = {}) {
    db.query('INSERT OR REPLACE INTO submissions VALUES(?,?)').run(7,JSON.stringify({entry:8}));
    db.query('INSERT OR REPLACE INTO entries VALUES(?,?)').run(8,JSON.stringify({kind:'host.accepted',conversationId:23,data:proof,model:[{role:'user',content:'accepted steering input'}],...change}));
  }
  const read = () => readApplicationMessagePayload(db,'inc',{chatJid:'chat',sourceId:'steer'},'queued-source:steer');
  return {db,proof,bind,entry,read};
}

describe('accepted payload recovery from SDK primary and steering bindings', () => {
  test('recovers removed steering projection from its SDK accepted intent; no database writes', () => {
    const f=fixture(); try {
      f.bind('piclaw_durable_intent_bindings_v1'); f.entry();
      const before=f.db.serialize();
      expect(f.read()).toBe('accepted steering input');
      expect(f.db.serialize()).toEqual(before);
    } finally {f.db.close();}
  });
  test('retains primary accepted-input recovery', () => {
    const f=fixture(); try {f.bind('piclaw_durable_bindings_v1');f.entry();expect(f.read()).toBe('accepted steering input');} finally {f.db.close();}
  });
  test('retains exact timeline projection lookup', () => {
    const f=fixture();try {f.db.query('INSERT INTO messages VALUES(?,?,?)').run('steer','chat','projected input');expect(f.read()).toBe('projected input');} finally {f.db.close();}
  });
  test('missing SDK acceptance stays fail-closed', () => {
    const f=fixture();try {f.bind('piclaw_durable_intent_bindings_v1');expect(f.read).toThrow('Unverified application payload');} finally {f.db.close();}
  });
  test('wrong incarnation stays fail-closed', () => {
    const f=fixture();try {f.bind('piclaw_durable_intent_bindings_v1',{incarnation:'other'});f.entry();expect(f.read).toThrow('Unverified application payload');} finally {f.db.close();}
  });
  test('forged SDK correlation stays fail-closed', () => {
    const f=fixture();try {f.bind('piclaw_durable_intent_bindings_v1');f.entry({data:{...f.proof,requestHash:'changed'}});expect(f.read).toThrow('Unverified SDK accepted payload');} finally {f.db.close();}
  });
  test('wrong SDK conversation stays fail-closed', () => {
    const f=fixture();try {f.bind('piclaw_durable_intent_bindings_v1');f.entry({conversationId:24});expect(f.read).toThrow('Unverified SDK accepted payload');} finally {f.db.close();}
  });
  test('ambiguous binding across primary and intent tables stays fail-closed', () => {
    const f=fixture();try {f.bind('piclaw_durable_bindings_v1');f.bind('piclaw_durable_intent_bindings_v1');f.entry();expect(f.read).toThrow('Unverified application payload');} finally {f.db.close();}
  });
});
