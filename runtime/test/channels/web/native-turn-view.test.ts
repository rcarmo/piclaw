import { expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { parseStatusRetryAt, getStatusRetryCountdownLabel } from "../../../web/src/ui/status-duration.js";
import { createNativeTurnView } from "../../../src/channels/web/agent/native-turn-view.js";

test("public conversation frames feed existing thought, draft and nested tool UI events", () => {
  const database = new Database(":memory:");
  try {
    database.exec(`CREATE TABLE piclaw_durable_bindings_v1(operation_id,source_seq,source_id,chat_jid,conversation_id,submission_id);
      CREATE TABLE piclaw_durable_intent_bindings_v1(operation_id,chat_jid,conversation_id,submission_id);
      CREATE TABLE service_effect_s01_operations(operation_id,primary_source_seq);
      CREATE TABLE messages(id,chat_jid,thread_id);
      INSERT INTO service_effect_s01_operations VALUES('op',1);
      INSERT INTO messages VALUES('input','chat',NULL);
      INSERT INTO piclaw_durable_bindings_v1 VALUES('op',1,'input','chat',2,3);`);
    const events: { event: string; data: Record<string, unknown> }[] = [];
    const buffers: string[] = [];
    const render = createNativeTurnView(database, { broadcastEvent(event, data) { events.push({ event, data }); }, updateThoughtBuffer(_turn, text) { buffers.push(text); } }, "chat");
    const view = { conversation: { id: 2 }, entries: [], docs: { "pi.live": { run: { taskId: 4, inputs: [3] }, generation: { message: { content: [{ type: "thinking", thinking: "visible reasoning" }, { type: "text", text: "partial reply" }] } }, nestedTools: [{ callId: "parent/read", name: "read", status: "running", output: "progress", arguments: { path: "fixture" } }] } } };
    render(view);
    expect(events.some(e => e.event === "agent_thought" && e.data.text === "visible reasoning")).toBe(true);
    expect(events.some(e => e.event === "agent_draft" && e.data.text === "partial reply")).toBe(true);
    expect(events.some(e => e.event === "agent_status" && e.data.tool_name === "read" && e.data.output_preview === "progress")).toBe(true);
    expect(buffers).toEqual(["visible reasoning"]);
    expect(events.every(e => e.data.chat_jid === "chat" && e.data.turn_id === "durable:1")).toBe(true);
    const size = events.length;
    render(view);
    expect(events.length).toBe(size);
  } finally { database.close(); }
});


test("coalesced completed entries recover thoughts and final tool output without clearing the pane", () => {
  const database = new Database(":memory:");
  try {
    database.exec(`CREATE TABLE piclaw_durable_bindings_v1(operation_id,source_seq,source_id,chat_jid,conversation_id,submission_id);
      CREATE TABLE piclaw_durable_intent_bindings_v1(operation_id,chat_jid,conversation_id,submission_id);
      CREATE TABLE service_effect_s01_operations(operation_id,primary_source_seq); CREATE TABLE messages(id,chat_jid,thread_id);
      INSERT INTO service_effect_s01_operations VALUES('op',1); INSERT INTO messages VALUES('input','chat',NULL);
      INSERT INTO piclaw_durable_bindings_v1 VALUES('op',1,'input','chat',2,3);`);
    const events: any[] = [];
    const render = createNativeTurnView(database, { broadcastEvent(event, data) { events.push({event,data}); } }, "chat");
    const view: any = { conversation: {id:2}, entries: [
      {kind:"host.accepted",data:{operationId:"op"}},
      {kind:"pi.assistant",model:[{role:"assistant",content:[{type:"thinking",thinking:"Recorded public thought"},{type:"toolCall",id:"call",name:"bash",arguments:{command:"printf pane-proof"}}]}]},
      {kind:"pi.tool-result",model:[{role:"toolResult",toolCallId:"call",toolName:"bash",content:[{type:"text",text:"pane-proof"}]}]}
    ], docs:{"pi.live":{run:{taskId:4,inputs:[3]},generation:{attempt:0}}}};
    render(view);
    expect(events.some(e => e.event === "agent_thought" && e.data.text === "Recorded public thought")).toBe(true);
    const statuses = events.filter(e => e.event === "agent_status");
    expect(statuses.at(-1).data.tool_name).toBe("bash");
    expect(statuses.at(-1).data.tool_args).toEqual({command:"printf pane-proof"});
    expect(statuses.at(-1).data.output_preview).toBe("pane-proof");
    expect(statuses.at(-1).data.last_activity).toBe(true);
    const size = events.length;
    render(view);
    expect(events.length).toBe(size);
  } finally {database.close();}
});

test("native retries use the existing intent/countdown panel after tool output and clear cleanly", () => {
  const database=new Database(":memory:");
  try {
    database.exec(`CREATE TABLE piclaw_durable_bindings_v1(operation_id,source_seq,source_id,chat_jid,conversation_id,submission_id);
      CREATE TABLE piclaw_durable_intent_bindings_v1(operation_id,chat_jid,conversation_id,submission_id);
      CREATE TABLE service_effect_s01_operations(operation_id,primary_source_seq);
      CREATE TABLE messages(id,chat_jid,thread_id);
      INSERT INTO service_effect_s01_operations VALUES('op',1);
      INSERT INTO messages VALUES('input','chat',NULL);
      INSERT INTO piclaw_durable_bindings_v1 VALUES('op',1,'input','chat',2,3);`);
    const events:any[]=[],channel:any={updateAgentStatus:(...v:any[])=>events.push(["status",...v]),broadcastEvent:()=>{},setThoughtBuffer:()=>{},setDraftBuffer:()=>{}};
    const render=createNativeTurnView(database,channel,"chat");
    const pi:any={run:{taskId:1,inputs:[3]},generation:{attempt:1}};
    const view:any={conversation:{id:2},docs:{"pi.live":pi},entries:[]};
    render(view);
    pi.tools=[{callId:"tool",name:"bash",arguments:{command:"true"},status:"done",output:"kept tool output"}];
    render(view);
    pi.tools=[];
    pi.generation={attempt:1,retry:{at:Date.now()+2000,error:"private provider payload must never reach UI"}};
    render(view);
    const retry=events.filter(v=>v[0]==="status").at(-1)[2];
    expect(retry.type).toBe("intent");
    expect(retry.title).toContain("retry 1");
    expect(retry.retry_at).toBe(new Date(pi.generation.retry.at).toISOString());
    expect(parseStatusRetryAt(retry)).toBe(pi.generation.retry.at);
    expect(getStatusRetryCountdownLabel(retry,pi.generation.retry.at-1000)).toBeTruthy();
    expect(JSON.stringify(retry)).not.toContain("private provider payload");
    expect(retry.output_preview).toContain("kept tool output");
    const n=events.length;render(view);expect(events.length).toBe(n);
    pi.generation={attempt:2};render(view);
    const resumed=events.filter(v=>v[0]==="status").at(-1)[2];
    expect(resumed.retry_at).toBeUndefined();
    expect(resumed.output_preview).toContain("kept tool output");
    delete pi.run;render(view);
    const idle = events.filter(v=>v[0]==="status").at(-1)[2];
    expect(idle).toMatchObject({type:"done",state:"idle",title:"Idle",active_tool_count:0});
    expect(idle.retry_at).toBeUndefined();
    const ended = events.length; render(view); expect(events.length).toBe(ended);
  } finally {database.close();}
});

test("native retry projection tolerates unavailable delay metadata before the first tool",()=>{
  const database=new Database(":memory:");
  try {
    database.exec(`CREATE TABLE piclaw_durable_bindings_v1(operation_id,source_seq,source_id,chat_jid,conversation_id,submission_id);
      CREATE TABLE piclaw_durable_intent_bindings_v1(operation_id,chat_jid,conversation_id,submission_id);
      CREATE TABLE service_effect_s01_operations(operation_id,primary_source_seq);
      CREATE TABLE messages(id,chat_jid,thread_id);
      INSERT INTO service_effect_s01_operations VALUES('op',1);
      INSERT INTO messages VALUES('input','chat',NULL);
      INSERT INTO piclaw_durable_bindings_v1 VALUES('op',1,'input','chat',2,3);`);
    const events:any[]=[],render=createNativeTurnView(database,{broadcastEvent:(event,data)=>events.push({event,data})},"chat");
    const pi:any={run:{taskId:1,inputs:[3]},generation:{attempt:1,retry:{at:NaN,error:"opaque signature never displayed"}}};
    render({conversation:{id:2},entries:[],docs:{"pi.live":pi}});
    let status=events.filter(e=>e.event==="agent_status").at(-1).data;
    expect(status.type).toBe("intent");expect(status.retry_at).toBeUndefined();
    expect(JSON.stringify(events)).not.toContain("opaque signature");
    pi.generation={attempt:2};render({conversation:{id:2},entries:[],docs:{"pi.live":pi}});
    status=events.filter(e=>e.event==="agent_status").at(-1).data;
    expect(status.type).toBe("thinking");expect(status.retry_at).toBeUndefined();
  } finally {database.close();}
});

test("initial and stopped SDK frames stay idle even with queued input and no host status reads", () => {
  const database = new Database(":memory:");
  try {
    // No host operation/source tables: neither pending host records nor lane
    // flags are an execution signal. A failed run can leave the SDK inbox full.
    const statuses: Record<string, unknown>[] = [];
    const render = createNativeTurnView(database, {broadcastEvent(){},updateAgentStatus(_chat,status){statuses.push(status);}},"chat");
    render({docs:{"pi.live":{},"pi.inbox":{items:[{id:1,mode:"followUp"},{id:2,mode:"write"}]}}});
    expect(statuses.at(-1)).toMatchObject({sdk_observation:true,type:"done",state:"idle",title:"Idle",queued_count:1});
    render({docs:{"pi.live":{},"pi.inbox":{items:[]}}});
    expect(statuses.at(-1)).toMatchObject({type:"done",state:"idle",queued_count:0});
  } finally {database.close();}
});

test("native message frames need no host operation row; compaction activity follows only SDK docs", () => {
  const database = new Database(":memory:");
  try {
    database.exec(`CREATE TABLE piclaw_durable_bindings_v1(operation_id,source_seq,source_id,chat_jid,conversation_id,submission_id);
      CREATE TABLE piclaw_durable_intent_bindings_v1(operation_id,chat_jid,conversation_id,submission_id);
      CREATE TABLE messages(id,chat_jid,thread_id);
      INSERT INTO messages VALUES('input','chat',NULL);
      INSERT INTO piclaw_durable_bindings_v1 VALUES('native-message:2:1',1,'input','chat',2,3);`);
    const statuses:any[]=[];
    const render=createNativeTurnView(database,{broadcastEvent(){},updateAgentStatus(_chat,status){statuses.push(status);}},"chat");
    render({conversation:{id:2},entries:[],docs:{"pi.live":{run:{taskId:4,inputs:[3]},generation:{attempt:0}}}});
    expect(statuses.at(-1)).toMatchObject({sdk_observation:true,type:"thinking",state:"active",operation_id:"sdk-run:2:3",turn_id:"durable:1"});
    render({conversation:{id:2},entries:[],docs:{"pi.live":{compactions:[{taskId:9,reason:"threshold",blocking:false}]}}});
    expect(statuses.at(-1)).toMatchObject({sdk_observation:true,type:"intent",state:"active",phase:"compaction",task_id:9});
    expect(statuses.at(-1)).not.toHaveProperty("operation_id");
    render({conversation:{id:2},entries:[],docs:{"pi.live":{}}});
    expect(statuses.at(-1)).toMatchObject({type:"done",state:"idle",title:"Idle"});
  } finally {database.close();}
});

test("SDK inbox/placement deltas reuse queue and timeline events even when a whole run coalesces",()=>{
  const database=new Database(":memory:");const events:{event:string;data:any}[]=[],published:string[]=[];
  try{
    const render=createNativeTurnView(database,{broadcastEvent(event,data){events.push({event,data});},publishInput(id){published.push(id);}},"chat");
    const frame=(entries:any[],inbox:any[])=>({conversation:{id:2},entries,docs:{"pi.live":{},"pi.inbox":{items:inbox}}});
    render(frame([],[]));
    const queued={id:7,mode:"followUp",content:"queued body",entry:{kind:"host.accepted",data:{chatJid:"chat",sourceId:"source"}}};
    render(frame([],[queued]));
    expect(published).toEqual([]);expect(events.find(item=>item.event==="agent_followup_queued")?.data).toMatchObject({row_id:7,source:"native_sdk",content:"queued body"});
    render(frame([{id:9,conversationId:2,kind:"host.accepted",data:{chatJid:"chat",sourceId:"source"}}],[]));
    expect(published).toEqual(["source"]);expect(events.find(item=>item.event==="agent_followup_consumed")?.data).toMatchObject({chat_jid:"chat",row_id:7});
    render(frame([{id:9,conversationId:2,kind:"host.accepted",data:{chatJid:"chat",sourceId:"source"}}],[]));expect(published).toEqual(["source"]);
  }finally{database.close();}
});
