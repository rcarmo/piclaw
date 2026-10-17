/**
 * test/runtime-single-instance.test.ts – runtime lock regression tests.
 */

import { expect, test } from "bun:test";
import { existsSync, lstatSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { createTempWorkspace, importFresh } from "./helpers.js";

function makeInspector(pid: number, activePids = new Set<number>()) {
  return {
    pid,
    now: () => new Date("2026-05-18T16:00:00.000Z"),
    isAlive: (candidate: number) => activePids.has(candidate),
  };
}

test('ordinary legacy fresh acquisition and exact-owner clean release remain supported', async () => {
  const ws = createTempWorkspace('piclaw-runtime-lock-fresh-');
  try {
    const { acquireRuntimeLock } = await importFresh<typeof import('../src/runtime/single-instance.js')>('../src/runtime/single-instance.js');
    const lockPath = join(ws.store, 'runtime.lock');
    const handle = acquireRuntimeLock({ lockPath, disabled: false, inspector: makeInspector(9999) });
    expect(JSON.parse(readFileSync(lockPath, 'utf8')).pid).toBe(9999);
    expect(() => acquireRuntimeLock({ lockPath, disabled: false, inspector: makeInspector(8888) })).toThrow(/refuses existing/);
    handle.release();
    handle.release();
    expect(existsSync(lockPath)).toBe(false);
  } finally { ws.cleanup(); }
});

test('disabled legacy acquisition does not inspect or remove an existing lock', async () => {
  const ws = createTempWorkspace('piclaw-runtime-lock-disabled-');
  try {
    const { acquireRuntimeLock } = await importFresh<typeof import('../src/runtime/single-instance.js')>('../src/runtime/single-instance.js');
    const lockPath = join(ws.store, 'runtime.lock');
    writeFileSync(lockPath, 'partial');
    const before = lstatSync(lockPath);
    const handle = acquireRuntimeLock({ lockPath, disabled: true, inspector: makeInspector(9999) });
    handle.release();
    expect(handle.enabled).toBe(false);
    expect(lstatSync(lockPath).ino).toBe(before.ino);
    expect(readFileSync(lockPath, 'utf8')).toBe('partial');
  } finally { ws.cleanup(); }
});

test("runtime lock rejects a second active Piclaw runtime", async () => {
  const ws = createTempWorkspace("piclaw-runtime-lock-active-");
  try {
    const lockPath = join(ws.store, "runtime.lock");
    mkdirSync(ws.store, { recursive: true });
    writeFileSync(lockPath, JSON.stringify({
      pid: 4242,
      startedAt: "2026-05-18T15:40:40.000Z",
      workspace: ws.workspace,
      command: "bun /usr/local/bin/piclaw --port 8080",
    }));

    const { acquireRuntimeLock } = await importFresh<typeof import("../src/runtime/single-instance.js")>("../src/runtime/single-instance.js");
    expect(() => acquireRuntimeLock({ lockPath, inspector: makeInspector(9999, new Set([4242])) })).toThrow(/already running/);
  } finally {
    ws.cleanup();
  }
});

test("runtime lock refuses stale owners unchanged: automatic stale recovery is intentionally disabled", async () => {
  const ws = createTempWorkspace("piclaw-runtime-lock-stale-");
  try {
    const lockPath = join(ws.store, "runtime.lock");
    mkdirSync(ws.store, { recursive: true });
    writeFileSync(lockPath, JSON.stringify({
      pid: 4242,
      startedAt: "2026-05-18T15:40:40.000Z",
      workspace: ws.workspace,
      command: "bun /usr/local/bin/piclaw --port 8080",
    }));

    const { acquireRuntimeLock } = await importFresh<typeof import("../src/runtime/single-instance.js")>("../src/runtime/single-instance.js");
    const before = lstatSync(lockPath);
    const raw = readFileSync(lockPath, 'utf8');
    expect(() => acquireRuntimeLock({ lockPath, disabled: false, inspector: makeInspector(9999) })).toThrow(/Offline operator cleanup required/);
    expect(lstatSync(lockPath).ino).toBe(before.ino);
    expect(readFileSync(lockPath, 'utf8')).toBe(raw);
  } finally {
    ws.cleanup();
  }
});

test('maintenance refuses every existing owner and fresh maintenance still excludes runtime', async () => {
  const ws=createTempWorkspace('piclaw-maintenance-lock-');
  try {
    const {acquireRuntimeLock}=await importFresh<typeof import('../src/runtime/single-instance.js')>('../src/runtime/single-instance.js');
    const lockPath=join(ws.store,'runtime.lock');
    writeFileSync(lockPath,'broken');expect(()=>acquireRuntimeLock({lockPath,maintenance:true,disabled:false,inspector:makeInspector(9999)})).toThrow('already running');
    writeFileSync(lockPath,JSON.stringify({pid:4242,command:'unrecognised'}));expect(()=>acquireRuntimeLock({lockPath,maintenance:true,disabled:false,inspector:makeInspector(9999,new Set([4242]))})).toThrow();
    expect(()=>acquireRuntimeLock({lockPath,maintenance:true,disabled:false,inspector:makeInspector(9999)})).toThrow(/Offline operator cleanup required/);
    // Simulate explicit offline operator cleanup, never automatic stale recovery.
    rmSync(lockPath);
    const handle=acquireRuntimeLock({lockPath,maintenance:true,disabled:false,inspector:makeInspector(9999)});
    expect(handle.record.kind).toBe('maintenance');expect(()=>acquireRuntimeLock({lockPath,disabled:false,inspector:makeInspector(8888,new Set([9999]))})).toThrow();handle.release();
  } finally {ws.cleanup();}
});
