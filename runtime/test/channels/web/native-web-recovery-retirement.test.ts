import { afterEach, beforeEach, expect, test } from "bun:test";
import { readFileSync } from 'node:fs';
import {createTempWorkspace,setEnv} from '../../helpers.js';
import {initializeChatCursorStorage,legacyCursorArchive} from '../../../src/db/chat-cursor-storage.js';
import { WebChannel } from "../../../src/channels/web.js";
import { initDatabase, closeDatabase, getDb, setChatCursor, storeChatMetadata } from "../../../src/db.js";
import { handleAgentMessage } from "../../../src/channels/web/handlers/agent.js";
import { buildAgentStatusSnapshot } from "../../../src/channels/web/agent/agent-status.js";
import { runWebStartupRecoveryBootstrap } from "../../../src/runtime/startup.js";
import { WebChannelRuntimeStateService } from "../../../src/channels/web/runtime/runtime-state-service.js";
import { AgentStatusStore } from "../../../src/channels/web/agent/agent-status-store.js";
import { WebAgentControlPlaneService } from "../../../src/channels/web/agent/agent-control-plane-service.js";

let cleanup = () => {};
beforeEach(() => {
  const ws = createTempWorkspace('native-marker-retirement-');
  const restore = setEnv({PICLAW_WORKSPACE:ws.workspace,PICLAW_STORE:ws.store,PICLAW_DATA:ws.data});
  cleanup = () => {restore();ws.cleanup();};
});
afterEach(() => {closeDatabase();cleanup();});
function historicalCursorFixture() {
  initDatabase();
  expect(getDb().query('SELECT COUNT(*) AS n FROM chat_cursors').get()).toEqual({n:0});
  // Synthetic pre-ledger source inside this blank fixture. The populated file
  // upgrade/reopen has a separate schema-ownership qualification.
  getDb().transaction(() => {
    getDb().exec("DROP TABLE chat_cursors; DELETE FROM piclaw_schema_migrations WHERE owner='host.chat-cursors'");
    getDb().exec(readFileSync(new URL('../../fixtures/legacy-chat-cursors.sql',import.meta.url),'utf8'));
    initializeChatCursorStorage(getDb());
  })();
}

test("model selection cannot rewind a native cursor or consume historical failed markers", async () => {
  historicalCursorFixture(); const chat="web:model-no-legacy-retry";
  storeChatMetadata(chat,"2026-01-01T00:00:00.000Z","Web");
  getDb().query(`INSERT INTO ${legacyCursorArchive}(chat_jid,cursor_ts,failed_prev_ts,failed_ts,failed_message_id)
    VALUES(?,'2026-01-01T00:00:05.000Z','','2026-01-01T00:00:05.000Z','old-input')`).run(chat);
  setChatCursor(chat,'2026-01-01T00:00:05.000Z');
  const archived = getDb().query('SELECT rowid,* FROM '+legacyCursorArchive).all();
  const before=getDb().query("SELECT * FROM chat_cursors WHERE chat_jid=?").get(chat);
  let queued=0;
  const web=new WebChannel({queue:{enqueue(){queued++;}},agentPool:{isDurableRuntime:()=>true,
    applyControlCommand:async()=>({status:"success",message:"Model selected",model_label:"synthetic/test"}),
    getAvailableModels:async()=>({current:"synthetic/test",thinking_level:null,supports_thinking:false})} as any} as any);
  const response=await handleAgentMessage(web as any,new Request("http://fixture/agent/default/message",{
    method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({content:"/model synthetic/test"}),
  }),"/agent/default/message",chat,"default");
  expect(response.status).toBe(200);
  expect(getDb().query("SELECT * FROM chat_cursors WHERE chat_jid=?").get(chat)).toEqual(before);
  expect(getDb().query('SELECT rowid,* FROM '+legacyCursorArchive).all()).toEqual(archived);
  expect(queued).toBe(0);
});

test("web startup never consults a legacy inflight-recovery capability", () => {
  let resumed=0; const scheduled:(()=>void)[]=[];
  const web={updateAgentStatus(){},resumePendingChats(){resumed++;},
    get recoverInflightRuns(){throw Error("Legacy startup recovery accessed");}};
  expect(()=>runWebStartupRecoveryBootstrap(web as any,resume=>scheduled.push(resume))).not.toThrow();
  expect(scheduled).toHaveLength(1);expect(resumed).toBe(0);
  scheduled[0]();expect(resumed).toBe(1);
});

test("status observation never asks legacy recovery to mutate a missing status", () => {
  const context={getAgentStatus:()=>null,getExtensionWorkingState:()=>null,
    get recoverStaleInflightRun(){throw Error("Legacy recovery accessed from status GET");}};
  expect(buildAgentStatusSnapshot("web:idle",context as any,{includeDiagnostics:false}))
    .toMatchObject({status:"idle",state:"idle",data:null});
});

test("historical inflight markers cannot manufacture an active restart status", () => {
  historicalCursorFixture(); const chat="web:no-marker-status";
  storeChatMetadata(chat,"2026-01-01T00:00:00.000Z","Web");
  getDb().query(`INSERT INTO ${legacyCursorArchive}(chat_jid,cursor_ts,inflight_prev_ts,inflight_message_id,inflight_started_at) VALUES(?,'','','old-input','2026-01-01T00:00:00.000Z')`).run(chat);
  const before=getDb().serialize();
  const store=new AgentStatusStore();
  expect(store.get(chat)).toBeNull();
  expect(getDb().serialize()).toEqual(before);
});

test("run inventory and stale clearing cannot use or mutate legacy execution markers", async () => {
  historicalCursorFixture(); const chat="web:operator-no-mirrors";
  storeChatMetadata(chat,"2026-01-01T00:00:00.000Z","Web");
  getDb().query(`INSERT INTO ${legacyCursorArchive}(chat_jid,cursor_ts,inflight_prev_ts,inflight_message_id,inflight_started_at) VALUES(?,'','','old-input','2026-01-01T00:00:00.000Z')`).run(chat);
  const before=getDb().serialize(); let updates=0;
  const control=new WebAgentControlPlaneService({defaultChatJid:chat,defaultAgentId:"default",json:(body:unknown,status=200)=>Response.json(body,{status}),
    agentPool:{listActiveChats:()=>[]},readNativeQueue:async()=>[],getAgentStatus:()=>({type:"thinking",turn_id:"native-turn"}),
    updateAgentStatus(){updates++;}} as any);
  const listed=await (await control.handleAgentRuns(new Request("http://fixture/agent/runs?chat_jid="+encodeURIComponent(chat)))).json();
  expect(listed.inflight).toEqual([]);expect(listed.preflight).toEqual([]);
  expect(listed.runs[0].inflight).toBeNull();
  const response=await control.handleAgentRunClearStale(new Request("http://fixture/agent/runs/clear-stale",{
    method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({chat_jid:chat})}));
  expect(response.status).toBe(409);expect(updates).toBe(0);
  expect(getDb().serialize()).toEqual(before);
});

test("retired web recovery methods are absent instead of no-op forwarding layers", () => {
  for(const name of ["skipFailedOnModelSwitch","retryFailedOnModelSwitch","recoverInflightRuns","recoverStaleInflightRun"])
    expect((WebChannel.prototype as any)[name]).toBeUndefined();
});

test("live draft buffers never persist a second restart-recovery payload", () => {
  let writes=0; const buffers=new Map<string,any>();
  const state={load(){},save(){writes++;},getAgentStatuses:()=>({}),setAgentStatus(){},setContextUsage(){},getContextUsage:()=>null,
    setDraftRecovery(){writes++;},getDraftRecovery(){throw Error("Legacy draft read");}};
  const service=new WebChannelRuntimeStateService({agentStatusStore:{load(){},update(){},get:()=>null,dispose(){}},
      agentBuffers:{setPanelExpanded(){},isPanelExpanded:()=>false,updateBuffer:(id,panel,text,totalLines)=>buffers.set(id+panel,{text,totalLines}),
        getBuffer:(id,panel)=>buffers.get(id+panel)}});
  service.updateAgentStatus("web:chat",{type:"thinking",turn_id:"turn"});
  service.updateDraftBuffer("turn","live draft",1);
  expect(service.getBuffer("turn","draft")).toEqual({text:"live draft",totalLines:1});
  expect(writes).toBe(0);
  service.updateAgentStatus("web:chat",{type:"done",turn_id:"turn"});
  expect(writes).toBe(0);
  service.dispose();
});
