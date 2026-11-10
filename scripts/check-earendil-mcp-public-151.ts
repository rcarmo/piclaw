#!/usr/bin/env bun
/** Bun-only compile admission of exact 1.5.1 public MCP seams. No runtime mocks or MCP connections. */
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";

export const MCP_VERSION = "1.5.1";
export const MCP_GIT_HEAD = "dd30101cfc5b0609411dd80b6f93adbc14db14cf";
export const missingSeams = [
  { symbol: "lazy", code: "TS2353", requirement: "MCP-08" },
  { symbol: "statusObserver", code: "TS2353", requirement: "MCP-12" },
  { symbol: "resourceFilter", code: "TS2353", requirement: "MCP-06" },
  { symbol: "authStart", code: "TS2353", requirement: "MCP-10" },
  { symbol: "appRenderer", code: "TS2353", requirement: "MCP-11" },
  { symbol: "absoluteDeadlineMs", code: "TS2353", requirement: "MCP-07" },
  { symbol: "McpOAuthCredentialStore", code: "TS2740", requirement: "MCP-03" },
  { symbol: "socket", code: "TS2322", requirement: "MCP-08" },
  { symbol: "listPrompts", code: "TS2339", requirement: "MCP-11" },
  { symbol: "getPrompt", code: "TS2339", requirement: "MCP-11" },
] as const;
const positive = `
import { createMcpExtension, createToolSearchExtension, createCodemodeExtension } from '@earendil-works/pi-coding-agent';
import type { McpExtensionOptions, McpTransportFactory, McpServerConfig, ToolLoadout, AgentSession, AgentSessionEvent, CreateAgentSessionOptions, CreateAgentSessionResult } from '@earendil-works/pi-coding-agent';
import { createAgentSession, SessionManager, ModelRuntime, SettingsManager, DefaultResourceLoader } from '@earendil-works/pi-coding-agent';
import { McpClient, StdioTransport, StreamableHttpTransport } from '@earendil-works/pi-mcp';
import * as oauth from '@earendil-works/pi-mcp/oauth';
const factory: McpTransportFactory=()=>new StdioTransport({command:'synthetic-not-executed'});
const config:McpServerConfig={type:'http',url:'https://example.invalid/mcp',enabled:false,exposure:'deferred',toolExposure:{read:'direct',write:'hidden'}};
const options:McpExtensionOptions={loadConfig:()=>({servers:[{name:'synthetic',config,source:'fixture'}],errors:[],autoEnableCodemode:false}),createTransport:factory,updateConfig:()=>{},startupWaitMs:0,openUrl:()=>{}};
void createMcpExtension(options);void createToolSearchExtension();void createCodemodeExtension({mode:'on',models:false});void StreamableHttpTransport;
void oauth.startAuthorization;void oauth.refreshAuthorization;void oauth.MemoryOAuthStateStore;
const client=new McpClient({name:'probe',version:'0'});void client.listTools;void client.listResources;void client.listResourceTemplates;void client.readResource;void client.callTool;void client.request;void client.close;
// The new seam must be reachable by its public type name with the exact readonly signature.
type Equal<A,B>=(<T>()=>T extends A?1:2) extends (<T>()=>T extends B?1:2)?true:false;
const promptGuidelinesSignature:Equal<ToolLoadout['getPromptGuidelines'],(name:string)=>readonly string[]>=true;
declare const loadout:ToolLoadout;const guidelines:readonly string[]=loadout.getPromptGuidelines('synthetic');void guidelines;void promptGuidelinesSignature;
// Compile only: no session, provider, credential or filesystem operations execute.
const sessionFactorySignature:Equal<typeof createAgentSession,(options?:CreateAgentSessionOptions)=>Promise<CreateAgentSessionResult>>=true;
const idleSignature:Equal<AgentSession['waitForIdle'],()=>Promise<void>>=true;
const disposeSignature:Equal<AgentSession['dispose'],()=>void>=true;
const settledEvent:Equal<Extract<AgentSessionEvent,{type:'agent_settled'}>,{type:'agent_settled';aborted:boolean}>=true;
declare const session:AgentSession;const unsubscribe:()=>void=session.subscribe(event=>{if(event.type==='agent_settled'){const aborted:boolean=event.aborted;void aborted;}});
void unsubscribe;void sessionFactorySignature;void idleSignature;void disposeSignature;void settledEvent;void SessionManager.inMemory;void ModelRuntime;void SettingsManager.inMemory;void DefaultResourceLoader;
`;
const negative = `
import type { McpExtensionOptions, McpServerConfig } from '@earendil-works/pi-coding-agent';
import { McpClient } from '@earendil-works/pi-mcp';
const lazy:McpExtensionOptions={lazy:true};
const status:McpExtensionOptions={statusObserver:()=>{}};
const resources:McpExtensionOptions={resourceFilter:()=>true};
const headless:McpExtensionOptions={authStart:async()=>({})};
const apps:McpExtensionOptions={appRenderer:()=>{}};
const deadline:McpExtensionOptions={absoluteDeadlineMs:1};
const credentials:McpExtensionOptions={credentials:{}};
const socket:McpServerConfig={type:'socket',socket:'/tmp/mcp.sock'};
const client=new McpClient({name:'probe',version:'0'});client.listPrompts();client.getPrompt('name');
void lazy;void status;void resources;void headless;void apps;void deadline;void credentials;void socket;
`;
const digest = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");
export function matchNegativeDiagnostics(text: string) {
  const rows = [...text.matchAll(/error (TS\d+): ([^\n]+)/g)].map(match => ({ code: match[1]!, message: match[2]! }));
  if (rows.length !== missingSeams.length) throw new Error(`Expected exactly ${missingSeams.length} public seam diagnostics; got ${rows.length}.`);
  const used = new Set<number>();
  for (const expected of missingSeams) {
    const indexes = rows.flatMap((row, index) => row.code === expected.code && row.message.includes(expected.symbol) ? [index] : []);
    if (indexes.length !== 1 || used.has(indexes[0]!)) throw new Error(`Missing or ambiguous ${expected.code} for ${expected.symbol}.`);
    used.add(indexes[0]!);
  }
  return missingSeams.map(row => ({ ...row }));
}

export function checkMcpPublic151(repoRoot = resolve(import.meta.dir, "..")) {
  if (!process.versions.bun) throw new Error("Bun execution is required.");
  const root = resolve(repoRoot);
  const packages = ["pi-coding-agent", "pi-mcp", "pi-codemode"].map(name => {
    const file = join(root, "node_modules/@earendil-works", name, "package.json");
    const pkg = JSON.parse(readFileSync(file, "utf8"));
    if (pkg.version !== MCP_VERSION) throw new Error(`Exact ${MCP_VERSION} required for ${name}.`);
    return { name: pkg.name as string, version: pkg.version as string };
  });
  const scratch = mkdtempSync(join(tmpdir(), "mcp-api-120-"));
  try {
    symlinkSync(join(root, "node_modules"), join(scratch, "node_modules"), process.platform === "win32" ? "junction" : "dir");
    const compile = (name: string, source: string) => {
      writeFileSync(join(scratch, name + ".ts"), source);
      writeFileSync(join(scratch, name + ".json"), JSON.stringify({ compilerOptions: { target: "ES2024", module: "NodeNext", moduleResolution: "NodeNext", strict: true, noEmit: true, skipLibCheck: true }, files: [name + ".ts"] }));
      const child = Bun.spawnSync([process.execPath, join(root, "node_modules/typescript/bin/tsc"), "--pretty", "false", "-p", join(scratch, name + ".json")], { cwd: scratch, env: { PATH: process.env.PATH, HOME: scratch }, stdout: "pipe", stderr: "pipe", timeout: 30000 });
      if (child.signalCode) throw new Error(`Compiler did not settle normally: ${name}.`);
      return { exit: child.exitCode, text: child.stdout.toString() + child.stderr.toString() };
    };
    const supported = compile("positive", positive);
    if (supported.exit !== 0) throw new Error(`Public MCP positive compile failed: ${supported.text}`);
    const unsupported = compile("negative", negative);
    if (unsupported.exit !== 1 && unsupported.exit !== 2) throw new Error(`Negative compile must exit with diagnostics, got ${unsupported.exit}: ${unsupported.text}`);
    const diagnostics = matchNegativeDiagnostics(unsupported.text);
    return { version: MCP_VERSION, referenceGitHead: MCP_GIT_HEAD, archiveIntegrity: "not_remeasured_by_compile_probe", runtime: `Bun ${Bun.version}`, packages, positive: "pass", negative: diagnostics,
      positiveSourceSha256: digest(positive), negativeSourceSha256: digest(negative),
      scope: "public_type_contract_only", lifecycle: "separate_real_session_fixture", nativeParity: "not_qualified", productionActivation: false };
  } finally { rmSync(scratch, { recursive: true, force: true }); }
}
if (import.meta.main) console.log(JSON.stringify(checkMcpPublic151(), null, 2));
