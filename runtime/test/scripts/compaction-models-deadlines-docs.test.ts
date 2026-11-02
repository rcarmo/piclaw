import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const repoRoot = join(import.meta.dir, "../../..");
const guide = readFileSync(join(repoRoot, "docs/compaction-models-and-deadlines.md"), "utf8");
const archive = readFileSync(join(repoRoot, "docs/archive/legacy-compaction-models-and-deadlines.md"), "utf8");
const settings = readFileSync(join(repoRoot, "docs/settings-and-addons.md"), "utf8");

test("compaction guide documents native policy and the approved legacy retirement", () => {
  for (const key of ["compactionPolicy: \"pi-durable\"", "autoCompactionEnabled", "domains.compaction.autoCompactionEnabled", "PICLAW_AUTO_COMPACTION_ENABLED", "reserveTokens: 16384", "keepRecentTokens: 20000", "backgroundTokens: 32768"])
    expect(guide).toContain(key);
  for (const field of ["smartCompactionMethod", "compactionModel", "remoteCompactionEnabled", "compactionTimeoutSec", "compactionBackoffBaseMin"])
    expect(guide).toContain(`\`${field}\``);
  expect(guide).toContain("HTTP 400"); expect(guide).toContain("HTTP 410");
  expect(guide).toContain("`createSmartCompactionExtension`"); expect(guide).toContain("`compactionStreamFn`");
  expect(guide).toContain("`createSessionInDir`"); expect(guide).toContain("data-only modules");
  expect(guide).toContain("no fallback compaction engine"); expect(guide).toContain("remain unchanged");
  expect(settings).toContain("compaction-models-and-deadlines.md");
});

test("historical guide retains the removed model/deadline evidence without making it native policy", () => {
  for (const key of ["domains.compaction.model", "domains.compaction.timeoutMs", "retry.provider.timeoutMs", "httpIdleTimeoutMs", "domains.compaction.remoteCompactionTimeoutMs"])
    expect(archive).toContain(`\`${key}\``);
  for (const stage of ["deterministic", "provider_connect", "first_token", "streaming", "settlement"])
    expect(archive).toContain(`\`${stage}\``);
  expect(archive).toContain("Historical legacy-session implementation");
  expect(archive).toContain("Global `fetch` monkey patches or Bun `--preload` wrappers");
  expect(archive).toContain("delayed-openai-compaction.integration.test.ts");
});
