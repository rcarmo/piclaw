import { createHash } from "node:crypto";
import { getProviderDefs } from "../../../src/agent-control/provider-defs.js";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const manifest = JSON.parse(readFileSync(fileURLToPath(new URL("../package.json", import.meta.resolve("@earendil-works/pi-ai"))), "utf8"));
if (manifest.version !== "1.5.1") throw new Error("Exact public pi-ai inventory target required");

let networkRequests = 0;
const deny = () => { networkRequests++; throw new Error("Inventory network forbidden"); };
globalThis.fetch = Object.assign(deny, { preconnect: deny }) as typeof fetch;
const { builtinProviders } = await import("@earendil-works/pi-ai/providers/all");
const sdkFileSha256 = { "providers/all.js": createHash("sha256").update(readFileSync(fileURLToPath(new URL("providers/all.js", import.meta.resolve("@earendil-works/pi-ai"))))).digest("hex") };

// Metadata only. Do not call login, refresh, resolve, check or provider inference.
const providers = builtinProviders().map(provider => ({
  id: provider.id, name: provider.name,
  apiKeyLogin: typeof provider.auth.apiKey?.login === "function",
  apiKeyResolve: typeof provider.auth.apiKey?.resolve === "function",
  oauthLogin: typeof provider.auth.oauth?.login === "function",
  oauthRefresh: typeof provider.auth.oauth?.refresh === "function",
  oauthToAuth: typeof provider.auth.oauth?.toAuth === "function",
})).sort((a, b) => a.id.localeCompare(b.id));
const customProviders = getProviderDefs().filter(provider => provider.isCustom).map(provider => {
  const requiresApiKey = provider.customFields?.some(field => field.key === "apiKey" && field.required) ?? false;
  return { id: provider.id, authMode: requiresApiKey ? "custom_api_key" : "custom_no_key", requiresApiKey };
});
console.log(JSON.stringify({
  version: manifest.version, gitHead: "dd30101cfc5b0609411dd80b6f93adbc14db14cf",
  source: "public_builtinProviders_auth_definitions", methodsExecuted: false,
  providers, customProviders, networkRequests, sdkFileSha256,
  externalIdentityRoutes: [
    { provider: "amazon-bedrock", route: "bearer_token_aws_profile_or_credential_chain", owner: "provider_api_key_setup", evidence: "source_annotation_not_auth_execution", source: "@earendil-works/pi-ai/dist/providers/amazon-bedrock.js" },
    { provider: "google-vertex", route: "api_key_ADC_or_service_account_file", owner: "provider_api_key_setup", evidence: "source_annotation_not_auth_execution", source: "@earendil-works/pi-ai/dist/providers/google-vertex.js" },
    { provider: "azure-openai", route: "optional_piclaw_api_key_or_managed_identity", owner: "optional_provider_bootstrap", evidence: "source_annotation_not_auth_execution", source: "runtime/src/runtime/provider-bootstrap.ts;runtime/extensions/integrations/azure-openai.ts" },
    { provider: "azure-foundry", route: "optional_piclaw_api_key_or_managed_identity", owner: "optional_provider_bootstrap", evidence: "source_annotation_not_auth_execution", source: "runtime/src/runtime/provider-bootstrap.ts;runtime/extensions/integrations/azure-openai.ts" },
  ],
}, null, 2));
