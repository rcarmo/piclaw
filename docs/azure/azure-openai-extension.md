# Azure OpenAI extension

> **Status:** experimental
>
> The bundled `runtime/extensions/integrations/azure-openai.ts` extension adds Azure OpenAI and Azure AI Foundry support to piclaw. Its configuration and internal APIs may still change between releases.

The extension ships Azure OpenAI features, provider registration rules, and Azure-specific runtime safeguards.

## Capabilities

### Azure OpenAI provider

Registers an `azure-openai` provider that routes Azure text models through the **Responses API**.

Key capabilities:

- managed-identity auth via Azure IMDS
- optional static API-key mode
- GPT-5 reasoning support
- streaming output
- tool calling
- model-specific request shaping and safeguards
- cross-model and cross-provider replay cleanup

### Azure AI Foundry provider

Registers an `azure-foundry` provider for Foundry text and image models.

Key capabilities:

- custom provider registration separate from Azure OpenAI
- completions-based text routing for Foundry text models
- image-generation support for Foundry image models
- shared token acquisition path and cache behavior

### Image commands

Adds workspace-backed image commands:

- `/image`
- `/flux`

Features:

- writes generated files to the workspace
- renders inline previews in the timeline
- supports transparent PNG output for `/image` when the Azure OpenAI image model accepts it
- normalizes requested sizes to provider-supported values

---

## Azure OpenAI features implemented here

### 1. Safe provider registration

The extension uses **custom API names** instead of overriding the global OpenAI handlers.

Custom API names:

- prevent collisions with other providers
- avoid breaking providers such as GitHub Copilot
- keep Azure routing explicit per model

Rules:

- Azure OpenAI models use `azure-openai-responses-mi`
- Foundry text models use `azure-foundry-openai-completions-mi`
- do **not** register this extension as `openai-responses` or `openai-completions`

### 2. Managed-identity-first auth

The extension is designed for Azure environments that can obtain tokens from IMDS.

Supported auth modes:

- **managed identity** by default
- **static API key** when `AOAI_API_KEY` is set

It also maintains a local token cache with refresh skew to avoid unnecessary token fetches.

### 3. Azure Responses streaming

For Azure OpenAI text models, the extension streams via the Responses API and applies Azure-specific request shaping.

This includes:

- text-output forcing so the model returns normal text output, not only reasoning items
- reasoning-effort mapping from piclaw thinking levels
- `prompt_cache_key` seeding from the active session id
- tool-call replay cleanup for Azure validation rules
- request summaries for debugging failed streams

### 4. GPT-5 reasoning support

The extension maps piclaw reasoning controls onto Azure-compatible request fields.

Behavior:

- supports reasoning-enabled GPT-5-family models
- recognizes `gpt-5.6` plus the `gpt-5.6-luna`, `gpt-5.6-sol`, and `gpt-5.6-terra` variants as 1.05M-context, 128K-output reasoning models
- clamps unsupported reasoning levels when necessary
- can disable reasoning globally or per model with env flags
- caps reasoning for known unstable tool-heavy model flows
- clamps `max_output_tokens` to the estimated remaining context window, keeps a 4,096-token safety margin, and preserves the Responses API minimum of 16 output tokens

### 5. GPT-5.3 Codex phase replay

Some GPT-5.3 Codex responses include output-item phase metadata. The extension captures and replays that metadata so follow-up turns preserve continuity.

This is mainly relevant for:

- long multi-step coding sessions
- replay after tool use
- model switching back into GPT-5.3 Codex

### 6. Azure-specific tool-call sanitization

Azure validates replayed tool-call history more strictly than other providers.

The extension compensates for that by:

- normalizing tool-call IDs
- sanitizing `id` / `call_id` fields to Azure-safe formats
- removing provider-specific IDs that become invalid after replay
- filling missing `function_call.arguments` with valid JSON text

This avoids silent stream failures caused by replay artifacts when switching providers or compacting history.

### 7. Strict tool-schema sanitization

Azure validates tool parameter schemas more strictly than OpenAI and Anthropic.

Before sending tool definitions, the extension fixes common schema issues such as:

- `type: "array"` without `items`
- nested schema branches that need the same fix

This is applied recursively so Azure does not reject otherwise-valid tool surfaces that other providers tolerate.

### 8. Tool-history trimming and summarization

Azure requests can fail when too many historical tool calls are replayed.

The extension proactively trims older tool history and replaces it with a compact assistant summary.

Current protections:

- cap historical tool calls before send
- optionally dedupe repeated `tool_output_search` calls
- preserve continuity with a synthetic summary message
- use Azure-safe message IDs for that summary

### 9. Proactive input-budget guard

The extension applies a **preflight size guard** before sending Azure requests. It estimates request size and trims older tool history when the reconstructed input is too large.

Budget selection is source-aware:

- when live deployment TPM data is available, the default replay ceiling is 65% of that TPM allowance, bounded by the model's usable context
- when live TPM data is unavailable or only a baked-in fallback exists, the extension uses the registered model context instead of collapsing a long-context model to a stale 65K-style replay limit
- the context-aware fallback defaults to 900,000 input tokens and reserves up to 65,536 tokens for output
- `AOAI_ABSOLUTE_INPUT_TOKEN_CAP` is the conservative fallback for models without a known context window

Why this exists:

- long agent turns replay the full conversation repeatedly
- Azure throttling is token-budget-based
- reducing oversized tool history before send is safer than retrying after a throttle event

### 10. Throttle-aware retry behavior

Azure streaming failures do not always look like normal HTTP throttling.

In some cases, the stream fails with:

- `response.failed`
- `error: null`
- empty output

The extension treats that pattern as likely token-budget exhaustion. For request failures before or while opening the stream, it retries `408`, `409`, `425`, `429`, `500`, `502`, `503`, `504`, and `524`, plus known socket-close and `ResourceExhausted` errors. It does **not** retry other client errors.

Retry behavior:

- at most two retry attempts per Azure Responses request
- honors `Retry-After` in either integer-seconds or HTTP-date form
- otherwise waits 15 seconds for rate-limit/503 failures and uses a short increasing delay for other transient failures
- emits user-visible retry feedback after streaming has started
- names both the model and deployment when `AOAI_DEPLOYMENT_NAME_MAP` maps them differently
- surfaces an explicit retry-budget-exhausted error instead of an empty response

### 11. User-visible retry feedback

When Azure throttling or another retryable transient failure is detected, the extension streams a short temporary status note into the active reply.

Examples:

- `Azure rate limit hit — waiting 15s before retry…`
- `Request failed — retrying in Ns…`

This prevents the chat from appearing silently hung during backoff.

### 12. Workspace-friendly image output

Generated images are formatted for normal piclaw usage rather than raw API output.

The extension:

- saves images into the workspace
- returns timeline-friendly output with previews and file paths
- keeps `/image --transparent` on the Azure OpenAI image path
- keeps `/flux` separate, without transparent-background support

---

## Providers registered

### Azure OpenAI

- **Provider ID:** `azure-openai`
- **API name:** `azure-openai-responses-mi`
- **Base URL env:** `AOAI_BASE_URL`
- **Model list env:** `AOAI_MODEL_IDS`

### Azure AI Foundry

- **Provider ID:** `azure-foundry`
- **API name:** `azure-foundry-openai-completions-mi`
- **Base URL env:** `FOUNDRY_BASE_URL`
- **Model list env:** `FOUNDRY_MODEL_IDS`

---

## Important guardrails

- Do **not** use `openai-responses` or `openai-completions` as this extension's API names.
- Always set each Azure model's `api` to the custom Azure API name.
- Do **not** manually inject `Authorization` or `api-key` headers on top of the OpenAI SDK client.
- Managed-identity resource values must match the target Azure resource.
- Do not remove tool-call ID sanitization or replay cleanup.
- Do not remove tool-schema sanitization unless upstream tool schemas are guaranteed Azure-clean.

---

## Configuration

### Required Azure OpenAI settings

- `AOAI_BASE_URL` — accepts Azure OpenAI/Cognitive Services/modern Foundry host roots such as `https://name.openai.azure.com`, `https://name.cognitiveservices.azure.com`, or `https://name.services.ai.azure.com`, plus `/openai` and `/openai/v1` forms. Azure host roots are normalized to `/openai/v1` before the OpenAI SDK appends `/responses`.
- `AOAI_MODEL_ID` or `AOAI_MODEL_IDS`

### Optional Azure OpenAI settings

- `AOAI_API_KEY`
- `AOAI_MODEL_NAME` / `AOAI_MODEL_NAMES`
- `AOAI_IMAGE_MODEL_ID`
- `AOAI_RESOURCE`
- `AOAI_TOKEN_CACHE_DIR`
- `AOAI_TOKEN_CACHE_FILE`
- `AOAI_TOKEN_SKEW_SECONDS`
- `AOAI_API_VERSION`

### Optional behavior flags

| Variable | Default | Purpose |
|---|---:|---|
| `AOAI_DISABLE_TOOLS` | unset | Disable tools on Azure requests |
| `AOAI_DISABLE_REASONING` | unset | Disable reasoning globally |
| `AOAI_DISABLE_REASONING_MODELS` | empty | Comma-separated model ids that must not use reasoning |
| `AOAI_LOG_PHASES` | unset | Log phase replay/persistence details |
| `AOAI_MAX_TOOL_CALLS` | model-dependent | Cap replayed historical tool calls |
| `AOAI_TOOL_CALL_SUMMARY_MAX` | runtime default | Bound the synthetic tool-history summary |
| `AOAI_TOOL_CALL_OUTPUT_CHARS` | runtime default | Bound retained tool-output characters |
| `AOAI_DEDUPE_TOOL_OUTPUT_SEARCH` | unset | Dedupe repeated `tool_output_search` history |
| `AOAI_MAX_TPM_SHARE` | `0.65` | Maximum share of **live** deployment TPM used by one reconstructed input; clamped to 0.10–0.95 |
| `AOAI_ABSOLUTE_INPUT_TOKEN_CAP` | `120000` | Conservative fallback input cap for models without known context metadata; minimum 16,000 |
| `AOAI_CONTEXT_AWARE_INPUT_TOKEN_CAP` | `900000` | Upper bound for long-context fallback budgeting; never lower than the absolute cap |
| `AOAI_CONTEXT_OUTPUT_RESERVE` | `65536` | Output headroom reserved when deriving the context-aware input budget; minimum 16,000 |
| `AOAI_DEPLOYMENT_NAME_MAP` | empty | Optional comma-separated `model=deployment` mappings, for example `gpt-5.6=prod-gpt56,gpt-5.4=prod-gpt54` |

`AZURE_OPENAI_DEPLOYMENT_NAME_MAP` is still accepted as a compatibility alias for `AOAI_DEPLOYMENT_NAME_MAP`.

### Foundry settings

- `FOUNDRY_BASE_URL` — for OpenAI-compatible text models, accepts the same Azure host root and `/openai/v1` forms as `AOAI_BASE_URL`; non-Azure proxy paths are preserved.
- `FOUNDRY_MODEL_IDS`
- `FOUNDRY_MODEL_NAMES`
- `FOUNDRY_IMAGE_MODEL_ID`
- `FOUNDRY_API_VERSION`
- `FOUNDRY_IMAGE_BASE_URL`
- `FOUNDRY_IMAGE_API_VERSION`
- `FOUNDRY_RESOURCE`

---

## User-facing commands

### Image generation

- `/image <prompt> [--size ...] [--count ...] [--quality low|medium|high] [--style natural|vivid] [--transparent]`
- `/flux <prompt> [--size ...] [--count ...] [--quality low|medium|high]`

Notes:

- Default quality is **`medium`** (changed from `high` on 2026-04-20 to avoid Azure S0 tier rate limits).
- `/image --transparent` requests transparent PNG output on the Azure OpenAI image path.
- `/flux` does not support transparent background requests.
- Error messages and generation status are delivered via `pi.sendMessage()` directly so they appear in the correct chat branch. Earlier versions used an HTTP internal-post endpoint that defaulted to the root chat JID and silently dropped messages in branch sessions.

---

## Common Azure-specific failure modes

### Silent streaming throttle/exhaustion

Symptoms:

- `response.failed`
- `error: null`
- empty output

Typical cause:

- the request consumed too much of the model deployment's token-per-minute budget

Mitigations in this extension:

- proactive input-budget trimming
- longer retry backoff
- user-visible retry feedback

### Silent validation failure

Typical causes:

- invalid tool schema
- missing `function_call.arguments`
- oversized or invalid replayed tool history
- unsupported request fields

Mitigations in this extension:

- schema sanitization
- argument sanitization
- tool-history cleanup
- Azure-safe ID normalization

### Missing output text

Typical cause:

- the request did not force normal text output formatting

Mitigation:

- the extension injects a text format block for Azure Responses requests

---

## Harness and upstream Responses notes

### Harness surfaces

Development validation uses:

- `runtime/scripts/azure-openai-harness.ts`
- `runtime/extensions/experimental/azure-openai.harness.ts`
- `runtime/src/extensions/azure-openai-api.ts`

The harness bundles to:

- `/workspace/piclaw/.tmp/azure-openai.harness.bundle.mjs`

This keeps Bun from resolving dependencies from `/workspace/node_modules` instead of this repo's `node_modules` tree.

### Request/session correlation status

The live Azure extension now mirrors the active session id into:

- `prompt_cache_key`
- `session_id`
- `x-client-request-id`

for Azure Responses requests on the supported path.

Historical live Azure harness runs on the `0.67.2` stack were validated for:

- models: `gpt-5-3-codex`, `gpt-5-4`
- cases: `json`, `tool`, `history`

Representative reports:

- `/workspace/tmp/azure-openai-harness-0672-gpt53.json`
- `/workspace/tmp/azure-openai-harness-0672-gpt54.json`

The harness now checks these invariants automatically and fails if:

- `prompt_cache_key` drifts from the active session id where required
- `session_id` / `x-client-request-id` drift from the active session id
- replayed request payloads still contain leaked `partialJson` scratch buffers

Optional Azure-native request-id mirroring is still available in the harness via:

- `AOAI_EXPERIMENT_AZURE_CLIENT_REQUEST_ID=1`

and also passed focused `json` / `tool` / `history` validation on `gpt-5-3-codex`:

- `/workspace/tmp/azure-openai-harness-0672-gpt53-xms.json`

### Earendil compatibility

The runtime pins `@earendil-works/pi-ai`, `@earendil-works/pi-agent-core`, and `@earendil-works/pi-coding-agent` to `0.87.1` in `package.json`. Piclaw keeps its Azure transport wrapper because Azure needs stricter replay sanitation, context-aware output clamping, request/session correlation, and retry handling than the generic Responses path supplies.

The runtime currently behaves as follows:

- the shared Responses parser strips `partialJson` scratch buffers when finalizing tool calls and on error paths
- Piclaw adapts Azure `reasoning_text` and commentary-phase events into normal thinking updates, including reasoning-token usage
- deterministic coverage verifies output-token clamping, session correlation, retryable status classification, `Retry-After` parsing, deployment-name mapping, and final error text
- focused coverage lives in `runtime/test/extensions/azure-openai-api.test.ts`, `azure-openai-retry-after.test.ts`, and `azure-openai-routing.test.ts`
- the `0672` paths record historical live-provider runs; those files are not shipped with the repository and were not regenerated for the current pinned runtime

## Troubleshooting checklist

1. Confirm the model is routed through the Azure custom API name, not a global OpenAI handler.
2. Confirm auth mode and resource configuration are correct.
3. If a stream fails silently, compare request size to deployment TPM limits.
4. If needed, replay the same payload non-streaming to get a clearer validation error.
5. Check stream logs for request summaries, tool-call counts, and trim behavior.
6. If failures persist, reduce replayed tool history or raise deployment capacity.

Useful log filter:

```bash
journalctl --user -u piclaw.service --no-pager | rg "azure-openai\] Stream"
```

---

## Source files

- `runtime/extensions/integrations/azure-openai.ts`
- `runtime/src/extensions/azure-openai-api.ts`
- `runtime/src/utils/azure-tool-call-limit.ts`

---

## Separate integration layer

Piclaw keeps this as a separate integration layer because Azure needs extra behaviour beyond the generic OpenAI path:

- safe provider registration
- managed-identity auth
- Responses API streaming
- GPT-5 reasoning support
- Codex phase replay
- tool-call and schema sanitization
- proactive history trimming
- token-budget-aware request shaping
- throttle-aware retries
- workspace-friendly image output
