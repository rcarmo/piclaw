import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

const source = resolve(import.meta.dir, "../../src");
const fixture = resolve(import.meta.dir, "../model-services-fixture.ts");
// Resolve the frozen repository SDK before entering a scratch cwd; bare eval
// imports there can trigger Bun auto-install rather than test this dependency.
const sdk = import.meta.resolve("@earendil-works/pi-coding-agent");

for (const mode of ["bound", "empty"] as const) {
  test(`durable service-factory ${mode} scope does not evaluate legacy construction modules`, async () => {
    const root = mkdtempSync(resolve(tmpdir(), "durable-service-factory-boundary-"));

    const script = `
      import { plugin } from "bun";
      const source = ${JSON.stringify(source)};
      const attempts = [];
      plugin({ name: "durable-service-factory-fence", setup(build) {
        build.onLoad({ filter: /\\/agent-pool\\/(session-manager|session-binder|tool-factory|turn-coordinator)\\.(ts|js)$/ }, args => {
          if (!args.path.startsWith(source + "/")) return;
          attempts.push(args.path);
          throw new Error("DURABLE_SERVICE_FACTORY_FENCE:" + args.path);
        });
      }});

      const { SettingsManager, ModelRegistry } = await import(${JSON.stringify(sdk)});
      const { createAgentPoolModelOptions } = await import(${JSON.stringify(fixture)});
      const { createAgentPoolServices } = await import(source + "/agent-pool/service-factory.ts");

      const mode = ${JSON.stringify(mode)};
      const model = createAgentPoolModelOptions();
      const durablePort = mode === "bound"
        ? { sessionId: "durable", branchId: "main", readPosition: async () => "leaf", readModel: async () => "provider/model" }
        : undefined;

      const services = createAgentPoolServices({
        pool: new Map(),
        authStorage: model.credentialStore,
        modelRuntime: model.modelRuntime,
        modelRegistry: new ModelRegistry(model.modelRuntime),
        settingsManager: SettingsManager.inMemory(),
        workspaceDir: process.env.PICLAW_WORKSPACE,
        getDurableSession: () => durablePort,
      });

      for(const field of ['sessionManager','sessionBinder','toolFactory']){
        if(field in services)throw Error('Native lifecycle placeholder remains: '+field);
      }
      if ("turnCoordinator" in services) throw new Error("Retired turn owner must be absent");

      console.log(JSON.stringify({ mode, attempts }));
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
        stdout: "pipe",
        stderr: "pipe",
      });

      const [stdout, stderr, exitCode] = await Promise.all([
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
        child.exited,
      ]);

      expect({ exitCode, stderr: exitCode ? stderr : "" }).toEqual({ exitCode: 0, stderr: "" });
      const result = JSON.parse(stdout.trim().split("\n").at(-1)!);
      expect(result.mode).toBe(mode);
      expect(result.attempts).toEqual([]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }, 30000);
}

test("legacy service-factory path reaches legacy construction fence immediately", async () => {
  const root = mkdtempSync(resolve(tmpdir(), "legacy-service-factory-boundary-"));

  const script = `
    import { plugin } from "bun";
    const source = ${JSON.stringify(source)};
    const attempts = [];
    plugin({ name: "legacy-service-factory-fence", setup(build) {
      build.onLoad({ filter: /\\/agent-pool\\/(session-manager|session-binder|tool-factory|turn-coordinator)\\.(ts|js)$/ }, args => {
        if (!args.path.startsWith(source + "/")) return;
        attempts.push(args.path);
        throw new Error("LEGACY_SERVICE_FACTORY_FENCE:" + args.path);
      });
    }});

    const { SettingsManager, ModelRegistry } = await import(${JSON.stringify(sdk)});
    const { createAgentPoolModelOptions } = await import(${JSON.stringify(fixture)});
    const { createAgentPoolServices } = await import(source + "/agent-pool/service-factory.ts");
    const model = createAgentPoolModelOptions();

    // Explicit resident-capture composition, never an omitted native callback.
    createAgentPoolServices({legacyCapture:true,
      pool: new Map(),
      authStorage: model.credentialStore,
      modelRuntime: model.modelRuntime,
      modelRegistry: new ModelRegistry(model.modelRuntime),
      settingsManager: SettingsManager.inMemory(),
      workspaceDir: process.env.PICLAW_WORKSPACE,
    });

    console.log(JSON.stringify({ attempts }));
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
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ]);

    expect(exitCode).toBe(1);
    expect(stderr).toContain("LEGACY_SERVICE_FACTORY_FENCE:");
    expect(stderr).toMatch(/\/agent-pool\/(session-manager|session-binder|tool-factory|turn-coordinator)\./);
    expect(stdout.trim()).toBe("");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}, 30000);
