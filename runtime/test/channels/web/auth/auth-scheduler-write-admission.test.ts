import { expect, test } from 'bun:test';
import { createTempWorkspace } from '../../../helpers.js';

// Bound file-backed batches while allowing asynchronous close under CI I/O contention.
for (const batch of [0, 1, 2, 3]) test(`owned WAL auth contention batch ${batch}: fresh checks, cancellation, atomicity and no callback replay`, async () => {
  const workspace = createTempWorkspace('auth-scheduler-admission-child-');
  const launcher = new URL('../../../../scripts/local-test-priority.ts', import.meta.url).pathname;
  const fixture = new URL('../../../fixtures/auth-scheduler-write-admission.ts', import.meta.url).pathname;
  const child = Bun.spawn([process.execPath, '--no-env-file', launcher, '--', '--env', 'PICLAW_DB_IN_MEMORY=0', '--env', `PICLAW_WORKSPACE=${workspace.workspace}`, '--env', `PICLAW_STORE=${workspace.store}`, '--env', `PICLAW_DATA=${workspace.data}`, '--', process.execPath, '--no-env-file', fixture, String(batch)], { stdin: 'ignore', stdout: 'pipe', stderr: 'pipe' });
  const timer = setTimeout(() => child.kill('SIGKILL'), 30000);
  try {
    const [exit, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
    expect(exit, `${stderr}\n${stdout}`).toBe(0);
    expect(JSON.parse(stdout.trim().split('\n').at(-1)!)).toEqual({ kind: 'auth-scheduler-write-admission', cases: batch === 0 ? 4 : 3, realWal: true, abortedAndRevokedDenied: true, noCallbackReplay: true });
  } finally {
    clearTimeout(timer); if (child.exitCode === null) child.kill('SIGKILL'); await child.exited; workspace.cleanup();
  }
}, 45000);
