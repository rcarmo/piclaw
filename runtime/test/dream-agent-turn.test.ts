import { beforeEach, afterEach, expect, spyOn, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, readdirSync, readlinkSync, renameSync, rmSync, symlinkSync, linkSync, writeFileSync } from "fs";
import { join } from "path";

import { importFresh, setEnv } from "./helpers.js";
import { assertPathWithinTestFilesystemIsolation } from "../scripts/test-filesystem-isolation.js";

// Capture once, before any fixture freezes the global clock. A timed-out test
// can finish late while the next fixture is already running.
const realDateNow = Date.now;
let restoreDreamPaths: (()=>void)|undefined;
beforeEach(async()=>{
  const config=await import("../src/core/config.js");
  // Dream owns bootstrap-fixed paths; align dynamic daily-note/index readers
  // with the SAME isolated fixture when another file changed process.env.
  restoreDreamPaths=setEnv({PICLAW_WORKSPACE:config.WORKSPACE_DIR,PICLAW_DATA:config.DATA_DIR,PICLAW_STORE:config.STORE_DIR});
});
afterEach(() => {
  Date.now = realDateNow;
});
afterEach(()=>{restoreDreamPaths?.();restoreDreamPaths=undefined;});

const acceptModelChange = async () => ({ status: "success", message: "ok" } as const);

function resetDreamDestructiveFixture(config: typeof import("../src/core/config.js")): void {
  const notesDir = join(config.WORKSPACE_DIR, "notes");
  assertPathWithinTestFilesystemIsolation(config.WORKSPACE_DIR);
  assertPathWithinTestFilesystemIsolation(notesDir, process.env, { allowRoot: false });
  assertPathWithinTestFilesystemIsolation(config.DATA_DIR, process.env, { allowRoot: false });
  rmSync(notesDir, { recursive: true, force: true });
  rmSync(config.DATA_DIR, { recursive: true, force: true });
  mkdirSync(config.DATA_DIR, { recursive: true });
}

function resetDreamNotesFixture(config: typeof import("../src/core/config.js")): void {
  const notesDir = join(config.WORKSPACE_DIR, "notes");
  assertPathWithinTestFilesystemIsolation(config.WORKSPACE_DIR);
  assertPathWithinTestFilesystemIsolation(notesDir, process.env, { allowRoot: false });
  rmSync(notesDir, { recursive: true, force: true });
}

test("runDreamAgentTurn forwards its explicit model to native private dispatch without public model mutation", async () => {
  const config = await import("../src/core/config.js");
  resetDreamDestructiveFixture(config);

  const db = await import("../src/db.js");
  db.initDatabase();

  const fixedNow = Date.parse("2026-01-02T03:04:05.000Z");
  const applied: Array<{ chatJid: string; raw: string | undefined }> = [];
  const runChats: string[] = [];
  const legacyDisposals: string[] = [];

  Date.now = () => fixedNow;
  try {
    const dream = await importFresh<typeof import("../src/dream.js")>("../src/dream.js");
    const result = await dream.runDreamAgentTurn({
      chatJid: "web:default",
      days: 2,
      mode: "manual",
      model: "openai-compatible/glm-5.1",
      agentPool: {
        applyControlCommand: async (chatJid: string, command: { raw?: string }) => {
          applied.push({ chatJid, raw: command.raw });
          return { status: "success", message: "ok" };
        },
        isDurableRuntime:()=>true,dispatchDreamOperation: async (request: any) => {
          expect(request.model).toBe("openai-compatible/glm-5.1");
          runChats.push(request.chatJid);
          return { status: "success", result: "Dream complete." };
        },
        disposeChatSession: async (jid: string) => { legacyDisposals.push(jid); },
      } as any,
    });

    expect(result.skipped).toBe(false);
    expect(applied).toEqual([]);
    expect(runChats).toEqual(["web:default"]);
    expect(legacyDisposals).toEqual([]);
  } finally {
    Date.now = realDateNow;
  }
});

test("runDreamAgentTurn reaps only a stale lock and preserves legacy artifacts while refreshing memory", { timeout: 15000 }, async () => {
  const config = await import("../src/core/config.js");
  resetDreamDestructiveFixture(config);
  mkdirSync(join(config.DATA_DIR, "dream-backups"), { recursive: true });
  for (let i = 0; i < 12; i += 1) {
    writeFileSync(join(config.DATA_DIR, "dream-backups", `2026-01-01T00-00-${String(i).padStart(2, "0")}-000Z-auto-web_default.zip`), "old", "utf8");
  }
  mkdirSync(join(config.WORKSPACE_DIR, "notes", "memory"), { recursive: true });
  writeFileSync(join(config.WORKSPACE_DIR, "notes", "memory", ".dream.lock"), "999999\n", "utf8");

  const fixedNow = Date.parse("2026-01-02T03:04:05.000Z");
  const dreamChatJid = `dream:auto:web_default:${fixedNow}`;
  const dreamSessionDir = join(config.DATA_DIR, "sessions", `dream_auto_web_default_${fixedNow}`);

  Date.now = () => fixedNow;
  try {
    const db = await importFresh<typeof import("../src/db.js")>("../src/db.js");
    db.initDatabase();
    const rawDb = db.getDb();
    rawDb.prepare("INSERT OR REPLACE INTO chats (jid, name, last_message_time) VALUES (?, ?, ?)").run(dreamChatJid, "dream", "2026-01-01T00:00:00.000Z");
    rawDb.prepare("INSERT OR REPLACE INTO chat_cursors (chat_jid, cursor_ts) VALUES (?, ?)").run(dreamChatJid, "2026-01-01T00:00:00.000Z");
    rawDb.prepare("INSERT OR REPLACE INTO chat_branches (branch_id, chat_jid, root_chat_jid, parent_branch_id, agent_name, created_at, updated_at, archived_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)").run(
      "dream-branch-1",
      dreamChatJid,
      dreamChatJid,
      null,
      "dream-test-agent",
      "2026-01-01T00:00:00.000Z",
      "2026-01-01T00:00:00.000Z",
      null,
    );
    rawDb.prepare("INSERT INTO token_usage (chat_jid, run_at, input_tokens, output_tokens, total_tokens, turns) VALUES (?, ?, ?, ?, ?, ?)").run(
      dreamChatJid,
      "2026-01-01T00:00:00.000Z",
      10,
      20,
      30,
      1,
    );
    mkdirSync(dreamSessionDir, { recursive: true });
    writeFileSync(join(dreamSessionDir, "session.json"), "{}", "utf8");

    const dream = await importFresh<typeof import("../src/dream.js")>("../src/dream.js");
    const result = await dream.runDreamAgentTurn({
      chatJid: "web:default",
      days: 2,
      mode: "auto",
      agentPool: {
        applyControlCommand: acceptModelChange,
        isDurableRuntime:()=>true,dispatchDreamOperation: async () => ({ status: "success", result: "AutoDream complete." }),
        disposeChatSession: async () => {},
      } as any,
    });

    expect(result.skipped).toBe(false);
    expect(existsSync(join(config.WORKSPACE_DIR, "notes", "memory", "MEMORY.md"))).toBe(true);
    expect(existsSync(join(config.WORKSPACE_DIR, "notes", "memory", "current-state.md"))).toBe(true);
    expect(existsSync(join(config.WORKSPACE_DIR, "notes", "memory", "recent-context.md"))).toBe(true);
    expect(readFileSync(join(config.WORKSPACE_DIR, "notes", "memory", ".dream-state"), "utf8"))
      .toContain("recovery: complete");
    expect(result.result).toContain("Memory refreshed after Dream: yes");

    expect(rawDb.prepare("SELECT COUNT(*) AS count FROM chats WHERE jid = ?").get(dreamChatJid)).toEqual({ count: 1 });
    expect(rawDb.prepare("SELECT COUNT(*) AS count FROM chat_cursors WHERE chat_jid = ?").get(dreamChatJid)).toEqual({ count: 1 });
    expect(rawDb.prepare("SELECT COUNT(*) AS count FROM chat_branches WHERE chat_jid = ?").get(dreamChatJid)).toEqual({ count: 1 });
    expect(rawDb.prepare("SELECT COUNT(*) AS count FROM token_usage WHERE chat_jid = ?").get(dreamChatJid)).toEqual({ count: 1 });
    expect(readFileSync(join(dreamSessionDir, 'session.json'), 'utf8')).toBe('{}');

    const backups = readdirSync(join(config.DATA_DIR, "dream-backups")).sort();
    expect(backups).toHaveLength(10);
    const latestBackup = join(config.DATA_DIR, "dream-backups", backups.at(-1)!);
    expect(latestBackup.endsWith(".zip")).toBe(true);
    const list = Bun.spawnSync(["unzip", "-Z1", latestBackup], { stdout: "pipe", stderr: "pipe" });
    expect(list.exitCode, list.stderr.toString()).toBe(0);
    const archived = list.stdout.toString("utf8");
    expect(archived).toContain("manifest.json");
    expect(archived).not.toContain("notes/memory/.dream.lock");
  } finally {
    Date.now = realDateNow;
  }
});

test("runDreamAgentTurn skips gracefully when another live Dream run holds the lock", async () => {
  const config = await import("../src/core/config.js");
  resetDreamNotesFixture(config);
  mkdirSync(join(config.WORKSPACE_DIR, "notes", "memory"), { recursive: true });
  writeFileSync(join(config.WORKSPACE_DIR, "notes", "memory", ".dream.lock"), "424242\n", "utf8");

  const realKill = process.kill;
  try {
    process.kill = ((pid: number, signal?: number | NodeJS.Signals) => {
      expect(pid).toBe(424242);
      void signal;
      return true;
    }) as typeof process.kill;

    const dream = await importFresh<typeof import("../src/dream.js")>("../src/dream.js");
    const result = await dream.runDreamAgentTurn({
      chatJid: "web:default",
      days: 2,
      mode: "auto",
      agentPool: {
        isDurableRuntime:()=>true,dispatchDreamOperation: async () => ({ status: "success", result: "should not run" }),
        disposeChatSession: async () => {},
      } as any,
    });

    expect(result.skipped).toBe(true);
    expect(result.result).toContain("Dream already running");
    expect(readFileSync(join(config.WORKSPACE_DIR, "notes", "memory", ".dream.lock"), "utf8")).toContain("424242");
  } finally {
    process.kill = realKill;
  }
});

test("runDreamAgentTurn records recovery summaries when the model pass succeeds after recovery", async () => {
  const config = await import("../src/core/config.js");
  resetDreamDestructiveFixture(config);
  const db = await import("../src/db.js"); db.initDatabase();

  const dream = await importFresh<typeof import("../src/dream.js")>("../src/dream.js");
  const result = await dream.runDreamAgentTurn({
    chatJid: "web:default",
    days: 2,
    mode: "auto",
    agentPool: {
      applyControlCommand: acceptModelChange,
      isDurableRuntime:()=>true,dispatchDreamOperation: async () => ({
        status: "success",
        result: "AutoDream complete.",
        recovery: {
          attemptsUsed: 1,
          totalElapsedMs: 1200,
          recovered: true,
          exhausted: false,
          lastClassifier: "context_pressure",
          strategyHistory: ["compact_then_retry"],
        },
      }),
      disposeChatSession: async () => {},
    } as any,
  });

  expect(result.skipped).toBe(false);
  expect(result.result).toContain("AutoDream complete.");
  expect(result.result).toContain("Automatic recovery succeeded after 1 attempt");
  expect(result.result).toContain("context_pressure");
});

test("scheduled Dream consumes deferred startup backfill state and clears it after successful consolidation", async () => {
  const config = await import("../src/core/config.js");
  resetDreamDestructiveFixture(config);
  mkdirSync(join(config.WORKSPACE_DIR, "notes", "memory"), { recursive: true });
  writeFileSync(
    join(config.WORKSPACE_DIR, "notes", "memory", "current-state.md"),
    "# Current Dream state\n\nGenerated: 2026-01-02T03:04:05.000Z\n",
    "utf8",
  );

  const db = await importFresh<typeof import("../src/db.js")>("../src/db.js");
  db.initDatabase();
  const startupState = await importFresh<typeof import("../src/agent-memory/startup-state.js")>("../src/agent-memory/startup-state.js");
  startupState.writeDreamStartupMarker("backfill_required", config.WORKSPACE_DIR);
  const dream = await importFresh<typeof import("../src/dream.js")>("../src/dream.js");
  expect(dream.hasOutstandingDreamConsolidation(2)).toBe(true);

  let modelCalls = 0;
  const result = await dream.runDreamAgentTurn({
    chatJid: "web:default",
    days: 2,
    mode: "auto",
    agentPool: {
      applyControlCommand: acceptModelChange,
      isDurableRuntime:()=>true,dispatchDreamOperation: async () => {
        modelCalls += 1;
        return { status: "success", result: "Scheduled consolidation complete." };
      },
      disposeChatSession: async () => {},
    } as any,
  });

  expect(result.skipped).toBe(false);
  expect(modelCalls).toBe(1);
  expect(readFileSync(startupState.getDreamStartupMarkerPath(config.WORKSPACE_DIR), "utf8")).toContain("recovery: complete");
  expect(dream.hasOutstandingDreamConsolidation(2)).toBe(false);
});

for(const replacement of ['same-pid','symlink'] as const)test(`Dream lock ownership: a ${replacement} replacement stops mutation and is not unlinked by the former owner`,async()=>{
  const config=await import('../src/core/config.js');resetDreamDestructiveFixture(config);
  const db=await import('../src/db.js');db.initDatabase();
  const lock=join(config.WORKSPACE_DIR,'notes/memory/.dream.lock'),memory=join(config.WORKSPACE_DIR,'notes/memory/MEMORY.md');
  const marker='replacement owner must keep these exact bytes';
  const dream=await importFresh<typeof import('../src/dream.js')>('../src/dream.js');
  const caught=await dream.runDreamAgentTurn({chatJid:'web:default',mode:'manual',days:1,agentPool:{
    applyControlCommand:acceptModelChange,isDurableRuntime:()=>true,dispatchDreamOperation:async()=>{
      renameSync(lock,lock+'.former');
      if(replacement==='symlink'){writeFileSync(lock+'.target',String(process.pid));symlinkSync(lock+'.target',lock);}
      else writeFileSync(lock,String(process.pid));
      writeFileSync(memory,marker);return{status:'success',result:'must not publish consolidation'};
    },disposeChatSession:async()=>{throw Error('former owner must not clean data');},
  } as any}).then(()=>undefined,error=>error);
  expect(caught).toBeInstanceOf(Error);expect(existsSync(lock)).toBe(true);expect(readFileSync(lock,'utf8')).toBe(String(process.pid));expect(readFileSync(memory,'utf8')).toBe(marker);
});

test('Dream lock ownership: replacement during stale inspection is retained without starting the agent',async()=>{
  const config=await import('../src/core/config.js');resetDreamDestructiveFixture(config);
  const db=await import('../src/db.js');db.initDatabase();
  const lock=join(config.WORKSPACE_DIR,'notes/memory/.dream.lock');mkdirSync(join(config.WORKSPACE_DIR,'notes/memory'),{recursive:true});writeFileSync(lock,'999999');
  let calls=0;const kill=spyOn(process,'kill').mockImplementation(((pid:number)=>{
    expect(pid).toBe(999999);renameSync(lock,lock+'.former');writeFileSync(lock,String(process.pid));throw Object.assign(Error('old owner exited'),{code:'ESRCH'});
  }) as typeof process.kill);
  try{
    const dream=await importFresh<typeof import('../src/dream.js')>('../src/dream.js');
    const result=await dream.runDreamAgentTurn({chatJid:'web:default',mode:'manual',days:1,agentPool:{isDurableRuntime:()=>true,dispatchDreamOperation:async()=>{calls++;return{status:'success',result:'forbidden'};},disposeChatSession:async()=>{}} as any});
    expect(result.skipped).toBe(true);expect(calls).toBe(0);expect(readFileSync(lock,'utf8')).toBe(String(process.pid));
  }finally{kill.mockRestore();}
});

test('Dream lock ownership: stale inspection keeps the original inode pinned until replacement is decided',async()=>{
  const config=await import('../src/core/config.js');resetDreamDestructiveFixture(config);
  const db=await import('../src/db.js');db.initDatabase();
  const lock=join(config.WORKSPACE_DIR,'notes/memory/.dream.lock');mkdirSync(join(config.WORKSPACE_DIR,'notes/memory'),{recursive:true});writeFileSync(lock,'999999');
  let pinned=false;
  const kill=spyOn(process,'kill').mockImplementation((()=>{
    pinned=readdirSync('/proc/self/fd').some(fd=>{try{return readlinkSync('/proc/self/fd/'+fd)===lock;}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return false;throw error;}});
    throw Object.assign(Error('old owner exited'),{code:'ESRCH'});
  }) as typeof process.kill);
  try{
    const dream=await importFresh<typeof import('../src/dream.js')>('../src/dream.js');
    await dream.runDreamAgentTurn({chatJid:'web:default',mode:'manual',days:1,agentPool:{applyControlCommand:acceptModelChange,isDurableRuntime:()=>true,dispatchDreamOperation:async()=>({status:'success',result:'fixture'}),disposeChatSession:async()=>{}} as any});
    expect(pinned).toBe(true);expect(existsSync(lock)).toBe(false);
  }finally{kill.mockRestore();}
});

for(const kind of ['malformed','symlink','hardlink','unknown-process'] as const)test(`Dream lock ownership: ${kind} lock has no stale-owner deletion authority`,async()=>{
  const config=await import('../src/core/config.js');resetDreamDestructiveFixture(config);
  const db=await import('../src/db.js');db.initDatabase();
  const lock=join(config.WORKSPACE_DIR,'notes/memory/.dream.lock');mkdirSync(join(config.WORKSPACE_DIR,'notes/memory'),{recursive:true});
  if(kind==='symlink'||kind==='hardlink'){
    writeFileSync(lock+'.target','999999');if(kind==='symlink')symlinkSync(lock+'.target',lock);else linkSync(lock+'.target',lock);
  }else writeFileSync(lock,kind==='malformed'?'unverifiable owner':'999999');
  const original=readFileSync(lock,'utf8');let calls=0;
  const kill=spyOn(process,'kill').mockImplementation((()=>{throw Object.assign(Error('inspection unavailable'),{code:'EIO'});}) as typeof process.kill);
  try{
    const dream=await importFresh<typeof import('../src/dream.js')>('../src/dream.js');
    const result=await dream.runDreamAgentTurn({chatJid:'web:default',mode:'manual',days:1,agentPool:{isDurableRuntime:()=>true,dispatchDreamOperation:async()=>{calls++;return{status:'success',result:'forbidden'};},disposeChatSession:async()=>{}} as any});
    expect(result.skipped).toBe(true);expect(calls).toBe(0);expect(readFileSync(lock,'utf8')).toBe(original);
  }finally{kill.mockRestore();}
});

for(const replacement of [false,true])test(`Dream lock ownership: process exit removes only its original descriptor-bound lock (replacement=${replacement})`,async()=>{
  const config=await import('../src/core/config.js');resetDreamDestructiveFixture(config);
  const lock=join(config.WORKSPACE_DIR,'notes/memory/.dream.lock');
  const child=Bun.spawn([process.execPath,'--no-env-file','-e',`
    import {initDatabase} from ${JSON.stringify(new URL('../src/db.ts',import.meta.url).pathname)};
    import {runDreamAgentTurn} from ${JSON.stringify(new URL('../src/dream.ts',import.meta.url).pathname)};
    import {renameSync,writeFileSync} from 'node:fs';
    initDatabase();await runDreamAgentTurn({chatJid:'web:default',mode:'manual',days:1,agentPool:{
      applyControlCommand:async()=>({status:'success',message:'fixture'}),
      isDurableRuntime:()=>true,dispatchDreamOperation:async()=>{if(${replacement}){renameSync(${JSON.stringify(lock)},${JSON.stringify(lock+'.former')});writeFileSync(${JSON.stringify(lock)},String(process.pid));}process.exit(0);},disposeChatSession:async()=>{},
    }});
  `],{env:{...process.env,PICLAW_DB_IN_MEMORY:'1',PI_OFFLINE:'1',PICLAW_WORKSPACE:config.WORKSPACE_DIR,PICLAW_DATA:config.DATA_DIR},stdin:'ignore',stdout:'pipe',stderr:'pipe'});
  const [status,stderr]=await Promise.all([child.exited,new Response(child.stderr).text(),new Response(child.stdout).text()]);
  expect(status,stderr).toBe(0);expect(existsSync(lock)).toBe(replacement);if(replacement)expect(readFileSync(lock,'utf8')).toBe(String(child.pid));
});

test('Dream lock ownership: a nonregular lock is retained without blocking process inspection',async()=>{
  const config=await import('../src/core/config.js');resetDreamDestructiveFixture(config);
  const lock=join(config.WORKSPACE_DIR,'notes/memory/.dream.lock');mkdirSync(join(config.WORKSPACE_DIR,'notes/memory'),{recursive:true});
  const made=Bun.spawnSync(['mkfifo',lock],{stdout:'pipe',stderr:'pipe'});expect(made.exitCode,made.stderr.toString()).toBe(0);
  const child=Bun.spawn([process.execPath,'--no-env-file','-e',`
    import {initDatabase} from ${JSON.stringify(new URL('../src/db.ts',import.meta.url).pathname)};
    import {runDreamMaintenance} from ${JSON.stringify(new URL('../src/dream.ts',import.meta.url).pathname)};
    initDatabase();const result=await runDreamMaintenance({mode:'manual',days:1});if(!result.skipped)process.exit(2);process.exit(0);
  `],{env:{...process.env,PICLAW_DB_IN_MEMORY:'1',PI_OFFLINE:'1',PICLAW_WORKSPACE:config.WORKSPACE_DIR,PICLAW_DATA:config.DATA_DIR},stdin:'ignore',stdout:'pipe',stderr:'pipe'});
  let timedOut=false;const timer=setTimeout(()=>{timedOut=true;child.kill('SIGKILL');},3000);
  try{const [status,stderr]=await Promise.all([child.exited,new Response(child.stderr).text(),new Response(child.stdout).text()]);expect(timedOut).toBe(false);expect(status,stderr).toBe(0);expect(existsSync(lock)).toBe(true);}
  finally{clearTimeout(timer);if(child.exitCode===null)child.kill('SIGKILL');await child.exited;}
});

test('Dream lock ownership: deterministic maintenance releases its original lease without a model runner',async()=>{
  const config=await import('../src/core/config.js');resetDreamDestructiveFixture(config);
  const db=await import('../src/db.js');db.initDatabase();
  const dream=await importFresh<typeof import('../src/dream.js')>('../src/dream.js');
  const result=await dream.runDreamMaintenance({chatJid:'web:default',mode:'manual',days:1});
  expect(result.skipped).toBe(false);expect(result.refresh).not.toBeNull();expect(existsSync(result.memory_path)).toBe(true);expect(existsSync(join(config.WORKSPACE_DIR,'notes/memory/.dream.lock'))).toBe(false);
});

test("Dream failed execution: a thrown agent outcome still refreshes notes/index without claiming consolidation", async () => {
  const config=await import('../src/core/config.js');resetDreamDestructiveFixture(config);
  const db=await import('../src/db.js');db.initDatabase();
  const startup=await import('../src/agent-memory/startup-state.js');startup.writeDreamStartupMarker('backfill_required',config.WORKSPACE_DIR);
  const dream=await importFresh<typeof import('../src/dream.js')>('../src/dream.js');
  const failure=Error('uncertain accepted agent outcome');let disposed=0;
  await expect(dream.runDreamAgentTurn({chatJid:'web:default',mode:'manual',days:1,agentPool:{
    applyControlCommand:acceptModelChange,isDurableRuntime:()=>true,dispatchDreamOperation:async()=>{throw failure;},disposeChatSession:async()=>{disposed++;},
  } as any})).rejects.toBe(failure);
  for(const name of ['MEMORY.md','current-state.md','recent-context.md'])expect(existsSync(join(config.WORKSPACE_DIR,'notes/memory',name))).toBe(true);
  expect(db.getDb().query("SELECT path FROM workspace_files WHERE path='notes/memory/MEMORY.md'").get()).toEqual({path:'notes/memory/MEMORY.md'});
  expect(startup.dreamStartupBackfillRequired(config.WORKSPACE_DIR)).toBe(true);
  expect(existsSync(join(config.WORKSPACE_DIR,'notes/memory/.dream.lock'))).toBe(false);expect(disposed).toBe(0);
});

test("Dream failed execution: deterministic refresh failure retains the original agent uncertainty", async () => {
  const config=await import('../src/core/config.js');resetDreamDestructiveFixture(config);
  const db=await import('../src/db.js');db.initDatabase();
  const refresh=await import('../src/agent-memory/refresh.js');
  const failure=Error('uncertain accepted agent outcome'),refreshFailure=Error('fixture refresh failed');
  const hook=spyOn(refresh,'refreshAgentMemoryFromDailyNotes').mockImplementation(()=>{throw refreshFailure;});
  try{
    const dream=await importFresh<typeof import('../src/dream.js')>('../src/dream.js');
    const caught=await dream.runDreamAgentTurn({chatJid:'web:default',mode:'manual',days:1,agentPool:{
      applyControlCommand:acceptModelChange,isDurableRuntime:()=>true,dispatchDreamOperation:async()=>{throw failure;},disposeChatSession:async()=>{},
    } as any}).then(()=>undefined,error=>error);
    expect(caught).toBeInstanceOf(AggregateError);expect(caught.errors).toEqual([failure,refreshFailure]);expect(hook).toHaveBeenCalledTimes(1);
    expect(existsSync(join(config.WORKSPACE_DIR,'notes/memory/.dream.lock'))).toBe(false);
  }finally{hook.mockRestore();}
});

test("Dream failed execution: access revocation blocks refresh and preserves the agent failure through cleanup", async () => {
  const config=await import('../src/core/config.js');resetDreamDestructiveFixture(config);
  const db=await import('../src/db.js');db.initDatabase();
  const refresh=await import('../src/agent-memory/refresh.js'),access=await import('../src/core/config-access.js');
  const refreshed=spyOn(refresh,'refreshAgentMemoryFromDailyNotes');let denied:{mockRestore():void}|undefined,disposed=0;
  const failure=Error('uncertain accepted agent outcome');
  try{
    const dream=await importFresh<typeof import('../src/dream.js')>('../src/dream.js');
    const caught=await dream.runDreamAgentTurn({chatJid:'web:default',mode:'manual',days:1,agentPool:{
      applyControlCommand:acceptModelChange,isDurableRuntime:()=>true,dispatchDreamOperation:async()=>{
        denied=spyOn(access,'readAccessConfig').mockImplementation(()=>{throw Error('fixture access revoked');});throw failure;
      },disposeChatSession:async()=>{disposed++;},
    } as any}).then(()=>undefined,error=>error);
    const failures=(error:unknown):unknown[]=>error instanceof AggregateError?error.errors.flatMap(failures):[error];
    expect(caught).toBeInstanceOf(AggregateError);expect(failures(caught)).toContain(failure);
    expect(refreshed).not.toHaveBeenCalled();expect(disposed).toBe(0);
    expect(existsSync(join(config.WORKSPACE_DIR,'notes/memory/MEMORY.md'))).toBe(false);
    expect(existsSync(join(config.WORKSPACE_DIR,'notes/memory/.dream.lock'))).toBe(false);
  }finally{denied?.mockRestore();refreshed.mockRestore();}
});

test("runDreamAgentTurn falls back to deterministic refresh when the model pass errors", async () => {
  const config = await import("../src/core/config.js");
  resetDreamDestructiveFixture(config);
  const db = await import("../src/db.js"); db.initDatabase();

  const dream = await importFresh<typeof import("../src/dream.js")>("../src/dream.js");
  let capturedTimeoutMs: number | undefined;
  const result = await dream.runDreamAgentTurn({
    chatJid: "web:default",
    days: 2,
    mode: "auto",
    agentPool: {
      applyControlCommand: acceptModelChange,
      isDurableRuntime:()=>true,dispatchDreamOperation: async (request: { timeoutMs: number }) => {
        capturedTimeoutMs = request.timeoutMs;
        return {
          status: "error",
          error: "Timed out after 3m",
          recovery: {
            attemptsUsed: 2,
            totalElapsedMs: 30000,
            recovered: false,
            exhausted: true,
            lastClassifier: "budget_exhausted",
            strategyHistory: ["retry", "compact_then_retry"],
          },
        };
      },
      disposeChatSession: async () => {},
    } as any,
  });

  expect(result.skipped).toBe(false);
  expect(result.result).toContain("model pass failed; deterministic refresh completed");
  expect(result.result).toContain("Timed out after 3m");
  expect(result.result).toContain("Memory refreshed after Dream: yes");
  expect(result.result).toContain("Automatic recovery exhausted after 2 attempt");
  expect(capturedTimeoutMs).toBeGreaterThan(0);
  expect(existsSync(join(config.WORKSPACE_DIR, "notes", "memory", "MEMORY.md"))).toBe(true);
  expect(existsSync(join(config.WORKSPACE_DIR, "notes", "memory", ".dream.lock"))).toBe(false);
});

test('runDreamAgentTurn rejects legacy execution without creating or deleting artifacts', async () => {
  const config = await import('../src/core/config.js'); resetDreamDestructiveFixture(config);
  const db = await import('../src/db.js'); db.initDatabase();
  const directory = join(config.SESSIONS_DIR, 'dream_manual_legacy_retained');
  mkdirSync(directory,{recursive:true});writeFileSync(join(directory,'session.json'),'original');
  db.storeChatMetadata('dream:manual:legacy:retained','2026-01-01T00:00:00Z','Retained');
  const before = db.getDb().query("SELECT * FROM chats WHERE jid='dream:manual:legacy:retained'").get();
  let dispatched=0,disposed=0;
  const dream = await importFresh<typeof import('../src/dream.js')>('../src/dream.js');
  await expect(dream.runDreamAgentTurn({chatJid:'web:default',mode:'manual',agentPool:{
    isDurableRuntime:()=>false,dispatchDreamOperation:async()=>{dispatched++;},disposeChatSession:async()=>{disposed++;},
  } as any})).rejects.toThrow('Native Dream dispatcher unavailable');
  expect({dispatched,disposed}).toEqual({dispatched:0,disposed:0});
  expect(readFileSync(join(directory,'session.json'),'utf8')).toBe('original');
  expect(db.getDb().query("SELECT * FROM chats WHERE jid='dream:manual:legacy:retained'").get()).toEqual(before);
  expect(existsSync(join(config.WORKSPACE_DIR,'notes/memory/.dream.lock'))).toBe(false);
});
