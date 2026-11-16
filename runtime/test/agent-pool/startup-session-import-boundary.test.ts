import { expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";

const source = resolve(import.meta.dir, "../../src");

/** Follow runtime imports only: type imports and deliberate lazy imports are not startup work. */
function staticGraph(entry: string): Set<string> {
  const visited = new Set<string>();
  const pending = [resolve(source, entry)];
  while (pending.length) {
    const file = pending.pop()!;
    if (visited.has(file)) continue;
    visited.add(file);
    const imports = new Bun.Transpiler({ loader: "ts" }).scanImports(readFileSync(file, "utf8").replace(/^#![^\n]*\n/, ""));
    for (const specifier of imports) {
      if (specifier.kind !== "import-statement" || !specifier.path.startsWith(".")) continue;
      const target = resolve(dirname(file), specifier.path.replace(/\.js$/, ".ts"));
      if (existsSync(target)) pending.push(target);
    }
  }
  return visited;
}

// Public SDK definitions/resources remain allowed. Native startup must not
// evaluate LOCAL retired execution/replay or lifecycle composition modules.
// Legacy compatibility deliberately retains its separate session load fence.
for (const mode of ["durable", "legacy"] as const) {
  test(`fresh-process ${mode} AgentPool construction enforces the local load boundary`, async () => {
    const root = mkdtempSync(resolve(tmpdir(), "durable-import-boundary-"));
    const fence=mode==='durable'
      ? /\/(?:agent-pool\/(?:session|session-factory|session-binder|session-manager|tool-factory|turn-coordinator|run-agent-orchestrator|run-agent-attempt-budget|run-agent-attempt-context|run-agent-attempt-finalization|run-agent-recovery-phase|automatic-recovery|compaction|operation-session-profile|protected-recovery-handoff|legacy-authority-capture|context-pressure-retry|slash-command)|session-rotation|agent-control\/handlers\/(?:control|session|model|queue))\.(?:ts|js)$/
      : /\/agent-pool\/(?:session|session-factory)\.(?:ts|js)$/;
    const script = `
      import { plugin } from "bun";
      const source = ${JSON.stringify(source)};
      const attempts = [];
      plugin({ name: "local-legacy-construction-fence", setup(build) {
        build.onLoad({ filter: new RegExp(${JSON.stringify(fence.source)}) }, args => {
          if (!args.path.startsWith(source + "/")) return;
          attempts.push(args.path);
          throw new Error("LOCAL_CONSTRUCTION_FENCE:" + args.path);
        });
      }});
      const { AgentPool } = await import(source + "/agent-pool.ts");
      const { createAgentPoolModelOptions,createLegacyCapturePoolOptions } = await import(${JSON.stringify(resolve(import.meta.dir, "../model-services-fixture.ts"))});
      const { initDatabase } = await import(source + "/db.ts");
      initDatabase();
      const mode = ${JSON.stringify(mode)};
      if (mode === "legacy") {
        try { new AgentPool(createLegacyCapturePoolOptions()); throw Error("Retired selector unexpectedly accepted"); }
        catch (error) { if (!String(error).includes("Resident legacy capture was removed")) throw error; }
        if (attempts.length) throw Error("Retired selector evaluated a legacy module");
        console.log(JSON.stringify({ mode, attempts }));
      } else {
        const pool = new AgentPool(createAgentPoolModelOptions());
        try {
          try { await pool.getSessionForIntrospection("web:load-boundary"); throw Error("Expected native rejection"); }
          catch (error) { if (!String(error).includes("Durable application does not construct legacy sessions")) throw error; }
          if ('runAgent' in pool || attempts.length) throw Error("Native construction evaluated a retired execution module");
          console.log(JSON.stringify({ mode, attempts }));
        } finally { await pool.shutdown(); }
      }
    `;
    try {
      const child = Bun.spawn([process.execPath, "--eval", script], {
        cwd: root,
        env: {
          PATH: process.env.PATH,
          HOME: root,
          PICLAW_WORKSPACE: resolve(root, "workspace"),
          PICLAW_STORE: resolve(root, "store"),
          PICLAW_DATA: resolve(root, "data"),
          PI_CODING_AGENT_DIR: resolve(root, "agent"),
          PICLAW_DB_IN_MEMORY: "1",
        },
        stdout: "pipe", stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([
        new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited,
      ]);
      expect({ exitCode, stderr: exitCode ? stderr : "" }).toEqual({ exitCode: 0, stderr: "" });
      const result = JSON.parse(stdout.trim().split("\n").at(-1)!);
      expect(result.mode).toBe(mode);
      expect(result.attempts).toEqual([]);
    } finally { rmSync(root, { recursive: true, force: true }); }
  }, 30000);
}

for (const entry of ["index.ts", "runtime.ts", "runtime/bootstrap.ts", "agent-pool.ts"]) {
  test(`${entry} static local graph excludes legacy construction and affinity patches (supplementary)`, () => {
    const graph = staticGraph(entry);
    expect(graph.size).toBeGreaterThan(10);
    expect(graph.has(resolve(source, "agent-pool/session.ts"))).toBe(false);
    expect(graph.has(resolve(source, "agent-pool/session-factory.ts"))).toBe(false);
    expect(graph.has(resolve(source, "agent-pool/session-affinity-compat.ts"))).toBe(false);
    if (entry === "agent-pool.ts") {
      expect(graph.has(resolve(source, "agent-pool/run-agent-orchestrator.ts"))).toBe(false);
      expect(graph.has(resolve(source, "agent-pool/run-agent-attempt-budget.ts"))).toBe(false);
      expect(graph.has(resolve(source, "agent-pool/run-agent-attempt-context.ts"))).toBe(false);
      expect(graph.has(resolve(source, "agent-pool/run-agent-attempt-finalization.ts"))).toBe(false);
      expect(graph.has(resolve(source, "agent-pool/run-agent-recovery-phase.ts"))).toBe(false);
      expect(graph.has(resolve(source, "agent-pool/automatic-recovery.ts"))).toBe(false);
      expect(graph.has(resolve(source, "agent-pool/compaction.ts"))).toBe(false);
      expect(graph.has(resolve(source, "agent-pool/operation-session-profile.ts"))).toBe(false);
    }
    // The real pool remains in the application graph: this must not pass by dropping startup wiring.
    if (entry !== "index.ts") expect(graph.has(resolve(source, "agent-pool/service-factory.ts"))).toBe(true);
  });
}
