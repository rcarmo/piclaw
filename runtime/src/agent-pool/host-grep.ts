import { accessSync, constants, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { basename, delimiter, join, relative, resolve } from "node:path";
import { createGrepToolDefinition, truncateHead, truncateLine, formatSize, DEFAULT_MAX_BYTES, type GrepToolInput, type GrepToolDetails } from "@earendil-works/pi-coding-agent";
import { runHostToolProcess } from "./host-tool-process.js";

/** One root-owned implementation. Public SDK supplies metadata/truncation, never execution.
 * Legacy root sessions already enforce their tool policy; durable callers MUST supply
 * their invocation-local effect guard. No extension context is retained.
 */
export function createHostGrepDefinition(cwd: string, assert: () => void = () => {}) {
  const metadata = createGrepToolDefinition(cwd);
  return { ...metadata, async execute(_id: string, params: GrepToolInput, signal?: AbortSignal) {
    const input = { ...params };
    const guard = () => { assert(); signal?.throwIfAborted(); };
    guard();
    for (const key of ["pattern", "path", "glob"] as const)
      if (input[key] !== undefined && typeof input[key] !== "string") throw Error(`Invalid grep ${key}`);
    if (typeof input.pattern !== "string") throw Error("Invalid grep pattern");
    for (const key of ["context", "limit"] as const)
      if (input[key] !== undefined && !Number.isFinite(input[key])) throw Error(`Invalid grep ${key}`);
    for (const key of ["literal", "ignoreCase"] as const)
      if (input[key] !== undefined && typeof input[key] !== "boolean") throw Error(`Invalid grep ${key}`);
    const requested = input.path || ".";
    const searchPath = resolve(cwd, requested === "~" ? homedir() : requested.startsWith("~/") ? homedir() + requested.slice(1) : requested);
    let directory: boolean;
    guard();
    try { directory = statSync(searchPath).isDirectory(); }
    catch { guard(); throw Error(`Path not found: ${searchPath}`); }
    // Keep the same asynchronous path-stat handoff as the public tool. Every
    // following effect, especially spawn, must independently re-admit authority.
    await Promise.resolve();
    guard();
    const binary = (process.env.PATH ?? "").split(delimiter).map(dir => resolve(join(dir, "rg"))).find(path => {
      guard();
      try { accessSync(path, constants.X_OK); return true; } catch { return false; }
    });
    if (!binary) throw Error("Host grep requires an installed ripgrep (rg) binary");
    const args = ["--json", "--line-number", "--color=never", "--hidden"];
    if (input.ignoreCase) args.push("--ignore-case");
    if (input.literal) args.push("--fixed-strings");
    if (input.glob) args.push("--glob", input.glob);
    args.push("--", input.pattern, searchPath);
    const limit = Math.max(1, input.limit ?? 100), context = input.context && input.context > 0 ? input.context : 0;
    const matches: { path: string; line: number; text?: string }[] = [];
    const result = await runHostToolProcess(binary, args, cwd, guard, signal, line => {
      let event;
      try { event = JSON.parse(line); } catch { return false; }
      if (event.type !== "match") return false;
      matches.push({ path: event.data.path.text, line: event.data.line_number, text: event.data.lines.text });
      return matches.length >= limit;
    });
    guard();
    if (!result.stopped && result.code !== 0 && result.code !== 1) throw Error(result.stderr.trim() || `ripgrep exited with code ${result.code}`);
    if (!matches.length) return { content: [{ type: "text" as const, text: "No matches found" }], details: undefined };
    const output: string[] = [], cache = new Map<string, string[]>();
    let linesTruncated = false;
    const emit = (prefix: string, text: string) => {
      const truncated = truncateLine(text);
      linesTruncated ||= truncated.wasTruncated;
      output.push(prefix + truncated.text);
    };
    for (const match of matches) {
      const rel = relative(searchPath, match.path);
      const name = directory && rel && !rel.startsWith("..") ? rel.replace(/\\/g, "/") : basename(match.path);
      if (!context && match.text !== undefined) emit(`${name}:${match.line}: `, match.text.replace(/\r\n/g, "\n").replace(/\r/g, "").replace(/\n$/, ""));
      else {
        let lines = cache.get(match.path);
        if (!lines) {
          guard();
          try { lines = readFileSync(match.path, "utf8").replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n"); }
          catch { guard(); lines = []; }
          cache.set(match.path, lines);
        }
        if (!lines.length) output.push(`${name}:${match.line}: (unable to read file)`);
        for (let n = Math.max(1, match.line - context); n <= Math.min(lines.length, match.line + context); n++)
          emit(n === match.line ? `${name}:${n}: ` : `${name}-${n}- `, (lines[n - 1] ?? "").replace(/\r/g, ""));
      }
    }
    const truncation = truncateHead(output.join("\n"), { maxLines: Number.MAX_SAFE_INTEGER });
    const details: GrepToolDetails = {}, notices: string[] = [];
    if (matches.length >= limit) { details.matchLimitReached = limit; notices.push(`${limit} matches limit reached. Use limit=${limit * 2} for more, or refine pattern`); }
    if (truncation.truncated) { details.truncation = truncation; notices.push(`${formatSize(DEFAULT_MAX_BYTES)} limit reached`); }
    if (linesTruncated) { details.linesTruncated = true; notices.push("Some lines truncated to 500 chars. Use read tool to see full lines"); }
    guard();
    return { content: [{ type: "text" as const, text: truncation.content + (notices.length ? `\n\n[${notices.join(". ")}]` : "") }], details: notices.length ? details : undefined };
  } };
}
