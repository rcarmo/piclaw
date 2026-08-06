#!/usr/bin/env bun
/**
 * Static contract checks for GitHub Actions routing, release gating, and E2E coverage.
 * Keeps cost-oriented workflow changes from silently weakening test or tag semantics.
 */

import { load } from "js-yaml";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(import.meta.dir, "..");

type Workflow = Record<string, any>;

function workflow(name: string): Workflow {
  return load(readFileSync(resolve(ROOT, ".github", "workflows", name), "utf8")) as Workflow;
}

function values(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String);
  return value == null ? [] : [String(value)];
}

function expectEqual(actual: unknown, expected: unknown, message: string): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${message}\nexpected: ${JSON.stringify(expected)}\nactual: ${JSON.stringify(actual)}`);
  }
}

function expectTrue(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}

function e2eSpecs(workflowData: Workflow): string[] {
  const include = workflowData.jobs?.e2e?.strategy?.matrix?.include;
  expectTrue(Array.isArray(include), "E2E workflow must define a stage matrix.");
  return include.flatMap((entry: { specs?: unknown }) => String(entry.specs ?? "").split(/\s+/).filter(Boolean)).sort();
}

const ci = workflow("ci.yml");
expectEqual(ci.concurrency, {
  group: "ci-${{ github.event.pull_request.number || github.ref }}",
  "cancel-in-progress": true,
}, "CI must cancel only superseded runs in the same PR/ref lane.");
expectEqual(values(ci.on?.push?.branches), ["main"], "CI must remain scoped to main pushes.");
expectTrue(values(ci.on?.pull_request?.paths).length > 0, "CI path filters must remain present.");

const cleanup = workflow("prune-actions-artifacts.yml");
expectEqual(cleanup.on?.schedule, [{ cron: "23 3 * * 0" }], "Actions cleanup must run weekly at the staggered schedule.");
expectTrue(cleanup.on?.workflow_dispatch !== undefined, "Actions cleanup must remain manually dispatchable.");
expectTrue(cleanup.on?.workflow_run === undefined, "Actions cleanup must not run after every workflow completion.");
expectEqual(cleanup.concurrency, {
  group: "actions-cleanup",
  "cancel-in-progress": false,
}, "Cleanup runs must serialize rather than cancel a prior maintenance run.");

const integration = workflow("integration-gate.yml");
expectTrue(integration.on?.workflow_call !== undefined, "Integration validation must be reusable by publish.");
expectTrue(integration.on?.workflow_dispatch !== undefined, "Integration validation must remain manually dispatchable.");
expectTrue(integration.on?.push === undefined, "Integration must run only inside publish or by explicit dispatch; tag pushes must not duplicate the exact-SHA gate.");
expectTrue(integration.jobs?.integration?.["timeout-minutes"] === 30, "Integration timeout must remain 30 minutes.");

const publish = workflow("publish.yml");
expectTrue(publish.jobs?.integration?.uses === "./.github/workflows/integration-gate.yml", "Publish must call the reusable exact-SHA integration gate.");
expectEqual(publish.jobs?.integration?.with, { ref: "${{ github.sha }}" }, "Publish integration must validate the exact tag SHA.");
expectTrue(!publish.jobs?.["wait-for-integration"], "Publish must not retain a polling waiter runner.");
for (const jobName of ["build-portable-artifacts", "build-experimental-shell-artifacts", "build-amd64", "build-arm64"]) {
  expectTrue(values(publish.jobs?.[jobName]?.needs).includes("integration"), `${jobName} must depend on integration.`);
}
expectTrue(publish.concurrency === undefined, "Publish/tag work must never be cancellation-concurrent.");

const e2e = workflow("e2e.yml");
expectTrue(e2e.concurrency === undefined, "E2E tag work must never be cancellation-concurrent.");
expectEqual(values(e2e.on?.push?.tags), ["*-ux", "*-prerelease"], "E2E tag routing changed unexpectedly.");
const expectedE2eSpecs = [
  "steps/favicon-branding.spec.ts",
  "steps/us01-morning-triage.spec.ts",
  "steps/us11-pwa-manifest.spec.ts",
  "steps/timeline-rendering.spec.ts",
  "steps/us02-queue-steer.spec.ts",
  "steps/us16-message-deletion.spec.ts",
  "steps/us17-compose-instant-visibility.spec.ts",
  "steps/us24-btw-panel.spec.ts",
  "steps/theme-tint-commands.spec.ts",
  "steps/us03-session-switching.spec.ts",
  "steps/us06-settings.spec.ts",
  "steps/us09-session-lifecycle.spec.ts",
  "steps/us12-system-meters.spec.ts",
  "steps/us12-thoughts-panel.spec.ts",
  "steps/us04-editor.spec.ts",
  "steps/us08-panes.spec.ts",
  "steps/us10-workspace-files.spec.ts",
  "steps/us13-15-terminal.spec.ts",
  "steps/us05-screenshots.spec.ts",
  "steps/us07-reconnection.spec.ts",
  "steps/us20-lightbox-dismissal.spec.ts",
  "steps/us21-swipe-independence.spec.ts",
  "steps/us22-settings-layering.spec.ts",
  "steps/us18-19-compaction-model.spec.ts",
].sort();
expectEqual(e2eSpecs(e2e), expectedE2eSpecs, "E2E shard changes must preserve the exact existing spec set.");
expectEqual(e2e.jobs?.e2e?.strategy?.matrix?.include?.map((entry: { stage?: unknown }) => entry.stage), [
  "core-compose-and-sessions",
  "workspace-and-terminal",
  "resilience-and-compaction",
], "E2E must retain the three balanced diagnostic shards.");

console.log("Actions workflow contract ok.");
