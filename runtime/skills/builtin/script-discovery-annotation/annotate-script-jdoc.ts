#!/usr/bin/env bun
/**
 * SCRIPT_JDOC:
 * {
 *   "summary": "Annotate or validate SCRIPT_JDOC metadata for skill-shipped and workspace scripts.",
 *   "aliases": [
 *     "annotate script jdoc",
 *     "script discovery annotation"
 *   ],
 *   "domains": [
 *     "scripts",
 *     "discovery"
 *   ],
 *   "verbs": [
 *     "annotate"
 *   ],
 *   "nouns": [
 *     "script",
 *     "jdoc",
 *     "metadata"
 *   ],
 *   "keywords": [
 *     "script_jdoc",
 *     "discoverability",
 *     "skill scripts",
 *     "workspace scripts"
 *   ],
 *   "guidance": [
 *     "Runnable script entrypoint.",
 *     "Packaged script surface."
 *   ],
 *   "examples": [
 *     "annotate a skill script with SCRIPT_JDOC",
 *     "check script discovery metadata"
 *   ],
 *   "kind": "mutating",
 *   "weight": "lightweight",
 *   "role": "entrypoint"
 * }
 */
/**
 * Annotate TypeScript scripts with SCRIPT_JDOC discovery metadata.
 *
 * Usage:
 *   bun ./annotate-script-jdoc.ts --path <file-or-dir> [--path <file-or-dir> ...] [--write] [--force]
 *   bun ./annotate-script-jdoc.ts --path <file-or-dir> --check
 *   bun ./annotate-script-jdoc.ts --path <file-or-dir> --write --role module
 */

import fs from "node:fs";
import path from "node:path";

type ScriptRole = "entrypoint" | "module";
type ScriptKind = "read-only" | "mutating" | "mixed";
type ScriptWeight = "lightweight" | "standard" | "heavy";

type ScriptJDoc = {
  summary: string;
  aliases: string[];
  domains: string[];
  verbs: string[];
  nouns: string[];
  keywords: string[];
  guidance: string[];
  examples: string[];
  kind: ScriptKind;
  weight: ScriptWeight;
  role: ScriptRole;
};

type Options = {
  paths: string[];
  write: boolean;
  force: boolean;
  check: boolean;
  role?: ScriptRole;
  kind?: ScriptKind;
  weight?: ScriptWeight;
};

const SCRIPT_JDOC_MARKER = "SCRIPT_JDOC:";
const ignoredContextTokens = new Set([
  "workspace", "piclaw", "runtime", "scripts", "script", "skills", "skill", "operator", "builtin", "integrations", "extensions", "vendor", "pi",
]);
const verbWords = new Set([
  "attach", "audit", "bootstrap", "build", "chart", "check", "cleanup", "compare", "compute", "create", "delete", "digest", "download", "export", "fetch", "generate", "harness", "inspect", "list", "move", "post", "proxy", "query", "render", "report", "resume", "run", "search", "send", "set", "share", "stamp", "start", "status", "stop", "summarize", "sync", "test", "update", "upsert", "validate", "vendor",
]);
const domainHints = [
  "azure", "openai", "m365", "teams", "mail", "onedrive", "sharepoint", "proxmox", "portainer", "playwright", "graphite", "token", "twitter", "search", "timeline", "kanban", "totp", "qr", "feed", "digest", "vnc", "web", "auth", "terminal", "office", "mermaid", "pdf", "container", "vm", "lxc", "usb", "storage", "notes",
];

function printUsage(): void {
  console.log("Usage: bun ./annotate-script-jdoc.ts --path <file-or-dir> [--path <file-or-dir> ...] [--write] [--force] [--check] [--role entrypoint|module] [--kind read-only|mutating|mixed] [--weight lightweight|standard|heavy]");
}

function parseArgs(argv: string[]): Options {
  const paths: string[] = [];
  let write = false;
  let force = false;
  let check = false;
  let role: ScriptRole | undefined;
  let kind: ScriptKind | undefined;
  let weight: ScriptWeight | undefined;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--path") {
      const value = argv[i + 1];
      if (!value) throw new Error("--path requires a value");
      paths.push(value);
      i += 1;
      continue;
    }
    if (arg.startsWith("--path=")) {
      paths.push(arg.slice("--path=".length));
      continue;
    }
    if (arg === "--write") {
      write = true;
      continue;
    }
    if (arg === "--force") {
      force = true;
      continue;
    }
    if (arg === "--check") {
      check = true;
      continue;
    }
    if (arg === "--role") {
      const value = argv[i + 1];
      if (value !== "entrypoint" && value !== "module") throw new Error("--role must be entrypoint or module");
      role = value;
      i += 1;
      continue;
    }
    if (arg.startsWith("--role=")) {
      const value = arg.slice("--role=".length);
      if (value !== "entrypoint" && value !== "module") throw new Error("--role must be entrypoint or module");
      role = value;
      continue;
    }
    if (arg === "--kind") {
      const value = argv[i + 1];
      if (value !== "read-only" && value !== "mutating" && value !== "mixed") throw new Error("--kind must be read-only, mutating, or mixed");
      kind = value;
      i += 1;
      continue;
    }
    if (arg.startsWith("--kind=")) {
      const value = arg.slice("--kind=".length);
      if (value !== "read-only" && value !== "mutating" && value !== "mixed") throw new Error("--kind must be read-only, mutating, or mixed");
      kind = value as ScriptKind;
      continue;
    }
    if (arg === "--weight") {
      const value = argv[i + 1];
      if (value !== "lightweight" && value !== "standard" && value !== "heavy") throw new Error("--weight must be lightweight, standard, or heavy");
      weight = value;
      i += 1;
      continue;
    }
    if (arg.startsWith("--weight=")) {
      const value = arg.slice("--weight=".length);
      if (value !== "lightweight" && value !== "standard" && value !== "heavy") throw new Error("--weight must be lightweight, standard, or heavy");
      weight = value as ScriptWeight;
      continue;
    }
    if (arg === "--help" || arg === "-h") {
      printUsage();
      process.exit(0);
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  if (paths.length === 0) throw new Error("Provide at least one --path");
  return { paths, write, force, check, role, kind, weight };
}

function unique(values: Iterable<string>): string[] {
  return [...new Set(Array.from(values).map((value) => value.trim()).filter(Boolean))];
}

function tokenize(value: string): string[] {
  return value
    .replace(/\.ts$/i, "")
    .split(/[^a-zA-Z0-9]+/)
    .map((part) => part.trim().toLowerCase())
    .filter(Boolean);
}

function titleCase(value: string): string {
  return value.replace(/\b([a-z])/g, (_, ch) => ch.toUpperCase());
}

function walkTsFiles(targetPath: string): string[] {
  const resolved = path.resolve(targetPath);
  const stat = fs.statSync(resolved);
  if (stat.isFile()) {
    return resolved.endsWith(".ts") && !resolved.endsWith(".d.ts") ? [resolved] : [];
  }

  const results: string[] = [];
  const stack = [resolved];
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

function extractScriptJDocComment(content: string): { start: number; end: number; jsonText: string } | null {
  const markerIndex = content.indexOf(SCRIPT_JDOC_MARKER);
  if (markerIndex < 0) return null;
  const commentStart = content.lastIndexOf("/**", markerIndex);
  const commentEnd = content.indexOf("*/", markerIndex);
  if (commentStart < 0 || commentEnd < 0) return null;
  const jsonText = content
    .slice(markerIndex + SCRIPT_JDOC_MARKER.length, commentEnd)
    .split(/\r?\n/)
    .map((line) => line.replace(/^\s*\* ?/, ""))
    .join("\n")
    .trim();
  return { start: commentStart, end: commentEnd + 2, jsonText };
}

function parseExistingJDoc(content: string): ScriptJDoc | null {
  const extracted = extractScriptJDocComment(content);
  if (!extracted) return null;
  try {
    const parsed = JSON.parse(extracted.jsonText);
    return parsed as ScriptJDoc;
  } catch {
    return null;
  }
}

function detectRole(filePath: string, content: string, tokens: string[]): ScriptRole {
  if (tokens.includes("helper") || tokens.includes("helpers") || tokens.includes("sidecar")) return "module";
  if (tokens.includes("scope") && tokens.includes("session")) return "module";
  if (/^#!\/.+/m.test(content) || /process\.argv|Bun\.argv|parseArgs\s*\(/.test(content)) return "entrypoint";
  if (filePath.includes(`${path.sep}runtime${path.sep}scripts${path.sep}`)) return "entrypoint";
  if (filePath.includes(`${path.sep}runtime${path.sep}skills${path.sep}`)) return "entrypoint";
  if (filePath.includes(`${path.sep}skills${path.sep}`) && filePath.includes(`${path.sep}runtime${path.sep}extensions${path.sep}`)) return "entrypoint";
  if (filePath.includes(`${path.sep}.pi${path.sep}skills${path.sep}`)) return "entrypoint";
  if (filePath.includes(`${path.sep}notes${path.sep}`)) return "entrypoint";
  return "module";
}

function primaryVerb(tokens: string[], role: ScriptRole): string {
  for (const token of tokens) {
    if (verbWords.has(token)) {
      if (token === "chart") return "generate";
      if (token === "harness") return "run";
      if (token === "status") return "inspect";
      return token;
    }
  }
  if (tokens.includes("svg") || tokens.includes("mermaid")) return "render";
  if (tokens.includes("proxy")) return "start";
  if (tokens.includes("metrics")) return "compute";
  return role === "module" ? "support" : "run";
}

function inferDomains(tokens: string[], filePath: string): string[] {
  const domains = new Set<string>();
  for (const hint of domainHints) {
    if (tokens.includes(hint)) domains.add(hint);
  }
  if (filePath.includes("/playwright/")) domains.add("browser");
  if (filePath.includes("/graphite-power-chart/")) domains.add("metrics");
  if (filePath.includes("/token-chart/")) domains.add("usage");
  if (filePath.includes("/timeline-cleanup/")) domains.add("messages");
  if (filePath.includes("/situate-daily-notes/")) domains.add("memory");
  if (filePath.includes("/export-timeline-pdf/")) domains.add("pdf");
  if (filePath.includes("/web-search")) domains.add("web");
  if (filePath.includes("/proxmox-management/")) domains.add("virtualization");
  return unique(domains);
}

function inferNouns(tokens: string[], domains: string[], verb: string): string[] {
  const ignored = new Set([verb, "run", "support", ...domains, "ts", ...ignoredContextTokens]);
  const nouns = tokens.filter((token) => !ignored.has(token) && !verbWords.has(token));
  const fallback = domains.filter((token) => token !== verb && token !== "notes");
  return unique(nouns.length > 0 ? nouns : fallback.length > 0 ? fallback : domains.filter((token) => token !== verb));
}

function inferKind(tokens: string[], role: ScriptRole): ScriptKind {
  if (tokens.some((token) => ["build", "vendor", "update", "start", "stop", "resume", "attach", "move", "create", "delete", "set", "send", "share", "cleanup", "upsert", "stamp", "bootstrap"].includes(token))) {
    return "mutating";
  }
  if (tokens.some((token) => ["chart", "render", "export", "generate", "compare", "proxy"].includes(token))) {
    return "mixed";
  }
  if (tokens.some((token) => ["check", "audit", "list", "status", "search", "query", "report", "metrics", "inspect", "summary", "digest", "validate"].includes(token))) {
    return "read-only";
  }
  return role === "module" ? "read-only" : "mixed";
}

function inferWeight(filePath: string, tokens: string[]): ScriptWeight {
  if (filePath.includes("/playwright/") || tokens.some((token) => ["playwright", "browser", "pdf", "export", "harness"].includes(token))) return "heavy";
  if (tokens.some((token) => ["build", "vendor", "update", "chart", "compare", "metrics", "digest", "summary", "proxy"].includes(token))) return "standard";
  return "lightweight";
}

function inferSummary(filePath: string, tokens: string[], role: ScriptRole, verb: string, domains: string[], nouns: string[]): string {
  const fallbackWords = tokens.filter((token) => !ignoredContextTokens.has(token));
  const nounPhrase = titleCase((nouns.length > 0 ? nouns : domains.length > 0 ? domains : fallbackWords).join(" ")) || "Script";
  let scopeLabel = "the workspace";
  if (filePath.includes(`${path.sep}runtime${path.sep}scripts${path.sep}`)) scopeLabel = "the packaged runtime";
  else if (filePath.includes(`${path.sep}runtime${path.sep}skills${path.sep}`) || (filePath.includes(`${path.sep}runtime${path.sep}extensions${path.sep}`) && filePath.includes(`${path.sep}skills${path.sep}`))) scopeLabel = "a packaged skill";
  else if (filePath.includes(`${path.sep}.pi${path.sep}skills${path.sep}`)) scopeLabel = "a workspace skill";
  else if (filePath.includes(`${path.sep}notes${path.sep}`)) scopeLabel = "workspace notes";

  if (role === "module") {
    if (tokens.includes("helper") || tokens.includes("helpers")) return `${titleCase(nounPhrase)} helper module for ${scopeLabel}.`;
    if (tokens.includes("sidecar")) return `${titleCase(nounPhrase)} sidecar helper module for ${scopeLabel}.`;
    return `${titleCase(nounPhrase)} support module for ${scopeLabel}.`;
  }

  if (verb === "check") return `Check ${nounPhrase.toLowerCase()} for ${scopeLabel}.`;
  if (verb === "build") return `Build ${nounPhrase.toLowerCase()} for ${scopeLabel}.`;
  if (verb === "vendor") return `Vendor ${nounPhrase.toLowerCase()} assets for ${scopeLabel}.`;
  if (verb === "update") return `Update ${nounPhrase.toLowerCase()} assets for ${scopeLabel}.`;
  if (verb === "render") return `Render ${nounPhrase.toLowerCase()} output for ${scopeLabel}.`;
  if (verb === "generate") return `Generate ${nounPhrase.toLowerCase()} output for ${scopeLabel}.`;
  if (verb === "inspect") return `Inspect ${nounPhrase.toLowerCase()} for ${scopeLabel}.`;
  if (verb === "start") return `Start ${nounPhrase.toLowerCase()} for ${scopeLabel}.`;
  if (verb === "stop") return `Stop ${nounPhrase.toLowerCase()} for ${scopeLabel}.`;
  if (verb === "resume") return `Resume ${nounPhrase.toLowerCase()} for ${scopeLabel}.`;
  if (verb === "search") return `Search ${nounPhrase.toLowerCase()} for ${scopeLabel}.`;
  if (verb === "compute") return `Compute ${nounPhrase.toLowerCase()} for ${scopeLabel}.`;
  if (verb === "run") return `Run ${nounPhrase.toLowerCase()} for ${scopeLabel}.`;
  return `${titleCase(verb)} ${nounPhrase.toLowerCase()} for ${scopeLabel}.`;
}

function inferAliases(baseTokens: string[], domains: string[]): string[] {
  const filteredBase = baseTokens.filter((token) => !ignoredContextTokens.has(token));
  const human = filteredBase.join(" ");
  const trimmed = domains.length > 0 && filteredBase[0] === domains[0]
    ? filteredBase.slice(1).join(" ")
    : "";
  return unique([human, trimmed]);
}

function inferExamples(verb: string, nouns: string[], domains: string[], role: ScriptRole): string[] {
  const words = (nouns.length > 0 ? nouns : domains).filter((token) => token !== verb && token !== "notes");
  if (words.length === 0) return role === "module" ? ["inspect helper module metadata"] : ["run the script"];
  return unique([`${verb} ${words.join(" ")}`.replace(/\s+/g, " ").trim()]);
}

function buildMetadata(filePath: string, content: string, options: Options): ScriptJDoc {
  const relative = filePath.replace(/\\/g, "/");
  const pathTokens = tokenize(relative).filter((token) => token !== "workspace");
  const baseTokens = tokenize(path.basename(filePath)).filter((token) => !ignoredContextTokens.has(token));
  const role = options.role ?? detectRole(filePath, content, pathTokens);
  const verb = primaryVerb(pathTokens, role);
  const domains = inferDomains(pathTokens, filePath);
  const nouns = inferNouns(pathTokens, domains, verb);
  const kind = options.kind ?? inferKind(pathTokens, role);
  const weight = options.weight ?? inferWeight(filePath, pathTokens);
  return {
    summary: inferSummary(filePath, pathTokens, role, verb, domains, nouns),
    aliases: inferAliases(baseTokens, domains),
    domains,
    verbs: [verb],
    nouns,
    keywords: unique([...pathTokens.filter((token) => !ignoredContextTokens.has(token)), ...domains, ...nouns]).slice(0, 12),
    guidance: unique([
      role === "module" ? "Helper/support module; not primarily intended as a standalone CLI entrypoint." : "Runnable script entrypoint.",
      filePath.includes(`${path.sep}runtime${path.sep}`) ? "Packaged script surface." : "Workspace-owned script surface.",
    ]),
    examples: inferExamples(verb, nouns, domains, role),
    kind,
    weight,
    role,
  };
}

function formatBlock(metadata: ScriptJDoc): string {
  const json = JSON.stringify(metadata, null, 2)
    .split("\n")
    .map((line) => ` * ${line}`)
    .join("\n");
  return `/**\n * ${SCRIPT_JDOC_MARKER}\n${json}\n */\n`;
}

function replaceOrInsert(content: string, block: string): string {
  const existing = extractScriptJDocComment(content);
  if (existing) {
    return `${content.slice(0, existing.start)}${block}${content.slice(existing.end).replace(/^\n+/, "")}`;
  }
  if (content.startsWith("#!")) {
    const newlineIndex = content.indexOf("\n");
    if (newlineIndex >= 0) return `${content.slice(0, newlineIndex + 1)}${block}${content.slice(newlineIndex + 1)}`;
  }
  return `${block}${content}`;
}

function resolveTargets(inputs: string[]): string[] {
  return unique(inputs.flatMap((input) => walkTsFiles(input))).sort((a, b) => a.localeCompare(b));
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const files = resolveTargets(options.paths);
  if (files.length === 0) throw new Error("No .ts files found for the provided paths");

  let failures = 0;
  for (const filePath of files) {
    const content = fs.readFileSync(filePath, "utf8");
    const existing = parseExistingJDoc(content);

    if (options.check) {
      if (!existing) {
        console.error(`Missing or invalid SCRIPT_JDOC: ${filePath}`);
        failures += 1;
      }
      continue;
    }

    if (existing && !options.force) {
      console.log(`Already annotated: ${filePath}`);
      continue;
    }

    const metadata = buildMetadata(filePath, content, options);
    const block = formatBlock(metadata);
    if (!options.write) {
      console.log(`--- ${filePath}`);
      process.stdout.write(block);
      if (!block.endsWith("\n")) process.stdout.write("\n");
      continue;
    }

    const next = replaceOrInsert(content, block);
    fs.writeFileSync(filePath, next, "utf8");
    console.log(`${existing ? "Updated" : "Annotated"}: ${filePath}`);
  }

  if (options.check) {
    if (failures > 0) {
      console.error(`SCRIPT_JDOC check failed for ${failures} file(s).`);
      process.exit(1);
    }
    console.log(`SCRIPT_JDOC check passed for ${files.length} file(s).`);
  }
}

await main();
