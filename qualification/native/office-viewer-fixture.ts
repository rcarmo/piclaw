import { mkdirSync, readFileSync, copyFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { createHash } from "node:crypto";

export function installOfficeViewerFixture(workspace: string) {
  const source = process.env.DURABLE_ADDONS_ROOT;
  if (!source) throw Error("DURABLE_ADDONS_ROOT required (reviewed Office viewer source)");
  const pkg = join(workspace, ".pi/extensions/node_modules/@rcarmo/piclaw-addon-office-viewer");
  mkdirSync(pkg, { recursive: true });
  for (const [file, hash] of Object.entries({
  "compat/tool-call-summary.ts": "a3b717a0538e5fae5e8572b02e289d5b799574ba9bff51b63a6bb29ff5772051",
  "index.ts": "5df05cb6c14cb0c17ecae30bfaa81f107046a885291c19ff7cf69b0f760f9191",
  "package.json": "0ae57bea87b1e574f044471196a24c827431399ace7567ea98844935067ec5c1",
  "summary.ts": "646046e9a4e102c04ce5426e426c9f3f291346110367d346ebe38d2c7620b62b"
})) {
    const path = join(source, "addons/office-viewer", file);
    if (createHash("sha256").update(readFileSync(path)).digest("hex") !== hash) throw Error(`Unapproved Office fixture ${file}`);
    mkdirSync(dirname(join(pkg, file)), { recursive: true }); copyFileSync(path, join(pkg, file));
  }
  return pkg;
}
