# A2A retirement

A2A support and its exclusive Core operations service have been removed at the user's request. The add-on was optional and was the only production consumer of `runtime.operations.register()`.

## Removed

- The `piclaw-addons/addons/a2a` package: extension/runtime entries, HTTP/SSE server and client, discovery/cards, authentication, push delivery/receiver, task stores, settings pane, skills, vendored protocol and tests.
- Catalogue entries, aggregate package registrations, standalone-import/Settings cases and the add-ons repository's direct `@a2a-js/sdk` and `jose` dependencies.
- Core's operations registration API, principal/grant configuration, service, database writer/read-lifecycle APIs, startup/recovery hooks and AgentPool add-on-operation ports.
- The exclusive native add-on background executor, input-sequence continuation and receipt-reconciliation adapters, plus the old operation-session profile and API guides.

There is no disabled feature flag, compatibility API or replacement operations service. Arbitrary external package installation remains a generic add-on capability; it does not restore the removed Core API.

## Retained

- Normal SDK conversations, queue/steering, Delegate and Remote Peer.
- Dream's direct SDK execution path, with model/source/tool/deadline guards, private context identity and immutable input checks. See [Dream mapping review](dream-durable-mapping-review.md).
- Historical schema/migration bytes and stored task, event, source, SDK and payload records. The remaining retired-origin decoder serves integrity inspection of historical records; it grants no execution authority. Fresh background payload creation accepts Dream only.
- Dated qualification and inventory receipts. Their old paths and hashes describe historical source, not a supported interface.

If a stored retired add-on context contains unfinished native tasks, submissions or accepted host work, startup refuses before SDK scheduling. It does not cancel, settle, clear or replay that work. Operator reconciliation requires separate approval. Completed historical contexts remain readable.

No live add-on installation, configuration, database, task history or running service was changed. Removing source does not uninstall an older package from an existing profile. Do not deploy the changed source over an installation with unresolved retired work without a separate operational plan.

Focused verification passed: 130 Core tests/844 assertions in 12 files, all 25 selected isolated native files, root and both private type projects, and 34 add-ons removal/remaining-standalone-import checks. Public-SDK-created historical A2A cases prove completed history remains readable and unfinished task/submission/source work refuses startup without writes or replay. Catalogue validation, the four remaining add-on compatibility type projects and package dry-run passed; no A2A package paths remain in the archive inventory.

The shared add-ons Settings inventory assertion has a separately reproduced baseline gap: Code Review, Late Night Regrets and Restic registrations are omitted from its pane list. The assertion was not weakened or skipped, and those panes were not changed. Earlier receipts and the failed baseline run remain available. No complete Settings/browser or full-suite result is claimed.
