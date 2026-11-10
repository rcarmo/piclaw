import { accessSync, constants, statSync } from "node:fs";
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
    const args = ["--no-config", "--json", "--line-number", "--color=never", "--hidden"];
    if (input.ignoreCase) args.push("--ignore-case");
    if (input.literal) args.push("--fixed-strings");
    if (input.glob) args.push("--glob", input.glob.replace(/^(!?)(?:\.\/)+/, "$1"));
    const limit = Math.max(1, Math.floor(input.limit ?? 100));
    const context = input.context && input.context > 0 ? Math.min(Math.floor(input.context), Number.MAX_SAFE_INTEGER) : 0;
    if (context) args.push("--context", String(context));
    args.push("--", input.pattern, directory ? "." : searchPath);
    const output: string[] = [];
    let matches = 0, limitHit = false, matchLimitReached = false, trailingEnd = 0, lastFile = "";
    let linesTruncated = false, outputBytes = 0, outputLines = 0;
    const text = (field: {text?: string; bytes?: string} | undefined) => field?.text ?? (field?.bytes ? Buffer.from(field.bytes, "base64").toString("utf8") : "");
    const emit = (file: string, line: number, value: string, match: boolean) => {
      lastFile = file;
      const rel = relative(searchPath, resolve(directory ? searchPath : cwd, file));
      const name = directory && rel && !rel.startsWith("..") ? rel.replace(/\\/g, "/") : basename(file);
      const truncated = truncateLine(value.replace(/\r?\n?$/, ""));
      linesTruncated ||= truncated.wasTruncated;
      const formatted = (match ? `${name}:${line}: ` : `${name}-${line}- `) + truncated.text;
      if (outputBytes - 1 <= DEFAULT_MAX_BYTES) output.push(formatted);
      outputBytes += Buffer.byteLength(formatted, "utf8") + 1; outputLines++;
    };
    const result = await runHostToolProcess(binary, args, directory ? searchPath : cwd, guard, signal, line => {
      let event; try { event = JSON.parse(line); } catch { return false; }
      const match = event.type === "match";
      if (!match && event.type !== "context") return false;
      const file = text(event.data?.path), number = event.data?.line_number;
      if (!file || typeof number !== "number") return false;
      if (!limitHit) {
        emit(file, number, text(event.data?.lines), match);
        if (match && ++matches >= limit) { limitHit = true; trailingEnd = number + context; }
        return false;
      }
      const inWindow = file === lastFile && number <= trailingEnd;
      if (inWindow) emit(file, number, text(event.data?.lines), false);
      if (match) matchLimitReached = true;
      return matchLimitReached && !(inWindow && number < trailingEnd);
    });
    guard();
    if (!result.stopped && result.code !== 0 && result.code !== 1) throw Error(result.stderr.trim() || `ripgrep exited with code ${result.code}`);
    if (!matches) return { content: [{ type: "text" as const, text: "No matches found" }], details: undefined };
    const truncation = truncateHead(output.join("\n"), { maxLines: Number.MAX_SAFE_INTEGER });
    truncation.totalLines = outputLines; truncation.totalBytes = outputBytes - 1;
    const details: GrepToolDetails = {}, notices: string[] = [];
    if (matchLimitReached) { details.matchLimitReached = limit; notices.push(`${limit} matches limit reached. Use limit=${limit * 2} for more, or refine pattern`); }
    if (truncation.truncated) { details.truncation = truncation; notices.push(`${formatSize(DEFAULT_MAX_BYTES)} limit reached`); }
    if (linesTruncated) { details.linesTruncated = true; notices.push("Some lines truncated to 500 chars. Use read tool to see full lines"); }
    guard();
    return { content: [{ type: "text" as const, text: truncation.content + (notices.length ? `\n\n[${notices.join(". ")}]` : "") }], details: notices.length ? details : undefined };
  } };
}
