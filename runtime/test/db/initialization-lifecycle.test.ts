import { expect, test } from 'bun:test';
import { withTempWorkspaceEnv } from '../helpers.js';

for (const scenario of ['schema-failure', 'restoration-failure', 'schema-and-close-failure', 'reuse-behind-writer',
  'inspection-failure', 'replacement', 'missing', 'prepared-close', 'published-close-failure', 'registration-failure', 'disposer-failure',
  'schema-lock', 'token-column-failure', 'scheduled-column-failure', 'thinking-column-failure', 'thinking-inspection-failure', 'column-and-close-failure']) {
  test(`root database publication and lifetime: ${scenario}`, async () => {
    await withTempWorkspaceEnv('database-initialization-', {}, async ws => {
      const child = Bun.spawn([process.execPath, '--no-env-file', new URL('../fixtures/db-initialization-lifecycle.ts', import.meta.url).pathname, scenario], {
        env: { ...process.env, PICLAW_WORKSPACE: ws.workspace, PICLAW_STORE: ws.store, PICLAW_DATA: ws.data, PICLAW_DB_IN_MEMORY: '0' },
        stdin: 'ignore', stdout: 'pipe', stderr: 'pipe',
      });
      const timer = setTimeout(() => child.kill('SIGKILL'), 15_000);
      try {
        const [exit, out, err] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
        expect(exit, err).toBe(0);
        expect(JSON.parse(out.trim().split('\n').at(-1)!)).toEqual({ scenario, privatePublicationAndLifetime: true });
      } finally { clearTimeout(timer); if (child.exitCode === null) child.kill('SIGKILL'); await child.exited; }
    });
  });
}
