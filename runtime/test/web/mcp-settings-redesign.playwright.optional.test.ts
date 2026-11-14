import { afterAll, beforeAll, expect, test } from 'bun:test';
import { join } from 'node:path';
import { chromium, webkit, type Browser } from 'playwright';

const run = process.env.PICLAW_RUN_OPTIONAL_BROWSER_TESTS === '1' ? test : test.skip;
const browsers: Record<string, Browser> = {};
let server: ReturnType<typeof Bun.serve>;
const rows = [
    { name: 'knowledge-service', enabled: true, localOverride: false, source: 'user', withheldFields: ['headers'], patch: { url: 'https://knowledge.example.test/mcp', auth: 'bearer', bearerTokenKeychain: 'services/reader', lifecycle: 'lazy', directTools: false } },
    { name: 'local-tools', enabled: false, localOverride: true, source: 'project', withheldFields: ['args', 'env'], patch: { command: 'example-service', disabled: true } },
];
const servers = () => ({ ok: true, revision: 'fixture-revision', servers: rows, preview: null, applyAvailable: true, phase: 'ready' });
const policy = () => ({ ok: true, revision: 'fixture-policy', effect: 'abort_active_turns_and_update_codemode', nativeBlockReason: 'Native is not available for this configuration.', nativeBlockers: [], persisted: { policy: { engine: 'adapter', codemode: 'auto' } }, runtime: { configuredFactory: 'adapter', observedPolicy: { engine: 'adapter', codemode: 'auto' }, connectionStatus: 'unknown', applyAvailable: true }, readiness: { adapter: true, native: false, codemode: true }, servers: rows.map(row => ({ name: row.name, nativeProjectionStatus: 'mapped' })), plan: { policy: { engine: 'adapter', codemode: 'auto' }, applicable: true, codemodeEnabled: false, issues: [] }, applyAvailable: true });
beforeAll(async () => {
    if (process.env.PICLAW_RUN_OPTIONAL_BROWSER_TESTS !== '1') return;
    const result = await Bun.build({ entrypoints: [join(import.meta.dir, 'fixtures/mcp-redesign.ts')], target: 'browser', format: 'esm' });
    if (!result.success) throw Error(String(result.logs));
    const script = await result.outputs[0].text();
    server = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch(req) {
        const path = new URL(req.url).pathname;
        if (path === '/fixture.js') return new Response(script, { headers: { 'content-type': 'text/javascript' } });
        if (path.startsWith('/static/')) return new Response(Bun.file(join(import.meta.dir, '../../web', path)));
        return new Response('<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/static/classic/dist/app.bundle.css"><style>body{margin:0;padding:16px;overflow:auto}#root{max-width:1100px;margin:auto}</style><main id="root"></main><script type="module" src="/fixture.js"></script>', { headers: { 'content-type': 'text/html' } });
    } });
    browsers.chromium = await chromium.launch(); browsers.webkit = await webkit.launch();
}, 30000);
afterAll(async () => { for (const browser of Object.values(browsers)) await browser.close(); server?.stop(true); });
async function open(engine: string, width: number, scheme = 'light', empty = false) {
    const page = await browsers[engine].newPage({ viewport: { width, height: 900 }, hasTouch: width < 600, colorScheme: scheme as 'light' | 'dark' });
    const requests: Array<{ path: string; body: any }> = [], errors: string[] = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.route('**/*', async route => {
        const req = route.request(), url = new URL(req.url());
        if (url.origin !== server.url.origin) return route.abort();
        if (!url.pathname.startsWith('/agent/')) return route.continue();
        const body = req.postDataJSON(); requests.push({ path: url.pathname, body });
        if (url.pathname === '/agent/settings/mcp') return route.fulfill({ json: policy() });
        if (url.pathname === '/agent/settings/mcp/servers') return route.fulfill({ json: { ...servers(), servers: empty ? [] : rows } });
        if (url.pathname.endsWith('/servers/preview')) return route.fulfill({ json: { ...servers(), preview: { name: body.name, action: body.action, applicable: true, present: true, enabled: true, patch: body.patch, withheldFields: [] } } });
        return route.fulfill({ status: 500, json: { error: 'Unexpected mutation in a UI-only fixture' } });
    });
    await page.goto(server.url.href);
    await page.evaluate(s => document.documentElement.classList.add(s), scheme);
    await page.getByRole('button', { name: 'Refresh servers', exact: true }).waitFor();
    await page.waitForTimeout(100);
    return { page, requests, errors };
}

for (const engine of ['chromium', 'webkit']) {
    for (const width of [320, 1280]) for (const scheme of ['light', 'dark']) {
        run(`${engine}/${width}/${scheme}: MCP groups server management, typed auth and explicit patch review`, async () => {
            const { page, requests, errors } = await open(engine, width, scheme);
            try {
                expect(await page.getByRole('heading', { name: 'MCP servers', exact: true }).count()).toBe(1);
                expect(await page.getByRole('heading', { name: 'Runtime policy', exact: true }).count()).toBe(1);
                expect(await page.getByText('Live connection status is unknown.', { exact: true }).count()).toBe(1);
                await page.getByRole('button', { name: 'knowledge-service', exact: true }).click();
                expect(await page.getByLabel('Server name', { exact: true }).getAttribute('readonly')).not.toBeNull();
                expect(await page.getByLabel('HTTP URL', { exact: true }).inputValue()).toBe('');
                expect(await page.getByText('Current: https://knowledge.example.test/mcp', { exact: true }).count()).toBe(1);
                expect(await page.getByLabel('Authentication', { exact: true }).evaluate(el => el.tagName)).toBe('SELECT');
                await page.getByLabel('Authentication', { exact: true }).selectOption('"bearer"');
                await page.getByLabel('Bearer keychain entry name', { exact: true }).fill('services/notes-reader');
                await page.locator('.mcp-editor details > summary').filter({ hasText: 'Advanced options' }).click();
                await page.getByLabel('Request timeout (milliseconds)', { exact: true }).fill('15000');
                expect(requests.some(r => r.body)).toBe(false);
                await page.getByRole('button', { name: 'Preview server change', exact: true }).click();
                await page.getByText('Preview only: knowledge-service — enabled.', { exact: true }).waitFor();
                expect(requests.at(-1)?.body).toEqual({ name: 'knowledge-service', action: 'update', patch: { auth: 'bearer', bearerTokenKeychain: 'services/notes-reader', requestTimeoutMs: 15000 } });
                expect(await page.getByRole('button', { name: 'Apply server change', exact: true }).isDisabled()).toBe(true);
                await page.getByLabel('I understand server Apply interrupts turns and reloads extensions.').check();
                expect(await page.getByRole('button', { name: 'Apply server change', exact: true }).isEnabled()).toBe(true);
                // Every supported field is retained, even when grouped under a disclosure.
                expect(await page.locator('[data-mcp-field]').count()).toBe(21);
                await page.locator('details').evaluateAll(nodes => nodes.forEach(node => { (node as HTMLDetailsElement).open = true; }));
                const controls = await page.locator('.mcp-settings button, .mcp-settings input:not([type="checkbox"]), .mcp-settings select, .mcp-settings textarea, .mcp-settings summary').evaluateAll(nodes => nodes.map(el => {
                    const r = el.getBoundingClientRect(); return { left: r.left, right: r.right, height: r.height };
                }));
                for (const control of controls) {
                    expect(control.left).toBeGreaterThanOrEqual(0); expect(control.right).toBeLessThanOrEqual(width);
                    expect(control.height).toBeGreaterThanOrEqual(width < 600 ? 44 : 36);
                }
                expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
                expect(requests.some(r => r.path.endsWith('/apply'))).toBe(false);
                expect(errors).toEqual([]);
            } finally { await page.close(); }
        }, 30000);
    }
    run(`${engine}: new generic remote server uses create intent without echoing existing config`, async () => {
        const { page, requests, errors } = await open(engine, 390, 'light', true);
        try {
            expect(await page.getByText('No MCP servers configured.', { exact: true }).count()).toBe(1);
            await page.getByRole('button', { name: 'New server', exact: true }).click();
            expect(await page.getByLabel('Server name', { exact: true }).evaluate(el => el === document.activeElement)).toBe(true);
            await page.getByLabel('Server name', { exact: true }).fill('remote-notes');
            await page.getByLabel('HTTP URL', { exact: true }).fill('https://tools.example.test/mcp');
            await page.getByLabel('Authentication', { exact: true }).selectOption('"bearer"');
            await page.getByLabel('Bearer environment name', { exact: true }).fill('SERVICE_TOKEN');
            await page.getByRole('button', { name: 'Preview server change', exact: true }).click();
            await page.getByText('Preview only: remote-notes — enabled.', { exact: true }).waitFor();
            expect(requests.at(-1)?.body).toEqual({ name: 'remote-notes', action: 'create', patch: { url: 'https://tools.example.test/mcp', auth: 'bearer', bearerTokenEnv: 'SERVICE_TOKEN' } });
            expect(requests.some(r => r.path.endsWith('/apply'))).toBe(false);
            expect(errors).toEqual([]);
        } finally { await page.close(); }
    }, 30000);
    run(`${engine}: invalid structured field is local, accessible and invalidates a preview`, async () => {
        const { page, requests, errors } = await open(engine, 390);
        try {
            await page.getByRole('button', { name: 'local-tools', exact: true }).click();
            const args = page.getByLabel('Arguments (JSON string array)', { exact: true });
            expect(await args.inputValue()).toBe('');
            expect(await page.getByText(/Private\/advanced fields preserved: args, env/).count()).toBe(1);
            await args.fill('not valid JSON');
            expect(await args.getAttribute('aria-invalid')).toBe('true');
            expect(await page.getByRole('button', { name: 'Preview server change', exact: true }).isDisabled()).toBe(true);
            expect(requests.some(r => r.body)).toBe(false);
            await args.fill('["--stdio"]');
            expect(await page.getByRole('button', { name: 'Preview server change', exact: true }).isEnabled()).toBe(true);
            await page.getByRole('button', { name: 'Preview server change', exact: true }).click();
            await page.getByText('Preview only: local-tools — enabled.', { exact: true }).waitFor();
            await page.getByLabel('I understand server Apply interrupts turns and reloads extensions.').check();
            await args.fill('null');
            expect(await page.getByRole('button', { name: 'Apply server change', exact: true }).isDisabled()).toBe(true);
            expect(await page.getByLabel('I understand server Apply interrupts turns and reloads extensions.').isChecked()).toBe(false);
            expect(errors).toEqual([]);
        } finally { await page.close(); }
    }, 30000);
}
