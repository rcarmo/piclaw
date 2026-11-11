// Self-isolating: forces PICLAW_DB_IN_MEMORY=1 via shared test helpers
import "../helpers.js";

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getDb, initDatabase } from "../../src/db/connection.js";
import { EMITTED_PAGE_BYTES, emittedToolOutput, formatShellCommand, isBashOutputLog, originalToolInput, readableToolInput } from "../../src/channels/web/agent/tool-presentation.js";

describe("shell commands", () => {
  test("split top-level chains onto continued lines", () => {
    expect(formatShellCommand("cd /w && bun install --frozen-lockfile && bun test | tail -3")).toBe(
      "cd /w \\\n  && bun install --frozen-lockfile \\\n  && bun test \\\n  | tail -3");
    expect(formatShellCommand("make build; make test || echo failed")).toBe("make build\nmake test \\\n  || echo failed");
  });

  test("leave quoted, nested and multi-line commands alone", () => {
    expect(formatShellCommand("echo 'a && b' && echo \"c | d\"")).toBe("echo 'a && b' \\\n  && echo \"c | d\"");
    expect(formatShellCommand("x=$(ls | wc -l) && echo $x")).toBe("x=$(ls | wc -l) \\\n  && echo $x");
    expect(formatShellCommand("echo done")).toBeNull();
    expect(formatShellCommand("python3 - <<'EOF'\nprint(1)\nEOF")).toBeNull();
    expect(formatShellCommand("echo 'unterminated && x")).toBeNull();
    expect(formatShellCommand("ls 2>&1 | head")).toBe("ls 2>&1 \\\n  | head");
  });
});

describe("readable inputs", () => {
  test("format shell, scripts, edits and file content; keep the original exactly", () => {
    expect(readableToolInput("bash", { command: "cd /w && ls" })).toEqual({ kind: "shell", label: "Command", language: "shell", text: "cd /w \\\n  && ls" });
    expect(readableToolInput("codemode", { code: "await tools.read({})" })).toMatchObject({ kind: "code", label: "Script", text: "await tools.read({})" });
    expect(readableToolInput("edit", { path: "a.ts", edits: [{ oldText: "x\ny", newText: "z" }] })).toEqual({ kind: "diff", label: "Changes to a.ts", text: "@@ edit 1 @@\n-x\n-y\n+z" });
    expect(readableToolInput("write", { path: "a.ts", content: "export {}\n" })).toEqual({ kind: "code", label: "Content of a.ts", language: "typescript", text: "export {}\n" });
    expect(readableToolInput("search", { query: "x", options: { limit: 2 } })).toMatchObject({ kind: "json", text: '{\n  "query": "x",\n  "options": {\n    "limit": 2\n  }\n}' });
    expect(readableToolInput("search", {})).toBeNull();
    expect(readableToolInput("bash", { command: "seq 1 5" })).toEqual({ kind: "shell", label: "Command", language: "shell", text: "seq 1 5", only: true });
    expect(originalToolInput({ command: "cd /w && ls" })).toBe('{"command":"cd /w && ls"}');
  });
});

describe("emitted output", () => {
  const chat = "web:presentation";
  let dir = "";
  beforeAll(() => {
    initDatabase();
    dir = mkdtempSync(join(tmpdir(), "presentation-"));
    const db = getDb();
    writeFileSync(join(dir, "full.txt"), "line\n".repeat(80000));
    // Single-user installs store outputs unscoped; a multi-user output carries its chat.
    db.prepare("INSERT INTO tool_outputs(id, created_at, source, size_bytes, line_count, summary, path) VALUES ('out_mine', ?, 'bash:x', 0, 0, '', ?)")
      .run(new Date().toISOString(), join(dir, "full.txt"));
    db.exec("DROP TRIGGER IF EXISTS tool_output_scope_valid"); // this in-memory fixture has no session roots
    db.prepare(`INSERT INTO tool_outputs(id, created_at, source, size_bytes, line_count, summary, path, owner_user_id, root_branch_id, source_branch_id, chat_jid, execution_kind)
      VALUES ('out_other', ?, 'bash:x', 0, 0, '', ?, 'owner', 'root', 'branch', 'web:someone-else', 'interactive')`).run(new Date().toISOString(), join(dir, "full.txt"));
  });
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  test("shows an edit's diff as emitted, paged by bytes", () => {
    expect(emittedToolOutput(chat, { diff: "+ added" }, "Successfully replaced")).toEqual({ kind: "diff", label: "Diff", text: "+ added", offset: 0, next_offset: 7, total: 7, truncated: false, source: "details" });
  });

  test("ends byte pages on UTF-8 character boundaries and resumes at the next offset", () => {
    // A 3-byte character straddles the page boundary.
    const diff = `${"a".repeat(EMITTED_PAGE_BYTES - 1)}€tail`;
    const first = emittedToolOutput(chat, { diff }, "ok")!;
    expect(first.next_offset).toBe(EMITTED_PAGE_BYTES - 1);
    expect(first.text).not.toContain("\uFFFD");
    expect(first.truncated).toBe(true);
    const second = emittedToolOutput(chat, { diff }, "ok", first.next_offset)!;
    expect(second.text).toBe("€tail");
    expect(second.truncated).toBe(false);
    expect(first.text + second.text).toBe(diff);
    const log = join(tmpdir(), `pi-bash-${(Date.now() + 1).toString(16)}.log`);
    writeFileSync(log, diff);
    try {
      const page = emittedToolOutput(chat, { fullOutputPath: log }, "[truncated]")!;
      expect(page.next_offset).toBe(EMITTED_PAGE_BYTES - 1);
      expect(page.text + emittedToolOutput(chat, { fullOutputPath: log }, "[truncated]", page.next_offset)!.text).toBe(diff);
    } finally { rmSync(log, { force: true }); }
  });

  test("reads a stored full output only for its own chat", () => {
    const first = emittedToolOutput(chat, {}, "Output stored as tool-output:out_mine (80000 lines).");
    expect(first?.source).toBe("tool-output");
    expect(first?.total).toBe(400000);
    expect(first?.text.length).toBe(EMITTED_PAGE_BYTES);
    expect(first?.truncated).toBe(true);
    const second = emittedToolOutput(chat, {}, "tool-output:out_mine", EMITTED_PAGE_BYTES);
    expect(first?.next_offset).toBe(EMITTED_PAGE_BYTES);
    expect(second?.offset).toBe(EMITTED_PAGE_BYTES);
    expect(second?.truncated).toBe(false);
    expect(emittedToolOutput(chat, {}, "tool-output:out_other")).toBeNull();
    expect(emittedToolOutput(chat, {}, "tool-output:out_missing")).toBeNull();
  });

  test("reads only bash's own logs in the temp directory, and only when they differ", () => {
    const log = join(tmpdir(), `pi-bash-${Date.now().toString(16)}.log`);
    writeFileSync(log, "full output\nmore");
    try {
      expect(isBashOutputLog(log)).toBe(true);
      expect(emittedToolOutput(chat, { fullOutputPath: log }, "[output truncated]")).toMatchObject({ source: "log", text: "full output\nmore" });
      expect(emittedToolOutput(chat, { fullOutputPath: log }, "full output\nmore")).toBeNull();
    } finally { rmSync(log, { force: true }); }
    for (const path of [join(dir, "full.txt"), join(dir, "pi-bash-abc.log"), "relative/pi-bash-abc.log", "/etc/passwd", 7]) {
      expect(isBashOutputLog(path)).toBe(false);
    }
  });
});
