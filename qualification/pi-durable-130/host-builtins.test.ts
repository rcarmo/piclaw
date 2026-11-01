import "./src/test-guard.js";
import { expect, test } from "bun:test";
import { chmodSync, mkdtempSync, readFileSync, writeFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BACKGROUND_CONTEXT as context, withAbortSignal } from "../../runtime/durable-engine/qualification/context.ts";
import { createHostBuiltinTools } from "../../runtime/durable-engine/src/host-builtins.ts";

import { listTrackedProcesses, killProcessTree } from "../../runtime/src/utils/process-tracker.js";

const api = { callId: "builtin-test", output() {}, async details() {} };

for (const cancellation of ["invocation", "lifetime", "overflow"] as const) test(`find is responsive, bounded and joins its tracked process on ${cancellation}`, async () => {
  const cwd = mkdtempSync(join(tmpdir(), "host-find-'$-"));
  const previousPath = process.env.PATH;
  const before = listTrackedProcesses();
  const controller = new AbortController();
  const pidFile = join(cwd, "fd.pid");
  writeFileSync(join(cwd, "fd"), `#!${process.execPath}\nimport { writeFileSync, renameSync } from 'node:fs';\nwriteFileSync(${JSON.stringify(pidFile + '.tmp')}, String(process.pid));\nrenameSync(${JSON.stringify(pidFile + '.tmp')}, ${JSON.stringify(pidFile)});\n${cancellation === "overflow" ? "setInterval(() => process.stdout.write('x'.repeat(65536)), 1);" : "setInterval(() => {}, 1000);"}\n`);
  chmodSync(join(cwd, "fd"), 0o700);
  process.env.PATH = cwd;
  const [tool] = createHostBuiltinTools({ cwd, names: ["find"], signal: cancellation === "lifetime" ? controller.signal : undefined, authority: { assertAllowed() {} } });
  let pid: number | undefined;
  const watchdog = setTimeout(() => controller.abort(), 3000);
  try {
    const execution = tool!.execute({ pattern: "*.txt" } as never, api as never,
      cancellation === "invocation" ? withAbortSignal(controller.signal, context) : context).then(() => null, error => error);
    // The child atomically publishes the complete PID; file existence is readiness.
    // This timer cannot run with the former spawnSync implementation.
    for (let i = 0; i < 200 && !existsSync(pidFile); i++) await Bun.sleep(5);
    expect(existsSync(pidFile)).toBe(true);
    pid = Number(readFileSync(pidFile, "utf8"));
    expect(pid).toBeGreaterThan(0);
    if (cancellation !== "overflow") {
      expect(listTrackedProcesses()).toContain(pid);
      controller.abort();
    }
    expect(await execution).toBeInstanceOf(Error);
    expect(() => process.kill(pid!, 0)).toThrow();
    expect(listTrackedProcesses()).toEqual(before);
  } finally {
    clearTimeout(watchdog); controller.abort();
    if (pid) { try { process.kill(pid, 0); killProcessTree(pid); } catch {} }
    process.env.PATH = previousPath;
    rmSync(cwd, { recursive: true, force: true });
  }
}, 5000);

test("find rechecks owner after SDK exists await and never starts fd on owner loss", async () => {
  const cwd = mkdtempSync(join(tmpdir(), "host-find-owner-"));
  const previousPath = process.env.PATH;
  const sentinel = join(cwd, "spawned");
  writeFileSync(join(cwd, "fd"), `#!${process.execPath}\nrequire('node:fs').writeFileSync(${JSON.stringify(sentinel)}, 'forbidden');\n`);
  chmodSync(join(cwd, "fd"), 0o700);
  process.env.PATH = cwd;
  let allowed = true, checks = 0;
  const before = listTrackedProcesses();
  const [tool] = createHostBuiltinTools({ cwd, names: ["find"], authority: { assertAllowed() {
    if (!allowed) throw Error("PRIVATE_OWNER");
    if (++checks === 3) queueMicrotask(() => { allowed = false; });
  } } });
  try {
    await expect(tool!.execute({ pattern: "*" } as never, api as never, context)).rejects.toThrow("Host tool authority unavailable");
    expect(checks).toBe(3);
    expect(existsSync(sentinel)).toBe(false);
    expect(listTrackedProcesses()).toEqual(before);
  } finally { process.env.PATH = previousPath; rmSync(cwd, { recursive: true, force: true }); }
});

test("existing host builtins execute read/write/edit/ls/find/bash with actual files and native results", async () => {
  const cwd = mkdtempSync(join(tmpdir(), "host-builtins-"));
  const tools = createHostBuiltinTools({ cwd, authority: { assertAllowed() {} } });
  const run = (name: string, args: unknown) => tools.find(tool => tool.name === name)!.execute(args as never, api as never, context);
  try {
    expect(tools.map(tool => tool.name)).toEqual(["read", "bash", "edit", "write", "find", "ls", "grep"]);
    await run("write", { path: "nested/a.txt", content: "before" });
    expect((await run("read", { path: "nested/a.txt" })).output).toEqual([{ type: "text", text: "before" }]);
    const edited = await run("edit", { path: "nested/a.txt", edits: [{ oldText: "before", newText: "after" }] });
    expect(readFileSync(join(cwd, "nested/a.txt"), "utf8")).toBe("after");
    expect(JSON.stringify(edited.details)).toContain("before");
    expect(JSON.stringify((await run("ls", { path: "nested" })).output)).toContain("a.txt");
    expect(JSON.stringify((await run("find", { pattern: "*.txt" })).output)).toContain("nested/a.txt");
    expect(JSON.stringify((await run("bash", { command: "printf host-builtin-bash" })).output)).toContain("host-builtin-bash");
    for (const tool of tools) expect(tool.replay).toBe("unsafe");
    expect(JSON.stringify((await run("grep", { pattern: "after", path: "nested" })).output)).toContain("a.txt:1: after");
    expect(createHostBuiltinTools({ cwd, authority: { assertAllowed() {} }, names: ["read"] }).map(tool => tool.name)).toEqual(["read"]);
  } finally { rmSync(cwd, { recursive: true, force: true }); }
});

test("revocation after SDK read await prevents actual edit write; no private errors escape", async () => {
  const cwd = mkdtempSync(join(tmpdir(), "host-edit-fence-"));
  const file = join(cwd, "a.txt"); writeFileSync(file, "original");
  let checks = 0, allowed = true;
  const [tool] = createHostBuiltinTools({ cwd, names: ["edit"], authority: { assertAllowed() {
    if (!allowed) throw Error("PRIVATE_OWNER_CONTEXT");
    checks++;
    // initial bridge, invocation, access, readFile. Revoke in the SDK's
    // await continuation gap, AFTER the actual read but BEFORE its write.
    if (checks === 4) queueMicrotask(() => { allowed = false; });
  } } });
  try {
    await expect(tool!.execute({ path: "a.txt", edits: [{ oldText: "original", newText: "changed" }] } as never, api as never, context)).rejects.toThrow("Host tool authority unavailable");
    expect(checks).toBe(4);
    expect(readFileSync(file, "utf8")).toBe("original");
  } finally { rmSync(cwd, { recursive: true, force: true }); }
});

test("caller mutation cannot replace captured authority during an SDK await", async () => {
  const cwd = mkdtempSync(join(tmpdir(), "host-captured-fence-"));
  let allowed = true;
  const authority = { assertAllowed() { if (!allowed) throw Error("PRIVATE"); } };
  const options = { cwd, names: ["write"], authority };
  const [tool] = createHostBuiltinTools(options);
  try {
    const execution = tool!.execute({ path: "new/a.txt", content: "denied" } as never, api as never, context);
    allowed = false;
    authority.assertAllowed = () => {};
    options.authority = { assertAllowed() {} };
    await expect(execution).rejects.toThrow("Host tool authority unavailable");
    expect(existsSync(join(cwd, "new"))).toBe(false);
  } finally { rmSync(cwd, { recursive: true, force: true }); }
});

test("revocation while SDK mutation queue awaits prevents mkdir and file creation", async () => {
  const cwd = mkdtempSync(join(tmpdir(), "host-write-fence-"));
  let allowed = true;
  const [tool] = createHostBuiltinTools({ cwd, names: ["write"], authority: { assertAllowed() { if (!allowed) throw Error("PRIVATE"); } } });
  try {
    const execution = tool!.execute({ path: "new/a.txt", content: "denied" } as never, api as never, context);
    allowed = false;
    await expect(execution).rejects.toThrow("Host tool authority unavailable");
    expect(existsSync(join(cwd, "new"))).toBe(false);
  } finally { rmSync(cwd, { recursive: true, force: true }); }
});

test('private Dream tools: message effects use the captured source after the admission await',async()=>{
  const {createHostDreamTools}=await import('../../runtime/durable-engine/src/host-dream-tools.ts');
  const {initDatabase,getDb,closeDatabase}=await import('../../runtime/src/db/connection.js');initDatabase();const db=getDb();
  let allowed=true,captures=0;const guard=()=>{if(!allowed)throw Error('Dream source revoked');};
  const tools=createHostDreamTools({assertOwner:guard,async capture(){captures++;await Promise.resolve();return{chatJid:'dream:private-tool-fixture',assertCurrent:guard};}});
  const invoke=(args:unknown)=>tools[0]!.execute(args as never,{...api,conversationId:18,taskId:19} as never,context);
  try{
    const before=db.query('SELECT count(*) AS n FROM messages').get();
    const pending=invoke({action:'add',content:'FORBIDDEN_DREAM_MESSAGE'});allowed=false;
    await expect(pending).rejects.toThrow('Native Dream tool failed');expect(db.query('SELECT count(*) AS n FROM messages').get()).toEqual(before);
    allowed=true;const result=await invoke({action:'search',query:'absent-dream-message',chat_jid:'*',limit:1});
    expect(JSON.stringify(result.output)).not.toContain('FORBIDDEN_DREAM_MESSAGE');expect(captures).toBe(2);
    expect(tools.map(tool=>tool.name)).toEqual(['messages','search_workspace']);expect(tools.every(tool=>tool.replay==='unsafe')).toBe(true);
  }finally{closeDatabase();}
});

test('private Dream tools: stale workspace search joins inline refresh and never launches a background writer',async()=>{
  const {createHostDreamTools}=await import('../../runtime/durable-engine/src/host-dream-tools.ts');
  const {initDatabase,closeDatabase}=await import('../../runtime/src/db/connection.js');initDatabase();
  const {getWorkspaceDir}=await import('../../runtime/src/core/config-context.js');
  const {mkdirSync}=await import('node:fs');const cwd=getWorkspaceDir();mkdirSync(join(cwd,'notes'),{recursive:true});writeFileSync(join(cwd,'notes','dream-source-search.md'),'DREAM_SEARCH_OWNED_SENTINEL');
  const search=await import('../../runtime/src/workspace-search.js');let background=0,checks=0;
  search.setBackgroundWorkspaceIndexRefreshRequesterForTests(()=>{background++;});
  const guard=()=>{checks++;};const tools=createHostDreamTools({assertOwner:guard,async capture(){return{chatJid:'dream:private-tool-fixture',assertCurrent:guard};}});
  try{
    const result=await tools[1]!.execute({query:'DREAM_SEARCH_OWNED_SENTINEL',scope:'notes',limit:1} as never,{...api,conversationId:18,taskId:19} as never,context);
    expect(JSON.stringify(result.output)).toContain('dream-source-search.md');expect(background).toBe(0);expect(checks).toBeGreaterThan(5);
    expect(search.getWorkspaceIndexStatus({scope:'notes'}).state).toBe('ready');
  }finally{search.setBackgroundWorkspaceIndexRefreshRequesterForTests(null);rmSync(join(cwd,'notes','dream-source-search.md'));closeDatabase();}
});

test('private Dream tools: index access snapshots retain and latch the invocation effect fence',async()=>{
  const {withWorkspaceIndexAuthority,workspaceIndexAccess}=await import('../../runtime/src/core/workspace-index-access.js');
  let allowed=true,checks=0;const assert=()=>{checks++;if(!allowed)throw Error('lease changed');};
  const snapshot=withWorkspaceIndexAuthority(assert,()=>workspaceIndexAccess());
  await Promise.resolve();allowed=false;expect(()=>snapshot.validate()).toThrow('Workspace index access denied');
  allowed=true;expect(()=>snapshot.validate()).toThrow('Workspace index access denied');expect(checks).toBeGreaterThan(2);
  expect(()=>workspaceIndexAccess().validate()).not.toThrow();
});

test('private Dream tools: revocation across actual index traversal await prevents the file commit',async()=>{
  const {createHostDreamTools}=await import('../../runtime/durable-engine/src/host-dream-tools.ts');
  const {initDatabase,getDb,closeDatabase}=await import('../../runtime/src/db/connection.js');initDatabase();const db=getDb();
  const {getWorkspaceDir}=await import('../../runtime/src/core/config-context.js');const {mkdirSync}=await import('node:fs');
  const fs=(await import('node:fs/promises')).default;const {spyOn}=await import('bun:test');const cwd=getWorkspaceDir(),file=join(cwd,'notes','dream-revoked-search.md');mkdirSync(join(cwd,'notes'),{recursive:true});writeFileSync(file,'DREAM_REVOKED_SEARCH_SENTINEL');
  let allowed=true,revoked=false;const guard=()=>{if(!allowed)throw Error('PRIVATE_DREAM_LEASE');};
  const original=fs.readdir,read=spyOn(fs,'readdir').mockImplementation((async(...args:Parameters<typeof original>)=>{const result=await original(...args);if(String(args[0])===join(cwd,'notes')){allowed=false;revoked=true;}return result;}) as typeof original);
  const tools=createHostDreamTools({assertOwner:guard,async capture(){return{chatJid:'dream:private-tool-fixture',assertCurrent:guard};}});
  try{
    await expect(tools[1]!.execute({query:'DREAM_REVOKED_SEARCH_SENTINEL',scope:'notes',refresh:true} as never,{...api,conversationId:18,taskId:19} as never,context)).rejects.toThrow('Native Dream tool failed');
    expect(revoked).toBe(true);expect(db.query('SELECT path FROM workspace_files WHERE path=?').all('notes/dream-revoked-search.md')).toEqual([]);
  }finally{read.mockRestore();rmSync(file);closeDatabase();}
});

test('private Dream tools: message post awaits committed storage before the registered broadcast',async()=>{
  const {createHostDreamTools}=await import('../../runtime/durable-engine/src/host-dream-tools.ts');
  const {setMessagesPostFn}=await import('../../runtime/src/extensions/messages-crud.js');
  const {initDatabase,getDb,closeDatabase}=await import('../../runtime/src/db/connection.js');initDatabase();
  const {admitSqliteWrite}=await import('../../runtime/src/db/sqlite-async-admission.js');
  const {storeChatMetadata,storeMessage}=await import('../../runtime/src/db.js');const chat='dream:private-broadcast-fixture';storeChatMetadata(chat,new Date().toISOString());
  let broadcasts=0;setMessagesPostFn(()=>{throw Error('Legacy synchronous post must not enter native SQL');},async(chatJid,content,isBot,_media,_blocks,authorise,signal)=>{
    const row=await admitSqliteWrite(getDb(),()=>storeMessage({id:'dream-broadcast-fixture',chat_jid:chatJid,sender:'fixture',sender_name:'Fixture',content,timestamp:new Date().toISOString(),is_from_me:isBot,is_bot_message:isBot}),authorise,signal);
    expect(getDb().inTransaction).toBe(false);broadcasts++;return row;
  });
  const tools=createHostDreamTools({assertOwner(){},async capture(){return{chatJid:chat,assertCurrent(){}};}});
  try{
    const result=await tools[0]!.execute({action:'post',content:'DREAM_BROADCAST_PARITY'} as never,{...api,conversationId:18,taskId:19} as never,context);
    expect(broadcasts).toBe(1);expect(JSON.stringify(result.output)).not.toContain('error');
  }finally{setMessagesPostFn(undefined);closeDatabase();}
});
