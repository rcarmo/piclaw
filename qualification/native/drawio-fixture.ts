import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
export async function installDrawioFixture(workspace: string) {
  const root = process.env.DURABLE_ADDONS_ROOT;
  if (!root) throw Error("DURABLE_ADDONS_ROOT required: candidate only");
  const pkg = join(workspace, ".pi/extensions/node_modules/@rcarmo/piclaw-addon-drawio-editor");
  mkdirSync(pkg, { recursive: true });
  const pins = {
    "package.json": "2942b1e169541326fd83c9bec29f3365c2f1efabfd13511667da503e7cde67d8",
    "index.ts": "ab1ffba287828ed37db87288c7f1feb47a12efb2c66aa983941643575bdf2790",
    "tool.ts": "7a47e648d93d396c5b959795056885353f34fa04322390e35b0e989d95e81a8b",
  };
  for (const [file, expected] of Object.entries(pins)) {
    const source = join(root, "addons/drawio-editor", file);
    if (createHash("sha256").update(readFileSync(source)).digest("hex") !== expected) throw Error("Draw.io fixture digest mismatch: " + file);
    copyFileSync(source, join(pkg, file));
  }
  // Trusted miniature installation asset, not a production vendor proof.
  writeFileSync(join(pkg, "vendor.tar.gz"), await new Bun.Archive({ "index.html": "DRAWIO_NATIVE_FIXTURE" }, { compress: "gzip" }).bytes());
  return pkg;
}
