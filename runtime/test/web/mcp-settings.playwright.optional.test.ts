import { afterAll, beforeAll, expect, test } from 'bun:test';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { build } from 'esbuild';
import { chromium, webkit, type Browser } from 'playwright';
import { withTempWorkspaceEnv } from '../helpers.js';
import { handleMcpSettings } from '../../src/channels/web/handlers/mcp-settings.js';
import { hydrateMcpKeychainCredentials, resetMcpStartupStateForTests } from '../../src/secure/mcp-keychain.js';
import { McpCodemodeController, resetMcpCodemodeRuntimeForTests } from '../../src/agent-pool/mcp-codemode-runtime.js';

const enabled = process.env.PICLAW_RUN_OPTIONAL_BROWSER_TESTS === '1' && process.env.PICLAW_E2E_DISPOSABLE === '1';
const browserTest = enabled ? test : test.skip;
const runtime = resolve(import.meta.dir, '../..');
const bundles: Record<string, string> = {};
let browser: Browser | null = null;
let browserEngine: string | null = null;
async function getBrowser(engine: string): Promise<Browser> {
    if (browser && browserEngine === engine) return browser;
    await browser?.close();
    browser = null;
    browser = await (engine === 'webkit' ? webkit : chromium).launch({ headless: true });
    browserEngine = engine;
    return browser;
}
const owner = { kind: 'local', userId: 'default', username: 'default', displayName: 'Fixture', role: 'admin', mode: 'single-user', homeChatJid: 'web:default', authentication: { method: 'local', sessionId: null, expiresAt: null } };

beforeAll(async () => {
    if (!enabled) return;
    for (const skin of ['classic']) {

const source = `import{h,render}from'./web/src/vendor/preact-htm.js';import{McpSection}from'./web/src/components/settings/mcp.ts';window.unmount=()=>render(null,document.getElementById('root'));render(h(McpSection,{}),document.getElementById('root'));`;
        const result = await build({ stdin: { contents: source, resolveDir: runtime, loader: 'tsx' }, bundle: true, format: 'esm', platform: 'browser', jsx: 'automatic', jsxImportSource: 'preact', write: false });
        bundles[skin] = result.outputFiles[0].text;

const shell = `import{h,render}from'./web/src/vendor/preact-htm.js';import{SettingsDialogContent}from'./web/src/components/settings-dialog.ts';window.__piclawSettingsRequestedSection='mcp';render(h(SettingsDialogContent,{onClose:()=>render(null,document.getElementById('root'))}),document.getElementById('root'));`;
        const shellResult = await build({ stdin: { contents: shell, resolveDir: runtime, loader: 'tsx' }, bundle: true, format: 'esm', platform: 'browser', jsx: 'automatic', jsxImportSource: 'preact', external: ['#editor-vendor/codemirror'], write: false });
        bundles[`${skin}-shell`] = shellResult.outputFiles[0].text;
    }
}, 30000);
afterAll(async () => { await browser?.close(); browser = null; });

for (const engine of ['chromium', 'webkit']) for (const skin of ['classic']) for (const width of [1280, 390]) {
    browserTest(`MCP codemode Apply ${skin}/${engine}/${width}: real backend, native rejection, denial and layout`, async () => {
        await withTempWorkspaceEnv('mcp-pane-browser-', {}, async ws => {
            mkdirSync(join(ws.workspace, '.piclaw'), { recursive: true }); mkdirSync(join(ws.workspace, '.pi'), { recursive: true });
            const config = join(ws.workspace, '.piclaw/config.json');
            writeFileSync(config, JSON.stringify({ domains: { access: { mode: 'single-user' } } }), { mode: 0o600 });
            const initial = readFileSync(config, 'utf8');
            const unsafeName = '<img src=x onerror=alert(1)>' + 'long-name-'.repeat(15);
            writeFileSync(join(ws.workspace, '.pi/mcp.json'), JSON.stringify({ mcpServers: { [unsafeName]: { command: 'fixture-never-run', lifecycle: 'lazy' } } }));
            resetMcpStartupStateForTests();
            resetMcpCodemodeRuntimeForTests();
            await hydrateMcpKeychainCredentials(ws.workspace, () => { throw Error('No keychain'); });
            const runtimeEvents: string[] = [];let activeTools = ['mcp'];
            const sessionRuntime = { session: { async abort() { runtimeEvents.push('abort'); }, getAllTools: () => [{name:'codemode'}], getActiveToolNames: () => activeTools, setActiveToolsByName(names: string[]) { activeTools = names;runtimeEvents.push('set'); } } };
            const controller = new McpCodemodeController({ blockMcpAdmissions() { runtimeEvents.push('fence'); }, async fenceMcpAndSnapshot() { return [sessionRuntime] as any; }, resumeMcpAdmissions() {runtimeEvents.push('resume');}, async quarantineMcpRuntime() {runtimeEvents.push('quarantine');} });
            let authorized = true, hold = false, holdRefresh = false, held = false;
            let release: (() => void) | undefined;
            const calls: string[] = [], previews: unknown[] = [], errors: string[] = [];
            const server = Bun.serve({ hostname: '127.0.0.1', port: 0, async fetch(req) {
                const url = new URL(req.url);
                if (url.pathname === '/') return new Response(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/style.css"><style>body{margin:0;padding:12px;box-sizing:border-box}#root{max-width:800px;margin:auto}button,select{font:inherit}</style><div id="root"></div><script type="module" src="/pane.js"></script>`, { headers: { 'Content-Type': 'text/html' } });
                if (url.pathname === '/pane.js') return new Response(bundles[skin], { headers: { 'Content-Type': 'text/javascript' } });
                if (url.pathname === '/style.css') return new Response(readFileSync(join(runtime, `web/static/${skin}/dist/app.bundle.css`)), { headers: { 'Content-Type': 'text/css' } });
                calls.push(url.pathname);
                if (url.pathname === '/agent/settings/mcp/servers') return Response.json(controller.inspectServers());
                if (!['/agent/settings/mcp', '/agent/settings/mcp/preview', '/agent/settings/mcp/apply'].includes(url.pathname)) return Response.json({ error: 'Unexpected endpoint' }, { status: 404 });
                if (url.pathname.endsWith('/preview')) previews.push(await req.clone().json());
                const response = await handleMcpSettings({ agentPool: { inspectMcpSettings: (policy?: unknown) => controller.inspect(policy), applyMcpSettings: (input: any, check: () => void) => controller.apply(input,check) }, authGateway: { getPrincipal: () => authorized ? owner : null } } as any, req, url);
                if (hold && req.method === 'POST' || holdRefresh && req.method === 'GET') { hold = false; holdRefresh = false; held = true; await new Promise<void>(resolve => { release = resolve; }); }
                return response;
            } });
            const page = await (await getBrowser(engine)).newPage({ viewport: { width, height: 900 } });
            page.on('pageerror', error => errors.push(error.message));
            await page.route('**/*', route => new URL(route.request().url()).origin === server.url.origin ? route.continue() : route.abort());
            try {
                const cdp = engine === 'chromium' ? await page.context().newCDPSession(page) : null;
                if (cdp) { await cdp.send('Performance.enable'); await cdp.send('Profiler.enable'); await cdp.send('Profiler.start'); }
                const start = performance.now();
                await page.goto(server.url.href);
                await page.getByLabel('Engine to preview').waitFor();
                const readyMs = performance.now() - start;
                let cpu: unknown = null;
                if (cdp) {
                    const { profile } = await cdp.send('Profiler.stop');
                    const { metrics } = await cdp.send('Performance.getMetrics');
                    const counts = new Map<number, number>();
                    for (const id of profile.samples || []) counts.set(id, (counts.get(id) || 0) + 1);
                    cpu = { samples: profile.samples?.length || 0, topFrames: profile.nodes.map(node => ({ function: node.callFrame.functionName || '(anonymous)', samples: counts.get(node.id) || 0 })).sort((a, b) => b.samples - a.samples).slice(0, 8), metrics: metrics.filter(metric => ['TaskDuration', 'ScriptDuration', 'LayoutDuration', 'RecalcStyleDuration', 'JSHeapUsedSize', 'Nodes'].includes(metric.name)) };
                    await cdp.detach();
                }
                expect(await page.getByLabel('Engine to preview').inputValue()).toBe('adapter');
                expect(await page.getByLabel('Codemode to preview').inputValue()).toBe('auto');
                expect(await page.getByRole('button', {name:'Apply MCP settings'}).isDisabled()).toBe(true);
                expect(await page.getByText('Experimental Native configuration is incompatible. Use Adapter or remove the listed unsupported settings.', {exact:true}).count()).toBe(0);
                expect(await page.locator('.mcp-settings img').count()).toBe(0);
                expect(await page.locator(".mcp-settings > ul").getByText(unsafeName, { exact: true }).count()).toBe(1);
                await page.getByLabel('Engine to preview').selectOption('native');
                expect(previews).toHaveLength(0);
                await page.getByRole('button', { name: 'Preview compatibility' }).click();
                await page.getByText('Preview blocked — not applied.', { exact: true }).waitFor();
                expect(previews).toEqual([{ engine: 'native', codemode: 'auto' }]);
                expect(await page.getByRole('button', {name:'Apply MCP settings'}).isDisabled()).toBe(true);
                expect(await page.getByText('absoluteDeadlineMs and statusObserver: per-server absolute deadlines and live connection status are unavailable.', {exact:true}).count()).toBe(1);
                expect(await page.getByText('adapter / auto', { exact: true }).count()).toBe(1);
                hold = true;
                await page.getByLabel('Engine to preview').selectOption('adapter');
                await page.getByRole('button', { name: 'Preview compatibility' }).click();
                const deadline = Date.now() + 3000; while (!held && Date.now() < deadline) await Bun.sleep(5); expect(held).toBe(true);
                await page.getByLabel('Engine to preview').selectOption('native');
                release!(); await page.waitForTimeout(50);
                expect(await page.getByText('Preview compatible — not applied.', { exact: true }).count()).toBe(0);
                expect(await page.getByLabel('Engine to preview').inputValue()).toBe('native');
                const layout = await page.evaluate(() => ({ viewport: innerWidth, scroll: document.documentElement.scrollWidth, controls: [...document.querySelectorAll('button,select')].map(node => { const r = node.getBoundingClientRect(); return { left: r.left, right: r.right, height: r.height }; }) }));
                expect(layout.scroll).toBeLessThanOrEqual(width);
                for (const control of layout.controls) { expect(control.left).toBeGreaterThanOrEqual(0); expect(control.right).toBeLessThanOrEqual(width); expect(control.height).toBeGreaterThanOrEqual(width < 600 ? 44 : 36); }
                holdRefresh = true; held = false;
                await page.getByRole('button', { name: 'Refresh MCP status' }).click();
                await page.getByText('Loading MCP settings…', { exact: true }).waitFor();
                expect(await page.getByLabel('Engine to preview').count()).toBe(0);
                expect(await page.locator(".mcp-settings > ul").getByText(unsafeName, { exact: true }).count()).toBe(0);
                const refreshDeadline = Date.now() + 3000; while (!held && Date.now() < refreshDeadline) await Bun.sleep(5); expect(held).toBe(true);
                release!(); await page.getByLabel('Engine to preview').waitFor();
                await page.getByLabel('Codemode to preview').selectOption('on');
                await page.getByRole('button', {name:'Preview compatibility'}).click();
                await page.getByText('Preview compatible — not applied.', {exact:true}).waitFor();
                expect(await page.getByRole('button', {name:'Apply MCP settings'}).isDisabled()).toBe(true);
                await page.getByLabel('I understand Apply may interrupt active turns across all chats.').check();
                hold = true; held = false;
                await page.getByRole('button', {name:'Apply MCP settings'}).click();
                const applyDeadline = Date.now() + 3000; while (!held && Date.now() < applyDeadline) await Bun.sleep(5); expect(held).toBe(true);
                expect(await page.getByLabel('Engine to preview').isDisabled()).toBe(true);
                expect(await page.getByLabel('Codemode to preview').isDisabled()).toBe(true);
                expect(await page.getByRole('button', {name:'Refresh MCP status'}).isDisabled()).toBe(true);
                expect(await page.getByLabel('I understand Apply may interrupt active turns across all chats.').isDisabled()).toBe(true);
                release!();
                await page.getByText('MCP settings saved and applied to current and new sessions.', {exact:true}).waitFor();
                expect(activeTools).toEqual(['mcp','codemode']);expect(runtimeEvents).toEqual(['fence','abort','set','resume']);
                expect(JSON.parse(readFileSync(config,'utf8')).domains.mcp).toEqual({engine:'adapter',codemode:'on'});
                await page.getByLabel('Codemode to preview').selectOption('off');
                expect(await page.getByLabel('I understand Apply may interrupt active turns across all chats.').isChecked()).toBe(false);
                await page.getByRole('button', {name:'Preview compatibility'}).click();
                await page.getByText('Preview compatible — not applied.', {exact:true}).waitFor();
                await page.getByLabel('I understand Apply may interrupt active turns across all chats.').check();await page.getByRole('button', {name:'Apply MCP settings'}).click();
                await page.getByText('MCP settings saved and applied to current and new sessions.', {exact:true}).waitFor();
                expect(activeTools).toEqual(['mcp']);expect(JSON.parse(readFileSync(config,'utf8')).domains.mcp.codemode).toBe('off');
                const saved = readFileSync(config,'utf8');expect(saved).not.toBe(initial);
                authorized = false;
                await page.getByRole('button', { name: 'Refresh MCP status' }).click();
                await page.getByRole('alert').waitFor();
                expect(await page.locator(".mcp-settings > ul").getByText(unsafeName, { exact: true }).count()).toBe(0);
                expect(await page.getByLabel('Engine to preview').count()).toBe(0);
                expect(readFileSync(config, 'utf8')).toBe(saved);
                expect(calls.every(path => ['/agent/settings/mcp', '/agent/settings/mcp/preview', '/agent/settings/mcp/apply', '/agent/settings/mcp/servers'].includes(path))).toBe(true);
                expect(errors).toEqual([]);
                await page.evaluate(() => (window as any).unmount());
                expect(await page.locator('.mcp-settings').count()).toBe(0);
                console.log(JSON.stringify({ skin, engine, width, readyMs, cpu, requests: calls.length, previews: previews.length, scope: 'real pane/controller/backend persistence with synthetic runtime; real Pi execution separately tested' }));
            } finally { release?.(); await page.close(); server.stop(true); resetMcpStartupStateForTests(); resetMcpCodemodeRuntimeForTests(); }
        });
    }, 20000);
}

for (const skin of ['classic']) {
    browserTest(`MCP pane is reachable through actual ${skin} settings navigation`, async () => {
        const calls: string[] = [];
        const server = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch(req) {
            const path = new URL(req.url).pathname;
            if (path === '/') return new Response('<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/style.css"><div id="root" style="width:100%;height:800px"></div><script type="module" src="/shell.js"></script>', { headers: { 'Content-Type': 'text/html' } });
            if (path === '/shell.js') return new Response(bundles[`${skin}-shell`], { headers: { 'Content-Type': 'text/javascript' } });
            if (path === '/style.css') return new Response(readFileSync(join(runtime, `web/static/${skin}/dist/app.bundle.css`)), { headers: { 'Content-Type': 'text/css' } });
            calls.push(path);
            if (path === '/agent/settings/mcp') return Response.json({ ok: true, revision:'opaque-fixture',effect:'abort_active_turns_and_update_codemode',nativeBlockReason:'Native not qualified',nativeBlockers:[], persisted: { policy: { engine: 'adapter', codemode: 'auto' } }, runtime: { configuredFactory: 'adapter', observedPolicy: null, connectionStatus: 'unknown', applyAvailable: false }, readiness: { adapter: true, native: false, codemode: true }, servers: [], plan: { policy: { engine: 'adapter', codemode: 'auto' }, applicable: true, codemodeEnabled: false, issues: [] }, applyAvailable: false });
            return Response.json({});
        } });
        const page = await (await getBrowser('chromium')).newPage({ viewport: { width: 1200, height: 900 } });
        const pageErrors: string[] = [];
        page.on('pageerror', error => pageErrors.push(error.message));
        try {
            await page.goto(server.url.href);
            try { await page.getByLabel('Engine to preview').waitFor({ timeout: 5000 }); }
            catch { throw new Error(JSON.stringify({ skin, pageErrors, calls, body: (await page.locator('body').innerText()).slice(0, 2500) })); }
            const nav = page.locator('nav button').filter({ has: page.getByText('MCP', { exact: true }) });
            expect(await nav.count()).toBe(1);
            await page.locator('nav button').filter({ has: page.getByText('General', { exact: true }) }).click();
            await page.getByLabel('Engine to preview').waitFor({ state: 'detached' });
            await nav.click();
            await page.getByLabel('Engine to preview').waitFor();
            expect(calls.filter(path => path === '/agent/settings/mcp').length).toBe(2);
            expect(calls.some(path => path.endsWith('/apply') || path.endsWith('/save'))).toBe(false);
        } finally { await page.close(); server.stop(true); }
    }, 20000);
}
