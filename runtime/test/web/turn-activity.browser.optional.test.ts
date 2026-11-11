import { afterAll, beforeAll, expect, test } from 'bun:test';
import { join } from 'node:path';
import { chromium, type Browser } from 'playwright';

const enabled = process.env.PICLAW_RUN_OPTIONAL_BROWSER_TESTS === '1', browserTest = enabled ? test : test.skip;
let server: ReturnType<typeof Bun.serve>, browser: Browser;
const requests: string[] = [];
const longOutput = Array.from({ length: 30 }, (_, index) => `line ${index + 1}`).join('\n');
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
  server = Bun.serve({ hostname: '127.0.0.1', port: Number(process.env.PICLAW_BROWSER_FIXTURE_PORT ?? 0), fetch(req) {
    const url = new URL(req.url);
    if (url.pathname === '/fixture.js') return new Response(build.outputs[0], { headers: { 'Content-Type': 'text/javascript' } });
    if (url.pathname.startsWith('/static/')) return new Response(Bun.file(join(import.meta.dir, '../../web', url.pathname)));
    if (url.pathname === '/agent/turn-activity') {
      requests.push(url.search);
      if (url.searchParams.get('message_id') !== '41') return Response.json({ error: 'Not found' }, { status: 404 });
      const step = url.searchParams.get('step');
      if (!step) return Response.json(activity);
      if (step === 'tool:call-a') {
        const offset = Number(url.searchParams.get('offset') ?? 0), page = longOutput.slice(offset, offset + 100);
        return Response.json({ id: step, kind: 'tool', args: '{\n  "command": "bun test"\n}', output: page, output_offset: offset,
          output_chars: longOutput.length, truncated: offset + page.length < longOutput.length });
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

    // Tool card: arguments, preview, then the full output in pages.
    const bash = page.locator('#post-41 .turn-activity-tool').first();
    await bash.locator('.turn-activity-tool-header').click();
    expect(await bash.locator('.turn-activity-tool-header').getAttribute('aria-expanded')).toBe('true');
    expect(await bash.locator('.turn-activity-pre').first().innerText()).toContain('"command": "bun test"');
    await bash.getByText(/Show full output/).click();
    for (let pageIndex = 0; pageIndex < 2; pageIndex++) {
      await bash.getByText('Load more').waitFor();
      await bash.getByText('Load more').click();
    }
    await page.waitForFunction(() => document.querySelector('#post-41 .turn-activity-output')?.textContent?.endsWith('line 30'));
    expect(await bash.getByText('Load more').count()).toBe(0);
    expect(requests.filter((query) => query.includes('step=tool%3Acall-a'))).toEqual(['?chat_jid=web%3Afixture&message_id=41&step=tool%3Acall-a', '?chat_jid=web%3Afixture&message_id=41&step=tool%3Acall-a&offset=100', '?chat_jid=web%3Afixture&message_id=41&step=tool%3Acall-a&offset=200']);

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
