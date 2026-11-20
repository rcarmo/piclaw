import { expect, test } from "bun:test";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { createTempWorkspace } from "../helpers.js";

const repoRoot = join(import.meta.dir, "..", "..", "..");
const scriptPath = join(repoRoot, "scripts", "audit-model-catalog-delta.ts");

function writeProvider(dir: string, provider: string, models: Record<string, unknown>): void {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${provider}.json`), JSON.stringify(models, null, 2));
}

async function runAudit(args: string[]) {
  const proc = Bun.spawn(["bun", "run", scriptPath, ...args], {
    cwd: repoRoot,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { stdout, stderr, exitCode };
}

test("audit-model-catalog-delta reports provider, model, and field changes", async () => {
  const workspace = createTempWorkspace("piclaw-model-catalog-delta-");
  try {
    const base = join(workspace.base, "base");
    const head = join(workspace.base, "head");
    const jsonPath = join(workspace.base, "delta.json");
    const markdownPath = join(workspace.base, "delta.md");

    writeProvider(base, "openai", {
      old: { id: "old", provider: "openai", name: "Old", api: "openai-responses", reasoning: false, contextWindow: 100, maxTokens: 10, cost: { input: 1, output: 2 } },
      kept: { id: "kept", provider: "openai", name: "Kept", api: "openai-responses", reasoning: true, contextWindow: 200, maxTokens: 20, cost: { input: 1, output: 2 } },
    });
    writeProvider(head, "openai", {
      kept: { id: "kept", provider: "openai", name: "Kept renamed", api: "openai-responses", reasoning: true, contextWindow: 400, maxTokens: 20, cost: { input: 1, output: 3 } },
      added: { id: "added", provider: "openai", name: "Added", api: "openai-responses", reasoning: false, contextWindow: 100, maxTokens: 10, cost: { input: 1, output: 2 } },
    });
    writeProvider(head, "new-provider", {
      model: { id: "model", provider: "new-provider", name: "Model", api: "openai-responses", reasoning: false, contextWindow: 100, maxTokens: 10, cost: { input: 1, output: 2 } },
    });

    const result = await runAudit(["--base", base, "--head", head, "--json", jsonPath, "--markdown", markdownPath]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Catalog delta:");

    const report = JSON.parse(readFileSync(jsonPath, "utf8"));
    expect(report.summary).toMatchObject({
      providers_added: 1,
      providers_removed: 0,
      providers_changed: 1,
      models_added: 2,
      models_removed: 1,
      models_changed: 1,
      field_changes: 3,
    });
    expect(report.provider_deltas.map((entry: { provider: string; status: string }) => [entry.provider, entry.status])).toEqual([
      ["new-provider", "added"],
      ["openai", "changed"],
    ]);
    expect(report.model_deltas.find((entry: { provider: string; model: string }) => entry.provider === "openai" && entry.model === "kept")).toMatchObject({
      status: "changed",
      changes: [
        { field: "contextWindow", before: 200, after: 400 },
        { field: "cost", before: { input: 1, output: 2 }, after: { input: 1, output: 3 } },
        { field: "name", before: "Kept", after: "Kept renamed" },
      ],
    });
    expect(readFileSync(markdownPath, "utf8")).toContain("### openai/kept — changed");
  } finally {
    workspace.cleanup();
  }
});

test("audit-model-catalog-delta supports provider filters and fail-on modes", async () => {
  const workspace = createTempWorkspace("piclaw-model-catalog-delta-filter-");
  try {
    const base = join(workspace.base, "base");
    const head = join(workspace.base, "head");
    writeProvider(base, "openai", {
      kept: { id: "kept", provider: "openai", name: "Kept", api: "openai-responses", reasoning: true, contextWindow: 200, maxTokens: 20, cost: { input: 1, output: 2 } },
    });
    writeProvider(head, "openai", {
      kept: { id: "kept", provider: "openai", name: "Kept", api: "openai-responses", reasoning: true, contextWindow: 400, maxTokens: 20, cost: { input: 1, output: 2 } },
    });
    writeProvider(head, "ignored", {
      model: { id: "model", provider: "ignored", name: "Ignored", api: "openai-responses", reasoning: false, contextWindow: 100, maxTokens: 10, cost: { input: 1, output: 2 } },
    });

    const filtered = await runAudit(["--base", base, "--head", head, "--providers", "openai", "--fields", "contextWindow", "--fail-on", "fields"]);
    expect(filtered.exitCode).toBe(1);
    expect(filtered.stderr).toContain("Catalog delta exceeded --fail-on=fields");
    expect(filtered.stdout).toContain("Entries changed | 1");
    expect(filtered.stdout).not.toContain("ignored/model");

    const noFailure = await runAudit(["--base", base, "--head", head, "--providers", "ignored", "--fail-on", "any"]);
    expect(noFailure.exitCode).toBe(1);
    expect(noFailure.stdout).toContain("Providers added | 1");
  } finally {
    workspace.cleanup();
  }
});
