# Native input and expense retirement — PR #1966 review

PR #1966 removes the Core expense execution owners and the web host queue/lifecycle owners. pi-durable 1.4 owns native input placement, execution, inbox changes and result observation. This source change is not a deployment or completion of the wider #1875/#1817/#1650 epics.

## Review corrections

- The widget state endpoint still called the deleted host queue counter. It now awaits the native inbox reader.
- `/post` parsed a cloned body before entering the shared native handler. It now enters that handler synchronously, captures its ports before JSON, and carries the original caller/database/target guards through SQL admission. Reply-thread validation stays in that boundary.
- Optional SSE publication shared the SDK-admission catch block. A publication exception could turn a confirmed SDK receipt into an unconfirmed response. Publication now has its own observational catch; the accepted receipt survives. Missing or malformed SDK receipts still return the saved-source uncertainty response without resubmission.
- Current `main` was merged into the feature branch. The Visual bundle conflict was resolved by rebuilding the merged source, retaining the attachment filename repair.

## Removed test contracts

The deleted `processChat`, queue materialiser, queue allocator, deferred controls and synthetic command/startup status owners have no compatibility fixtures. Their tests were removed. Surviving HTTP, source authority, cancellation, WAL, historical-data, context, attachment and shutdown checks were adapted to the current boundary.

The former monolithic default-runtime fixture stays deleted. Focused native fixtures exercise actual SDK submission, queued steering/removal, source/cursor acknowledgement, provider authority, Goal, side input, compaction, process close and reopen. Small HTTP/storage doubles do not claim SDK execution coverage.

The isolated application runner previously killed a child after four seconds for a five-second scenario, including process launch/import time. The child retains its original Bun scenario deadline. The parent now allows a bounded ten seconds for launch/import/join. A genuine child scenario timeout still fails its parent. The ended-stream race no longer performs an unrelated tool round trip; the before/after-source and structured-input races retain their real source-bound read.

## Verification

Initial focused verification, before A2A retirement and the direct Dream conversion:

| Check | Result |
| --- | --- |
| Web backend directory, 185 files | 1,104 passed; two existing platform/browser skips; zero failures |
| 24 focused native files, isolated parent reports | 119 passed; zero failed files or timeouts |
| Queue/receipt browser journeys, both skins, Chromium/WebKit, keyboard/touch | 14 passed |
| Source/expense/reporting seam checks, eight files | 109 passed |
| `bun run typecheck` | Passed; the compose checker retains 299 unchanged out-of-seam baseline diagnostics |
| Engine and qualification private type projects | Passed |
| `make build-ts` | Passed |
| `make build-web` | Passed; 17 build tests and 25 compressed vendor pairs |
| Local test entry-point and environment-surface checks | Passed |
| Four protected schema/connection files | No diff against current `main` |

Earlier failed and interrupted logs are preserved separately. An output-size safety limit incorrectly applied to all child files caused the 512 MiB upload fixture to fail with `EFBIG`; the unchanged fixture passed without that harness limit. No upload limit or assertion was changed. The full repository `ci-full` gate was not rerun or claimed by this focused review.

Against the integrated `main`, handwritten runtime production files change by +1,343/−6,143 lines, net −4,800. Frontend source changes by +40/−47, net −7. Generated bundles and test/qualification deletions are excluded from those production totals.

## Preserved boundaries and remaining work

- Historical financial and source records, schema definitions, migration checksums and uncertain outcomes stay intact. There is no hold clearing, cancelled-work replay or accepted-input resubmission.
- Token/context measurements, catalogue valuation, provider-reported cost observation, explicit Goal token limits and nonfinancial source/model/grant/tool/deadline guards remain.
- A2A and its exclusive Core operations API/service/configuration are now deleted. See [A2A retirement](a2a-retirement.md).
- Dream now uses direct public SDK submission/result/abort ownership. The final post-conversion run passed all 25 selected isolated native files, 130 Core tests/844 assertions in 12 files, and root/both private type projects. See [Dream mapping review](dream-durable-mapping-review.md) for exact scope, zero-row evidence and retained failures. The 34 add-ons removal/standalone-import checks, catalogue/types/package dry-run also passed; the unrelated Settings inventory baseline gap remains explicit.
- #1878/#1883 retain the fresh-schema policy and final shipped-graph/reporting audit. Preserving historical schemas here is intentional.
- #1907 retains live real-work latency acceptance. Browser fixtures and offline SDK tests do not establish that result.
- No installation, deployment, restart, live-store repair or provider-backed probe was performed.
