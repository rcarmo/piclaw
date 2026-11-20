import { expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runInNewContext } from 'node:vm';

const root = join(import.meta.dir, '../../..');

test('Pele vendor is a deterministic classic script with truthful metadata and complete licence', () => {
  const temp = mkdtempSync(join(tmpdir(), 'piclaw-pele-vendor-'));
  try {
    const output = join(temp, 'pele.js'), metadata = join(temp, 'pele.meta.json');
    const build = Bun.spawnSync(['bun', 'scripts/build-vendored-dependency.ts', '--manifest', 'vendor-manifests/pele.json', '--outfile', output, '--meta-out', metadata], { cwd: join(root, 'runtime'), stdout: 'pipe', stderr: 'pipe' });
    if (build.exitCode !== 0) throw Error(build.stdout.toString() + build.stderr.toString());
    const bytes = readFileSync(output);
    const checkedIn = readFileSync(join(root, 'runtime/web/static/common/js/vendor/pele.js'));
    expect(bytes.equals(checkedIn)).toBe(true);
    const meta = JSON.parse(readFileSync(metadata, 'utf8'));
    const pins = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
    expect(meta.manifest_id).toBe('pele'); expect(meta.package_name).toBe('pele'); expect(meta.package_version).toBe(pins.dependencies.pele);
    expect(meta.sha256).toBe(createHash('sha256').update(bytes).digest('hex')); expect(meta.size_bytes).toBe(bytes.length);
    expect(meta.build_command).toContain('--format=iife');
    expect(meta.package_versions.dompurify).toBe(pins.devDependencies.dompurify);
    const context: Record<string, any> = {};
    runInNewContext(bytes.toString(), context);
    expect(typeof context.piclawDiagrams.render).toBe('function');
    expect(context.piclawDiagrams.render('flowchart LR\nA-->B')).toContain('pele-flowchart');
    expect(context.beautifulMermaid).toBeUndefined();
    const license = readFileSync(join(root, 'runtime/web/static/common/js/vendor/pele.LICENSE.txt'), 'utf8');
    expect(license).toBe(readFileSync(join(root, 'node_modules/pele/LICENSE'), 'utf8'));
    expect(license).toContain('MIT License'); expect(license).toContain('ISC License');
    expect(readFileSync(join(root, 'runtime/web/static/common/js/vendor/diagram-sanitizer.LICENSE.txt'), 'utf8')).toBe(readFileSync(join(root, 'node_modules/dompurify/LICENSE'), 'utf8'));
  } finally { rmSync(temp, { recursive: true, force: true }); }
});

test('legacy widget asset retains all eight public members independently of Pele', () => {
  const context: Record<string, any> = { setTimeout, clearTimeout, console, Buffer };
  runInNewContext(readFileSync(join(root, 'runtime/web/static/common/js/vendor/beautiful-mermaid.js'), 'utf8'), context);
  expect(Object.keys(context.beautifulMermaid).sort()).toEqual(['renderMermaid', 'renderMermaidSync', 'renderMermaidSVG', 'renderMermaidSVGAsync', 'THEMES', 'DEFAULTS', 'fromShikiTheme', 'parseMermaid'].sort());
  expect(context.piclawDiagrams).toBeUndefined();
  const graph = context.beautifulMermaid.parseMermaid('flowchart LR\nA --> B');
  expect(graph.nodes.size).toBe(2); expect(graph.edges.length).toBe(1);
});
