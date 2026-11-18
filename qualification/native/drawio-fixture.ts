import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join, dirname } from "node:path";
export async function installDrawioFixture(workspace: string) {
  const root = process.env.DURABLE_ADDONS_ROOT;
  if (!root) throw Error("DURABLE_ADDONS_ROOT required: candidate only");
  const pkg = join(workspace, ".pi/extensions/node_modules/@rcarmo/piclaw-addon-drawio-editor");
  mkdirSync(pkg, { recursive: true });
  const pins = {
  "compat/tool-call-summary.ts": "a3b717a0538e5fae5e8572b02e289d5b799574ba9bff51b63a6bb29ff5772051",
  "index.ts": "ab1ffba287828ed37db87288c7f1feb47a12efb2c66aa983941643575bdf2790",
  "package.json": "39ec7ee67bacae0850683ee92c18043973e1c76a3601d0e3766cf8a6e9598f0b",
  "summary.ts": "55a20f6767ba224e3b2b22a357c86b1d96438b6305e310d8e63bc8e5d52c1678",
  "tool.ts": "cd80bb436521d90f5d5b602f4ae58a56c778841c65fb09ecb4a4d77001b14920"
};
  for (const [file, expected] of Object.entries(pins)) {
    const source = join(root, "addons/drawio-editor", file);
    if (createHash("sha256").update(readFileSync(source)).digest("hex") !== expected) throw Error("Draw.io fixture digest mismatch: " + file);
    mkdirSync(dirname(join(pkg, file)), { recursive: true }); copyFileSync(source, join(pkg, file));
  }
  // Trusted miniature installation asset, not a production vendor proof.
  writeFileSync(join(pkg, "vendor.tar.gz"), await new Bun.Archive({ "index.html": "DRAWIO_NATIVE_FIXTURE" }, { compress: "gzip" }).bytes());
  return pkg;
}
