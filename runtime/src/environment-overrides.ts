import { admitSqliteWrite } from "./db/sqlite-async-admission.js";
import { getDb, captureHostDatabaseBinding } from "./db/connection.js";
import {
  extensionKvDelete,
  extensionKvGet,
  extensionKvSet,
} from "./db/extension-kv.js";
import { listInjectableKeychainEnvNames } from "./secure/keychain.js";

const ENVIRONMENT_SETTINGS_EXTENSION_ID = "piclaw.environment-settings";
const ENVIRONMENT_OVERRIDES_KEY = "overrides";
const ENV_NAME_REGEX = /^[A-Za-z_][A-Za-z0-9_]*$/;

export type EnvironmentOverrideMap = Record<string, string>;

export interface EnvironmentVariableRow {
  name: string;
  value: string;
  overridden: boolean;
  source: "process" | "override";
}

export interface EnvironmentSettingsData {
  variables: EnvironmentVariableRow[];
  overrides: EnvironmentOverrideMap;
  keychainEnvNames: string[];
  count: number;
  overrideCount: number;
}

const inheritedProcessEnv: Record<string, string> = { ...(process.env as Record<string, string>) };
const preOverrideProcessEnv = new Map<string, string | undefined>();

function isValidEnvName(name: string): boolean {
  return ENV_NAME_REGEX.test(name);
}

function normalizeName(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function sanitizeOverrides(input: unknown, keychainEnvNames = getKeychainEnvNameSet()): EnvironmentOverrideMap {
  if (!input || typeof input !== "object") return {};
  const entries = Object.entries(input as Record<string, unknown>)
    .map(([key, value]) => [normalizeName(key), typeof value === "string" ? value : String(value ?? "")] as const)
    .filter(([key]) => isValidEnvName(key) && !keychainEnvNames.has(key))
    .sort(([a], [b]) => a.localeCompare(b));
  return Object.fromEntries(entries);
}

export function getKeychainEnvNameSet(): Set<string> {
  try {
    return new Set(listInjectableKeychainEnvNames());
  } catch {
    return new Set();
  }
}

export function loadEnvironmentOverrides(): EnvironmentOverrideMap {
  return sanitizeOverrides(extensionKvGet<EnvironmentOverrideMap>(
    ENVIRONMENT_SETTINGS_EXTENSION_ID,
    ENVIRONMENT_OVERRIDES_KEY,
    "global",
    "",
  ));
}

function restoreProcessEnvValue(name: string): void {
  if (preOverrideProcessEnv.has(name)) {
    const value = preOverrideProcessEnv.get(name);
    preOverrideProcessEnv.delete(name);
    if (value === undefined) {
      delete process.env[name];
    } else {
      process.env[name] = value;
    }
    return;
  }
  if (Object.prototype.hasOwnProperty.call(inheritedProcessEnv, name)) {
    process.env[name] = inheritedProcessEnv[name];
  } else {
    delete process.env[name];
  }
}

export function applyEnvironmentOverrides(overrides: EnvironmentOverrideMap = loadEnvironmentOverrides()): EnvironmentOverrideMap {
  const keychainEnvNames = getKeychainEnvNameSet();
  const sanitized = sanitizeOverrides(overrides, keychainEnvNames);
  const nextOverrideNames = new Set(Object.keys(sanitized));

  for (const name of Object.keys(loadEnvironmentOverrides())) {
    if (nextOverrideNames.has(name)) continue;
    restoreProcessEnvValue(name);
  }

  for (const [name, value] of Object.entries(sanitized)) {
    process.env[name] = value;
  }
  return sanitized;
}

export function getEnvironmentSettingsData(overrides = loadEnvironmentOverrides(), keychainEnvNames = getKeychainEnvNameSet(),
  environment: NodeJS.ProcessEnv = process.env): EnvironmentSettingsData {

  const names = new Set<string>();
  for (const name of Object.keys(environment)) {
    if (!isValidEnvName(name) || keychainEnvNames.has(name)) continue;
    names.add(name);
  }
  for (const name of Object.keys(overrides)) {
    if (!isValidEnvName(name) || keychainEnvNames.has(name)) continue;
    names.add(name);
  }

  const variables = Array.from(names)
    .sort((a, b) => a.localeCompare(b))
    .map((name) => {
      const overridden = Object.prototype.hasOwnProperty.call(overrides, name);
      return {
        name,
        value: overridden ? overrides[name] : (environment[name] || ""),
        overridden,
        source: overridden ? "override" as const : "process" as const,
      };
    });

  return {
    variables,
    overrides,
    keychainEnvNames: Array.from(keychainEnvNames).sort((a, b) => a.localeCompare(b)),
    count: variables.length,
    overrideCount: Object.keys(overrides).length,
  };
}

/** One admitted configuration change; process publication follows its physical commit. */
export async function admitEnvironmentOverride(nameValue: unknown, value: string | null, authorise: () => void,
  signal?: AbortSignal): Promise<EnvironmentSettingsData> {
  const name = normalizeName(nameValue);
  if (!isValidEnvName(name)) throw new Error("Invalid environment variable name.");
  const database = getDb(), binding = captureHostDatabaseBinding(database);
  const check = (phase?: 'before' | 'after') => {
    binding(); authorise();
    if (phase === undefined && database.inTransaction) throw Error('Environment change requires its own transaction.');
  };
  const committed = await admitSqliteWrite(database, () => {
    const keychainNames = getKeychainEnvNameSet();
    if (value !== null && keychainNames.has(name)) throw Error('Keychain-injected environment variables cannot be overridden here.');
    const current = loadEnvironmentOverrides(), next = { ...current };
    if (value === null) delete next[name]; else next[name] = value;
    const settings = getEnvironmentSettingsData(next, keychainNames, { ...process.env });
    if (value !== null || Object.hasOwn(current, name)) {
      if (Object.keys(next).length) extensionKvSet(ENVIRONMENT_SETTINGS_EXTENSION_ID, ENVIRONMENT_OVERRIDES_KEY, next, 'global', '');
      else extensionKvDelete(ENVIRONMENT_SETTINGS_EXTENSION_ID, ENVIRONMENT_OVERRIDES_KEY, 'global', '');
    }
    return { settings, remember: !Object.hasOwn(current, name) };
  }, check, signal, undefined, check);
  // An old profile's known commit cannot authorize process changes in a new one.
  try { binding(); } catch { return committed.settings; }
  if (value === null) { if (!committed.remember) restoreProcessEnvValue(name); }
  else {
    if (committed.remember && !preOverrideProcessEnv.has(name)) preOverrideProcessEnv.set(name, process.env[name]);
    process.env[name] = value;
  }
  // Pure formatting from committed values: no database access after publication.
  return getEnvironmentSettingsData(committed.settings.overrides, new Set(committed.settings.keychainEnvNames));
}
