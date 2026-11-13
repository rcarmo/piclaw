import { expect, test } from 'bun:test';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { prepareLocalInstallArchive } from '../../../scripts/prepare-local-install';

test('global install root retains qualified dependency overrides', async () => {
  const root = await mkdtemp(join(tmpdir(), 'install-overrides-'));
  try {
    await mkdir(join(root, 'source/package'), { recursive: true });
    const overrides = { '@earendil-works/pi-codemode': '1.1.0', '@peculiar/asn1-schema': '2.10.0' };
    await writeFile(join(root, 'source/package/package.json'), JSON.stringify({ name: 'piclaw', version: '3.3.3', overrides, dependencies: { '@earendil-works/pi-coding-agent': '1.1.0' } }));
    const tar = Bun.spawn(['tar', '-czf', join(root, 'source.tgz'), '-C', join(root, 'source'), 'package']);
    expect(await tar.exited).toBe(0);
    await prepareLocalInstallArchive({ sourceArchive: join(root, 'source.tgz'), stageDir: join(root, 'stage'), outputArchive: join(root, 'out.tgz'), patchRoot: join(root, 'patches'), globalPackagePath: join(root, 'global.json'), piAgentVersion: '1.1.0' });
    const global = JSON.parse(await readFile(join(root, 'global.json'), 'utf8'));
    expect(global.overrides).toEqual(overrides);
    expect(global.dependencies['@earendil-works/pi-coding-agent']).toBeUndefined();
    expect(global.dependencies['@earendil-works/pi-agent-core']).toBe('1.1.0');
    expect(global.dependencies.piclaw).toBe(join(root, 'out.tgz'));
    const staged = JSON.parse(await readFile(join(root, 'stage/package/package.json'), 'utf8'));
    expect(staged.dependencies['@earendil-works/pi-coding-agent']).toBe('1.1.0');
  } finally { await rm(root, { recursive: true, force: true }); }
});
