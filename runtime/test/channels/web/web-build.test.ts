import { gzipSync } from "node:zlib";
/**
 * test/channels/web/web-build.test.ts – Build verification tests.
 *
 * Confirms that the web/static output directory contains the expected
 * JS, CSS, and HTML files after a build.
 */

import { expect, test } from "bun:test";
import "../../helpers.js";
import { existsSync, readdirSync, readFileSync, statSync } from "fs";
import { dirname, join, resolve } from "path";

const WEB_BUILD_TEST_TIMEOUT_MS = 20_000;

function projectRoot(): string {
  return join(import.meta.dir, "..", "..", "..");
}

function staticModules(entries: string[]): Map<string, Buffer> {
  const transpiler = new Bun.Transpiler({ loader: "js" });
  const files = new Map<string, Buffer>();
  for (const path of entries) {
    if (files.has(path)) continue;
    const contents = readFileSync(path);
    files.set(path, contents);
    for (const specifier of transpiler.scanImports(contents.toString())) {
      if (specifier.kind === "import-statement" && specifier.path.startsWith("./")) {
        entries.push(resolve(dirname(path), specifier.path));
      }
    }
  }
  return files;
}

function bundleSize(modules: Iterable<Buffer>) {
  let raw=0, gzip=0;
  for (const data of modules) { raw += data.length; gzip += gzipSync(data).byteLength; }
  return {raw,gzip};
}

test("build:web produces bundle assets", async () => {
  const root = projectRoot();
  const proc = Bun.spawn([process.execPath, "run", "build:web"], {
    cwd: root,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [exitCode, stdout, stderr] = await Promise.all([
    proc.exited, new Response(proc.stdout).text(), new Response(proc.stderr).text(),
  ]);
  expect(exitCode, stderr || stdout).toBe(0);

  const appBundlePath = join(root, "web", "static", "classic", "dist", "app.bundle.js");
  const appMapPath = join(root, "web", "static", "classic", "dist", "app.bundle.js.map");
  const appCssPath = join(root, "web", "static", "classic", "dist", "app.bundle.css");
  const sessionPickerFixturePath = join(root, "web", "static", "classic", "dist", "session-picker-fixture.bundle.js");

  const loginBundlePath = join(root, "web", "static", "common", "dist", "login.bundle.js");
  const loginMapPath = join(root, "web", "static", "common", "dist", "login.bundle.js.map");
  const loginCssPath = join(root, "web", "static", "common", "dist", "login.bundle.css");

  const editorBundlePath = join(root, "web", "static", "classic", "dist", "editor.bundle.js");
  const editorMapPath = join(root, "web", "static", "classic", "dist", "editor.bundle.js.map");

  expect(existsSync(appBundlePath)).toBe(true);
  expect(existsSync(appMapPath)).toBe(true);
  expect(existsSync(appCssPath)).toBe(true);
  expect(existsSync(sessionPickerFixturePath)).toBe(true);

  expect(existsSync(loginBundlePath)).toBe(true);
  expect(existsSync(loginMapPath)).toBe(true);
  expect(existsSync(loginCssPath)).toBe(true);

  expect(existsSync(editorBundlePath)).toBe(true);
  expect(existsSync(editorMapPath)).toBe(true);

  const startup = staticModules([appBundlePath]);
  const editorBundle = readFileSync(editorBundlePath, "utf8");
  expect([...startup.values()].some(data=>data.includes('#editor-vendor/codemirror'))).toBe(true);
  expect(editorBundle).toContain('#editor-vendor/codemirror');

  // Compact Delegate rows add 1.7KB raw / 0.7KB gzip over the prior bundle; the
  // workbench UX pass (timeline status line, global menu, footer, session context) ~6KB raw / 1.9KB gzip.
  // The MCP management redesign adds 9.8KB raw / 2.5KB gzip against 78d7852f2.
  // Account for that feature while retaining ~4.9KB raw / 1.8KB gzip headroom.
  // Settings cleanup (#2021, #2022, label association and shared form rows)
  // then used that headroom (~6KB raw); keep ~4.7KB raw headroom again.
  // Charge the entire static module graph to the original Classic startup limits.
  const appSize = bundleSize(startup.values());
  expect(appSize.raw).toBeLessThan(1_525_000);
  expect(appSize.gzip).toBeLessThan(420_000);
  expect(statSync(editorBundlePath).size).toBeLessThan(500_000);

  const dist = dirname(appBundlePath);
  const files = readdirSync(dist);
  const a2uiEntries = files.filter(file=>/^a2ui-(surface|renderer-executor)-[a-z0-9]+\.js$/.test(file)).map(file=>join(dist,file));
  expect(a2uiEntries).toHaveLength(2);
  for (const entry of a2uiEntries) expect(startup.has(entry)).toBe(false);
  const deferred = bundleSize([...staticModules(a2uiEntries)].filter(([path])=>!startup.has(path)).map(([,data])=>data));
  expect(deferred.raw).toBeLessThan(360_000);
  expect(deferred.gzip).toBeLessThan(110_000);
  for (const path of files.filter(file=>file.endsWith('.js.map'))) {
    const {sources}: {sources:string[]} = JSON.parse(readFileSync(join(dist,path),'utf8'));
    expect(sources.some(source=>/(?:^|\/)node_modules\/(?:lit(?:-html|-element)?|@lit|react(?:-dom)?)\//.test(source)),path).toBe(false);
    if (startup.has(join(dist,path.slice(0,-4)))) {
      expect(sources.some(source=>source.includes('/@a2ui/web_core/')),path).toBe(false);
    }
  }
}, WEB_BUILD_TEST_TIMEOUT_MS);
