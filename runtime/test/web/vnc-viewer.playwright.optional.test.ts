import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { chromium, webkit, type Browser, type Page } from "playwright";
import {
  VncSessionService,
  type VncSocketData,
} from "../../src/channels/web/vnc/vnc-session-service.js";
import { WebTerminalVncHttpService } from "../../src/channels/web/terminal-vnc-http-service.js";
import { createTempWorkspace } from "../helpers.js";

// Run only inside the disposable network-namespace runner
// (runtime/scripts/test-vnc-disposable.sh), which starts the desktop on 5901/5902
// and sets VNC_FIXTURE_OUTPUT_DIR. Never probe the production desktop.
const enabled =
  process.env.PICLAW_E2E_DISPOSABLE === "1" &&
  process.env.PICLAW_RUN_OPTIONAL_BROWSER_TESTS === "1" &&
  Boolean(process.env.VNC_FIXTURE_OUTPUT_DIR);
const browserTest = enabled ? test : test.skip;
let browser: Browser;
let service: VncSessionService;
let server: ReturnType<typeof Bun.serve<VncSocketData>>;
let base: string;
let output = "";
let dir: ReturnType<typeof createTempWorkspace>;
const inputs: number[] = [];
const json = (payload: unknown, status = 200) =>
  Response.json(payload, { status });

beforeAll(async () => {
  if (!enabled) return;
  dir = createTempWorkspace("vnc-browser-");
  const build = await Bun.build({
    entrypoints: [
      new URL("./fixtures/vnc-viewer-fixture.ts", import.meta.url).pathname,
    ],
    target: "browser",
  });
  if (!build.success) throw new Error(String(build.logs));
  output = await build.outputs[0].text();
  service = new VncSessionService({
    targets: [
      {
        id: "fixture",
        label: "Disposable desktop",
        host: "localhost",
        port: 5901,
      },
      {
        id: "view",
        label: "Read-only fixture",
        host: "localhost",
        port: 5901,
        readOnly: true,
      },
    ],
    allowDirectTargets: true,
  });
  const http = new WebTerminalVncHttpService({
    vncService: service,
    webRuntimeConfig: { terminalEnabled: false },
    json,
    authGateway: { isAuthEnabled: () => false, isAuthenticated: () => true },
    terminalService: {} as never,
  });
  server = Bun.serve<VncSocketData>({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(req, srv) {
      const url = new URL(req.url);
      if (url.pathname === "/vnc/session") return http.handleVncSession(req);
      if (url.pathname === "/vnc/ws") {
        const owner = service.resolveOwnerFromRequest(
          req,
          url.searchParams.get("target") || "",
          true,
        );
        if (!owner) return new Response("denied", { status: 403 });
        return srv.upgrade(req, { data: owner })
          ? undefined
          : new Response("upgrade failed", { status: 400 });
      }
      if (url.pathname === "/fixture.js")
        return new Response(output, {
          headers: { "content-type": "text/javascript" },
        });
      if (
        url.pathname === "/static/common/js/vendor/remote-display-decoder.wasm"
      )
        return new Response(
          Bun.file(
            new URL(
              "../../web/static/common/js/vendor/remote-display-decoder.wasm",
              import.meta.url,
            ),
          ),
          { headers: { "content-type": "application/wasm" } },
        );
      if (url.pathname === "/classic.css")
        return new Response(
          Bun.file(
            new URL(
              "../../web/static/classic/dist/app.bundle.css",
              import.meta.url,
            ),
          ),
          { headers: { "content-type": "text/css" } },
        );
      return new Response(
        '<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/classic.css"><style>html,body,#vnc-root{width:100%;height:100%;margin:0;overflow:hidden}</style></head><body><main id="vnc-root"></main><script type="module" src="/fixture.js"></script></body></html>',
        { headers: { "content-type": "text/html" } },
      );
    },
    websocket: {
      open: (ws) => service.attachClient(ws),
      message: (ws, data) => {
        if (typeof data !== "string") inputs.push(new Uint8Array(data)[0]);
        service.handleMessage(ws, data);
      },
      close: (ws) => service.detachClient(ws),
    },
  });
  base = `http://127.0.0.1:${server.port}`;
  browser = await chromium.launch({ headless: true });
});
afterAll(async () => {
  await browser?.close();
  service?.shutdown();
  server?.stop(true);
  dir?.cleanup();
});
async function connected(page: Page) {
  await page.waitForSelector("[data-vnc-state]", { state: "attached" });
  await page.waitForFunction(
    () =>
      document
        .querySelector(".vnc-pane-shell")
        ?.getAttribute("data-vnc-state") === "connected",
  );
}
async function controls(page: Page) {
  await page.locator("canvas").focus();
  await page.keyboard.press("Control+Alt+Shift+KeyV");
  await page.locator("[data-vnc-session-chrome]").waitFor({ state: "visible" });
}
async function command(args: string[], text?: string) {
  const proc = Bun.spawn(args, {
    env: process.env,
    stdout: "pipe",
    stderr: "pipe",
    stdin: text === undefined ? "ignore" : new Blob([text]),
  });
  const result = await new Response(proc.stdout).text();
  const error = await new Response(proc.stderr).text();
  if ((await proc.exited) !== 0) throw new Error(error);
  return result.trim();
}
async function capture(page: Page, name: string) {
  // durable evidence copied out by the namespace runner
  const out = process.env.VNC_FIXTURE_OUTPUT_DIR;
  if (!out) return;
  await mkdir(out, { recursive: true });
  await page.screenshot({ path: join(out, `${name}.png`) });
}

browserTest(
  "real default x11vnc: framebuffer, hideaway controls, input, clipboard, history and reconnect",
  async () => {
    const page = await browser.newPage({
      viewport: { width: 1280, height: 800 },
    });
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    try {
      await page.goto(base);
      expect(await page.locator("[data-vnc-direct-host]").inputValue()).toBe(
        "localhost",
      );
      expect(await page.locator("[data-vnc-direct-port]").inputValue()).toBe(
        "5901",
      );
      await capture(page, "connections-desktop");
      await page.getByRole("button", { name: "Connect", exact: true }).click();
      await connected(page);
      expect(await page.locator("[data-vnc-session-chrome]").isVisible()).toBe(
        false,
      );
      expect(
        await page
          .locator("canvas")
          .evaluate((c: HTMLCanvasElement) => ({ w: c.width, h: c.height })),
      ).toEqual({ w: 1024, h: 768 });
      const colours = await page
        .locator("canvas")
        .evaluate((c: HTMLCanvasElement) => {
          const data = c
            .getContext("2d")!
            .getImageData(0, 0, c.width, c.height).data;
          const set = new Set();
          for (let i = 0; i < data.length; i += 4)
            set.add(`${data[i]},${data[i + 1]},${data[i + 2]}`);
          return set.size;
        });
      expect(colours).toBeGreaterThan(4);
      await capture(page, "framebuffer-desktop");
      await page.mouse.move(640, 8);
      await page.locator("[data-vnc-cue]").hover();
      await page
        .locator("[data-vnc-session-chrome]")
        .waitFor({ state: "visible" });
      await capture(page, "controls-desktop");
      await page.mouse.move(30, 700);
      await page
        .locator("[data-vnc-session-chrome]")
        .waitFor({ state: "hidden" });
      await controls(page);
      await page.getByText("Clipboard", { exact: true }).click();
      await page.mouse.move(30, 700);
      await page.waitForTimeout(500);
      expect(await page.locator("[data-vnc-session-chrome]").isVisible()).toBe(
        true,
      );
      await page.locator("[data-vnc-clipboard]").fill("browser-to-real-x11vnc");
      await page.getByRole("button", { name: "Send to remote" }).click();
      await page.waitForTimeout(400);
      // x11vnc publishes the legacy ClientCutText payload to the X cut buffer.
      expect(await command(["xprop", "-root", "CUT_BUFFER0"])).toContain(
        '"browser-to-real-x11vnc"',
      );
      const clip = Bun.spawn(["xclip", "-selection", "clipboard", "-i"], {
        stdin: new Blob(["real-x11vnc-to-browser"]),
        stdout: "ignore",
        stderr: "ignore",
      });
      expect(await clip.exited).toBe(0);
      await page.waitForFunction(
        () =>
          (
            document.querySelector(
              "[data-vnc-clipboard]",
            ) as HTMLTextAreaElement
          )?.value === "real-x11vnc-to-browser",
      );
      await page.keyboard.press("Escape");
      // Click and type into the disposable X terminal, then verify its output on the fixture filesystem.
      await page.locator("canvas").click({ position: { x: 200, y: 150 } });
      await page.keyboard.type(
        `printf vnc-input-ok > ${join(dir.base, "input.txt")}`,
        { delay: 15 },
      );
      await page.keyboard.press("Enter");
      await page.waitForTimeout(500);
      expect(await Bun.file(join(dir.base, "input.txt")).text()).toBe(
        "vnc-input-ok",
      );
      await controls(page);
      await page.getByRole("button", { name: "Connections & history" }).click();
      await page.getByRole("button", { name: "Return to desktop" }).waitFor();
      expect(
        await page.locator("[data-vnc-history] .vnc-history-row").count(),
      ).toBe(1);
      await page.getByRole("button", { name: "Return to desktop" }).click();
      await connected(page);
      await controls(page);
      await page
        .getByRole("button", { name: "Disconnect", exact: true })
        .click();
      expect(
        await page.locator(".vnc-pane-shell").getAttribute("data-vnc-state"),
      ).toBe("disconnected");
      await page
        .getByRole("button", { name: "Reconnect", exact: true })
        .click();
      await connected(page);
      await controls(page);
      await page.getByRole("button", { name: "Connections & history" }).click();
      await page.getByRole("button", { name: "Return to desktop" }).waitFor();
      expect(
        await page.locator("[data-vnc-history] .vnc-history-row").count(),
      ).toBe(1);
      await page
        .getByRole("button", { name: "Pin localhost:5901", exact: true })
        .click();
      await page.getByRole("button", { name: "Clear recent history" }).click();
      expect(
        await page.locator("[data-vnc-history] .vnc-history-row").count(),
      ).toBe(1);
      const stored = await page.evaluate(() =>
        Object.fromEntries(Object.entries(localStorage)),
      );
      expect(JSON.stringify(stored)).not.toContain("browser-to-real");
      expect(
        Object.keys(stored).filter((k) =>
          k.startsWith("piclaw:vnc-history:v1:"),
        ).length,
      ).toBe(1);
      expect(errors).toEqual([]);
    } finally {
      await page.close();
    }
  },
  45000,
);

for (const width of [820, 390])
  browserTest(
    `real desktop touch/keyboard and manager layout at ${width}px`,
    async () => {
      const page = await browser.newPage({
        viewport: { width, height: 844 },
        hasTouch: true,
      });
      try {
        await page.goto(base);
        await page.waitForSelector("[data-vnc-connect-form]");
        await page.evaluate(() => {
          document.documentElement.classList.add("light");
          document.body.classList.add("light");
        });
        expect(
          await page
            .locator(".vnc-manager")
            .evaluate((e) => e.scrollWidth <= e.clientWidth),
        ).toBe(true);
        await capture(page, `connections-${width}-light`);
        await page
          .getByRole("button", { name: "Connect", exact: true })
          .click();
        await connected(page);
        // Real touchscreen tap on the reserved top-edge reveal zone.
        await page.touchscreen.tap(width / 2, 8);
        await page
          .locator("[data-vnc-session-chrome]")
          .waitFor({ state: "visible" });
        await capture(page, `touch-controls-${width}`);
        await page.getByRole("button", { name: "Hide VNC controls" }).click();
        await controls(page);
        await page.keyboard.press("Escape");
        expect(
          await page.locator("[data-vnc-session-chrome]").isVisible(),
        ).toBe(false);
        await page.locator("[data-vnc-cue]").focus();
        expect(
          await page
            .locator("[data-vnc-cue]")
            .evaluate((e) => e === document.activeElement),
        ).toBe(true);
        await page.keyboard.press("Enter");
        expect(
          await page.locator("[data-vnc-session-chrome]").isVisible(),
        ).toBe(true);
      } finally {
        await page.close();
      }
    },
    35000,
  );

browserTest(
  "configured read-only target blocks clipboard and disposable socket cleanup",
  async () => {
    const page = await browser.newPage();
    try {
      await page.goto(base);
      await page.getByRole("button", { name: /Read-only fixture/ }).click();
      await connected(page);
      await controls(page);
      await page.getByText("Clipboard", { exact: true }).click();
      expect(
        await page.getByRole("button", { name: "Send to remote" }).isDisabled(),
      ).toBe(true);
      await page.getByRole("button", { name: "Hide VNC controls" }).click();
      const count = inputs.length;
      await page.locator("canvas").click();
      await page.keyboard.type("readonly");
      expect(inputs.slice(count).filter((t) => [4, 5, 6].includes(t))).toEqual(
        [],
      );
      await page.evaluate(() => (window as any).disposeVncFixture());
      expect(await page.locator(".vnc-pane-shell").count()).toBe(0);
    } finally {
      await page.close();
    }
  },
  15000,
);

browserTest(
  "failed authentication is recoverable and never recorded before a frame",
  async () => {
    const page = await browser.newPage();
    try {
      await page.goto(base);
      await page.locator("[data-vnc-direct-port]").fill("5902");
      await page.locator("[data-vnc-connect-form] summary").click();
      await page.locator("[data-vnc-direct-password]").fill("wrong");
      await page.getByRole("button", { name: "Connect", exact: true }).click();
      await page.waitForFunction(
        () =>
          document
            .querySelector(".vnc-pane-shell")
            ?.getAttribute("data-vnc-state") === "error",
      );
      expect(await page.locator("[data-vnc-password]").isVisible()).toBe(true);
      expect(
        await page.evaluate(() =>
          Object.keys(localStorage).some((k) =>
            k.startsWith("piclaw:vnc-history:"),
          ),
        ),
      ).toBe(false);
      await page.locator("[data-vnc-password]").fill("testpass");
      await page.locator("[data-vnc-auth-connect]").click();
      await connected(page);
      const persisted = await page.evaluate(() => JSON.stringify(localStorage));
      expect(persisted).not.toContain("testpass");
      expect(persisted).not.toContain("wrong");
      await capture(page, "authenticated-desktop");
    } finally {
      await page.close();
    }
  },
  20000,
);

browserTest(
  "unavailable target, backend denial and pending-load disposal stay recoverable",
  async () => {
    const page = await browser.newPage();
    try {
      await page.goto(base);
      await page.locator("[data-vnc-direct-port]").fill("5999");
      await page.getByRole("button", { name: "Connect", exact: true }).click();
      await page.waitForFunction(() =>
        ["error", "disconnected"].includes(
          document
            .querySelector(".vnc-pane-shell")
            ?.getAttribute("data-vnc-state") || "",
        ),
      );
      expect(await page.locator("[data-vnc-session-chrome]").isVisible()).toBe(
        true,
      );
      await page.getByRole("button", { name: "Connections & history" }).click();
      await page.getByRole("button", { name: "Return to desktop" }).waitFor();
      expect(
        await page.locator("[data-vnc-history] .vnc-history-row").count(),
      ).toBe(0);
      await page.route("**/vnc/session?target=*", (route) =>
        route.fulfill({
          status: 403,
          contentType: "application/json",
          body: JSON.stringify({ error: "Denied by current policy" }),
        }),
      );
      await page.locator("[data-vnc-configured] button").first().click();
      await page
        .getByText("Denied by current policy", { exact: true })
        .waitFor();
      await page
        .getByRole("button", { name: "Connections", exact: true })
        .click();
      await page.waitForSelector("[data-vnc-connect-form]");
      await page.unroute("**/vnc/session?target=*");
      let finish!: () => void;
      const gate = new Promise<void>((resolve) => {
        finish = resolve;
      });
      await page.route("**/vnc/session?target=*", async (route) => {
        await gate;
        await route.continue().catch(() => false);
      });
      await page.getByRole("button", { name: "Connect", exact: true }).click();
      await page.evaluate(() => (window as any).disposeVncFixture());
      finish();
      await page.waitForTimeout(300);
      expect(await page.locator(".vnc-pane-shell").count()).toBe(0);
    } finally {
      await page.close();
    }
  },
  20000,
);

browserTest(
  "blocked history storage does not prevent a real connection",
  async () => {
    const page = await browser.newPage();
    try {
      await page.addInitScript(() => {
        Object.defineProperty(window, "localStorage", {
          get() {
            throw new Error("blocked");
          },
        });
      });
      await page.goto(base);
      await page.getByRole("button", { name: "Connect", exact: true }).click();
      await connected(page);
      await controls(page);
      await page.getByRole("button", { name: "Connections & history" }).click();
      await page.getByRole("button", { name: "Return to desktop" }).waitFor();
      expect(
        await page.locator("[data-vnc-history] .vnc-history-row").count(),
      ).toBe(0);
    } finally {
      await page.close();
    }
  },
  15000,
);

for (const engine of ["chromium", "webkit"] as const)
  browserTest(
    `real ${engine} desktop: narrow embedded pane, history overlay, clipboard and resize`,
    async () => {
      const ownBrowser =
        engine === "webkit" ? await webkit.launch({ headless: true }) : null;
      const page = await (ownBrowser || browser).newPage({
        viewport: { width: 1440, height: 900 },
      });
      page.setDefaultTimeout(10000);
      try {
        await page.goto(base);
        await page.locator("[data-vnc-connect-form]").waitFor();
        await page.evaluate(() => {
          const root = document.getElementById("vnc-root")!;
          root.style.cssText =
            "position:absolute;right:0;top:40px;width:360px;height:420px;";
        });
        await page
          .getByRole("button", { name: "Connect", exact: true })
          .click();
        await connected(page);
        expect(
          await page.locator("[data-vnc-session-chrome]").isVisible(),
        ).toBe(false);
        await controls(page);
        await page
          .getByRole("button", { name: "Connections & history" })
          .click();
        await page.getByRole("button", { name: "Return to desktop" }).waitFor();
        expect(
          await page.locator("[data-vnc-history] .vnc-history-row").count(),
        ).toBe(1);
        for (const width of [900, 360, 280]) {
          await page.evaluate((w) => {
            document.getElementById("vnc-root")!.style.width = w + "px";
          }, width);
          const geometry = await page
            .locator(".vnc-manager")
            .evaluate((manager) => {
              const host = (
                manager.querySelector("[data-vnc-direct-host]") as HTMLElement
              ).getBoundingClientRect();
              const form = manager
                .querySelector(".vnc-connect-panel")!
                .getBoundingClientRect();
              const saved = manager
                .querySelector(".vnc-saved-panel")!
                .getBoundingClientRect();
              return {
                overflow: manager.scrollWidth - manager.clientWidth,
                hostWidth: host.width,
                formBottom: form.bottom,
                savedTop: saved.top,
              };
            });
          expect(geometry.overflow).toBeLessThanOrEqual(1);
          expect(geometry.hostWidth).toBeGreaterThan(120);
          if (width < 720)
            expect(geometry.savedTop).toBeGreaterThanOrEqual(
              geometry.formBottom,
            );
        }
        await capture(page, engine + "-narrow-overlay");
        await page.getByRole("button", { name: "Return to desktop" }).click();
        await connected(page);
        await controls(page);
        await page.getByText("Clipboard", { exact: true }).click();
        expect(
          await page
            .locator("[data-vnc-session-chrome]")
            .evaluate((e) => e.scrollWidth <= e.clientWidth),
        ).toBe(true);
        await page
          .locator("[data-vnc-clipboard]")
          .fill("narrow-pane-clipboard");
        await page.getByRole("button", { name: "Send to remote" }).click();
        await page.waitForTimeout(400);
        expect(await command(["xprop", "-root", "CUT_BUFFER0"])).toContain(
          '"narrow-pane-clipboard"',
        );
        await page.locator("[data-vnc-session-chrome]").evaluate((e) => {
          e.scrollTop = 0;
        });
        await capture(page, engine + "-narrow-controls");
        await page
          .getByRole("button", { name: "Disconnect", exact: true })
          .click();
        await page
          .getByRole("button", { name: "Reconnect", exact: true })
          .click();
        await connected(page);
        expect(
          await page.locator("[data-vnc-session-chrome]").isVisible(),
        ).toBe(false);
        const rects = await page.locator("canvas").evaluate((canvas) => {
          const pane = document
            .querySelector(".vnc-pane-shell")!
            .getBoundingClientRect();
          const r = canvas.getBoundingClientRect();
          return {
            fits: r.width <= pane.width + 1 && r.height <= pane.height + 1,
          };
        });
        expect(rects.fits).toBe(true);
        await capture(page, engine + "-narrow-framebuffer");
      } finally {
        await page.close();
        await ownBrowser?.close();
      }
    },
    35000,
  );
