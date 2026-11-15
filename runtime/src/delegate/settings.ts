import { getExtensionKvStore } from '../extension-kv-registry.js';
import { buildModelCandidates, classifyModel, normalizeConfig, providerSummaries, type AvailableModel, type DelegateConfig } from './policy.js';

/** Current-native config keeps its existing namespace; reads never adopt/rewrite it.
 * The authenticated request's existing KV router owns write admission and SQL. */
export function createDelegateSettings(options: {
  assertCurrent(): void;
  models(): AvailableModel[];
  defaultModel(): string;
}) {
  const read = () => { options.assertCurrent(); return normalizeConfig(getExtensionKvStore().get<DelegateConfig>('delegate', 'config', 'global')); };
  return {
    get() { return { ok: true, config: read() }; },
    async set(input: unknown) {
      if (!input || typeof input !== 'object' || Array.isArray(input)) throw Error('Delegate configuration patch required');
      const patch = structuredClone(input) as Partial<DelegateConfig>;
      options.assertCurrent();
      return getExtensionKvStore().write!('delegate', () => {
        options.assertCurrent();
        const current = read();
        const config = normalizeConfig({ ...current,
          ...(Object.hasOwn(patch, 'searchable_providers') ? { searchable_providers: patch.searchable_providers } : {}),
          ...(Object.hasOwn(patch, 'excluded_providers') ? { excluded_providers: patch.excluded_providers } : {}),
          ...(Object.hasOwn(patch, 'excluded_models') ? { excluded_models: patch.excluded_models } : {}),
        });
        getExtensionKvStore().set('delegate', 'config', config, 'global');
        options.assertCurrent(); return { ok: true, config };
      });
    },
    models() {
      const config = read(), models = options.models(), now = Date.now();
      options.assertCurrent();
      const candidates = buildModelCandidates(models, config), ids = new Set(candidates.map(model => model.id));
      const providers = providerSummaries(models, config), byProvider = new Map(providers.map(provider => [provider.provider, provider]));
      const classified = models.map(model => ({ ...model, classification: classifyModel(model) }));
      const rejected = classified.filter(model => !ids.has(model.fullId)).map(model => ({ ...model, rejection_reason:
        model.classification.status !== 'classified' ? model.classification.reason
          : byProvider.get(model.provider)?.excluded ? `Provider ${model.provider} is excluded`
          : !byProvider.get(model.provider)?.enabled ? `Provider ${model.provider} is not selected`
          : 'Model matches an exclusion pattern',
      }));
      const current = options.defaultModel();
      return {
        ok: true, source: 'native', config, providers, models, candidates,
        runtime_catalog: { captured_at: now, current_model: current, current_classification: classifyModel(current), model_count: models.length },
        executable_catalog: { model_count: models.length, candidate_count: candidates.length },
        effective_exclusions: { providers: providers.filter(provider => provider.excluded).map(provider => provider.provider), models: config.excluded_models },
        runtime_only_models: [], unclassified_models: classified.filter(model => model.classification.status !== 'classified'), rejected_models: rejected,
      };
    },
  };
}

export const delegateInstructions = [
  '## Delegate tool',
  'Use delegate for self-contained work in a fresh SDK child conversation; it receives no parent history.',
  'Only current available native models approved in Delegate Settings, classified by the ordered policy and not excluded can run. No providers are approved by default.',
  'Native automatic selection inherits the parent model. An explicit exact provider/model may override the parent tier, but never approval, classification, exclusions, current availability or image support.',
  'The omitted tool profile is read_only; request standard explicitly for guarded host editing/shell tools. Explicit host-builtin subsets are supported. Recursive delegation, full/MCP child profiles and task_category judge are not qualified and fail closed.',
  'Text and supported raster image attachments follow the workspace/file limits. Timeout is an integer from 10 to 300 seconds, default 120; native cancellation joins the owned child and is not an uncooperative-provider hard kill.',
  'When delegating, give the user one visible sentence explaining the delegated task and why it is self-contained.',
].join('\n');
