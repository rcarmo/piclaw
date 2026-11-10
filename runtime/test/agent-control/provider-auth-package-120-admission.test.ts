import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync, readlinkSync, realpathSync } from "node:fs";
import { resolve, join } from "node:path";
const root = resolve(import.meta.dir, "../../.."), receipts = join(root, "docs/design/earendil-agent-harness-integration-adr/evidence/receipts");
const names = ["chord", "pi-agent-core", "pi-ai", "pi-codemode", "pi-coding-agent", "pi-mcp", "pi-schema", "pi-telemetry", "pi-tui"].map(name => "@earendil-works/" + name).sort();
const sha = (path: string) => createHash("sha256").update(readFileSync(path)).digest("hex");
function tree(input: string): string {
  const base = realpathSync(input), rows: string[] = [];
  const visit = (dir: string) => {
    for (const e of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const path = join(dir, e.name), relative = path.slice(base.length + 1);
      if (e.name === "node_modules") continue; // Installed closure checked separately.
      if (e.isDirectory()) visit(path);
      else if (e.isSymbolicLink()) rows.push(`l\t${relative}\t${readlinkSync(path)}`);
      else if (e.isFile()) rows.push(`f\t${relative}\t${sha(path)}`);
      else throw Error("Unsupported entry");
    }
  };
  visit(base); return createHash("sha256").update(rows.join("\n")).digest("hex");
}
test("actual exact1.5.1 admission binds exact package payloads, registry and providers", () => {
  const r = JSON.parse(readFileSync(join(receipts, "earendil-151-package-admission.json"), "utf8"));
  const registry = JSON.parse(readFileSync(join(receipts, "earendil-151-registry.json"), "utf8"));
  const providers = JSON.parse(readFileSync(join(receipts, "earendil-151-provider-auth.json"), "utf8"));
  expect(r.expected).toEqual({ version: "1.5.1", gitHead: "dd30101cfc5b0609411dd80b6f93adbc14db14cf" });
  expect(r.tarballVerification.map((p: { name: string }) => p.name).sort()).toEqual(names);
  expect(r.registryReceipt.packages.map((p: { name: string }) => p.name).sort()).toEqual(names);
  expect(registry.map((p: { name: string }) => p.name).sort()).toEqual(names);
  expect(r.providerAuthReceipt.version).toBe(providers.version); expect(r.providerAuthReceipt.gitHead).toBe(providers.gitHead); expect(r.providerAuthReceipt.providers).toEqual(providers.providers);
  expect(r.runtimes).toHaveLength(1);
  expect(r.runtimes[0].sideEffectEnforcement).toMatchObject({ networkDenied: true, childProcessDenied: true, networkAttempts: 0, childProcessAttempts: 0 });
  for (const p of r.tarballVerification) {
    const registered = registry.find((entry: { name: string }) => entry.name === p.name); expect(registered).toBeDefined();
    expect(registered.version).toBe("1.5.1"); expect(registered.gitHead).toBeUndefined();
    expect(p.shasum).toBe(registered.dist.shasum); expect(p.integrity).toBe(registered.dist.integrity); expect(p.tarball).toContain("-1.5.1.tgz");
    const canonical = r.registryReceipt.packages.find((entry: { name: string }) => entry.name === p.name);
    expect(canonical.version).toBe("1.5.1"); expect(canonical.shasum).toBe(p.shasum); expect(canonical.integrity).toBe(p.integrity);
    expect(JSON.parse(readFileSync(join(root, "node_modules", p.name, "package.json"), "utf8")).version).toBe("1.5.1");
    expect(p.installedTreeSha256).toBe(tree(join(root, "node_modules", p.name)));
    expect(p.archiveTreeSha256).toBe(p.installedTreeSha256); expect(p.filesCompared).toBeGreaterThan(0);
  }
  // Raw paths were redacted for publication. This hash identifies the local
  // raw receipt; it is metadata, not an independently re-computed CI guard.
  expect(r.admitted).toBe(true);
// Full-tree hashing of eight packages measured 9.47s in the loaded gate.
}, 30_000);
