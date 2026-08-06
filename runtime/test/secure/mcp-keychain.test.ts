import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  clearHydratedMcpCredentials,
  getMcpStartupDiagnostics,
  getPreparedMcpConfig,
  hydrateMcpKeychainCredentials,
  resetMcpStartupStateForTests,
} from "../../src/secure/mcp-keychain.js";

const touched = new Set<string>();
afterEach(() => {
  for (const name of touched) delete process.env[name];
  touched.clear();
  resetMcpStartupStateForTests();
});

function workspace(config: object): string {
  const root = mkdtempSync(join(tmpdir(), "piclaw-mcp-keychain-"));
  mkdirSync(join(root, ".pi"), { recursive: true });
  writeFileSync(join(root, ".pi", "mcp.json"), JSON.stringify(config));
  return root;
}

const resolveEntry = async (name: string) => ({
  name,
  type: "token" as const,
  secret: "secret-value",
  username: null,
});

describe("MCP keychain credential hydration", () => {
  test("hydrates a named environment variable without changing config", async () => {
    const root = workspace({
      mcpServers: {
        memento: {
          url: "http://example.test/mcp",
          bearerTokenKeychain: "memento/example",
          bearerTokenEnv: "PICLAW_MCP_MEMENTO_TOKEN",
        },
      },
    });
    touched.add("PICLAW_MCP_MEMENTO_TOKEN");
    const entries = await hydrateMcpKeychainCredentials(root, resolveEntry);
    expect(process.env.PICLAW_MCP_MEMENTO_TOKEN).toBe("secret-value");
    expect(entries).toEqual([
      {
        serverName: "memento",
        envName: "PICLAW_MCP_MEMENTO_TOKEN",
        keychainName: "memento/example",
      },
    ]);
    clearHydratedMcpCredentials(entries);
    expect(process.env.PICLAW_MCP_MEMENTO_TOKEN).toBeUndefined();
  });

  test("quarantines malformed optional servers while hydrating valid servers", async () => {
    touched.add("PICLAW_MCP_VALID_TOKEN");
    const entries = await hydrateMcpKeychainCredentials(
      workspace({
        mcpServers: {
          valid: {
            url: "http://valid.example.test/mcp",
            bearerTokenKeychain: "valid/token",
            bearerTokenEnv: "PICLAW_MCP_VALID_TOKEN",
          },
          missingEnv: {
            url: "http://missing-env.example.test/mcp",
            bearerTokenKeychain: "missing-env/token",
          },
          conflicting: {
            url: "http://conflicting.example.test/mcp",
            bearerToken: "literal",
            bearerTokenKeychain: "conflicting/token",
            bearerTokenEnv: "PICLAW_MCP_CONFLICTING_TOKEN",
          },
        },
      }),
      resolveEntry,
    );

    expect(entries).toEqual([{ serverName: "valid", envName: "PICLAW_MCP_VALID_TOKEN", keychainName: "valid/token" }]);
    expect(process.env.PICLAW_MCP_VALID_TOKEN).toBe("secret-value");
    expect(getPreparedMcpConfig().mcpServers).toMatchObject({
      valid: { bearerTokenEnv: "PICLAW_MCP_VALID_TOKEN" },
      missingEnv: { disabled: true },
      conflicting: { disabled: true },
    });
    expect(getMcpStartupDiagnostics()).toEqual([
      { serverName: "missingEnv", reason: "must set a valid bearerTokenEnv with bearerTokenKeychain." },
      { serverName: "conflicting", reason: "cannot combine bearerToken and bearerTokenKeychain." },
    ]);
    clearHydratedMcpCredentials(entries);
  });

  test("quarantines duplicate keychain environment targets without overwriting the first server", async () => {
    touched.add("PICLAW_MCP_SHARED_TOKEN");
    const entries = await hydrateMcpKeychainCredentials(
      workspace({
        mcpServers: {
          first: { bearerTokenKeychain: "first/token", bearerTokenEnv: "PICLAW_MCP_SHARED_TOKEN" },
          second: { bearerTokenKeychain: "second/token", bearerTokenEnv: "PICLAW_MCP_SHARED_TOKEN" },
        },
      }),
      resolveEntry,
    );
    expect(entries).toEqual([{ serverName: "first", envName: "PICLAW_MCP_SHARED_TOKEN", keychainName: "first/token" }]);
    expect(process.env.PICLAW_MCP_SHARED_TOKEN).toBe("secret-value");
    expect(getPreparedMcpConfig().mcpServers.second).toMatchObject({ disabled: true });
    expect(getMcpStartupDiagnostics()).toEqual([
      { serverName: "second", reason: "bearerTokenEnv PICLAW_MCP_SHARED_TOKEN is already claimed by another MCP server." },
    ]);
    clearHydratedMcpCredentials(entries);
  });

  test("quarantines missing keychain entries without clearing valid credentials", async () => {
    touched.add("PICLAW_MCP_VALID_TOKEN");
    const entries = await hydrateMcpKeychainCredentials(
      workspace({
        mcpServers: {
          valid: {
            bearerTokenKeychain: "valid/token",
            bearerTokenEnv: "PICLAW_MCP_VALID_TOKEN",
          },
          unavailable: {
            bearerTokenKeychain: "missing/token",
            bearerTokenEnv: "PICLAW_MCP_UNAVAILABLE_TOKEN",
          },
        },
      }),
      async (name) => name === "missing/token"
        ? { name, type: "token", secret: null, username: null }
        : resolveEntry(name),
    );

    expect(entries).toEqual([{ serverName: "valid", envName: "PICLAW_MCP_VALID_TOKEN", keychainName: "valid/token" }]);
    expect(getPreparedMcpConfig().mcpServers.unavailable).toMatchObject({ disabled: true });
    expect(getMcpStartupDiagnostics()).toEqual([
      { serverName: "unavailable", reason: "keychain entry is unavailable or has no secret." },
    ]);
    clearHydratedMcpCredentials(entries);
  });

  test("quarantines ambiguous or unsafe credential configuration", async () => {
    const entries = await hydrateMcpKeychainCredentials(
      workspace({
        mcpServers: {
          conflicting: {
            bearerToken: "literal",
            bearerTokenKeychain: "memento/example",
            bearerTokenEnv: "PICLAW_MCP_TOKEN",
          },
          missingEnv: { bearerTokenKeychain: "memento/example" },
        },
      }),
      resolveEntry,
    );
    expect(entries).toEqual([]);
    expect(getPreparedMcpConfig().mcpServers).toMatchObject({
      conflicting: { disabled: true },
      missingEnv: { disabled: true },
    });
  });

  test("validates supported adapter environment references after keychain hydration", async () => {
    process.env.PICLAW_MCP_EXISTING = "existing";
    touched.add("PICLAW_MCP_EXISTING");
    touched.add("PICLAW_MCP_TOKEN");
    const entries = await hydrateMcpKeychainCredentials(
      workspace({
        mcpServers: {
          local: {
            command: "bun",
            args: ["server.ts", "$PLAIN_VAR"],
            cwd: "${PICLAW_MCP_EXISTING}",
            env: {
              FROM_BRACES: "${PICLAW_MCP_TOKEN}",
              FROM_ENV_PREFIX: "$env:PICLAW_MCP_EXISTING",
              FROM_ADAPTER_FORM: "{env:PICLAW_MCP_EXISTING}",
              PLAIN_LITERAL: "$PLAIN_VAR",
              ESCAPED_COMMAND: "!!${PICLAW_MCP_EXISTING}",
              COMMAND_SECRET: "!printf '$SHELL_OWNS_THIS'",
            },
            bearerTokenKeychain: "memento/example",
            bearerTokenEnv: "PICLAW_MCP_TOKEN",
          },
        },
      }),
      resolveEntry,
    );
    expect(process.env.PICLAW_MCP_TOKEN).toBe("secret-value");
    clearHydratedMcpCredentials(entries);
  });

  test("quarantines unresolved stdio, header, URL, and token references", async () => {
    touched.add("PICLAW_MCP_TOKEN");
    const entries = await hydrateMcpKeychainCredentials(
      workspace({
        mcpServers: {
          local: {
            url: "https://example.test/${PICLAW_MCP_MISSING_URL}",
            env: { TOKEN: "$env:PICLAW_MCP_MISSING_ENV" },
            headers: { Authorization: "Bearer {env:PICLAW_MCP_MISSING_HEADER}" },
            bearerTokenKeychain: "memento/example",
            bearerTokenEnv: "PICLAW_MCP_TOKEN",
          },
        },
      }),
      resolveEntry,
    );
    expect(entries).toEqual([]);
    expect(process.env.PICLAW_MCP_TOKEN).toBeUndefined();
    expect(getPreparedMcpConfig().mcpServers.local).toMatchObject({ disabled: true });
    expect(getMcpStartupDiagnostics()[0]?.reason).toContain("references missing environment variable");
  });

  test("does not overwrite an existing environment variable", async () => {
    process.env.PICLAW_MCP_TOKEN = "existing";
    touched.add("PICLAW_MCP_TOKEN");
    const entries = await hydrateMcpKeychainCredentials(
      workspace({
        mcpServers: {
          memento: {
            bearerTokenKeychain: "memento/example",
            bearerTokenEnv: "PICLAW_MCP_TOKEN",
          },
        },
      }),
      resolveEntry,
    );
    expect(entries).toEqual([]);
    expect(process.env.PICLAW_MCP_TOKEN).toBe("existing");
    expect(getPreparedMcpConfig().mcpServers.memento).toMatchObject({ disabled: true });
  });
});
