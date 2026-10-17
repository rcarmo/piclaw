import { expect, test, spyOn } from "bun:test";
import { Database } from "bun:sqlite";
import { createHash } from "node:crypto";
import { mkdtempSync, mkdirSync, copyFileSync, writeFileSync, readFileSync, existsSync, unlinkSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import type { ToolDefinition, ExtensionToolContext } from "../../node_modules/@earendil-works/pi-coding-agent";
import type { TSchema } from "../../runtime/durable-engine/qualification/ai.ts";
import type { JsonValue } from "../../runtime/durable-engine/qualification/chord.ts";
import type { ToolExecutionApi } from "../../runtime/durable-engine/qualification/durable.ts";
import { BACKGROUND_CONTEXT as context, withAbortSignal } from "../../runtime/durable-engine/qualification/context.ts";
import { createHostTool } from "../../runtime/durable-engine/src/index.js";
import { actualAddonGraph } from "./src/actual-addon-graph.ts";

// Actual 0.2.20 closure, copied beside candidate dependencies, never live imports.
// Synthetic child executable and SQLite approval only: no real CLI/auth/network.
test("actual Delegate: approved exact synthetic CLI via durable host context, persisted result/reopen, abort and deadline fences", async () => {
  const root = process.env.DURABLE_ADDONS_ROOT;
  if (!root) throw Error("DURABLE_ADDONS_ROOT required at de92bc9");
  const files = ["index", "delegate", "compat/extension-kv"];
  const hash = createHash("sha256");
  for (const file of files) { hash.update(file + "\0"); hash.update(await Bun.file(resolve(root, "addons/delegate", file + ".ts")).text()); }
  expect(hash.digest("hex")).toBe("d76c40e6887526ef9d1b19193b617fb25302b8bebbe5b98632b1bb0eea46d584");
  expect((await Bun.file(resolve(root, "addons/delegate/package.json")).json()).version).toBe("0.2.20");
  const dir = mkdtempSync(join(tmpdir(), "durable-actual-delegate-"));
  const copy = mkdtempSync(resolve(import.meta.dir, "pinned-delegate-copy-"));
  const globals = globalThis as any;
  const keys = ["__piclawRuntimeInterop", "__piclaw_registerAddonConfigApi"];
  const saved = keys.map(key => Object.getOwnPropertyDescriptor(globals, key));
  const oldCli = process.env.PI_DELEGATE_CLI;
  const db = new Database(join(dir, "fixture-kv.sqlite"));
  db.exec("CREATE TABLE kv (key TEXT PRIMARY KEY, value TEXT NOT NULL)");
  const receipts = join(dir, "receipts.jsonl"), pidFile = join(dir, "blocked.pid");
  let definition: ToolDefinition<TSchema, JsonValue> | undefined;
  let config: any, catalog: any, allowed = true, invocations = 0, thinking = "medium";
  const hooks = new Map<string, (event: any, ctx: any) => Promise<any>>();
  let active = ["read"];
  let lateUpdate: (() => void) | undefined;
  const check = () => { if (!allowed) throw Error("PRIVATE_SYNTHETIC_OWNER"); };
  try {
    for (const file of files) {
      const dest = join(copy, file + ".ts"); mkdirSync(resolve(dest, ".."), { recursive: true });
      copyFileSync(resolve(root, "addons/delegate", file + ".ts"), dest);
    }
    writeFileSync(join(copy, "package.json"), JSON.stringify({ private: true, type: "module" }));
    const cli = join(dir, "synthetic-cli.ts");
    writeFileSync(cli, `#!${process.execPath}\nimport {appendFileSync,writeFileSync} from 'node:fs';
const args=process.argv.slice(2);
if(args.includes('--list-models')) { console.log('provider model context max-out thinking images'); console.log('github-copilot gpt-6.1-sol 1M 128K yes yes'); process.exit(0); }
const prompt=await Bun.stdin.text();
appendFileSync(${JSON.stringify(receipts)},JSON.stringify({args,prompt,pid:process.pid})+'\\n');
if(prompt==='blocked') { writeFileSync(${JSON.stringify(pidFile)},String(process.pid)); setInterval(()=>{},1000); await new Promise(()=>{}); }
console.log(JSON.stringify({type:'message_end',message:{role:'assistant',provider:'github-copilot',model:'gpt-6.1-sol',content:[{type:'text',text:'SYNTHETIC_CHILD_RESULT'}],stopReason:'stop'}}));
`, { mode: 0o700 });
    process.env.PI_DELEGATE_CLI = cli;
    globals.__piclawRuntimeInterop = { getExtensionKvStore: () => ({
      get(extension: string, key: string, scope: string) {
        expect([extension, key, scope]).toEqual(["delegate", "config", "global"]);
        const row = db.query("SELECT value FROM kv WHERE key=?").get(key) as { value: string } | null;
        return row ? JSON.parse(row.value) : null;
      },
      set(extension: string, key: string, value: unknown, scope: string) {
        expect([extension, key, scope]).toEqual(["delegate", "config", "global"]);
        db.query("INSERT OR REPLACE INTO kv VALUES (?,?)").run(key, JSON.stringify(value));
      },
    }) };
    globals.__piclaw_registerAddonConfigApi = (id: string, action: string, api: any) => {
      expect(id).toBe("delegate");
      if (action === "config") config = api; else if (action === "models") catalog = api; else throw Error("Unexpected API");
    };
    const actual = await import(join(copy, "index.ts"));
    actual.default({
      registerTool(tool: ToolDefinition<TSchema, JsonValue>) { expect(definition).toBeUndefined(); definition = tool; },
      on(event: string, hook: any) { expect(["session_start", "model_select", "before_agent_start"]).toContain(event); hooks.set(event, hook); },
      getThinkingLevel: () => thinking,
      getActiveTools: () => active,
      setActiveTools: (tools: string[]) => { active = tools; },
    });
    if (!definition) throw Error("Missing actual Delegate tool");
    expect(definition.outputSchema).toBeUndefined(); expect(definition.reachesTools).toBeUndefined();
    // JSON physical catalog/reference, not a 1.3 Context cast into a 1.2 context.
    const model = JSON.parse(JSON.stringify({ provider: "github-copilot", id: "gpt-6.1-sol", name: "GPT 6.1 SOL", reasoning: true, input: ["text", "image"] }));
    const hostContext = { cwd: dir, model, modelRegistry: { getAvailable: () => [structuredClone(model)] } };
    await hooks.get("session_start")!({}, hostContext);
    await hooks.get("model_select")!({}, hostContext);
    const hint = await hooks.get("before_agent_start")!({ systemPrompt: "fixture host" }, hostContext);
    expect(hint.systemPrompt).toContain("No providers are approved by default");
    expect(active).toEqual(["read", "delegate"]);
    expect((await config.get()).config.searchable_providers).toBeNull();
    expect((await catalog.get()).candidates).toEqual([]);
    const bridge = createHostTool(definition, { authority: { check }, effectFence: "host-effect-port",
      async invoke(args, call) {
        invocations++; call.assertAllowed();
        lateUpdate = () => call.onUpdate({ content: [{ type: "text", text: "late" }], details: {} });
        const result = await call.execute(call.toolCallId, args, call.signal, call.onUpdate, hostContext as ExtensionToolContext);
        call.assertAllowed(); return JSON.parse(JSON.stringify(result));
      } });
    const api = { callId: "fixture-call", output() {}, async details() {} } as unknown as ToolExecutionApi<JsonValue>;
    const invoke = (prompt: string, signal?: AbortSignal) => bridge.execute({ prompt, model: "github-copilot/gpt-6.1-sol", tools: "read" }, api, signal ? withAbortSignal(signal, context) : context);
    await expect(invoke("denied")).rejects.toThrow("Host tool execution failed");
    expect(existsSync(receipts)).toBe(false);
    await config.set({ searchable_providers: ["github-copilot"], excluded_providers: [], excluded_models: [] });
    const models = await catalog.get();
    expect(models.candidates.map((m: any) => m.id)).toEqual(["github-copilot/gpt-6.1-sol"]);
    expect(models.unclassified_models).toEqual([]);
    expect(models.runtime_catalog.current_model).toBe("github-copilot/gpt-6.1-sol");
    invocations = 0;
    const launches = () => existsSync(receipts) ? readFileSync(receipts, "utf8").trim().split("\n").map(line => JSON.parse(line)) : [];
    await actualAddonGraph(dir, [bridge], () => invocations, () => { allowed = false; }, () => launches(), true);
    expect(launches()).toHaveLength(1);
    const receipt = launches()[0];
    expect(receipt.prompt).toBe("synthetic child task");
    expect(receipt.args).toContain("--no-session"); expect(receipt.args).toContain("--no-extensions");
    expect(receipt.args).not.toContain("-e");
    for (const [flag, value] of [["--tools", "read"], ["--thinking", "medium"], ["--model", "github-copilot/gpt-6.1-sol"]]) expect(receipt.args[receipt.args.indexOf(flag) + 1]).toBe(value);
    expect(receipt.args.join(" ")).not.toContain("MCP: use");
    expect(() => lateUpdate!()).toThrow("Host tool invocation ended");
    allowed = true; thinking = "high";
    const aborted = new AbortController(); aborted.abort();
    await expect(invoke("preabort", aborted.signal)).rejects.toThrow("Host tool permission denied");
    expect(launches()).toHaveLength(1);
    // A blocked actual owned POSIX child is aborted by the public bridge signal.
    const controller = new AbortController();
    const blocked = invoke("blocked", controller.signal);
    const rejected = blocked.then(() => "unexpected success", error => error.message as string);
    for (let i = 0; !existsSync(pidFile) && i < 200; i++) await Bun.sleep(10);
    expect(existsSync(pidFile)).toBe(true);
    const pid = Number(readFileSync(pidFile, "utf8"));
    controller.abort(); expect(await rejected).toBe("Host tool permission denied");
    for (let i = 0; i < 200; i++) { try { process.kill(pid, 0); } catch { break; } await Bun.sleep(10); }
    expect(() => process.kill(pid, 0)).toThrow();
    expect(() => process.kill(-pid, 0)).toThrow();
    unlinkSync(pidFile); // The owned group is gone; do not retain a stale numeric cleanup target.
    expect(launches()[1].args[launches()[1].args.indexOf("--thinking") + 1]).toBe("high");
    expect(() => lateUpdate!()).toThrow("Host tool invocation ended");
    // Deadline expires in actual setup; avoid spending ten seconds on a timer.
    const clock = Date.now.bind(Date); let offset = 0;
    const spy = spyOn(Date, "now").mockImplementation(() => clock() + offset);
    const deadlineBridge = createHostTool(definition, { authority: { check }, effectFence: "host-effect-port",
      invoke(args, call) { return call.execute(call.toolCallId, args, call.signal, () => { offset = 301_000; }, hostContext as ExtensionToolContext); } });
    try { await expect(deadlineBridge.execute({ prompt: "deadline", model: "github-copilot/gpt-6.1-sol", tools: "read" }, api, context)).rejects.toThrow("Host tool execution failed"); }
    finally { spy.mockRestore(); }
    expect(launches()).toHaveLength(2);
  } finally {
    if (existsSync(pidFile)) { try { process.kill(-Number(readFileSync(pidFile, "utf8")), "SIGKILL"); } catch {} }
    if (oldCli === undefined) delete process.env.PI_DELEGATE_CLI; else process.env.PI_DELEGATE_CLI = oldCli;
    keys.forEach((key, i) => { if (saved[i]) Object.defineProperty(globals, key, saved[i]!); else delete globals[key]; });
    db.close(); rmSync(dir, { recursive: true, force: true }); rmSync(copy, { recursive: true, force: true });
  }
}, 15_000);
