import { afterAll, beforeAll, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { join } from "node:path";
import {
  chromium,
  webkit,
  type Browser,
  type BrowserContext,
} from "playwright";
import {
  initializePickerPins,
  readPickerPins,
  changePickerPins,
  parsePinChange,
} from "../../src/db/picker-pins";
const enabled = process.env.PICLAW_RUN_OPTIONAL_BROWSER_TESTS === "1",
  browserTest = enabled ? test : test.skip;
let db: Database, server: ReturnType<typeof Bun.serve>;
const browsers: Record<string, Browser> = {};
const streams = new Map<
  string,
  Set<ReadableStreamDefaultController<Uint8Array>>
>();
const counts = new Map<string, number>();
const failures = new Set<string>();
beforeAll(async () => {
  if (!enabled) return;
  db = new Database(":memory:");
  initializePickerPins(db);
  const build = await Bun.build({
    entrypoints: [
      join(import.meta.dir, "fixtures/picker-pin-sync-fixture.tsx"),
    ],
    target: "browser",
    jsx: { runtime: "automatic", importSource: "preact" },
  });
  if (!build.success) throw Error(String(build.logs));
  const script = await build.outputs[0].text();
  server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    idleTimeout: 0,
    async fetch(req) {
      const u = new URL(req.url);
      const owner =
        (req.headers.get("cookie") || "").match(/account=([\w-]+)/)?.[1] ||
        "operator";
      if (u.pathname === "/fixture.js")
        return new Response(script, {
          headers: { "Content-Type": "text/javascript" },
        });
      if (u.pathname === "/sse") {
        let control: ReadableStreamDefaultController<Uint8Array>;
        const clients = streams.get(owner) || new Set();
        streams.set(owner, clients);
        return new Response(
          new ReadableStream({
            start(c) {
              control = c;
              clients.add(c);
              c.enqueue(new TextEncoder().encode(": connected\n\n"));
            },
            cancel() {
              clients.delete(control);
            },
          }),
          { headers: { "Content-Type": "text/event-stream" } },
        );
      }
      if (u.pathname === "/agent/picker-pins") {
        counts.set(owner, (counts.get(owner) || 0) + 1);
        if (req.method === "GET")
          return Response.json(readPickerPins(db, owner));
        if (failures.has(owner))
          return Response.json({ error: "fixture failure" }, { status: 503 });
        const value = changePickerPins(
          db,
          owner,
          parsePinChange(await req.json()),
        );
        for (const stream of streams.get(owner) || []) {
          try {
            stream.enqueue(
              new TextEncoder().encode(
                "event: picker_pins_changed\ndata: {}\n\n",
              ),
            );
          } catch {
            streams.get(owner)?.delete(stream);
          }
        }
        return Response.json(value);
      }
      if (u.pathname === "/agent/active-chats")
        return Response.json({
          chats: [
            { chat_jid: "web:default", agent_name: "current" },
            { chat_jid: "web:one", agent_name: "one" },
            { chat_jid: "web:two", agent_name: "two" },
          ],
        });
      if (u.pathname === "/agent/branches")
        return Response.json({ branches: [] });
      if (u.pathname.startsWith("/static/"))
        return new Response(
          Bun.file(join(import.meta.dir, "../../web", u.pathname)),
        );
      const skin =
        "classic";
      return new Response(
        `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/static/${skin}/css/styles.css"><style>body{padding:16px}#app{position:relative;min-height:400px}.compose-model-popup{position:relative!important;bottom:auto!important;top:auto!important}.session-pill__dropdown{position:relative;bottom:auto;top:auto}</style></head><body><div id="errors" role="alert"></div><pre id="state"></pre><div id="app"></div><script type="module" src="/fixture.js"></script></body></html>`,
        { headers: { "Content-Type": "text/html" } },
      );
    },
  });
  browsers.chromium = await chromium.launch();
  browsers.webkit = await webkit.launch();
}, 30000);
afterAll(async () => {
  for (const b of Object.values(browsers)) await b.close();
  for (const set of streams.values())
    for (const c of set)
      try {
        c.close();
      } catch (error) { console.debug('Fixture stream already closed during browser teardown.', error); }
  server?.stop(true);
  db?.close();
});
async function context(
  engine: string,
  owner: string,
  seed = false,
): Promise<BrowserContext> {
  const c = await browsers[engine].newContext();
  await c.addCookies([
    { name: "account", value: owner, url: server.url.origin },
  ]);
  if (seed)
    await c.addInitScript(() => {
      if (!localStorage.getItem("seeded")) {
        localStorage.setItem(
          "piclaw:model-catalogue-preferences:v1",
          JSON.stringify({
            pinnedKeys: ["test/legacy"],
            recentByKey: { "test/local": "2026-09-20T12:00:00Z" },
            sort: "context",
            compatibleOnly: true,
          }),
        );
        localStorage.setItem(
          "piclaw:session-picker-preferences:v1",
          JSON.stringify({ pinnedChatJids: ["web:legacy"] }),
        );
        localStorage.setItem("seeded", "1");
      }
    });
  return c;
}
for (const engine of ["chromium", "webkit"])
  browserTest(
    `${engine}: independent browsers import once, sync both pin kinds, and keep stale unpins removed`,
    async () => {
      const owner = "shared-" + engine;
      const a = await context(engine, owner, true),
        b = await context(engine, owner),
        other = await context(engine, "other-" + engine);
      const pa = await a.newPage(),
        pb = await b.newPage(),
        po = await other.newPage();
      const errors: string[] = [];
      for (const p of [pa, pb, po]) p.setDefaultTimeout(5000);
      for (const p of [pa, pb, po])
        p.on("pageerror", (e) => errors.push(e.message));
      try {
        await pa.goto(server.url + "?skin=classic");
        await pa.waitForFunction(() =>
          (window as any).pinFixture?.state().models.includes("test/legacy"),
        );
        await pb.goto(server.url + "?skin=classic");
        await po.goto(server.url + "?skin=classic");
        await pb.waitForFunction(() =>
          (window as any).pinFixture?.state().sessions.includes("web:legacy"),
        );
        await po.waitForFunction(() => Boolean((window as any).pinFixture));
        await Promise.all([
          pa
            .getByRole("option", { name: /^test\/a,/ })
            .locator(".compose-model-catalogue-pin")
            .click(),
          pb.evaluate(() => (window as any).pinFixture.session("web:one")),
        ]);
        for (const p of [pa, pb])
          await p.waitForFunction(() => {
            const s = (window as any).pinFixture.state();
            return (
              s.models.includes("test/a") && s.sessions.includes("web:one")
            );
          });
        expect(
          await po.evaluate(() => (window as any).pinFixture.state()),
        ).toEqual({ models: [], sessions: [] });
        expect(
          await pa
            .getByRole("option", { name: /^test\/a,/ })
            .locator(".compose-model-catalogue-pin")
            .getAttribute("title"),
        ).toBe("Unpin model");
        await pb.locator(".session-pill").click();
        await pb
          .getByRole("button", { name: "Unpin session one", exact: true })
          .click();
        await pa.waitForFunction(
          () =>
            !(window as any).pinFixture.state().sessions.includes("web:one"),
        );
        expect(new URL(pb.url()).searchParams.get("chat_jid")).toBeNull();
        await pa.evaluate(() => {
          (window as any).pinFixture.model("test/legacy");
          (window as any).pinFixture.session("web:legacy");
        });
        await pb.waitForFunction(
          () =>
            !(window as any).pinFixture.state().models.includes("test/legacy"),
        );
        const stale = await context(engine, owner, true);
        try {
          const ps = await stale.newPage();
          await ps.goto(server.url + "?skin=classic");
          await ps.waitForFunction(() => Boolean((window as any).pinFixture));
          await ps.evaluate(() => (window as any).pinFixture.refresh());
          expect(
            await ps.evaluate(() => (window as any).pinFixture.state()),
          ).toEqual({ models: ["test/a"], sessions: [] });
        } finally {
          await stale.close();
        }
        await pa.reload();
        await pa.waitForFunction(() =>
          (window as any).pinFixture?.state().models.includes("test/a"),
        );
        const local = await pa.evaluate(() =>
          JSON.parse(
            localStorage.getItem("piclaw:model-catalogue-preferences:v1")!,
          ),
        );
        expect(local.recentByKey["test/local"]).toBeTruthy();
        expect(local.sort).toBe("context");
        expect(local.compatibleOnly).toBe(true);
        failures.add(owner);
        await pa.evaluate(() =>
          (window as any).pinFixture.model("test/failed"),
        );
        await pa.waitForFunction(
          () => (window as any).pinFixture.errors.length > 0,
        );
        expect(
          (await pa.evaluate(() => (window as any).pinFixture.state())).models,
        ).not.toContain("test/failed");
        failures.delete(owner);
        await pa.evaluate(() => (window as any).pinFixture.model("test/retry"));
        await pb.waitForFunction(() =>
          (window as any).pinFixture.state().models.includes("test/retry"),
        );
        await pa.evaluate(() => (window as any).pinFixture.stop());
        await pb.evaluate(() => (window as any).pinFixture.stop());
        const n = counts.get(owner);
        await pa.waitForTimeout(1200);
        expect(counts.get(owner)).toBe(n);
        expect(errors).toEqual([]);
      } finally {
        failures.delete(owner);
        await a.close();
        await b.close();
        await other.close();
      }
    },
    30000,
  );

for (const engine of ["chromium", "webkit"])
  browserTest(
    `${engine}: disconnected initialization and reload do not turn a failed pin into an import`,
    async () => {
      const owner = "offline-" + engine,
        c = await context(engine, owner),
        p = await c.newPage();
      p.setDefaultTimeout(5000);
      let offline = true;
      const errors: string[] = [];
      p.on("pageerror", (e) => errors.push(e.message));
      await p.route("**/agent/picker-pins", (route) =>
        offline ? route.abort() : route.continue(),
      );
      try {
        await p.goto(server.url + "?skin=classic");
        await p.waitForFunction(() => Boolean((window as any).pinFixture));
        await p.evaluate(() => (window as any).pinFixture.refresh());
        expect(await p.evaluate(() => (window as any).pinFixture.errors)).toEqual([]);
        await p.evaluate(() =>
          (window as any).pinFixture.model("test/failed-before-load"),
        );
        await p.waitForFunction(
          () => (window as any).pinFixture.errors.length === 1,
        );
        expect(
          await p.evaluate(() => (window as any).pinFixture.state()),
        ).toEqual({ models: [], sessions: [] });
        offline = false;
        await p.evaluate(() => (window as any).pinFixture.refresh());
        expect(readPickerPins(db, owner).models).toEqual([]);
        await p.locator(".compose-model-catalogue-search").focus();
        await p.keyboard.press("Alt+Enter");
        await p.waitForFunction(() =>
          (window as any).pinFixture.state().models.includes("test/a"),
        );
        await p.evaluate(() => (window as any).pinFixture.refresh());
        expect(readPickerPins(db, owner).models).toEqual(["test/a"]);
        const importsBefore = (
          db
            .query("SELECT count(*) AS n FROM picker_pin_imports WHERE owner=?")
            .get(owner) as { n: number }
        ).n;
        await p.reload();
        await p.waitForFunction(() =>
          (window as any).pinFixture?.state().models.includes("test/a"),
        );
        expect(
          (
            db
              .query(
                "SELECT count(*) AS n FROM picker_pin_imports WHERE owner=?",
              )
              .get(owner) as { n: number }
          ).n,
        ).toBe(importsBefore);
        await p.waitForTimeout(200);
        const n = counts.get(owner);
        await p.waitForTimeout(5500);
        expect(counts.get(owner)).toBe(n);
        expect(errors).toEqual([]);
      } finally {
        await c.close();
      }
    },
    20000,
  );

for (const engine of ['chromium','webkit']) browserTest(`${engine}: stopped sync never applies a delayed snapshot or resumes on focus`,async()=>{
 const owner='stop-'+engine,c=await context(engine,owner),p=await c.newPage();p.setDefaultTimeout(5000);let release!:()=>void;
 await p.route('**/agent/picker-pins',async route=>{await new Promise<void>(resolve=>{release=resolve;});await route.fulfill({json:{scope:'delayed',revision:1,models:['test/private'],sessions:['web:private']}}).catch((error)=>{ console.debug('Held fixture response was cancelled during teardown.', error); });});
 try{
  await p.goto(server.url+'?skin=classic');await p.waitForFunction(()=>Boolean((window as any).pinFixture));
  await p.evaluate(()=>(window as any).pinFixture.stop());release();await p.waitForTimeout(150);
  await p.evaluate(()=>{window.dispatchEvent(new Event('focus'));document.dispatchEvent(new Event('visibilitychange'));});await p.waitForTimeout(100);
  expect(await p.evaluate(()=>(window as any).pinFixture.state())).toEqual({models:[],sessions:[]});
  expect(await p.evaluate(()=>(window as any).pinFixture.errors)).toEqual([]);
 }finally{await c.close();}
},10000);

for (const engine of ["chromium", "webkit"])
  for (const skin of ["classic"])
    browserTest(`${engine}/${skin}: restart reads stay silent, retain pins and recover on reconnect`, async () => {
      const owner = `restart-${engine}-${skin}`;
      const c = await context(engine, owner, true), p = await c.newPage();
      p.setDefaultTimeout(5000);
      const pageErrors: string[] = [];
      p.on("pageerror", e => pageErrors.push(e.message));
      await c.addInitScript(() => {
        (window as any).pinErrorEvents = [];
        window.addEventListener("piclaw:pin-sync-error", e => (window as any).pinErrorEvents.push((e as CustomEvent).detail));
      });
      let unavailable = true, failedReads = 0;
      await p.route("**/agent/picker-pins", route => {
        if (!unavailable) return route.continue();
        if (route.request().method() === "GET") failedReads++;
        return route.fulfill({ status: 503, json: { error: "restarting" } });
      });
      try {
        await p.goto(server.url + `?skin=${skin}`);
        await p.waitForFunction(() => Boolean((window as any).pinFixture));
        await p.evaluate(() => (window as any).pinFixture.refresh());
        expect(failedReads).toBeGreaterThan(0);
        const legacy = { models: ["test/legacy"], sessions: ["web:legacy"] };
        expect(await p.evaluate(() => (window as any).pinFixture.state())).toEqual(legacy);
        expect(await p.evaluate(() => (window as any).pinFixture.errors)).toEqual([]);
        expect(await p.evaluate(() => (window as any).pinErrorEvents)).toEqual([]);
        unavailable = false;
        await p.evaluate(async () => {
          window.dispatchEvent(new Event("piclaw:sse-connected"));
          await (window as any).pinFixture.refresh();
        });
        expect(readPickerPins(db, owner).models).toEqual(["test/legacy"]);
        expect(readPickerPins(db, owner).sessions).toEqual(["web:legacy"]);
        // These lifecycle triggers all read; none represent an explicit edit.
        unavailable = true;
        const before = failedReads;
        await p.evaluate(async () => {
          window.dispatchEvent(new Event("focus"));
          window.dispatchEvent(new Event("piclaw:sse-connected"));
          window.dispatchEvent(new Event("piclaw:picker-pins-changed"));
          document.dispatchEvent(new Event("visibilitychange"));
          await (window as any).pinFixture.refresh();
        });
        expect(failedReads).toBeGreaterThan(before);
        expect(await p.evaluate(() => (window as any).pinFixture.state())).toEqual(legacy);
        expect(await p.evaluate(() => (window as any).pinFixture.errors)).toEqual([]);
        expect(await p.evaluate(() => (window as any).pinErrorEvents)).toEqual([]);
        // Do not hide an actual failed user edit; revert only that optimistic edit.
        await p.evaluate(() => (window as any).pinFixture.model("test/not-saved"));
        await p.waitForFunction(() => (window as any).pinFixture.errors.length === 1);
        expect(await p.evaluate(() => (window as any).pinErrorEvents.length)).toBe(1);
        expect(await p.evaluate(() => (window as any).pinFixture.state())).toEqual(legacy);
        unavailable = false;
        await p.evaluate(async () => {
          window.dispatchEvent(new Event("piclaw:sse-connected"));
          await (window as any).pinFixture.refresh();
        });
        await p.evaluate(() => (window as any).pinFixture.model("test/reconnected"));
        await p.waitForFunction(() => (window as any).pinFixture.state().models.includes("test/reconnected"));
        await p.evaluate(() => (window as any).pinFixture.refresh());
        expect(readPickerPins(db, owner).models).toEqual(["test/legacy", "test/reconnected"]);
        expect((db.query("SELECT count(*) AS n FROM picker_pin_imports WHERE owner=?").get(owner) as { n: number }).n).toBe(1);
        expect(pageErrors).toEqual([]);
      } finally { await c.close(); }
    }, 20000);

for (const skin of ["classic"])
  browserTest(`${skin}: passive legacy import failure stays silent and retries without losing pins`, async () => {
    const owner = `import-restart-${skin}`, c = await context("chromium", owner, true), p = await c.newPage();
    p.setDefaultTimeout(5000);
    let failImport = true, imports = 0;
    await p.route("**/agent/picker-pins", async route => {
      if (route.request().method() === "POST" && route.request().postDataJSON()?.action === "import") {
        imports++;
        if (failImport) return route.fulfill({ status: 503, json: { error: "restarting" } });
      }
      return route.continue();
    });
    try {
      await p.goto(server.url + `?skin=${skin}`);
      await p.waitForFunction(() => Boolean((window as any).pinFixture));
      await p.evaluate(() => (window as any).pinFixture.refresh());
      expect(imports).toBeGreaterThan(0);
      expect(await p.evaluate(() => (window as any).pinFixture.errors)).toEqual([]);
      expect(await p.evaluate(() => (window as any).pinFixture.state())).toEqual({ models: ["test/legacy"], sessions: ["web:legacy"] });
      failImport = false;
      await p.evaluate(async () => {
        window.dispatchEvent(new Event("piclaw:sse-connected"));
        await (window as any).pinFixture.refresh();
      });
      expect(readPickerPins(db, owner).models).toEqual(["test/legacy"]);
      expect(readPickerPins(db, owner).sessions).toEqual(["web:legacy"]);
      expect((db.query("SELECT count(*) AS n FROM picker_pin_imports WHERE owner=?").get(owner) as { n: number }).n).toBe(1);
      expect(await p.evaluate(() => (window as any).pinFixture.errors)).toEqual([]);
    } finally { await c.close(); }
  }, 15000);
