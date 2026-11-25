import { getExtensionKvStore } from '../extension-kv-registry.js';
import { classifyDelegateModels, isDelegateModelId, normalizeConfig, type AvailableModel, type DelegateConfig } from './policy.js';

/** Current-native config keeps its existing namespace; reads never adopt/rewrite it.
 * The authenticated request's existing KV router owns write admission and SQL. */
export function createDelegateSettings(options: {
  assertCurrent(): void;
  models(): AvailableModel[];
  defaultModel(): string;
}) {
  const read = () => { options.assertCurrent(); return normalizeConfig(getExtensionKvStore().get<DelegateConfig>('delegate', 'config', 'global')); };
  const snapshot = (config: DelegateConfig, models = options.models()) => {
    const approved = new Set(config.approved_models);
    const available = classifyDelegateModels(models, config.provider_order);
    const addable = new Set(available.map(model => model.id));
    return {
      ok: true, source: 'native', config,
      models: models.map(({ fullId, name }) => ({ id: fullId, name,
        ...(addable.has(fullId) ? {} : { reason: 'Unavailable for Delegate' }) })),
      available, candidates: available.filter(model => approved.has(model.id)),
      runtime_catalog: { captured_at: Date.now(), current_model: options.defaultModel(), model_count: models.length },
    };
  };
  return {
    get() { return { ok: true, config: read() }; },
    async set(input: unknown) {
      if (!input || typeof input !== 'object' || Array.isArray(input)) throw Error('Delegate approval change required');
      const [key] = Object.keys(input);
      if (Object.keys(input).length !== 1 || (key !== 'add_model' && key !== 'remove_model'))
        throw Error('Specify exactly one model to add or remove');
      const id = (input as Record<string, unknown>)[key];
      if (!isDelegateModelId(id)) throw Error('Exact provider/model ID required');
      options.assertCurrent();
      return getExtensionKvStore().write!('delegate', () => {
        options.assertCurrent();
        const current = read(), models = options.models();
        if (key === 'add_model' && !classifyDelegateModels(models).some(model => model.id === id))
          throw Error('Only a currently available model may be added');
        const approved = new Set(current.approved_models);
        if (key === 'add_model') approved.add(id);
        else approved.delete(id);
        const config = { ...current, approved_models: [...approved] };
        getExtensionKvStore().set('delegate', 'config', config, 'global');
        options.assertCurrent();
        return snapshot(config, models);
      });
    },
    models() { return snapshot(read()); },
  };
}

export const delegateInstructions = [
  '## Delegate tool',
  'Use delegate for self-contained work in a fresh SDK child conversation; it receives no parent history.',
  'Only current available native models on the Delegate whitelist and classified by the ordered policy can run. No models are approved by default.',
  'Native automatic selection inherits the parent model. An explicit exact provider/model may override the parent tier, but never the whitelist, classification, current availability or image support.',
  'The omitted tool profile is read_only; request standard explicitly for guarded host editing/shell tools. Explicit host-builtin subsets are supported. Recursive delegation, full/MCP child profiles and task_category judge are not qualified and fail closed.',
  'Text and supported raster image attachments follow the workspace/file limits. Timeout is an integer from 10 to 300 seconds, default 120; native cancellation joins the owned child and is not an uncooperative-provider hard kill.',
  'When delegating, give the user one visible sentence explaining the delegated task and why it is self-contained.',
].join('\n');
