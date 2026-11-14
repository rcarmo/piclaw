# Skin and capability boundaries

> Historical source audit. Visual was removed in #1990; paths and counts below describe the inspected revision, not the current UI.

Classic is the default authority. The entries below compare inspected source, not browser execution or complete skin parity. Paths are repository-relative.

| Surface | Classic evidence | Visual evidence | Disposition |
|---|---|---|---|
| Settings navigation | `runtime/web/src/components/settings-dialog.ts`: General-first dialog, lazy built-ins and registered panes | `runtime/web/static/visual/frontend/src/panels/SettingsPanel.tsx`: panel registry, stored category, per-field save generation | Separate shell and save-lifecycle contracts; matching section names do not prove parity |
| Quick Actions / Add-ons settings | Classic dialog includes both built-ins | Visual SettingsPanel imports neither built-in | No built-in Visual counterparts in this snapshot; runtime add-on registration can extend navigation |
| General token/setup | `runtime/web/src/components/settings/general.ts`: avatars, token reveal/copy/regenerate, supplied TOTP fields, recovery controls | `runtime/web/static/visual/frontend/src/panels/settings/GeneralSection.tsx`: identity, upload limits, model scoping and TOTP status | Classic 019–022/030 cannot be inferred for Visual. Compose upload control max: Classic 512; Visual 256 |
| Tools filtering | `runtime/web/src/components/settings/tools.ts`: whole-query substring over tool/group name or summary | `runtime/web/static/visual/frontend/src/panels/settings/ToolsSection.tsx`: keyword OR/AND matching over name/description/summary | Both expose compaction choices, but filter semantics and local draft handling differ |
| Workspace edit gating | `runtime/web/src/components/workspace-explorer.ts`: text preview, non-directory and 256 KiB limit | `runtime/web/static/visual/frontend/src/panels/workspace/WorkspaceActions.tsx`: extension-based isEditableExt and open-page event | Distinct edit/open-preview entry points; no universal size gate assumed |
| Workspace controls | Classic explorer has create, rename, upload, refresh and reindex flows | `runtime/web/static/visual/frontend/src/panels/WorkspacePanel.tsx` plus WorkspaceActions: file/preview split, hidden toggle, combined reindex, attach/copy/download/open/edit/delete | This compares the inspected panels, not every possible add-on file action |
| Sessions/tasks | Classic picker callbacks and separate Sessions / Scheduled Tasks settings | `runtime/web/static/visual/frontend/src/panels/TasksPanel.tsx`: separate sessions/tasks tabs, branch/root actions and task mutation handler | Visual task failure semantics are covered separately in extra-008 |
| Search/scratchpad | No counterpart is specified by this Classic audit | Visual SearchPanel and ScratchpadPanel have explicit extra-006–010 scenarios | Absence from this audit is not evidence of global Classic absence |
| Plan | External plan-sidebar at 6374ed3c85627c590794e44828d13b08587ba46b | Availability depends on add-on registration | Conditional add-on scenarios only; no built-in Plan or universal model-tool visibility |
| Family / Budget | `runtime/web/src/family.ts` is the family client; owner-bound budget routes deny other access modes | Shared routes remain authoritative irrespective of skin | Family auth has separate preconditions; single-user background does not grant cross-owner access |
| SVG fences | At 70d33bc93 Classic `renderMarkdown` keeps SVG fences as code | [Shared SVG images](../../shared/svg-images.feature) now use one helper in both skins | #1324 separates baseline evidence from desired behaviour; #1325 implements and browser-validates the shared path. [Revision evidence](svg-images.md) verifies Vibes only; Tau parity is unverified |

Recordings and Sessions both have operational implementations in both skins. Classic also has add-on registration and Tools compaction controls. The initial delegated comparison inferred missing Classic capabilities from its navigation file; those claims were rejected after reading the section implementations.
