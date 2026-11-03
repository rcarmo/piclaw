# Native usage reports

The host request boundary owns actual-call identities, reservations and accounting events. Event-linked `token_usage` rows are reporting projections. The remaining native and scheduled budget enforcement reads settled usage through `runtime/src/budget/usage-total.ts`; the general budget Settings projection and management routes have been removed under #1881.

## Identities and valuations

| Record | Identity and authority |
|---|---|
| Actual host request | Fresh host UUID per physical invocation, including a recovery resend. The captured binding fixes work, chat, provider, model and account generation. |
| Reservation | `budget_request_reservations.id`; its binding hash, state and settlement hash retain host admission, uncertain expense and settlement evidence. |
| Usage event | `usage:invocation:<host UUID>` for an actual host request. `budget_usage_events` fixes the original work/chat/time and API-equivalent valuation. |
| SDK execution usage | Immutable public SDK entries and their generation/compaction outcomes. Verified assistant receipts feed Goal token accounting. They are not added again to host request reports. |
| Recorder event | Existing invocation, session-entry or fingerprint identity. `recorder_event` provenance does not establish a physical host request. |
| Unlinked history | Legacy `token_usage` rows without event identity remain historical evidence. No request ID is invented for them. |

`provider_cost_total`, including explicit zero, takes precedence in displayed `cost_total`. The original catalogue total and cost provenance remain separate. Budget API-equivalent USD uses the captured category costs. A provider-reported zero does not establish a free API valuation or release an uncertain reservation. Current catalogue prices never replace a stored provider valuation.

The native boundary preserves provider-cost, reasoning/cache-reporting and pricing metadata when available. Compaction reports carry `usage_source=compaction`; execution work remains `side_prompt`. Parent, Delegate, scheduled and side-prompt ancestry stays host-owned.

## Event payload and atomicity

The existing event has two additional columns: `report_payload_json` and `report_payload_sha256`. Version 1 contains the complete 37-column report record, execution kind and origin. SHA-256 binds the exact UTF-8 JSON bytes. `host_request` origin also binds the request ID and original binding/settlement hashes. No second event table, cost aggregate or execution engine is introduced.

Actual settlement commits the payload, report row, accounting event and reservation transition in one synchronous transaction. A storage fault rolls back the whole settlement. Replaying a settled request still requires the exact original settlement hash; it can repair the report from stored event bytes. A parent/tool observation cannot replace the original owner, attribution or valuation. Repeated correct projections perform no UPDATE.

A recreated accounting callback reads the original host accounting time from its settled event. Pre-cutover model settlements use the explicit original field mapping, then verify the unchanged settlement hash. New metadata cannot rewrite an older payload or upgrade its provenance.

Unknown dispatched outcomes retain their holds across cancellation, calendar rollover and report cleanup. Unknown valuation does not manufacture a settled report. Missing settled-event evidence blocks capacity conservatively. Requests without stored account/cost-bound evidence retain the existing unsupported/uncapped path; enabled native caps still deny that path.

## Upgrade and reconciliation

Owned migration `host.usage-reports/event-payload-v1` adds the columns. It captures matching existing report rows as `legacy_projection_capture` with capture time. Those bytes have weaker provenance than an original request receipt. Existing event columns, numeric IDs, reservations and settlement hashes remain unchanged. Missing, malformed or mismatched old report payloads stay unavailable. Reopen never recaptures corrected cache values.

Column migration, temporary removal of the immutable UPDATE trigger, legacy capture, receipt and trigger restoration share one synchronous writer transaction. A fault restores the old schema, trigger and evidence. Owned schema/receipt drift, partial or unowned columns and temporary shadows fail without adoption. Other migration receipts and SQLite version markers retain their owners.

`reconcileUsageReports(database, { after?, limit? })` is an explicit observation-repair API. The default page is 100 events; the maximum is 1000. It returns projected/unavailable counts and an opaque next cursor. It changes no request, work or event evidence and performs no provider submission. A malformed payload or occupied projection identity rolls back the page. Lost rows recover their original numeric FK identity; another row is never adopted to hide a conflict.

Existing chat routing is a retained display-projection exception. Repair preserves a present row's moved chat. A missing row recovers the event's original chat; later routing is not fabricated. Routing normalisation remains #1693.

## Retention, cost and recovery

Linked reports remain mandatory numeric FK parents for immutable accounting events. Event-ID or reservation references also protect displaced and pre-ledger observations. Report pruning, archived purge, Dream cleanup and orphan-chat cleanup retain them. Unlinked historical rows retain their existing retention policy and legacy valuation fallback. Native settled usage always comes from event evidence; displaced/duplicated report identities cannot add the same native charge twice.

A host-request payload semantically references its reservation binding and settlement proofs. Keep that evidence while report reconstruction/replay needs it. Reporting cleanup cannot retire work, release a reservation or erase billing evidence. Global owner-specific retirement remains #1702.

Storage adds one full report JSON and one 64-character hexadecimal digest per eligible event. Legacy cutover scans eligible events and writes their payloads under one writer transaction. Bounded reconciliation limits each repair transaction. No automatic reconciliation schedule or cleanup is enabled.

The main SQLite database carries all state and receipts; no sidecar is needed. A rollback uses a validated matching database/runtime checkpoint. Executable-only downgrade is unsupported: old readers would restore mutable-report accounting semantics. Do not remove receipts or payload columns to force recapture. Source delivery does not authorise installation, deployment, live schema changes, restore or replay.
