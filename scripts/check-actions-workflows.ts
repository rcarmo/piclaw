#!/usr/bin/env bun
/**
 * Static contract checks for GitHub Actions routing, release gating, and E2E coverage.
 * Keeps cost-oriented workflow changes from silently weakening test or tag semantics.
 */

import { load } from "js-yaml";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { checkPublishSmokeGate } from "./check-publish-smoke-gate";

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

const browserCache = load(readFileSync(resolve(ROOT, '.github/actions/playwright-cache/action.yml'), 'utf8')) as Workflow;
const cacheSteps = browserCache.runs.steps;
const restoreBrowsers = cacheSteps.find((step: Workflow) => step.id === 'cache');
expectEqual(restoreBrowsers.with, {
  path: '~/.cache/ms-playwright',
  key: "browsers-v1-${{ runner.os }}-${{ runner.arch }}-bun${{ inputs.bun-version }}-${{ hashFiles('bun.lock', 'tests/e2e/bun.lock') }}-pw${{ steps.playwright.outputs.version }}-${{ inputs.variant }}",
}, 'Browser cache must contain only binaries with an exact platform/toolchain/lock/browser key.');
const installBrowsers = cacheSteps.find((step: Workflow) => step.name === 'Install required browsers');
expectTrue(installBrowsers.if === undefined && installBrowsers.run === 'bunx playwright install ${{ inputs.browsers }}',
  'Normal browser installation must run even on cache hits.');
expectTrue(cacheSteps.findIndex((step: Workflow) => step.name === 'Check restored browser integrity') < cacheSteps.indexOf(installBrowsers),
  'Restored browser contents must be verified before installation.');
expectEqual(cacheSteps.find((step: Workflow) => step.name === 'Save browser binaries').with.path,
  '~/.cache/ms-playwright', 'Browser cache save must never include profiles or fixtures.');

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

// Native qualification has one fixture contract, setup action and mandatory entry point.
const nativeContract = JSON.parse(readFileSync(resolve(ROOT, "scripts/native-gate-contract.json"), "utf8"));
const nativeSetupRaw = readFileSync(resolve(ROOT, ".github/actions/native-qualification-setup/action.yml"), "utf8");
const nativeSetup = load(nativeSetupRaw) as Workflow;
expectEqual(nativeContract.version, 1, "Native setup must consume contract version 1.");
expectEqual(nativeContract.roots, {
  DURABLE_ADDONS_ROOT: "native",
  DURABLE_CORE_ADDONS_ROOT: "native",
  DURABLE_GOAL_ADDON_ROOT: "native",
  DURABLE_CONTRACT_ADDONS_ROOT: "contract",
}, "ADDONS/CORE/GOAL must share the native checkout; historical contracts use their own checkout.");
expectEqual(nativeContract.catalogDependencies, "qualification/pi-durable-130/node_modules",
  "Catalogue dependencies must use frozen qualification tooling, never a live profile.");
expectEqual(nativeContract.typeProjects, ["runtime/durable-engine", "qualification/pi-durable-130"],
  "Both private native projects must be provisioned.");
expectEqual(nativeSetup.runs?.using, "composite", "Native setup must be a shared composite action.");
const nativeSteps: Workflow[] = nativeSetup.runs.steps;
expectTrue(nativeSteps.every(step => step.if === undefined && !step["continue-on-error"]),
  "Native provisioning must not be conditional or advisory.");
const readPins = nativeSteps.find(step => step.id === "contract");
expectTrue(readPins, "Native setup must define its shared-contract step.");
expectTrue(readPins?.run?.includes('readFileSync("scripts/native-gate-contract.json"') &&
  readPins.run.includes("contract.fixtures[name]") && readPins.run.includes("fixture.repository") &&
  readPins.run.includes("fixture.ref") && readPins.run.includes("^[0-9a-f]{40}$") &&
  readPins.run.includes("GITHUB_OUTPUT"), "Setup must read and validate immutable pins from the shared JSON.");
const fixtureCheckouts = nativeSteps.filter(step => step.uses?.startsWith("actions/checkout@"));
expectEqual(fixtureCheckouts.length, 2, "Native setup must have exactly two fixture checkouts.");
for (const [index, name] of ["native", "contract"].entries()) {
  const pin = nativeContract.fixtures[name];
  expectTrue(/^[0-9a-f]{40}$/.test(pin.ref) && /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(pin.repository),
    `${name} fixture must have an immutable SHA and repository.`);
  const checkout = fixtureCheckouts[index];
  expectTrue(/^actions\/checkout@[0-9a-f]{40}$/.test(checkout.uses), "Fixture checkout action must be SHA-pinned.");
  expectEqual(checkout.with, {
    repository: `\${{ steps.contract.outputs.${name}-repository }}`,
    ref: `\${{ steps.contract.outputs.${name}-ref }}`,
    path: name === "native" ? ".qualification-native-addons" : ".qualification-addons",
    "persist-credentials": false,
  }, `${name} checkout must consume shared pin outputs without persisting credentials.`);
  expectTrue(nativeSteps.indexOf(readPins) < nativeSteps.indexOf(checkout), "Pins must be validated before checkout.");
  for (const file of [nativeSetupRaw, readFileSync(resolve(ROOT, ".github/workflows/ci.yml"), "utf8"),
    readFileSync(resolve(ROOT, ".github/workflows/integration-gate.yml"), "utf8")]) {
    expectTrue(!file.includes(pin.ref), "Fixture SHAs must occur only in the shared JSON, never duplicated in wiring.");
  }
}
const nativeInstalls = nativeSteps.filter(step => step.run?.includes("bun install"));
expectEqual(nativeInstalls.map(step => [step["working-directory"], step.run]), [
  ["runtime/durable-engine", "bun install --frozen-lockfile --ignore-scripts"],
  ["qualification/pi-durable-130", "bun install --frozen-lockfile --ignore-scripts"],
  [".qualification-native-addons", "bun install --frozen-lockfile --ignore-scripts"],
  [".qualification-native-addons/addons/code-review", "bun install --frozen-lockfile --ignore-scripts"],
], "Setup must prepare the private engine, qualification, native add-on and code-review parser graphs with frozen locks and no lifecycle scripts.");
const exportPaths = nativeSteps.at(-1);
expectTrue(exportPaths?.run?.includes('readFileSync("scripts/native-gate-contract.json"') &&
  exportPaths.run.includes("Object.entries(contract.roots)") && exportPaths.run.includes("checkouts[fixture]") &&
  exportPaths.run.includes("GITHUB_ENV") && exportPaths.run.includes("DURABLE_CATALOG_DEPENDENCIES=") &&
  exportPaths.run.includes("contract.catalogDependencies"), "Setup must export all five fixture paths from the shared contract.");
for (const [event, filter] of Object.entries(ci.on)) {
  const paths = values((filter as Workflow).paths);
  for (const path of ["scripts/native-*.ts", "scripts/native-gate-contract.json", "scripts/integration-test-suite.ts",
    "scripts/check-actions-workflows.ts", ".github/actions/native-qualification-setup/**", ".github/workflows/integration-gate.yml"]) {
    expectTrue(paths.includes(path), `CI ${event} path filter must include ${path}.`);
  }
}
for (const [data, jobName, command] of [[ci, "web-build", "make ci-full"],
  [integration, "integration", "make ci-integration"]] as const) {
  expectEqual(data.permissions, { contents: "read" }, "Native gate workflows need read-only repository permissions.");
  const steps: Workflow[] = data.jobs[jobName].steps;
  const setups = steps.filter(step => step.uses === "./.github/actions/native-qualification-setup");
  const gates = steps.filter(step => step.run === command);
  expectEqual(setups.length, 1, `${jobName} must use shared native setup exactly once.`);
  expectEqual(gates.length, 1, `${jobName} must run ${command} exactly once.`);
  expectTrue(steps.indexOf(setups[0]) < steps.indexOf(gates[0]), "Shared setup must precede validation.");
  for (const step of [...setups, ...gates]) {
    expectTrue(step.if === undefined && !step["continue-on-error"], "Required native setup/gate must not be skipped or advisory.");
    expectTrue(!Object.keys(step.env ?? {}).some(key => key.startsWith("DURABLE_")), "Gate steps must inherit all fixture paths from shared setup.");
  }
  expectTrue(!steps.some(step => step.uses?.startsWith("actions/checkout@") && step.with?.repository),
    "Fixture checkouts belong only in shared setup.");
  expectTrue(!steps.some(step => /test:goal-tools|test-isolated|native-test-suite|bun run typecheck/.test(step.run ?? "")),
    "Workflows must not retain duplicate native execution/type/Goal stages.");
}
const pkg = JSON.parse(readFileSync(resolve(ROOT, "package.json"), "utf8"));
expectEqual(pkg.scripts["ci:native"], "bun scripts/native-test-suite.ts", "ci:native must invoke the offline runner without filters.");
expectEqual(pkg.scripts["ci:full"], "bun run ci:fast && bun run ci:native", "ci:full must require both host and native gates.");
const makefile = readFileSync(resolve(ROOT, "Makefile"), "utf8");
for (const name of ["native", "full"]) {
  expectTrue(makefile.includes(`ci-${name}: ##`) && makefile.includes(`\tbun run ci:${name}`), `Make must expose ci-${name}.`);
  expectTrue(makefile.split("\n").some(line => line.includes(`ci-${name}`) && line.endsWith("| policy-dirs")),
    `ci-${name} must preserve scratch policy prerequisites.`);
}
const integrationRunner = readFileSync(resolve(ROOT, "scripts/integration-test-suite.ts"), "utf8");
const nativeStage = 'await runStage("ci:native", ["bun", "run", "ci:native"]);';
expectEqual(integrationRunner.split(nativeStage).length, 2, "Integration must run one required native stage with no skip/advisory options.");
expectTrue(integrationRunner.indexOf(nativeStage) < integrationRunner.indexOf("const staticChecks") &&
  integrationRunner.indexOf(nativeStage) < integrationRunner.indexOf("const hasDocker"),
  "Native qualification must run outside advisory static checks and Docker/Playwright skip handling.");

const publish = workflow("publish.yml");
checkPublishSmokeGate(publish);
expectTrue(publish.jobs?.integration?.uses === "./.github/workflows/integration-gate.yml", "Publish must call the reusable exact-SHA integration gate.");
expectEqual(publish.jobs?.integration?.with, { ref: "${{ github.sha }}" }, "Publish integration must validate the exact tag SHA.");
expectTrue(!publish.jobs?.["wait-for-integration"], "Publish must not retain a polling waiter runner.");
for (const jobName of ["build-portable-artifacts", "build-amd64", "build-arm64"]) {
  expectTrue(values(publish.jobs?.[jobName]?.needs).includes("integration"), `${jobName} must depend on integration.`);
}
expectTrue(publish.concurrency === undefined, "Publish/tag work must never be cancellation-concurrent.");

const e2e = workflow("e2e.yml");
const e2eRaw = readFileSync(resolve(ROOT, '.github/workflows/e2e.yml'), 'utf8');
expectTrue(e2eRaw.includes('umask 077;') && e2eRaw.includes('chmod 600 "$PICLAW_WORKSPACE/.piclaw/config.json"'), 'E2E runtime config must be created private.');
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
