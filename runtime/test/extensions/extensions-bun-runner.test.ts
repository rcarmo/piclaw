import { afterEach, describe, expect, test } from "bun:test";
import "../helpers.js";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "fs";
import { join } from "path";

import { WORKSPACE_DIR } from "../../src/core/config.js";
import { getToolOutput } from "../../src/tool-output.js";
import bunRunnerExtension from "../../extensions/integrations/bun-runner/index.ts";
import { buildBunRunDescription, buildBunRunHint, buildBunRunPromptSnippet } from "../../src/extensions/bun-runner.ts";
import { createFakeExtensionApi } from "./fake-extension-api.js";

const cleanupPaths: string[] = [];

function makeTempDir(): { prefix: string; base: string } {
  const prefix = `bun-runner-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const base = join(WORKSPACE_DIR, prefix);
  mkdirSync(base, { recursive: true });
  cleanupPaths.push(base);
  return { prefix, base };
}

afterEach(() => {
  while (cleanupPaths.length > 0) {
    const next = cleanupPaths.pop();
    if (next) rmSync(next, { recursive: true, force: true });
  }
});

describe("bun-runner extension", () => {
  test("registers bun_run and advertises platform-aware hints", async () => {
    const fake = createFakeExtensionApi();
    bunRunnerExtension(fake.api);

    expect(fake.tools.has("bun_run")).toBe(true);
    expect(buildBunRunHint("linux")).toContain("detached process groups");
    expect(buildBunRunHint("win32")).toContain("detached=false");
    expect(buildBunRunDescription("win32")).toContain("stdout/stderr remain capturable");
    expect(buildBunRunPromptSnippet("linux")).toContain("detached process groups");
  });

  test("runs a workspace Bun script directly and discards stdout by default", async () => {
    const fake = createFakeExtensionApi();
    bunRunnerExtension(fake.api);
    const tool = fake.tools.get("bun_run");
    if (!tool) throw new Error("bun_run not registered");

    const { prefix, base } = makeTempDir();
    const scriptPath = join(base, "script.ts");
    const outputPath = join(base, "result.txt");
    writeFileSync(scriptPath, [
      'const [outPath, label] = process.argv.slice(2);',
      'console.log("stdout should be discarded");',
      'console.error(`stderr:${label}`);',
      'await Bun.write(outPath, `done:${label}`);',
    ].join("\n"), "utf8");

    const result = await tool.execute("tool-1", {
      script: `${prefix}/script.ts`,
      args: ["result.txt", "ok"],
      cwd: prefix,
      timeout_sec: 30,
    });

    expect(result.content[0].text).toContain(`bun_run completed successfully for ${prefix}/script.ts.`);
    expect(result.content[0].text).toContain("stdout: discarded");
    expect(result.content[0].text).toContain("stderr:ok");
    expect(result.content[0].text).not.toContain("stdout should be discarded");
    expect(result.details.ok).toBe(true);
    expect(result.details.exit_code).toBe(0);
    expect(result.details.capture_stdout).toBe(false);
    expect(result.details.stdout_captured).toBe(false);
    expect(readFileSync(outputPath, "utf8")).toBe("done:ok");
  });

  test("captures stdout when requested", async () => {
    const fake = createFakeExtensionApi();
    bunRunnerExtension(fake.api);
    const tool = fake.tools.get("bun_run");
    if (!tool) throw new Error("bun_run not registered");

    const { prefix, base } = makeTempDir();
    const scriptPath = join(base, "capture.ts");
    writeFileSync(scriptPath, [
      'console.log("stdout:hello");',
      'console.error("stderr:hello");',
    ].join("\n"), "utf8");

    const result = await tool.execute("tool-stdout", {
      script: `${prefix}/capture.ts`,
      cwd: prefix,
      timeout_sec: 30,
      capture_stdout: true,
    });

    expect(result.details.ok).toBe(true);
    expect(result.details.capture_stdout).toBe(true);
    expect(result.details.stdout_captured).toBe(true);
    expect(result.content[0].text).toContain("stdout:\nstdout:hello");
    expect(result.content[0].text).toContain("stderr:\nstderr:hello");
  });

  test("passes upstream-compatible PI session metadata to scripts", async () => {
    const fake = createFakeExtensionApi();
    bunRunnerExtension(fake.api);
    const tool = fake.tools.get("bun_run");
    if (!tool) throw new Error("bun_run not registered");

    const { prefix, base } = makeTempDir();
    const scriptPath = join(base, "env.ts");
    writeFileSync(scriptPath, [
      'console.log(JSON.stringify({',
      '  session: process.env.PI_SESSION_ID,',
      '  file: process.env.PI_SESSION_FILE,',
      '  provider: process.env.PI_PROVIDER,',
      '  model: process.env.PI_MODEL,',
      '  reasoning: process.env.PI_REASONING_LEVEL,',
      '}));',
    ].join("\n"), "utf8");

    const result = await tool.execute("tool-env", {
      script: `${prefix}/env.ts`,
      cwd: prefix,
      timeout_sec: 30,
      capture_stdout: true,
    }, undefined, undefined, {
      model: { provider: "github-copilot", id: "gpt-5.5" },
      thinkingLevel: "high",
      sessionManager: {
        getSessionId: () => "session-123",
        getPath: () => "/tmp/session-123.jsonl",
      },
    });

    expect(result.details.ok).toBe(true);
    expect(JSON.parse(String(result.details.stdout).trim())).toEqual({
      session: "session-123",
      file: "/tmp/session-123.jsonl",
      provider: "github-copilot",
      model: "gpt-5.5",
      reasoning: "high",
    });
  });

  test("stores large captured stdout as searchable tool output", async () => {
    const db = await import("../../src/db.js");
    db.initDatabase();

    const fake = createFakeExtensionApi();
    bunRunnerExtension(fake.api);
    const tool = fake.tools.get("bun_run");
    if (!tool) throw new Error("bun_run not registered");

    const { prefix, base } = makeTempDir();
    const scriptPath = join(base, "large-stdout.ts");
    writeFileSync(scriptPath, [
      'for (let i = 0; i < 80; i += 1) console.log(`line:${i}:` + "x".repeat(80));',
    ].join("\n"), "utf8");

    const result = await tool.execute("tool-large", {
      script: `${prefix}/large-stdout.ts`,
      cwd: prefix,
      timeout_sec: 30,
      capture_stdout: true,
    });

    expect(result.details.ok).toBe(true);
    expect(result.details.stdout_captured).toBe(true);
    expect(typeof result.details.stdout_stored_output_id).toBe("string");
    expect(String(result.details.stdout_stored_output_id)).toContain("out-");
    expect(result.content[0].text).toContain("stdout stored as tool-output:");
    expect(getToolOutput(String(result.details.stdout_stored_output_id))).toBeDefined();
  });

  test("rejects scripts outside the workspace", async () => {
    const fake = createFakeExtensionApi();
    bunRunnerExtension(fake.api);
    const tool = fake.tools.get("bun_run");
    if (!tool) throw new Error("bun_run not registered");

    const result = await tool.execute("tool-2", {
      script: "../../etc/passwd",
    });

    expect(result.details.ok).toBe(false);
    expect(result.content[0].text).toContain("bun_run failed");
    expect(result.content[0].text).toContain("inside the workspace");
  });
});
