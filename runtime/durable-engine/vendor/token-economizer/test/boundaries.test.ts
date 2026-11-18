import { expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import * as core from "../src/core/index.ts";
import manifest from "../package.json";

const root = `${import.meta.dir}/..`;
const projectRoot = resolve(root, "../../../..");
const upstreamNoticeSha256 = "b13ad82143cf3148f4a840f32efb2da7426da7a87924bc964e252d3bd1bdf443";

test("declared entry points exist and core exports load without a host", () => {
  for (const entry of Object.values(manifest.exports)) expect(existsSync(`${root}/${entry}`)).toBe(true);
  expect(core.defaultPolicy().enabled).toBe(false);
  expect(manifest.peerDependencies["@earendil-works/pi-durable"]).toBe("1.5.2");
});

test("core imports no host, SDK, filesystem, network or clock", async () => {
  const allowedDependencies = new Set(["typebox", "typebox/value", "re2js", "@noble/hashes/legacy.js", "@noble/hashes/sha2.js"]);
  for await (const file of new Bun.Glob("src/**/*.ts").scan({ cwd: root })) {
    const source = await Bun.file(`${root}/${file}`).text();
    const { imports } = new Bun.Transpiler({ loader: "ts" }).scan(source);
    const names = new Set([...imports.map(item => item.path), ...Array.from(source.matchAll(/\bfrom\s+["']([^"']+)["']/g), match => match[1])]);
    for (const name of names) {
      expect(name.startsWith("@kintsugi/")).toBe(false);
      if (file.startsWith("src/core/")) {
        const insideCore = name.startsWith(".") && resolve(dirname(`${root}/${file}`), name).startsWith(`${resolve(root)}/src/core/`);
        expect(insideCore || allowedDependencies.has(name)).toBe(true);
      }
    }
    if (file.startsWith("src/core/")) expect(source).not.toMatch(/\b(?:fetch|eval|setTimeout|setInterval|Date\.now|performance\.now)\s*\(|\b(?:Bun|process)\./);
  }
});

test("distribution retains the pinned upstream licence, attribution and modified-port notices", async () => {
  const licence = await Bun.file(`${root}/LICENSE`).text();
  expect(new Bun.CryptoHasher("sha256").update(licence).digest("hex")).toBe("cfc7749b96f63bd31c3c42b5c471bf756814053e847c10f3eb003417bc523d30");
  const notice = await Bun.file(`${root}/NOTICE`).text();
  expect(new Bun.CryptoHasher("sha256").update(notice).digest("hex")).toBe(upstreamNoticeSha256);
  expect(notice).toContain("Microsoft TokenEconomizer");
  expect(notice).toContain("81e32e56bb3c4c1b4c9756b429be91e3960116ca");
  for await (const file of new Bun.Glob("src/core/{microskills,loopguard,toolprune}/**/*.ts").scan({ cwd: root })) {
    expect(await Bun.file(`${root}/${file}`).text()).toContain("Modified TypeScript port");
  }

  const projectPackage = JSON.parse(await Bun.file(`${projectRoot}/package.json`).text()) as { files?: string[]; imports?: Record<string, string> };
  expect(projectPackage.files ?? []).toEqual(expect.arrayContaining([
    "runtime/durable-engine/vendor/token-economizer/src",
    "runtime/durable-engine/vendor/token-economizer/LICENSE",
    "runtime/durable-engine/vendor/token-economizer/NOTICE",
    "runtime/durable-engine/vendor/token-economizer/package.json",
    "runtime/durable-engine/vendor/token-economizer/SOURCE.json",
  ]));
  expect(projectPackage.imports ?? {}).toMatchObject({
    "#token-optimizer/core": "./runtime/durable-engine/vendor/token-economizer/src/core/index.ts",
    "#token-optimizer/pi-durable": "./runtime/durable-engine/vendor/token-economizer/src/pi-durable/index.ts",
    "#token-optimizer/state": "./runtime/durable-engine/vendor/token-economizer/src/pi-durable/documents.ts",
  });
});

test("the Piclaw host uses only the package's public entry points", async () => {
  for (const hostRoot of [resolve(projectRoot, "runtime/src"), resolve(projectRoot, "runtime/durable-engine/src")]) {
  for await (const file of new Bun.Glob("**/*.ts").scan({ cwd: hostRoot })) {
    const source = await Bun.file(`${hostRoot}/${file}`).text();
    const names = [
      ...Array.from(source.matchAll(/\bfrom\s+["']([^"']+)["']/g), match => match[1]),
      ...Array.from(source.matchAll(/\bimport\s+["']([^"']+)["']/g), match => match[1]),
    ];
    for (const name of names) {
      if (name.startsWith("#token-optimizer/")) expect(name).toMatch(/^#token-optimizer\/(?:core|pi-durable|state)$/);
      if (name.includes("token-economizer")) {
        expect(name).not.toContain("/src/");
        expect(name).not.toMatch(/^@kintsugi\//);
      }
    }
    expect(source).not.toContain("token-economizer/src/");
    expect(source).not.toContain("@kintsugi/token-economizer");
    expect(source).not.toContain("token-optimizer/src/");
  }
  }
});
