/** Secret bootstrap accessors. Settings may point to key material without storing it. */

import { closeSync, constants, fstatSync, openSync, readFileSync, readSync } from "node:fs";
import { isAbsolute } from "node:path";

import { envConfig, getRuntimeConfigPaths } from "./config-context.js";
import { readJsonConfig } from "./config-store.js";
import { clearEnvValue, readEnvValue, readMergedEnvValue, writeEnvValue } from "./env.js";

export interface WebSecretBootstrapConfig {
  internalSecret: string;
  totpSecret: string;
  widgetToken: string;
}

/** Read web bootstrap secrets with process env before workspace .env aliases. */
export function getWebSecretBootstrapConfig(): Readonly<WebSecretBootstrapConfig> {
  return Object.freeze({
    internalSecret:
      readMergedEnvValue("PICLAW_INTERNAL_SECRET", envConfig)
      || readMergedEnvValue("PICLAW_WEB_INTERNAL_SECRET", envConfig)
      || "",
    totpSecret: readMergedEnvValue("PICLAW_WEB_TOTP_SECRET", envConfig) || "",
    widgetToken: readMergedEnvValue("PICLAW_WEB_WIDGET_TOKEN", envConfig) || "",
  });
}

/** Keep mutable web-secret compatibility aliases live after same-process rotations. */
export function setWebSecretCompatibilityValue(
  name: "PICLAW_WEB_TOTP_SECRET" | "PICLAW_WEB_WIDGET_TOKEN",
  value: string,
): void {
  if (value) writeEnvValue(name, value);
  else clearEnvValue(name);
}

export interface KeychainBootstrapConfig {
  key: string;
  keyFile: string;
  fileSource?: "config";
}

/** Preserve environment overrides; JSON can supply a path only. */
export function getKeychainBootstrapConfig(): Readonly<KeychainBootstrapConfig> {
  const key = readEnvValue("PICLAW_KEYCHAIN_KEY") || "";
  const keyFile = readEnvValue("PICLAW_KEYCHAIN_KEY_FILE") || "";
  if (key || keyFile) return Object.freeze({ key, keyFile });

  const section = readJsonConfig(getRuntimeConfigPaths().configPath).keychain;
  if (section && typeof section === "object" && "keyFile" in section) {
    return Object.freeze({ key, keyFile: typeof section.keyFile === "string" ? section.keyFile : "", fileSource: "config" });
  }
  return Object.freeze({ key, keyFile });
}

/** Read the checked descriptor, never the path again after checking ownership and permissions. */
function readPrivateKeyFile(path: string): string {
  const maxBytes = 4096;
  const failure = "Cannot load the configured keychain key file. Use an absolute path to a private regular file owned by the current user.";
  const uid = process.geteuid?.();
  if (uid === undefined || !constants.O_NOFOLLOW || !isAbsolute(path)) throw new Error(failure);
  try {
    const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    try {
      const stat = fstatSync(fd);
      const mode = stat.mode & 0o7777;
      if (!stat.isFile() || stat.uid !== uid || stat.nlink !== 1 || (mode !== 0o400 && mode !== 0o600) || stat.size > maxBytes) {
        throw new Error(failure);
      }
      const bytes = Buffer.alloc(maxBytes + 1);
      try {
        let used = 0;
        while (used < bytes.length) {
          const count = readSync(fd, bytes, used, bytes.length - used, used);
          if (!count) break;
          used += count;
        }
        const key = bytes.toString("utf8", 0, used).trim();
        if (key && used <= maxBytes) return key;
        throw new Error(failure);
      } finally { bytes.fill(0); }
    } finally { closeSync(fd); }
  } catch {
    // Do not include file paths or key material in diagnostics.
    throw new Error(failure);
  }
}

/** Resolve the direct env key, env key file, or protected file in settings, in that order. */
export function readKeychainBootstrapKeyMaterial(): string {
  const config = getKeychainBootstrapConfig();
  if (config.key) return config.key;
  if (config.fileSource === "config") return readPrivateKeyFile(config.keyFile);
  return config.keyFile ? readFileSync(config.keyFile, "utf8").trim() : "";
}
