import { afterAll, beforeAll, expect, test } from 'bun:test';
import { join } from 'node:path';
import { chromium, type Browser } from 'playwright';

const enabled = process.env.PICLAW_RUN_OPTIONAL_BROWSER_TESTS === '1', browserTest = enabled ? test : test.skip;
let server: ReturnType<typeof Bun.serve>, browser: Browser;
const requests: string[] = [];
const aborts: unknown[] = [];
const liveActivity = {
  answer_entry_id: null, started_at: null, ended_at: null, duration_ms: null, tool_ms: 0, output_tokens: 0, tools: 1, errors: 0, truncated: false,
  steps: [
    { id: 'thinking:20:0', kind: 'thinking', text: 'Scan the workspace first.', chars: 25 },
    { id: 'tool:call-live', kind: 'tool', tool: { call_id: 'call-live', name: 'bash', title: 'bash: long scan', status: 'running', duration_ms: null,
      args_preview: '{\n  "command": "long scan"\n}', output_preview: '', output_chars: 0, output_lines: 0, images: 0 } },
  ],
};
const longOutput = Array.from({ length: 30 }, (_, index) => `line ${index + 1}`).join('\n');
const emittedPages = ['EMITTED full output', '€ final output'];
const activity = {
  answer_entry_id: 8, started_at: 1000, ended_at: 9000, duration_ms: 8000, tool_ms: 4900, output_tokens: 60, tools: 3, errors: 1, truncated: false,
  steps: [
    { id: 'thinking:2:0', kind: 'thinking', text: 'First line of reasoning.\nSecond line.\nThird line.\nFourth line hidden by the clamp.', chars: 80 },
    { id: 'text:2:1', kind: 'text', text: 'Running the **tests** first. <script>window.__xss = 1</script>', chars: 60 },
    { id: 'tool:call-a', kind: 'tool', tool: { call_id: 'call-a', name: 'bash', title: 'bash: bun test', status: 'ok', duration_ms: 4000,
      args_preview: '{\n  "command": "bun test"\n}', output_preview: 'line 1\nline 2…', output_chars: longOutput.length, output_lines: 30, images: 0 } },
    { id: 'tool:call-b', kind: 'tool', tool: { call_id: 'call-b', name: 'read', title: 'read: /tmp/a.txt', status: 'error', duration_ms: 50,
      args_preview: '{\n  "path": "/tmp/a.txt"\n}', output_preview: '<img src=x onerror="window.__xss=2">missing', output_chars: 43, output_lines: 1, images: 0 } },
    { id: 'input:5', kind: 'input', text: 'also check lint', chars: 15 },
    { id: 'tool:call-c', kind: 'tool', tool: { call_id: 'call-c', name: 'codemode', title: 'codemode', status: 'ok', duration_ms: 900,
      args_preview: '{}', output_preview: '', output_chars: 0, output_lines: 0, images: 1,
      nested: [{ name: 'read', title: 'read: /w/x.ts', status: 'ok', duration_ms: 5 }, { name: 'bash', title: 'bash', status: 'error', duration_ms: 7 }] } },
  ],
};

beforeAll(async () => {
  if (!enabled) return;
  const build = await Bun.build({ entrypoints: [join(import.meta.dir, 'fixtures/turn-activity-fixture.ts')], target: 'browser', format: 'esm' });
  if (!build.success) throw new AggregateError(build.logs, 'Turn activity fixture build failed');
  server = Bun.serve({ hostname: '127.0.0.1', port: Number(process.env.PICLAW_BROWSER_FIXTURE_PORT ?? 0), async fetch(req) {
    const url = new URL(req.url);
    if (url.pathname === '/fixture.js') return new Response(build.outputs[0], { headers: { 'Content-Type': 'text/javascript' } });
    if (url.pathname.startsWith('/static/')) return new Response(Bun.file(join(import.meta.dir, '../../web', url.pathname)));
    if (url.pathname === '/agent/tool-abort') {
      aborts.push(await req.json());
      return Response.json({ status: 'ok', call_id: 'call-live', aborted: true });
    }
    if (url.pathname === '/agent/turn-activity') {
      requests.push(url.search);
      if (url.searchParams.get('live') === '1') return Response.json(liveActivity);
      if (url.searchParams.get('message_id') !== '41') return Response.json({ error: 'Not found' }, { status: 404 });
      const step = url.searchParams.get('step');
      if (!step) return Response.json(activity);
      if (step === 'tool:call-a') {
        const offset = Number(url.searchParams.get('offset') ?? 0), page = longOutput.slice(offset, offset + 100);
        const emittedOffset = Number(url.searchParams.get('emitted_offset') ?? 0);
        const emittedText = emittedOffset === 0 ? emittedPages[0]! : emittedPages[1]!;
        return Response.json({ id: step, kind: 'tool', args: '{\n  "command": "bun test"\n}', output: page, output_offset: offset,
          output_chars: longOutput.length, truncated: offset + page.length < longOutput.length,
          input: { original: '{"command":"cd /w && bun test"}', readable: { kind: 'shell', label: 'Command', language: 'shell', text: 'cd /w \\\n  && bun test' } },
          emitted: { kind: 'text', label: 'Output', text: emittedText, offset: emittedOffset,
            next_offset: emittedOffset + Buffer.byteLength(emittedText), total: Buffer.byteLength(emittedPages.join('')),
            truncated: emittedOffset === 0, source: 'tool-output' } });
      }
      if (step === 'thinking:2:0') return Response.json({ id: step, kind: 'thinking', text: activity.steps[0]!.text, truncated: false });
      return Response.json({ error: 'Not found' }, { status: 404 });
    }
    return new Response(`<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/static/classic/dist/app.bundle.css"><main id="app"></main><script type="module" src="/fixture.js"></script>`, { headers: { 'Content-Type': 'text/html' } });
  } });
  browser = process.env.PLAYWRIGHT_CDP_ENDPOINT ? await chromium.connectOverCDP(process.env.PLAYWRIGHT_CDP_ENDPOINT) : await chromium.launch({ headless: true });
}, 20000);
afterAll(async () => { await browser?.close(); server?.stop(true); });

browserTest('turn activity loads when visible, discloses steps progressively and pages tool output', async () => {
  requests.length = 0;
  const page = await browser.newPage({ viewport: { width: 1000, height: 700 } }), errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.setDefaultTimeout(4000);
  const base = `http://127.0.0.1:${server.port}`;
  await page.route('**/*', (route) => new URL(route.request().url()).origin === base ? route.continue() : route.abort());
  try {
    await page.goto(base);
    await page.waitForFunction(() => Boolean((window as any).turnActivityFixture));
    await page.waitForTimeout(300);
    expect(requests).toEqual([]);

    await page.locator('#post-41').scrollIntoViewIfNeeded();
    const header = page.locator('#post-41 .turn-activity-header');
    await header.waitFor();
    expect(await header.innerText()).toContain('Worked for 8.0s');
    expect(await header.innerText()).toContain('3 tools · 4.9s in tools · 60 tokens');
    expect(await page.locator('#post-41 .turn-activity-badge.is-error').innerText()).toBe('1 failed');
    expect(await header.getAttribute('aria-expanded')).toBe('false');
    expect(await page.locator('#post-41 .turn-activity-detail').isHidden()).toBe(true);
    // A reply whose activity is unavailable renders nothing.
    await page.locator('#post-404').scrollIntoViewIfNeeded();
    await page.waitForTimeout(200);
    expect(await page.locator('#post-404 .turn-activity-header').count()).toBe(0);

    // Keyboard opens the log; steps keep their order.
    await header.focus();
    await page.keyboard.press('Enter');
    expect(await header.getAttribute('aria-expanded')).toBe('true');
    const steps = page.locator('#post-41 .turn-activity-steps > li');
    expect(await steps.evaluateAll((nodes) => nodes.map((node) => node.className.split(' ')[1]))).toEqual([
      'turn-activity-thinking', 'turn-activity-text', 'turn-activity-tool', 'turn-activity-tool', 'turn-activity-input', 'turn-activity-tool']);
    expect(await page.locator('#post-41 .turn-activity-tool.is-error').count()).toBe(1);
    expect(await page.locator('#post-41 .turn-activity-text').innerText()).toContain('Running the');
    expect(await page.locator('#post-41 .turn-activity-text script').count()).toBe(0);

    // Clamped reasoning offers "Show more" and expands in place.
    const thinking = page.locator('#post-41 .turn-activity-thinking');
    await thinking.locator('.turn-activity-more').click();
    expect(await thinking.getAttribute('class')).toContain('is-expanded');
    expect(await thinking.innerText()).toContain('Fourth line hidden by the clamp.');

    // Tool card: opening fetches full arguments and output; previews may already be replaced.
    const bash = page.locator('#post-41 .turn-activity-tool').first();
    await bash.locator('.turn-activity-tool-header').click();
    expect(await bash.locator('.turn-activity-tool-header').getAttribute('aria-expanded')).toBe('true');
    // Input: Readable by default, Original on request; copy works.
    const inputRegion = bash.locator('.turn-activity-input-region');
    await inputRegion.locator('pre[data-view="readable"]').waitFor();
    expect((await inputRegion.locator('.turn-activity-section-label').innerText()).toLowerCase()).toBe('command');
    expect(await inputRegion.locator('pre').innerText()).toContain('&& bun test');
    await inputRegion.getByRole('button', { name: 'Original', exact: true }).click();
    expect(await inputRegion.locator('pre').innerText()).toBe('{"command":"cd /w && bun test"}');
    // Highlighted with the shared Lezer highlighter (token classes, escaped text).
    expect(await inputRegion.locator('pre code.hljs.language-json span[class*="tok-"]').count()).toBeGreaterThan(0);
    expect(await inputRegion.getByRole('button', { name: 'Original', exact: true }).getAttribute('aria-pressed')).toBe('true');
    await inputRegion.locator('.turn-activity-copy').click();
    await inputRegion.locator('.turn-activity-copy.is-success').waitFor();
    // Output: As emitted by default, As seen by model on request, which pages.
    const outputRegion = bash.locator('.turn-activity-output-region');
    expect(await outputRegion.locator('pre').innerText()).toBe(emittedPages[0]!);
    await outputRegion.getByRole('button', { name: 'Load more', exact: true }).click();
    await page.waitForFunction((text) => document.querySelector('#post-41 pre[data-view="emitted"]')?.textContent === text, emittedPages.join(''));
    expect(await outputRegion.getByText('Load more').count()).toBe(0);
    await outputRegion.getByRole('button', { name: 'As seen by model', exact: true }).click();
    for (let pageIndex = 0; pageIndex < 2; pageIndex++) {
      await bash.getByText('Load more').waitFor();
      await bash.getByText('Load more').click();
    }
    await page.waitForFunction(() => document.querySelector('#post-41 .turn-activity-output')?.textContent?.endsWith('line 30'));
    expect(await bash.getByText('Load more').count()).toBe(0);
    expect(requests.filter((query) => query.includes('step=tool%3Acall-a'))).toEqual(['?chat_jid=web%3Afixture&message_id=41&step=tool%3Acall-a', `?chat_jid=web%3Afixture&message_id=41&step=tool%3Acall-a&emitted_offset=${Buffer.byteLength(emittedPages[0]!)}`, '?chat_jid=web%3Afixture&message_id=41&step=tool%3Acall-a&offset=100', '?chat_jid=web%3Afixture&message_id=41&step=tool%3Acall-a&offset=200']);

    // Untrusted output and commentary stay inert text.
    const failed = page.locator('#post-41 .turn-activity-tool.is-error');
    await failed.locator('.turn-activity-tool-header').click();
    expect(await failed.locator('img').count()).toBe(0);
    expect(await failed.locator('.turn-activity-output').innerText()).toContain('<img src=x');
    expect(await page.evaluate(() => (window as any).__xss)).toBeUndefined();

    // Nested code-mode calls and returned images are summarised.
    const codemode = page.locator('#post-41 .turn-activity-tool').nth(2);
    expect(await codemode.locator('.turn-activity-badge').innerText()).toBe('2 calls');
    await codemode.locator('.turn-activity-tool-header').click();
    expect(await codemode.locator('.turn-activity-nested-call').count()).toBe(2);
    expect(await codemode.innerText()).toContain('1 image returned to the model');

    // Remounting reuses the cached summary; no further list request.
    const listRequests = requests.filter((query) => !query.includes('step=')).length;
    await page.evaluate(() => (window as any).turnActivityFixture.remount());
    await page.locator('#post-41 .turn-activity-header').waitFor();
    expect(requests.filter((query) => !query.includes('step=')).length).toBe(listRequests);

    // Narrow screens keep the log inside the post.
    await page.setViewportSize({ width: 390, height: 844 });
    await page.locator('#post-41 .turn-activity-header').click();
    const overflow = await page.locator('#post-41 .turn-activity').evaluate((node) => node.scrollWidth - node.clientWidth);
    expect(overflow).toBeLessThanOrEqual(1);
    expect(errors).toEqual([]);
  } finally {
    await page.close();
  }
}, 20000);

browserTest('live turn shows elapsed work and streamed text, discloses running tools and stops one tool only', async () => {
  requests.length = 0; aborts.length = 0;
  const page = await browser.newPage({ viewport: { width: 1000, height: 700 } }), errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.setDefaultTimeout(4000);
  const base = `http://127.0.0.1:${server.port}`;
  await page.route('**/*', (route) => new URL(route.request().url()).origin === base ? route.continue() : route.abort());
  try {
    await page.goto(base);
    await page.waitForFunction(() => Boolean((window as any).turnActivityFixture));
    const status = { type: 'tool_call', title: 'bash: long scan', tool_call_id: 'call-live', status: 'running', started_at: new Date(Date.now() - 5000).toISOString(), output_preview: 'scanning step 1\nscanning step 2' };
    await page.evaluate((value) => (window as any).turnActivityFixture.live(value), { status, draft: { text: 'Starting a **slow** scan.', fullText: 'Starting a **slow** scan.' }, thought: { text: '', fullText: '' }, turnId: 'turn-1' });
    const live = page.locator('.turn-activity-live');
    await live.scrollIntoViewIfNeeded();
    const header = live.locator('.turn-activity-header');
    expect(await header.innerText()).toMatch(/Working · [4-9](\.\d)?s/);
    expect(await header.innerText()).toContain('bash: long scan');
    expect(await header.getAttribute('aria-expanded')).toBe('false');
    expect(await live.locator('.turn-activity-live-draft').innerText()).toContain('scan.');
    await page.waitForTimeout(400);
    expect(requests.filter((query) => query.includes('live=1'))).toEqual([]);

    await header.click();
    const tool = live.locator('.turn-activity-tool');
    await tool.waitFor();
    expect(requests.some((query) => query.includes('live=1'))).toBe(true);
    await tool.locator('.turn-activity-tool-header').click();
    expect(await tool.locator('.turn-activity-output').innerText()).toContain('scanning step 2');

    // Keep running cancels; Stop tool only sends the call and the note.
    await tool.locator('.turn-activity-stop').click();
    await tool.getByRole('button', { name: 'Keep running' }).click();
    expect(await tool.locator('.turn-activity-stop-confirm').count()).toBe(0);
    await tool.locator('.turn-activity-stop').click();
    await tool.getByLabel('Note for the agent (optional)').fill('skip it');
    await tool.getByRole('button', { name: 'Stop tool only' }).click();
    await tool.getByText('Stopping…').waitFor();
    expect(aborts).toEqual([{ chat_jid: 'web:fixture', call_id: 'call-live', note: 'skip it' }]);

    // The block leaves the timeline when the turn ends.
    await page.evaluate(() => (window as any).turnActivityFixture.live({ status: { type: 'done' }, draft: { text: '', fullText: '' }, thought: { text: '', fullText: '' }, turnId: 'turn-1' }));
    await live.waitFor({ state: 'detached' });
    expect(errors).toEqual([]);
  } finally {
    await page.close();
  }
}, 20000);

for (const width of [390, 1000]) {
  browserTest(`${width}px: a running tool's stop button stays at the end of its row`, async () => {
    const tool = liveActivity.steps[1]!.tool!, title = tool.title;
    tool.title = 'bash: for i in $(seq 1 15); do echo scanning step $i; sleep 1; done && bun run test:local --cwd runtime';
    const page = await browser.newPage({ viewport: { width, height: 700 } }), errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.setDefaultTimeout(4000);
    const base = `http://127.0.0.1:${server.port}`;
    await page.route('**/*', (route) => new URL(route.request().url()).origin === base ? route.continue() : route.abort());
    try {
      await page.goto(base);
      await page.waitForFunction(() => Boolean((window as any).turnActivityFixture));
      const status = { type: 'tool_call', title: tool.title, tool_call_id: 'call-live', status: 'running', started_at: new Date().toISOString() };
      await page.evaluate((value) => (window as any).turnActivityFixture.live(value), { status, draft: { text: '', fullText: '' }, thought: { text: '', fullText: '' }, turnId: 'turn-2' });
      const live = page.locator('.turn-activity-live');
      await live.locator('.turn-activity-header').click();
      const row = live.locator('.turn-activity-tool-row');
      await row.locator('.turn-activity-stop').waitFor();
      await row.locator('.turn-activity-tool-header').hover();
      const g = await row.evaluate((el) => {
        const r = (node: Element) => node.getBoundingClientRect();
        const box = r(el), head = r(el.querySelector('.turn-activity-tool-header')!), stop = r(el.querySelector('.turn-activity-stop')!);
        return { rowRight: Math.round(box.right - stop.right), sameLine: stop.top >= head.top && stop.bottom <= head.bottom, afterTitle: stop.left >= head.right - 1, rowBackground: getComputedStyle(el).backgroundColor };
      });
      // A long command must not push the button onto a line of its own, and the
      // hover highlight covers the button as part of the row.
      expect({ ...g, rowBackground: g.rowBackground === 'rgba(0, 0, 0, 0)' ? 'none' : 'highlighted' }).toEqual({ rowRight: 4, sameLine: true, afterTitle: true, rowBackground: 'highlighted' });
      expect(errors).toEqual([]);
    } finally {
      tool.title = title;
      await page.close();
    }
  }, 20000);
}

for (const width of [390, 1000]) {
  browserTest(`${width}px: the running tool card under the Working block has its own stop button`, async () => {
    aborts.length = 0;
    const page = await browser.newPage({ viewport: { width, height: 700 } }), errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.setDefaultTimeout(4000);
    const base = `http://127.0.0.1:${server.port}`;
    await page.route('**/*', (route) => new URL(route.request().url()).origin === base ? route.continue() : route.abort());
    try {
      await page.goto(base);
      await page.waitForFunction(() => Boolean((window as any).turnActivityFixture));
      const status = { type: 'tool_call', title: 'bash: for i in $(seq 1 15); do echo scanning step $i; sleep 1; done && bun run test', tool_call_id: 'call-live', status: 'running', started_at: new Date(Date.now() - 4000).toISOString() };
      await page.evaluate((value) => (window as any).turnActivityFixture.live(value), { status, draft: { text: '', fullText: '' }, thought: { text: '', fullText: '' }, turnId: 'turn-3', withStatusPane: true });
      const pane = page.locator('.turn-activity-live-status');
      const stop = pane.locator('.turn-activity-stop');
      await stop.waitFor();
      const g = await pane.evaluate((el) => {
        const card = el.querySelector('.agent-status')!.getBoundingClientRect(), stop = el.querySelector('.turn-activity-stop')!.getBoundingClientRect(), text = el.querySelector('.agent-status-text')!.getBoundingClientRect();
        return { insideRight: Math.round(card.right - stop.right), insideTop: stop.top >= card.top && stop.bottom <= card.bottom, clearOfText: text.right <= stop.left };
      });
      // Inside the card at its top-right corner, clear of the tool title.
      expect(g.insideRight).toBeGreaterThanOrEqual(4);
      expect(g.insideRight).toBeLessThanOrEqual(12);
      expect({ insideTop: g.insideTop, clearOfText: g.clearOfText }).toEqual({ insideTop: true, clearOfText: true });
      await stop.click();
      const form = pane.locator('.turn-activity-stop-confirm');
      const [formBox, cardBox] = await Promise.all([form.boundingBox(), pane.locator('.agent-status').boundingBox()]);
      expect(formBox!.y).toBeGreaterThanOrEqual(cardBox!.y + cardBox!.height - 1);
      expect(formBox!.x + formBox!.width).toBeLessThanOrEqual(width);
      await pane.getByLabel('Note for the agent (optional)').fill('enough');
      await pane.getByRole('button', { name: 'Stop tool only' }).click();
      await pane.getByText('Stopping…').waitFor();
      expect(aborts).toEqual([{ chat_jid: 'web:fixture', call_id: 'call-live', note: 'enough' }]);
      // Output updates arrive as tool_status events for the same call; the button stays.
      await page.evaluate((value) => (window as any).turnActivityFixture.live(value), { status: { ...status, type: 'tool_status', tool_call_id: 'call-next' }, draft: { text: '', fullText: '' }, thought: { text: '', fullText: '' }, turnId: 'turn-3', withStatusPane: true });
      await pane.locator('.turn-activity-stop').waitFor();
      // Nothing to stop while the agent is only thinking.
      await page.evaluate((value) => (window as any).turnActivityFixture.live(value), { status: { type: 'thinking', title: 'Thinking' }, draft: { text: '', fullText: '' }, thought: { text: 'hmm', fullText: 'hmm' }, turnId: 'turn-4', withStatusPane: true });
      await page.waitForTimeout(200);
      expect(await page.locator('.turn-activity-live-status .turn-activity-stop').count()).toBe(0);
      expect(errors).toEqual([]);
    } finally {
      await page.close();
    }
  }, 20000);
}
