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
  $/level = 4;
  $/date = "2028-02-29";
  $/preview = "/media/42";
  $/unsafe = "javascript:void(0)";
  root = Column([Text("<img src=x onerror=alert(1)>"),
    List(children=[Text("First step"), Text("Second step")], direction="horizontal", align="center"),
    Tabs(tabs=[{title:"Summary",child:summary},{title:"Details",child:details}]),
    Modal(trigger=show, content=help),
    Image(url=$/preview, description="Project preview", variant="avatar", fit="cover"),
    Image(url=$/unsafe, description="Unavailable preview"),
    TextField(label="Note", value=$/note),
    CheckBox(label="Notify", value=$/notify),
    Slider(label="Level", min=0, max=10, steps=5, value=$/level),
    DateTimeInput(label="Due date", enableDate=true, min="2028-02-28", max="2028-03-31", value=$/date),
    ChoicePicker(label="Size", options=[{label:"Small",value:"small"},{label:"Large",value:"large"}],value=$/choice),
    Button(Text("Submit"), variant="primary", action=Event("save", {note:$/note,notify:$/notify,size:$/choice,level:$/level,date:$/date}))]);
  summary = Text("Summary panel");
  details = Text("Details panel");
  show = Text("Show help");
  help = Text("Help panel is local");
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
          if (payload.message.action.name === 'login-present') {
            return { status: 'ok', auth_presentation: { expires_at: Date.now()+60000,
              events: [{type:'device_code',userCode:'PRIVATEDEVICE',verificationUri:'https://example.test/device'}, {type:'auth_url',url:'javascript:void(0)'}],
              prompt: {type:'secret',message:'API credential'},
              actions: { continue: {...payload,revision:payload.revision+1,message:{version:'1.0',action:{...payload.message.action,name:'login-continue',sourceComponentId:'continue'}}} } } };
          }
          if (payload.message.action.name === 'login-continue') return { status: 'ok' };
          if (payload.message.action.name === 'totp-open') {
            if (payload.private_code) return { status: 'ok', totp_result: 'success' };
            return { status: 'ok', totp_presentation: { manual_code: 'FAKEAUTHCODE', expires_at: Date.now()+60000,
              qr: 'data:image/svg+xml;base64,' + btoa('<svg xmlns="http://www.w3.org/2000/svg"/>') } };
          }
          if (window.events.length === 1) throw new Error('Try again');
        };
        window.draw = (block, readOnly = false) => render(html\`<\${Post} capabilities=\${{surfaceActions: !readOnly}}
          post=\${{id:19, chat_jid:"web:test", is_bot_message:true,
            data:{content:"Form fallback",content_blocks:[block],thread_id:3}}} onSubmitA2uiAction=\${submit} />\`, document.body);
      `);
      const build = await Bun.build({ entrypoints: [entry], outdir: scratch, target: "browser", format: "esm" });
      expect(build.success).toBe(true);
      server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch(req) {
        const { pathname } = new URL(req.url);
        if (pathname === '/media/42') return new Response('<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8"><rect width="8" height="8" fill="green"/></svg>', {headers:{'Content-Type':'image/svg+xml'}});
        if (pathname === "/fixture.js") return new Response(Bun.file(join(scratch, "fixture.js")));
        if (pathname === "/base.css" || pathname === "/content.css") return new Response(Bun.file(join(web, "static/classic/css", pathname.slice(1))));
        return new Response('<!doctype html><html lang="en" data-theme="dark"><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/base.css"><link rel="stylesheet" href="/content.css"></head><body><script type="module" src="/fixture.js"></script></body></html>', { headers: { "Content-Type": "text/html" } });
      } });
      browser = await engine.launch({headless:true});
      const page = await browser.newPage({ viewport: { width: 390, height: 800 }, colorScheme: 'dark' });
      page.setDefaultTimeout(5000);
      const errors: string[] = [];
      page.on("pageerror", (err) => errors.push(err.message));
      await page.goto(`http://127.0.0.1:${server.port}/`);
      await page.waitForFunction(() => typeof (window as any).draw === "function");
      const block = { type: "a2ui_surface", state: "active", revision: 1, surface: applyA2uiMessages("test-form", compileA2uiExpress(source, "test-form")), fallback_text: "Form fallback" };
      await page.evaluate((block) => (window as any).draw(block), block);
      const list = page.locator('.a2ui-surface').getByRole('list');
      expect(await list.getByRole('listitem').allTextContents()).toEqual(['First step', 'Second step']);
      expect(await list.evaluate(el => getComputedStyle(el).flexDirection)).toBe('row');
      const field = page.getByRole("textbox", { name: "Note" });
      await field.fill("Keep this draft");
      const summary = page.getByRole('tab', { name: 'Summary' });
      const details = page.getByRole('tab', { name: 'Details' });
      expect(await summary.getAttribute('aria-selected')).toBe('true');
      await summary.focus();
      await page.keyboard.press('ArrowRight');
      expect(await details.getAttribute('aria-selected')).toBe('true');
      expect(await details.evaluate(element => element === document.activeElement)).toBe(true);
      expect(await page.getByRole('tabpanel', { name: 'Details' }).textContent()).toBe('Details panel');
      expect(await page.getByRole('tabpanel', { name: 'Summary' }).count()).toBe(0);
      expect(await page.evaluate(() => (window as any).events)).toHaveLength(0);
      const show = page.getByRole('button', {name:'Show help'});
      await show.focus();
      await page.keyboard.press('Enter');
      const help = page.getByRole('dialog', { name: 'Show help' });
      await help.getByText('Help panel is local').waitFor();
      expect(await help.evaluate(el => el.contains(document.activeElement))).toBe(true);
      await page.keyboard.press('Escape');
      await help.waitFor({ state: 'detached' });
      expect(await show.evaluate(el => el === document.activeElement)).toBe(true);
      expect(await page.evaluate(() => (window as any).events)).toHaveLength(0);
      await field.focus();
      await page.evaluate((block) => (window as any).draw(block), block);
      expect(await field.inputValue()).toBe("Keep this draft");
      expect(await field.evaluate((el) => el === document.activeElement)).toBe(true);
      expect(await page.locator('.a2ui-surface img').count()).toBe(1);
      const preview = page.getByRole('img', { name: 'Project preview' });
      expect(await preview.getAttribute('src')).toBe('/media/42');
      expect(await preview.getAttribute('referrerpolicy')).toBe('no-referrer');
      expect(await preview.evaluate(element => getComputedStyle(element).objectFit)).toBe('cover');
      await page.waitForFunction(() => (document.querySelector('img[alt="Project preview"]') as HTMLImageElement)?.naturalWidth === 8);
      expect(await page.getByText('Unavailable preview').count()).toBe(1);
      await page.getByRole("checkbox", { name: "Notify" }).check();
      const slider = page.getByRole('slider', { name: 'Level' });
      expect(await slider.inputValue()).toBe('4');
      await slider.focus();
      await page.keyboard.press('ArrowRight');
      expect(await slider.inputValue()).toBe('6');
      const date = page.getByLabel('Due date');
      expect(await date.inputValue()).toBe('2028-02-29');
      expect(await date.getAttribute('min')).toBe('2028-02-28');
      expect(await date.getAttribute('max')).toBe('2028-03-31');
      await date.fill('2028-03-01');
      await page.getByRole("combobox", { name: "Size" }).selectOption("large");
      const button = page.getByRole("button", { name: "Submit" });
      expect(await button.evaluate(el => el.closest('[data-no-session-dashboard-shortcut]') !== null)).toBe(true);
      await button.focus();
      await page.keyboard.press("Enter");
      await page.getByRole("alert").getByText("Try again").waitFor();
      expect(await field.inputValue()).toBe("Keep this draft");
      await button.click();
      const events = await page.evaluate(() => (window as any).events);
      expect(events).toHaveLength(2);
      expect(events[1]).toMatchObject({ post_id: 19, thread_id: 3, chat_jid: "web:test", revision: 1,
        request_id: events[0].request_id, message: { version: "1.0", action: { name:"save", surfaceId:"test-form",
          context:{note:"Keep this draft",notify:true,size:["large"],level:6,date:"2028-03-01"} } } });
      await page.evaluate((block) => (window as any).draw(block), { ...block, state: "completed", revision: 2 });
      expect(await button.isDisabled()).toBe(true);
      const panel = page.locator('.a2ui-surface');
      const dark = await panel.evaluate(element => getComputedStyle(element).backgroundColor);
      expect(await panel.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      // Rehydrate the committed snapshot after a full page reload at desktop width.
      await page.setViewportSize({ width: 1280, height: 820 });
      await page.emulateMedia({ colorScheme: 'light' });
      await page.reload();
      await page.waitForFunction(() => typeof (window as any).draw === 'function');
      await page.evaluate((block) => {
        document.documentElement.removeAttribute('data-theme');
        (window as any).draw(block);
      }, { ...block, state: 'completed', revision: 2 });
      expect(await button.isDisabled()).toBe(true);
      expect(await field.inputValue()).toBe('');
      const light = await panel.evaluate(element => getComputedStyle(element).backgroundColor);
      expect(light).not.toBe(dark);
      await page.evaluate((block) => (window as any).draw(block, true), { ...block, revision: 3 });
      expect(await button.isDisabled()).toBe(true);
      const auth = { ...block, owner: 'totp', revision: 4,
        surface: applyA2uiMessages('totp-form', compileA2uiExpress('open = Button(Text("Open private TOTP setup"), action=Event("totp-open")); root = Column([open])', 'totp-form')) };
      await page.evaluate((block) => (window as any).draw(block), auth);
      expect(await page.getByText('FAKEAUTHCODE').count()).toBe(0);
      const open = page.getByRole('button', { name: 'Open private TOTP setup' });
      await open.click();
      const dialog = page.getByRole('dialog', { name: 'TOTP enrolment' });
      await dialog.getByText('FAKEAUTHCODE').waitFor();
      expect(await dialog.getAttribute('data-no-session-dashboard-shortcut')).not.toBeNull();
      await page.keyboard.press('Escape');
      await dialog.waitFor({state:'detached'});
      expect(await page.getByText('FAKEAUTHCODE').count()).toBe(0);
      await open.click();
      await dialog.getByRole('textbox', {name:'Six-digit code'}).fill('123456');
      await dialog.getByRole('button', {name:'Confirm'}).click();
      await dialog.waitFor({state:'detached'});
      const confirmation = await page.evaluate(() => (window as any).events.at(-1));
      expect(confirmation).toMatchObject({ private_code: '123456', message: { action: { context: {} } } });
      const provider = { ...block, owner: 'login', revision: 5,
        surface: applyA2uiMessages('provider-form', compileA2uiExpress('present = Button(Text("Open private authentication"), action=Event("login-present")); root = Column([present])', 'provider-form')) };
      await page.evaluate((block) => (window as any).draw(block), provider);
      await page.getByRole('button', {name:'Open private authentication'}).click();
      const providerDialog = page.getByRole('dialog', { name: 'Provider authentication' });
      await providerDialog.getByText('PRIVATEDEVICE').waitFor();
      expect(await providerDialog.getAttribute('data-no-session-dashboard-shortcut')).not.toBeNull();
      expect(await page.locator('.post').getByText('PRIVATEDEVICE').count()).toBe(0);
      expect(await providerDialog.locator('a').count()).toBe(1);
      // A committed server revision may arrive before the user submits the dialog.
      await page.evaluate((block) => (window as any).draw(block), {...provider, revision: 6});
      await providerDialog.getByLabel('API credential').fill('synthetic-only-key');
      await providerDialog.getByRole('button', {name:'Continue'}).click();
      await providerDialog.waitFor({state:'detached'});
      expect(await page.getByText('PRIVATEDEVICE').count()).toBe(0);
      const authSubmit = await page.evaluate(() => (window as any).events.at(-1));
      expect(authSubmit).toMatchObject({ private_value: 'synthetic-only-key', revision: 6, message: { action: { context: {} } } });
      const docs = { ...block, revision: 7, surface: applyA2uiMessages('docs-link',
        compileA2uiExpress('root = Button(Text("Docs"), action=openUrl("https://example.test/docs"))', 'docs-link')) };
      await page.evaluate((block) => (window as any).draw(block), docs);
      const link = page.getByRole('link', { name: 'Docs' });
      expect(await link.getAttribute('href')).toBe('https://example.test/docs');
      expect(await link.getAttribute('rel')).toBe('noopener noreferrer');
      const legacyRequests: string[] = [];
      page.on('request', request => { if (request.url().includes('adaptivecards')) legacyRequests.push(request.url()); });
      await page.evaluate(() => (window as any).draw({
        type: 'adaptive_card', card_id: 'historical-card', state: 'active', schema_version: '1.5', fallback_text: 'Stored legacy payload',
        payload: {type:'AdaptiveCard', version:'1.5', body:[{type:'TextBlock', text:'Stored legacy payload'}], actions:[{type:'Action.Submit', title:'Old action'}]},
      }));
      await page.getByText('Form fallback').waitFor();
      expect(await page.locator('.post-adaptive-cards').count()).toBe(0);
      expect(await page.getByRole('button', {name:'Old action'}).count()).toBe(0);
      expect(legacyRequests).toEqual([]);
      expect(errors).toEqual([]);
    } finally {
      await browser?.close();
      server?.stop(true);
      await rm(scratch, { recursive: true, force: true });
    }
  });
}
