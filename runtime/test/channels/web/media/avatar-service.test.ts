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
      'iVBORw0KGgoAAAANSUhEUgAAAAQAAAAECAYAAACp8Z5+AAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAEklEQVQImWP4z8DwHxkzkC4AADxAH+HdRw9wAAAAAElFTkSuQmCC',
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

test('buildAvatarResponse crops non-square install icons to fill square surfaces', () => {
  const ws = createTempWorkspace('piclaw-avatar-cover-test-');

  try {
    const avatarsDir = join(ws.workspace, '.piclaw', 'avatars');
    mkdirSync(avatarsDir, { recursive: true });

    const sourcePath = join(ws.workspace, 'avatars', 'wide.svg');
    const cachedFile = join(avatarsDir, 'agent.svg');
    writeFileSync(
      cachedFile,
      '<svg xmlns="http://www.w3.org/2000/svg" width="300" height="100"><rect width="300" height="100" fill="red"/></svg>',
      'utf-8',
    );
    writeFileSync(
      join(avatarsDir, 'agent.json'),
      `${JSON.stringify({
        source: sourcePath,
        file: cachedFile,
        contentType: 'image/svg+xml',
        updatedAt: '2026-05-03T00:00:00.000Z',
      }, null, 2)}\n`,
      'utf-8',
    );

    const script = `
      const sharp = (await import('sharp')).default;
      const avatarService = await import('./src/channels/web/media/avatar-service.js');
      const response = await avatarService.buildAvatarResponse(
        'agent',
        ${JSON.stringify(sourcePath)},
        new Request('https://example.com/avatar/agent?format=png&size=64'),
      );
      if (!response) {
        console.log(JSON.stringify({ ok: false }));
        process.exit(0);
      }
      const body = Buffer.from(await response.arrayBuffer());
      const image = await sharp(body).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
      const { width, height, channels } = image.info;
      const alphaAt = (x, y) => image.data[(y * width + x) * channels + 3];
      console.log(JSON.stringify({
        ok: true,
        status: response.status,
        contentType: response.headers.get('Content-Type'),
        width,
        height,
        cornerAlpha: [alphaAt(0, 0), alphaAt(width - 1, 0), alphaAt(0, height - 1), alphaAt(width - 1, height - 1)],
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
    expect(output.width).toBe(64);
    expect(output.height).toBe(64);
    expect(output.cornerAlpha).toEqual([255, 255, 255, 255]);
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
      'iVBORw0KGgoAAAANSUhEUgAAAAQAAAAECAYAAACp8Z5+AAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAEklEQVQImWP4z8DwHxkzkC4AADxAH+HdRw9wAAAAAElFTkSuQmCC',
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

test('buildAvatarResponse loads uploaded image avatars from /media id sources', () => {
  const ws = createTempWorkspace('piclaw-avatar-media-test-');

  try {
    const script = `
      const db = await import('./src/db.js');
      db.initDatabase();
      const avatarService = await import('./src/channels/web/media/avatar-service.js');
      const png = Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAQAAAAECAYAAACp8Z5+AAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAEklEQVQImWP4z8DwHxkzkC4AADxAH+HdRw9wAAAAAElFTkSuQmCC',
        'base64',
      );
      const id = db.createMedia('avatar.png', 'image/png', png, null, { test: true });
      const source = '/media/' + id + '?cache=1#avatar';
      const response = await avatarService.buildAvatarResponse(
        'user',
        source,
        new Request('https://example.com/avatar/user'),
      );
      if (!response) {
        console.log(JSON.stringify({ ok: false, id }));
        process.exit(0);
      }
      const body = new Uint8Array(await response.arrayBuffer());
      console.log(JSON.stringify({
        ok: true,
        id,
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
    expect(String(output.contentType).startsWith('image/')).toBe(true);
    expect(output.cacheControl).toBe('no-store');
    expect(output.bodyLength).toBeGreaterThan(0);
  } finally {
    ws.cleanup();
  }
});

test('buildAvatarResponse rejects non-image media avatar sources', () => {
  const ws = createTempWorkspace('piclaw-avatar-media-reject-test-');

  try {
    const script = `
      const db = await import('./src/db.js');
      db.initDatabase();
      const avatarService = await import('./src/channels/web/media/avatar-service.js');
      const id = db.createMedia('note.txt', 'text/plain', new TextEncoder().encode('not an image'), null, { test: true });
      const response = await avatarService.buildAvatarResponse(
        'agent',
        '/media/' + id,
        new Request('https://example.com/avatar/agent'),
      );
      console.log(JSON.stringify({ ok: response === null, id }));
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
  } finally {
    ws.cleanup();
  }
});

test('buildAvatarResponse serves the same image after migrating an inline avatar to a local source', () => {
  const ws = createTempWorkspace('piclaw-avatar-local-migration-');
  try {
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAQAAAAECAYAAACp8Z5+AAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAEklEQVQImWP4z8DwHxkzkC4AADxAH+HdRw9wAAAAAElFTkSuQmCC', 'base64');
    const source = join(ws.workspace, 'assistant-source.png');
    writeFileSync(source, png);
    const script = `
      const { buildAvatarResponse } = await import('./src/channels/web/media/avatar-service.js');
      const source = ${JSON.stringify(source)};
      const inline = 'data:image/png;base64,${png.toString('base64')}';
      const request = new Request('https://example.com/avatar/agent');
      const before = await buildAvatarResponse('agent', inline, request);
      const after = await buildAvatarResponse('agent', source, request);
      if (!before || !after) throw new Error('Avatar response missing');
      const a = Buffer.from(await before.arrayBuffer());
      const b = Buffer.from(await after.arrayBuffer());
      console.log(JSON.stringify({ status: after.status, type: after.headers.get('Content-Type'), same: a.equals(b), original: b.equals(Buffer.from('${png.toString('base64')}', 'base64')) }));
    `;
    const result = spawnSync(process.execPath, ['-e', script], {
      cwd: resolve(import.meta.dir, '..', '..', '..', '..'),
      env: { ...process.env, PICLAW_WORKSPACE: ws.workspace, PICLAW_STORE: ws.store, PICLAW_DATA: ws.data, PICLAW_DB_IN_MEMORY: '1' },
      encoding: 'utf8',
    });
    expect(result.status).toBe(0);
    // Avatar caching intentionally converts both sources to WebP.
    expect(JSON.parse(result.stdout.trim().split('\n').filter(Boolean).pop() || '{}')).toEqual({ status: 200, type: 'image/webp', same: true, original: false });
  } finally {
    ws.cleanup();
  }
});
