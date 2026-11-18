import { copyFileSync, mkdirSync, readFileSync, symlinkSync } from "node:fs";
import { createHash } from "node:crypto";
import { join, dirname } from "node:path";
export const editableTablePins = {
  "compat/tool-call-summary.ts": "a3b717a0538e5fae5e8572b02e289d5b799574ba9bff51b63a6bb29ff5772051",
  "index.ts": "878b9886c824d3a451153975e6fb92f73903e628add2ad754ad5c9c633de5acb",
  "package.json": "9e6eec0865b16aa6bc7ea7005aeec64566a258c9c52b8d2f5334923e8e6df4f9",
  "shared.ts": "ce18a28856afc7d554d015dfeaf6b04d2deb918762040d0ee9dd030a7909b9f4",
  "summary.ts": "b0af1a98acf5da6069294a4b1c6d7400d63421aaed54cfd8bb055ffe027612a6",
  "tool.ts": "36752b016c508e72e63b812ac2fb1c8ffee500cd5f45fc65788f7caeadab9274"
};
export function installEditableTableFixture(workspace: string) {
 const root = process.env.DURABLE_ADDONS_ROOT;
 if (!root) throw Error("DURABLE_ADDONS_ROOT required: candidate only");
 const pkg = join(workspace, ".pi/extensions/node_modules/@rcarmo/piclaw-addon-editable-table");
 mkdirSync(pkg, { recursive: true });
 for (const [file, expected] of Object.entries(editableTablePins)) {
  const source = join(root, "addons/editable-table", file);
  if (createHash("sha256").update(readFileSync(source)).digest("hex") !== expected) throw Error("Editable table digest mismatch: " + file);
  mkdirSync(dirname(join(pkg, file)), { recursive: true }); copyFileSync(source, join(pkg, file));
 }
 symlinkSync(join(import.meta.dir, "../../node_modules"), join(pkg, "node_modules"));
 return pkg;
}
