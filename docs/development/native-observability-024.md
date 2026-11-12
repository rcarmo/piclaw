# Native Observability 0.1.24 integration

This companion change connects the existing native SDK and host model transport to Observability0.1.24. It does not own execution, results, cancellation, retries or spending.

## Resource contract

- The approved add-on exports `createNativeTelemetryContext()` and `shutdownObservabilityRuntime()` in addition to its existing configuration, preparation and prompt exports.
- `HarnessOptions.telemetry` receives the SDK-compatible context. SDK phase/submission traces, metrics and opaque trace-parent links remain SDK-owned.
- The JSON model bridge still discards caller-provided telemetry callbacks. The host transport gets a separate context from its trusted `HostModelPolicy.captureTelemetry` resource callback. Observer unavailability cannot deny a model request. The private SDK and host request trace roots remain distinct.
- Close the SDK and finish usage reporting before draining the observer. Startup failure cleanup also drains the observer. No request or tool is replayed.
- The same loaded-source and export-identity checks apply to both new methods. The source profile includes the add-on's native adapter; no integrity exemption is added.

## Verification

Focused tests use an explicit disposable pre-publication fixture: the previously approved add-on source set with only Observability replaced by candidate0.1.24. The test fixture is not a published release or a complete native-gate receipt.

- Actual SDK Harness emits phase/submission spans through the real OTel adapter without prompt content.
- Real default factory starts, executes, reopens and closes with the candidate installed.
- Host model transport receives only the trusted host context; private-island callbacks do not cross the JSON bridge. A failed observer does not deny execution.
- Engine types and the existing retained-source witness pass.

## Release verification

Add-ons#239 is merged as2f8b60eb442a0df237c78203b020e94d6a1604f1. Core pins the0.1.24 source profile, catalog snapshot, archive checksum and frozen dependency closure. The other six default archive pins remain unchanged.

Before merging or deploying an integration candidate:

1. Acquire the actual public0.1.24 archive and verify its backend/web bytes against the qualified source. Its checksum must match the pinned candidate; otherwise refresh the pins and rerun qualification. A local packed artifact alone is not public publication evidence.
2. Provision and freeze the immutable source/dependency fixture, then run every required exact-head host/native/package gate. Preserve interrupted, failed and complete receipts separately.
3. Review with the separate source-failure/install-preflight fix in Core#1993. Do not hot-install0.1.24 into a running Core whose source policy requires0.1.22.

No live package, settings, credentials, history or service changes are needed for source qualification.
