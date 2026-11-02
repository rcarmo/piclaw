import type { SyncSqliteOperation } from "../../src/db/sqlite-async-admission.js";
import { assertHostToolDeclaration } from "./host-tools.js";
import { installedAddonProfiles, type InstalledAddonProfile } from "./host-installed-addon-profiles.js";
import { DefaultResourceLoader, type LoadExtensionsResult, type SettingsManager, type ToolDefinition, type RegisteredCommand } from "../../src/durable-legacy-sdk.js";
import { getInstalledAddonExtensionPaths, resolveAddonPackageEntries, listInstalledAddonPackageDirs, readInstalledAddonPackage } from "../../src/addons/package-entries.js";
import { join, resolve, relative, isAbsolute } from "node:path";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";
import type { CodeReviewNativeExports } from "./host-code-review-tool.js";
import type { EditableTableNativeExports } from "./host-editable-table-tool.js";
import type { DrawioNativeExports } from "./host-drawio-tool.js";
export interface PlanPromptExports {
  createPlanTool(write?: <T>(body: SyncSqliteOperation<T>) => Promise<T>): ToolDefinition<any, any, any>;
  parsePlanMarkdown(markdown: string): { plan: { step: string; status: "pending" | "in_progress" | "completed" }[] };
  loadSessionPlan(chatJid: string): { chat_jid: string; markdown: string; updated_at: string | null };
  buildPlanSystemPrompt(plan: ReturnType<PlanPromptExports["loadSessionPlan"]>): string;
  buildPlanTurnMessage(plan: ReturnType<PlanPromptExports["loadSessionPlan"]>): { customType: string; content: { type: "text"; text: string }[]; display: boolean } | undefined;
}

// Core policy for the effect proof in qualification/plan.test.ts. This is not
// an add-on lockfile: other installed content still loads, but gets no exemption.
const approvedPlanFiles = Object.freeze({
  "index.ts": "303b6a270cdb0dfbdf0ffbce5ac02ee16574ea0da7e43d503f116137a1ee6579",
  "compat/chat-context.ts": "8cfa6c16f0a27308ecc665f80ba107064d4fa8ac34122676ff0d1cb46e719da5",
  "compat/extension-kv.ts": "02ae106a2d7ceee64286cac755943d53ed2fe725ef666640a889b6d63315324c"
});
const approvedDelegateFiles = Object.freeze({
  "index.ts": "73563d26795cbab5cd92e8d5f8dabe3d7477fa11dff35e0ed8b21d9ec3f5ab51",
  "delegate.ts": "b0e3fd1d2edcd95cecedff84ac3204fba8bfdadaa70854e6009713e44ba8a402",
  "compat/extension-kv.ts": "3e86c21a9bf94d43151311fe29a3de1778d7a0a2ae32b81bb634e9fd1b2de4ab"
});
// Candidate source profile; qualification tests exercise every backend import.
const approvedCodeReviewFiles = Object.freeze({
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
});
const approvedEditableTableFiles = Object.freeze({
  "package.json": "4810df9f1d7d8f5f34cf21eaccb398c574f0b7e8b5f4ee5511a1e01a26eb9e4c",
  "index.ts": "878b9886c824d3a451153975e6fb92f73903e628add2ad754ad5c9c633de5acb",
  "tool.ts": "1d6752181e680055236302c57e9a100aa78d2c6033074034be83f36551814ceb",
  "shared.ts": "ce18a28856afc7d554d015dfeaf6b04d2deb918762040d0ee9dd030a7909b9f4"
});
// Execution-only profile: index imports only node:fs/path. Static route/status
// registration is approved; vendor browser assets are not an execution proof.
const approvedOfficeViewerFiles = Object.freeze({
  "package.json": "fe62110bc5f59674973065afee279f34f7e0ff1cfc078718f8fad14a5973b155",
  "index.ts": "c6d302ab289c6ce97967da40d97aac14f70b04aeb6a8be77c63bcde7e7d97565"
});
// Execution source only. Installed vendor assets remain trusted installation
// content, not integrity-qualified source or a filesystem sandbox.
const approvedDrawioFiles = Object.freeze({
  "package.json": "2942b1e169541326fd83c9bec29f3365c2f1efabfd13511667da503e7cde67d8",
  "index.ts": "ab1ffba287828ed37db87288c7f1feb47a12efb2c66aa983941643575bdf2790",
  "tool.ts": "7a47e648d93d396c5b959795056885353f34fa04322390e35b0e989d95e81a8b"
});
const approvedGoalFiles = Object.freeze({
  "index.ts": "887fd5457c104940a4e1ce132a621a16ef3ab4026f187fb4a576cae6ca86ec62",
  "deadline-checkpoint.ts": "e94f7cb065f321b06de33bfd7963011f03714c73437eedab634bce69f199c1db",
  "compat/chat-context.ts": "90e20fa38d72915a7cbf4eea4e4134788271e6eb52dfbcb813df05b6d60c3c44",
  "compat/extension-kv.ts": "04240517e9e8664cae2d2badb99f382100a7af3e12679cfce97087870881551c"
});
const approvedObservabilityFiles = Object.freeze({
  "usage-telemetry.ts": "1714e4f6b24450315940d960e0d971ca2c66c27453b399427b677d1fb807b705",
  "package.json": "c890f655eab2b8a55306dbb1d2a3b7110d54c6697a14ea69c860966d59fe8b5c",
  "model-speed-telemetry.ts": "a6b46ba29c71f459880c560575851312779f84163427ace6d7b1abd9e53a4b81",
  "compat/extension-kv.ts": "04240517e9e8664cae2d2badb99f382100a7af3e12679cfce97087870881551c",
  "compat/log-sink.ts": "b7f04b776dc33ec8a2bbe4d803b2d7c2783b8d16b5fa4a1b54c85fb30d1ee19e",
  "compat/config.ts": "b6b5f488fc7c537185d0144de8fa58029a56c8de33ab2972683556eb989e0768",
  "compat/logger.ts": "de0fddbd49d7b4d48e3b4ae8c0cf1ab188b4ba542f77c87d57ccb510318f85fa",
  "compat/keychain.ts": "db449b3c8fb9d0008d85b05c9f7717da0b728e0f9c033bac7b86f9e17eb93bb6",
  "compaction-telemetry.ts": "d6e51e6c04c38e97e04508c27f589089c55e3fd8c86e9ca9422a89ecd22c6697",
  "index.ts": "7ee12cf6aa95f1f9aae277ba4bf4085232718824a83ea139aab7ff20d41a642e"
});
const approvedResticFiles = Object.freeze({
  "binary.ts": "ff426c8c97d6e7873fce405d948db9e89138f16a948885cd6f97cce77ca9c082",
  "job-config.ts": "16f6a73e858897608aaa0abd5b40ad0d4dffc7ea9d30ee9b0cf0bee71c69c873",
  "paths.ts": "1a1e090b0bc57498dc4574632aa06ba14a0c93e6a36448ffba2b07d256f3f0e0",
  "config.ts": "2da245b75137c0307f93d8ecc0f248d5f21bcb76b5f06954ba53e18874f9f1b8",
  "staging.ts": "ef2bbb6730aab585cb8471ebf808c729b29e266c1f79c9d37d963f5497fe0f7c",
  "runtime-state.ts": "c7fcbc2eb88b2b05dd46ae928e2e3d50d96ad1a5c8ab5ddce25ba0c2b0d02681",
  "runner.ts": "913c3af0646f5d98657d1a40d19eaee5685f9fcfda0075869c39a966b4cd3a0e",
  "sqlite-snapshot.ts": "4a5faac2d37fcd82fb7c993a56e25885f98868ba16d8ecda184d01b52767118f",
  "repository.ts": "2545decc728f76f0c200983acf8267dd12d4229e65bff132014943f02a74327d",
  "index.ts": "fd9d9106ace5bf13560a78caa6e51467053df84e82c03b02aa3c15df98ee46b2",
  "runtime.ts": "9e2d4959aade2908843c18b40ceceae0c524f716ca724d6a273210ea87c2c8eb",
  "service.ts": "f1ed6ee19bdce8d8e72e0d4e6b64fd3dad8f7fe4713f25203e386145d0a72190",
  "package.json": "48fab80b368fe9491e559011fd89d2a97de0b2d0312ab70a9372d86a7bd45777",
  "contracts.ts": "d73eea35af0c00b1dc36a98c352389804147447b5228c18cee807110fbddb27c"
});
const profiles = {
  observability: { label: "Observability", name: "@rcarmo/piclaw-addon-observability", version: "0.1.19", files: approvedObservabilityFiles,
    shadows: [...Object.keys(approvedObservabilityFiles).filter(file => file.endsWith(".ts")).flatMap(file => [file.replace(/\.ts$/, ".js"), file.replace(/\.ts$/, ".json"), file.replace(/\.ts$/, "/index.js"), file.replace(/\.ts$/, "/package.json")]), "compat/package.json"],
    events: ["resources_discover", "session_start", "before_agent_start"] },
  restic: { label: "Restic", name: "@rcarmo/piclaw-addon-restic", version: "0.1.5", files: approvedResticFiles,
    shadows: Object.keys(approvedResticFiles).filter(file => file.endsWith(".ts")).flatMap(file => [file.replace(/\.ts$/, ".js"), file.replace(/\.ts$/, ".json"), file.replace(/\.ts$/, "/index.js"), file.replace(/\.ts$/, "/package.json")]), events: [] as readonly string[] },
  goal: { label: "Goal", name: "@rcarmo/piclaw-addon-goal", version: "0.1.50", files: approvedGoalFiles,
    shadows: [...Object.keys(approvedGoalFiles).flatMap(file => [file.replace(/\.ts$/, ".js"), file.replace(/\.ts$/, ".json"), file.replace(/\.ts$/, "/index.js"), file.replace(/\.ts$/, "/package.json")]), "compat/package.json"],
    events: ["before_agent_start", "tool_execution_end", "session_compact", "input", "message_end", "agent_end"] },
  open_drawio_editor: { label: "Draw.io", name: "@rcarmo/piclaw-addon-drawio-editor", version: "31.4.4", files: approvedDrawioFiles, shadows: ["index.js", "tool.js", "tool.json", "tool/index.js", "tool/package.json"], events: [] as readonly string[] },
  open_office_viewer: { label: "Office Viewer", name: "@rcarmo/piclaw-addon-office-viewer", version: "0.1.3", files: approvedOfficeViewerFiles, shadows: ["index.js"], events: [] as readonly string[] },
  editable_table: { label: "Editable Table", name: "@rcarmo/piclaw-addon-editable-table", version: "0.1.4", files: approvedEditableTableFiles, shadows: ["index.js", "tool.js", "tool.json", "tool/index.js", "tool/package.json", "shared.js", "shared.json", "shared/index.js", "shared/package.json"], events: ["resources_discover"] },
  plan: { label: "Plan", name: "@rcarmo/piclaw-addon-plan-sidebar", version: "0.1.27", files: approvedPlanFiles, shadows: ["compat/chat-context.js", "compat/extension-kv.js", "compat/package.json"], events: ["before_agent_start"] },
  code_review: { label: "Code Review", name: "@rcarmo/piclaw-addon-code-review", version: "0.1.11", files: approvedCodeReviewFiles,
    shadows: [...Object.keys(approvedCodeReviewFiles).flatMap(file => [file.replace(/\.ts$/, ".js"), file.replace(/\.ts$/, ".json"), file.replace(/\.ts$/, "/index.js"), file.replace(/\.ts$/, "/package.json")])], events: ["resources_discover"] },
  delegate: { label: "Delegate", name: "@rcarmo/piclaw-addon-delegate", version: "0.2.21", files: approvedDelegateFiles, shadows: ["delegate.js", "delegate.json", "delegate/index.js", "delegate/package.json", "compat/extension-kv.js", "compat/package.json"], events: ["session_start", "model_select", "before_agent_start"] },
} as const;
type Profile = keyof typeof profiles;
export const applicationAddonSourceProfiles = { ...profiles, ...installedAddonProfiles };
const sourceProfiles = applicationAddonSourceProfiles;
type SourceProfile = keyof typeof sourceProfiles;
type Extension = LoadExtensionsResult["extensions"][number];
type InstalledSource = Readonly<{ cwd: string; packageDir: string; entry: string; manifest: string; files: string }>;
type InstalledRegistration = Readonly<{
  source: InstalledSource;
  definition: NonNullable<ReturnType<Extension["tools"]["get"]>>["definition"] | undefined;
  execute: NonNullable<ReturnType<Extension["tools"]["get"]>>["definition"]["execute"] | undefined;
  declaration: string | undefined;
  handlerMap: Extension["handlers"];
  handlers: ReadonlyMap<string, readonly unknown[]>;
  tools: readonly { name: string; definition: ToolDefinition; execute: unknown; declaration: string }[];
  commands: readonly { name: string; command: RegisteredCommand; handler: RegisteredCommand["handler"]; completions: RegisteredCommand["getArgumentCompletions"]; declaration: string }[];
}>;
const loadedProfileSources = new WeakMap<LoadExtensionsResult, ReadonlyMap<SourceProfile, InstalledSource>>();
const loadedInstalledSources = new WeakMap<LoadExtensionsResult, ReadonlyMap<Extension, InstalledRegistration>>();
// DefaultResourceLoader's first reload may reuse a process-wide factory cache.
// The SDK root does not export its cache clear API. Remember the source BEFORE
// every application load (including rejected/failed loads), never just successful
// qualification. An unsupported first attempt permanently poisons this path for
// this process; restored bytes cannot prove which cached factory would run.
// This is cache provenance metadata, not durable ownership/adoption authority.
const attemptedInstalledSources = new Map<string, InstalledSource | undefined>();

function captureApprovedSource(cwd: string, installedEntries: readonly string[], kind: SourceProfile): InstalledSource | undefined {
  try {
    const profile = sourceProfiles[kind];
    const workspace = realpathSync(cwd);
    const candidates = [profile.name, ...(kind === "eml-viewer" ? ["piclaw-addon-eml-viewer"] : [])]
      .map(name => join(workspace, ".pi/extensions/node_modules", name)).filter(path => existsSync(path));
    if (candidates.length !== 1) return undefined;
    const packageDir = candidates[0]!;
    // Neither a renamed package nor a symlink out of the installed namespace
    // grants provenance. Entry/helper links may not escape the canonical root.
    if (realpathSync(packageDir) !== packageDir) return undefined;
    const inside = (file: string) => {
      const path = relative(packageDir, realpathSync(file));
      return path !== ".." && !path.startsWith("../") && !isAbsolute(path);
    };
    if (!inside(join(packageDir, "package.json"))) return undefined;
    const manifest = readFileSync(join(packageDir, "package.json"), "utf8");
    const pkg = JSON.parse(manifest);
    if (pkg.name !== profile.name || pkg.version !== profile.version || pkg.type !== "module") return undefined;
    const entries = resolveAddonPackageEntries(packageDir, pkg.pi?.extensions);
    const entryFile = "entry" in profile ? profile.entry : "index.ts";
    const entry = join(packageDir, entryFile || "package.json");
    if (entryFile ? entries.length !== 1 || realpathSync(entries[0]!) !== entry || !installedEntries.some(path => resolve(path) === entry) : entries.length !== 0) return undefined;
    // The pinned TS imports use .js specifiers. A sibling JS file would win
    // resolution and is NOT covered by the approved TS content proof.
    if (profile.shadows.some(file => existsSync(join(packageDir, file)))) return undefined;
    const files = Object.entries(profile.files).map(([file, expected]) => {
      const path = join(packageDir, file);
      if (!inside(path)) throw Error(`${profile.label} source escape`);
      const digest = createHash("sha256").update(readFileSync(path)).digest("hex");
      if (digest !== expected) throw Error(`Unsupported ${profile.label} source`);
      return `${file}:${realpathSync(path)}:${digest}`;
    }).join("\n");
    return Object.freeze({ cwd: workspace, packageDir, entry, manifest, files });
  } catch { return undefined; }
}
function sameSource(a: InstalledSource | undefined, b: InstalledSource | undefined): boolean {
  return !!a && !!b && a.cwd === b.cwd && a.packageDir === b.packageDir && a.entry === b.entry && a.manifest === b.manifest && a.files === b.files;
}

/** Only a pre-evaluation snapshot bound to this exact loaded registration can
 * qualify. Never infer what ran from a subsequently edited manifest. */
function qualifyInstalled(catalog: LoadExtensionsResult, cwd: string, kind: Profile) {
  const sources = loadedInstalledSources.get(catalog);
  if (!sources?.size) return undefined;
  const profile = profiles[kind];
  const candidates = [...sources].filter(([extension, { source }]) => catalog.extensions.includes(extension) && source.cwd === realpathSync(cwd) &&
    sameSource(source, captureApprovedSource(cwd, getInstalledAddonExtensionPaths(cwd), kind)));
  if (!candidates.length) return undefined;
  if (candidates.length !== 1) throw Error(`Ambiguous installed ${profile.label} package`);
  const [extension, { source, definition, execute, declaration, handlerMap, handlers, tools, commands }] = candidates[0]!;
  const assertCurrent = () => {
    if (!catalog.extensions.includes(extension) || resolve(extension.resolvedPath) !== source.entry ||
      !sameSource(source, captureApprovedSource(cwd, getInstalledAddonExtensionPaths(cwd), kind))) throw Error(`Installed ${profile.label} source changed`);
    const names = kind === "observability" ? [] : kind === "goal" ? ["get_goal", "create_goal", "goal_complete", "goal_stop", "update_goal"] : [kind];
    if (definition?.name !== names[0] || extension.tools.size !== names.length || tools.length !== names.length ||
      names.some(name => !tools.some(prior => prior.name === name && extension.tools.get(name)?.definition === prior.definition && prior.definition.execute === prior.execute && JSON.stringify(prior.definition) === prior.declaration)) ||
      definition?.execute !== execute || JSON.stringify(definition) !== declaration || extension.handlers !== handlerMap ||
      extension.handlers.size !== profile.events.length || (profile.events as readonly string[]).some(event => {
        const current = extension.handlers.get(event) ?? [], prior = handlers.get(event) ?? [];
        return !prior.length || current.length !== prior.length || current.some((handler, i) => handler !== prior[i]);
      }) || (kind === "goal" ? commands.length !== 1 || commands[0]?.name !== "goal" || extension.commands.size !== 1 || extension.commands.get("goal") !== commands[0].command || commands[0].command.handler !== commands[0].handler || commands[0].command.getArgumentCompletions !== commands[0].completions || JSON.stringify(commands[0].command) !== commands[0].declaration : extension.commands.size !== 0) || extension.shortcuts.size) throw Error(`Unqualified ${profile.label} capabilities`);
  };
  assertCurrent();
  return Object.freeze({ extension, source, definition, assertCurrent });
}
function qualifyInstalledTool(catalog: LoadExtensionsResult, cwd: string, kind: Exclude<Profile, "observability">) {
  const qualified = qualifyInstalled(catalog, cwd, kind);
  if (!qualified) return undefined;
  if (!qualified.definition) throw Error("Installed native tool declaration required");
  return Object.freeze({ ...qualified, definition: qualified.definition });
}
export type GoalNativeExports = Parameters<typeof import("./host-goal-config.js").createHostGoalConfig>[0]
  & Parameters<typeof import("./host-goal-input.js").createHostGoalInput>[0]
  & Parameters<typeof import("./host-goal-prompt.js").createHostGoalPrompt>[0]
  & Parameters<typeof import("./host-goal-settlement.js").createHostGoalSettlement>[0]
  & Parameters<typeof import("./host-goal-plan.js").createHostGoalPlanReader>[2]
  & Parameters<typeof import("./host-goal-command.js").createHostGoalCommand>[0]
  & Parameters<typeof import("./host-goal-progress.js").createHostGoalProgressReader>[0]
  & NonNullable<Parameters<typeof import("./host-goal-settlement.js").createHostGoalSettlement>[1]["continuation"]>["addon"]
  & { createGoalTools: Parameters<typeof import("./host-goal-tools.js").createHostGoalTools>[0]; decideGoalPlanProgress: (...args: any[]) => unknown };
/** Exact source and declaration qualification; application installs native lifecycle. */
export async function qualifyInstalledGoal(catalog: LoadExtensionsResult, cwd: string) {
  const qualified = qualifyInstalledTool(catalog, cwd, "goal");
  if (!qualified) return undefined;
  const exports = await import(pathToFileURL(qualified.source.entry).href);
  const names = ["createGoalTools", "loadThreadGoal", "buildGoalSystemPrompt", "buildGoalBudgetLimitPrompt", "buildVisibleGoalPrompt", "claimGoalBudgetWrapup", "isGoalBudgetInput", "prepareGoalInput", "goalInputIdentity", "resolveGoalInput", "accountGoalProgress", "accountTerminalGoalProgress", "shouldContinueGoalAfterMessage", "decideGoalPlanProgress", "applyGoalPlanProgress", "summarizeGoalPlan", "isGoalProgressTool", "applyGoalCommand", "applyGoalConfig", "goalResponse"] as const;
  qualified.assertCurrent();
  if (names.some(name => typeof exports[name] !== "function")) throw Error("Goal public native exports required");
  const addon = Object.freeze(Object.fromEntries(names.map(name => [name, exports[name]]))) as unknown as GoalNativeExports;
  // The native collector must expose the same declarations as this exact loaded
  // registration. Collecting tools does not execute them or run legacy hooks.
  const native = addon.createGoalTools(() => { throw Error("Invocation-local Goal scope required"); }) as ToolDefinition[];
  if (native.length !== qualified.extension.tools.size || new Set(native.map(tool => tool.name)).size !== native.length || native.some(tool => {
    const loaded = qualified.extension.tools.get(tool.name)?.definition;
    return !loaded || typeof tool.execute !== "function" || JSON.stringify(tool) !== JSON.stringify(loaded);
  })) throw Error("Goal native/legacy declarations differ");
  return Object.freeze({ ...qualified, addon, assertCurrent() {
    qualified.assertCurrent();
    if (names.some(name => exports[name] !== addon[name])) throw Error("Goal public exports changed");
  } });
}
export async function qualifyInstalledPlan(catalog: LoadExtensionsResult, cwd: string) {
  const qualified = qualifyInstalledTool(catalog, cwd, "plan");
  if (!qualified) return undefined;
  const { source, assertCurrent } = qualified;
  const exports = await import(pathToFileURL(source.entry).href) as Partial<PlanPromptExports>;
  assertCurrent();
  if (typeof exports.parsePlanMarkdown !== "function" || typeof exports.loadSessionPlan !== "function" || typeof exports.buildPlanSystemPrompt !== "function" || typeof exports.buildPlanTurnMessage !== "function" || typeof exports.createPlanTool !== "function") throw Error("Installed Plan prompt exports required");
  const addon: PlanPromptExports = Object.freeze({ createPlanTool: exports.createPlanTool, parsePlanMarkdown: exports.parsePlanMarkdown, loadSessionPlan: exports.loadSessionPlan, buildPlanSystemPrompt: exports.buildPlanSystemPrompt, buildPlanTurnMessage: exports.buildPlanTurnMessage });
  return Object.freeze({ ...qualified, addon });
}

export interface DelegatePolicyExports {
  buildModelCandidates(models: { provider: string; id: string; fullId: string }[], config: unknown): { id: string }[];
}
export async function qualifyInstalledDelegate(catalog: LoadExtensionsResult, cwd: string) {
  const qualified = qualifyInstalledTool(catalog, cwd, "delegate");
  if (!qualified) return undefined;
  const exports = await import(pathToFileURL(join(qualified.source.packageDir, "delegate.ts")).href) as Partial<DelegatePolicyExports>;
  qualified.assertCurrent();
  if (typeof exports.buildModelCandidates !== "function") throw Error("Delegate policy export required");
  return Object.freeze({ ...qualified, buildModelCandidates: exports.buildModelCandidates,
    nativeLifecycle: Object.freeze({ kind: "native-parent-model-read-only" as const, events: profiles.delegate.events }) });
}

export async function qualifyInstalledCodeReview(catalog: LoadExtensionsResult, cwd: string) {
  const qualified = qualifyInstalledTool(catalog, cwd, "code_review");
  if (!qualified) return undefined;
  // Native import is the same canonical runtime module used by startup and the
  // direct add-on API. Legacy loader execute is never called by the native port.
  const exports = await import(pathToFileURL(qualified.source.entry).href) as Partial<CodeReviewNativeExports>;
  qualified.assertCurrent();
  const names = ["createCodeReviewTool", "reviewService", "prepareReviewService", "setReviewDatabaseSource", "closeReviewServices"] as const;
  if (names.some(name => typeof exports[name] !== "function")) throw Error("Code Review public native exports required");
  const addon = Object.freeze(Object.fromEntries(names.map(name => [name, exports[name]]))) as unknown as CodeReviewNativeExports;
  const native = addon.createCodeReviewTool({ async resolve() { throw Error("Invocation-local review scope required"); } });
  const declaration = (value: Pick<typeof native, "name" | "label" | "description" | "parameters">) => JSON.stringify({ name: value.name, label: value.label, description: value.description, parameters: value.parameters });
  if (declaration(native) !== declaration(qualified.definition)) throw Error("Code Review native/legacy declarations differ");
  const assertCurrent = () => {
    qualified.assertCurrent();
    if (names.some(name => exports[name] !== addon[name])) throw Error("Code Review public exports changed");
  };
  return Object.freeze({ ...qualified, assertCurrent, addon });
}

export async function qualifyInstalledDrawio(catalog: LoadExtensionsResult, cwd: string) {
  const qualified = qualifyInstalledTool(catalog, cwd, "open_drawio_editor");
  if (!qualified) return undefined;
  const exports = await import(pathToFileURL(qualified.source.entry).href) as Partial<DrawioNativeExports>;
  qualified.assertCurrent();
  const names = ["createDrawioEditorTool", "bindDrawioVendorHost", "getDrawioVendorCacheDir", "handleRoute"] as const;
  if (names.some(name => typeof exports[name] !== "function")) throw Error("Draw.io public native exports required");
  const addon = Object.freeze(Object.fromEntries(names.map(name => [name, exports[name]]))) as unknown as DrawioNativeExports;
  const declaration = (tool: Pick<ReturnType<DrawioNativeExports["createDrawioEditorTool"]>, "name" | "label" | "description" | "parameters">) => JSON.stringify({ name: tool.name, label: tool.label, description: tool.description, parameters: tool.parameters });
  if (declaration(addon.createDrawioEditorTool()) !== declaration(qualified.definition)) throw Error("Draw.io native/legacy declarations differ");
  return Object.freeze({ ...qualified, addon, assertCurrent() {
    qualified.assertCurrent();
    if (names.some(name => exports[name] !== addon[name])) throw Error("Draw.io public exports changed");
  } });
}

export function qualifyInstalledOfficeViewer(catalog: LoadExtensionsResult, cwd: string) {
  return qualifyInstalledTool(catalog, cwd, "open_office_viewer");
}

export async function qualifyInstalledEditableTable(catalog: LoadExtensionsResult, cwd: string) {
  const qualified = qualifyInstalledTool(catalog, cwd, "editable_table");
  if (!qualified) return undefined;
  const exports = await import(pathToFileURL(qualified.source.entry).href) as Partial<EditableTableNativeExports>;
  qualified.assertCurrent();
  if (typeof exports.createEditableTableTool !== "function") throw Error("Editable table public factory required");
  const factory = exports.createEditableTableTool;
  const native = factory();
  const declaration = (tool: typeof native) => JSON.stringify({ name: tool.name, label: tool.label, description: tool.description, parameters: tool.parameters });
  if (declaration(native) !== declaration(qualified.definition as typeof native)) throw Error("Editable table native/legacy declarations differ");
  return Object.freeze({ ...qualified, addon: Object.freeze({ createEditableTableTool: factory }), assertCurrent() { qualified.assertCurrent(); if (exports.createEditableTableTool !== factory) throw Error("Editable table factory changed"); } });
}

function captureApplicationSources(cwd: string) {
  const installedEntries = getInstalledAddonExtensionPaths(cwd);
  const snapshots = (Object.keys(sourceProfiles) as SourceProfile[]).map(kind => {
    const before = captureApprovedSource(cwd, installedEntries, kind);
    const profile = sourceProfiles[kind];
    const entry = before?.entry ?? join(realpathSync(cwd), ".pi/extensions/node_modules", kind === "eml-viewer" && existsSync(join(cwd, ".pi/extensions/node_modules/piclaw-addon-eml-viewer")) ? "piclaw-addon-eml-viewer" : profile.name, "entry" in profile ? profile.entry || "package.json" : "index.ts");
    return { kind, before, entry };
  });
  return {installedEntries,snapshots};
}
function assertApprovedApplicationSources(cwd: string, {installedEntries,snapshots}: ReturnType<typeof captureApplicationSources>) {
  // Classification MUST precede loader.reload(): unknown factories can perform
  // module-level I/O even when their eventual registrations are rejected.
  const approvedPackages = new Set(snapshots.flatMap(snapshot => snapshot.before ? [snapshot.before.packageDir] : []));
  for (const packageDir of listInstalledAddonPackageDirs(join(cwd, ".pi/extensions/node_modules"))) {
    const manifest = readInstalledAddonPackage(packageDir)?.manifest;
    if ((manifest?.name?.includes("piclaw-addon-") || manifest?.pi) && !approvedPackages.has(packageDir))
      throw Error(`Unqualified installed add-on package before evaluation: ${packageDir}`);
  }
  const approvedEntries = new Set(snapshots.filter(snapshot => snapshot.before).map(snapshot => snapshot.entry));
  for (const entry of installedEntries) {
    if (!approvedEntries.has(resolve(entry)))
      throw Error(`Unqualified installed extension source before evaluation: ${entry}`);
  }
}

/** Same read-only pre-evaluation gate used by the actual loader; never evaluates
 * factories, donates qualification receipts, or mutates loader cache provenance. */
export function auditInstalledApplicationAddonSources(cwd: string) {
  const captured=captureApplicationSources(cwd);
  assertApprovedApplicationSources(cwd,captured);
  return {expectedProfiles:Object.values(sourceProfiles).map(({name,version})=>({name,version})),profiles:captured.snapshots.flatMap(({kind,before,entry})=>before?[{kind,name:sourceProfiles[kind].name,version:sourceProfiles[kind].version,packageDir:before.packageDir,entry}]:[])};
}

/** The public Pi registry, not a second registerTool implementation. Factories
 * run once at application startup, without AgentSession or SessionManager.
 * No action stubs are rebound and no native extension context is fabricated. */
export async function loadApplicationExtensionCatalog(options: {
  cwd: string;
  agentDir: string;
  settingsManager: SettingsManager;
}): Promise<LoadExtensionsResult> {
  const captured=captureApplicationSources(options.cwd),{installedEntries,snapshots}=captured;
  for(const {kind,before,entry} of snapshots){
    if(attemptedInstalledSources.has(entry)&&!sameSource(attemptedInstalledSources.get(entry),before)){
      attemptedInstalledSources.set(entry,undefined);
      throw Error(`Installed ${sourceProfiles[kind].label} loader cache provenance changed; process restart required`);
    }
    if(existsSync(entry))attemptedInstalledSources.set(entry,before);
  }
  assertApprovedApplicationSources(options.cwd,captured);
  const loader = new DefaultResourceLoader({ ...options,
    additionalExtensionPaths: installedEntries, noExtensions: true,
    noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true,
  });
  try {
    await loader.reload();
  } finally {
    for (const { kind, before, entry } of snapshots) if (existsSync(entry) || attemptedInstalledSources.has(entry)) {
      if (!sameSource(before, captureApprovedSource(options.cwd, getInstalledAddonExtensionPaths(options.cwd), kind))) attemptedInstalledSources.set(entry, undefined);
    }
  }
  const catalog = loader.getExtensions();
  const sources = new Map<Extension, InstalledRegistration>();
  for (const { kind, before } of snapshots) if (before && sameSource(before, captureApprovedSource(options.cwd, getInstalledAddonExtensionPaths(options.cwd), kind))) {
    for (const extension of catalog.extensions) {
      const definition = extension.tools.get(kind === "goal" ? "get_goal" : kind)?.definition;
      if (resolve(extension.resolvedPath) === before.entry && (definition || kind === "observability" || kind in installedAddonProfiles)) sources.set(extension, Object.freeze({
        source: before, definition, execute: definition?.execute, declaration: JSON.stringify(definition), handlerMap: extension.handlers,
        tools: [...extension.tools].map(([name, { definition }]) => Object.freeze({ name, definition, execute: definition.execute, declaration: JSON.stringify(definition) })),
        commands: [...extension.commands].map(([name, command]) => Object.freeze({ name, command, handler: command.handler, completions: command.getArgumentCompletions, declaration: JSON.stringify(command) })),
        handlers: new Map([...extension.handlers].map(([event, handlers]) => [event, Object.freeze([...handlers])])),
      }));
    }
  }
  loadedInstalledSources.set(catalog, sources);
  loadedProfileSources.set(catalog, new Map(snapshots.flatMap(({ kind, before }) => before ? [[kind, before] as const] : [])));
  return catalog;
}

export async function qualifyInstalledRestic(catalog: LoadExtensionsResult, cwd: string) {
  const qualified = qualifyInstalledTool(catalog, cwd, "restic");
  if (!qualified) return undefined;
  const exports = await import(pathToFileURL(qualified.source.entry).href) as Partial<import("./host-restic-tool.js").ResticNativeExports>;
  qualified.assertCurrent();
  if (typeof exports.createResticTool !== "function") throw Error("Restic native factory required");
  const factory = exports.createResticTool;
  if (JSON.stringify(factory(() => { throw Error("Invocation-local Restic authority required"); })) !== JSON.stringify(qualified.definition)) throw Error("Restic native/legacy declarations differ");
  return Object.freeze({ ...qualified, addon: Object.freeze({ createResticTool: factory }), assertCurrent() {
    qualified.assertCurrent(); if (exports.createResticTool !== factory) throw Error("Restic public factory changed");
  } });
}
export async function qualifyInstalledObservability(catalog: LoadExtensionsResult, cwd: string) {
  const qualified = qualifyInstalled(catalog, cwd, "observability");
  if (!qualified) return undefined;
  const exports = await import(pathToFileURL(qualified.source.entry).href) as Partial<import("./host-observability.js").ObservabilityNativeExports>;
  qualified.assertCurrent();
  if (typeof exports.bindObservabilityConfiguration !== "function" || typeof exports.prepareObservabilityRuntime !== "function" || typeof exports.buildObservabilitySystemPrompt !== "function") throw Error("Observability native lifecycle exports required");
  const addon = Object.freeze({ bindObservabilityConfiguration: exports.bindObservabilityConfiguration, prepareObservabilityRuntime: exports.prepareObservabilityRuntime, buildObservabilitySystemPrompt: exports.buildObservabilitySystemPrompt });
  return Object.freeze({ ...qualified, addon, assertCurrent() {
    qualified.assertCurrent();
    if (exports.bindObservabilityConfiguration !== addon.bindObservabilityConfiguration || exports.prepareObservabilityRuntime !== addon.prepareObservabilityRuntime || exports.buildObservabilitySystemPrompt !== addon.buildObservabilitySystemPrompt) throw Error("Observability public exports changed");
  } });
}

/** Fail closed until a real invocation-local, operation-owned effect port is
 * supplied by the application host. A readOnlyHint, tool name, factory capture,
 * or pre/post execute check is not such a port. In particular, do not run tool
 * hooks through a fabricated AgentSession context. Keep all diagnostics so a
 * successful startup can never silently mean missing installed capabilities.
 */
export function assertApplicationExtensionCatalogSupported(catalog: LoadExtensionsResult, plan?: Awaited<ReturnType<typeof qualifyInstalledPlan>>, delegate?: Awaited<ReturnType<typeof qualifyInstalledDelegate>>, codeReview?: Awaited<ReturnType<typeof qualifyInstalledCodeReview>>, editableTable?: Awaited<ReturnType<typeof qualifyInstalledEditableTable>>, officeViewer?: ReturnType<typeof qualifyInstalledOfficeViewer>, drawio?: Awaited<ReturnType<typeof qualifyInstalledDrawio>>, goal?: Awaited<ReturnType<typeof qualifyInstalledGoal>>, observability?: Awaited<ReturnType<typeof qualifyInstalledObservability>>, restic?: Awaited<ReturnType<typeof qualifyInstalledRestic>>, receipts: readonly InstalledAddonBindingReceipt[] = []): void {
  const bindings = receipts.map(receipt => validateInstalledAddonReceipt(catalog, receipt));
  observability?.assertCurrent(); restic?.assertCurrent(); goal?.assertCurrent(); plan?.assertCurrent(); delegate?.assertCurrent(); codeReview?.assertCurrent(); editableTable?.assertCurrent(); officeViewer?.assertCurrent(); drawio?.assertCurrent();
  const blocked: string[] = catalog.errors.map(error => `${error.path}: extension load failed`);
  for (const [kind, source] of loadedProfileSources.get(catalog) ?? []) {
    if (!sameSource(source, captureApprovedSource(source.cwd, getInstalledAddonExtensionPaths(source.cwd), kind)))
      blocked.push(`${kind}: installed source changed`);
    if (kind in installedAddonProfiles && installedAddonProfiles[kind as InstalledAddonProfile].requiresNativeBinding && !bindings.some(binding => binding.qualified.kind === kind))
      blocked.push(`${kind}: native capabilities require explicit application binding (source qualification is not binding proof)`);
  }
  for (const extension of catalog.extensions) {
    for (const { definition } of extension.tools.values()) {
      if (bindings.some(binding => binding.qualified.extension === extension && binding.qualified.capabilities.tools.includes(definition.name))) continue;
      if (extension === restic?.extension && definition === restic.definition) continue;
      if (extension === goal?.extension && extension.tools.get(definition.name)?.definition === definition) continue;
      if (extension === plan?.extension && definition === plan.definition) continue;
      if (extension === delegate?.extension && definition === delegate.definition) continue;
      if (extension === codeReview?.extension && definition === codeReview.definition) continue;
      if (extension === editableTable?.extension && definition === editableTable.definition) continue;
      if (extension === officeViewer?.extension && definition === officeViewer.definition) continue;
      if (extension === drawio?.extension && definition === drawio.definition) continue;
      blocked.push(`${definition.name}: no operation-owned host effect port`);
    }
    for (const event of extension.handlers.keys()) {
      if (bindings.some(binding => binding.qualified.extension === extension && binding.qualified.capabilities.events.includes(event))) continue;
      if (extension === observability?.extension && (profiles.observability.events as readonly string[]).includes(event)) continue; // Native request hook, process startup and static skill metadata.
      if (extension === goal?.extension) continue; // Replaced by native request/terminal hooks, not invoked.
      if (extension === plan?.extension && event === "before_agent_start") continue;
      // Static skill discovery only: no session lifecycle or fabricated context.
      if (extension === codeReview?.extension && event === "resources_discover") continue;
      if (extension === editableTable?.extension && event === "resources_discover") continue;
      if (extension === delegate?.extension && delegate.nativeLifecycle.events.some(allowed => allowed === event)) continue;
      blocked.push(`${extension.path}: ${event} lifecycle not bound to durable host`);
    }
    if ((extension.commands.size || extension.shortcuts.size) && extension !== goal?.extension && !bindings.some(binding => binding.qualified.extension === extension && !extension.shortcuts.size)) {
      blocked.push(`${extension.path}: session commands/shortcuts not bound to durable host`);
    }
  }
  // Queued provider/MCP/action registrations must not disappear merely because
  // this application lifetime has no ExtensionRunner.bindCore/session_start.
  const runtime = catalog.runtime;
  if ([...runtime.pendingProviderRegistrations, ...runtime.pendingNativeProviderRegistrations, ...runtime.pendingVirtualModelRegistrations].some(registration => !bindings.some(binding => binding.providerRegistrations.includes(registration))) || runtime.mcpServers.list().length) {
    blocked.push("extension provider/MCP registrations not bound to durable host");
  }
  if (blocked.length) throw new Error(`Durable extension qualification required:\n${blocked.join("\n")}`);
}

/** Source/export qualification is NOT a host binding receipt. In particular Codex
 * provider registration remains pending until the physical dispatch owner binds
 * it. The application support assertion deliberately grants no new exemptions.
 */
export function assertInstalledNativeExports(exports: Record<string, unknown>, names: readonly string[], label: string): void {
  if (names.some(name => typeof exports[name] !== "function")) throw Error(`Installed ${label} native exports required`);
}
export async function qualifyInstalledAddon(catalog: LoadExtensionsResult, cwd: string, kind: InstalledAddonProfile) {
  const profile = installedAddonProfiles[kind];
  const source = loadedProfileSources.get(catalog)?.get(kind);
  if (!source) return undefined;
  const extension = catalog.extensions.find(extension => resolve(extension.resolvedPath) === source.entry);
  if (profile.entry && !extension) throw Error(`Installed ${kind} registration missing`);
  const prior = extension && loadedInstalledSources.get(catalog)?.get(extension);
  const modules: { file: string; exports: Record<string, unknown>; functions: Readonly<Record<string, unknown>> }[] = [];
  const assertCurrent = () => {
    if (!sameSource(source, captureApprovedSource(cwd, getInstalledAddonExtensionPaths(cwd), kind))) throw Error(`Installed ${kind} source changed`);
    if (extension) {
      if (!prior || !catalog.extensions.includes(extension) || extension.handlers !== prior.handlerMap ||
        extension.tools.size !== prior.tools.length || extension.commands.size !== prior.commands.length || extension.shortcuts.size ||
        prior.tools.some(tool => extension.tools.get(tool.name)?.definition !== tool.definition || tool.definition.execute !== tool.execute || JSON.stringify(tool.definition) !== tool.declaration) ||
        prior.commands.some(command => extension.commands.get(command.name) !== command.command || command.command.handler !== command.handler || command.command.getArgumentCompletions !== command.completions || JSON.stringify(command.command) !== command.declaration) ||
        extension.handlers.size !== prior.handlers.size || [...prior.handlers].some(([event, handlers]) => {
          const current = extension.handlers.get(event);
          return !current || current.length !== handlers.length || current.some((handler, index) => handler !== handlers[index]);
        })) throw Error(`Installed ${kind} capabilities changed`);
    }
    for (const module of modules) for (const [name, fn] of Object.entries(module.functions))
      if (module.exports[name] !== fn) throw Error(`Installed ${kind} native export changed: ${name}`);
  };
  assertCurrent();
  for (const [file, names] of Object.entries(profile.nativeExports)) {
    const exports = await import(pathToFileURL(join(source.packageDir, file)).href);
    assertCurrent();
    assertInstalledNativeExports(exports, names, `${kind}: ${file}`);
    modules.push({ file, exports, functions: Object.freeze(Object.fromEntries((names as readonly string[]).map(name => [name, exports[name]]))) });
  }
  assertCurrent();
  const qualified = Object.freeze({
    kind, source, extension, assertCurrent,
    nativeExports: Object.freeze(Object.fromEntries(modules.map(module => [module.file, module.functions]))),
    // Explicit package paths; never call resources_discover with fake events.
    skillPaths: Object.freeze(profile.skillPaths.map(file => join(source.packageDir, file))),
    capabilities: Object.freeze({
      tools: Object.freeze(prior?.tools.map(tool => tool.name) ?? []),
      commands: Object.freeze(prior?.commands.map(command => command.name) ?? []),
      events: Object.freeze([...(prior?.handlers.keys() ?? [])]),
      routes: profile.routes,
      configActions: profile.configActions,
      nativeBinding: "unbound" as const,
      providerBinding: kind === "codex-conversion" ? "required-unbound" as const : "not-applicable" as const,
    }),
  });
  qualifiedAddonCatalogs.set(qualified, catalog);
  return qualified;
}

type QualifiedInstalledAddon = NonNullable<Awaited<ReturnType<typeof qualifyInstalledAddon>>>;
const qualifiedAddonCatalogs = new WeakMap<object, LoadExtensionsResult>();
declare const receiptBrand: unique symbol;
export type InstalledAddonBindingReceipt = Readonly<{ [receiptBrand]: true }>;
export interface InstalledAddonBindings {
  tools: readonly object[];
  lifecycle: Readonly<Record<string, (...args: any[]) => unknown>>;
  commands: Readonly<Record<string, (...args: any[]) => unknown>>;
  provider?: { assertCurrent(): void; registrations: readonly object[] };
  resources?: { assertCurrent(): void };
}
const addonBindingReceipts = new WeakMap<object, { qualified: QualifiedInstalledAddon; assertCurrent(): void; providerRegistrations: readonly object[] }>();
/** Trusted application composition-root API. The root supplies real native host
 * hooks/instances, never legacy handlers. This proves bridge identity and complete
 * wiring, NOT the semantics/safety of arbitrary callbacks (qualified factory tests
 * own that proof). Keep this constructor out of untrusted extension APIs.
 */
export function bindInstalledAddon(qualified: QualifiedInstalledAddon, binding: InstalledAddonBindings): InstalledAddonBindingReceipt {
  const catalog = qualifiedAddonCatalogs.get(qualified);
  if (!catalog) throw Error("Qualified installed add-on identity required");
  const prior = qualified.extension && loadedInstalledSources.get(catalog)?.get(qualified.extension);
  const tools = [...binding.tools], lifecycle = { ...binding.lifecycle }, commands = { ...binding.commands };
  const provider = binding.provider, resources = binding.resources;
  const providerAssertion = provider?.assertCurrent, resourceAssertion = resources?.assertCurrent;
  const providerRegistrations = Object.freeze([...(provider?.registrations ?? [])]);
  const exact = (actual: Record<string, unknown>, expected: readonly string[]) => {
    if (Object.keys(actual).length !== expected.length || expected.some(key => typeof actual[key] !== "function")) throw Error("Incomplete native capability binding");
  };
  const assertCurrent = () => {
    qualified.assertCurrent();
    if (tools.length !== (prior?.tools.length ?? 0) || new Set(tools).size !== tools.length) throw Error("Incomplete native tool binding");
    (prior?.tools ?? []).forEach((tool, index) => assertHostToolDeclaration(tools[index]!, tool.definition));
    exact(lifecycle, qualified.capabilities.events); exact(commands, qualified.capabilities.commands);
    const legacy = [...(prior?.handlers.values() ?? [])].flat();
    if ([...Object.values(lifecycle), ...Object.values(commands)].some(fn => legacy.includes(fn) || prior?.commands.some(command => command.handler === fn))) throw Error("Legacy handler is not a native binding");
    if (qualified.capabilities.providerBinding === "required-unbound" && (!provider || !providerRegistrations.length)) throw Error("Native provider binding required");
    if (provider) {
      if (provider.assertCurrent !== providerAssertion || provider.registrations.length !== providerRegistrations.length || provider.registrations.some((item, index) => item !== providerRegistrations[index])) throw Error("Provider binding changed");
      const pending = [...catalog.runtime.pendingProviderRegistrations, ...catalog.runtime.pendingNativeProviderRegistrations, ...catalog.runtime.pendingVirtualModelRegistrations];
      if (providerRegistrations.some(item => !pending.includes(item as never))) throw Error("Foreign provider registration");
      provider.assertCurrent();
    }
    if (qualified.kind === "session-dashboard" && !resources) throw Error("Dashboard native resources required");
    if (resources) { if (resources.assertCurrent !== resourceAssertion) throw Error("Resource binding changed"); resources.assertCurrent(); }
  };
  assertCurrent();
  const receipt = Object.freeze({}) as InstalledAddonBindingReceipt;
  addonBindingReceipts.set(receipt, { qualified, assertCurrent, providerRegistrations });
  return receipt;
}
function validateInstalledAddonReceipt(catalog: LoadExtensionsResult, receipt: InstalledAddonBindingReceipt) {
  const binding = addonBindingReceipts.get(receipt);
  if (!binding || qualifiedAddonCatalogs.get(binding.qualified) !== catalog || !Object.isFrozen(receipt)) throw Error("Native receipt catalog identity required");
  binding.assertCurrent();
  return binding;
}
