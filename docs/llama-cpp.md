# llama.cpp router integration

Piclaw can use a local `llama.cpp` OpenAI-compatible server or router through the **llama.cpp router** provider preset in `/login`.

Piclaw currently configures llama.cpp routers through `/login`. It does not implement upstream Pi's `/llama` Hugging Face search, download, load, or unload workflow.

## Requirements

Run `llama-server` or a compatible router with the OpenAI-compatible API enabled. The default Piclaw preset expects:

```text
http://127.0.0.1:8080/v1
```

If Piclaw runs in a container, use a host/container-reachable address instead of `127.0.0.1`.

## Configure from the web UI

1. Open the Piclaw web UI.
2. Type `/login`.
3. Choose **llama.cpp router**.
4. Select **Configure provider**.
5. Fill in:
   - **Base URL**: for example `http://127.0.0.1:8080/v1`
   - **Model ID**: the model name exposed by the router, for example `local-model`
   - **Additional model IDs**: optional comma-separated aliases/models
   - **Context window**: optional, for example `32768`
6. Save the configuration, then pick the model from the activation card or use:

```text
/model llama-cpp/local-model
```

The preset stores model metadata in `~/.pi/agent/models.json` and reloads the runtime immediately.

## Equivalent `models.json`

```json
{
  "providers": {
    "llama-cpp": {
      "baseUrl": "http://127.0.0.1:8080/v1",
      "api": "openai-completions",
      "models": [
        {
          "id": "local-model",
          "name": "local-model",
          "contextWindow": 32768,
          "compat": {
            "supportsStore": false,
            "supportsStrictMode": false,
            "supportsDeveloperRole": false,
            "supportsReasoningEffort": false,
            "supportsLongCacheRetention": false,
            "maxTokensField": "max_tokens"
          }
        }
      ]
    }
  }
}
```

## Notes

- The preset uses `openai-completions`, matching llama.cpp’s OpenAI-compatible chat/completions API.
- No API key is required by default. If your router requires one, use the generic **OpenAI-compatible** provider instead.
- The compatibility flags avoid hosted-provider assumptions that local routers often do not implement.
- The `llama-cpp` provider preset is treated as a local-lite prompt target by Piclaw’s prompt-profile extension, even when the router URL is not local. This keeps startup prompts compact for local GGUF models without changing SDK tool availability.
