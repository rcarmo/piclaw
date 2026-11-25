import { createHash } from "node:crypto";
import type { Database } from "bun:sqlite";
import { Type, type Static } from "typebox";
import { Value } from "typebox/value";
import { admitSqliteWrite } from "../../../src/db/sqlite-async-admission.js";
import { McpConnectionInputSchema, McpConnectionStore, type McpConnectionInput } from "./connections.ts";
import { mcpEndpoint } from "./client.ts";
import { mcpEnvironmentValueIssue } from "./environment.ts";

type MigrationDiagnostic = { name: string; fields: string[]; reason: string };

/** Read-only cutover planner. Never resolves credentials, executes commands or edits legacy source. */
export function planLegacyMcpMigration(servers: Record<string, unknown>, workspace: { id: string; root: string }) {
  const connections: McpConnectionInput[] = [], diagnostics: MigrationDiagnostic[] = [];
  const supported = new Set(["url", "command", "args", "cwd", "env", "disabled", "directTools", "bearerTokenKeychain", "bearerTokenEnv", "auth"]);
  for (const [name, raw] of Object.entries(servers).sort(([a], [b]) => a.localeCompare(b))) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      diagnostics.push({ name, fields: [], reason: "Invalid legacy server definition; original source is unchanged" });
      continue;
    }
    const row = raw as Record<string, unknown>, fields = Object.keys(row).filter(key => !supported.has(key));
    if (!/^[A-Za-z0-9_]{1,128}$/.test(name)) {
      diagnostics.push({ name, fields: ["name"], reason: "Server name needs explicit migration; original source is unchanged" });
      continue;
    }
    for (const key of ["disabled", "directTools"]) if (row[key] !== undefined && typeof row[key] !== "boolean") fields.push(key);
    if (row.url !== undefined && row.command !== undefined) fields.push("transport");
    const id = "import_" + createHash("sha256").update(JSON.stringify([workspace.id, name])).digest("hex").slice(0, 32);
    const common = { id, name, workspaceId: workspace.id, enabled: row.disabled !== true, allowHttp: false, timeoutSeconds: 30 };
    let candidate: McpConnectionInput;
    if (typeof row.url === "string") {
      let url: URL;
      try { url = new URL(row.url); mcpEndpoint(row.url, url.protocol === "http:"); }
      catch {
        diagnostics.push({ name, fields: ["url"], reason: "Invalid or credential-bearing legacy MCP URL; original source is unchanged" });
        continue;
      }
      const reference = typeof row.bearerTokenKeychain === "string" ? row.bearerTokenKeychain : undefined;
      const anonymous=(row.auth===false||row.auth==='none')&&!reference;
      if(!anonymous&&!reference)fields.push('bearerTokenKeychain');
      if(row.auth!==undefined&&row.auth!==false&&row.auth!=='none'&&row.auth!=='bearer'||row.auth==='none'&&reference)fields.push('auth');
      // Direct-tool exposure is now deferred. Never quietly reinterpret an explicit legacy request.
      if (row.directTools === true) fields.push("directTools");
      for (const key of ["args", "cwd", "env"]) if (row[key] !== undefined) fields.push(key);
      candidate = { ...common, transport: "http", url: row.url, credentialUrl: row.url, auth: anonymous?'none':'bearer', bearerTokenKeychain: reference, allowHttp: url.protocol === "http:" };
    } else if (typeof row.command === "string") {
      if(row.auth!==undefined)fields.push('auth');
      if (row.args !== undefined && (!Array.isArray(row.args) || row.args.some(arg => typeof arg !== "string"))) {
        diagnostics.push({ name, fields: ["args"], reason: "Invalid legacy command arguments; original source is unchanged" });
        continue;
      }
      const env: Record<string, string> = {};
      if (row.env !== undefined) {
        if (!row.env || typeof row.env !== "object" || Array.isArray(row.env)) fields.push("env");
        else for (const [key, value] of Object.entries(row.env)) {
          if (typeof value !== "string" || mcpEnvironmentValueIssue(key, value) || /\$\{|\{env:/.test(value)) fields.push("env." + key);
          else env[key] = value;
        }
      }
      const command = [row.command, ...(row.args as string[] | undefined) ?? []];
      if (command.some(value => value.includes("\0"))) {
        diagnostics.push({ name, fields: ["command"], reason: "Invalid legacy command; original source is unchanged" });
        continue;
      }
      let workdir = typeof row.cwd === "string" ? row.cwd : workspace.root;
      if (row.cwd !== undefined && typeof row.cwd !== "string" || !workdir.startsWith("/") || /\$\{|\{env:/.test(workdir)) { fields.push("cwd"); workdir = workspace.root; }
      if (command.some(value => /\$|\{env:|^!/.test(value))) fields.push("command");
      if (row.directTools === true) fields.push("directTools");
      candidate = { ...common, transport: "stdio", url: "", auth: "bearer", command, workdir, env };
    } else {
      diagnostics.push({ name, fields: ["transport"], reason: "Unsupported legacy transport; original source is unchanged" });
      continue;
    }
    if (fields.length) {
      candidate.enabled = false;
      if(fields.includes('legacyCredentialApprovalRequired')){if(candidate.transport==='http')candidate.credentialUrl='';else candidate.credentialCommand='';}
      diagnostics.push({ name, fields: [...new Set(fields)].sort(), reason: "Imported disabled; review legacy fields before connecting. Original source is unchanged" });
    }
    try { Value.Assert(McpConnectionInputSchema, candidate); connections.push(candidate); }
    catch { diagnostics.push({ name, fields: ["definition"], reason: "Legacy definition needs explicit repair; original source is unchanged" }); }
  }
  return { connections, diagnostics };
}

const migrationReceiptSchema = Type.Object({
  version: Type.Literal(1), sourceHash: Type.String({ pattern: "^[a-f0-9]{64}$" }), imported: Type.Array(Type.String()),
  diagnostics: Type.Array(Type.Object({ name: Type.String(), fields: Type.Array(Type.String()), reason: Type.String() })),
}, { additionalProperties: false });
type MigrationReceipt = Static<typeof migrationReceiptSchema>;
const readReceipt = (text: string): MigrationReceipt => {
  const value: unknown = JSON.parse(text); Value.Assert(migrationReceiptSchema, value); return value;
};

/** One cutover, not ongoing legacy sync. Never resurrect an operator's later deletion or overwrite an edit. */
export async function importLegacyMcpOnce(database: Database, store: McpConnectionStore, servers: Record<string, unknown>, workspace: { id: string; root: string }, assertOwner: () => void) {
  const key = "native.mcp-config-import.v1"; assertOwner();
  const existing = database.query<{ value: string }, [string]>("SELECT value FROM router_state WHERE key=?").get(key);
  if (existing) return readReceipt(existing.value);
  const sourceHash = createHash("sha256").update(JSON.stringify(servers)).digest("hex"), plan = planLegacyMcpMigration(servers, workspace), imported: string[] = [];
  const present = new Set(store.list().map(row => row.id));
  if (present.size + plan.connections.filter(row => !present.has(row.id)).length > 100) throw Error("Legacy MCP import exceeds the 100-connection limit; original source is unchanged");
  // Deterministic IDs let an interrupted initial import resume; no completion marker is written until every row exists.
  for (const row of plan.connections) {
    assertOwner(); if (!store.credential(row.id)) await store.save(row, { expectedRevision: 0, authorise: assertOwner }); imported.push(row.id);
  }
  const receipt: MigrationReceipt = { version: 1, sourceHash, imported, diagnostics: plan.diagnostics };
  await admitSqliteWrite(database, () => {
    assertOwner(); const found = database.query<{ value: string }, [string]>("SELECT value FROM router_state WHERE key=?").get(key);
    if (found) {
      if (readReceipt(found.value).sourceHash !== sourceHash) throw Error("Legacy MCP source changed during import");
      return;
    }
    database.query("INSERT INTO router_state(key,value) VALUES(?,?)").run(key, JSON.stringify(receipt));
  }, assertOwner, undefined, undefined, assertOwner);
  return receipt;
}
