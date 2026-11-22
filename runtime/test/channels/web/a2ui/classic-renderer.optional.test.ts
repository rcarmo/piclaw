import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium, webkit } from "playwright";
import { applyA2uiMessages, compileA2uiExpress } from "../../../../src/channels/web/a2ui/express.js";

const browserTest = process.env.PICLAW_RUN_OPTIONAL_BROWSER_TESTS === "1" ? test : test.skip;
const source = `
  $/note = "";
  $/notify = false;
  $/choice = ["small"];
  root = Column([Text("<img src=x onerror=alert(1)>"),
    TextField(label="Note", value=$/note),
    CheckBox(label="Notify", value=$/notify),
    ChoicePicker(label="Size", options=[{label:"Small",value:"small"},{label:"Large",value:"large"}],value=$/choice),
    Button(Text("Submit"), variant="primary", action=Event("save", {note:$/note,notify:$/notify,size:$/choice}))]);
`;

for (const engine of [chromium, webkit]) {
  browserTest(`Classic Preact timeline form on ${engine.name()}`, async () => {
    const web = new URL("../../../../web/", import.meta.url).pathname;
    const scratch = await mkdtemp(join(tmpdir(), "a2ui-classic-"));
    const entry = join(scratch, "fixture.ts");
    let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
    let server: ReturnType<typeof Bun.serve> | undefined;
    try {
      await Bun.write(entry, `
        import { html, render } from ${JSON.stringify(join(web, "src/vendor/preact-htm.js"))};
        import { Post } from ${JSON.stringify(join(web, "src/components/post.ts"))};
        window.events = [];
        const submit = async (payload) => {
          window.events.push(payload);
          if (window.events.length === 1) throw new Error('Try again');
        };
        window.draw = (block, readOnly = false) => render(html\`<\${Post} capabilities=\${{cardActions: !readOnly}}
          post=\${{id:19, chat_jid:"web:test", is_bot_message:true,
            data:{content:"Form fallback",content_blocks:[block],thread_id:3}}} onSubmitA2uiAction=\${submit} />\`, document.body);
      `);
      const build = await Bun.build({ entrypoints: [entry], outdir: scratch, target: "browser", format: "esm" });
      expect(build.success).toBe(true);
      server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch(req) {
        const { pathname } = new URL(req.url);
        if (pathname === "/fixture.js") return new Response(Bun.file(join(scratch, "fixture.js")));
        if (pathname === "/classic.css") return new Response(Bun.file(join(web, "static/classic/css/content.css")));
        return new Response('<!doctype html><html lang="en" data-theme="dark"><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/classic.css"></head><body><script type="module" src="/fixture.js"></script></body></html>', { headers: { "Content-Type": "text/html" } });
      } });
      browser = await engine.launch({headless:true});
      const page = await browser.newPage({ viewport: { width: 390, height: 800 } });
      page.setDefaultTimeout(5000);
      const errors: string[] = [];
      page.on("pageerror", (err) => errors.push(err.message));
      await page.goto(`http://127.0.0.1:${server.port}/`);
      await page.waitForFunction(() => typeof (window as any).draw === "function");
      const block = { type: "a2ui_surface", state: "active", revision: 1, surface: applyA2uiMessages("test-form", compileA2uiExpress(source, "test-form")), fallback_text: "Form fallback" };
      await page.evaluate((block) => (window as any).draw(block), block);
      const field = page.getByRole("textbox", { name: "Note" });
      await field.fill("Keep this draft");
      await page.evaluate((block) => (window as any).draw(block), block);
      expect(await field.inputValue()).toBe("Keep this draft");
      expect(await field.evaluate((el) => el === document.activeElement)).toBe(true);
      expect(await page.locator(".a2ui-surface img").count()).toBe(0);
      await page.getByRole("checkbox", { name: "Notify" }).check();
      await page.getByRole("combobox", { name: "Size" }).selectOption("large");
      const button = page.getByRole("button", { name: "Submit" });
      await button.focus();
      await page.keyboard.press("Enter");
      await page.getByRole("alert").getByText("Try again").waitFor();
      expect(await field.inputValue()).toBe("Keep this draft");
      await button.click();
      const events = await page.evaluate(() => (window as any).events);
      expect(events).toHaveLength(2);
      expect(events[1]).toMatchObject({ post_id: 19, thread_id: 3, chat_jid: "web:test", revision: 1,
        request_id: events[0].request_id, message: { version: "1.0", action: { name:"save", surfaceId:"test-form",
          context:{note:"Keep this draft",notify:true,size:["large"]} } } });
      await page.evaluate((block) => (window as any).draw(block), { ...block, state: "completed", revision: 2 });
      expect(await button.isDisabled()).toBe(true);
      await page.evaluate((block) => (window as any).draw(block, true), { ...block, revision: 3 });
      expect(await button.isDisabled()).toBe(true);
      expect(errors).toEqual([]);
    } finally {
      await browser?.close();
      server?.stop(true);
      await rm(scratch, { recursive: true, force: true });
    }
  });
}
