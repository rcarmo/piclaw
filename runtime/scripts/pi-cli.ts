#!/usr/bin/env bun
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";

/** Resolve the installed package's declared CLI, not an obsolete dist layout. */
export function resolvePiCli(appDir = resolve(import.meta.dir, "../..")): string {
  const require = createRequire(join(appDir, "package.json"));
  const manifest = require.resolve("@earendil-works/pi-coding-agent/package.json");
  const { bin } = JSON.parse(readFileSync(manifest, "utf8"));
  if (typeof bin?.pi !== "string") throw new Error("The installed Pi package does not declare a pi binary");
  const packageDir = dirname(manifest);
  const cli = resolve(packageDir, bin.pi);
  const local = relative(packageDir, cli);
  if (local === ".." || local.startsWith(`..${sep}`) || isAbsolute(local)) {
    throw new Error("The declared Pi binary escapes its package");
  }
  return cli;
}

if (import.meta.main) {
  const cli = resolvePiCli();
  process.argv[1] = cli;
  // Stay in this Bun process: preserve terminal streams, signals and exit status.
  await import(pathToFileURL(cli).href);
}
