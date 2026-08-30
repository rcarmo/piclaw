# Compaction models and deadlines

Piclaw owns smart-compaction lifecycle, model selection, and the hard wall-clock deadline. Provider SDK timeouts and HTTP idle timeouts are lower-level request controls; they should not be used as competing compaction deadlines.

## Settings

| Setting | Default | Scope | Meaning |
|---|---:|---|---|
| `domains.compaction.model` | empty | Local smart compaction | Canonical `provider/model`. Empty uses the active conversation model. |
| `domains.compaction.timeoutMs` | `300000` | Entire compaction generation | One wall-clock deadline covering deterministic preparation, provider connection/prefill, streaming, validation, and abort settlement. |
| `retry.provider.timeoutMs` | provider SDK default | All provider requests | Optional provider/SDK request timeout. Local smart-compaction calls override this with the remaining Piclaw compaction deadline. |
| `httpIdleTimeoutMs` | `300000` | HTTP header/body idleness | Earendil transport idle guard. `0` disables it. This is not the Piclaw compaction deadline. |
| `domains.compaction.remoteCompactionTimeoutMs` | `300000` | Provider-native pre-pass | Separate bounded timeout for explicitly supported provider-native opaque compaction before local fallback. |

The Settings → Compaction pane exposes the local model and compaction deadline. Compatibility environment variable `PICLAW_COMPACTION_TIMEOUT_MS` still has precedence over persisted `domains.compaction.timeoutMs`, but is deprecated for removal in Piclaw 3.0. Prefer the persisted domain setting.

## Model selection

- Empty `domains.compaction.model` uses the active conversation model.
- A non-empty value must be an exact `provider/model` available through the process `ModelRuntime`.
- Explicit model selection is strict. Missing model metadata or credentials cancels compaction and preserves the session; Piclaw does not silently switch to the active model or a billable cloud provider.
- Local selective and progressive compaction size prompts/chunks against the resolved compaction model’s context window and output limits.
- Provider-native opaque compaction remains bound to the active model and verified provider capability. A separate local compaction model is used only after provider-native compaction is disabled, unavailable, or safely falls back.

Example persisted configuration:

```json
{
  "domains": {
    "compaction": {
      "model": "openai-compatible/qwen3-8b",
      "timeoutMs": 3600000
    }
  }
}
```

## Deadline ownership

At compaction start Piclaw creates one absolute deadline. Every local provider request receives the **remaining** time rather than a fresh timeout. Deterministic work checks the same deadline cooperatively. If the deadline expires, Piclaw aborts the physical compaction, waits a bounded settlement grace, and quarantines a still-running generation so another compaction cannot mutate the same session concurrently.

This prevents races such as a 10-minute provider timeout running beyond a 5-minute compaction deadline, or each progressive chunk receiving a fresh full deadline.

## Timeout diagnostics

Errors identify the stage that owned the deadline:

| Stage | Meaning |
|---|---|
| `deterministic` | Source preparation, chunk planning, validation, or final assembly before/after model calls. |
| `provider_connect` | Request creation through receipt of HTTP response headers. |
| `first_token` | Headers received; waiting for the first text or reasoning delta. |
| `streaming` | Provider output began, then stopped making progress before completion. |
| `settlement` | No more specific stage was available while the outer lifecycle deadline expired. |

Diagnostics may also include the resolved model, provider request count, first-token latency, total duration, and whether the provider failed to settle within the post-abort grace. They never include prompts, headers, credentials, or raw session content.

During a slow prefill, live status reports:

```text
waiting for first token from provider/model — 75s elapsed, 525s remaining
```

## Earendil 0.84.4 transport behavior

Earendil 0.84.4 disables undici’s former five-minute `headersTimeout` and `bodyTimeout` limits for long local-LLM streams. Provider SDK deadlines remain available through `retry.provider.timeoutMs`. Global `fetch` monkey patches or Bun `--preload` wrappers that set `timeout: false` are obsolete and should be removed.

For local compaction, Piclaw passes the remaining compaction deadline into the provider adapter. Ordinary agent requests continue to use their normal Earendil/provider settings.

## Bounded local adapter fixture

`runtime/test/extensions/delayed-openai-compaction.integration.test.ts` starts a local OpenAI-compatible SSE server and exercises the real `openai-completions` adapter. It covers delayed response headers, delayed first content, mid-stream stalls, early termination, and abort-resistant settlement with millisecond-scale delays.

Run it with:

```bash
PICLAW_DB_IN_MEMORY=1 bun test --max-concurrency=1 --timeout=15000 \
  runtime/test/extensions/delayed-openai-compaction.integration.test.ts
```

## Manual LM Studio acceptance run

Use this only when a local server is available. Do not run it against a paid provider by accident.

1. Add the local OpenAI-compatible model to `~/.pi/agent/models.json` with its real context window and local base URL.
2. Confirm the model appears in Settings → Models and credentials resolve without exposing them.
3. In Settings → Compaction:
   - set the exact local `provider/model`;
   - set a deadline longer than the expected prefill plus generation time;
   - leave provider-native compaction disabled unless that endpoint is explicitly supported.
4. Use a disposable test chat. Grow context to the target input size, then run `/compact`.
5. Record:
   - Piclaw/Earendil/Bun versions;
   - provider/model and endpoint identity without credentials;
   - input token estimate and context window;
   - configured compaction deadline;
   - response-header time if available;
   - TTFT and total duration;
   - model request count and chunk count;
   - outcome or timeout stage;
   - compaction generation/trace identifiers.
6. Verify the session remains readable after success or failure and that no emergency rotation loses authoritative work.
7. Remove any temporary model/timeout configuration after the run.

For the original #1049 workload, the acceptance target is a context near 139k input tokens with a deliberately slow local model. The expected result is either successful compaction inside the configured deadline or a stage-attributed failure that preserves the session—never an opaque five-minute fetch timeout.
