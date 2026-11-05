import { afterEach, beforeEach, expect, test } from "bun:test";
import { readFileSync } from 'node:fs';
import {createTempWorkspace,setEnv} from '../../helpers.js';
import {initializeChatCursorStorage,legacyCursorArchive} from '../../../src/db/chat-cursor-storage.js';
import { initDatabase, closeDatabase, getDb, storeChatMetadata, storeMessage, getChatCursor } from "../../../src/db.js";
import { processChat } from "../../../src/channels/web/handlers/agent.js";

let cleanup = () => {};
beforeEach(() => {
  const ws = createTempWorkspace('native-web-only-');
  const restore = setEnv({PICLAW_WORKSPACE:ws.workspace,PICLAW_STORE:ws.store,PICLAW_DATA:ws.data});
  cleanup = () => {restore();ws.cleanup();};
});
afterEach(async () => {await closeDatabase();cleanup();});

function pendingInput(chatJid: string) {
  initDatabase();
  const timestamp = "2026-01-01T00:00:01.000Z";
  storeChatMetadata(chatJid, timestamp, "Web");
  const id = `input:${chatJid}`;
  const rowId = storeMessage({ id, chat_jid: chatJid, sender: "user", sender_name: "User",
    content: "accepted input", timestamp, is_from_me: false });
  return { id, rowId, timestamp };
}

test("web execution without an admitted dispatcher cannot read the legacy runner or write run markers", async () => {
  const chat = "web:no-native-dispatch";
  pendingInput(chat);
  let legacyReads = 0;
  const before = getDb().serialize();
  const channel = { agentPool: { isDurableRuntime:()=>true, get runAgent() { legacyReads++; throw Error("Legacy runner accessed"); } } };
  await expect(processChat(channel as any, chat, "default")).rejects.toThrow("Native SDK dispatcher required");
  expect(legacyReads).toBe(0);
  expect(getChatCursor(chat)).toBe("");
  expect(getDb().serialize()).toEqual(before);
});

test("historical failed markers cannot skip accepted native input or be rewritten by selection", async () => {
  const chat = "web:native-with-legacy-history";
  const input = pendingInput(chat);
  const db = getDb();
  // Construct the pre-ledger source inside this blank isolated fixture, then
  // retire it through the real owned migration. Never restore a legacy writer.
  expect(db.query('SELECT COUNT(*) AS n FROM chat_cursors').get()).toEqual({n:0});
  db.transaction(() => {
    db.exec("DROP TABLE chat_cursors; DELETE FROM piclaw_schema_migrations WHERE owner='host.chat-cursors'");
    db.exec(readFileSync(new URL('../../fixtures/legacy-chat-cursors.sql',import.meta.url),'utf8'));
    db.query(`INSERT INTO chat_cursors(chat_jid,cursor_ts,failed_prev_ts,failed_ts,failed_message_id)
      VALUES(?,'','',?,?)`).run(chat,input.timestamp,input.id);
    initializeChatCursorStorage(db);
  })();
  const history = db.query('SELECT rowid,* FROM '+legacyCursorArchive).all();
  const receipts = db.query("SELECT * FROM piclaw_schema_migrations WHERE owner='host.chat-cursors'").all();
  const calls: unknown[] = [];
  await processChat({ dispatchAcceptedInput: (...args: unknown[]) => {
    calls.push(args); return Promise.resolve({submission_id:17,queued:false});
  }, broadcastEvent() {}, resumeChat() {} } as any, chat, "default");
  expect(calls).toEqual([[chat, input.id, input.rowId,'followUp']]);
  expect(getChatCursor(chat)).toBe('');
  expect(db.query('SELECT rowid,* FROM '+legacyCursorArchive).all()).toEqual(history);
  expect(db.query("SELECT * FROM piclaw_schema_migrations WHERE owner='host.chat-cursors'").all()).toEqual(receipts);
  expect(db.query('SELECT failed_message_id FROM '+legacyCursorArchive+' WHERE chat_jid=?').get(chat)).toEqual({failed_message_id:input.id});
  expect((db.query('PRAGMA main.table_info(chat_cursors)').all() as {name:string}[]).map(row=>row.name)).toEqual(['chat_jid','cursor_ts','queued_followups_json']);
});

test("explicit worker handoffs retain one source identity without a host settlement/cursor/wake owner", async () => {
  const chat = "web:native-repeat-wake";
  const input = pendingInput(chat);
  const selected: unknown[] = [];
  let settled = false, resumed = 0;
  const dispatch = (...args: unknown[]) => {
    selected.push(args); return Promise.resolve({submission_id:17,queued:!settled});
  };
  Object.defineProperty(dispatch,'waitForPending',{get(){throw Error('Retired pending owner forbidden');}});
  const channel = { dispatchAcceptedInput: dispatch, broadcastEvent() {}, resumeChat() { resumed++; } };
  await processChat(channel as any, chat, "default");
  expect(getChatCursor(chat)).toBe("");
  settled = true;
  await processChat(channel as any, chat, "default");
  expect(selected).toEqual([[chat,input.id,input.rowId,'followUp'],[chat,input.id,input.rowId,'followUp']]);
  expect(getChatCursor(chat)).toBe('');
  expect(resumed).toBe(0);
});
