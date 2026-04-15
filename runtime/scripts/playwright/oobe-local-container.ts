#!/usr/bin/env bun
// @ts-nocheck

import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright';
import {
  OOBE_PROVIDER_MISSING_DISMISSED_KEY,
  OOBE_PROVIDER_READY_COMPLETED_KEY,
} from '../../web/src/ui/oobe-state.ts';

const DEFAULT_IMAGE = process.env.PICLAW_OOBE_TEST_IMAGE || 'piclaw-oobe-test:local';
const DEFAULT_CONTAINER_NAME = process.env.PICLAW_OOBE_TEST_CONTAINER || `piclaw-oobe-${Date.now()}`;
const DEFAULT_TIMEOUT_MS = Number(process.env.PICLAW_OOBE_TEST_TIMEOUT_MS || 120000);
const DEFAULT_SKIP_BUILD = process.env.PICLAW_OOBE_TEST_SKIP_BUILD === '1';
const DEFAULT_HEADLESS = process.env.PICLAW_OOBE_TEST_HEADLESS !== '0';

function log(message: string, ...rest: unknown[]) {
  console.log(`[oobe-local-container] ${message}`, ...rest);
}

function fail(message: string): never {
  throw new Error(message);
}

function isClosedTargetError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /Target page, context or browser has been closed/i.test(message);
}

function parseArgs(argv: string[]) {
  const args = {
    image: DEFAULT_IMAGE,
    containerName: DEFAULT_CONTAINER_NAME,
    timeoutMs: DEFAULT_TIMEOUT_MS,
    skipBuild: DEFAULT_SKIP_BUILD,
    headless: DEFAULT_HEADLESS,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const value = argv[i];
    const next = i + 1 < argv.length ? argv[i + 1] : '';
    if (value === '--image' && next) {
      args.image = next;
      i += 1;
      continue;
    }
    if (value === '--container-name' && next) {
      args.containerName = next;
      i += 1;
      continue;
    }
    if (value === '--timeout-ms' && next) {
      args.timeoutMs = Number(next);
      i += 1;
      continue;
    }
    if (value === '--skip-build') {
      args.skipBuild = true;
      continue;
    }
    if (value === '--headed') {
      args.headless = false;
      continue;
    }
  }

  if (!Number.isFinite(args.timeoutMs) || args.timeoutMs < 1000) {
    fail(`Invalid --timeout-ms value: ${args.timeoutMs}`);
  }

  return args;
}

function createTempHarnessRoot() {
  const base = mkdtempSync(join(tmpdir(), 'piclaw-oobe-local-container-'));
  const configDir = join(base, 'config');
  const workspaceDir = join(base, 'workspace');
  mkdirSync(configDir, { recursive: true });
  mkdirSync(workspaceDir, { recursive: true });
  // Keep the mounted directories explicit so the runtime has writable roots.
  writeFileSync(join(workspaceDir, '.gitkeep'), '');
  return { base, configDir, workspaceDir };
}

async function getFreePort(): Promise<number> {
  const { createServer } = await import('node:net');
  return await new Promise((resolvePort, reject) => {
    const server = createServer();
    server.unref();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        server.close();
        reject(new Error('Could not resolve a free port.'));
        return;
      }
      server.close((error) => {
        if (error) reject(error);
        else resolvePort(address.port);
      });
    });
  });
}

function runCommand(args: string[], options: { cwd?: string; allowFailure?: boolean; quiet?: boolean } = {}) {
  const proc = Bun.spawnSync({
    cmd: args,
    cwd: options.cwd,
    stdout: 'pipe',
    stderr: 'pipe',
    env: process.env,
  });
  const stdout = proc.stdout.toString().trim();
  const stderr = proc.stderr.toString().trim();
  if (proc.exitCode !== 0 && !options.allowFailure) {
    throw new Error([
      `Command failed: ${args.join(' ')}`,
      stdout && `stdout:\n${stdout}`,
      stderr && `stderr:\n${stderr}`,
    ].filter(Boolean).join('\n\n'));
  }
  if (!options.quiet && stdout) process.stdout.write(`${stdout}\n`);
  if (!options.quiet && stderr) process.stderr.write(`${stderr}\n`);
  return { exitCode: proc.exitCode, stdout, stderr };
}

async function waitForHttp(url: string, timeoutMs: number) {
  const started = Date.now();
  let lastError = '';
  while (Date.now() - started < timeoutMs) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
      lastError = `HTTP ${response.status}`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await Bun.sleep(500);
  }
  throw new Error(`Timed out waiting for ${url} (${lastError || 'no response'})`);
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) fail(message);
}

async function assertPanelVisible(page, kind: 'provider-missing' | 'provider-ready') {
  const locator = page.locator(`.oobe-panel-${kind}`);
  await locator.waitFor({ state: 'visible', timeout: 15000 });
  return locator;
}

async function assertPanelHidden(page) {
  await page.waitForFunction(() => !document.querySelector('.oobe-panel'), undefined, { timeout: 15000 });
}

async function captureFailureArtifacts(page, options: {
  artifactDir: string;
  stamp: string;
  label: string;
  interceptedModelRequests?: string[];
  modelResponses?: Array<{ url: string; status: number; body?: string }>;
}) {
  const { artifactDir, stamp, label, interceptedModelRequests = [], modelResponses = [] } = options;
  const screenshotPath = join(artifactDir, `${label}-${stamp}-failure.png`);
  const htmlPath = join(artifactDir, `${label}-${stamp}-dom.html`);
  const statePath = join(artifactDir, `${label}-${stamp}-state.json`);
  const bodyTextPath = join(artifactDir, `${label}-${stamp}-body.txt`);

  try {
    await page.screenshot({ path: screenshotPath, fullPage: true });
  } catch (error) {
    log(`Failed to capture screenshot artifact: ${screenshotPath}`, error);
  }

  let html = '';
  let state: Record<string, unknown> = {};
  let bodyText = '';
  try {
    html = await page.content();
    bodyText = await page.locator('body').textContent() || '';
    state = await page.evaluate(({ missingKey, readyKey }) => ({
      url: window.location.href,
      title: document.title,
      bodyClasses: document.body?.className || '',
      hasOobePanel: Boolean(document.querySelector('.oobe-panel')),
      oobePanelClass: document.querySelector('.oobe-panel')?.className || null,
      oobePanelText: document.querySelector('.oobe-panel')?.textContent || null,
      textareaValue: document.querySelector('textarea')?.value || null,
      providerMissingDismissed: localStorage.getItem(missingKey),
      providerReadyCompleted: localStorage.getItem(readyKey),
    }), {
      missingKey: OOBE_PROVIDER_MISSING_DISMISSED_KEY,
      readyKey: OOBE_PROVIDER_READY_COMPLETED_KEY,
    });
  } catch (error) {
    state = {
      stateCaptureError: error instanceof Error ? error.message : String(error),
    };
  }

  writeFileSync(htmlPath, html);
  writeFileSync(bodyTextPath, bodyText);
  writeFileSync(statePath, JSON.stringify({
    ...state,
    interceptedModelRequests,
    modelResponses,
  }, null, 2));
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const repoRoot = resolve(import.meta.dir, '..', '..', '..');
  const harness = createTempHarnessRoot();
  const artifactDir = resolve(repoRoot, 'artifacts', 'oobe-local-container');
  mkdirSync(artifactDir, { recursive: true });
  const currentWebDistDir = resolve(repoRoot, 'runtime', 'web', 'static', 'dist');
  const containerWebDistDir = '/usr/local/lib/bun/install/global/node_modules/piclaw/runtime/web/static/dist';
  const stamp = new Date().toISOString().replace(/[.:]/g, '-');
  const hostPort = await getFreePort();
  const baseUrl = `http://127.0.0.1:${hostPort}`;

  let browser = null;
  let runFailed = false;
  const cleanup = async () => {
    try {
      if (runFailed) {
        const containerLogs = runCommand(['docker', 'logs', args.containerName], { allowFailure: true, quiet: true });
        if (containerLogs.stdout || containerLogs.stderr) {
          writeFileSync(join(artifactDir, `container-logs-${stamp}.txt`), [containerLogs.stdout, containerLogs.stderr].filter(Boolean).join('\n'));
        }
      }
      runCommand(['docker', 'rm', '-f', args.containerName], { allowFailure: true, quiet: true });
    } catch (error) {
      log(`Cleanup failed while removing container ${args.containerName}`, error);
    }
    try {
      await browser?.close();
    } catch (error) {
      log('Cleanup failed while closing browser', error);
    }
    rmSync(harness.base, { recursive: true, force: true });
  };

  process.on('SIGINT', async () => {
    await cleanup();
    process.exit(130);
  });

  try {
    if (!args.skipBuild) {
      log(`Building local image ${args.image}...`);
      runCommand(['docker', 'build', '-q', '-t', args.image, '.'], { cwd: repoRoot });
    } else {
      log(`Skipping image build, using ${args.image}`);
    }

    log(`Starting local container ${args.containerName} on ${baseUrl} ...`);
    runCommand([
      'docker', 'run', '-d', '--rm',
      '--name', args.containerName,
      '-p', `${hostPort}:8080`,
      '-e', 'PICLAW_WEB_PORT=8080',
      '-e', 'PICLAW_AUTOSTART=1',
      '-v', `${harness.configDir}:/config`,
      '-v', `${harness.workspaceDir}:/workspace`,
      '-v', `${currentWebDistDir}:${containerWebDistDir}:ro`,
      args.image,
    ], { quiet: true });

    await waitForHttp(`${baseUrl}/`, args.timeoutMs);
    browser = await chromium.launch({ headless: args.headless });

    log('Scenario 1: provider-missing OOBE panel and dismiss persistence');
    {
      const context = await browser.newContext();
      const page = await context.newPage();
      const interceptedModelRequests: string[] = [];
      const modelResponses: Array<{ url: string; status: number; body?: string }> = [];
      const providerMissingPayload = JSON.stringify({
        current: null,
        models: [],
        model_options: [],
        thinking_level: null,
        supports_thinking: false,
        provider_usage: null,
      });
      await page.route('**/agent/models*', async (route) => {
        interceptedModelRequests.push(route.request().url());
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: providerMissingPayload,
        });
      });
      page.on('response', async (response) => {
        if (!response.url().includes('/agent/models')) return;
        let body = '';
        try {
          body = await response.text();
        } catch (error) {
          if (!isClosedTargetError(error)) {
            log(`Failed to read intercepted /agent/models response body for ${response.url()}`, error);
          }
        }
        modelResponses.push({ url: response.url(), status: response.status(), body });
      });

      try {
        await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
        await page.waitForSelector('textarea', { timeout: 15000 });
        const panel = await assertPanelVisible(page, 'provider-missing');
        const text = (await panel.textContent()) || '';
        assert(text.includes('Connect an AI provider'), 'Provider-missing OOBE title missing.');
        assert(text.includes('not web-app sign-in'), 'Provider-missing copy should distinguish provider setup from app sign-in.');

        const providerMissingScreenshot = join(artifactDir, `oobe-provider-missing-${stamp}.png`);
        await page.screenshot({ path: providerMissingScreenshot, fullPage: true });

        await page.getByRole('button', { name: 'Set up with /login' }).click();
        await page.waitForFunction(() => {
          const textarea = document.querySelector('textarea');
          return Boolean(textarea && 'value' in textarea && textarea.value === '/login');
        }, undefined, { timeout: 15000 });

        await page.getByRole('button', { name: 'Dismiss' }).click();
        await assertPanelHidden(page);
        const dismissedValue = await page.evaluate((key) => localStorage.getItem(key), OOBE_PROVIDER_MISSING_DISMISSED_KEY);
        assert(dismissedValue === 'true', 'Provider-missing dismiss state did not persist to localStorage.');

        await page.reload({ waitUntil: 'domcontentloaded' });
        await page.waitForSelector('textarea', { timeout: 15000 });
        await assertPanelHidden(page);
      } catch (error) {
        runFailed = true;
        await captureFailureArtifacts(page, {
          artifactDir,
          stamp,
          label: 'provider-missing',
          interceptedModelRequests,
          modelResponses,
        });
        throw error;
      } finally {
        await context.close();
      }
    }

    log('Scenario 2: provider-ready OOBE panel and completion persistence');
    {
      const context = await browser.newContext();
      const page = await context.newPage();
      const interceptedModelRequests: string[] = [];
      const modelResponses: Array<{ url: string; status: number; body?: string }> = [];
      const providerReadyPayload = JSON.stringify({
        current: null,
        models: ['openai/gpt-4.1'],
        model_options: [{
          label: 'openai/gpt-4.1',
          provider: 'openai',
          id: 'gpt-4.1',
          name: 'GPT 4.1',
          context_window: 128000,
          reasoning: true,
        }],
        thinking_level: null,
        supports_thinking: true,
        provider_usage: null,
      });
      await page.route('**/agent/models*', async (route) => {
        interceptedModelRequests.push(route.request().url());
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: providerReadyPayload,
        });
      });
      page.on('response', async (response) => {
        if (!response.url().includes('/agent/models')) return;
        let body = '';
        try {
          body = await response.text();
        } catch (error) {
          if (!isClosedTargetError(error)) {
            log(`Failed to read intercepted /agent/models response body for ${response.url()}`, error);
          }
        }
        modelResponses.push({ url: response.url(), status: response.status(), body });
      });

      try {
        await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
        await page.waitForSelector('textarea', { timeout: 15000 });
        const panel = await assertPanelVisible(page, 'provider-ready');
        const text = (await panel.textContent()) || '';
        assert(text.includes('You’re ready to chat'), 'Provider-ready OOBE title missing.');
        assert(text.includes('Try /model'), 'Provider-ready next-step CTA missing.');

        const providerReadyScreenshot = join(artifactDir, `oobe-provider-ready-${stamp}.png`);
        await page.screenshot({ path: providerReadyScreenshot, fullPage: true });

        await page.getByRole('button', { name: 'Try /model' }).click();
        await page.waitForFunction(() => {
          const textarea = document.querySelector('textarea');
          return Boolean(textarea && 'value' in textarea && textarea.value === '/model');
        }, undefined, { timeout: 15000 });

        await page.getByRole('button', { name: 'Got it' }).click();
        await assertPanelHidden(page);
        const completedValue = await page.evaluate((key) => localStorage.getItem(key), OOBE_PROVIDER_READY_COMPLETED_KEY);
        assert(completedValue === 'true', 'Provider-ready completion state did not persist to localStorage.');

        await page.reload({ waitUntil: 'domcontentloaded' });
        await page.waitForSelector('textarea', { timeout: 15000 });
        await assertPanelHidden(page);
      } catch (error) {
        runFailed = true;
        await captureFailureArtifacts(page, {
          artifactDir,
          stamp,
          label: 'provider-ready',
          interceptedModelRequests,
          modelResponses,
        });
        throw error;
      } finally {
        await context.close();
      }
    }

    log('All local-container OOBE scenarios passed.');
    log(`Base URL: ${baseUrl}`);
    log(`Container image: ${args.image}`);
    log(`Mounted temp root: ${harness.base}`);
    log(`Artifacts written under: ${artifactDir}`);
  } finally {
    await cleanup();
  }
}

await main();
