#!/usr/bin/env bun
import { chmodSync, existsSync, linkSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** Minimal ustar fixture constructor: no extraction helper is used to build hostile paths. */
export function tarEntry(name: string, type = '0', content = '', link = ''): Buffer {
  const header = Buffer.alloc(512);
  const field = (offset: number, size: number, value: string) => header.write(value.slice(0, size), offset, 'ascii');
  field(0, 100, name); field(100, 8, '0000644\0'); field(108, 8, '0000000\0'); field(116, 8, '0000000\0');
  field(124, 12, `${Buffer.byteLength(content).toString(8).padStart(11, '0')}\0`);
  field(136, 12, '00000000000\0'); header.fill(32, 148, 156);
  field(156, 1, type); field(157, 100, link); field(257, 6, 'ustar\0'); field(263, 2, '00');
  const sum = header.reduce((total, byte) => total + byte, 0);
  field(148, 8, `${sum.toString(8).padStart(6, '0')}\0 `);
  return Buffer.concat([header, Buffer.from(content), Buffer.alloc((512 - Buffer.byteLength(content) % 512) % 512)]);
}
const archive = (...entries: Buffer[]) => Buffer.concat([...entries, Buffer.alloc(1024)]);

export async function qualifyArchive() {
  const parent = mkdtempSync(join(tmpdir(), 'bun-archive-qualification-'));
  const observations: Record<string, any> = {};
  try {
    const source = join(parent, 'source'); mkdirSync(source);
    for (const mode of [0o644, 0o600, 0o755]) {
      const name = `file-${mode.toString(8)}`;
      writeFileSync(join(source, name), 'content'); chmodSync(join(source, name), mode);
      utimesSync(join(source, name), 946684800, 946684800);
    }
    mkdirSync(join(source, 'empty')); chmodSync(join(source, 'empty'), 0o700);
    symlinkSync('file-644', join(source, 'symlink'));
    linkSync(join(source, 'file-644'), join(source, 'hardlink'));
    const tarPath = join(parent, 'metadata.tar');
    // Name the payload before its hardlink so tar cannot choose the link as the
    // payload owner based on the filesystem's directory iteration order.
    const members = ['file-644', 'file-600', 'file-755', 'empty', 'symlink', 'hardlink'];
    const build = Bun.spawnSync(['tar', '-cf', tarPath, '-C', source, ...members], { stderr: 'pipe' });
    if (build.exitCode !== 0) throw Error('Reference tar fixture failed');
    const reference = join(parent, 'reference'); mkdirSync(reference);
    if (Bun.spawnSync(['tar', '--same-permissions', '-xf', tarPath, '-C', reference], { stderr: 'pipe' }).exitCode !== 0) throw Error('Reference extraction failed');
    const candidate = join(parent, 'candidate'); mkdirSync(candidate);
    await new Bun.Archive(readFileSync(tarPath)).extract(candidate);
    for (const name of members) {
      const snapshot = (root: string) => {
        const stat = lstatSync(join(root, name));
        return { mode: (stat.mode & 0o777).toString(8), uid: stat.uid, gid: stat.gid,
          mtime: stat.mtimeMs, directory: stat.isDirectory(), symlink: stat.isSymbolicLink(), nlink: stat.nlink };
      };
      observations[name] = { reference: snapshot(reference), bun: existsSync(join(candidate, name)) ? snapshot(candidate) : null };
    }
    const cases = [
      ['traversal', tarEntry('../escape', '0', 'hostile')],
      ['absolute', tarEntry(join(parent, 'absolute-escape'), '0', 'hostile')],
      ['symlink-escape', archive(tarEntry('link', '2', '', '..'), tarEntry('link/escape', '0', 'hostile'))],
      ['hardlink-escape', tarEntry('hard', '1', '', '../outside')],
      ['device', tarEntry('device', '3')],
      ['overwrite', tarEntry('existing', '0', 'replacement')],
    ] as const;
    writeFileSync(join(parent, 'outside'), 'preserve');
    for (const [name, entry] of cases) {
      const target = join(parent, `case-${name}`); mkdirSync(target);
      writeFileSync(join(target, 'existing'), 'preserve');
      let rejected = false;
      try { await new Bun.Archive(archive(entry)).extract(target); } catch { rejected = true; }
      observations[name] = { rejected,
        escaped: existsSync(join(parent, 'escape')) || existsSync(join(parent, 'absolute-escape')),
        outsidePreserved: readFileSync(join(parent, 'outside'), 'utf8') === 'preserve',
        existingPreserved: readFileSync(join(target, 'existing'), 'utf8') === 'preserve',
        deviceCreated: existsSync(join(target, 'device')) };
    }
    return { bunVersion: Bun.version, platform: process.platform, arch: process.arch,
      productionExtractor: 'external tar (unchanged)', observations };
  } finally { rmSync(parent, { recursive: true, force: true }); }
}

if (import.meta.main) console.log(JSON.stringify(await qualifyArchive(), null, 2));
