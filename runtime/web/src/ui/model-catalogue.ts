export type ModelVariant = "alias" | "batch" | "free" | "preview" | "fast" | "image" | "audio";
export type ModelCatalogueSort = "recommended" | "name" | "context" | "input-price" | "output-price";
export type ModelVariantFilter = ModelVariant | "stable";

export interface ModelCataloguePricing {
  inputPerMillion: number | null;
  outputPerMillion: number | null;
  cacheReadPerMillion: number | null;
  cacheWritePerMillion: number | null;
}

export interface ModelThinkingLevel {
  id: string;
  label: string;
}

export interface ModelCatalogueEntry {
  key: string;
  provider: string;
  publisher: string | null;
  family: string | null;
  id: string;
  displayName: string;
  contextWindow: number | null;
  reasoning: boolean;
  thinkingLevels: ModelThinkingLevel[];
  pricing: ModelCataloguePricing | null;
  variants: ModelVariant[];
  current: boolean;
  pinned: boolean;
  lastUsedAt: string | null;
}

export interface ModelCataloguePreferences {
  pinnedKeys?: Iterable<string> | null;
  recentByKey?: ReadonlyMap<string, string> | Record<string, string> | null;
}

export interface ModelCatalogueFilterState {
  query?: string;
  providers?: Iterable<string> | string | null;
  publishers?: Iterable<string> | string | null;
  families?: Iterable<string> | string | null;
  variants?: Iterable<ModelVariantFilter> | ModelVariantFilter | null;
  reasoning?: boolean | null;
  sort?: ModelCatalogueSort;
}

export interface ModelCataloguePublisherGroup {
  key: string;
  label: string;
  provider: string;
  publisher: string | null;
  entries: ModelCatalogueEntry[];
  totalCount: number;
}

export interface ModelCatalogueProviderGroup {
  key: string;
  label: string;
  provider: string;
  entries: ModelCatalogueEntry[];
  publisherGroups: ModelCataloguePublisherGroup[];
  totalCount: number;
}

interface RawModelOption {
  label?: unknown;
  provider?: unknown;
  id?: unknown;
  name?: unknown;
  context_window?: unknown;
  contextWindow?: unknown;
  reasoning?: unknown;
  pricing?: unknown;
  thinking_levels?: unknown;
  thinkingLevels?: unknown;
  thinking_level_labels?: unknown;
  thinkingLevelLabels?: unknown;
}

interface ModelCataloguePayload {
  current?: unknown;
  model?: unknown;
  model_options?: unknown;
  models?: unknown;
}

const VARIANT_ORDER: readonly ModelVariant[] = ["alias", "batch", "free", "preview", "fast", "image", "audio"];

function cleanString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function finiteNonNegative(value: unknown): number | null {
  if (value == null || value === "" || typeof value === "boolean") return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric >= 0 ? numeric : null;
}

function finitePositive(value: unknown): number | null {
  if (value == null || value === "" || typeof value === "boolean") return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? numeric : null;
}

function normalizeRoutedKey(value: unknown): string {
  const key = cleanString(value);
  const slashIndex = key.indexOf("/");
  return slashIndex > 0 ? `${key.slice(0, slashIndex).toLowerCase()}${key.slice(slashIndex)}` : key;
}

function slashDepth(value: string): number {
  return value.split("/").length - 1;
}

function mostSpecificIdentityValue(values: Array<{ value: string; priority: number }>): string {
  return values
    .filter((candidate) => candidate.value)
    .sort((left, right) => slashDepth(right.value) - slashDepth(left.value) || right.priority - left.priority || right.value.length - left.value.length)[0]?.value ?? "";
}

function normalizeIdentity(labelValue: unknown, providerValue: unknown, idValue: unknown) {
  const label = cleanString(labelValue);
  const rawId = cleanString(idValue);
  const explicitProvider = cleanString(providerValue).toLowerCase();
  let provider = explicitProvider;

  if (!provider) {
    const routedValue = mostSpecificIdentityValue([
      { value: rawId.includes("/") ? rawId : "", priority: 2 },
      { value: label.includes("/") ? label : "", priority: 1 },
    ]);
    const slashIndex = routedValue.indexOf("/");
    if (slashIndex > 0) provider = routedValue.slice(0, slashIndex).trim().toLowerCase();
  }

  const routePrefix = provider ? `${provider}/` : "";
  const hasRoutePrefix = (value: string) => Boolean(routePrefix && value.slice(0, routePrefix.length).toLowerCase() === routePrefix);
  const stripRoutePrefix = (value: string) => hasRoutePrefix(value) ? value.slice(routePrefix.length).trim() : value;
  const idCandidates: Array<{ value: string; priority: number }> = [];
  if (rawId) {
    idCandidates.push({ value: stripRoutePrefix(rawId), priority: 2 });
  }
  if (label && (explicitProvider || hasRoutePrefix(label) || !rawId)) {
    idCandidates.push({ value: stripRoutePrefix(label), priority: 1 });
  }
  const id = mostSpecificIdentityValue(idCandidates) || rawId || label;
  const key = provider && id ? `${provider}/${id}` : id || provider;
  return { key, provider, id };
}

function naturalParts(value: string): string[] {
  return value.toLowerCase().match(/\d+|\D+/g) ?? [];
}

export function compareModelCatalogueText(left: string, right: string): number {
  const leftParts = naturalParts(left);
  const rightParts = naturalParts(right);
  const count = Math.max(leftParts.length, rightParts.length);
  for (let index = 0; index < count; index += 1) {
    const a = leftParts[index];
    const b = rightParts[index];
    if (a == null) return -1;
    if (b == null) return 1;
    if (a === b) continue;
    const aNumeric = /^\d+$/.test(a);
    const bNumeric = /^\d+$/.test(b);
    if (aNumeric && bNumeric) {
      const difference = Number(a) - Number(b);
      if (difference !== 0) return difference;
      if (a.length !== b.length) return a.length - b.length;
      continue;
    }
    return a < b ? -1 : 1;
  }
  return left < right ? -1 : left > right ? 1 : 0;
}

function classifyFamily(id: string, displayName = ""): string | null {
  const value = `${id} ${displayName}`.toLowerCase();
  const families: Array<[RegExp, string]> = [
    [/\bclaude(?:\d|[-_. ]|$)/, "Claude"],
    [/\bgemini(?:\d|[-_. ]|$)/, "Gemini"],
    [/\b(?:gpt|chatgpt)\b/, "GPT"],
    [/\b(?:o1|o3|o4)(?:\b|[-_.])/, "OpenAI o-series"],
    [/\bqwen(?:\d|[-_. ]|$)/, "Qwen"],
    [/\b(?:mistral|mixtral|codestral|devstral)\b/, "Mistral"],
    [/\bllama(?:\d|[-_. ]|$)/, "Llama"],
    [/\bdeepseek\b/, "DeepSeek"],
    [/\bcommand(?:[-_. ]|$)/, "Command"],
    [/\bgrok\b/, "Grok"],
    [/\bphi(?:[-_. ]|$)/, "Phi"],
    [/\bnova(?:[-_. ]|$)/, "Nova"],
    [/\b(?:kimi|moonshot)\b/, "Kimi"],
    [/\bminimax\b/, "MiniMax"],
    [/\b(?:glm|chatglm)\b/, "GLM"],
    [/\bnemotron\b/, "Nemotron"],
  ];
  return families.find(([pattern]) => pattern.test(value))?.[1] ?? null;
}

export function classifyModelIdentity(entry: Pick<ModelCatalogueEntry, "provider" | "id"> & { displayName?: string | null }): {
  publisher: string | null;
  family: string | null;
} {
  const id = cleanString(entry.id);
  const slashIndex = id.indexOf("/");
  const publisher = slashIndex > 0 ? id.slice(0, slashIndex).trim().toLowerCase() || null : null;
  return {
    publisher,
    family: classifyFamily(id, cleanString(entry.displayName)),
  };
}

export function classifyModelVariants(entry: Pick<ModelCatalogueEntry, "id"> & { displayName?: string | null }): ModelVariant[] {
  const value = `${cleanString(entry.id)} ${cleanString(entry.displayName)}`.toLowerCase();
  const variants = new Set<ModelVariant>();
  if (/(?:^|[\s/:._-])latest(?:$|[\s/:._-])/.test(value)) variants.add("alias");
  if (/(?:^|[\s/:._-])batch(?:$|[\s/:._-])/.test(value)) variants.add("batch");
  if (/(?:^|[\s/:._-])free(?:$|[\s/:._-])/.test(value)) variants.add("free");
  if (/(?:^|[\s/:._-])(?:preview|experimental|beta)(?:$|[\s/:._-])/.test(value)) variants.add("preview");
  if (/(?:^|[\s/:._-])(?:fast|turbo)(?:$|[\s/:._-])/.test(value)) variants.add("fast");
  if (/(?:^|[\s/:._-])(?:image|vision)(?:$|[\s/:._-])/.test(value)) variants.add("image");
  if (/(?:^|[\s/:._-])(?:audio|speech|voice)(?:$|[\s/:._-])/.test(value)) variants.add("audio");
  return VARIANT_ORDER.filter((variant) => variants.has(variant));
}

function normalizePricing(value: unknown): ModelCataloguePricing | null {
  if (!value || typeof value !== "object") return null;
  const pricing = value as Record<string, unknown>;
  const normalized: ModelCataloguePricing = {
    inputPerMillion: finiteNonNegative(pricing.input_per_million ?? pricing.inputPerMillion),
    outputPerMillion: finiteNonNegative(pricing.output_per_million ?? pricing.outputPerMillion),
    cacheReadPerMillion: finiteNonNegative(pricing.cache_read_per_million ?? pricing.cacheReadPerMillion),
    cacheWritePerMillion: finiteNonNegative(pricing.cache_write_per_million ?? pricing.cacheWritePerMillion),
  };
  return Object.values(normalized).some((rate) => rate != null) ? normalized : null;
}

function normalizeThinkingLevels(option: RawModelOption): ModelThinkingLevel[] {
  const ids = Array.isArray(option.thinking_levels)
    ? option.thinking_levels
    : Array.isArray(option.thinkingLevels) ? option.thinkingLevels : [];
  const labels = Array.isArray(option.thinking_level_labels)
    ? option.thinking_level_labels
    : Array.isArray(option.thinkingLevelLabels) ? option.thinkingLevelLabels : [];
  const seen = new Set<string>();
  const levels: ModelThinkingLevel[] = [];
  ids.forEach((rawId, index) => {
    const id = cleanString(rawId);
    if (!id || seen.has(id)) return;
    seen.add(id);
    levels.push({ id, label: cleanString(labels[index]) || id });
  });
  return levels;
}

function recentValue(source: ModelCataloguePreferences["recentByKey"], key: string): string | null {
  const value = source instanceof Map ? source.get(key) : source?.[key];
  return cleanString(value) || null;
}

export function normaliseModelCatalogue(
  payload: ModelCataloguePayload | null | undefined,
  options: ModelCataloguePreferences = {},
): ModelCatalogueEntry[] {
  const structured = Array.isArray(payload?.model_options) ? payload.model_options : [];
  const legacy = Array.isArray(payload?.models) ? payload.models : [];
  const currentKey = normalizeRoutedKey(payload?.current ?? payload?.model);
  const pinnedKeys = new Set(Array.from(options.pinnedKeys ?? [], normalizeRoutedKey).filter(Boolean));
  const seen = new Set<string>();
  const entries: ModelCatalogueEntry[] = [];

  const appendItems = (rawItems: unknown[]) => {
    for (const rawItem of rawItems) {
      const option: RawModelOption = typeof rawItem === "string" ? { label: rawItem } : (rawItem as RawModelOption);
      if (!option || typeof option !== "object") continue;
      const identity = normalizeIdentity(option.label, option.provider, option.id);
      if (!identity.key || seen.has(identity.key)) continue;
      seen.add(identity.key);
      const displayName = cleanString(option.name) || identity.key;
      const classified = classifyModelIdentity({ provider: identity.provider, id: identity.id, displayName });
      const contextWindow = finitePositive(option.context_window ?? option.contextWindow);
      const base = {
        key: identity.key,
        provider: identity.provider,
        publisher: classified.publisher,
        family: classified.family,
        id: identity.id,
        displayName,
        contextWindow,
        reasoning: option.reasoning === true,
        thinkingLevels: normalizeThinkingLevels(option),
        pricing: normalizePricing(option.pricing),
        variants: classifyModelVariants({ id: identity.id, displayName }),
        current: Boolean(currentKey && (identity.key === currentKey || normalizeRoutedKey(option.label) === currentKey)),
        pinned: pinnedKeys.has(identity.key),
        lastUsedAt: recentValue(options.recentByKey, identity.key),
      };
      entries.push(base);
    }
  };

  appendItems(structured.length > 0 ? structured : legacy);
  if (entries.length === 0 && structured.length > 0) appendItems(legacy);
  if (currentKey && !entries.some((entry) => entry.current)) {
    const legacyCurrentMatches = entries.filter((entry) => entry.id === currentKey);
    if (legacyCurrentMatches.length === 1) legacyCurrentMatches[0].current = true;
  }
  entries.sort((left, right) => compareModelCatalogueText(left.key, right.key));
  return entries;
}

// Keep the US spelling available while older classic helpers migrate.
export const normalizeModelCatalogue = normaliseModelCatalogue;

export function formatModelCatalogueContextWindow(contextWindow: number | null): string {
  if (contextWindow == null) return "";
  if (contextWindow >= 1_000_000) {
    const millions = contextWindow / 1_000_000;
    return `${Number.isInteger(millions) ? millions.toFixed(0) : millions.toFixed(1)}M context`;
  }
  if (contextWindow >= 1_000) return `${Math.round(contextWindow / 1_000)}K context`;
  return `${contextWindow} context`;
}

function formatCompactModelPrice(value: number): string {
  const digits = value >= 1 ? 2 : 4;
  return `$${value.toFixed(digits).replace(/0+$/, "").replace(/\.$/, "")}`;
}

export function formatModelCataloguePricing(pricing: ModelCataloguePricing | null): string {
  if (!pricing) return "";
  const parts = [
    pricing.inputPerMillion == null ? "" : `In ${formatCompactModelPrice(pricing.inputPerMillion)}`,
    pricing.outputPerMillion == null ? "" : `Out ${formatCompactModelPrice(pricing.outputPerMillion)}`,
  ].filter(Boolean);
  return parts.length ? `${parts.join(" · ")} / 1M` : "";
}

export function buildModelSearchDocument(entry: ModelCatalogueEntry): string {
  return [
    entry.displayName,
    entry.key,
    entry.id,
    entry.provider,
    entry.publisher,
    entry.family,
    ...entry.variants,
    hasStableVariant(entry) ? "stable" : null,
    entry.reasoning ? "reasoning" : null,
    formatModelCatalogueContextWindow(entry.contextWindow),
  ].filter(Boolean).join(" ").toLocaleLowerCase();
}

function normalizeFilterValues(value: Iterable<string> | string | null | undefined): Set<string> {
  if (typeof value === "string") {
    const normalized = cleanString(value).toLowerCase();
    return new Set(normalized ? [normalized] : []);
  }
  return new Set(Array.from(value ?? [], (item) => cleanString(item).toLowerCase()).filter(Boolean));
}

function hasStableVariant(entry: ModelCatalogueEntry): boolean {
  return !entry.variants.some((variant) => ["preview", "batch", "free", "fast"].includes(variant));
}

function matchesVariant(entry: ModelCatalogueEntry, variants: Set<string>): boolean {
  if (variants.size === 0) return true;
  if (variants.has("stable") && hasStableVariant(entry)) return true;
  return entry.variants.some((variant) => variants.has(variant));
}

function recommendedVariantRank(entry: ModelCatalogueEntry): number {
  if (entry.variants.includes("batch")) return 4;
  if (entry.variants.includes("preview")) return 3;
  if (entry.variants.includes("free") || entry.variants.includes("fast")) return 2;
  if (entry.variants.includes("alias")) return 0;
  return 1;
}

function compareNullableNumber(left: number | null, right: number | null, descending = false): number {
  if (left == null && right == null) return 0;
  if (left == null) return 1;
  if (right == null) return -1;
  return descending ? right - left : left - right;
}

function compareRecommended(left: ModelCatalogueEntry, right: ModelCatalogueEntry): number {
  if (left.current !== right.current) return left.current ? -1 : 1;
  if (left.pinned !== right.pinned) return left.pinned ? -1 : 1;
  const leftRecent = Date.parse(left.lastUsedAt ?? "");
  const rightRecent = Date.parse(right.lastUsedAt ?? "");
  const leftHasRecent = Number.isFinite(leftRecent);
  const rightHasRecent = Number.isFinite(rightRecent);
  if (leftHasRecent !== rightHasRecent) return leftHasRecent ? -1 : 1;
  if (leftHasRecent && rightHasRecent && leftRecent !== rightRecent) return rightRecent - leftRecent;
  const variantDifference = recommendedVariantRank(left) - recommendedVariantRank(right);
  return variantDifference || compareModelCatalogueText(left.key, right.key);
}

export function filterAndRankModels(
  entries: readonly ModelCatalogueEntry[],
  state: ModelCatalogueFilterState = {},
): ModelCatalogueEntry[] {
  const queryTerms = cleanString(state.query).toLocaleLowerCase().split(/\s+/).filter(Boolean);
  const providers = normalizeFilterValues(state.providers);
  const publishers = normalizeFilterValues(state.publishers);
  const families = normalizeFilterValues(state.families);
  const variants = normalizeFilterValues(state.variants);
  const filtered = entries.filter((entry) => {
    if (queryTerms.length > 0) {
      const document = buildModelSearchDocument(entry);
      if (!queryTerms.every((term) => document.includes(term))) return false;
    }
    if (providers.size > 0 && !providers.has(modelProviderGroupKey(entry).toLowerCase())) return false;
    if (publishers.size > 0 && !publishers.has((entry.publisher ?? "").toLowerCase())) return false;
    if (families.size > 0 && !families.has((entry.family ?? "").toLowerCase())) return false;
    if (!matchesVariant(entry, variants)) return false;
    if (typeof state.reasoning === "boolean" && entry.reasoning !== state.reasoning) return false;
    return true;
  });

  const sort = state.sort ?? "recommended";
  return filtered.sort((left, right) => {
    if (sort === "name") return compareModelCatalogueText(left.displayName, right.displayName) || compareModelCatalogueText(left.key, right.key);
    if (sort === "context") return compareNullableNumber(left.contextWindow, right.contextWindow, true) || compareModelCatalogueText(left.key, right.key);
    if (sort === "input-price") return compareNullableNumber(left.pricing?.inputPerMillion ?? null, right.pricing?.inputPerMillion ?? null) || compareModelCatalogueText(left.key, right.key);
    if (sort === "output-price") return compareNullableNumber(left.pricing?.outputPerMillion ?? null, right.pricing?.outputPerMillion ?? null) || compareModelCatalogueText(left.key, right.key);
    return compareRecommended(left, right);
  });
}

function modelProviderGroupKey(entry: Pick<ModelCatalogueEntry, "provider">): string {
  return entry.provider || "unknown";
}

export function groupModels(entries: readonly ModelCatalogueEntry[]): ModelCatalogueProviderGroup[] {
  const providers = new Map<string, ModelCatalogueEntry[]>();
  for (const entry of entries) {
    const key = modelProviderGroupKey(entry);
    const group = providers.get(key) ?? [];
    group.push(entry);
    providers.set(key, group);
  }

  return Array.from(providers.entries())
    .sort(([left], [right]) => compareModelCatalogueText(left, right))
    .map(([provider, providerEntries]) => {
      const directEntries: ModelCatalogueEntry[] = [];
      const publishers = new Map<string, ModelCatalogueEntry[]>();
      for (const entry of providerEntries) {
        if (!entry.publisher) {
          directEntries.push(entry);
          continue;
        }
        const publisherEntries = publishers.get(entry.publisher) ?? [];
        publisherEntries.push(entry);
        publishers.set(entry.publisher, publisherEntries);
      }
      const publisherGroups = Array.from(publishers.entries())
        .sort(([left], [right]) => compareModelCatalogueText(left, right))
        .map(([publisher, publisherEntries]) => ({
          key: `${provider}/${publisher}`,
          label: publisher,
          provider,
          publisher,
          entries: [...publisherEntries],
          totalCount: publisherEntries.length,
        }));
      return {
        key: provider,
        label: provider,
        provider,
        entries: directEntries,
        publisherGroups,
        totalCount: providerEntries.length,
      };
    });
}

export const MODEL_PICKER_RENDER_LIMIT = 100;

export interface ModelPickerProjectionGroup {
  key: string;
  label: string;
  entries: ModelCatalogueEntry[];
  totalCount: number;
}

export interface ModelPickerProjectionSection {
  key: "current" | "pinned" | "recent" | "catalogue";
  label: string;
  totalCount: number;
  entries: ModelCatalogueEntry[];
  groups: ModelPickerProjectionGroup[];
}

export interface ModelPickerProjection {
  sections: ModelPickerProjectionSection[];
  renderedEntries: ModelCatalogueEntry[];
  totalMatches: number;
  hiddenCount: number;
}

export interface ModelPickerProjectionOptions {
  query?: string;
  renderLimit?: number;
}

function flattenProjectionGroups(entries: readonly ModelCatalogueEntry[]): ModelPickerProjectionGroup[] {
  const groups: ModelPickerProjectionGroup[] = [];
  for (const provider of groupModels(entries)) {
    if (provider.entries.length > 0) {
      groups.push({
        key: provider.key,
        label: provider.label,
        entries: provider.entries,
        totalCount: provider.entries.length,
      });
    }
    for (const publisher of provider.publisherGroups) {
      groups.push({
        key: publisher.key,
        label: `${provider.label} · ${publisher.label}`,
        entries: publisher.entries,
        totalCount: publisher.totalCount,
      });
    }
  }
  return groups;
}

export function buildModelPickerProjection(
  entries: readonly ModelCatalogueEntry[],
  options: ModelPickerProjectionOptions = {},
): ModelPickerProjection {
  const query = cleanString(options.query);
  const matched = filterAndRankModels(entries, { query });
  const renderLimit = Math.max(1, Math.min(MODEL_PICKER_RENDER_LIMIT, Math.floor(options.renderLimit ?? MODEL_PICKER_RENDER_LIMIT)));
  const seen = new Set<string>();
  let remaining = renderLimit;
  const renderedEntries: ModelCatalogueEntry[] = [];
  const sections: ModelPickerProjectionSection[] = [];

  const addSection = (
    key: ModelPickerProjectionSection["key"],
    label: string,
    candidates: ModelCatalogueEntry[],
    grouped = false,
  ) => {
    const unique = candidates.filter((entry) => !seen.has(entry.key));
    if (unique.length === 0) return;
    const visible = unique.slice(0, remaining);
    visible.forEach((entry) => seen.add(entry.key));
    if (visible.length === 0) return;
    remaining -= visible.length;
    renderedEntries.push(...visible);
    const visibleKeys = new Set(visible.map((entry) => entry.key));
    const groups = grouped
      ? flattenProjectionGroups(unique).map((group) => ({
        ...group,
        entries: group.entries.filter((entry) => visibleKeys.has(entry.key)),
      })).filter((group) => group.entries.length > 0)
      : [];
    sections.push({
      key,
      label,
      totalCount: unique.length,
      entries: grouped ? [] : visible,
      groups,
    });
  };

  addSection("current", "Current", matched.filter((entry) => entry.current));
  addSection("pinned", "Pinned", matched.filter((entry) => entry.pinned));
  addSection("recent", "Recent", matched.filter((entry) => Boolean(entry.lastUsedAt)));
  addSection("catalogue", "Models", matched, true);

  return {
    sections,
    renderedEntries,
    totalMatches: matched.length,
    hiddenCount: Math.max(0, matched.length - renderedEntries.length),
  };
}

export type ModelPickerNavigationAction = "next" | "previous" | "first" | "last" | "page-next" | "page-previous";

export function moveModelPickerActiveKey(
  entries: readonly ModelCatalogueEntry[],
  activeKey: string | null | undefined,
  action: ModelPickerNavigationAction,
  pageSize = 7,
): string | null {
  const selectable = entries;
  if (selectable.length === 0) return null;
  const currentIndex = selectable.findIndex((entry) => entry.key === activeKey);
  const page = Math.max(1, Math.floor(pageSize));
  let nextIndex = currentIndex;
  if (action === "first") nextIndex = 0;
  if (action === "last") nextIndex = selectable.length - 1;
  if (action === "next") nextIndex = currentIndex < 0 ? 0 : Math.min(selectable.length - 1, currentIndex + 1);
  if (action === "previous") nextIndex = currentIndex < 0 ? selectable.length - 1 : Math.max(0, currentIndex - 1);
  if (action === "page-next") nextIndex = currentIndex < 0 ? 0 : Math.min(selectable.length - 1, currentIndex + page);
  if (action === "page-previous") nextIndex = currentIndex < 0 ? selectable.length - 1 : Math.max(0, currentIndex - page);
  return selectable[nextIndex]?.key ?? null;
}
