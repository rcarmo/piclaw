import './src/test-guard.js';
import { expect,test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { createHash } from 'node:crypto';
import { chmodSync, copyFileSync, existsSync, mkdtempSync, readFileSync, rmSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { nativeGoalFixture } from './src/native-goal-default-fixture.js';
import { handleAgentMessage } from '../../runtime/src/channels/web/handlers/agent.js';
import { reclaimOfflineSdkHistory } from '../../runtime/durable-engine/src/offline-sdk-history-reclaim.js';

const digest = (path: string) => createHash('sha256').update(readFileSync(path)).digest('hex');
async function archivedFixture() {
  const f = await nativeGoalFixture();
  const dbPath = (f.root.query('PRAGMA database_list').get() as {file:string}).file;
  try {
    const branch = await f.pool.createRootChatSession('offline-erasure-target');
    const say = async (chat: string, text: string) => {
      const response = await handleAgentMessage(f.channel, new Request('https://fixture/agent/default/message', {
        method:'POST', headers:{'content-type':'application/json'}, body:JSON.stringify({content:text}),
      }), '/agent/default/message', chat, 'default');
      expect(response.status).toBe(201);
      const {submission_id} = await response.json() as {submission_id:number};
      await f.until(() => f.status(submission_id) === 'done');
      await f.until(() => !!f.root.query('SELECT 1 FROM messages WHERE chat_jid=? AND is_terminal_agent_reply=1').get(chat));
      return submission_id;
    };
    f.held.release();
    const survivor = await say('web:default','NEIGHBOURWITNESS');
    await say(branch.chat_jid,'ERASUREWITNESS ' + 'large offline fixture text '.repeat(240));
    const archived = await f.pool.pruneChatBranch(branch.chat_jid);
    expect(archived.archived_at).toBeTruthy();
    return { branch, dbPath, survivor };
  } finally { await f.close(); }
}

test('reclaim an archived native Piclaw session and reopen the same compacted store in Piclaw 1.7.0', async () => {
  const f = await archivedFixture();
  const dir = mkdtempSync(join(process.env.PICLAW_WORKSPACE!, 'archive-reclaim-'));
  try {
    const source = join(dir,'source.sqlite'), output = join(dir,'output.sqlite');
    expect(existsSync(f.dbPath+'-wal')).toBe(false);
    copyFileSync(f.dbPath,source); chmodSync(source,0o600);
    const chatJid = f.branch.chat_jid, branchId = f.branch.branch_id;
    let conversationId: number, targetMessageId: string, survivorRows: unknown[];
    {
      // The private copy is WAL-format even after the production connection is closed.
      // Read the exact binding, then close a DELETE-mode copy before hashing it: a
      // read-only open of a WAL main file would create source sidecars.
      using db = new Database(source,{create:false,strict:true});
      conversationId = (db.query('SELECT conversation_id FROM piclaw_durable_bindings_v1 WHERE chat_jid=?').get(chatJid) as {conversation_id:number}).conversation_id;
      targetMessageId = (db.query('SELECT id FROM messages WHERE chat_jid=? AND is_bot_message=0 LIMIT 1').get(chatJid) as {id:string}).id;
      survivorRows = db.query(`SELECT rowid,* FROM messages WHERE chat_jid='web:default' ORDER BY rowid`).all();
      db.exec('PRAGMA wal_checkpoint(TRUNCATE); PRAGMA journal_mode=DELETE');
    }
    expect(existsSync(source+'-wal')).toBe(false);
    expect(existsSync(source+'-shm')).toBe(false);
    const before = digest(source);
    const options = { sourcePath:source,outputPath:output,expectedSourceSha256:before,conversationId, piclawArchive: {chatJid,branchId} };
    const receipt = await reclaimOfflineSdkHistory(options);
    expect(receipt).toMatchObject({ sdkVersion:'1.7.0',publication:'durable',piclawArchive:{removedHostRows:{messages:2,chat_branches:1}} });
    expect(digest(source)).toBe(before);
    expect(readFileSync(output).includes('ERASUREWITNESS')).toBe(false);
    const dangling = join(dir,'dangling.sqlite'), danglingOutput = join(dir,'dangling-output.sqlite');
    copyFileSync(source,dangling); chmodSync(dangling,0o600);
    {
      using db = new Database(dangling,{create:false,strict:true});
      const survivor = db.query(`SELECT source_seq FROM service_effect_s01_sources WHERE chat_jid='web:default' LIMIT 1`).get() as {source_seq:number};
      expect(survivor).toBeTruthy();
      db.query(`UPDATE service_effect_s01_sources SET payload_ref=? WHERE chat_jid='web:default' AND source_seq=?`)
        .run(`queued-source:${targetMessageId}`,survivor.source_seq);
      db.exec('PRAGMA wal_checkpoint(TRUNCATE); PRAGMA journal_mode=DELETE');
    }
    const danglingBefore = digest(dangling);
    await expect(reclaimOfflineSdkHistory({...options,sourcePath:dangling,outputPath:danglingOutput,expectedSourceSha256:danglingBefore})).rejects.toThrow('retained dependency in service_effect_s01_sources');
    expect(existsSync(danglingOutput)).toBe(false);
    expect(digest(dangling)).toBe(danglingBefore);
    const wrongOutput = join(dir,'wrong-tuple.sqlite');
    const sourceBeforeWrongTuple = digest(source);
    await expect(reclaimOfflineSdkHistory({...options,conversationId:conversationId+1,outputPath:wrongOutput})).rejects.toThrow('exact archive routing binding is absent');
    expect(existsSync(wrongOutput)).toBe(false);
    expect(digest(source)).toBe(sourceBeforeWrongTuple);
    {
      using compact = new Database(output,{readonly:true});
      expect(compact.query('SELECT 1 FROM conversations WHERE id=?').get(conversationId)).toBeNull();
      expect(compact.query('SELECT 1 FROM chat_branches WHERE chat_jid=?').get(chatJid)).toBeNull();
      expect(compact.query(`SELECT rowid,* FROM messages WHERE chat_jid='web:default' ORDER BY rowid`).all()).toEqual(survivorRows);
      expect(compact.query(`SELECT rowid FROM messages_fts WHERE messages_fts MATCH 'NEIGHBOURWITNESS'`).all()).toHaveLength(1);
      expect(compact.query(`SELECT rowid FROM messages_fts WHERE messages_fts MATCH 'ERASUREWITNESS'`).all()).toEqual([]);
    }
    // Replace only our closed disposable fixture, then open the real factory.
    copyFileSync(output,f.dbPath);
    unlinkSync(join(process.env.PICLAW_WORKSPACE!, '.pi/extensions/node_modules/@rcarmo/piclaw-addon-goal/node_modules'));
    const reopened = await nativeGoalFixture();
    try {
      expect(reopened.calls()).toBe(0);
      expect(reopened.status(f.survivor)).toBe('done');
      expect(reopened.pool.listKnownChats(null,{includeArchived:true}).some(row=>row.chat_jid===chatJid)).toBe(false);
      reopened.held.release();
      const next = await reopened.send('Next synthetic input after reclaim');
      await reopened.until(()=>reopened.status(next.submission_id)==='done');
      expect(reopened.calls()).toBe(1);
    } finally { await reopened.close(); }
  } finally { rmSync(dir,{recursive:true,force:true}); }
},30_000);
