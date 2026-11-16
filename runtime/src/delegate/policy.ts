/** Core Delegate approval policy. Pure data/functions; no discovery, storage, CLI or lifecycle. */
const AZURE_PROVIDER_RE = /^azure-/i;
const DEFAULT_SEARCHABLE_PROVIDER_ORDER = ["github-copilot", "anthropic", "openai", "google", "openai-codex", "cerebras", "ollama"];

export interface DelegateConfig {
  /** Operator-approved providers. null and [] both mean approve none (fail closed). */
  searchable_providers: string[] | null;
  /** Additional explicit provider denials. null = default exclusions; [] = no extra denials. */
  excluded_providers: string[] | null;
  /** Model id/full-id exclusion patterns. Supports `*` wildcards and substring fallback. */
  excluded_models: string[];
}

const DEFAULT_CONFIG: DelegateConfig = {
  searchable_providers: null, // fail closed until an operator approves providers in Settings
  excluded_providers: null,
  excluded_models: [],
};

function normalizeStringList(values: unknown): string[] | null {
  if (values == null) return null;
  const source = Array.isArray(values)
    ? values
    : (typeof values === "string" ? values.split(/[\n,]+/) : []);
  return [...new Set(source
    .map((value) => typeof value === "string" ? value.trim() : "")
    .filter(Boolean))];
}

function normalizeProviderList(values: unknown): string[] | null {
  return normalizeStringList(values);
}

function normalizeModelExclusionList(values: unknown): string[] {
  return normalizeStringList(values) ?? [];
}

export function normalizeConfig(config: Partial<DelegateConfig> | null | undefined): DelegateConfig {
  const searchableProviders = normalizeProviderList(config?.searchable_providers);
  const excludedProviders = normalizeProviderList(config?.excluded_providers);
  const excludedSet = new Set(excludedProviders ?? []);
  return {
    searchable_providers: searchableProviders === null
      ? null
      : searchableProviders.filter((provider) => !excludedSet.has(provider)),
    excluded_providers: excludedProviders,
    excluded_models: normalizeModelExclusionList(config?.excluded_models),
  };
}

export type ModelTierNumber = 1 | 2 | 3 | 4 | 5;
export type ModelClassificationStatus = "classified" | "unclassified";
export type ModelClassificationConfidence = "exact-policy" | "none";
export type ModelCatalogSource = "runtime" | "cli";

export interface AvailableModel {
  provider: string;
  id: string;
  fullId: string;
  name?: string;
  context?: string;
  maxOut?: string;
  thinking?: string;
  images?: string;
  contextWindow?: number;
  maxOutputTokens?: number;
  reasoning?: boolean;
  supportsImages?: boolean;
  catalogSource?: ModelCatalogSource;
}

export interface ModelClassification {
  status: ModelClassificationStatus;
  tier: ModelTierNumber | null;
  family: string;
  rule: string | null;
  reason: string;
  confidence: ModelClassificationConfidence;
  preference: number;
}

export interface ModelCandidate {
  id: string;
  tier: ModelTierNumber;
  family: string;
  sourceId: string;
  provider: string;
  modelId: string;
  matchScore: number;
  classificationRule: string;
  classificationReason: string;
  classificationConfidence: ModelClassificationConfidence;
  supportsImages: boolean | null;
  reasoning: boolean | null;
  contextWindow: number | null;
  maxOutputTokens: number | null;
}

interface ClassificationRule {
  id: string;
  tier: ModelTierNumber;
  family: string;
  preference: number;
  reason: string;
  matches: (provider: string, normalizedId: string) => boolean;
}

function normalizedPolicyModelId(value: string): string {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[._]+/g, "-")
    .replace(/-+/g, "-");
}

function rule(
  id: string,
  tier: ModelTierNumber,
  family: string,
  preference: number,
  reason: string,
  pattern: RegExp,
): ClassificationRule {
  return { id, tier, family, preference, reason, matches: (_provider, normalizedId) => pattern.test(normalizedId) };
}

// Ordered from specific variants to broader families. Every model is assigned by
// the first matching rule only, so a model can never expand into multiple tiers.
const MODEL_CLASSIFICATION_RULES: ClassificationRule[] = [
  rule("claude-opus", 5, "claude", 10, "Claude Opus frontier family", /^claude-opus(?:-|$)/),
  rule("claude-haiku", 1, "claude", 30, "Claude Haiku fast family", /^claude-haiku(?:-|$)/),
  rule("claude-fable", 3, "claude", 10, "Claude Fable general-purpose family", /^claude-fable(?:-|$)/),
  rule("claude-sonnet-4-6", 3, "claude", 20, "Claude Sonnet 4.6 general-purpose model", /^claude-sonnet-4-6(?:-|$)/),
  rule("claude-sonnet-5", 3, "claude", 25, "Claude Sonnet 5 general-purpose model", /^claude-sonnet-5(?:-|$)/),
  rule("claude-sonnet", 3, "claude", 30, "Claude Sonnet general-purpose family", /^claude-sonnet(?:-|$)/),

  // Enumerated Astra variants only; do not approve unknown GPT-6 families/suffixes.
  // OpenRouter retains the upstream publisher namespace in its model IDs.
  rule("gpt-6-astra-pro", 4, "gpt", 46, "GPT 6 Astra Pro high-capability variant", /^(?:openai\/)?gpt-6-astra-pro(?::batch)?$/),
  rule("gpt-6-astra", 3, "gpt", 52, "GPT 6 Astra general-purpose model", /^(?:openai\/)?gpt-6-astra(?::batch)?$/),
  // Prepared exact ID; capability/executable discovery remains authoritative.
  rule("gpt-6-1-sol", 3, "gpt", 53, "GPT 6.1 Sol general-purpose model", /^gpt-6-1-sol$/),
  // Exact normalised 0.87.1 IDs; existing punctuation aliases apply, never suffixes.
  rule("gpt-6-sol", 3, "gpt", 53, "GPT 6 Sol general-purpose model", /^gpt-6-sol$/),
  rule("gpt-6-luna", 3, "gpt", 54, "GPT 6 Luna general-purpose model", /^gpt-6-luna$/),
  rule("gpt-codex-mini", 2, "gpt", 20, "GPT Codex Mini fast coding family", /^gpt-5(?:-[0-9]+)?-codex-mini(?:-|$)/),
  rule("gpt-codex-spark", 4, "gpt", 30, "GPT Codex Spark coding specialist", /^gpt-5(?:-[0-9]+)?-codex-spark(?:-|$)/),
  rule("gpt-codex-max", 4, "gpt", 35, "GPT Codex Max coding specialist", /^gpt-5(?:-[0-9]+)?-codex-max(?:-|$)/),
  rule("gpt-codex", 4, "gpt", 40, "GPT Codex coding specialist", /^gpt-5(?:-[0-9]+)?-codex(?:-|$)/),
  rule("gpt-pro", 4, "gpt", 45, "GPT Pro high-capability family", /^gpt-5(?:-[0-9]+)?-pro(?:-|$)/),
  rule("gpt-mini", 2, "gpt", 10, "GPT Mini fast family", /^gpt-5(?:-[0-9]+)?-mini(?:-|$)/),
  rule("gpt-5-4", 3, "gpt", 40, "GPT 5.4 general-purpose model", /^gpt-5-4(?:-|$)/),
  rule("gpt-5-5", 3, "gpt", 45, "GPT 5.5 general-purpose model", /^gpt-5-5(?:-|$)/),
  rule("gpt-5-6", 3, "gpt", 50, "GPT 5.6 general-purpose variants", /^gpt-5-6(?:-|$)/),
  rule("gpt-5-general", 3, "gpt", 55, "GPT 5 general-purpose family", /^gpt-5(?:-[0-9]+)?(?:-|$)/),
  rule("gpt-4", 1, "gpt", 20, "GPT 4 legacy family", /^gpt-4(?:-|$)/),
  rule("openai-o-series", 3, "gpt", 60, "OpenAI o-series reasoning family", /^o(?:1|3|4)(?:-|$)/),

  rule("gemini-flash", 2, "gemini", 40, "Gemini Flash fast family", /^gemini-.*(?:^|-)flash(?:-|$)/),
  rule("gemini-pro", 3, "gemini", 60, "Gemini Pro general-purpose family", /^gemini-.*(?:^|-)pro(?:-|$)/),
  rule("mai-code-flash", 2, "mai", 50, "MAI Code Flash fast coding family", /^mai-.*flash(?:-|$)/),
  rule("grok-code-fast", 1, "grok", 40, "Grok Code Fast family", /^(?:grok|xai)-.*fast(?:-|$)/),
  rule("grok-4-7", 3, "grok", 65, "Grok 4.7 general-purpose model", /^grok-4-7$/),

  rule("deepseek-flash", 2, "deepseek", 60, "DeepSeek Flash fast family", /^deepseek-.*flash(?:-|$)/),
  rule("deepseek-pro", 3, "deepseek", 70, "DeepSeek Pro general-purpose family", /^deepseek-.*pro(?:-|$)/),
  rule("mistral-large", 3, "mistral", 80, "Mistral Large general-purpose family", /^mistral-large(?:-|$)/),
  rule("gemma", 2, "gemma", 70, "Gemma medium-weight family", /^gemma(?:-|$)/),
  rule("gpt-oss", 2, "gpt-oss", 75, "GPT OSS fast hosted family", /^gpt-oss(?:-|$)/),
  rule("glm", 2, "glm", 80, "GLM fast hosted family", /^(?:zai-)?glm(?:-|$)/),
  rule("qwen", 2, "qwen", 85, "Qwen medium-weight local family", /^qwen(?:\d|-|$)/),
  rule("lfm", 1, "lfm", 50, "LFM lightweight local family", /^lfm(?:\d|-|:|$)/),
];

function inferUnclassifiedFamily(modelId: string): string {
  const normalized = normalizedPolicyModelId(modelId);
  return normalized.split("-")[0] || "unknown";
}

export function classifyModel(model: Pick<AvailableModel, "provider" | "id"> | string): ModelClassification {
  const fullId = typeof model === "string" ? model : `${model.provider}/${model.id}`;
  const slash = fullId.indexOf("/");
  const provider = slash >= 0 ? fullId.slice(0, slash).toLowerCase() : "";
  const modelId = slash >= 0 ? fullId.slice(slash + 1) : fullId;
  const normalizedId = normalizedPolicyModelId(modelId);
  const matched = MODEL_CLASSIFICATION_RULES.find((candidate) => candidate.matches(provider, normalizedId));
  if (!matched) {
    return {
      status: "unclassified",
      tier: null,
      family: inferUnclassifiedFamily(modelId),
      rule: null,
      reason: `No ordered Delegate policy rule matches ${fullId}`,
      confidence: "none",
      preference: Number.MAX_SAFE_INTEGER,
    };
  }
  return {
    status: "classified",
    tier: matched.tier,
    family: matched.family,
    rule: matched.id,
    reason: matched.reason,
    confidence: "exact-policy",
    preference: matched.preference,
  };
}

function providerPreference(provider: string, searchableProviders: string[] | null): number {
  const configured = searchableProviders?.indexOf(provider) ?? -1;
  if (configured >= 0) return configured;
  const preferred = DEFAULT_SEARCHABLE_PROVIDER_ORDER.indexOf(provider);
  if (preferred >= 0) return preferred;
  return 100;
}

function getDiscoveredProviders(models: AvailableModel[]): string[] {
  return [...new Set(models.map((model) => model.provider).filter(Boolean))].sort();
}

function getExcludedProviders(models: AvailableModel[], config: DelegateConfig): string[] {
  const discovered = getDiscoveredProviders(models);
  const configured = normalizeProviderList(config.excluded_providers);
  if (configured !== null) return configured.filter((provider) => discovered.includes(provider));
  return discovered.filter((provider) => AZURE_PROVIDER_RE.test(provider));
}

function getAllowedProviders(models: AvailableModel[], config: DelegateConfig): string[] {
  const discovered = getDiscoveredProviders(models);
  const excluded = new Set(getExcludedProviders(models, config));
  const configured = normalizeProviderList(config.searchable_providers) ?? [];
  const discoveredSet = new Set(discovered);
  return configured.filter((provider) => discoveredSet.has(provider) && !excluded.has(provider));
}

function modelExclusionMatches(pattern: string, model: AvailableModel): boolean {
  const normalizedPattern = pattern.trim().toLowerCase();
  if (!normalizedPattern) return false;
  const haystacks = [model.fullId, model.id].map((value) => value.toLowerCase());
  if (normalizedPattern.includes("*")) {
    const escaped = normalizedPattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
    const re = new RegExp(`^${escaped}$`, "i");
    return haystacks.some((value) => re.test(value));
  }
  return haystacks.some((value) => value === normalizedPattern || value.includes(normalizedPattern));
}

function isExcludedModel(model: AvailableModel, config: DelegateConfig): boolean {
  return normalizeModelExclusionList(config.excluded_models).some((pattern) => modelExclusionMatches(pattern, model));
}

function optionalBoolean(value: boolean | undefined, legacy: string | undefined): boolean | null {
  if (typeof value === "boolean") return value;
  if (typeof legacy === "string") return /^(yes|true|1)$/i.test(legacy);
  return null;
}

function optionalCount(value: number | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null;
}

export function buildModelCandidates(models: AvailableModel[], config: DelegateConfig = DEFAULT_CONFIG): ModelCandidate[] {
  const normalizedConfig = normalizeConfig(config);
  const allowedProviders = new Set(getAllowedProviders(models, normalizedConfig));
  const candidates: Array<ModelCandidate & { preference: number; providerRank: number }> = [];
  const seen = new Set<string>();

  for (const model of models) {
    if (seen.has(model.fullId)) continue;
    seen.add(model.fullId);
    if (!allowedProviders.has(model.provider) || isExcludedModel(model, normalizedConfig)) continue;
    const classification = classifyModel(model);
    if (classification.status !== "classified" || classification.tier === null || !classification.rule) continue;
    candidates.push({
      id: model.fullId,
      tier: classification.tier,
      family: classification.family,
      sourceId: classification.rule,
      provider: model.provider,
      modelId: model.id,
      matchScore: 100,
      classificationRule: classification.rule,
      classificationReason: classification.reason,
      classificationConfidence: classification.confidence,
      supportsImages: optionalBoolean(model.supportsImages, model.images),
      reasoning: optionalBoolean(model.reasoning, model.thinking),
      contextWindow: optionalCount(model.contextWindow),
      maxOutputTokens: optionalCount(model.maxOutputTokens),
      preference: classification.preference,
      providerRank: providerPreference(model.provider, normalizedConfig.searchable_providers),
    });
  }

  return candidates
    .sort((a, b) => a.tier - b.tier || a.preference - b.preference || a.providerRank - b.providerRank || a.id.localeCompare(b.id))
    .map(({ preference: _preference, providerRank: _providerRank, ...candidate }) => candidate);
}


export function providerSummaries(models: AvailableModel[], config: DelegateConfig) {
  const enabled = new Set(getAllowedProviders(models, config));
  const excluded = new Set(getExcludedProviders(models, config));
  const providers = getDiscoveredProviders(models);
  return providers.map((provider) => ({
    provider,
    enabled: enabled.has(provider),
    excluded: excluded.has(provider),
    blacklisted: excluded.has(provider),
    defaultExcluded: config.excluded_providers === null && AZURE_PROVIDER_RE.test(provider),
    modelCount: models.filter((model) => model.provider === provider).length,
  })).sort((left, right) => {
    const configured = config.searchable_providers;
    if (configured !== null) {
      const leftIndex = configured.indexOf(left.provider);
      const rightIndex = configured.indexOf(right.provider);
      const leftConfigured = leftIndex >= 0;
      const rightConfigured = rightIndex >= 0;
      if (leftConfigured !== rightConfigured) return leftConfigured ? -1 : 1;
      if (leftConfigured && rightConfigured && leftIndex !== rightIndex) return leftIndex - rightIndex;
    }
    return providerPreference(left.provider, null) - providerPreference(right.provider, null)
      || left.provider.localeCompare(right.provider);
  });
}

