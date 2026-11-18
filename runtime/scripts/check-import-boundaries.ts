#!/usr/bin/env bun

import { existsSync, readdirSync, readFileSync, statSync } from "fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "path";

const ENTRY_EXTENSIONS_DIR = "extensions";
const SRC_EXTENSIONS_DIR = "src/extensions";

export const ALLOWED_PACKAGED_EXTENSION_SRC_TARGETS = Object.freeze([
  "src/core/config-secrets.js",
  "src/core/config-web.js",
  "src/core/config.js",
  "src/tool-status-hints.js",
  "src/tools/tracked-bash.js",
  "src/utils/azure-tool-call-limit.js",
  "src/utils/logger.js",
  "src/utils/process-spawn.js",
] as const);
const ALLOWED_ENTRY_SRC_TARGETS = new Set<string>(ALLOWED_PACKAGED_EXTENSION_SRC_TARGETS);
const LATENT_SERVICE_EFFECTS_DIR = "src/service-effects";
const SERVICE_EFFECTS_TESTING_DIR = "src/service-effects/testing";
const MCP_ADAPTER_SUBPATH_PREFIX = "pi-mcp-adapter/";

function walkFiles(baseDir: string, suffix: string): string[] {
  if (!existsSync(baseDir)) return [];
  const out: string[] = [];

  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      if (entry === "node_modules") continue;
      const full = join(dir, entry);
      const stats = statSync(full);
      if (stats.isDirectory()) {
        walk(full);
      } else if (stats.isFile() && full.endsWith(suffix)) {
        out.push(full);
      }
    }
  };

  walk(baseDir);
  return out;
}

export function extractModuleSpecifiers(content: string): string[] {
  const specifiers: string[] = [];
  const staticImportRegex = /\b(?:import|export)\s+(?:[^"']*?\s+from\s+)?["']([^"']+)["']/g;
  const dynamicImportRegex = /\bimport\(\s*["']([^"']+)["']\s*\)/g;
  const requireRegex = /\brequire\(\s*["']([^"']+)["']\s*\)/g;

  for (const regex of [staticImportRegex, dynamicImportRegex, requireRegex]) {
    let match: RegExpExecArray | null;
    while ((match = regex.exec(content)) !== null) {
      specifiers.push(match[1]);
    }
  }

  return specifiers;
}

function portablePath(value: string): string {
  return value.split(sep).join("/");
}

/** Resolve a relative module specifier from its importer into a project-relative target. */
export function resolveProjectImportTarget(projectDir: string, importer: string, specifier: string): string | null {
  const normalizedSpecifier = specifier.replaceAll("\\", "/");
  if (!normalizedSpecifier.startsWith("./") && !normalizedSpecifier.startsWith("../")) return null;
  const target = resolve(dirname(importer), normalizedSpecifier);
  const projectRoot = resolve(projectDir);
  const relativeTarget = portablePath(relative(projectRoot, target));
  if (!relativeTarget || relativeTarget === "." || isAbsolute(relativeTarget) || relativeTarget === ".." || relativeTarget.startsWith("../")) return null;
  return relativeTarget;
}

function isWithin(target: string, directory: string): boolean {
  return target === directory || target.startsWith(`${directory}/`);
}

function isAllowedEntrySrcTarget(target: string): boolean {
  return isWithin(target, SRC_EXTENSIONS_DIR) || ALLOWED_ENTRY_SRC_TARGETS.has(target);
}

function importsLatentServiceEffects(specifier: string): boolean {
  return /(?:^|\/)service-effects(?:\/|$)/.test(specifier);
}

function importsServiceEffectsTesting(specifier: string): boolean {
  return /(?:^|\/)service-effects\/testing(?:\/|$)/.test(specifier) ||
    /(?:^|\/)testing(?:\/|$)/.test(specifier);
}

export function findPackagedExtensionImportViolations(projectDir: string): string[] {
  const violations: string[] = [];
  const entryFiles = walkFiles(join(projectDir, ENTRY_EXTENSIONS_DIR), ".ts");
  const srcBridgeFiles = walkFiles(join(projectDir, SRC_EXTENSIONS_DIR), ".ts");

  for (const file of entryFiles) {
    const rel = relative(projectDir, file);
    const specifiers = extractModuleSpecifiers(readFileSync(file, "utf8"));

    for (const specifier of specifiers) {
      if ((specifier === "pi-mcp-adapter" || specifier.startsWith(MCP_ADAPTER_SUBPATH_PREFIX))) {
        violations.push(`${rel}: retired MCP adapter is forbidden in extensions (${specifier})`);
      }
      const target = resolveProjectImportTarget(projectDir, file, specifier);
      if (target && target.split("/").includes("node_modules")) {
        violations.push(`${rel}: disallowed node_modules relative import (${specifier} -> ${target})`);
      }
      if (specifier.startsWith("@earendil-works/pi-ai/dist/")) {
        violations.push(`${rel}: disallowed direct pi-ai dist import (${specifier})`);
      }
      if (target && isWithin(target, "src") && !isAllowedEntrySrcTarget(target)) {
        violations.push(`${rel}: disallowed direct src import (${specifier} -> ${target})`);
      }
    }
  }

  for (const file of srcBridgeFiles) {
    const rel = relative(projectDir, file);
    const specifiers = extractModuleSpecifiers(readFileSync(file, "utf8"));
    for (const specifier of specifiers) {
      if (specifier.startsWith("@earendil-works/pi-ai/dist/")) {
        violations.push(`${rel}: disallowed pi-ai dist import outside allowlist (${specifier})`);
      }
      if ((specifier === "pi-mcp-adapter" || specifier.startsWith(MCP_ADAPTER_SUBPATH_PREFIX))) {
        violations.push(`${rel}: retired MCP adapter is forbidden in extensions (${specifier})`);
      }
    }
  }

  return violations.sort();
}

function findServiceEffectsImportViolations(projectDir: string): string[] {
  const violations: string[] = [];
  const productionFiles = walkFiles(join(projectDir, "src"), ".ts");
  for (const file of productionFiles) {
    const rel = relative(projectDir, file);
    const inServiceEffects = rel === LATENT_SERVICE_EFFECTS_DIR || rel.startsWith(`${LATENT_SERVICE_EFFECTS_DIR}/`);
    const inServiceEffectsTesting = rel === SERVICE_EFFECTS_TESTING_DIR || rel.startsWith(`${SERVICE_EFFECTS_TESTING_DIR}/`);
    const specifiers = extractModuleSpecifiers(readFileSync(file, "utf8"));
    for (const specifier of specifiers) {
      if (!inServiceEffects && importsLatentServiceEffects(specifier)) {
        violations.push(`${rel}: production core cannot import latent service effects (${specifier})`);
      }
      if (inServiceEffects && !inServiceEffectsTesting && importsServiceEffectsTesting(specifier)) {
        violations.push(`${rel}: service-effects production layer cannot import testing (${specifier})`);
      }
    }
  }

  return violations.sort();
}

export function findImportBoundaryViolations(projectDir: string): string[] {
  return [
    ...findPackagedExtensionImportViolations(projectDir),
    ...findServiceEffectsImportViolations(projectDir),
  ].sort();
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  const extensionsOnly = args.length === 1 && args[0] === "--scope=extensions";
  if (args.length > (extensionsOnly ? 1 : 0)) {
    console.error("Usage: check-import-boundaries.ts [--scope=extensions]");
    process.exit(2);
  }
  const violations = extensionsOnly
    ? findPackagedExtensionImportViolations(process.cwd())
    : findImportBoundaryViolations(process.cwd());
  if (violations.length > 0) {
    console.error("[import-boundaries] detected violations:");
    for (const violation of violations) {
      console.error(` - ${violation}`);
    }
    process.exit(1);
  }

  console.log(`[import-boundaries] ${extensionsOnly ? "extensions " : ""}ok`);
}
