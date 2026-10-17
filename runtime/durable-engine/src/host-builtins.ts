import { accessSync, constants, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { delimiter, extname, join } from "node:path";
import {
  createReadToolDefinition, createWriteToolDefinition, createEditToolDefinition,
  createLsToolDefinition, createFindToolDefinition, type ToolDefinition,
} from "../../../node_modules/@earendil-works/pi-coding-agent";
import type { JsonValue } from "@earendil-works/chord";
import type { TSchema } from "@earendil-works/pi-ai";
import { createHostTool } from "./host-tools.js";
import { createHostBashTool } from "./host-bash.js";
import { runHostToolProcess } from "../../src/agent-pool/host-tool-process.js";
import { createHostGrepDefinition } from "../../src/agent-pool/host-grep.js";

/** Existing public host definitions, with fresh invocation-local operation ports.
 * Synchronous filesystem calls deliberately close the check/async-write gap: the
 * owner check and syscall share one JS turn, even after SDK path/queue awaits.
 * Single-user root policy permits absolute paths, as does the legacy host SDK;
 * this is not a new filesystem sandbox or family-mode permission grant.
 */
export function createHostBuiltinTools(options: {
  cwd: string;
  authority: { assertAllowed(): void };
  shellPath?: () => string | undefined;
  signal?: AbortSignal;
  names?: readonly string[];
  captureSourceGuard?: (call: { conversationId: import("@earendil-works/pi-durable").ConversationId; taskId: import("@earendil-works/pi-durable").TaskId; toolCallId: string }) => Promise<() => void>;
}) {
  // Capture the approved callback, not a mutable caller-owned options object.
  // Its closure still observes live owner/lifetime state on every effect.
  const { cwd, shellPath, signal: lifetime } = options;
  const assertAuthority = options.authority.assertAllowed.bind(options.authority);
  const names = [...(options.names ?? ["read", "bash", "edit", "write", "find", "ls", "grep"])];
  type Definition = ToolDefinition<TSchema, JsonValue>;
  const build = (name: string, assert: () => void, signal?: AbortSignal, track: (pending: Promise<unknown>) => void = () => {}): Definition => {
    const readFile = async (path: string) => { assert(); return readFileSync(path); };
    const writeFile = async (path: string, content: string) => { assert(); writeFileSync(path, content, "utf8"); };
    const exists = (path: string) => { assert(); return existsSync(path); };
    const stat = (path: string) => { assert(); return statSync(path); };
    switch (name) {
      case "read": {
        const definition = createReadToolDefinition(cwd, { operations: {
          readFile, access: async path => { assert(); accessSync(path, constants.R_OK); },
          detectImageMimeType: async path => {
            assert();
            const mime: Record<string, string> = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif", ".webp": "image/webp", ".bmp": "image/bmp" };
            return mime[extname(path).toLowerCase()];
          },
        } });
        // Model-only bridge retains native text/image blocks, not codemode's
        // structured-content channel (which this bridge does not implement).
        const { outputSchema: _schema, ...modelDefinition } = definition;
        return modelDefinition as unknown as Definition;
      }
      case "write": return createWriteToolDefinition(cwd, { operations: {
        writeFile, mkdir: async path => { assert(); mkdirSync(path, { recursive: true }); },
      } }) as unknown as Definition;
      case "edit": return createEditToolDefinition(cwd, { operations: {
        readFile, writeFile, access: async path => { assert(); accessSync(path, constants.R_OK | constants.W_OK); },
      } }) as unknown as Definition;
      case "ls": return createLsToolDefinition(cwd, { operations: {
        exists, stat, readdir: path => { assert(); return readdirSync(path); },
      } }) as unknown as Definition;
      case "grep": return createHostGrepDefinition(cwd, assert) as unknown as Definition;
      case "find": return createFindToolDefinition(cwd, { operations: {
        exists, glob(pattern, cwd, { ignore, limit }) {
          const pending = (async () => {
          // Use the existing host fd binary only; never SDK auto-downloads.
          const binary = (process.env.PATH ?? "").split(delimiter).flatMap(dir => [join(dir, "fd"), join(dir, "fdfind")]).find(exists);
          if (!binary) throw Error("Host find requires an installed fd binary");
          const args = ["--glob", "--color=never", "--hidden", "--no-require-git", "--max-results", String(limit)];
          for (const item of ignore) args.push("--exclude", item);
          if (pattern.includes("/")) { args.push("--full-path"); if (!pattern.startsWith("/") && !pattern.startsWith("**/")) pattern = `**/${pattern}`; }
          args.push("--", pattern, cwd);
          // No shell or SDK download path. Admission and the actual spawn share
          // one turn; the invocation/lifetime signal owns the tracked group.
          const result = await runHostToolProcess(binary, args, cwd, assert, signal);
          if (result.code !== 0) throw Error("Host find failed");
          return result.stdout.trim().split("\n").filter(Boolean);
          })();
          track(pending);
          return pending;
        },
      } }) as unknown as Definition;
      default: throw Error(`Host builtin unavailable: ${name}: no qualified effect port`);
    }
  };
  return names.map(name => {
    if (name === "bash") return createHostBashTool({ cwd, shellPath, authority: { assertAllowed: assertAuthority }, captureSourceGuard: options.captureSourceGuard });
    const schema = build(name, assertAuthority);
    return createHostTool(schema, {
      authority: { check: assertAuthority }, effectFence: "host-effect-port",
      async invoke(args, call) {
        const signals = [lifetime, call.signal].filter((signal): signal is AbortSignal => !!signal);
        const signal = signals.length ? AbortSignal.any(signals) : undefined;
        let pending: Promise<unknown> | undefined;
        const sourceGuard = options.captureSourceGuard ? await options.captureSourceGuard(call) : undefined;
        const assert = () => { call.assertAllowed(); sourceGuard?.(); };
        const tool = build(name, assert, signal, operation => { pending = operation; });
        assert();
        // These SDK builtins use their captured cwd without an extension context.
        // No session, extension host, nested tool access or private state is fabricated.
        try { return await tool.execute(call.toolCallId, args, signal, call.onUpdate, undefined as never); }
        finally {
          // SDK find rejects on abort before its custom glob finishes. Retain
          // invocation ownership until our child and readers have actually joined.
          await pending?.catch(() => {});
        }
      },
    });
  });
}
