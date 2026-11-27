import { describe, expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { initializeDatabaseSchema } from '../../../src/db/connection.js';
import { hashCanonicalRequest } from '../../../src/service-effects/contracts/common.js';
import { projectA2uiPromptInput } from '../../../src/channels/web/a2ui/transport-metadata.js';
import { projectPublicA2uiInput, storeA2uiInputMetadata } from '../../../src/channels/web/a2ui/input-metadata.js';
import { CLASSIC_A2UI_RENDERER_CAPABILITIES } from '../../../src/channels/web/a2ui/capabilities.js';
import { readApplicationMessagePayload } from '../../../durable-engine/src/accepted-payload-recovery.ts';

function fixture(chatJid = 'chat') {
  const db = new Database(':memory:');
  db.exec(`CREATE TABLE messages(id TEXT,chat_jid TEXT,content TEXT);
    CREATE TABLE submissions(id INTEGER PRIMARY KEY,record TEXT);
    CREATE TABLE entries(id INTEGER PRIMARY KEY,record TEXT);`);
  for (const table of ['piclaw_durable_bindings_v1','piclaw_durable_intent_bindings_v1'])
    db.exec(`CREATE TABLE ${table}(conversation_id INTEGER,operation_id TEXT,source_seq INTEGER,branch_id TEXT,request_id TEXT,request_hash TEXT,chat_jid TEXT,source_id TEXT,payload_ref TEXT,incarnation TEXT,submission_id INTEGER)`);
  const proof = { incarnation:'inc',conversationId:23,chatJid,branchId:'branch',operationId:'op',sourceSeq:2,sourceId:'steer',payloadRef:'queued-source:steer',requestId:'queued-steer:steer',requestHash:'hash' };
  function bind(table: string, change: Record<string,unknown> = {}) {
    const p = {...proof,...change};
    db.query(`INSERT INTO ${table} VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run(p.conversationId,p.operationId,p.sourceSeq,p.branchId,p.requestId,p.requestHash,p.chatJid,p.sourceId,p.payloadRef,p.incarnation,7);
  }
  function entry(change: Record<string,unknown> = {}) {
    db.query('INSERT OR REPLACE INTO submissions VALUES(?,?)').run(7,JSON.stringify({entry:8}));
    db.query('INSERT OR REPLACE INTO entries VALUES(?,?)').run(8,JSON.stringify({kind:'host.accepted',conversationId:23,data:proof,model:[{role:'user',content:'accepted steering input'}],...change}));
  }
  const read = (conversationId?: number) => readApplicationMessagePayload(db,'inc',{chatJid,sourceId:'steer',conversationId},'queued-source:steer');
  return {db,proof,bind,entry,read};
}

test('renderer negotiation never enters fresh accepted input and legacy projections stay read-only', () => {
  using db = new Database(':memory:');
  initializeDatabaseSchema(db);
  db.exec('PRAGMA foreign_keys=ON');
  db.query('INSERT INTO chats (jid) VALUES (?)').run('web:sync');
  const sender = { chatJid:'web:sync', sourceId:'input', conversationId:23 };
  const {lastInsertRowid} = db.query(`INSERT INTO messages (id,chat_jid,is_bot_message,content) VALUES (?, ?, 0, ?)`).run(sender.sourceId,sender.chatJid,'Continue');
  const ref = `message-row:${lastInsertRowid}`;
  const metadata = {version:'1.0' as const,surfaces:{form:{synced:'draft value'}}};
  const rendererMessage = {version:'1.0' as const,action:{surfaceId:'form',sourceComponentId:'submit',name:'save',timestamp:'2026-11-22T09:00:00Z',
    context:{},metadata:{extensions:{rendererExample:true}}}};
  const write = () => storeA2uiInputMetadata(db,sender,metadata,CLASSIC_A2UI_RENDERER_CAPABILITIES,undefined,rendererMessage);
  expect(write).toThrow();
  db.transaction(write)();
  expect(() => db.transaction(write)()).toThrow();
  expect((db.query('SELECT metadata FROM a2ui_input_metadata').get() as {metadata:string}).metadata).not.toContain('a2uiRendererCapabilities');
  // Older releases persisted this suffix. New admission must use only user
  // text; filtering old history must leave its immutable records unchanged.
  const privatePayload=`Continue\n\nA2UI renderer metadata:\n${JSON.stringify({a2uiRendererDataModel:metadata,
    a2uiRendererMessage:rendererMessage})}`;
  expect(readApplicationMessagePayload(db,'inc',sender,ref)).toBe('Continue');
  expect(projectPublicA2uiInput(db,sender,privatePayload)).toBe('Continue');
  expect(projectPublicA2uiInput(db,{...sender,conversationId:24},privatePayload)).toBe('Continue');
  const before=db.serialize();
  expect(projectA2uiPromptInput(privatePayload)).toBe('Continue');
  // Filtering is independent of the current conversation, so forked/inherited
  // histories cannot reintroduce the old suffix or trigger history-table scans.
  expect(projectA2uiPromptInput('Continue')).toBe('Continue');
  const requestId='old-request',requestHash=hashCanonicalRequest({type:'input',requestId,content:privatePayload});
  expect(readApplicationMessagePayload(db,'inc',{...sender,requestId,requestHash},ref)).toBe(privatePayload);
  expect(db.serialize()).toEqual(before);
  const literal='Literal heading\n\nA2UI renderer metadata:\n{"test":true}';
  db.query(`INSERT INTO messages (id,chat_jid,is_bot_message,content) VALUES (?, ?, 0, ?)`).run('literal',sender.chatJid,literal);
  expect(projectPublicA2uiInput(db,{...sender,sourceId:'literal'},literal)).toBe(literal);
  expect(projectA2uiPromptInput(literal)).toBe(literal);
  expect(projectA2uiPromptInput('Example\n\nA2UI renderer metadata:\nnot JSON')).toBe('Example\n\nA2UI renderer metadata:\nnot JSON');
  expect(readApplicationMessagePayload(db,'inc',sender,`queued-source:${sender.sourceId}`)).toBe(readApplicationMessagePayload(db,'inc',sender,ref));
  expect(readApplicationMessagePayload(db,'inc',{...sender,conversationId:24},ref)).toBe('Continue');
  expect(readApplicationMessagePayload(db,'inc',{chatJid:sender.chatJid,sourceId:sender.sourceId},ref)).toBe('Continue');
  expect(db.query('SELECT content,content_blocks FROM messages WHERE rowid=?').get(lastInsertRowid)).toEqual({content:'Continue',content_blocks:null});
  db.query('DELETE FROM messages WHERE rowid=?').run(lastInsertRowid);
  expect(projectPublicA2uiInput(db,sender,privatePayload)).toBe('Continue');
  expect(db.query('SELECT COUNT(*) AS count FROM a2ui_input_metadata').get()).toEqual({count:0});
});

describe('accepted payload recovery from SDK primary and steering bindings', () => {
  test('recovers removed steering projection from its SDK accepted intent; no database writes', () => {
    const f=fixture(); try {
      f.bind('piclaw_durable_intent_bindings_v1'); f.entry();
      const before=f.db.serialize();
      expect(f.read()).toBe('accepted steering input');
      expect(f.db.serialize()).toEqual(before);
    } finally {f.db.close();}
  });
  test('requires the exact web recipient for accepted SDK input after timeline deletion', () => {
    const f = fixture('web:sync');
    try {
      f.bind('piclaw_durable_bindings_v1');
      const payload = 'Unchanged message\n\nA2UI renderer metadata:\n{"a2uiRendererDataModel":{"version":"1.0","surfaces":{"form":{"name":"example"}}}}';
      f.entry({model:[{role:'user',content:payload}]});
      expect(() => f.read()).toThrow('Unverified SDK accepted payload');
      expect(() => f.read(24)).toThrow('Unverified SDK accepted payload');
      expect(f.read(23)).toBe(payload);
    } finally { f.db.close(); }
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
