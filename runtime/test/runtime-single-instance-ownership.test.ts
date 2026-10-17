import { expect, test } from 'bun:test';
import { spawn } from 'child_process';
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, symlinkSync, writeFileSync } from 'fs';
import { join } from 'path';
import { acquireRuntimeLock, createDefaultRuntimeProcessInspector, type RuntimeProcessInspector } from '../src/runtime/single-instance.js';
import { addLogSink, removeLogSink, type LogRecord } from '../src/utils/logger.js';

function fixture() {
  const dir = mkdtempSync('/tmp/piclaw-lock-ownership-');
  const lockPath = join(dir, 'runtime.lock');
  const inspector: RuntimeProcessInspector = {
    pid: 9999, now: () => new Date('2026-05-18T16:00:00Z'),
    isAlive: () => false,
    bootId: () => 'test-boot', processStart: () => '12345',
  };
  return { dir, lockPath, inspector, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

function withFixture(run: (f: ReturnType<typeof fixture>) => void) {
  const f = fixture();
  try { run(f); } finally { f.cleanup(); }
}

test('strict current exact-token capability is enabled, immutable and released idempotently', () => withFixture(f => {
  const handle = acquireRuntimeLock({ ...f, disabled: false, strictOwnership: true });
  try {
    expect(handle.enabled).toBe(true);
    expect(handle.strictOwnership).toBe(true);
    expect(Object.isFrozen(handle)).toBe(true);
    expect(Object.isFrozen(handle.record)).toBe(true);
    expect(handle.record.nonce).toBeTruthy();
    expect(JSON.parse(readFileSync(f.lockPath, 'utf8'))).toEqual(handle.record);
    expect(lstatSync(f.lockPath).mode & 0o777).toBe(0o600);
    handle.assertCurrentOwner();
  } finally { handle.release(); }
  handle.release();
  expect(existsSync(f.lockPath)).toBe(false);
  expect(() => handle.assertCurrentOwner()).toThrow(/ownership lost/);
}));

test('disabled and legacy handles cannot qualify durable ownership', () => withFixture(f => {
  const disabled = acquireRuntimeLock({ ...f, disabled: true });
  expect(disabled.enabled).toBe(false);
  expect(() => disabled.assertCurrentOwner()).toThrow(/disabled/);
  disabled.release();
  expect(existsSync(f.lockPath)).toBe(false);
  expect(() => acquireRuntimeLock({ ...f, disabled: true, strictOwnership: true })).toThrow(/enabled/);
  const legacy = acquireRuntimeLock({ ...f, disabled: false, strictOwnership: false });
  try { expect(() => legacy.assertCurrentOwner()).toThrow(/strict/); } finally { legacy.release(); }
}));

for (const identity of ['missing', 'empty', 'inaccessible'] as const) {
  test(`strict fails closed with ${identity} boot/start; legacy still works`, () => withFixture(f => {
    for (const field of ['bootId', 'processStart'] as const) {
      const inspector = { ...f.inspector, [field]: identity === 'missing' ? undefined : identity === 'empty' ? () => '' : () => { throw new Error('EACCES'); } };
      expect(() => acquireRuntimeLock({ ...f, inspector, disabled: false, strictOwnership: true })).toThrow();
      expect(existsSync(f.lockPath)).toBe(false);
      const legacy = acquireRuntimeLock({ ...f, inspector, disabled: false });
      try { expect(() => legacy.assertCurrentOwner()).toThrow(/strict/); } finally { legacy.release(); }
    }
  }));
}

for (const raw of ['broken', '{}', JSON.stringify({ pid: 4242 }), JSON.stringify({ pid: 4242, bootId: 'old-boot', processStart: '1', nonce: 'old' })]) {
  test(`strict never steals existing lock: ${raw}`, () => withFixture(f => {
    writeFileSync(f.lockPath, raw);
    expect(() => acquireRuntimeLock({ ...f, disabled: false, strictOwnership: true })).toThrow(/refuses existing/);
    expect(readFileSync(f.lockPath, 'utf8')).toBe(raw);
  }));
}

test('all acquirers preserve existing partial, malformed and dead/reused-PID paths: recovery is offline only', () => withFixture(f => {
  // Intentional policy change: even proven stale records require operator cleanup.
  // No stale-read callback can unlink a newly published candidate winner.
  for (const raw of ['', 'broken', '{}', JSON.stringify({ pid: 4242 }), JSON.stringify({ pid: 4242, nonce: 'dead-strict' })]) {
    writeFileSync(f.lockPath, raw);
    const before = lstatSync(f.lockPath);
    for (const strictOwnership of [false, true]) {
      for (const maintenance of [false, true]) {
        const inspector = { ...f.inspector, isAlive: () => { throw new Error('must not probe or authorize stale cleanup'); } };
        expect(() => acquireRuntimeLock({ ...f, inspector, disabled: false, strictOwnership, maintenance })).toThrow(/Offline operator cleanup required/);
        expect(lstatSync(f.lockPath).ino).toBe(before.ino);
        expect(lstatSync(f.lockPath).dev).toBe(before.dev);
        expect(readFileSync(f.lockPath, 'utf8')).toBe(raw);
      }
    }
  }
}));

for (const field of ['pid', 'startedAt', 'workspace', 'command', 'bootId', 'processStart', 'nonce'] as const) {
  test(`same-inode record tamper (${field}) revokes capability and prevents release unlink`, () => withFixture(f => {
    const handle = acquireRuntimeLock({ ...f, disabled: false, strictOwnership: true });
    const replacement = JSON.stringify({ ...handle.record, [field]: field === 'pid' ? 9999 : 'changed' });
    // PID case deliberately retains the same PID but changes raw token representation.
    writeFileSync(f.lockPath, replacement);
    expect(() => handle.assertCurrentOwner()).toThrow(/ownership lost/);
    handle.release();
    expect(readFileSync(f.lockPath, 'utf8')).toBe(replacement);
  }));
}

for (const replacement of ['inode', 'symlink'] as const) {
  test(`byte-identical replacement ${replacement} is not authority and release leaves it alone`, () => withFixture(f => {
    const handle = acquireRuntimeLock({ ...f, disabled: false, strictOwnership: true });
    const raw = readFileSync(f.lockPath, 'utf8');
    renameSync(f.lockPath, join(f.dir, 'original'));
    if (replacement === 'inode') writeFileSync(f.lockPath, raw);
    else symlinkSync(join(f.dir, 'original'), f.lockPath);
    expect(() => handle.assertCurrentOwner()).toThrow(/ownership lost/);
    handle.release();
    expect(readFileSync(f.lockPath, 'utf8')).toBe(raw);
    expect(readFileSync(join(f.dir, 'original'), 'utf8')).toBe(raw);
  }));
}

test('missing path and changed/inaccessible current process identity revoke authority', () => withFixture(f => {
  for (const field of ['bootId', 'processStart', 'pid', 'path'] as const) {
    const inspector = { ...f.inspector };
    const handle = acquireRuntimeLock({ ...f, inspector, disabled: false, strictOwnership: true });
    if (field === 'pid') inspector.pid++;
    else if (field === 'path') rmSync(f.lockPath);
    else inspector[field] = () => { throw new Error('identity unavailable'); };
    expect(() => handle.assertCurrentOwner()).toThrow(/ownership lost/);
    handle.release();
  }
}));

test('same-PID reacquisition gets a new nonce and cannot revive the released capability', () => withFixture(f => {
  const first = acquireRuntimeLock({ ...f, disabled: false, strictOwnership: true });
  first.release();
  const second = acquireRuntimeLock({ ...f, disabled: false, strictOwnership: true });
  try {
    expect(second.record.pid).toBe(first.record.pid);
    expect(second.record.nonce).not.toBe(first.record.nonce);
    expect(() => first.assertCurrentOwner()).toThrow();
    first.release();
    second.assertCurrentOwner();
  } finally { second.release(); }
}));

for (const field of ['bootId', 'processStart'] as const) {
  test(`changed current ${field} loses authority despite unchanged PID and file`, () => withFixture(f => {
    const inspector = { ...f.inspector };
    const handle = acquireRuntimeLock({ ...f, inspector, disabled: false, strictOwnership: true });
    try {
      inspector[field] = () => 'different';
      expect(() => handle.assertCurrentOwner()).toThrow(/ownership lost/);
    } finally { handle.release(); }
  }));
}

test('strict refuses existing directories and dangling symlinks without changing them', () => withFixture(f => {
  mkdirSync(f.lockPath);
  expect(() => acquireRuntimeLock({ ...f, disabled: false, strictOwnership: true })).toThrow(/refuses existing/);
  expect(lstatSync(f.lockPath).isDirectory()).toBe(true);
  rmSync(f.lockPath, { recursive: true });
  symlinkSync(join(f.dir, 'absent'), f.lockPath);
  expect(() => acquireRuntimeLock({ ...f, disabled: false, strictOwnership: true })).toThrow(/refuses existing/);
  expect(lstatSync(f.lockPath).isSymbolicLink()).toBe(true);
}));

test('release logs suppressed verification failure instead of silently swallowing it', () => withFixture(f => {
  const records: LogRecord[] = [];
  const sink = (record: LogRecord) => { records.push(record); };
  const handle = acquireRuntimeLock({ ...f, disabled: false });
  const previousLevel = process.env.PICLAW_LOG_LEVEL;
  process.env.PICLAW_LOG_LEVEL = 'debug';
  addLogSink(sink);
  try {
    rmSync(f.lockPath);
    handle.release();
    expect(records.some(record => record.module === 'single-instance' && record.level === 'debug' && record.suppressed === true && !!record.err)).toBe(true);
  } finally {
    removeLogSink(sink);
    if (previousLevel === undefined) delete process.env.PICLAW_LOG_LEVEL;
    else process.env.PICLAW_LOG_LEVEL = previousLevel;
    handle.release();
  }
}));

test('multiprocess O_EXCL publication: ordinary legacy acquirer never deletes partial strict owner', async () => {
  const f = fixture();
  const modulePath = new URL('../src/runtime/single-instance.ts', import.meta.url).pathname;
  // Pause the real strict acquisition at its first write, after O_EXCL created
  // the path. Only the child's fs module is injected; production has no hook.
  const child = spawn(process.execPath, ['-e', `
    import { mock } from 'bun:test';
    import * as fs from 'fs';
    const realWrite = fs.writeSync;
    mock.module('fs', () => ({ ...fs, writeSync(...args) {
      console.log('opened');
      fs.readSync(0, Buffer.alloc(1), 0, 1, null);
      return realWrite(...args);
    } }));
    const { acquireRuntimeLock } = await import(${JSON.stringify(modulePath)});
    const h = acquireRuntimeLock({ lockPath: ${JSON.stringify(f.lockPath)}, disabled: false, strictOwnership: true });
    h.assertCurrentOwner(); console.log('owner');
    fs.readSync(0, Buffer.alloc(1), 0, 1, null);
    h.assertCurrentOwner(); h.release();
  `], { stdio: ['pipe', 'pipe', 'pipe'] });
  const exited = new Promise<number | null>(resolve => child.once('exit', resolve));
  let output = '';
  let errors = '';
  child.stdout.on('data', data => { output += data.toString(); });
  child.stderr.on('data', data => { errors += data.toString(); });
  const waitFor = async (text: string) => {
    for (let i = 0; i < 300 && !output.includes(text); i++) {
      if (child.exitCode !== null) throw new Error(`child exited: ${errors}`);
      await Bun.sleep(5);
    }
    expect(output).toContain(text);
  };
  try {
    await waitFor('opened');
    const before = lstatSync(f.lockPath);
    expect(readFileSync(f.lockPath, 'utf8')).toBe('');
    for (const strictOwnership of [false, true]) {
      expect(() => acquireRuntimeLock({ lockPath: f.lockPath, disabled: false, strictOwnership })).toThrow(/Offline operator cleanup required/);
      expect(lstatSync(f.lockPath).ino).toBe(before.ino);
      expect(readFileSync(f.lockPath, 'utf8')).toBe('');
    }
    child.stdin.write('w');
    await waitFor('owner');
    const raw = readFileSync(f.lockPath, 'utf8');
    expect(JSON.parse(raw).pid).toBe(child.pid);
    expect(JSON.parse(raw).nonce).toBeTruthy();
    expect(lstatSync(f.lockPath).ino).toBe(before.ino);
    expect(() => acquireRuntimeLock({ lockPath: f.lockPath, disabled: false })).toThrow(/refuses existing/);
    expect(readFileSync(f.lockPath, 'utf8')).toBe(raw);
    child.stdin.write('r');
    expect(await exited).toBe(0);
    expect(existsSync(f.lockPath)).toBe(false);
  } finally {
    child.kill('SIGKILL');
    await exited;
    f.cleanup();
  }
}, 5000);

test('real strict child owner remains excluded while SIGSTOPped, and stale strict lock is never stolen', async () => {
  const f = fixture();
  const modulePath = new URL('../src/runtime/single-instance.ts', import.meta.url).pathname;
  const child = spawn(process.execPath, ['-e', `import { acquireRuntimeLock } from ${JSON.stringify(modulePath)}; const h = acquireRuntimeLock({ lockPath: ${JSON.stringify(f.lockPath)}, disabled: false, strictOwnership: true }); h.assertCurrentOwner(); console.log('ready'); setInterval(() => {}, 1000);`], { stdio: ['ignore', 'pipe', 'pipe'] });
  const exited = new Promise<void>(resolve => child.once('exit', () => resolve()));
  try {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('child startup timed out')), 3000);
      child.stdout.once('data', () => { clearTimeout(timer); resolve(); });
      child.once('error', error => { clearTimeout(timer); reject(error); });
      child.once('exit', code => { clearTimeout(timer); reject(new Error(`child exited ${code}`)); });
    });
    const raw = readFileSync(f.lockPath, 'utf8');
    child.kill('SIGSTOP');
    for (let attempt = 0; attempt < 100; attempt++) {
      if (/^State:\s+T/m.test(readFileSync(`/proc/${child.pid}/status`, 'utf8'))) break;
      await Bun.sleep(5);
    }
    expect(readFileSync(`/proc/${child.pid}/status`, 'utf8')).toMatch(/^State:\s+T/m);
    const inspector = createDefaultRuntimeProcessInspector();
    expect(inspector.isAlive(child.pid!)).toBe(true);
    expect(() => acquireRuntimeLock({ lockPath: f.lockPath, disabled: false, strictOwnership: true })).toThrow(/refuses existing/);
    expect(() => acquireRuntimeLock({ lockPath: f.lockPath, disabled: false })).toThrow(/already running/);
    expect(readFileSync(f.lockPath, 'utf8')).toBe(raw);
    child.kill('SIGKILL');
    await exited;
    expect(() => acquireRuntimeLock({ lockPath: f.lockPath, disabled: false, strictOwnership: true })).toThrow(/refuses existing/);
    expect(() => acquireRuntimeLock({ lockPath: f.lockPath, disabled: false })).toThrow(/Offline operator cleanup required/);
    expect(readFileSync(f.lockPath, 'utf8')).toBe(raw);
  } finally {
    child.kill('SIGKILL');
    await exited;
    f.cleanup();
  }
}, 5000);
