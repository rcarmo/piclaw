import { expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'fs';
import { join, resolve } from 'path';

import { createTempWorkspace } from '../../../helpers.js';

test('buildAvatarResponse keeps serving the cached avatar when a new source cannot be loaded', () => {
  const ws = createTempWorkspace('piclaw-avatar-test-');

  try {
    const avatarsDir = join(ws.workspace, '.piclaw', 'avatars');
    mkdirSync(avatarsDir, { recursive: true });

    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wn1s3sAAAAASUVORK5CYII=',
      'base64',
    );
    const cachedFile = join(avatarsDir, 'agent.png');
    writeFileSync(cachedFile, png);
    writeFileSync(
      join(avatarsDir, 'agent.json'),
      `${JSON.stringify({
        source: join(ws.workspace, 'avatars', 'agent.png'),
        file: cachedFile,
        contentType: 'image/png',
        updatedAt: '2026-03-24T00:00:00.000Z',
      }, null, 2)}\n`,
      'utf-8',
    );

    const script = `
      const avatarService = await import('./src/channels/web/media/avatar-service.js');
      const response = await avatarService.buildAvatarResponse(
        'agent',
        ${JSON.stringify(join(ws.workspace, 'missing-avatar.png'))},
        new Request('https://example.com/avatar/agent'),
      );
      if (!response) {
        console.log(JSON.stringify({ ok: false }));
        process.exit(0);
      }
      const body = new Uint8Array(await response.arrayBuffer());
      console.log(JSON.stringify({
        ok: true,
        status: response.status,
        contentType: response.headers.get('Content-Type'),
        cacheControl: response.headers.get('Cache-Control'),
        bodyLength: body.length,
      }));
    `;

    const result = spawnSync(process.execPath, ['-e', script], {
      cwd: resolve(import.meta.dir, '..', '..', '..', '..'),
      env: {
        ...process.env,
        PICLAW_WORKSPACE: ws.workspace,
        PICLAW_STORE: ws.store,
        PICLAW_DATA: ws.data,
        PICLAW_DB_IN_MEMORY: '1',
      },
      encoding: 'utf8',
    });

    expect(result.status).toBe(0);
    const output = JSON.parse(result.stdout.trim().split('\n').filter(Boolean).pop() || '{}');
    expect(output.ok).toBe(true);
    expect(output.status).toBe(200);
    expect(output.contentType).toBe('image/png');
    expect(output.cacheControl).toBe('no-store');
    expect(output.bodyLength).toBeGreaterThan(0);
  } finally {
    ws.cleanup();
  }
});

test('buildAvatarResponse rejects private-network remote avatar URLs before fetch', () => {
  const ws = createTempWorkspace('piclaw-avatar-private-test-');

  try {
    const script = `
      globalThis.fetch = async () => {
        console.log(JSON.stringify({ fetched: true }));
        return new Response('unexpected', { status: 500 });
      };
      const avatarService = await import('./src/channels/web/media/avatar-service.js');
      const response = await avatarService.buildAvatarResponse(
        'user',
        'http://127.0.0.1:9999/avatar.png',
        new Request('https://example.com/avatar/user'),
      );
      console.log(JSON.stringify({ ok: response === null }));
    `;

    const result = spawnSync(process.execPath, ['-e', script], {
      cwd: resolve(import.meta.dir, '..', '..', '..', '..'),
      env: {
        ...process.env,
        PICLAW_WORKSPACE: ws.workspace,
        PICLAW_STORE: ws.store,
        PICLAW_DATA: ws.data,
        PICLAW_DB_IN_MEMORY: '1',
      },
      encoding: 'utf8',
    });

    expect(result.status).toBe(0);
    const lines = result.stdout.trim().split('\n').filter(Boolean).map((line) => JSON.parse(line));
    expect(lines).toEqual([{ ok: true }]);
  } finally {
    ws.cleanup();
  }
});

test('buildAvatarResponse supports rasterized PNG size variants for install surfaces', () => {
  const ws = createTempWorkspace('piclaw-avatar-size-test-');

  try {
    const avatarsDir = join(ws.workspace, '.piclaw', 'avatars');
    mkdirSync(avatarsDir, { recursive: true });

    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wn1s3sAAAAASUVORK5CYII=',
      'base64',
    );
    const cachedFile = join(avatarsDir, 'agent.png');
    writeFileSync(cachedFile, png);
    writeFileSync(
      join(avatarsDir, 'agent.json'),
      `${JSON.stringify({
        source: join(ws.workspace, 'avatars', 'agent.png'),
        file: cachedFile,
        contentType: 'image/png',
        updatedAt: '2026-03-24T00:00:00.000Z',
      }, null, 2)}\n`,
      'utf-8',
    );

    const script = `
      const avatarService = await import('./src/channels/web/media/avatar-service.js');
      const response = await avatarService.buildAvatarResponse(
        'agent',
        ${JSON.stringify(join(ws.workspace, 'missing-avatar.png'))},
        new Request('https://example.com/avatar/agent?format=png&size=192'),
      );
      if (!response) {
        console.log(JSON.stringify({ ok: false }));
        process.exit(0);
      }
      const body = new Uint8Array(await response.arrayBuffer());
      console.log(JSON.stringify({
        ok: true,
        status: response.status,
        contentType: response.headers.get('Content-Type'),
        cacheControl: response.headers.get('Cache-Control'),
        bodyLength: body.length,
      }));
    `;

    const result = spawnSync(process.execPath, ['-e', script], {
      cwd: resolve(import.meta.dir, '..', '..', '..', '..'),
      env: {
        ...process.env,
        PICLAW_WORKSPACE: ws.workspace,
        PICLAW_STORE: ws.store,
        PICLAW_DATA: ws.data,
        PICLAW_DB_IN_MEMORY: '1',
      },
      encoding: 'utf8',
    });

    expect(result.status).toBe(0);
    const output = JSON.parse(result.stdout.trim().split('\n').filter(Boolean).pop() || '{}');
    expect(output.ok).toBe(true);
    expect(output.status).toBe(200);
    expect(output.contentType).toBe('image/png');
    expect(['no-cache', 'no-store']).toContain(output.cacheControl);
    expect(output.bodyLength).toBeGreaterThan(0);
  } finally {
    ws.cleanup();
  }
});
