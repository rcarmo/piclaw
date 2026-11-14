# Code-faithful UX specifications

The Classic Gherkin roots describe the inspected Piclaw implementation; `planned/` contains desired, unimplemented contracts. The audit files record historical source evidence, including the removed second UI. Specifications are not automatically bound browser tests or accepted Tau/Vibes parity contracts.

Import the [Classic](../classic/README.md) folder for current behaviour, plus [shared](../shared/README.md) for implemented shared cases. Start with [COMPLETION.md](COMPLETION.md) for all 26 feature files and 248 scenario IDs: 240 current-behaviour cases and eight shared SVG-image cases. The index includes the original PR scenarios, adjacent regression features and added auth, Settings, workspace and interaction flows. This directory contains documentation only.

## Evidence and limits

- [Original audit](audit/original.md) traces the original 28 scenarios and the later SVG contribution.
- [Skin differences](audit/differences.md) separates Classic, Visual, family access and optional add-on capabilities.
- [Independent review](audit/review.md) records bounded source reviews and the disposition of each finding.
- Historical [#1323 validation](audit/validation.md) separates its passing local gates from the then-failing immutable oracle. No browser suite was run in that audit; [#1324 follow-up evidence](audit/svg-images.md) records the later baseline browser checks.

The original #1323 audit left the legacy hash/path oracle unchanged and recorded its failure. Follow-up #1324 repairs it with structural checks and separates the desired SVG contract from current behaviour. Historical validation records remain in [validation.md](audit/validation.md); [SVG evidence](audit/svg-images.md) describes the new checks and the renderer implementation under #1325. Idle-Steer behaviour is unchanged. See [import and test boundaries](../README.md#import-and-test-boundaries).

## Coded boundaries

- Loaded skills appear as `/skill:<name>` entries in the Slash commands group.
- Command prefill replaces the compose text without submitting it.
- Plan requires its external add-on; save guards use timestamps and request state, not a revision API.
- Returning a queued item replaces text/references, clears media and schedules removal. Idle Steer may send immediately after a turn ends.
- Picker, queue and model operations use their specific selection and reconciliation paths; no atomic whole-shell or exactly-once guarantee is asserted.
- Message reads support explicit IDs and bounded windows subject to access scope.
- At baseline `70d33bc93`, Classic fenced SVG remains code text. [Shared SVG-image acceptance](../shared/svg-images.feature) is implemented under #1325; the old observation remains historical evidence.
- Missing per-clause executable evidence and browser runs stay explicit in the completion matrix.
