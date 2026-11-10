# Pi1.5.1 qualification — historical snapshot

This records the1.5.1 qualification at Core commit1f4149440. Its receipts remain unchanged. Current executable probes and delivery qualification moved to [Pi1.5.2](pi-1.5.2-qualification.md); use the historical commit to reproduce the commands below.

The Root SDK loop contains nine packages, including the SDK-owned `pi-schema` dependency. The private durable engine keeps its separate exact-pinned graph. Historical1.4.0 receipts and dependency graphs remain unchanged.

## Measure current packages

Use an owned checkout with its frozen1.5.1 dependencies. These commands do not install packages or modify dependency graphs. The first command explicitly permits public registry/archive/attestation reads and rewrites the current dependency manifest plus new151 receipts.

```sh
export PICLAW_LOCAL_TEST_NICE=19
export TMPDIR=/workspace/tmp/piclaw/tests
bun run test:local -- bun scripts/qualification/pi151/generate-current-contracts.ts --allow-network
bun run test:local -- bun runtime/test/agent-control/fixtures/provider-auth-inventory-151.ts
bun run test:local -- bun scripts/qualification/pi151/finish-auth-151.ts
```

Save the inventory command's JSON as `runtime/test/agent-control/fixtures/provider-auth-inventory-151.json` after checking the exact version, `methodsExecuted:false` and zero network requests. It records43public provider definitions. The finish command consumes that file and the verified current dependency manifest.

The generator checks published archive SHA1/SRI, manifests, full installed/archive payload equality, public export bytes and decoded SLSA subject/ref/commit. The public1.5.1 tag is `dd30101cfc5b0609411dd80b6f93adbc14db14cf`. Registry-served signatures are not independently verified; that limitation remains in the receipts. Published package manifests omit `gitHead`; the reference commit is recorded separately.

The finish command measures the installed CLI artifact, checks public imports under the existing offline side-effect guard, and runs the public MCP type probe. Its compile-only result does not qualify native runtime parity or activate the SDK MCP extension.

## Measure synthetic auth behaviour

```sh
bun run test:local -- bun scripts/qualification/pi151/measure-cli-remaining.ts
bun run test:local -- bun scripts/qualification/pi151/measure-auth-methods.ts
```

These measurements use disposable profiles and synthetic responses. Browser/manual-PKCE paths require Linux network namespaces, dropped privileges and loopback-only routing. Other device-method probes retain their explicit fetch-interception scope. No real provider credentials, inference, installed profile or live database is used.

Current measured coverage:

- OpenAI/Codex published CLI:10outcomes, including cancellation, denial and provider-only refusal.
- Copilot/Kimi device methods:22cases.
- Codex device methods:6cases, including real slow-down timing.
- Anthropic/OpenRouter browser methods:20cases plus17copy-code cases.

Fixture hashes bind the current published code and CLI artifact. Regeneration is a reviewed operation: check new bytes before updating those guards. Never relabel a historical receipt as a new SDK result.

## Delivery gates

These are package/auth/type measurements. Full exact-source host/features/native/UI/workload gates, current shipped add-on archive checks and financial-removal acceptance remain separate requirements. No merge, installation, restart or live-data mutation is authorised by these commands.
