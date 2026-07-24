#!/usr/bin/env bun
/**
 * Deterministic circular dependency gate for the runtime server graph.
 *
 * The production entrypoint is `runtime/src/index.ts`. Test files, scripts,
 * generated artifacts, and optional standalone entrypoints are intentionally
 * outside this graph and are not traversed by this gate.
 */

import { existsSync, readFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";

export interface CircularDependencyCheckOptions {
  entrypoint?: string;
  rootDir?: string;
}

export interface CircularDependencyResult {
  entrypoint: string;
  rootDir: string;
  fileCount: number;
  cycles: string[][];
}

const runtimeDir = resolve(import.meta.dir, "..");
const defaultEntrypoint = join(runtimeDir, "src", "index.ts");

export function extractModuleSpecifiers(content: string): string[] {
  const specifiers: string[] = [];
  const staticImportRegex = /\b(?:import|export)\s+(?:[^"']*?\s+from\s+)?["']([^"']+)["']/g;
  const sideEffectImportRegex = /\bimport\s+["']([^"']+)["']/g;
  const dynamicImportRegex = /\bimport\(\s*["']([^"']+)["']\s*\)/g;

  for (const regex of [staticImportRegex, sideEffectImportRegex, dynamicImportRegex]) {
    let match: RegExpExecArray | null;
    while ((match = regex.exec(content)) !== null) {
      specifiers.push(match[1]);
    }
  }

  return [...new Set(specifiers)];
}

function normalizePath(filePath: string): string {
  return resolve(filePath);
}

function isRelativeSpecifier(specifier: string): boolean {
  return specifier.startsWith("./") || specifier.startsWith("../");
}

function candidatePaths(resolvedBase: string): string[] {
  const withoutJs = resolvedBase.endsWith(".js") ? resolvedBase.slice(0, -3) : resolvedBase;
  const withoutTs = resolvedBase.endsWith(".ts") ? resolvedBase.slice(0, -3) : withoutJs;
  const candidates = new Set<string>();
  candidates.add(resolvedBase);
  candidates.add(`${withoutJs}.ts`);
  candidates.add(`${withoutJs}.tsx`);
  candidates.add(`${withoutTs}.ts`);
  candidates.add(`${withoutTs}.tsx`);
  candidates.add(join(resolvedBase, "index.ts"));
  candidates.add(join(resolvedBase, "index.tsx"));
  return [...candidates];
}

export function resolveRuntimeImport(fromFile: string, specifier: string, rootDir: string): string | null {
  if (!isRelativeSpecifier(specifier)) return null;
  const base = normalizePath(join(dirname(fromFile), specifier));
  for (const candidate of candidatePaths(base)) {
    if (!existsSync(candidate)) continue;
    const normalizedCandidate = normalizePath(candidate);
    if (normalizedCandidate === normalizePath(fromFile)) return null;
    const relativeToRoot = relative(rootDir, normalizedCandidate);
    if (relativeToRoot.startsWith("..") || isAbsolute(relativeToRoot)) return null;
    return normalizedCandidate;
  }
  return null;
}

function buildGraph(entrypoint: string, rootDir: string): Map<string, string[]> {
  const graph = new Map<string, string[]>();
  const stack = [entrypoint];

  while (stack.length > 0) {
    const file = stack.pop()!;
    if (graph.has(file)) continue;

    const content = readFileSync(file, "utf8");
    const deps = extractModuleSpecifiers(content)
      .map((specifier) => resolveRuntimeImport(file, specifier, rootDir))
      .filter((candidate): candidate is string => Boolean(candidate))
      .sort();
    graph.set(file, deps);
    for (const dep of deps) {
      if (!graph.has(dep)) stack.push(dep);
    }
  }

  return graph;
}

function canonicalCycle(cycle: string[]): string {
  const withoutDuplicateTail = cycle[0] === cycle.at(-1) ? cycle.slice(0, -1) : cycle;
  const rotations = withoutDuplicateTail.map((_, index) => [
    ...withoutDuplicateTail.slice(index),
    ...withoutDuplicateTail.slice(0, index),
  ]);
  const canonical = rotations
    .map((rotation) => [...rotation, rotation[0]])
    .sort((left, right) => left.join("\0").localeCompare(right.join("\0")))[0];
  return canonical.join("\0");
}

function findCycles(graph: Map<string, string[]>): string[][] {
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const path: string[] = [];
  const cyclesByKey = new Map<string, string[]>();

  const visit = (file: string): void => {
    if (visiting.has(file)) {
      const start = path.indexOf(file);
      if (start !== -1) {
        const cycle = [...path.slice(start), file];
        cyclesByKey.set(canonicalCycle(cycle), cycle);
      }
      return;
    }
    if (visited.has(file)) return;

    visiting.add(file);
    path.push(file);
    for (const dep of graph.get(file) ?? []) visit(dep);
    path.pop();
    visiting.delete(file);
    visited.add(file);
  };

  for (const file of [...graph.keys()].sort()) visit(file);
  return [...cyclesByKey.values()].sort((left, right) => left.join("\0").localeCompare(right.join("\0")));
}

export function checkCircularDependencies(options: CircularDependencyCheckOptions = {}): CircularDependencyResult {
  const entrypoint = normalizePath(options.entrypoint ?? defaultEntrypoint);
  const rootDir = normalizePath(options.rootDir ?? join(runtimeDir, "src"));
  if (!existsSync(entrypoint)) throw new Error(`Entrypoint not found: ${entrypoint}`);
  const graph = buildGraph(entrypoint, rootDir);
  return {
    entrypoint,
    rootDir,
    fileCount: graph.size,
    cycles: findCycles(graph),
  };
}

function formatRelative(rootDir: string, filePath: string): string {
  return relative(rootDir, filePath).split(/[\\/]+/).join("/");
}

if (import.meta.main) {
  const entryArgIndex = process.argv.indexOf("--entrypoint");
  const rootArgIndex = process.argv.indexOf("--root");
  const result = checkCircularDependencies({
    entrypoint: entryArgIndex >= 0 ? process.argv[entryArgIndex + 1] : undefined,
    rootDir: rootArgIndex >= 0 ? process.argv[rootArgIndex + 1] : undefined,
  });

  if (result.cycles.length > 0) {
    console.error(`[circular-dependencies] detected ${result.cycles.length} cycle(s) from ${formatRelative(result.rootDir, result.entrypoint)}:`);
    for (const [index, cycle] of result.cycles.entries()) {
      console.error(`${index + 1}) ${cycle.map((file) => formatRelative(result.rootDir, file)).join(" > ")}`);
    }
    process.exit(1);
  }

  console.log(`[circular-dependencies] ok: ${result.fileCount} files reachable from ${formatRelative(result.rootDir, result.entrypoint)}`);
}
