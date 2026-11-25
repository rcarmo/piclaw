import { expect, test } from 'bun:test';
import { readFileSync, readlinkSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const pins = JSON.parse(readFileSync(new URL('./fixtures/provider-oauth-161-hashes.json', import.meta.url), 'utf8'));
const deviceModes = ['success', 'denied', 'malformed-device', 'unsafe-uri', 'malformed-token', 'poll-cancel', 'initial-wait-cancel', 'pending-wait-cancel', 'expiry', 'refresh-denied', 'refresh-cancel'];
const radiusModes = ['browser-success', 'browser-bad-state-first', 'browser-denied', 'browser-token-denied', 'browser-discovery-malformed', 'browser-cancel', 'device-pending-success', 'device-slow-down', 'device-denied', 'device-malformed', 'device-expiry', 'device-poll-cancel', 'device-wait-cancel', 'refresh-success', 'refresh-denied', 'unknown-selection', 'pre-abort'];

for (const provider of ['meta', 'xai', 'radius']) test(`public SDK1.6.1 ${provider} OAuth executes only synthetic namespace-owned flows`, async () => {
  const radius = provider === 'radius';
  const fixture = resolve(import.meta.dir, 'fixtures', radius ? 'radius-auth-152.mjs' : 'provider-device-extra-152.mjs');
  const path = `${dirname(process.execPath)}:/usr/bin:/bin`;
  const child = Bun.spawn(['sudo', '-n', 'unshare', '--net', '/bin/sh', '-c',
    'ip link set lo up && exec setpriv --reuid="$1" --regid="$2" --clear-groups --bounding-set=-all --inh-caps=-all --ambient-caps=-all --no-new-privs env -i PATH="$3" HOME=/nonexistent PI_OFFLINE=1 PI_TELEMETRY=0 OTEL_SDK_DISABLED=true PI_OAUTH_CALLBACK_HOST=127.0.0.1 SYNTHETIC_PARENT_NETNS="$4" SYNTHETIC_EXPECT_UID="$1" timeout --kill-after=2s "$8" "$5" --no-env-file "$6" "$7"',
    'oauth-152-namespace', String(process.getuid?.()), String(process.getgid?.()), path,
    readlinkSync('/proc/self/ns/net'), process.execPath, fixture, provider, radius ? '75s' : '40s'], {
    cwd: resolve(import.meta.dir, '../../..'), env: { PATH: path, HOME: '/nonexistent' }, stdin: 'ignore', stdout: 'pipe', stderr: 'pipe',
  });
  const timer = setTimeout(() => child.kill('SIGKILL'), radius ? 85000 : 45000);
  try {
    const [exit, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
    expect(exit, stderr).toBe(0); expect(stderr).toBe('');
    const result = JSON.parse(stdout);
    expect(result.version).toBe('1.6.1'); expect(result.runtime).toBe(`Bun ${Bun.version}`);
    expect(result.bootstrapRequests).toBe(0); expect(result.sdkFileSha256).toEqual(pins.files);
    expect(result.credentialPersistence).toBe('none'); expect(result.inference).toBe('not_invoked');
    const expected = radius ? radiusModes : [...deviceModes, ...(provider === 'xai' ? ['refresh-rotate'] : [])];
    expect(result.results.map((row: { mode: string }) => row.mode)).toEqual(expected);
    expect(result.results.every((row: { status: string }) => row.status === 'pass')).toBe(true);
    expect(result.results.every((row: { requests: { unexpected: number } }) => row.requests.unexpected === 0)).toBe(true);
    if (radius) {
      expect(result.networkGuard).toBe('distinct_loopback_only_os_namespace_guarded_fetch_owned_ipv4_callback');
      expect(result.results.every((row: { callbackPortReleased: boolean }) => row.callbackPortReleased)).toBe(true);
      expect(result.malformedResponse).toEqual({ outcome: 'sdk_invalid_credential_observed', requests: 1, credentialPersistence: 'none', coreDisposition: 'rejected_by_existing_serialized_write_owner_regression' });
    } else {
      expect(result.provider).toBe(provider); expect(result.networkGuard).toBe('distinct_loopback_only_namespace_exact_fetch');
      expect(result.privilegesDropped).toBe(true);
    }
    for (const sentinel of ['synthetic-meta-key', 'synthetic-meta-identity', 'synthetic-xai-access', 'synthetic-xai-refresh', 'synthetic-radius-access', 'synthetic-radius-refresh', 'synthetic-radius-code', 'SYNTHETIC-CODE', 'SYNTHETIC-RADIUS-CODE']) expect(stdout).not.toContain(sentinel);
  } finally { clearTimeout(timer); if (child.exitCode === null) child.kill('SIGKILL'); await child.exited; }
}, provider === 'radius' ? 95000 : 50000);

for (const file of ['provider-device-extra-152.mjs', 'radius-auth-152.mjs']) test(`${file} refuses the parent network namespace before importing providers`, async () => {
  const fixture = resolve(import.meta.dir, 'fixtures', file);
  const child = Bun.spawn([process.execPath, '--no-env-file', fixture, 'meta'], {
    env: { PATH: `${dirname(process.execPath)}:/usr/bin:/bin`, HOME: '/nonexistent', SYNTHETIC_PARENT_NETNS: readlinkSync('/proc/self/ns/net'), SYNTHETIC_EXPECT_UID: String(process.getuid?.()) },
    stdin: 'ignore', stdout: 'pipe', stderr: 'pipe',
  });
  const timer = setTimeout(() => child.kill('SIGKILL'), 5000);
  try {
    const [exit, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
    expect(exit).not.toBe(0); expect(stdout).toBe(''); expect(stderr).toContain('A distinct network namespace is required');
  } finally { clearTimeout(timer); if (child.exitCode === null) child.kill('SIGKILL'); await child.exited; }
});
