import { afterEach, expect, test } from "bun:test";
import {
  getAgentUiSnapshot,
  invalidateAgentUiSnapshot,
} from "../../web/src/ui/agent-ui-snapshot";
import {
  getAgentStatus,
  getAgentContext,
  getAgentModelState,
  getSystemMetrics,
} from "../../web/src/api";
test("enabled meters use a dedicated coalesced GPU-demand endpoint", async () => {
  let finish!: (response: Response) => void;
  const gate = new Promise<Response>((resolve) => { finish = resolve; });
  const urls: string[] = [];
  globalThis.fetch = (async (input) => { urls.push(String(input)); return gate; }) as typeof fetch;
  const a = getSystemMetrics();
  const b = getSystemMetrics();
  expect(urls).toEqual(["/agent/system-metrics"]);
  finish(Response.json({ cpu_percent: 1, gpus: [] }));
  expect(await a).toEqual({ cpu_percent: 1, gpus: [] });
  expect(await b).toEqual({ cpu_percent: 1, gpus: [] });
});

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});
const payload = (model = "fixture/one") => ({
  status: { status: "idle" },
  model: { current: model },
  context: { tokens: 12 },
  metrics: { cpu_percent: 1 },
  agent_name: "Fixture",
  errors: [],
});
test("Classic status/context/model consumers share one request and reply with Visual transport", async () => {
  const jid = "web:coalesce";
  let calls = 0;
  globalThis.fetch = (async (input) => {
    calls++;
    expect(String(input)).toBe("/agent/status?chat_jid=web%3Acoalesce&ui=1");
    await Promise.resolve();
    return Response.json(payload());
  }) as typeof fetch;
  const [b, a, c, d] = await Promise.all([
    getAgentContext(jid),
    getAgentStatus(jid),
    getAgentModelState(jid),
    getAgentUiSnapshot(jid),
  ]);
  expect(calls).toBe(1);
  expect(a).toBe(d.status);
  expect(b).toBe(d.context);
  expect(c).toBe(d.model);
  expect(await getAgentUiSnapshot(jid)).toBe(d);
  expect(calls).toBe(1);
  invalidateAgentUiSnapshot(jid);
  const next = await getAgentUiSnapshot(jid);
  expect(calls).toBe(2);
  expect(next.status).toBe(d.status);
  expect(next.context).toBe(d.context);
});
test("passive status and model coalesce without context; explicit demand can race independently", async () => {
  const jid = 'web:passive-context';
  const urls: string[] = [];
  let release!: () => void;
  const pending = new Promise<Response>(resolve => { release = () => resolve(Response.json({ ...payload(), context: null })); });
  globalThis.fetch = (async input => {
    const url = new URL(String(input), 'http://fixture');
    urls.push(url.search);
    if (url.searchParams.get('context') === '0') return pending;
    return Response.json(payload());
  }) as typeof fetch;
  const status = getAgentStatus(jid), model = getAgentModelState(jid);
  expect(urls).toEqual(['?chat_jid=web%3Apassive-context&ui=1&context=0']);
  expect(await getAgentContext(jid)).toEqual({ tokens: 12 });
  release();
  expect(await status).toEqual({ status: 'idle' });
  expect(await model).toEqual({ current: 'fixture/one' });
  expect(urls).toEqual(['?chat_jid=web%3Apassive-context&ui=1&context=0', '?chat_jid=web%3Apassive-context&ui=1']);
});
test("chat isolation and invalidation while parsing a body discard the stale reply for all joiners", async () => {
  let release!: () => void;
  let calls = 0;
  globalThis.fetch = (async () => {
    calls++;
    if (calls === 1)
      return {
        ok: true,
        json: () =>
          new Promise((resolve) => {
            release = () => resolve(payload("fixture/old"));
          }),
      } as Response;
    return Response.json(payload("fixture/new"));
  }) as typeof fetch;
  const first = getAgentUiSnapshot("web:race");
  await Promise.resolve();
  await Promise.resolve();
  const joined = getAgentUiSnapshot("web:race");
  expect(first).toBe(joined);
  invalidateAgentUiSnapshot("web:race");
  release();
  const [a, b] = await Promise.all([first, joined]);
  expect(a).toBe(b);
  expect(a.model.current).toBe("fixture/new");
  expect(calls).toBe(2);
  await getAgentUiSnapshot("web:other");
  expect(calls).toBe(3);
});
for (const status of [401, 403, 500])
  test(`failed HTTP${status} is never cached`, async () => {
    let calls = 0;
    globalThis.fetch = (async () => {
      calls++;
      return calls === 1
        ? new Response(null, { status })
        : Response.json(payload());
    }) as typeof fetch;
    await expect(getAgentUiSnapshot("web:failed" + status)).rejects.toThrow(
      `HTTP ${status}`,
    );
    expect(
      (await getAgentUiSnapshot("web:failed" + status)).model.current,
    ).toBe("fixture/one");
    expect(calls).toBe(2);
  });
test("partial snapshot lets healthy consumers work but failing sections are not fabricated", async () => {
  globalThis.fetch = (async () =>
    Response.json({
      ...payload(),
      context: null,
      errors: ["context"],
    })) as typeof fetch;
  const jid = "web:partial";
  expect((await getAgentStatus(jid)).status).toBe("idle");
  await expect(getAgentContext(jid)).rejects.toThrow("Context unavailable");
});

test("snapshot module imports with a partial non-browser window", async () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, "window");
  try {
    Object.defineProperty(globalThis, "window", { configurable: true, value: { location: { href: "http://fixture/" } } });
    const { importFresh } = await import("../helpers");
    const module = await importFresh("../../web/src/ui/agent-ui-snapshot.ts", import.meta.url);
    expect(typeof module.getAgentUiSnapshot).toBe("function");
  } finally {
    if (original) Object.defineProperty(globalThis, "window", original);
    else Reflect.deleteProperty(globalThis, "window");
  }
});
