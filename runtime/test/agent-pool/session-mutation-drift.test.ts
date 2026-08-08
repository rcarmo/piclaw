import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { relative, resolve } from "node:path";
import * as ts from "typescript";

const sourceRoot = resolve(import.meta.dir, "../../src");
const upstreamCoreRoot = resolve(
  sourceRoot,
  "../../node_modules/@earendil-works/pi-coding-agent/dist/core",
);

type UpstreamMethodClass = "read_only" | "observer" | "external_export" | "persistent_mutation" | "runtime_mutation";

const upstreamMethodClass: Record<string, UpstreamMethodClass> = {
  "AgentSession.abort": "runtime_mutation",
  "AgentSession.abortBash": "runtime_mutation",
  "AgentSession.abortBranchSummary": "runtime_mutation",
  "AgentSession.abortCompaction": "runtime_mutation",
  "AgentSession.abortRetry": "runtime_mutation",
  "AgentSession.bindExtensions": "runtime_mutation",
  "AgentSession.clearQueue": "runtime_mutation",
  "AgentSession.compact": "persistent_mutation",
  "AgentSession.createReplacedSessionContext": "read_only",
  "AgentSession.cycleModel": "persistent_mutation",
  "AgentSession.cycleThinkingLevel": "persistent_mutation",
  "AgentSession.dispose": "runtime_mutation",
  "AgentSession.executeBash": "persistent_mutation",
  "AgentSession.exportToHtml": "external_export",
  "AgentSession.exportToJsonl": "external_export",
  "AgentSession.followUp": "runtime_mutation",
  "AgentSession.getActiveToolNames": "read_only",
  "AgentSession.getAllTools": "read_only",
  "AgentSession.getAvailableThinkingLevels": "read_only",
  "AgentSession.getContextUsage": "read_only",
  "AgentSession.getFollowUpMessages": "read_only",
  "AgentSession.getLastAssistantText": "read_only",
  "AgentSession.getSessionStats": "read_only",
  "AgentSession.getSteeringMessages": "read_only",
  "AgentSession.getToolDefinition": "read_only",
  "AgentSession.getUserMessagesForForking": "read_only",
  "AgentSession.hasExtensionHandlers": "read_only",
  "AgentSession.navigateTree": "persistent_mutation",
  "AgentSession.prompt": "persistent_mutation",
  "AgentSession.recordBashResult": "persistent_mutation",
  "AgentSession.reload": "runtime_mutation",
  "AgentSession.sendCustomMessage": "persistent_mutation",
  "AgentSession.sendUserMessage": "persistent_mutation",
  "AgentSession.setActiveToolsByName": "runtime_mutation",
  "AgentSession.setAutoCompactionEnabled": "persistent_mutation",
  "AgentSession.setAutoRetryEnabled": "persistent_mutation",
  "AgentSession.setFollowUpMode": "persistent_mutation",
  "AgentSession.setModel": "persistent_mutation",
  "AgentSession.setScopedModels": "runtime_mutation",
  "AgentSession.setSessionName": "persistent_mutation",
  "AgentSession.setSteeringMode": "persistent_mutation",
  "AgentSession.setThinkingLevel": "persistent_mutation",
  "AgentSession.steer": "runtime_mutation",
  "AgentSession.subscribe": "observer",
  "AgentSession.supportsThinking": "read_only",
  "AgentSession.waitForIdle": "observer",
  "AgentSessionRuntime.dispose": "runtime_mutation",
  "AgentSessionRuntime.fork": "persistent_mutation",
  "AgentSessionRuntime.importFromJsonl": "persistent_mutation",
  "AgentSessionRuntime.newSession": "persistent_mutation",
  "AgentSessionRuntime.setBeforeSessionInvalidate": "runtime_mutation",
  "AgentSessionRuntime.setRebindSession": "runtime_mutation",
  "AgentSessionRuntime.switchSession": "persistent_mutation",
};

const directMethodNames = new Set(
  Object.entries(upstreamMethodClass)
    .filter(([, classification]) => classification === "persistent_mutation" || classification === "runtime_mutation")
    .map(([key]) => key.slice(key.indexOf(".") + 1))
    .filter((method) => method !== "abort" && method !== "dispose"),
);
const directFunctionNames = new Set(["rotateSession", "maybeAutoCompactSessionBeforePrompt"]);
const expectedGatewayMethodNames = new Set([
  "runAgent", "applyControlCommand", "cancelOperationAndAbort", "emergencyRotateSession", "runSessionMutation",
  "restoreSessionPosition", "disposeChatSession", "getSessionForIntrospection", "renameChatBranch",
  "pruneChatBranch", "mergeChatBranchIntoParent", "renameChatJid", "restoreChatBranch",
  "permanentPurgeChatBranch", "queueStreamingMessage", "removeQueuedFollowupMessage", "applySlashCommand",
]);

type Inventory = Record<string, Record<string, number>>;

function add(inventory: Inventory, file: string, mutation: string): void {
  const entry = (inventory[file] ??= {});
  entry[mutation] = (entry[mutation] ?? 0) + 1;
}

function sortInventory(inventory: Inventory): Inventory {
  return Object.fromEntries(
    Object.entries(inventory).sort(([left], [right]) => left.localeCompare(right)).map(([file, methods]) => [
      file,
      Object.fromEntries(Object.entries(methods).sort(([left], [right]) => left.localeCompare(right))),
    ]),
  );
}

function sourceFile(path: string): ts.SourceFile {
  return ts.createSourceFile(path, readFileSync(path, "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
}

function collectUpstreamPublicMethods(fileName: string, className: string): string[] {
  const methods: string[] = [];
  sourceFile(resolve(upstreamCoreRoot, fileName)).forEachChild((node) => {
    if (!ts.isClassDeclaration(node) || node.name?.text !== className) return;
    for (const member of node.members) {
      if (!ts.isMethodDeclaration(member) || !member.name || !ts.isIdentifier(member.name)) continue;
      if (member.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.PrivateKeyword)) continue;
      methods.push(`${className}.${member.name.text}`);
    }
  });
  return methods.sort();
}

function collectAgentPoolGatewayMethods(): Set<string> {
  const methods = new Set<string>();
  const agentPool = sourceFile(resolve(sourceRoot, "agent-pool.ts"));
  agentPool.forEachChild((node) => {
    if (!ts.isClassDeclaration(node) || node.name?.text !== "AgentPool") return;
    for (const member of node.members) {
      if (!ts.isMethodDeclaration(member) || !member.body || !member.name || !ts.isIdentifier(member.name)) continue;
      if (member.modifiers?.some((modifier) => (
        modifier.kind === ts.SyntaxKind.PrivateKeyword || modifier.kind === ts.SyntaxKind.ProtectedKeyword
      ))) continue;
      let invokesGateway = false;
      const visit = (child: ts.Node): void => {
        if (ts.isPropertyAccessExpression(child)
          && child.expression.getText(agentPool) === "this.mutationGateway") invokesGateway = true;
        ts.forEachChild(child, visit);
      };
      visit(member.body);
      if (invokesGateway) methods.add(member.name.text);
    }
  });
  return methods;
}

const gatewayMethodNames = collectAgentPoolGatewayMethods();

function collectInventory(): { direct: Inventory; callers: Inventory } {
  const direct: Inventory = {};
  const callers: Inventory = {};
  for (const path of new Bun.Glob("**/*.ts").scanSync({ cwd: sourceRoot, absolute: true })) {
    const file = relative(sourceRoot, path).replaceAll("\\", "/");
    const source = readFileSync(path, "utf8");
    const sourceFile = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
    const visit = (node: ts.Node): void => {
      if (ts.isCallExpression(node)) {
        const expression = node.expression;
        if (ts.isPropertyAccessExpression(expression)) {
          const method = expression.name.text;
          const receiver = expression.expression.getText(sourceFile);
          if (directMethodNames.has(method)) add(direct, file, method);
          if (method === "abort" && /session/i.test(receiver)) add(direct, file, method);
          if (method === "dispose" && /(?:session|runtime)/i.test(receiver)) add(direct, file, method);
          if (file !== "agent-pool.ts" && gatewayMethodNames.has(method)) add(callers, file, method);
        } else if (ts.isIdentifier(expression) && directFunctionNames.has(expression.text)) {
          add(direct, file, expression.text);
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(sourceFile);
  }
  return { direct: sortInventory(direct), callers: sortInventory(callers) };
}

const directOwnershipClass: Record<string, string> = {
  "agent-control/agent-control-helpers.ts": "control-or-recovery-beneath-gateway",
  "agent-control/handlers/control.ts": "legacy-control-beneath-gateway",
  "agent-control/handlers/model.ts": "legacy-control-beneath-gateway",
  "agent-control/handlers/operations.ts": "legacy-control-beneath-gateway",
  "agent-control/handlers/queue.ts": "legacy-control-beneath-gateway",
  "agent-control/handlers/session.ts": "legacy-control-beneath-gateway",
  "agent-control/handlers/tree.ts": "legacy-control-beneath-gateway",
  "agent-pool.ts": "gateway-implementation",
  "agent-pool/branch-manager.ts": "legacy-lifecycle-beneath-gateway",
  "agent-pool/compaction.ts": "operation-or-legacy-beneath-gateway",
  "agent-pool/context-pressure-retry.ts": "operation-or-legacy-beneath-gateway",
  "agent-pool/run-agent-attempt-budget.ts": "operation-owned-beneath-gateway",
  "agent-pool/run-agent-attempt-context.ts": "operation-owned-beneath-gateway",
  "agent-pool/run-agent-orchestrator.ts": "operation-or-legacy-beneath-gateway",
  "agent-pool/run-agent-recovery-phase.ts": "operation-or-legacy-beneath-gateway",
  "agent-pool/runtime-facade.ts": "operation-or-legacy-beneath-gateway",
  "agent-pool/session-manager.ts": "session-lifecycle-beneath-gateway",
  "agent-pool/session.ts": "session-lifecycle-beneath-gateway",
  "agent-pool/side-prompt-runner.ts": "isolated-side-session",
  "agent-pool/slash-command.ts": "control-beneath-gateway",
  "agent-pool/turn-coordinator.ts": "operation-or-legacy-beneath-gateway",
  "channels/web/theming/ui-bridge.ts": "bound-callback-through-gateway",
  "extensions/model-control.ts": "extension-inside-owning-prompt-context",
  "session-rotation.ts": "rotation-beneath-gateway",
};

const expectedDirect: Inventory = {
  "agent-control/agent-control-helpers.ts": { compact: 1, prompt: 1, setThinkingLevel: 1 },
  "agent-control/handlers/control.ts": { abort: 3, abortBash: 1, abortCompaction: 1, abortRetry: 1, compact: 1, reload: 1, setAutoCompactionEnabled: 1, setAutoRetryEnabled: 1 },
  "agent-control/handlers/model.ts": { compact: 1, cycleModel: 1, cycleThinkingLevel: 1, setModel: 2 },
  "agent-control/handlers/operations.ts": { executeBash: 1 },
  "agent-control/handlers/queue.ts": { prompt: 1, setFollowUpMode: 2, setSteeringMode: 1 },
  "agent-control/handlers/session.ts": { fork: 2, newSession: 1, rotateSession: 1, setSessionName: 2, switchSession: 2 },
  "agent-control/handlers/tree.ts": { navigateTree: 1 },
  "agent-pool.ts": { rotateSession: 1 },
  "agent-pool/branch-manager.ts": { dispose: 10, setSessionName: 1 },
  "agent-pool/compaction.ts": { abort: 1, abortCompaction: 1, compact: 1 },
  "agent-pool/context-pressure-retry.ts": { compact: 1, prompt: 1 },
  "agent-pool/run-agent-attempt-budget.ts": { setActiveToolsByName: 3 },
  "agent-pool/run-agent-attempt-context.ts": { abort: 2 },
  "agent-pool/run-agent-orchestrator.ts": { abort: 3, clearQueue: 1, maybeAutoCompactSessionBeforePrompt: 1, prompt: 1, rotateSession: 4, setActiveToolsByName: 1 },
  "agent-pool/run-agent-recovery-phase.ts": { compact: 1 },
  "agent-pool/runtime-facade.ts": { clearQueue: 2, navigateTree: 1, prompt: 2 },
  "agent-pool/session-manager.ts": { dispose: 1, newSession: 2, setActiveToolsByName: 1, setModel: 1, setSessionName: 1, setThinkingLevel: 2, switchSession: 1 },
  "agent-pool/session.ts": { reload: 1, setAutoCompactionEnabled: 1 },
  "agent-pool/side-prompt-runner.ts": { abort: 2, prompt: 1 },
  "agent-pool/slash-command.ts": { abort: 1 },
  "agent-pool/turn-coordinator.ts": { abort: 2 },
  "channels/web/theming/ui-bridge.ts": { bindExtensions: 1, fork: 1, navigateTree: 1, newSession: 1, reload: 1, switchSession: 1 },
  "extensions/model-control.ts": { setModel: 1, setThinkingLevel: 1 },
  "session-rotation.ts": { compact: 1, newSession: 1, switchSession: 2 },
};

const expectedCallers: Inventory = {
  "channels/web/agent/agent-commands.ts": { getSessionForIntrospection: 1 },
  "channels/web/agent/agent-control-plane-service.ts": { applySlashCommand: 1, mergeChatBranchIntoParent: 1, permanentPurgeChatBranch: 1, pruneChatBranch: 1, queueStreamingMessage: 1, removeQueuedFollowupMessage: 1, renameChatBranch: 1, renameChatJid: 1, restoreChatBranch: 1 },
  "channels/web/agent/agent-debug.ts": { getSessionForIntrospection: 1 },
  "channels/web/cards/adaptive-card-side-prompt-service.ts": { applyControlCommand: 1 },
  "channels/web/core/web-channel-runtime-public-surface-service.ts": { queueStreamingMessage: 1 },
  "channels/web/handlers/addons.ts": { applySlashCommand: 1 },
  "channels/web/handlers/agent.ts": { applyControlCommand: 3, applySlashCommand: 1, cancelOperationAndAbort: 1, queueStreamingMessage: 2, runAgent: 1 },
  "channels/web/runtime/process-chat-control-runtime.ts": { applyControlCommand: 1 },
  "channels/web/runtime/process-chat-preflight-runtime.ts": { emergencyRotateSession: 2, runSessionMutation: 2 },
  "channels/web/runtime/queued-followup-lifecycle-service.ts": { removeQueuedFollowupMessage: 1 },
  "dream.ts": { applyControlCommand: 1, disposeChatSession: 1, runAgent: 1 },
  "runtime/message-loop.ts": { applyControlCommand: 1, applySlashCommand: 1, runAgent: 1 },
  "runtime/startup.ts": { applyControlCommand: 3, cancelOperationAndAbort: 2 },
  "task-scheduler.ts": { applyControlCommand: 1, restoreSessionPosition: 1, runAgent: 1 },
};

const mutationInventory = collectInventory();

describe("persistent session mutation drift", () => {
  test("classifies every upstream public session method", () => {
    const declared = [
      ...collectUpstreamPublicMethods("agent-session.d.ts", "AgentSession"),
      ...collectUpstreamPublicMethods("agent-session-runtime.d.ts", "AgentSessionRuntime"),
    ].sort();
    expect(Object.keys(upstreamMethodClass).sort()).toEqual(declared);
  });

  test("derives every public AgentPool entry that invokes the mutation gateway", () => {
    expect([...gatewayMethodNames].sort()).toEqual([...expectedGatewayMethodNames].sort());
  });

  test("snapshots every direct runtime mutator and assigns one ownership class", () => {
    expect(mutationInventory.direct).toEqual(expectedDirect);
    expect(Object.keys(directOwnershipClass).sort()).toEqual(Object.keys(mutationInventory.direct).sort());
  });

  test("snapshots every caller of a public persistent-session gateway entry", () => {
    expect(mutationInventory.callers).toEqual(expectedCallers);
  });

  test("keeps post-cancellation occupied-lane access inside the coupled gateway primitive", () => {
    const callers: string[] = [];
    for (const path of new Bun.Glob("**/*.ts").scanSync({ cwd: sourceRoot, absolute: true })) {
      const source = readFileSync(path, "utf8");
      if (source.includes(".cancelAndActAbort(")) callers.push(relative(sourceRoot, path).replaceAll("\\", "/"));
    }
    expect(callers).toEqual(["agent-pool.ts"]);
  });

  test("keeps web preflight and bound extension actions on the gateway", () => {
    const preflight = readFileSync(resolve(sourceRoot, "channels/web/runtime/process-chat-preflight-runtime.ts"), "utf8");
    expect(preflight).not.toContain("getSessionForIntrospection");
    expect(preflight.match(/\.runSessionMutation\(/g)).toHaveLength(2);

    const uiBridge = readFileSync(resolve(sourceRoot, "channels/web/theming/ui-bridge.ts"), "utf8");
    for (const mutation of ["newSession", "fork", "navigateTree", "switchSession", "reload"]) {
      expect(uiBridge).toMatch(new RegExp(`${mutation}:[\\s\\S]{0,180}mutate\\(`));
    }
  });
});
