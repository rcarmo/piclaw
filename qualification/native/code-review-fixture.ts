import { copyFileSync, mkdirSync, readFileSync, symlinkSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
export const codeReviewPins = {
  "index.ts": "e7b5acf09dcf9bbb2f1cad2e9d4dc5d52fff2606d18254d42470051b3dfb0558",
  "tool.ts": "6432109f40bc37858bbcc71038a92bf9d8d6904804259a3a17bbc96d7e859d53",
  "runtime.ts": "82531a50fbaec5adc9f353d8b623c3542d81db932bb30c4bd8239296f3c68f9c",
  "anchors.ts": "0c1504ff42fdd49b1d320fae4d8eafbf969a5dadb7d867cdc8fb81d737242453",
  "contracts.ts": "f1a6eaf8ad1d4b532ccb509b287991668ce8368a0167cd9e8bf83c2dea727f10",
  "database.ts": "b0b2c9fe4f547a6be5bdffca90a1f4e328701bd6a5fe6e96ea496d44edaa3a58",
  "dispatch.ts": "637dd8f2ac750b9065fb0a482c8d66de507a1fe8b6a44d9e5a346bc971010a2f",
  "host.ts": "5d8db59386fabeda32bb65b4db97e13aa03d5bf98adf7d91b67077d37dd618a2",
  "markdown.ts": "ab04e2573e426cbb0aad7975eafbb058db1a5e29355c35df485253ebd6a7520b",
  "render-source.ts": "200645c447550f5a33b472f4c6962a272b574ee23a2a74f59572d8a69c9cd2d0",
  "source.ts": "67ded478500c6b51d4344e86c1d68d6f0b2b50f1aa2f92aa5478c5981567157e",
  "store.ts": "f8a2977d1376c43c3e576c8c471433c1c77083bc40ebd79a1f663162d4a2d5ff",
  "validation.ts": "6520c981ea388f70e0278cf73583e0c80871aa346b2abd50dab3003d90c9d1a8"
};
export function installCodeReviewFixture(workspace: string) {
  const root = process.env.DURABLE_ADDONS_ROOT;
  if (!root) throw Error("DURABLE_ADDONS_ROOT required: reviewed candidate worktree, never live packages");
  const pkg = join(workspace, ".pi/extensions/node_modules/@rcarmo/piclaw-addon-code-review");
  mkdirSync(pkg, { recursive: true });
  for (const [file, expected] of Object.entries(codeReviewPins)) {
    const source = join(root, "addons/code-review", file);
    if (createHash("sha256").update(readFileSync(source)).digest("hex") !== expected) throw Error("Code Review candidate digest mismatch: " + file);
    copyFileSync(source, join(pkg, file));
  }
  copyFileSync(join(root, "addons/code-review/package.json"), join(pkg, "package.json"));
  symlinkSync(join(import.meta.dir, "../../node_modules"), join(pkg, "node_modules"));
  return pkg;
}
