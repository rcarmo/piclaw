# Additional interaction evidence

> Historical source audit. Visual was removed in #1990; paths and counts below describe the inspected revision, not the current UI.

Each ID maps to the current [Classic interactions](../../classic/canonical/core-interactions.feature) or [Visual interactions](../../visual/core-interactions.feature). All paths below are relative to the repository root. Coordinator source inspection and independent bounded review are complete; browser execution is absent.

| IDs | Source and symbols | Existing related executable evidence |
|---|---|---|
| ux-extra-001 | `runtime/web/src/components/btw-panel.ts` — BtwPanel; `runtime/web/src/ui/btw.ts` — shouldShowBtwAnswer, shouldShowBtwControls | `runtime/test/web/btw.test.ts` |
| ux-extra-002 | `runtime/web/src/ui/adaptive-card-submission.ts` — isAdaptiveCardSubmissionBlock | `runtime/test/web/adaptive-card-submission.test.ts` |
| ux-extra-003 | `runtime/web/src/ui/adaptive-card-renderer.ts` — asynchronous action notice | `runtime/test/web/adaptive-card-submission.test.ts` (related validation only) |
| ux-extra-004 | `runtime/web/src/ui/generated-widget.ts` — persisted/live normalisation and status | No direct browser run |
| ux-extra-005 | `runtime/web/src/ui/app-floating-widget.ts` — closeFloatingWidget; `runtime/web/src/ui/app-floating-widget-followup.ts` | Live widgets record dismissal; timeline artifacts do not add a live dismissal key |
| ux-extra-006, ux-extra-007 | `runtime/web/static/visual/frontend/src/panels/SearchPanel.tsx` — SearchPanel; debounce, AbortController, result activation | No direct browser run |
| ux-extra-008 | `runtime/web/static/visual/frontend/src/panels/TasksPanel.tsx` — fetchTasks, handleAction | Mutation failure logs; list-load failure sets panel error. An HTTP rejection still reaches refresh; a thrown mutation request skips it |
| ux-extra-009, ux-extra-010 | `runtime/web/static/visual/frontend/src/panels/ScratchpadPanel.tsx` — send note, split drag handlers | No direct browser run |
| ux-extra-011 | `runtime/web/src/ui/notification-delivery-coordinator.ts` — shouldNotifyLocallyForChat, withdrawLocalNotificationPresence | `runtime/test/web/notification-delivery-coordinator.test.ts` |
| ux-extra-012, ux-extra-013 | `runtime/web/src/components/post.ts` — getProtectedRecoveryControlIntent, silentRecoveryPlaceholder | `runtime/test/web/post-recovery-chip.test.ts` |

## Review corrections

BTW hides the answer and action footer during a running side turn. Retry needs a question; the visible Inject control needs an answer. Widget dismissal is scoped to live widgets. Any visible eligible notification candidate suppresses local delivery; otherwise the lexicographically first client identifier leads. These clauses were rechecked directly after the independent review.
