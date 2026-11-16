import { expect, test } from "bun:test";
import { HostCodexModelServices, type HostCodexAuthority } from "../../runtime/durable-engine/src/host-codex-model-services.ts";
import type { CodexOperation } from "../../runtime/durable-engine/src/host-codex-model-profile.ts";
import { addLogSink, removeLogSink, type LogRecord } from "../../runtime/src/utils/logger.ts";

const header = "x-codex-turn-state";
const model: any = { provider: "openai-codex", id: "fixture", api: "openai-codex-responses", input: ["text"] };
const factories = { createNativeCodexHooks: () => ({ request: (p: unknown) => p, headers: (h: any) => h, context: (m: any) => m, systemPrompt: (p: string) => p }) };
function fixture() {
  const state = { session: "native-conversation:1", turn: "operation:1", account: "account:1", provider: {} as object, current: true, requestOnly: false };
  const captured = new WeakMap<CodexOperation, ReturnType<HostCodexAuthority["routingScope"]>>();
  const requests: { token: string | null; headers: Headers; input: unknown; init?: RequestInit }[] = [];
  const responses: (Response | Promise<Response>)[] = [];
  let requestId = 0, observed = 0, flushed = 0;
  const service = new HostCodexModelServices({
    async capture(signal, actual) {
      const operation = { id: "request:" + ++requestId, sessionId: state.session, cwd: "/synthetic", model: actual, signal,
        assertCurrent() { if (!state.current) throw Error("source revoked"); } };
      captured.set(operation, { turnId: state.turn, accountRef: state.account, provider: state.provider, requestOnly: state.requestOnly });
      return operation;
    },
    routingScope(operation) { return captured.get(operation)!; },
    assertAccount(operation) {
      const owner = captured.get(operation)!;
      if (owner.accountRef !== state.account || owner.provider !== state.provider) throw Error("account changed");
    },
    async observe(_operation, response, check) { await response.text(); check(); observed++; },
    async flush() { flushed++; },
    fetch: (async (input, init) => {
      const headers = new Headers(init?.headers);
      requests.push({ token: headers.get(header), headers, input, init });
      return await (responses.shift() ?? new Response("synthetic", { headers: { [header]: "server:" + requests.length } }));
    }) as typeof fetch,
  }, factories);
  async function bind(actual = model, controller = new AbortController()) {
    return { bound: await service.bind(actual, controller.signal), controller };
  }
  async function send(actual = model, controller = new AbortController()) {
    const { bound } = await bind(actual, controller);
    const response = await bound.options.fetch!("https://synthetic.invalid/responses", { method: "POST", body: "synthetic body" });
    await response.text(); await bound.finish();
  }
  return { service, state, requests, responses, bind, send, observed: () => observed, flushed: () => flushed };
}

test("first request strips an injected hint without changing caller headers, body or authorization", async () => {
  const f = fixture(); const { bound } = await f.bind();
  const headers = new Headers({ [header]: "caller-forged", authorization: "Bearer synthetic-only", "x-other": "keep" });
  const init = { method: "POST", headers, body: "owned body" };
  await bound.options.fetch!("https://synthetic.invalid/responses", init); await bound.finish();
  expect(f.requests[0]!.token).toBeNull();
  expect(headers.get(header)).toBe("caller-forged");
  expect(f.requests[0]!.headers.get("authorization")).toBe("Bearer synthetic-only");
  expect(f.requests[0]!.headers.get("x-other")).toBe("keep");
  expect(f.requests[0]!.init?.body).toBe("owned body"); expect(f.requests[0]!.init?.method).toBe("POST");
});

test("different model request IDs in one turn reuse the first response token, never a later replacement", async () => {
  const f = fixture(); await f.send(); await f.send(); await f.send();
  expect(f.requests.map(r => r.token)).toEqual([null, "server:1", "server:1"]);
  expect([f.observed(), f.flushed()]).toEqual([3, 3]);
});

test("a new user turn on the same conversation begins without the preceding turn token", async () => {
  const f = fixture(); await f.send(); f.state.turn = "operation:2"; await f.send(); await f.send();
  expect(f.requests.map(r => r.token)).toEqual([null, null, "server:2"]);
});

test("parent and Delegate conversations have independent routing even under the same host operation", async () => {
  const f = fixture(); await f.send();
  f.state.session = "native-conversation:2"; await f.send(); await f.send();
  f.state.session = "native-conversation:1"; await f.send();
  expect(f.requests.map(r => r.token)).toEqual([null, null, "server:2", "server:1"]);
});

test("concurrent maintenance has its own turn and model without displacing the parent token", async () => {
  const f = fixture(); await f.send();
  f.state.turn = "durable-maintenance:1"; await f.send({ ...model, id: "compaction-model" });
  f.state.turn = "operation:1"; await f.send();
  f.service.releaseTurn("durable-maintenance:1"); await f.send();
  expect(f.requests.map(r => r.token)).toEqual([null, null, "server:1", "server:1"]);
});

for (const ownership of ["account", "provider"] as const) test(`${ownership} ownership changes cannot restore an older token when switched back`, async () => {
  const f = fixture(); const original = f.state[ownership]; await f.send();
  if (ownership === "account") f.state.account = "account:2"; else f.state.provider = {};
  await f.send();
  if (ownership === "account") f.state.account = original as string; else f.state.provider = original as object;
  await f.send();
  expect(f.requests.map(r => r.token)).toEqual([null, null, null]);
});

test("changing the physical model within a turn resets its hint, including switching back", async () => {
  const f = fixture(); await f.send(); await f.send({ ...model, id: "alternate" }); await f.send();
  expect(f.requests.map(r => r.token)).toEqual([null, null, null]);
});

test("changing the model endpoint resets routing before switching back", async () => {
  const f = fixture();
  await f.send({ ...model, baseUrl: "https://first.invalid" });
  await f.send({ ...model, baseUrl: "https://second.invalid" });
  await f.send({ ...model, baseUrl: "https://first.invalid" });
  expect(f.requests.map(r => r.token)).toEqual([null, null, null]);
});

test("switching to a non-Codex profile retires only that logical turn", async () => {
  const f = fixture(); await f.send();
  f.state.turn = "maintenance:other"; await f.send();
  f.state.turn = "operation:1";
  const other = await f.bind({ ...model, provider: "github-copilot", api: "openai-responses" });
  expect(other.bound.options.fetch).toBeUndefined(); await other.bound.finish();
  await f.send();
  f.state.turn = "maintenance:other"; await f.send();
  expect(f.requests.map(r => r.token)).toEqual([null, null, null, "server:2"]);
});

test("terminal host settlement clears both parent and Delegate state idempotently", async () => {
  const f = fixture(); await f.send(); f.state.session = "native-conversation:2"; await f.send();
  f.service.releaseTurn("operation:1"); f.service.releaseTurn("operation:1");
  await f.send(); f.state.session = "native-conversation:1"; await f.send();
  expect(f.requests.map(r => r.token)).toEqual([null, null, null, null]);
});

test("unsuccessful and empty response hints do not seed routing", async () => {
  const f = fixture();
  f.responses.push(new Response("denied", { status: 401, headers: { [header]: "must-not-use" } }), new Response("empty", { headers: { [header]: "" } }));
  await f.send(); await f.send(); await f.send(); await f.send();
  expect(f.requests.map(r => r.token)).toEqual([null, null, null, "server:3"]);
});

test("maintenance hints are retired at request completion even without a settlement callback", async () => {
  const f = fixture(); f.state.requestOnly = true; await f.send(); await f.send();
  expect(f.requests.map(r => r.token)).toEqual([null, null]);
});

test("the already-known hint is reused for another fetch in the same owned request", async () => {
  const f = fixture(); const { bound } = await f.bind();
  await bound.options.fetch!("https://synthetic.invalid/responses");
  await bound.options.fetch!("https://synthetic.invalid/responses"); await bound.finish();
  expect(f.requests.map(r => r.token)).toEqual([null, "server:1"]);
});

test("Request input headers are inherited without mutating the Request", async () => {
  const f = fixture(); const { bound } = await f.bind();
  const input = new Request("https://synthetic.invalid/responses", { headers: { [header]: "forged", "x-request": "kept" } });
  await bound.options.fetch!(input); await bound.finish();
  expect(f.requests[0]!.input).toBe(input); expect(f.requests[0]!.token).toBeNull();
  expect(f.requests[0]!.headers.get("x-request")).toBe("kept"); expect(input.headers.get(header)).toBe("forged");
});

test("aborting an active request clears its turn and a late response cannot seed state", async () => {
  const f = fixture(); let release!: (r: Response) => void;
  f.responses.push(new Promise(r => release = r));
  const { bound, controller } = await f.bind();
  const pending = bound.options.fetch!("https://synthetic.invalid/responses");
  controller.abort(); release(new Response("late", { headers: { [header]: "late-token" } }));
  await expect(pending).rejects.toThrow();
  await expect(bound.finish()).rejects.toThrow();
  await f.send(); expect(f.requests.map(r => r.token)).toEqual([null, null]); expect(f.observed()).toBe(1);
});

test("an old completed request's later abort does not clear a continuing turn", async () => {
  const f = fixture(); const controller = new AbortController(); await f.send(model, controller);
  const next = await f.bind(); controller.abort();
  await next.bound.options.fetch!("https://synthetic.invalid/responses"); await next.bound.finish();
  expect(f.requests.map(r => r.token)).toEqual([null, "server:1"]);
});

test("retired turns reject late responses rather than resurrecting their token", async () => {
  const f = fixture(); let release!: (r: Response) => void;
  f.responses.push(new Promise(r => release = r)); const { bound } = await f.bind();
  const pending = bound.options.fetch!("https://synthetic.invalid/responses");
  f.service.releaseTurn("operation:1"); release(new Response("late", { headers: { [header]: "late-token" } }));
  await expect(pending).rejects.toThrow("Codex routing scope changed"); await bound.finish();
  await f.send(); expect(f.requests.map(r => r.token)).toEqual([null, null]); expect(f.observed()).toBe(1);
});

test("a changed model invalidates an older in-flight response", async () => {
  const f = fixture(); let release!: (r: Response) => void;
  f.responses.push(new Promise(r => release = r)); const old = await f.bind();
  const pending = old.bound.options.fetch!("https://synthetic.invalid/responses");
  const next = await f.bind({ ...model, id: "alternate" });
  release(new Response("old model", { headers: { [header]: "old-model-token" } }));
  await expect(pending).rejects.toThrow("Codex routing scope changed"); await old.bound.finish();
  await next.bound.options.fetch!("https://synthetic.invalid/responses"); await next.bound.finish();
  expect(f.requests.map(r => r.token)).toEqual([null, null]);
});

test("source revocation after HTTP response prevents routing capture and artifact writes", async () => {
  const f = fixture(); let release!: (r: Response) => void;
  f.responses.push(new Promise(r => release = r)); const { bound } = await f.bind();
  const pending = bound.options.fetch!("https://synthetic.invalid/responses");
  f.state.current = false; release(new Response("late", { headers: { [header]: "denied-token" } }));
  await expect(pending).rejects.toThrow("source revoked"); await expect(bound.finish()).rejects.toThrow("source revoked");
  expect(f.observed()).toBe(0); expect(f.requests).toHaveLength(1);
});

test("a response arriving after request finish cannot seed the next continuation", async () => {
  const f = fixture(); let release!: (r: Response) => void;
  f.responses.push(new Promise(r => release = r)); const { bound } = await f.bind();
  const pending = bound.options.fetch!("https://synthetic.invalid/responses");
  await bound.finish(); release(new Response("late", { headers: { [header]: "closed-token" } }));
  await expect(pending).rejects.toThrow("Codex output closed");
  await f.send(); expect(f.requests.map(r => r.token)).toEqual([null, null]);
});

test("finished request closures cannot dispatch again", async () => {
  const f = fixture(); const { bound } = await f.bind(); await bound.finish();
  await expect(bound.options.fetch!("https://synthetic.invalid/responses")).rejects.toThrow("Codex output closed"); expect(f.requests).toHaveLength(0);
});

test("disposal seals new routing while still joining an owned artifact flush", async () => {
  const f = fixture(); const { bound } = await f.bind(); await bound.options.fetch!("https://synthetic.invalid/responses");
  f.service.dispose(); f.service.dispose(); await bound.finish();
  expect([f.observed(), f.flushed()]).toEqual([1, 1]);
  await expect(f.bind()).rejects.toThrow("Codex model services closed");
  await expect(bound.options.fetch!("https://synthetic.invalid/responses")).rejects.toThrow(); expect(f.requests).toHaveLength(1);
});

test("a new process-local service does not recover old turn hints", async () => {
  const first = fixture(); await first.send(); first.service.dispose();
  const reopened = fixture(); await reopened.send(); expect(reopened.requests[0]!.token).toBeNull();
});

test("routing tokens are fingerprinted, not exposed by enabled diagnostics", async () => {
  const old = process.env.PICLAW_PROMPT_CACHE_AUDIT; const records: LogRecord[] = [];
  const sink = (record: LogRecord) => { if (record.module === "durable.prompt-cache") records.push(record); };
  addLogSink(sink); process.env.PICLAW_PROMPT_CACHE_AUDIT = "1";
  try {
    const f = fixture(); f.responses.push(new Response("ok", { headers: { [header]: "PRIVATE-ROUTING-TOKEN" } })); await f.send(); await f.send();
    expect(f.requests[1]!.token).toBe("PRIVATE-ROUTING-TOKEN"); expect(JSON.stringify(records)).not.toContain("PRIVATE-ROUTING-TOKEN");
    expect(records.some(r => Object.hasOwn(r, "header_x-codex-turn-state"))).toBe(true);
  } finally { removeLogSink(sink); if (old === undefined) delete process.env.PICLAW_PROMPT_CACHE_AUDIT; else process.env.PICLAW_PROMPT_CACHE_AUDIT = old; }
});
