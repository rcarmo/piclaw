import { AgentRuntimeFacade } from "../../src/agent-pool/runtime-facade.js";
import { buildSessionTreeSnapshot } from "../../src/agent-control/session-tree-snapshot.js";

/** Synthetic control ports for handler rendering/auth/fuzz tests, never a prompt executor.
 * Real maintenance, accounting and lifetime ownership are qualified separately. */
export function createNativeControlFixture(state: any, registry: any, chatJid = "web:default") {
  const lifetime = new AbortController();
  const port = {
    sessionId: state.sessionId, branchId: "main", lifetimeSignal: lifetime.signal,
    assertCurrent() { if (lifetime.signal.aborted) throw Error("fixture lifetime ended"); },
    runOwnedControl: <T>(operation: () => Promise<T>) => operation(),
    readPosition: async () => state.sessionManager.getLeafId(),
    readTree: async () => buildSessionTreeSnapshot(state.sessionManager),
    readModel: async () => state.model ? `${state.model.provider}/${state.model.id}` : null,
    readThinkingLevel: async () => state.thinkingLevel,
    setModel: async (value: { provider: string; modelId: string }) => {
      state.model = registry.getAll().find((model: any) => model.provider === value.provider && model.id === value.modelId);
    },
    setThinkingLevel: async (level: string) => { state.thinkingLevel = level; },
    readContextUsage: async () => ({ tokens: 0, contextWindow: state.model?.contextWindow ?? null }),
    compact: async () => ({ compacted: false }),
    reset: async () => {},
    abort: async () => false,
    abortRetry: async () => false,
    abortBash: async () => false,
    readExecutionPolicy: async () => ({ autoCompact: state.autoCompactionEnabled, autoRetry: state.autoRetryEnabled }),
    setExecutionPolicy: async (key: "autoCompact" | "autoRetry", enabled: boolean) => {
      state[key === "autoCompact" ? "autoCompactionEnabled" : "autoRetryEnabled"] = enabled;
    },
  };
  const facade = new AgentRuntimeFacade({ pool: new Map(), authPath: "unused", modelRegistry: registry,
    modelRuntime: state.modelRuntime, getDurableSession: chat => chat === chatJid ? port : undefined });
  return { facade, dispose: () => lifetime.abort() };
}
