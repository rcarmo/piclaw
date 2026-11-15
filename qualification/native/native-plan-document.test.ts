import './src/test-guard.js';
import { expect, test } from 'bun:test';
import { join } from 'node:path';
import { createSession, MemoryStorage } from '../../runtime/durable-engine/qualification/durable.js';
import { BACKGROUND_CONTEXT as context } from '../../runtime/durable-engine/qualification/context.js';
import { SqliteStorage } from '../../runtime/durable-engine/qualification/sqlite.js';
import { BunSqliteDatabase } from '../../runtime/durable-engine/src/bun-sqlite.js';
import { PlanDoc, type PlanDocument } from '../../runtime/durable-engine/src/plan-document.js';
import { createTempWorkspace } from '../../runtime/test/helpers.js';

const seed = (chat = 'web:default', markdown = '- [ ] original'): PlanDocument => ({ chat_jid: chat, markdown, updated_at: '2026-11-14T00:00:00.000Z' });

test('native Plan snapshot is non-creating and SDK initial seed is detached', async () => {
  const session = createSession(new MemoryStorage());
  try {
    expect(await session.snapshot(PlanDoc, 'web:default', context)).toBeUndefined();
    const legacy = seed();
    await session.commit(async tx => { await tx.doc(PlanDoc, 'web:default', legacy); }, context);
    legacy.markdown = 'external mutable source';
    expect(await session.snapshot(PlanDoc, 'web:default', context)).toEqual(seed());
    await session.commit(async tx => { await tx.doc(PlanDoc, 'web:default', seed('web:default', 'stale adoption')); }, context);
    expect(await session.snapshot(PlanDoc, 'web:default', context)).toEqual(seed());
  } finally { await session.close(context); }
});

test('native Plan family preserves exact parent and branch keys', async () => {
  const session = createSession(new MemoryStorage());
  const branch = 'web:default:branch:one';
  try {
    await session.commit(async tx => {
      await tx.doc(PlanDoc, 'web:default', seed());
      await tx.doc(PlanDoc, branch, seed(branch, '- [-] branch only'));
    }, context);
    expect(await session.snapshot(PlanDoc, 'web:default', context)).toEqual(seed());
    expect(await session.snapshot(PlanDoc, branch, context)).toEqual(seed(branch, '- [-] branch only'));
    expect(await session.snapshot(PlanDoc, 'web:default:branch:two', context)).toBeUndefined();
  } finally { await session.close(context); }
});

test('native Plan mutations roll back without ending SDK ownership', async () => {
  const session = createSession(new MemoryStorage());
  try {
    await session.commit(async tx => { await tx.doc(PlanDoc, 'web:default', seed()); }, context);
    await expect(session.commit(async tx => {
      const plan = await tx.doc(PlanDoc, 'web:default', seed());
      plan.markdown = 'must roll back';
      throw Error('expected rollback');
    }, context)).rejects.toThrow('expected rollback');
    expect(await session.snapshot(PlanDoc, 'web:default', context)).toEqual(seed());
    await session.commit(async tx => { (await tx.doc(PlanDoc, 'web:default', seed())).markdown = '- [x] committed'; }, context);
    expect((await session.snapshot(PlanDoc, 'web:default', context))?.markdown).toBe('- [x] committed');
  } finally { await session.close(context); }
});

test('SDK serialises concurrent Plan changes on its own mutation line', async () => {
  const session = createSession(new MemoryStorage());
  let enter!: () => void, release!: () => void;
  const entered = new Promise<void>(resolve => { enter = resolve; });
  const held = new Promise<void>(resolve => { release = resolve; });
  let secondEntered = false;
  try {
    const first = session.commit(async tx => {
      const plan = await tx.doc(PlanDoc, 'web:default', seed());
      enter(); await held;
      plan.markdown += '\n- [ ] first';
    }, context);
    await entered;
    const second = session.commit(async tx => {
      secondEntered = true;
      const plan = await tx.doc(PlanDoc, 'web:default', seed());
      plan.markdown += '\n- [ ] second';
    }, context);
    await Bun.sleep(5);
    expect(secondEntered).toBe(false);
    release(); await Promise.all([first, second]);
    expect((await session.snapshot(PlanDoc, 'web:default', context))?.markdown).toBe('- [ ] original\n- [ ] first\n- [ ] second');
  } finally { release(); await session.close(context); }
});

test('native Plan document survives actual SQLite close and reopen without an addon', async () => {
  const workspace = createTempWorkspace('native-plan-doc-');
  const file = join(workspace.base, 'plan.sqlite');
  let session = createSession(await SqliteStorage.open(new BunSqliteDatabase(file)));
  try {
    await session.commit(async tx => { await tx.doc(PlanDoc, 'web:default', seed()); }, context);
    await session.close(context);
    session = createSession(await SqliteStorage.open(new BunSqliteDatabase(file)));
    expect(await session.snapshot(PlanDoc, 'web:default', context)).toEqual(seed());
    await session.commit(async tx => { (await tx.doc(PlanDoc, 'web:default', seed())).markdown = '- [x] reopened'; }, context);
    expect((await session.snapshot(PlanDoc, 'web:default', context))?.markdown).toBe('- [x] reopened');
  } finally { await session.close(context); workspace.cleanup(); }
});
