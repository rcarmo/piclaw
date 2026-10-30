import { getConfigPath } from "./config-context.js";
import { readCachedJsonFile } from "./config-file-cache.js";
import { registerDomainConfig, stringField, type DomainConfigField } from "./domain-config.js";

export const ACCESS_MODES = ["single-user", "isolated-containers"] as const;
export type AccessMode = typeof ACCESS_MODES[number];

export interface IsolationBackend {
  id: string;
  ownerUserId: string;
  url: string;
}

export type IsolationConfig =
  | { component: "gateway"; signingKeyRef: string; backends: IsolationBackend[] }
  | { component: "backend"; backendId: string; ownerUserId: string; gatewayUrl: string; verificationKeyRef: string };

export interface AccessConfig {
  mode: AccessMode;
  isolation: IsolationConfig | null;
}

function object(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object.`);
  return value as Record<string, unknown>;
}

function knownKeys(value: Record<string, unknown>, keys: string[], label: string): void {
  for (const key of Object.keys(value)) {
    if (!keys.includes(key)) throw new Error(`Unknown ${label} key: ${key}.`);
  }
}

function requiredString(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${label} must be a non-empty string.`);
  return value.trim();
}

function httpsUrl(value: unknown, label: string): string {
  const url = new URL(requiredString(value, label));
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) {
    throw new Error(`${label} must be an HTTPS URL without credentials, query or fragment.`);
  }
  return url.toString();
}

function isolation(value: unknown): IsolationConfig | null {
  if (value === null) return null;
  const config = object(value, "access.isolation");
  if (config.component === "gateway") {
    knownKeys(config, ["component", "signingKeyRef", "backends"], "access.isolation.gateway");
    if (!Array.isArray(config.backends) || config.backends.length === 0) throw new Error("Gateway requires an explicit backend registry.");
    const seenIds = new Set<string>();
    const seenOwners = new Set<string>();
    const seenUrls = new Set<string>();
    const backends = config.backends.map((raw): IsolationBackend => {
      const backend = object(raw, "Gateway backend");
      knownKeys(backend, ["id", "ownerUserId", "url"], "Gateway backend");
      const id = requiredString(backend.id, "backend.id");
      const ownerUserId = requiredString(backend.ownerUserId, "backend.ownerUserId");
      if (seenIds.has(id) || seenOwners.has(ownerUserId)) throw new Error("Gateway backend and owner IDs must be unique.");
      const url = httpsUrl(backend.url, "backend.url");
      if (seenUrls.has(url)) throw new Error("Gateway backend URLs must be unique per owner.");
      seenIds.add(id);
      seenOwners.add(ownerUserId);
      seenUrls.add(url);
      return { id, ownerUserId, url };
    });
    return { component: "gateway", signingKeyRef: requiredString(config.signingKeyRef, "signingKeyRef"), backends };
  }
  if (config.component === "backend") {
    knownKeys(config, ["component", "backendId", "ownerUserId", "gatewayUrl", "verificationKeyRef"], "access.isolation.backend");
    return {
      component: "backend",
      backendId: requiredString(config.backendId, "backendId"),
      ownerUserId: requiredString(config.ownerUserId, "ownerUserId"),
      gatewayUrl: httpsUrl(config.gatewayUrl, "gatewayUrl"),
      verificationKeyRef: requiredString(config.verificationKeyRef, "verificationKeyRef"),
    };
  }
  throw new Error("access.isolation.component must be gateway or backend.");
}

export const ACCESS_CONFIG_SCHEMA = registerDomainConfig<AccessConfig>({
  domain: "access",
  fields: {
    mode: stringField({
      key: "mode", owner: "core.config-access", defaultValue: "single-user", nonEmpty: true,
      allowedValues: ACCESS_MODES, persistence: "json-config", precedence: ["persisted", "default"], secretClass: "none",
    }) as DomainConfigField<AccessMode>,
    isolation: {
      key: "isolation", owner: "core.config-access", type: "json", defaultValue: null,
      validate: isolation, persistence: "json-config", precedence: ["persisted", "default"], secretClass: "none",
    },
  },
});
/** Access configuration never uses the forgiving general JSON reader or legacy/env aliases. */
export function readAccessConfig(configPath = getConfigPath()): AccessConfig & { modeExplicit: boolean } {
  let parsed: unknown;
  try {
    parsed = readCachedJsonFile(configPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { mode: "single-user", isolation: null, modeExplicit: false };
    if (error instanceof SyntaxError) {
      throw new Error(`Invalid JSON at ${configPath}; access configuration cannot default safely.`, { cause: error });
    }
    throw new Error(`Cannot read access configuration at ${configPath}.`, { cause: error });
  }
  const config = object(parsed, "Configuration");
  if (Object.hasOwn(config, "access")) throw new Error("Use domains.access, not a top-level access alias.");
  const domains = Object.hasOwn(config, "domains") ? object(config.domains, "domains") : {};
  const access = Object.hasOwn(domains, "access") ? object(domains.access, "domains.access") : {};
  knownKeys(access, ["mode", "isolation"], "domains.access");
  const modeExplicit = Object.hasOwn(access, "mode");
  const mode = ACCESS_CONFIG_SCHEMA.fields.mode.validate(modeExplicit ? access.mode : "single-user");
  const component = isolation(Object.hasOwn(access, "isolation") ? access.isolation : null);
  if (mode === "isolated-containers" && !component) throw new Error("isolated-containers requires access.isolation component and trust configuration.");
  if (mode !== "isolated-containers" && component) throw new Error("access.isolation is only valid in isolated-containers mode.");
  return { mode, isolation: component, modeExplicit };
}

/** Capability check for public entrypoints; invalid configuration never enables execution. */
export function isSingleUserAccess(): boolean {
  try { return readAccessConfig().mode === "single-user"; } catch { return false; }
}
