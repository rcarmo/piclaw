import { mkdirSync, readFileSync, copyFileSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";

export function installOfficeViewerFixture(workspace: string) {
  const source = process.env.DURABLE_ADDONS_ROOT;
  if (!source) throw Error("DURABLE_ADDONS_ROOT required (reviewed Office viewer source)");
  const pkg = join(workspace, ".pi/extensions/node_modules/@rcarmo/piclaw-addon-office-viewer");
  mkdirSync(pkg, { recursive: true });
  for (const [file, hash] of Object.entries({
    "index.ts": "c6d302ab289c6ce97967da40d97aac14f70b04aeb6a8be77c63bcde7e7d97565",
    "package.json": "fe62110bc5f59674973065afee279f34f7e0ff1cfc078718f8fad14a5973b155",
  })) {
    const path = join(source, "addons/office-viewer", file);
    if (createHash("sha256").update(readFileSync(path)).digest("hex") !== hash) throw Error(`Unapproved Office fixture ${file}`);
    copyFileSync(path, join(pkg, file));
  }
  return pkg;
}
