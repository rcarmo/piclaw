import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium, webkit } from "playwright";
import { CLASSIC_CONTENT_SECURITY_POLICY } from '../../../../src/channels/web/http/security.js';
import { applyA2uiMessages, compileA2uiExpress } from "../../../../src/channels/web/a2ui/express.js";
import type { CallAgentFunctionMessage } from '@a2ui/web_core/v1_0';

const browserTest = process.env.PICLAW_RUN_OPTIONAL_BROWSER_TESTS === "1" ? test : test.skip;
const source = `
  $/note = "";
  $/notify = false;
  $/choice = ["small"];
  $/tags = ["front"];
  $/level = 4;
  $/date = "2028-02-29";
  $/preview = "/media/42";
  $/unsafe = "javascript:void(0)";
  $/shape = "M2 2 L8 8";
  root = Column([Text("<img src=x onerror=alert(1)>"),
    Text("**Bold A2UI** and *emphasised* plus [plain label](https://example.test/no-link) and ![plain image alt](https://example.test/no-image)"),
    Text("- Markdown item one\\n- Markdown item two"),
    List(children=[Text("First step"), Text("Second step")], direction="horizontal", align="center"),
    Tabs(tabs=[{title:"Summary",child:summary},{title:"Details",child:details}]),
    Modal(trigger=show, content=help),
    Icon(name={svgPath:$/shape}),
    Icon(name={svgPath:$/unsafe}),
    Button(Icon(name="check"), action=Event("confirm")),
    Image(url=$/preview, description="Project preview", variant="avatar", fit="cover"),
    Image(url=$/unsafe, description="Unavailable preview"),
    AudioPlayer(url=$/audio, description="Fixture recording"),
    Video(url="/media/43", posterUrl=$/preview),
    TextField(label="Note", value=$/note, checks=[{condition:required($/note),message:"Enter a note"}]),
    CheckBox(label="Notify", value=$/notify),
    Slider(label="Level", min=0, max=10, steps=5, value=$/level),
    DateTimeInput(label="Due date", enableDate=true, min="2028-02-28", max="2028-03-31", value=$/date),
    Row([Text("One part", weight=1), Text("Two parts", weight=2)]),
    ChoicePicker(label="Size", options=[{label:"Small",value:"small"},{label:"Large",value:"large"}],value=$/choice),
    ChoicePicker(label="Tags", options=[{label:"Frontend",value:"front"},{label:"Backend",value:"back"}], value=$/tags, variant="multipleSelection", displayStyle="chips", filterable=true),
    Button(Text("**Submit**"), variant="primary", action=Event("save", {note:$/note,notify:$/notify,size:$/choice,level:$/level,date:$/date,tags:$/tags}),
      checks=[{condition:required($/note),message:"Cannot submit an empty note"}])]);
  summary = Text("Summary panel");
  details = Text("Details panel");
  show = Text("Show help");
  help = Text("Help panel is local");
`;

// 100 ms of silent 8-bit mono PCM, with no media or codec dependency on the test runner.
const wav = Buffer.alloc(844, 128);
wav.write('RIFF'); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8);
wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
wav.writeUInt32LE(8000, 24); wav.writeUInt32LE(8000, 28); wav.writeUInt16LE(1, 32);
wav.writeUInt16LE(8, 34); wav.write('data', 36); wav.writeUInt32LE(wav.length - 44, 40);

for (const engine of [chromium, webkit]) {
  browserTest(`Classic Preact timeline form on ${engine.name()}`, async () => {
    const web = new URL("../../../../web/", import.meta.url).pathname;
    const scratch = await mkdtemp(join(tmpdir(), "a2ui-classic-"));
    const entry = join(scratch, "fixture.ts");
    let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
    let server: ReturnType<typeof Bun.serve> | undefined;
    const audioRequests: (string | null)[] = [];
    const rpcRequests: {chat_jid:string;post_id:number;thread_id:number;revision:number;message:CallAgentFunctionMessage}[] = [];
    const delayedRpc = Promise.withResolvers<void>();
    const audioOrigin = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch(req) {
      audioRequests.push(req.headers.get('cookie'));
      const headers = new Headers({ 'Content-Type': 'audio/wav', 'Access-Control-Allow-Origin': '*', 'Accept-Ranges': 'bytes' });
      const range = /^bytes=(\d+)-(\d*)$/.exec(req.headers.get('range') ?? '');
      if (!range) return new Response(wav, { headers });
      const start = Number(range[1]), end = Math.min(wav.length - 1, Number(range[2] || wav.length - 1));
      if (start > end) return new Response(null, { status: 416, headers });
      headers.set('Content-Range', `bytes ${start}-${end}/${wav.length}`);
      return new Response(wav.subarray(start, end + 1), { status: 206, headers });
    }});
    try {
      await Bun.write(entry, `
        import { html, render } from ${JSON.stringify(join(web, "src/vendor/preact-htm.js"))};
        import { Post } from ${JSON.stringify(join(web, "src/components/post.ts"))};
        import { sendAgentMessage } from ${JSON.stringify(join(web, 'src/api.ts'))};
        window.sendDraftQuery = chat => sendAgentMessage('default', 'Query current model', null, [], null, chat);
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
      const build = await Bun.build({ entrypoints: [entry], outdir: scratch, target: "browser", format: "esm", splitting: true });
      expect(build.success).toBe(true);
      const scripts = new Set(build.outputs.map(file=>file.path.split('/').at(-1)));
      server = Bun.serve({ hostname: "127.0.0.1", port: 0, async fetch(req) {
        const { pathname } = new URL(req.url);
        if (pathname === '/agent/default/message') return Response.json(await req.json());
        if (pathname === '/agent/a2ui-rpc') {
          const input = await req.json() as typeof rpcRequests[number];
          rpcRequests.push(input);
          const {functionCallId,callFunction}=input.message.callAgentFunction;
          if (callFunction['@call']==='waitForRevision') {
            await delayedRpc.promise;
            return Response.json({version:'1.0',agentFunctionResponse:{functionCallId,error:{code:'INVALID_FUNCTION_CALL',message:'Obsolete response'}}});
          }
          if (callFunction['@call']==='broken') return Response.json({version:'1.0',agentFunctionResponse:{functionCallId:'wrong',value:'cannot be accepted'}});
          return Response.json({version:'1.0',agentFunctionResponse:{functionCallId,value:null}});
        }
        if (pathname === '/media/42') return new Response('<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8"><rect width="8" height="8" fill="green"/></svg>', {headers:{'Content-Type':'image/svg+xml'}});
        if (scripts.has(pathname.slice(1))) return new Response(Bun.file(join(scratch, pathname.slice(1))));
        if (pathname === '/marked.js') return new Response(Bun.file(join(web, 'static/common/js/marked.min.js')), {headers:{'Content-Type':'text/javascript'}});
        if (pathname === "/base.css" || pathname === "/content.css") return new Response(Bun.file(join(web, "static/classic/css", pathname.slice(1))));
        return new Response('<!doctype html><html lang="en" data-theme="dark"><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/base.css"><link rel="stylesheet" href="/content.css"></head><body><script src="/marked.js"></script><script type="module" src="/fixture.js"></script></body></html>', { headers: { "Content-Type": "text/html", 'Content-Security-Policy': CLASSIC_CONTENT_SECURITY_POLICY } });
      } });
      browser = await engine.launch({headless:true});
      const page = await browser.newPage({ viewport: { width: 390, height: 800 }, colorScheme: 'dark' });
      page.setDefaultTimeout(5000);
      const errors: string[] = [];
      page.on("pageerror", (err) => errors.push(err.message));
      await page.goto(`http://127.0.0.1:${server.port}/`);
      await page.waitForFunction(() => typeof (window as any).draw === "function");
      const block = { type: "a2ui_surface", state: "active", revision: 1, surface: applyA2uiMessages("test-form", compileA2uiExpress(`$/audio = ${JSON.stringify(`${audioOrigin.url.origin}/fixture.wav`)};\n${source}`, "test-form")), fallback_text: "Form fallback" };
      await page.evaluate((block) => (window as any).draw(block), block);
      const list = page.locator('.a2ui-surface .a2ui-list');
      await list.getByRole('listitem').first().waitFor();
      expect(await list.getByRole('listitem').allTextContents()).toEqual(['First step', 'Second step']);
      expect(await list.evaluate(el => getComputedStyle(el).flexDirection)).toBe('row');
      const field = page.getByRole("textbox", { name: "Note" });
      const submitButton = page.getByRole('button', {name:'Submit'});
      expect(await field.getAttribute('aria-invalid')).toBe('true');
      expect(await page.getByText('Enter a note', {exact:true}).isVisible()).toBe(true);
      expect(await submitButton.getAttribute('aria-disabled')).toBe('true');
      await field.fill("Keep this draft");
      expect(await field.getAttribute('aria-invalid')).toBeNull();
      expect(await page.getByText('Enter a note', {exact:true}).count()).toBe(0);
      expect(await field.evaluate(el => el === document.activeElement)).toBe(true);
      expect(await submitButton.getAttribute('aria-disabled')).toBe('false');
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
      expect(await page.locator('.a2ui-surface strong').getByText('Bold A2UI').count()).toBe(1);
      expect(await page.locator('.a2ui-surface em').getByText('emphasised').count()).toBe(1);
      expect(await page.getByText(/plain label.*plain image alt/).count()).toBe(1);
      expect(await page.getByRole('link', { name:'plain label' }).count()).toBe(0);
      expect(await page.locator('.a2ui-surface ul li').allTextContents()).toEqual(['Markdown item one','Markdown item two']);
      expect(await submitButton.locator('strong').textContent()).toBe('Submit');
      expect(await page.getByText('<img src=x onerror=alert(1)>', {exact:true}).count()).toBe(1);
      const preview = page.getByRole('img', { name: 'Project preview' });
      expect(await preview.getAttribute('src')).toBe('/media/42');
      expect(await preview.getAttribute('referrerpolicy')).toBe('no-referrer');
      expect(await preview.evaluate(element => getComputedStyle(element).objectFit)).toBe('cover');
      await page.waitForFunction(() => (document.querySelector('img[alt="Project preview"]') as HTMLImageElement)?.naturalWidth === 8);
      expect(await page.getByText('Unavailable preview').count()).toBe(1);
      const icons = page.locator('svg.a2ui-icon');
      expect(await icons.count()).toBe(2);
      expect(await icons.first().locator('path').getAttribute('d')).toBe('M2 2 L8 8');
      const checkIcon = page.getByRole('button', { name: 'Check' }).locator('svg');
      expect(await checkIcon.evaluate(el => el.namespaceURI)).toBe('http://www.w3.org/2000/svg');
      expect(await checkIcon.locator('path').getAttribute('d')).toBeTruthy();
      expect(audioRequests).toHaveLength(0);
      expect(await page.locator('audio').count()).toBe(0);
      const video = page.locator('.a2ui-surface video');
      expect(await video.getAttribute('poster')).toBe('/media/42');
      expect(await video.evaluate(el => (el as HTMLVideoElement).controls && !(el as HTMLVideoElement).autoplay)).toBe(true);
      await page.context().addCookies([{ name: 'media_fixture', value: 'synthetic', url: audioOrigin.url.origin }]);
      await page.getByRole('button', { name: 'Load external audio' }).click();
      const audio = page.locator('audio[aria-label="Fixture recording"]');
      await audio.waitFor();
      expect(await audio.evaluate(el => el === document.activeElement)).toBe(true);
      await page.waitForFunction(() => (document.querySelector('audio') as HTMLAudioElement)?.duration === 0.1);
      expect(audioRequests.length).toBeGreaterThan(0);
      expect(audioRequests.every(cookie => cookie === null)).toBe(true);
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
      expect(await page.getByText('Two parts').evaluate(el => getComputedStyle(el.parentElement!).flexGrow)).toBe('2');
      const size = page.getByRole('group', { name: 'Size' });
      await size.getByRole('radio', { name: 'Large' }).check();
      expect(await size.getByRole('radio', { name: 'Small' }).isChecked()).toBe(false);
      const tags = page.getByRole('group', { name: 'Tags' });
      await tags.getByRole('searchbox', { name: 'Filter options' }).fill(' BACK ');
      expect(await tags.getByRole('button', { name: 'Frontend' }).count()).toBe(0);
      await tags.getByRole('button', { name: 'Backend' }).click();
      expect(await tags.getByRole('button', { name: 'Backend' }).getAttribute('aria-pressed')).toBe('true');
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
          context:{note:"Keep this draft",notify:true,size:["large"],level:6,date:"2028-03-01",tags:["front","back"]} } } });
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
      const docsId = 'docs-link';
      const docs = { ...block, revision: 7, surface: applyA2uiMessages(docsId,
        compileA2uiExpress('$/target="https://example.test/docs"; root = Button(Text("Docs"), action=openUrl(formatString("${/target}")))', docsId))! };
      await page.evaluate((block) => (window as any).draw(block), docs);
      const link = page.getByRole('link', { name: 'Docs' });
      expect(await link.getAttribute('href')).toBe('https://example.test/docs');
      expect(await link.getAttribute('rel')).toBe('noopener noreferrer');
      const brokenLink = applyA2uiMessages(docsId, [{version:'1.0',updateDataModel:{surfaceId:docsId,path:'/target',value:'javascript:void(0)'}}], docs.surface);
      const count = await page.evaluate(() => (window as any).events.length);
      await page.evaluate((block) => (window as any).draw(block), {...docs, surface:brokenLink});
      expect(await link.count()).toBe(0);
      const disabledLink = page.getByRole('button', {name:'Docs'});
      expect(await disabledLink.getAttribute('aria-disabled')).toBe('true');
      await disabledLink.evaluate(element => element.click());
      expect(await page.evaluate(() => (window as any).events.length)).toBe(count);
      const pointerId = 'pointer-browser';
      const binding = { '@path': '/a~1b/~0label text' };
      const pointerSurface = applyA2uiMessages(pointerId, [{ version:'1.0', createSurface:{
        surfaceId:pointerId, catalogId:'https://a2ui.org/specification/v1_0/catalogs/basic/catalog.json',
        components:[{id:'root',component:'Column',children:['field','send','status'], '@accessibility':{label:'Wire form',live:'polite'}},
          {id:'status',component:'Text',text:'Visible but decorative', '@accessibility':{hidden:{'@path':'/hide'}}},
          {id:'field',component:'TextField',label:'Escaped field',value:binding, '@accessibility':{label:{'@path':'/accessibleName'},description:'Use ordinary text'}},
          {id:'send',component:'Button',child:'label',action:{event:{name:'send',context:{field:binding}}}}, {id:'label',component:'Text',text:'Send escaped value'}],
        dataModel:{'a/b':{'~label text':'Stored value'},accessibleName:'Escaped value',hide:true},
      }}]);
      await page.evaluate((block) => (window as any).draw(block), {...block, revision: 8, surface:pointerSurface});
      const pointerFrame = page.getByRole('group', {name:'Wire form'});
      expect(await pointerFrame.getAttribute('aria-live')).toBe('polite');
      const pointerField = pointerFrame.getByRole('textbox', {name:'Escaped value'});
      expect(await pointerField.getAttribute('aria-description')).toBe('Use ordinary text');
      expect(await pointerFrame.getByText('Visible but decorative').getAttribute('aria-hidden')).toBe('true');
      expect(await pointerFrame.getByText('Visible but decorative').isVisible()).toBe(true);
      expect(await pointerField.inputValue()).toBe('Stored value');
      await pointerField.fill('Edited value');
      await page.getByRole('button', {name:'Send escaped value'}).click();
      expect(await page.evaluate(() => (window as any).events.at(-1)?.message.action.context)).toEqual({field:'Edited value'});
      const repeatId = 'repeated-browser';
      const authored = applyA2uiMessages(repeatId, compileA2uiExpress(`
        $/groups=[{items:[{label:"First",note:"one"}]},{items:[{label:"Second",note:"two"}]}];
        root=Column(_template($/groups, group));
        group=List(_template($items, item));
        item=Row([Text($label),index,TextField(label="Row note",value=$note),Text(formatString("Draft: \${note}")),submit]);
        index=Text("Placeholder");
        submit=Button(Text("Apply row"),action=Event("apply",{label:$label,note:$note}));
      `, repeatId))!;
      const repeated = applyA2uiMessages(repeatId, [{version:'1.0',updateComponents:{surfaceId:repeatId,
        components:[{id:'index',component:'Text',text:{'@call':'@index',args:{offset:1}}}],
      }}], authored);
      await page.evaluate((block) => (window as any).draw(block), {...block, revision:9, surface:repeated});
      const firstRow = page.getByRole('listitem').filter({hasText:'First'});
      const secondRow = page.getByRole('listitem').filter({hasText:'Second'});
      expect(await secondRow.getByText('1', {exact:true}).count()).toBe(1);
      expect(await secondRow.getByText('2', {exact:true}).count()).toBe(0);
      await secondRow.getByLabel('Row note').fill('second draft');
      expect(await firstRow.getByLabel('Row note').inputValue()).toBe('one');
      expect(await firstRow.getByText('Draft: one').isVisible()).toBe(true);
      expect(await secondRow.getByText('Draft: second draft').isVisible()).toBe(true);
      await secondRow.getByRole('button', {name:'Apply row'}).click();
      expect(await page.evaluate(() => (window as any).events.at(-1))).toMatchObject({instance_path:'/1/0',
        message:{action:{sourceComponentId:'submit', context:{label:'Second',note:'second draft'}}}});
      const stagedId = 'progressive-browser';
      const basicCatalogue = 'https://a2ui.org/specification/v1_0/catalogs/basic/catalog.json';
      const drawStage = (surface: unknown, revision: number) => page.evaluate((block) => (window as any).draw(block),
        {...block, surface, revision, fallback_text:'Preparing steps'});
      const empty = applyA2uiMessages(stagedId, [{version:'1.0',createSurface:{surfaceId:stagedId,
        dataModel:{greeting:'Stored before root'},
      }}], undefined, true)!;
      const updateStage = (surface: typeof empty, components: Record<string, unknown>[]) =>
        applyA2uiMessages(stagedId, [{version:'1.0',updateComponents:{surfaceId:stagedId,
          components:components.map(component => ({ ...component, '@catalogId':basicCatalogue })),
        }}], surface)!;
      await drawStage(empty, 1);
      await panel.getByText('Preparing steps').waitFor();
      const head = updateStage(empty, [{id:'title',component:'Text',text:{'@call':'formatString',catalogId:basicCatalogue,args:{value:'${/greeting}'}}}]);
      await drawStage(head, 2);
      expect(await panel.getByText('Stored before root').count()).toBe(0);
      const partial = updateStage(head, [{id:'root',component:'Column',children:['title','send']},
        {id:'send',component:'Button',child:'label',action:{event:{name:'confirmStage'}}}]);
      await drawStage(partial, 3);
      await panel.getByText('Stored before root').waitFor();
      expect(await panel.getByRole('button').count()).toBe(0);
      const ready = updateStage(partial, [{id:'label',component:'Text',text:'Confirm stage'}]);
      await drawStage(ready, 4);
      await panel.getByRole('button',{name:'Confirm stage'}).click();
      expect(await page.evaluate(() => (window as any).events.at(-1))).toMatchObject({revision:4,
        message:{action:{surfaceId:stagedId,sourceComponentId:'send',name:'confirmStage'}}});
      const syncedId = 'synced-browser';
      const synced = {...block, owner:'agent', revision:10, surface:applyA2uiMessages(syncedId, compileA2uiExpress(`
        surface("synced-browser", sendDataModel=true);
        $/memo="Initial";
        root=Column([memo,Button(Text("Send draft"),action=Event("syncDraft"))]);
        memo=TextField(label="Draft memo",value=$/memo);
      `, syncedId))!};
      await page.evaluate((item) => (window as any).draw(item), synced);
      await page.getByRole('textbox',{name:'Draft memo'}).fill('Unsubmitted draft');
      const expectedDraft = {surface_id:syncedId,revision:10,edits:[{component_id:'memo',value:'Unsubmitted draft'}]};
      const query = (chat: string) => page.evaluate(jid => (window as any).sendDraftQuery(jid), chat);
      const capabilities = {a2uiRendererCapabilities:{'1.0':{supportedCatalogIds:[basicCatalogue]}}};
      expect(await query('web:test')).toMatchObject({content:'Query current model',a2ui_drafts:[expectedDraft],metadata:capabilities});
      expect(await query('web:other')).not.toHaveProperty('a2ui_drafts');
      await page.evaluate((item) => (window as any).draw(item), block);
      await page.evaluate((item) => (window as any).draw(item), synced);
      expect(await page.getByRole('textbox',{name:'Draft memo'}).inputValue()).toBe('Unsubmitted draft');
      await page.evaluate((item) => (window as any).draw(item), {...synced,revision:11});
      expect(await page.getByRole('textbox',{name:'Draft memo'}).inputValue()).toBe('Initial');
      expect(await query('web:test')).not.toHaveProperty('a2ui_drafts');
      await page.getByRole('textbox',{name:'Draft memo'}).fill('Action draft');
      await page.getByRole('button',{name:'Send draft'}).click();
      expect(await page.evaluate(() => (window as any).events.at(-1))).toMatchObject({revision:11,metadata:capabilities,
        a2ui_drafts:[{...expectedDraft, revision:11, edits:[{component_id:'memo',value:'Action draft'}]}],
        message:{action:{name:'syncDraft',context:{}}}});
      const rpcId='agent-function-form';
      const rpcSurface=applyA2uiMessages(rpcId,[{version:'1.0',createSurface:{surfaceId:rpcId,catalogId:basicCatalogue,dataModel:{rows:[{name:'One'},{name:'Two'}]},components:[
        {id:'root',component:'Column',children:['rows','local','invalid','wait']},
        {id:'rows',component:'List',children:{componentId:'row',path:'/rows'}},
        {id:'row',component:'Row',children:['field','call']},
        {id:'field',component:'TextField',label:'Item',value:{'@path':'name'}},
        {id:'call',component:'Button',child:'callLabel',action:{functionCall:{'@call':'verifyItem',args:{label:{'@path':'name'},index:{'@call':'@index'}}}}},
        {id:'callLabel',component:'Text',text:'Verify item'},
        {id:'invalid',component:'Button',child:'invalidLabel',action:{functionCall:{'@call':'broken'}}},
        {id:'invalidLabel',component:'Text',text:'Try invalid response'},
        {id:'local',component:'Button',child:'localLabel',action:{functionCall:{'@call':'formatString',args:{value:'Pure local function'}}}},
        {id:'localLabel',component:'Text',text:'Run local function'},
        {id:'wait',component:'Button',child:'waitLabel',action:{functionCall:{'@call':'waitForRevision'}}},
        {id:'waitLabel',component:'Text',text:'Wait for revision'},
      ]}}],undefined,true)!;
      const initialEventCount=await page.evaluate(()=>(window as any).events.length);
      await page.evaluate((item)=>(window as any).draw(item),{...block,owner:'agent',revision:12,surface:rpcSurface});
      const rows=panel.getByRole('listitem');
      await rows.nth(1).getByRole('textbox',{name:'Item'}).fill('Second draft');
      await panel.getByRole('button',{name:'Run local function'}).click();
      expect(rpcRequests).toHaveLength(0);
      const verify=rows.nth(1).getByRole('button',{name:'Verify item'});
      await verify.click();
      await page.locator('.a2ui-surface[aria-busy="true"]').waitFor({state:'detached'});
      await verify.click();
      await page.locator('.a2ui-surface[aria-busy="true"]').waitFor({state:'detached'});
      expect(rpcRequests).toHaveLength(2);
      for (const request of rpcRequests) expect(request).toMatchObject({post_id:19,thread_id:3,revision:12,chat_jid:'web:test',message:{version:'1.0',callAgentFunction:{surfaceId:rpcId,
        callFunction:{'@call':'verifyItem',catalogId:basicCatalogue,args:{label:'Second draft',index:1}},
      }}});
      expect(rpcRequests[1].message.callAgentFunction.functionCallId).not.toBe(rpcRequests[0].message.callAgentFunction.functionCallId);
      await panel.getByRole('button',{name:'Try invalid response'}).click();
      await panel.getByRole('alert').getByText('The agent function did not complete.').waitFor();
      const held = page.waitForRequest(request=>request.method()==='POST' && request.url().endsWith('/agent/a2ui-rpc') && request.postData()?.includes('waitForRevision')===true);
      await panel.getByRole('button',{name:'Wait for revision'}).click();
      await held;
      await page.locator('.a2ui-surface[aria-busy="true"]').waitFor();
      await page.evaluate((item)=>(window as any).draw(item),{...block,owner:'agent',revision:13,surface:rpcSurface});
      await page.locator('.a2ui-surface[aria-busy="false"]').waitFor();
      delayedRpc.resolve();
      expect(await panel.getByRole('alert').count()).toBe(0);
      expect(await page.evaluate(()=>(window as any).events.length)).toBe(initialEventCount);
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
      delayedRpc.resolve();
      await browser?.close();
      server?.stop(true);
      audioOrigin.stop(true);
      await rm(scratch, { recursive: true, force: true });
    }
  });
}
