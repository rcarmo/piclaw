# Earendil 1.6.0 qualification

The Root and private engine use separate physical dependency graphs pinned to Earendil 1.6.0. Upstream [v1.6.0](https://github.com/earendil-works/pi/releases/tag/v1.6.0) is `faac585884ae2c013a6b1400f3e9e77f10b34bac`. OpenAI remains pinned to 7.52.0. No SDK files are patched.

## Host adjustments

- The optimiser receipt recorder preserves the new `executeTool({wait: false})` handle and task ID, without awaiting or reissuing the effect. It records terminal evidence only when the caller observes a result through the original handle. The existing waiting path retains the complete script value.
- Private startup now includes `pi-mcp` in the exact-version checks. The versioned private provenance manifest verifies the installed package payloads against the registry archives and lock. The 1.5.2 private receipt remains historical.
- The unused legacy session-affinity compatibility wrapper is removed. The task/source adapter remains: the public SDK still does not supply the exact task/checkpoint scope Core uses to bind model and tool requests to accepted sources. The usage-provenance adapter still distinguishes absent cache counters and provider-reported cost from local estimates. Neither is an alternative executor.

## Evidence

Current Root package and public exports, CLI, inventory and synthetic OAuth measurements are under `docs/design/earendil-agent-harness-integration-adr/evidence/receipts/earendil-160-*`. The package producer verifies archive digests and decoded registry attestation subjects; it does not independently verify attestation signatures. Current closed-network OAuth checks exercise only synthetic credentials and fixtures. Retain the 1.5.2 receipts unchanged.

Generate public dependency evidence with `bun scripts/qualification/pi160/generate-current-contracts.ts --allow-network` in a provisioned checkout. Run `finish-auth-160.ts`, `measure-auth-methods.ts` and `measure-cli-remaining.ts` from the same directory through `test:local`. Browser and CLI mock OAuth measures require a disposable loopback-only network namespace with the existing privilege-drop guards. For the private package evidence use `bun qualification/native/src/provenance.ts --record` after installing the frozen private graph. Unit and native qualification run through `make ci-full` after provisioning the exact contract add-on checkouts.

An isolated source or package pass is not approval to replace a running instance's pinned add-on and SDK paths. Coordinate the production graph as a set; do not hot-update source files under a running owner.
