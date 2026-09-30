import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import '../helpers.js';
import { initDatabase } from '../../src/db.js';
import { getRuntimeVersions } from '../../src/core/runtime-versions.js';
import { getVersion } from '../../src/cli.js';
import { handleAgentRoutes } from '../../src/channels/web/http/dispatch-agent.js';

test('About reports installed package and running Bun versions, not dependency ranges', () => {
  const metadata = JSON.parse(readFileSync(resolve(dirname(fileURLToPath(import.meta.resolve('@earendil-works/pi-ai'))), '../package.json'), 'utf8'));
  expect(getRuntimeVersions()).toEqual({ piclaw: getVersion(), piAi: metadata.version, bun: Bun.version });
  expect(getRuntimeVersions().piAi).not.toBe('unknown');
});

test('About and General settings return exactly the same three core versions', async () => {
  initDatabase();
  const channel = { json: (body: unknown) => Response.json(body) } as any;
  const request = (path: string) => {
    const req = new Request(`https://example.test${path}`);
    return handleAgentRoutes(channel, req, path, new URL(req.url));
  };
  const about = await (await request('/agent/about'))!.json();
  const settings = await (await request('/agent/settings-data'))!.json();
  expect(Object.keys(about).sort()).toEqual(['bun', 'piAi', 'piclaw']);
  expect(about).toEqual(getRuntimeVersions());
  expect(settings.runtimeVersions).toEqual(about);
  expect(settings.version).toBe(about.piclaw);
  const post = new Request('https://example.test/agent/about', { method: 'POST' });
  expect(await handleAgentRoutes(channel, post, '/agent/about', new URL(post.url))).toBeNull();
});
