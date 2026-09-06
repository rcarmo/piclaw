import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const repoRoot = join(import.meta.dir, "../../..");
const vendorDir = join(repoRoot, "runtime/web/static/common/js/vendor");
const xtermDir = join(vendorDir, "xterm");

interface XtermManifestExport {
  outputFile: string;
  sourceSha256: string;
  sha256: string;
}

interface XtermManifestPackage {
  name: string;
  license: string;
  integrity: string;
  exports: XtermManifestExport[];
}

interface XtermManifest {
  packages: XtermManifestPackage[];
}

test("core terminal vendors xterm assets", () => {
  expect(existsSync(join(xtermDir, "xterm.mjs"))).toBe(true);
  expect(existsSync(join(xtermDir, "xterm.css"))).toBe(true);
  expect(existsSync(join(xtermDir, "addon-fit.mjs"))).toBe(true);
  expect(existsSync(join(xtermDir, "addon-image.mjs"))).toBe(true);
  expect(existsSync(join(xtermDir, "addon-serialize.mjs"))).toBe(true);

  const pane = readFileSync(join(repoRoot, "runtime/web/src/panes/terminal-pane.ts"), "utf8");
  expect(pane).toContain("/static/common/js/vendor/xterm");
  expect(pane).toContain('importAddon("image")');
  expect(pane).toContain("translateKittyGraphicsOutput");
  expect(pane).not.toContain("ghostty-web.js");
  expect(pane).not.toContain("ghostty-vt.wasm");
});

test("xterm vendor manifest pins registry integrity and every output checksum", () => {
  const manifest = JSON.parse(readFileSync(join(repoRoot, "runtime/vendor-manifests/xterm.json"), "utf8")) as XtermManifest;
  const outputs = manifest.packages.flatMap((pkg) => pkg.exports.map((entry) => ({ pkg, entry })));

  expect(manifest.packages).toHaveLength(14);
  expect(outputs).toHaveLength(15);
  for (const pkg of manifest.packages) {
    expect(pkg.name.startsWith("@xterm/")).toBe(true);
    expect(pkg.license).toBe("MIT");
    expect(pkg.integrity).toMatch(/^sha512-[A-Za-z0-9+/]+=*$/);
  }
  for (const { entry } of outputs) {
    const bytes = readFileSync(join(xtermDir, entry.outputFile));
    expect(createHash("sha256").update(bytes).digest("hex")).toBe(entry.sha256);
    expect(entry.sourceSha256).toMatch(/^[0-9a-f]{64}$/);
  }

  expect(String(pkgScript("check:vendor:xterm"))).toContain("vendor-xterm.ts --check");
  expect(String(pkgScript("update:vendor:xterm"))).toContain("vendor-xterm.ts");
  expect(String(pkgScript("build:vendor"))).toContain("check:vendor:xterm");
});

test("core no longer ships Ghostty browser assets or vendor manifest", () => {
  expect(existsSync(join(vendorDir, "ghostty-web.js"))).toBe(false);
  expect(existsSync(join(vendorDir, "ghostty-vt.wasm"))).toBe(false);
  expect(existsSync(join(vendorDir, "ghostty-web.meta.json"))).toBe(false);
  expect(existsSync(join(repoRoot, "runtime/vendor-manifests/ghostty-web.json"))).toBe(false);

  const vendorNames = readdirSync(vendorDir);
  expect(vendorNames.filter((name) => name.toLowerCase().includes("ghostty"))).toEqual([]);
});

test("package scripts, lockfile, and built web bundle do not fetch Ghostty into core", () => {
  const pkg = JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf8"));
  expect(pkg.dependencies?.["ghostty-web"]).toBeUndefined();
  expect(pkg.scripts?.["build:vendor:ghostty-web"]).toBeUndefined();
  expect(String(pkg.scripts?.["build:vendor"] || "")).not.toContain("ghostty");

  const lockfile = readFileSync(join(repoRoot, "bun.lock"), "utf8");
  expect(lockfile).not.toContain("ghostty-web");

  const appBundle = readFileSync(join(repoRoot, "runtime/web/static/classic/dist/app.bundle.js"), "utf8");
  expect(appBundle).not.toContain("ghostty-web.js");
  expect(appBundle).not.toContain("ghostty-vt.wasm");
});

function pkgScript(name: string): unknown {
  const pkg = JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf8"));
  return pkg.scripts?.[name];
}
