import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const repoRoot = join(import.meta.dir, "../../..");
const guide = readFileSync(join(repoRoot, "docs/compaction-models-and-deadlines.md"), "utf8");
const settings = readFileSync(join(repoRoot, "docs/settings-and-addons.md"), "utf8");

test("compaction deadline guide documents canonical settings and lifecycle ownership", () => {
  for (const key of [
    "domains.compaction.model",
    "domains.compaction.timeoutMs",
    "retry.provider.timeoutMs",
    "httpIdleTimeoutMs",
    "domains.compaction.remoteCompactionTimeoutMs",
  ]) expect(guide).toContain(`\`${key}\``);

  for (const stage of ["deterministic", "provider_connect", "first_token", "streaming", "settlement"]) {
    expect(guide).toContain(`\`${stage}\``);
  }
  expect(guide).toContain("Earendil 0.84.4 disables undici’s former five-minute");
  expect(guide).toContain("Global `fetch` monkey patches or Bun `--preload` wrappers");
  expect(guide).toContain("delayed-openai-compaction.integration.test.ts");
  expect(guide).toContain("Manual LM Studio acceptance run");
  expect(settings).toContain("[Compaction models and deadlines](compaction-models-and-deadlines.md)");
});
