import { OPERATION_BUILTIN_TOOLS } from "../agent-pool/operation-session-profile.js";
import {
  registerDomainConfig,
  boolField,
  readDomainConfig,
  type DomainConfigField,
} from "./domain-config.js";
import { getConfigPath } from "./config-context.js";
import type { OperationGrant } from "../addons/operation-contracts.js";

export interface ConfiguredOperationGrant extends OperationGrant {
  addonId: string;
  principalId: string;
  enabled: boolean;
  approvalRequired: boolean;
}
export interface OperationsConfig {
  enabled: boolean;
  grants: ConfiguredOperationGrant[];
}
const validId = (v: unknown): v is string =>
  typeof v === "string" && /^[a-zA-Z0-9_.:-]{1,128}$/.test(v);
function grantsField(): DomainConfigField<ConfiguredOperationGrant[]> {
  return {
    key: "grants",
    owner: "runtime/addon-operations",
    type: "json",
    defaultValue: [],
    persistence: "json-config",
    precedence: ["persisted", "default"],
    secretClass: "none",
    validate(value) {
      if (!Array.isArray(value) || value.length > 100)
        throw new Error(
          "operations.grants must be an array with at most 100 grants.",
        );
      const seen = new Set<string>();
      return value.map((raw) => {
        if (!raw || typeof raw !== "object" || Array.isArray(raw))
          throw new Error("Invalid operation grant.");
        const r = raw as Record<string, unknown>;
        const keys = [
          "addonId",
          "principalId",
          "target",
          "revision",
          "allowedTools",
          "timeoutMs",
          "maxToolCalls",
          "parentWorkId",
          "enabled",
          "approvalRequired",
        ];
        if (
          Object.keys(r).some((k) => !keys.includes(k)) ||
          !validId(r.addonId) ||
          !validId(r.principalId) ||
          !validId(r.target) ||
          !validId(r.revision) ||
          typeof r.enabled !== "boolean" ||
          typeof r.approvalRequired !== "boolean" ||
          !Array.isArray(r.allowedTools) ||
          r.allowedTools.length > 64 ||
          r.allowedTools.some(
            (t) => !validId(t) || !OPERATION_BUILTIN_TOOLS.has(t),
          ) ||
          new Set(r.allowedTools).size !== r.allowedTools.length ||
          !Number.isSafeInteger(r.timeoutMs) ||
          Number(r.timeoutMs) < 100 ||
          Number(r.timeoutMs) > 3600000 ||
          !Number.isSafeInteger(r.maxToolCalls) ||
          Number(r.maxToolCalls) < 0 ||
          Number(r.maxToolCalls) > 100 ||
          (r.parentWorkId !== undefined && r.parentWorkId !== null && !validId(r.parentWorkId))
        )
          throw new Error("Invalid operation grant.");
        if (r.allowedTools.length && Number(r.maxToolCalls) === 0)
          throw new Error(
            "Tool-enabled operation grants require a positive tool-call cap.",
          );
        const key = JSON.stringify([r.addonId, r.principalId, r.target]);
        if (seen.has(key))
          throw new Error("Duplicate operation principal/target grant.");
        seen.add(key);
        return structuredClone(r) as unknown as ConfiguredOperationGrant;
      });
    },
  };
}
const schema = registerDomainConfig({
  domain: "operations",
  fields: {
    enabled: boolField({
      key: "enabled",
      owner: "runtime/addon-operations",
      defaultValue: false,
      persistence: "json-config",
      precedence: ["persisted", "default"],
      secretClass: "none",
    }),
    grants: grantsField(),
  },
});
export function readOperationsConfig(
  configPath = getConfigPath(),
): OperationsConfig {
  return readDomainConfig(schema, {
    configPath,
  }) as unknown as OperationsConfig;
}
