import fs from "node:fs";
import path from "node:path";
import { isPathWithin } from "../utils/path-safety.js";
import { Type } from "typebox";
import type { AgentToolResult, ExtensionAPI, ExtensionFactory } from "@earendil-works/pi-coding-agent";
import { WORKSPACE_DIR } from "../core/config.js";
import {
  addDiscoveryExactPhraseMatches,
  addDiscoveryTokenMatches,
  clampDiscoveryLimit,
  finalizeDiscoveryMatches,
  normalizeDiscoveryText,
  tokenizeDiscoveryText,
  uniqueDiscoveryStrings,
} from "./discovery-match.js";
import { normalizeScriptJDoc, type ScriptDiscoveryRole, type ScriptJDoc } from "./discovery-jdoc.js";

export type ScriptCollection = "packaged-skill" | "workspace-skill" | "workspace-note";
export type ScriptScope = "packaged" | "workspace" | "all";
export type ScriptRoleFilter = ScriptDiscoveryRole | "all";

export const SCRIPT_JDOC_MARKER = "SCRIPT_JDOC:";

const ListRuntimeScriptsSchema = Type.Object({
  query: Type.Optional(Type.String({ description: "Filter by script path/summary substring." })),
  intent: Type.Optional(Type.String({ description: "Short natural-language goal for compact script recommendations." })),
  scope: Type.Optional(Type.Union([
    Type.Literal("packaged"),
    Type.Literal("workspace"),
    Type.Literal("all"),
  ], { description: "Which script roots to inspect: packaged skill-shipped scripts, workspace-owned scripts, or all (default packaged)." })),
  role: Type.Optional(Type.Union([
    Type.Literal("entrypoint"),
    Type.Literal("module"),
    Type.Literal("all"),
  ], { description: "Limit results to runnable entrypoints, helper modules, or all (default entrypoint)." })),
  limit: Type.Optional(Type.Integer({ description: "Max scripts to return (1-200).", minimum: 1, maximum: 200 })),
  include_metadata: Type.Optional(Type.Boolean({ description: "Include the parsed ScriptJDoc metadata in details." })),
});

type RuntimeScriptParams = {
  query?: string;
  intent?: string;
  scope?: ScriptScope;
  role?: ScriptRoleFilter;
  limit?: number;
  include_metadata?: boolean;
};

type ScriptRootSpec = {
  collection: ScriptCollection;
  scope: Exclude<ScriptScope, "all">;
  root: string;
  include: (absolutePath: string) => boolean;
};

export type ScriptCatalogEntry = {
  name: string;
  absolutePath: string;
  displayPath: string;
  workspacePath: string | null;
  collection: ScriptCollection;
  scope: Exclude<ScriptScope, "all">;
  role: ScriptDiscoveryRole;
  kind: "read-only" | "mutating" | "mixed";
  weight: "lightweight" | "standard" | "heavy";
  summary: string;
  metadata?: ScriptJDoc;
  invocation: {
    runner: "bun";
    script: string;
    via: "bun_run" | "bun";
    cwd: string;
  };
};

type RecommendationMatch = {
  script: ScriptCatalogEntry;
  score: number;
  matchedTerms: string[];
  matchedSources: string[];
};

const clampLimit = clampDiscoveryLimit;
const uniqueStrings = uniqueDiscoveryStrings;
const normalizeText = normalizeDiscoveryText;
const tokenizeText = tokenizeDiscoveryText;

function summarize(value: string | undefined, fallback: string): string {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  if (!text) return fallback;
  return text.length <= 160 ? text : `${text.slice(0, 159)}…`;
}

function collectExampleStrings(metadata: ScriptJDoc | undefined): string[] {
  if (!metadata?.examples?.length) return [];
  const values: string[] = [];
  for (const example of metadata.examples) {
    if (typeof example === "string") {
      values.push(example);
      continue;
    }
    for (const key of ["text", "description", "summary", "title", "name", "input", "prompt", "intent", "query"] as const) {
      if (typeof example[key] === "string" && example[key]?.trim()) {
        values.push(example[key]!.trim());
        break;
      }
    }
  }
  return uniqueStrings(values);
}

function walkTsFiles(root: string): string[] {
  if (!fs.existsSync(root)) return [];
  const results: string[] = [];
  const stack = [root];
  while (stack.length > 0) {
    const current = stack.pop()!;
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const absolutePath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(absolutePath);
        continue;
      }
      if (!entry.isFile()) continue;
      if (!absolutePath.endsWith(".ts") || absolutePath.endsWith(".d.ts")) continue;
      results.push(absolutePath);
    }
  }
  return results.sort((a, b) => a.localeCompare(b));
}

function cleanCommentLines(value: string): string {
  return value
    .split(/\r?\n/)
    .map((line) => line.replace(/^\s*\* ?/, ""))
    .join("\n")
    .trim();
}

export function extractScriptJDocJson(sourceText: string): string | null {
  const markerIndex = sourceText.indexOf(SCRIPT_JDOC_MARKER);
  if (markerIndex < 0) return null;
  const commentStart = sourceText.lastIndexOf("/**", markerIndex);
  const commentEnd = sourceText.indexOf("*/", markerIndex);
  if (commentStart < 0 || commentEnd < 0) return null;
  return cleanCommentLines(sourceText.slice(markerIndex + SCRIPT_JDOC_MARKER.length, commentEnd));
}

export function parseScriptJDocFromSource(sourceText: string): ScriptJDoc | undefined {
  const jsonText = extractScriptJDocJson(sourceText);
  if (!jsonText) return undefined;
  try {
    return normalizeScriptJDoc(JSON.parse(jsonText));
  } catch {
    return undefined;
  }
}

function detectRole(absolutePath: string, sourceText: string, metadata: ScriptJDoc | undefined): ScriptDiscoveryRole {
  if (metadata?.role) return metadata.role;
  const tokens = absolutePath.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  if (tokens.includes("helper") || tokens.includes("helpers") || tokens.includes("sidecar")) return "module";
  if (tokens.includes("scope") && tokens.includes("session")) return "module";
  if (/^#!\/.+/m.test(sourceText) || /process\.argv|Bun\.argv|parseArgs\s*\(/.test(sourceText)) return "entrypoint";
  if (absolutePath.includes(`${path.sep}runtime${path.sep}skills${path.sep}`)) return "entrypoint";
  if (absolutePath.includes(`${path.sep}skills${path.sep}`) && absolutePath.includes(`${path.sep}runtime${path.sep}extensions${path.sep}`)) return "entrypoint";
  if (absolutePath.startsWith(path.join(WORKSPACE_DIR, ".pi", "skills") + path.sep)) return "entrypoint";
  if (absolutePath.startsWith(path.join(WORKSPACE_DIR, "notes") + path.sep)) return "entrypoint";
  return "module";
}

function fallbackSummary(absolutePath: string, collection: ScriptCollection, role: ScriptDiscoveryRole): string {
  const base = path.basename(absolutePath, ".ts").replace(/[-_]+/g, " ");
  const noun = collection === "workspace-note" ? "workspace note script" : "skill script";
  return `${base.charAt(0).toUpperCase()}${base.slice(1)} ${role === "module" ? "helper module" : noun}.`;
}

function getPackageRoot(): string {
  if (process.env.PICLAW_PACKAGE_ROOT) return path.resolve(process.env.PICLAW_PACKAGE_ROOT);
  return path.resolve(import.meta.dir, "../../..");
}

function getRuntimeRoot(): string {
  if (process.env.PICLAW_RUNTIME_ROOT) return path.resolve(process.env.PICLAW_RUNTIME_ROOT);
  return path.resolve(import.meta.dir, "../..");
}

export function getScriptRoots(workspaceDir = WORKSPACE_DIR): ScriptRootSpec[] {
  const runtimeRoot = getRuntimeRoot();
  return [
    {
      collection: "packaged-skill",
      scope: "packaged",
      root: path.join(runtimeRoot, "skills"),
      include: (absolutePath) => absolutePath.includes(`${path.sep}skills${path.sep}`),
    },
    {
      collection: "packaged-skill",
      scope: "packaged",
      root: path.join(runtimeRoot, "extensions"),
      include: (absolutePath) => absolutePath.includes(`${path.sep}skills${path.sep}`),
    },
    {
      collection: "packaged-skill",
      scope: "packaged",
      root: path.join(runtimeRoot, "vendor"),
      include: (absolutePath) => absolutePath.includes(`${path.sep}skills${path.sep}`),
    },
    {
      collection: "workspace-skill",
      scope: "workspace",
      root: path.join(workspaceDir, ".pi", "skills"),
      include: (absolutePath) => absolutePath.endsWith(".ts") && !absolutePath.endsWith(".d.ts"),
    },
    {
      collection: "workspace-note",
      scope: "workspace",
      root: path.join(workspaceDir, "notes"),
      include: (absolutePath) => absolutePath.endsWith(".ts") && !absolutePath.endsWith(".d.ts"),
    },
  ];
}

function buildInvocation(absolutePath: string, workspacePath: string | null): ScriptCatalogEntry["invocation"] {
  if (workspacePath) {
    return {
      runner: "bun",
      script: workspacePath,
      via: "bun_run",
      cwd: ".",
    };
  }
  return {
    runner: "bun",
    script: absolutePath,
    via: "bun",
    cwd: path.dirname(absolutePath),
  };
}

export function loadScriptCatalogEntries(options?: { workspaceDir?: string; scope?: ScriptScope; role?: ScriptRoleFilter }): ScriptCatalogEntry[] {
  const workspaceDir = options?.workspaceDir ?? WORKSPACE_DIR;
  const scope = options?.scope ?? "packaged";
  const role = options?.role ?? "entrypoint";
  const packageRoot = getPackageRoot();

  const entries: ScriptCatalogEntry[] = [];
  for (const root of getScriptRoots(workspaceDir)) {
    if (scope !== "all" && root.scope !== scope) continue;
    for (const absolutePath of walkTsFiles(root.root)) {
      if (!root.include(absolutePath)) continue;
      const sourceText = fs.readFileSync(absolutePath, "utf8");
      const metadata = parseScriptJDocFromSource(sourceText);
      const detectedRole = detectRole(absolutePath, sourceText, metadata);
      if (role !== "all" && detectedRole !== role) continue;
      const workspacePath = isPathWithin(workspaceDir, absolutePath)
        ? path.relative(workspaceDir, absolutePath).replace(/\\/g, "/")
        : null;
      const displayPath = workspacePath || path.relative(packageRoot, absolutePath).replace(/\\/g, "/");
      entries.push({
        name: path.basename(absolutePath, ".ts"),
        absolutePath,
        displayPath,
        workspacePath,
        collection: root.collection,
        scope: root.scope,
        role: detectedRole,
        kind: metadata?.kind ?? "mixed",
        weight: metadata?.weight ?? "standard",
        summary: summarize(metadata?.summary, fallbackSummary(absolutePath, root.collection, detectedRole)),
        ...(metadata ? { metadata } : {}),
        invocation: buildInvocation(absolutePath, workspacePath),
      });
    }
  }
  return entries.sort((a, b) => a.displayPath.localeCompare(b.displayPath));
}

function filterCatalog(entries: ScriptCatalogEntry[], query: string): ScriptCatalogEntry[] {
  if (!query) return entries;
  const normalized = query.toLowerCase();
  return entries.filter((entry) =>
    entry.name.toLowerCase().includes(normalized)
    || entry.displayPath.toLowerCase().includes(normalized)
    || entry.summary.toLowerCase().includes(normalized)
    || entry.metadata?.summary?.toLowerCase().includes(normalized)
    || entry.metadata?.aliases?.some((value) => value.toLowerCase().includes(normalized))
    || entry.metadata?.domains?.some((value) => value.toLowerCase().includes(normalized))
    || entry.metadata?.verbs?.some((value) => value.toLowerCase().includes(normalized))
    || entry.metadata?.nouns?.some((value) => value.toLowerCase().includes(normalized))
    || entry.metadata?.keywords?.some((value) => value.toLowerCase().includes(normalized))
    || entry.metadata?.guidance?.some((value) => value.toLowerCase().includes(normalized))
    || collectExampleStrings(entry.metadata).some((value) => value.toLowerCase().includes(normalized)),
  );
}

const addTokenMatches = addDiscoveryTokenMatches;
const addExactPhraseMatches = addDiscoveryExactPhraseMatches;

function scoreIntent(entry: ScriptCatalogEntry, intent: string): RecommendationMatch | null {
  const normalizedIntent = normalizeText(intent);
  const intentTokens = new Set(tokenizeText(normalizedIntent));
  if (intentTokens.size === 0) return null;

  const match: RecommendationMatch = {
    script: entry,
    score: 0,
    matchedTerms: [],
    matchedSources: [],
  };

  addTokenMatches(intentTokens, [entry.name], "name", 4, match);
  addTokenMatches(intentTokens, [entry.displayPath], "path", 3, match);
  addTokenMatches(intentTokens, tokenizeText(entry.summary), "summary", 3, match);
  addTokenMatches(intentTokens, entry.metadata?.aliases, "jdoc.aliases", 3, match);
  addExactPhraseMatches(normalizedIntent, entry.metadata?.domains, "jdoc.domains", 3, match);
  addExactPhraseMatches(normalizedIntent, entry.metadata?.verbs, "jdoc.verbs", 2, match);
  addExactPhraseMatches(normalizedIntent, entry.metadata?.nouns, "jdoc.nouns", 2, match);
  addTokenMatches(intentTokens, entry.metadata?.domains, "jdoc.domains", 2, match);
  addTokenMatches(intentTokens, entry.metadata?.verbs, "jdoc.verbs", 2, match);
  addTokenMatches(intentTokens, entry.metadata?.nouns, "jdoc.nouns", 2, match);
  addTokenMatches(intentTokens, entry.metadata?.keywords, "jdoc.keywords", 1, match);
  addTokenMatches(intentTokens, collectExampleStrings(entry.metadata), "jdoc.examples", 1, match);
  addTokenMatches(intentTokens, entry.metadata?.guidance, "jdoc.guidance", 1, match);

  finalizeDiscoveryMatches(match);
  if (match.score <= 0 || match.matchedTerms.length === 0) return null;
  if (entry.role === "entrypoint") match.score += 1;
  if (entry.role === "module") match.score -= 2;
  if (entry.weight === "heavy") match.score -= 1;
  return match.score > 0 ? match : null;
}

const RUNTIME_SCRIPTS_HINT = [
  "## Script discovery",
  "Use list_scripts to discover packaged skill scripts and workspace skill/note scripts before running them.",
  "Prefer entrypoint scripts by default; helper modules are available with role=all or role=module.",
  "When a script has a workspace-relative path, prefer bun_run to execute it without a shell.",
].join("\n");

const VISIBLE_SCRIPT_HINT = "Hint: use scope=packaged|workspace|all, role=entrypoint|module|all, and prefer bun_run for workspace-relative entrypoints.";

/** Extension factory that registers list_scripts. */
export const runtimeScripts: ExtensionFactory = (pi: ExtensionAPI) => {
  pi.on("before_agent_start", async (event) => ({
    systemPrompt: `${event.systemPrompt}\n\n${RUNTIME_SCRIPTS_HINT}`,
  }));

  pi.registerTool({
    name: "list_scripts",
    label: "list_scripts",
    description: "Discover packaged skill scripts plus workspace skill/note scripts with compact summaries and bun invocation hints.",
    promptSnippet: "list_scripts: discover packaged skill or workspace scripts, then use bun_run for workspace-relative entrypoints when appropriate.",
    parameters: ListRuntimeScriptsSchema,
    async execute(_toolCallId, params: RuntimeScriptParams): Promise<AgentToolResult<Record<string, unknown>>> {
      const scope = params.scope ?? "packaged";
      const role = params.role ?? "entrypoint";
      const query = params.query?.trim().toLowerCase() || "";
      const intent = params.intent?.trim() || "";
      const limit = clampLimit(params.limit, 100);
      const includeMetadata = Boolean(params.include_metadata);
      const catalog = loadScriptCatalogEntries({ scope, role });
      const filtered = filterCatalog(catalog, query);

      if (intent) {
        const recommendations = filtered
          .map((entry) => scoreIntent(entry, intent))
          .filter((entry): entry is RecommendationMatch => Boolean(entry))
          .sort((a, b) => b.score - a.score || a.script.displayPath.localeCompare(b.script.displayPath))
          .slice(0, Math.min(limit, 8));

        if (recommendations.length === 0) {
          return {
            content: [{ type: "text", text: `No strong script recommendation for "${intent}".\n${VISIBLE_SCRIPT_HINT}` }],
            details: { total: filtered.length, count: 0, intent, query: params.query?.trim() || undefined, scope, role, scripts: [] },
          };
        }

        const lines = recommendations.map(({ script }) => `• ${script.displayPath} — ${script.summary} {${script.collection}} [${script.kind}, ${script.weight}, ${script.role}]`);
        return {
          content: [{ type: "text", text: `Recommended scripts for "${intent}": ${recommendations.length}.\n${VISIBLE_SCRIPT_HINT}\n${lines.join("\n")}` }],
          details: {
            total: filtered.length,
            count: recommendations.length,
            intent,
            query: params.query?.trim() || undefined,
            scope,
            role,
            scripts: recommendations.map(({ script, score, matchedTerms, matchedSources }) => ({
              name: script.name,
              path: script.displayPath,
              workspace_path: script.workspacePath,
              collection: script.collection,
              scope: script.scope,
              role: script.role,
              kind: script.kind,
              weight: script.weight,
              summary: script.summary,
              score,
              matched_terms: matchedTerms,
              matched_sources: matchedSources,
              invocation: script.invocation,
              ...(includeMetadata && script.metadata ? { metadata: script.metadata } : {}),
            })),
          },
        };
      }

      const scripts = filtered.slice(0, limit);
      if (scripts.length === 0) {
        return {
          content: [{ type: "text", text: query ? `No scripts found matching "${params.query}".\n${VISIBLE_SCRIPT_HINT}` : `No scripts found.\n${VISIBLE_SCRIPT_HINT}` }],
          details: { total: filtered.length, count: 0, query: params.query?.trim() || undefined, scope, role, scripts: [] },
        };
      }

      const header = query
        ? `Available scripts (filtered): ${scripts.length} of ${filtered.length}.`
        : `Available scripts: ${scripts.length} of ${filtered.length}.`;
      const lines = scripts.map((script) => `• ${script.displayPath} — ${script.summary} {${script.collection}} [${script.kind}, ${script.weight}, ${script.role}]`);
      return {
        content: [{ type: "text", text: `${header}\n${VISIBLE_SCRIPT_HINT}\n${lines.join("\n")}` }],
        details: {
          total: filtered.length,
          count: scripts.length,
          query: params.query?.trim() || undefined,
          scope,
          role,
          scripts: scripts.map((script) => ({
            name: script.name,
            path: script.displayPath,
            workspace_path: script.workspacePath,
            collection: script.collection,
            scope: script.scope,
            role: script.role,
            kind: script.kind,
            weight: script.weight,
            summary: script.summary,
            invocation: script.invocation,
            ...(includeMetadata && script.metadata ? { metadata: script.metadata } : {}),
          })),
        },
      };
    },
  });
};
