import { DefaultResourceLoader, type LoadExtensionsResult, type SettingsManager } from "../../../node_modules/@earendil-works/pi-coding-agent";
import { getInstalledAddonExtensionPaths, resolveAddonPackageEntries } from "../../src/addons/package-entries.js";
import { join, resolve, relative, isAbsolute } from "node:path";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";
export interface PlanPromptExports {
  loadSessionPlan(chatJid: string): { chat_jid: string; markdown: string; updated_at: string | null };
  buildPlanSystemPrompt(plan: ReturnType<PlanPromptExports["loadSessionPlan"]>): string;
  buildPlanTurnMessage(plan: ReturnType<PlanPromptExports["loadSessionPlan"]>): { customType: string; content: { type: "text"; text: string }[]; display: boolean } | undefined;
}

// Core policy for the effect proof in qualification/plan.test.ts. This is not
// an add-on lockfile: other installed content still loads, but gets no exemption.
const approvedPlanFiles = Object.freeze({
  "index.ts": "b923bff190da94777aaf849667f7a8833be0fae04b76dc3748337552ae642dc8",
  "compat/chat-context.ts": "8cfa6c16f0a27308ecc665f80ba107064d4fa8ac34122676ff0d1cb46e719da5",
  "compat/extension-kv.ts": "04240517e9e8664cae2d2badb99f382100a7af3e12679cfce97087870881551c",
});
const approvedDelegateFiles = Object.freeze({
  "index.ts": "73563d26795cbab5cd92e8d5f8dabe3d7477fa11dff35e0ed8b21d9ec3f5ab51",
  "delegate.ts": "5466936c43f79c4159d75179c9f6a3f1d8d3439000e388902b321d8e7de9c923",
  "compat/extension-kv.ts": "20408155132b8b86975100f0df7fe03a57ad74d2e4bb8d30f13e2a893441d651",
});
const profiles = {
  plan: { name: "@rcarmo/piclaw-addon-plan-sidebar", version: "0.1.25", files: approvedPlanFiles, shadows: ["compat/chat-context.js", "compat/extension-kv.js", "compat/package.json"], events: ["before_agent_start"] },
  delegate: { name: "@rcarmo/piclaw-addon-delegate", version: "0.2.20", files: approvedDelegateFiles, shadows: ["delegate.js", "delegate.json", "delegate/index.js", "delegate/package.json", "compat/extension-kv.js", "compat/package.json"], events: ["session_start", "model_select", "before_agent_start"] },
} as const;
type Profile = keyof typeof profiles;
type Extension = LoadExtensionsResult["extensions"][number];
type PlanSource = Readonly<{ cwd: string; packageDir: string; entry: string; manifest: string; files: string }>;
type PlanRegistration = Readonly<{
  source: PlanSource;
  definition: NonNullable<ReturnType<Extension["tools"]["get"]>>["definition"];
  execute: NonNullable<ReturnType<Extension["tools"]["get"]>>["definition"]["execute"];
  declaration: string;
  handlerMap: Extension["handlers"];
  handlers: ReadonlyMap<string, readonly unknown[]>;
}>;
const loadedPlanSources = new WeakMap<LoadExtensionsResult, ReadonlyMap<Extension, PlanRegistration>>();
// DefaultResourceLoader's first reload may reuse a process-wide factory cache.
// The SDK root does not export its cache clear API. Remember the source BEFORE
// every application load (including rejected/failed loads), never just successful
// qualification. An unsupported first attempt permanently poisons this path for
// this process; restored bytes cannot prove which cached factory would run.
// This is cache provenance metadata, not durable ownership/adoption authority.
const attemptedPlanSources = new Map<string, PlanSource | undefined>();

function captureApprovedPlan(cwd: string, installedEntries: readonly string[], kind: Profile = "plan"): PlanSource | undefined {
  try {
    const profile = profiles[kind];
    const workspace = realpathSync(cwd);
    const packageDir = join(workspace, ".pi/extensions/node_modules", profile.name);
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
    const entry = join(packageDir, "index.ts");
    if (entries.length !== 1 || realpathSync(entries[0]!) !== entry || !installedEntries.some(path => resolve(path) === entry)) return undefined;
    // The pinned TS imports use .js specifiers. A sibling JS file would win
    // resolution and is NOT covered by the approved TS content proof.
    if (profile.shadows.some(file => existsSync(join(packageDir, file)))) return undefined;
    const files = Object.entries(profile.files).map(([file, expected]) => {
      const path = join(packageDir, file);
      if (!inside(path)) throw Error("Plan source escape");
      const digest = createHash("sha256").update(readFileSync(path)).digest("hex");
      if (digest !== expected) throw Error("Unsupported Plan source");
      return `${file}:${realpathSync(path)}:${digest}`;
    }).join("\n");
    return Object.freeze({ cwd: workspace, packageDir, entry, manifest, files });
  } catch { return undefined; }
}
function sameSource(a: PlanSource | undefined, b: PlanSource | undefined): boolean {
  return !!a && !!b && a.cwd === b.cwd && a.packageDir === b.packageDir && a.entry === b.entry && a.manifest === b.manifest && a.files === b.files;
}

/** Only a pre-evaluation snapshot bound to this exact loaded registration can
 * qualify. Never infer what ran from a subsequently edited manifest. */
function qualifyInstalled(catalog: LoadExtensionsResult, cwd: string, kind: Profile) {
  const sources = loadedPlanSources.get(catalog);
  if (!sources?.size) return undefined;
  const profile = profiles[kind];
  const candidates = [...sources].filter(([extension, { source }]) => catalog.extensions.includes(extension) && source.cwd === realpathSync(cwd) &&
    sameSource(source, captureApprovedPlan(cwd, getInstalledAddonExtensionPaths(cwd), kind)));
  if (!candidates.length) return undefined;
  if (candidates.length !== 1) throw Error("Ambiguous installed Plan package");
  const [extension, { source, definition, execute, declaration, handlerMap, handlers }] = candidates[0]!;
  const assertCurrent = () => {
    if (!catalog.extensions.includes(extension) || resolve(extension.resolvedPath) !== source.entry ||
      !sameSource(source, captureApprovedPlan(cwd, getInstalledAddonExtensionPaths(cwd), kind))) throw Error(`Installed ${kind === "plan" ? "Plan" : "Delegate"} source changed`);
    if (!definition || definition.name !== kind || extension.tools.size !== 1 || extension.tools.get(kind)?.definition !== definition || definition.execute !== execute || JSON.stringify(definition) !== declaration || extension.handlers !== handlerMap ||
      extension.handlers.size !== profile.events.length || profile.events.some(event => {
        const current = extension.handlers.get(event) ?? [], prior = handlers.get(event) ?? [];
        return !prior.length || current.length !== prior.length || current.some((handler, i) => handler !== prior[i]);
      }) || extension.commands.size || extension.shortcuts.size) throw Error(`Unqualified ${kind === "plan" ? "Plan" : "Delegate"} capabilities`);
  };
  assertCurrent();
  return Object.freeze({ extension, source, definition: definition!, assertCurrent });
}
export async function qualifyInstalledPlan(catalog: LoadExtensionsResult, cwd: string) {
  const qualified = qualifyInstalled(catalog, cwd, "plan");
  if (!qualified) return undefined;
  const { source, assertCurrent } = qualified;
  const exports = await import(pathToFileURL(source.entry).href) as Partial<PlanPromptExports>;
  assertCurrent();
  if (typeof exports.loadSessionPlan !== "function" || typeof exports.buildPlanSystemPrompt !== "function" || typeof exports.buildPlanTurnMessage !== "function") throw Error("Installed Plan prompt exports required");
  const addon: PlanPromptExports = Object.freeze({ loadSessionPlan: exports.loadSessionPlan, buildPlanSystemPrompt: exports.buildPlanSystemPrompt, buildPlanTurnMessage: exports.buildPlanTurnMessage });
  return Object.freeze({ ...qualified, addon });
}

export interface DelegatePolicyExports {
  buildModelCandidates(models: { provider: string; id: string; fullId: string }[], config: unknown): { id: string }[];
}
export async function qualifyInstalledDelegate(catalog: LoadExtensionsResult, cwd: string) {
  const qualified = qualifyInstalled(catalog, cwd, "delegate");
  if (!qualified) return undefined;
  const exports = await import(pathToFileURL(join(qualified.source.packageDir, "delegate.ts")).href) as Partial<DelegatePolicyExports>;
  qualified.assertCurrent();
  if (typeof exports.buildModelCandidates !== "function") throw Error("Delegate policy export required");
  return Object.freeze({ ...qualified, buildModelCandidates: exports.buildModelCandidates,
    nativeLifecycle: Object.freeze({ kind: "native-parent-model-read-only" as const, events: profiles.delegate.events }) });
}

/** The public Pi registry, not a second registerTool implementation. Factories
 * run once at application startup, without AgentSession or SessionManager.
 * No action stubs are rebound and no native extension context is fabricated.
 */
export async function loadApplicationExtensionCatalog(options: {
  cwd: string;
  agentDir: string;
  settingsManager: SettingsManager;
}): Promise<LoadExtensionsResult> {
  const installedEntries = getInstalledAddonExtensionPaths(options.cwd);
  const snapshots = (Object.keys(profiles) as Profile[]).map(kind => {
    const before = captureApprovedPlan(options.cwd, installedEntries, kind);
    const entry = join(realpathSync(options.cwd), ".pi/extensions/node_modules", profiles[kind].name, "index.ts");
    if (attemptedPlanSources.has(entry) && !sameSource(attemptedPlanSources.get(entry), before))
      throw Error(`Installed ${kind === "plan" ? "Plan" : "Delegate"} loader cache provenance changed; process restart required`);
    if (existsSync(entry)) attemptedPlanSources.set(entry, before);
    return { kind, before, entry };
  });
  const loader = new DefaultResourceLoader({ ...options,
    additionalExtensionPaths: installedEntries,
    noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true,
  });
  try {
    await loader.reload();
  } finally {
    for (const { kind, before, entry } of snapshots) if (existsSync(entry) || attemptedPlanSources.has(entry)) {
      if (!sameSource(before, captureApprovedPlan(options.cwd, getInstalledAddonExtensionPaths(options.cwd), kind))) attemptedPlanSources.set(entry, undefined);
    }
  }
  const catalog = loader.getExtensions();
  const sources = new Map<Extension, PlanRegistration>();
  for (const { kind, before } of snapshots) if (before && sameSource(before, captureApprovedPlan(options.cwd, getInstalledAddonExtensionPaths(options.cwd), kind))) {
    for (const extension of catalog.extensions) {
      const definition = extension.tools.get(kind)?.definition;
      if (resolve(extension.resolvedPath) === before.entry && definition) sources.set(extension, Object.freeze({
        source: before, definition, execute: definition.execute, declaration: JSON.stringify(definition), handlerMap: extension.handlers,
        handlers: new Map([...extension.handlers].map(([event, handlers]) => [event, Object.freeze([...handlers])])),
      }));
    }
  }
  loadedPlanSources.set(catalog, sources);
  return catalog;
}

/** Fail closed until a real invocation-local, operation-owned effect port is
 * supplied by the application host. A readOnlyHint, tool name, factory capture,
 * or pre/post execute check is not such a port. In particular, do not run tool
 * hooks through a fabricated AgentSession context. Keep all diagnostics so a
 * successful startup can never silently mean missing installed capabilities.
 */
export function assertApplicationExtensionCatalogSupported(catalog: LoadExtensionsResult, plan?: Awaited<ReturnType<typeof qualifyInstalledPlan>>, delegate?: Awaited<ReturnType<typeof qualifyInstalledDelegate>>): void {
  plan?.assertCurrent(); delegate?.assertCurrent();
  const blocked: string[] = catalog.errors.map(error => `${error.path}: extension load failed`);
  for (const extension of catalog.extensions) {
    for (const { definition } of extension.tools.values()) {
      if (extension === plan?.extension && definition === plan.definition) continue;
      if (extension === delegate?.extension && definition === delegate.definition) continue;
      blocked.push(`${definition.name}: no operation-owned host effect port`);
    }
    for (const event of extension.handlers.keys()) {
      if (extension === plan?.extension && event === "before_agent_start") continue;
      if (extension === delegate?.extension && delegate.nativeLifecycle.events.some(allowed => allowed === event)) continue;
      blocked.push(`${extension.path}: ${event} lifecycle not bound to durable host`);
    }
    if (extension.commands.size || extension.shortcuts.size) {
      blocked.push(`${extension.path}: session commands/shortcuts not bound to durable host`);
    }
  }
  // Queued provider/MCP/action registrations must not disappear merely because
  // this application lifetime has no ExtensionRunner.bindCore/session_start.
  const runtime = catalog.runtime;
  if (runtime.pendingProviderRegistrations.length || runtime.pendingNativeProviderRegistrations.length || runtime.pendingVirtualModelRegistrations.length || runtime.mcpServers.list().length) {
    blocked.push("extension provider/MCP registrations not bound to durable host");
  }
  if (blocked.length) throw new Error(`Durable extension qualification required:\n${blocked.join("\n")}`);
}
