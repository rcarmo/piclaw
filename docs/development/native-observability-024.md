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

## Release blocker — do not merge or deploy this draft

The approved source profile in this draft expects Observability0.1.24, while Core's published/default seed still contains0.1.22. After the add-on PR is approved, merged and published:

1. Acquire the actual public0.1.24 archive and verify its backend/web bytes against the qualified source.
2. Update only Observability's Core catalog snapshot, archive checksum, version and frozen file-dependency integrity. Keep the other approved add-ons unchanged.
3. Pin a real immutable add-on Git revision, provision the frozen dependency graph, and run the complete exact-head host/native/package gate.
4. Review with the separate source-failure/install-preflight fix in Core#1993. Do not hot-install0.1.24 into a running Core whose source policy requires0.1.22.

No live package, settings, credentials, history or service changes were made by this source audit.
