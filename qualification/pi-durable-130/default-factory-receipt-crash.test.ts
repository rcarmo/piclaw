import './src/test-guard.js';
import { expect, test } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ensureTestFilesystemIsolation } from '../../runtime/scripts/test-filesystem-isolation.js';

const windows = ['before-receipt', 'retained', 'charged'] as const;
type CrashWindow = typeof windows[number];
type Artifact = {
  version: 1;
  pid: number;
  window: CrashWindow;
  source: { id: string; rowid: number };
  taskId: number;
  checkpointHash: string;
  request: { id: string; [key: string]: unknown };
  facts: Record<string, unknown>;
};

function requireId(value: unknown, label: string): asserts value is string {
  if (typeof value !== 'string' || value.length === 0 || value.trim() !== value) {
    throw Error(`Missing or invalid ${label}`);
  }
}

const cases: readonly {window:CrashWindow;revocation?:'harness'|'source'}[] = [
  ...windows.map(window => ({window})), {window:'retained',revocation:'harness'}, {window:'retained',revocation:'source'},
];
for (const {window,revocation} of cases) test(`default factory SIGKILL receipt recovery: ${window}${revocation ? `/${revocation}-revoked` : ''}`, async () => {
  const env = { ...process.env };
  delete env.PICLAW_TEST_FS_ISOLATION_ACTIVE;
  delete env.PICLAW_TEST_FS_ISOLATION_ROOT;
  const isolation = ensureTestFilesystemIsolation(env);
  const children: ReturnType<typeof spawn>[] = [];
  // Run the selected factory body directly; inherit the driver's already-applied
  // local priority rather than inserting a wrapper process between us and Bun.
  function spawn(phase: 'write' | 'read') {
    const process = Bun.spawn([globalThis.process.execPath, 'test', join(import.meta.dir, 'default-application-runtime.test.ts')], {
      cwd: import.meta.dir,
      env: { ...env, PICLAW_DEFAULT_FACTORY_CASE: `native-parent-accounting-crash-${window}${phase === 'read' && revocation ? `-${revocation}-revoked` : ''}`, PICLAW_NATIVE_RESTART_PHASE: phase },
      stdout: 'pipe', stderr: 'pipe',
    });
    // Start both drains immediately, including while the writer is paused.
    const stdout = new Response(process.stdout).text();
    const stderr = new Response(process.stderr).text();
    const child = { process, stdout, stderr };
    children.push(child);
    return child;
  }
  async function output(child: ReturnType<typeof spawn>) {
    return (await child.stdout) + '\n' + (await child.stderr);
  }
  try {
    const writer = spawn('write');
    const artifactPath = join(isolation.workspace, 'factory-receipt-crash.json');
    const deadline = Date.now() + 8000;
    while (!existsSync(artifactPath) && writer.process.exitCode === null && writer.process.signalCode === null && Date.now() < deadline) {
      await Bun.sleep(10);
    }
    if (writer.process.exitCode !== null || writer.process.signalCode !== null) {
      await writer.process.exited;
      throw Error(`Writer exited before SIGKILL (${window}):\n${await output(writer)}`);
    }
    if (!existsSync(artifactPath)) {
      writer.process.kill('SIGKILL');
      await writer.process.exited;
      throw Error(`Crash boundary not reached within 8000ms (${window}):\n${await output(writer)}`);
    }
    // The fixture publishes this atomically only after entering the pause.
    const saved = JSON.parse(readFileSync(artifactPath, 'utf8')) as Artifact;
    expect(saved.version).toBe(1);
    expect(saved.window).toBe(window);
    expect(saved.pid).toBe(writer.process.pid);
    requireId(saved.source?.id, 'source.id');
    expect(Number.isSafeInteger(saved.source.rowid)).toBe(true);
    expect(saved.source.rowid).toBeGreaterThan(0);
    expect(Number.isSafeInteger(saved.taskId)).toBe(true);
    expect(saved.taskId).toBeGreaterThan(0);
    requireId(saved.checkpointHash, 'checkpointHash');
    requireId(saved.request?.id, 'request.id');
    expect(saved.facts !== null && typeof saved.facts === 'object' && !Array.isArray(saved.facts)).toBe(true);

    writer.process.kill('SIGKILL');
    await writer.process.exited;
    expect(writer.process.signalCode).toBe('SIGKILL');
    expect(() => process.kill(writer.process.pid, 0)).toThrow();
    await output(writer);

    // Reopen the very same private filesystem, without deleting locks or
    // modifying persisted Source, request, or SDK identities.
    const reader = spawn('read');
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        reader.process.exited,
        new Promise<never>((_, reject) => { timer = setTimeout(() => reject(Error(`Recovery timed out (${window})`)), 15000); }),
      ]);
    } finally { clearTimeout(timer); }
    const text = await output(reader);
    if (reader.process.exitCode !== 0) throw Error(`Recovery failed (${window}):\n${text}`);
    expect(reader.process.signalCode).toBeNull();
    expect(reader.process.pid).not.toBe(writer.process.pid);
    const plain = text.replace(/\x1b\[[0-9;]*m/g, '');
    // A marker or exit(0) alone cannot certify that Bun completed the body.
    if (!/^\s*1 pass\s*$/m.test(plain) || !/^\s*0 fail\s*$/m.test(plain) || !/Ran 1 test across 1 file\./.test(plain)) {
      throw Error(`Missing completed Bun test footer (${window}):\n${text}`);
    }
    const markers = plain.split(/\r?\n/).filter(line => line.startsWith('FACTORY_RECEIPT_RECOVERY '));
    expect(markers).toHaveLength(1);
    const recovered = JSON.parse(markers[0]!.slice('FACTORY_RECEIPT_RECOVERY '.length));
    expect(recovered).toEqual({ window, pid: reader.process.pid, taskId: saved.taskId,
      requestId: saved.request.id, sourceId: saved.source.id, providerCalls: 0, ...(revocation ? {revocation} : {}) });
    console.log('FACTORY_RECEIPT_PROCESS_RECOVERY '+JSON.stringify({window,revocation:revocation??null,crashedPid:writer.process.pid,
      recoveryPid:reader.process.pid,taskId:saved.taskId,requestId:saved.request.id,sourceId:saved.source.id,
      checkpointHash:saved.checkpointHash,providerCalls:recovered.providerCalls,completed:true}));
  } finally {
    try {
      for (const child of children) {
        if (child.process.exitCode === null && child.process.signalCode === null) child.process.kill('SIGKILL');
        await child.process.exited;
        await Promise.all([child.stdout, child.stderr]);
      }
    } finally { isolation.cleanup(); }
  }
}, 30000);
