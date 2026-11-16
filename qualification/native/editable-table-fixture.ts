import { copyFileSync, mkdirSync, readFileSync, symlinkSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
export const editableTablePins = {
  "package.json": "4810df9f1d7d8f5f34cf21eaccb398c574f0b7e8b5f4ee5511a1e01a26eb9e4c",
  "index.ts": "878b9886c824d3a451153975e6fb92f73903e628add2ad754ad5c9c633de5acb",
  "tool.ts": "1d6752181e680055236302c57e9a100aa78d2c6033074034be83f36551814ceb",
  "shared.ts": "ce18a28856afc7d554d015dfeaf6b04d2deb918762040d0ee9dd030a7909b9f4"
};
export function installEditableTableFixture(workspace: string) {
 const root = process.env.DURABLE_ADDONS_ROOT;
 if (!root) throw Error("DURABLE_ADDONS_ROOT required: candidate only");
 const pkg = join(workspace, ".pi/extensions/node_modules/@rcarmo/piclaw-addon-editable-table");
 mkdirSync(pkg, { recursive: true });
 for (const [file, expected] of Object.entries(editableTablePins)) {
  const source = join(root, "addons/editable-table", file);
  if (createHash("sha256").update(readFileSync(source)).digest("hex") !== expected) throw Error("Editable table digest mismatch: " + file);
  copyFileSync(source, join(pkg, file));
 }
 symlinkSync(join(import.meta.dir, "../../node_modules"), join(pkg, "node_modules"));
 return pkg;
}
