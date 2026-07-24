export interface ProviderCustomField {
  key: string;
  label: string;
  placeholder: string;
  required: boolean;
}

export interface ProviderDef {
  id: string;
  name: string;
  hasOAuth: boolean;
  hasApiKey: boolean;
  apiKeyHint?: string;
  isCustom?: boolean;
  customApi?: string;
  customFields?: ProviderCustomField[];
  customCompat?: Record<string, unknown>;
  hasExternalAuth?: boolean;
  authNote?: string;
}

type ModelRegistryLike = {
  getAll?: () => Array<{ provider: string }>;
  getProviderDisplayName?: (provider: string) => string;
};

type RuntimeProviderLike = {
  id: string;
  name: string;
  auth: {
    apiKey?: { login?: unknown };
    oauth?: { login?: unknown };
  };
};

type ModelRuntimeLike = {
  getProviders?: () => readonly RuntimeProviderLike[];
};

const REMOVED_PROVIDER_IDS = new Set([
  "antigravity",
  "google-antigravity",
  "google-gemini-cli",
]);

const API_KEY_HINTS: Record<string, string> = {
  "ant-ling": "...",
  anthropic: "sk-ant-...",
  "azure-openai-responses": "...",
  cerebras: "csk-...",
  "cloudflare-ai-gateway": "...",
  "cloudflare-workers-ai": "...",
  deepseek: "sk-...",
  fireworks: "fw_...",
  google: "AIza...",
  groq: "gsk_...",
  huggingface: "hf_...",
  "kimi-coding": "...",
  minimax: "...",
  "minimax-cn": "...",
  mistral: "...",
  moonshotai: "sk-...",
  "moonshotai-cn": "sk-...",
  nvidia: "nvapi-...",
  openai: "sk-proj-...",
  opencode: "oc-...",
  "opencode-go": "oc-...",
  openrouter: "sk-or-...",
  "qwen-token-plan": "sk-sp-...",
  "qwen-token-plan-cn": "sk-sp-...",
  radius: "...",
  together: "...",
  "vercel-ai-gateway": "...",
  xai: "xai-...",
  xiaomi: "XIAOMI_API_KEY",
  "xiaomi-token-plan-cn": "XIAOMI_TOKEN_PLAN_CN_API_KEY",
  "xiaomi-token-plan-ams": "XIAOMI_TOKEN_PLAN_AMS_API_KEY",
  "xiaomi-token-plan-sgp": "XIAOMI_TOKEN_PLAN_SGP_API_KEY",
  zai: "ZAI_API_KEY",
  "zai-coding-cn": "ZAI_CODING_CN_API_KEY",
};

const PROVIDER_DISPLAY_NAMES: Record<string, string> = {
  "amazon-bedrock": "Amazon Bedrock",
  "ant-ling": "Ant Ling",
  anthropic: "Anthropic",
  "azure-openai-responses": "Azure OpenAI Responses",
  cerebras: "Cerebras",
  "cloudflare-ai-gateway": "Cloudflare AI Gateway",
  "cloudflare-workers-ai": "Cloudflare Workers AI",
  deepseek: "DeepSeek",
  fireworks: "Fireworks",
  "github-copilot": "GitHub Copilot",
  google: "Google Gemini",
  "google-vertex": "Google Vertex AI",
  groq: "Groq",
  huggingface: "Hugging Face",
  "kimi-coding": "Kimi For Coding",
  mistral: "Mistral",
  minimax: "MiniMax",
  "minimax-cn": "MiniMax (China)",
  moonshotai: "Moonshot AI",
  "moonshotai-cn": "Moonshot AI (China)",
  nvidia: "NVIDIA",
  opencode: "OpenCode Zen",
  "opencode-go": "OpenCode Go",
  "openai-codex": "OpenAI Codex",
  openai: "OpenAI",
  openrouter: "OpenRouter",
  "qwen-token-plan": "Qwen Token Plan",
  "qwen-token-plan-cn": "Qwen Token Plan CN",
  radius: "Radius",
  together: "Together",
  "vercel-ai-gateway": "Vercel AI Gateway",
  xai: "xAI",
  xiaomi: "Xiaomi MiMo (API billing)",
  "xiaomi-token-plan-cn": "Xiaomi MiMo Token Plan (CN)",
  "xiaomi-token-plan-ams": "Xiaomi MiMo Token Plan (AMS)",
  "xiaomi-token-plan-sgp": "Xiaomi MiMo Token Plan (SGP)",
  zai: "ZAI",
  "zai-coding-cn": "Z.AI Coding CN",
};

const EXTERNAL_AUTH_NOTES: Record<string, string> = {
  "amazon-bedrock": "Configure AWS credentials (AWS_PROFILE, IAM environment variables, bearer token, or instance/task role) and region outside this login flow.",
  "google-vertex": "Configure Google Application Default Credentials plus GOOGLE_CLOUD_PROJECT and GOOGLE_CLOUD_LOCATION outside this login flow.",
  "qwen-token-plan": "Qwen subscription token-plan provider. Use QWEN_TOKEN_PLAN_API_KEY or save the token-plan key here.",
  "qwen-token-plan-cn": "Qwen China token-plan provider. Use QWEN_TOKEN_PLAN_CN_API_KEY or save the China token-plan key here.",
  radius: "Radius supports OAuth subscription login and API-key gateways.",
  xiaomi: "Uses API billing credentials. Set XIAOMI_API_KEY or save an API key here; token-plan credentials use the regional xiaomi-token-plan-* providers.",
  "xiaomi-token-plan-cn": "Regional token-plan provider. Use XIAOMI_TOKEN_PLAN_CN_API_KEY or save the regional token-plan key here.",
  "xiaomi-token-plan-ams": "Regional token-plan provider. Use XIAOMI_TOKEN_PLAN_AMS_API_KEY or save the regional token-plan key here.",
  "xiaomi-token-plan-sgp": "Regional token-plan provider. Use XIAOMI_TOKEN_PLAN_SGP_API_KEY or save the regional token-plan key here.",
  "zai-coding-cn": "Z.AI China coding-plan provider. Use ZAI_CODING_CN_API_KEY or save the API key here.",
};

function customProvider(
  id: string,
  name: string,
  customApi: string,
  customFields: ProviderCustomField[],
  customCompat?: Record<string, unknown>,
): ProviderDef {
  return { id, name, hasOAuth: false, hasApiKey: false, isCustom: true, customApi, customFields, ...(customCompat ? { customCompat } : {}) };
}

export const PROVIDER_DEFS: ProviderDef[] = [
  { id: "ant-ling", name: "Ant Ling", hasOAuth: false, hasApiKey: true, apiKeyHint: API_KEY_HINTS["ant-ling"] },
  { id: "anthropic", name: "Anthropic", hasOAuth: true, hasApiKey: true, apiKeyHint: API_KEY_HINTS.anthropic },
  { id: "github-copilot", name: "GitHub Copilot", hasOAuth: true, hasApiKey: false },
  { id: "openai-codex", name: "OpenAI Codex", hasOAuth: true, hasApiKey: false },
  { id: "openai", name: "OpenAI", hasOAuth: false, hasApiKey: true, apiKeyHint: API_KEY_HINTS.openai },
  { id: "azure-openai-responses", name: "Azure OpenAI Responses", hasOAuth: false, hasApiKey: true, apiKeyHint: API_KEY_HINTS["azure-openai-responses"] },
  { id: "google", name: "Google Gemini", hasOAuth: false, hasApiKey: true, apiKeyHint: API_KEY_HINTS.google },
  { id: "deepseek", name: "DeepSeek", hasOAuth: false, hasApiKey: true, apiKeyHint: API_KEY_HINTS.deepseek },
  { id: "mistral", name: "Mistral", hasOAuth: false, hasApiKey: true, apiKeyHint: API_KEY_HINTS.mistral },
  { id: "nvidia", name: "NVIDIA", hasOAuth: false, hasApiKey: true, apiKeyHint: API_KEY_HINTS.nvidia },
  { id: "groq", name: "Groq", hasOAuth: false, hasApiKey: true, apiKeyHint: API_KEY_HINTS.groq },
  { id: "cerebras", name: "Cerebras", hasOAuth: false, hasApiKey: true, apiKeyHint: API_KEY_HINTS.cerebras },
  {
    id: "cloudflare-ai-gateway",
    name: "Cloudflare AI Gateway",
    hasOAuth: false,
    hasApiKey: true,
    apiKeyHint: API_KEY_HINTS["cloudflare-ai-gateway"],
    authNote: "Also set CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_GATEWAY_ID in the environment.",
  },
  {
    id: "cloudflare-workers-ai",
    name: "Cloudflare Workers AI",
    hasOAuth: false,
    hasApiKey: true,
    apiKeyHint: API_KEY_HINTS["cloudflare-workers-ai"],
    authNote: "Also set CLOUDFLARE_ACCOUNT_ID in the environment.",
  },
  { id: "xai", name: "xAI", hasOAuth: false, hasApiKey: true, apiKeyHint: API_KEY_HINTS.xai },
  { id: "xiaomi", name: "Xiaomi MiMo (API billing)", hasOAuth: false, hasApiKey: true, apiKeyHint: API_KEY_HINTS.xiaomi, authNote: EXTERNAL_AUTH_NOTES.xiaomi },
  { id: "xiaomi-token-plan-cn", name: "Xiaomi MiMo Token Plan (CN)", hasOAuth: false, hasApiKey: true, apiKeyHint: API_KEY_HINTS["xiaomi-token-plan-cn"], authNote: EXTERNAL_AUTH_NOTES["xiaomi-token-plan-cn"] },
  { id: "xiaomi-token-plan-ams", name: "Xiaomi MiMo Token Plan (AMS)", hasOAuth: false, hasApiKey: true, apiKeyHint: API_KEY_HINTS["xiaomi-token-plan-ams"], authNote: EXTERNAL_AUTH_NOTES["xiaomi-token-plan-ams"] },
  { id: "xiaomi-token-plan-sgp", name: "Xiaomi MiMo Token Plan (SGP)", hasOAuth: false, hasApiKey: true, apiKeyHint: API_KEY_HINTS["xiaomi-token-plan-sgp"], authNote: EXTERNAL_AUTH_NOTES["xiaomi-token-plan-sgp"] },
  { id: "openrouter", name: "OpenRouter", hasOAuth: true, hasApiKey: true, apiKeyHint: API_KEY_HINTS.openrouter },
  { id: "vercel-ai-gateway", name: "Vercel AI Gateway", hasOAuth: false, hasApiKey: true, apiKeyHint: API_KEY_HINTS["vercel-ai-gateway"] },
  { id: "qwen-token-plan", name: "Qwen Token Plan", hasOAuth: false, hasApiKey: true, apiKeyHint: API_KEY_HINTS["qwen-token-plan"], authNote: EXTERNAL_AUTH_NOTES["qwen-token-plan"] },
  { id: "qwen-token-plan-cn", name: "Qwen Token Plan CN", hasOAuth: false, hasApiKey: true, apiKeyHint: API_KEY_HINTS["qwen-token-plan-cn"], authNote: EXTERNAL_AUTH_NOTES["qwen-token-plan-cn"] },
  { id: "radius", name: "Radius", hasOAuth: true, hasApiKey: true, apiKeyHint: API_KEY_HINTS.radius, authNote: EXTERNAL_AUTH_NOTES.radius },
  { id: "together", name: "Together", hasOAuth: false, hasApiKey: true, apiKeyHint: API_KEY_HINTS.together },
  { id: "zai", name: "ZAI", hasOAuth: false, hasApiKey: true, apiKeyHint: API_KEY_HINTS.zai },
  { id: "zai-coding-cn", name: "Z.AI Coding CN", hasOAuth: false, hasApiKey: true, apiKeyHint: API_KEY_HINTS["zai-coding-cn"], authNote: EXTERNAL_AUTH_NOTES["zai-coding-cn"] },
  { id: "opencode", name: "OpenCode Zen", hasOAuth: false, hasApiKey: true, apiKeyHint: API_KEY_HINTS.opencode },
  { id: "opencode-go", name: "OpenCode Go", hasOAuth: false, hasApiKey: true, apiKeyHint: API_KEY_HINTS["opencode-go"] },
  { id: "kimi-coding", name: "Kimi For Coding", hasOAuth: true, hasApiKey: true, apiKeyHint: API_KEY_HINTS["kimi-coding"] },
  { id: "minimax", name: "MiniMax", hasOAuth: false, hasApiKey: true, apiKeyHint: API_KEY_HINTS.minimax },
  { id: "minimax-cn", name: "MiniMax (China)", hasOAuth: false, hasApiKey: true, apiKeyHint: API_KEY_HINTS["minimax-cn"] },
  { id: "moonshotai", name: "Moonshot AI", hasOAuth: false, hasApiKey: true, apiKeyHint: API_KEY_HINTS.moonshotai },
  { id: "moonshotai-cn", name: "Moonshot AI (China)", hasOAuth: false, hasApiKey: true, apiKeyHint: API_KEY_HINTS["moonshotai-cn"] },
  { id: "huggingface", name: "Hugging Face", hasOAuth: false, hasApiKey: true, apiKeyHint: API_KEY_HINTS.huggingface },
  { id: "fireworks", name: "Fireworks", hasOAuth: false, hasApiKey: true, apiKeyHint: API_KEY_HINTS.fireworks },
  {
    id: "amazon-bedrock",
    name: "Amazon Bedrock",
    hasOAuth: false,
    hasApiKey: false,
    hasExternalAuth: true,
    authNote: EXTERNAL_AUTH_NOTES["amazon-bedrock"],
  },
  {
    id: "google-vertex",
    name: "Google Vertex AI",
    hasOAuth: false,
    hasApiKey: false,
    hasExternalAuth: true,
    authNote: EXTERNAL_AUTH_NOTES["google-vertex"],
  },
  customProvider("opencode-zen", "OpenCode ZEN", "openai-completions", [
    { key: "baseUrl", label: "Base URL", placeholder: "https://opencode.ai/zen/v1", required: true },
    { key: "apiKey", label: "ZEN API Key", placeholder: "optional for free-tier models", required: false },
    { key: "modelId", label: "Model ID", placeholder: "big-pickle", required: true },
    { key: "modelIds", label: "Additional models (comma-separated)", placeholder: "gpt-5.4,glm-5,kimi-k2", required: false },
  ]),
  customProvider("azure-openai", "Azure OpenAI", "openai-responses", [
    { key: "baseUrl", label: "Base URL", placeholder: "https://myresource.openai.azure.com", required: true },
    { key: "apiKey", label: "API Key (or empty for managed identity)", placeholder: "Bearer ...", required: false },
    { key: "modelId", label: "Model ID", placeholder: "gpt-4o", required: true },
    { key: "modelIds", label: "Additional model IDs (comma-separated)", placeholder: "gpt-4o,o3-mini", required: false },
  ]),
  customProvider("ollama", "Ollama", "openai-completions", [
    { key: "baseUrl", label: "Base URL", placeholder: "http://192.168.1.100:11434/v1", required: true },
    { key: "modelId", label: "Model ID", placeholder: "llama3:latest", required: true },
    { key: "modelIds", label: "Additional model IDs (comma-separated)", placeholder: "qwen3:latest", required: false },
    { key: "contextWindow", label: "Context window", placeholder: "128000", required: false },
  ]),
  customProvider("llama-cpp", "llama.cpp router", "openai-completions", [
    { key: "baseUrl", label: "Base URL", placeholder: "http://127.0.0.1:8080/v1", required: true },
    { key: "modelId", label: "Model ID", placeholder: "local-model", required: true },
    { key: "modelIds", label: "Additional model IDs (comma-separated)", placeholder: "qwen3-8b,gemma-3-12b", required: false },
    { key: "contextWindow", label: "Context window", placeholder: "32768", required: false },
  ], {
    supportsStore: false,
    supportsStrictMode: false,
    supportsDeveloperRole: false,
    supportsReasoningEffort: false,
    supportsLongCacheRetention: false,
    maxTokensField: "max_tokens",
  }),
  customProvider("openai-compatible", "OpenAI-compatible", "openai-completions", [
    { key: "baseUrl", label: "Base URL", placeholder: "https://api.example.com/v1", required: true },
    { key: "apiKey", label: "API Key", placeholder: "sk-...", required: true },
    { key: "modelId", label: "Model ID", placeholder: "gpt-4o", required: true },
    { key: "modelIds", label: "Additional model IDs (comma-separated)", placeholder: "model-a,model-b", required: false },
    { key: "contextWindow", label: "Context window", placeholder: "128000", required: false },
  ]),
];

function titleCaseProvider(providerId: string): string {
  return providerId
    .split("-")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function getRuntimeProviders(modelRuntime?: ModelRuntimeLike | null): Map<string, RuntimeProviderLike> {
  try {
    return new Map((modelRuntime?.getProviders?.() ?? []).map((provider) => [provider.id, provider]));
  } catch {
    return new Map();
  }
}

export function getProviderDisplayName(providerId: string, registry?: ModelRegistryLike | null): string {
  const id = providerId.trim();
  if (!id) return "Provider";
  try {
    const registryName = registry?.getProviderDisplayName?.(id);
    if (registryName) return registryName;
  } catch (e) {
    // Fall back to local names when running against older pi versions.
    void e;
  }
  return PROVIDER_DISPLAY_NAMES[id] || PROVIDER_DEFS.find((entry) => entry.id === id)?.name || titleCaseProvider(id);
}

export function getProviderDefs(
  registry?: ModelRegistryLike | null,
  modelRuntime?: ModelRuntimeLike | null,
): ProviderDef[] {
  const runtimeProviders = getRuntimeProviders(modelRuntime);
  const defs = PROVIDER_DEFS
    .filter((provider) => !REMOVED_PROVIDER_IDS.has(provider.id))
    .map((provider) => {
      const runtimeProvider = runtimeProviders.get(provider.id);
      return {
        ...provider,
        name: runtimeProvider?.name || getProviderDisplayName(provider.id, registry),
        hasOAuth: runtimeProvider ? typeof runtimeProvider.auth.oauth?.login === "function" : provider.hasOAuth,
        hasApiKey: runtimeProvider ? typeof runtimeProvider.auth.apiKey?.login === "function" : provider.hasApiKey,
        hasExternalAuth: runtimeProvider
          ? Boolean(runtimeProvider.auth.apiKey && typeof runtimeProvider.auth.apiKey.login !== "function")
          : provider.hasExternalAuth,
      };
    });

  const byId = new Map(defs.map((provider) => [provider.id, provider]));
  const dynamicProviderIds = new Set(runtimeProviders.keys());
  try {
    for (const model of registry?.getAll?.() ?? []) {
      if (model.provider && !REMOVED_PROVIDER_IDS.has(model.provider)) dynamicProviderIds.add(model.provider);
    }
  } catch (e) {
    // Keep the static list if the registry is unavailable or mid-refresh.
    void e;
  }

  for (const providerId of dynamicProviderIds) {
    const existing = byId.get(providerId);
    if (existing) {
      const runtimeProvider = runtimeProviders.get(providerId);
      existing.name = runtimeProvider?.name || getProviderDisplayName(providerId, registry);
      existing.hasOAuth = runtimeProvider ? typeof runtimeProvider.auth.oauth?.login === "function" : existing.hasOAuth;
      existing.hasApiKey = runtimeProvider ? typeof runtimeProvider.auth.apiKey?.login === "function" : existing.hasApiKey;
      continue;
    }

    const runtimeProvider = runtimeProviders.get(providerId);
    const hasOAuth = typeof runtimeProvider?.auth.oauth?.login === "function";
    const hasApiKey = typeof runtimeProvider?.auth.apiKey?.login === "function";
    byId.set(providerId, {
      id: providerId,
      name: runtimeProvider?.name || getProviderDisplayName(providerId, registry),
      hasOAuth,
      hasApiKey,
      apiKeyHint: API_KEY_HINTS[providerId],
      hasExternalAuth: Boolean(runtimeProvider?.auth.apiKey) && !hasApiKey,
      authNote: EXTERNAL_AUTH_NOTES[providerId] || "This provider is available in the model registry but does not expose a Piclaw-managed login method. Configure its credentials externally.",
    });
  }

  const extras = [...byId.values()]
    .filter((provider) => !defs.some((entry) => entry.id === provider.id))
    .sort((a, b) => a.name.localeCompare(b.name));
  return [...defs, ...extras];
}
