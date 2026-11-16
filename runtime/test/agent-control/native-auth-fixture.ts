import type { NativeProviderAuthContext } from '../../src/agent-control/provider-auth-context.js';

/** Disposable native authority for handler counterexamples. State is fixture data;
 * no AgentSession methods, legacy disposal patch or credential adapter is used.
 * Mutable getters deliberately exercise replacement/mismatch rejection. Actual
 * command composition and shutdown joins have separate native factory tests. */
export function createNativeAuthFixture(state: any, registry: any, chatJid: string) {
  const lifetime = new AbortController();
  const context: NativeProviderAuthContext = {
    kind: 'native-provider-auth', chatJid,
    get bindingId() { return state.sessionId; },
    get runtime() { return state.modelRuntime; },
    signal: lifetime.signal,
    assertCurrent() { lifetime.signal.throwIfAborted(); },
    runOwned: operation => operation(),
    async activateModel(provider, modelId) {
      lifetime.signal.throwIfAborted();
      const model = registry.getAll().find((model: any) => model.provider === provider && model.id === modelId);
      if (!model) throw Error('Unknown synthetic model');
      state.model = model;
      return { status: 'success', message: `Model set to ${provider}/${modelId}.`, model_label: `${provider}/${modelId}` };
    },
  };
  return { context, dispose: () => lifetime.abort() };
}
