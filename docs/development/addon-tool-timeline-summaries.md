# Add-on tool titles in the timeline

The web timeline, native live status and nested code-mode calls use `formatToolTitle()` in `runtime/src/channels/web/agent/agent-utils.ts`. First-party add-on titles come from the argument-only formatter in `addon-tool-titles.ts`. Historical titles are projected when read; stored arguments and results are unchanged.

## Audit scope

Audited all **49 catalogue add-ons**, including platform-gated declarations and tools whose implementation has moved into Core. **29 add-ons contain tool declarations, with 79 distinct tool names.** The `dev-tools` and `git-query-tools` add-ons share two names. To Do registers four tools through a local factory; these are included.

Source: [`rcarmo/piclaw-addons` at d534f90e8507db71cdb736afdbd0539c8fa4f802](https://github.com/rcarmo/piclaw-addons/tree/d534f90e8507db71cdb736afdbd0539c8fa4f802). The checked-in test fixture, `runtime/test/web/fixtures/addon-tool-inventory.json`, records catalogue versions, source files, names, operation variants and both infrastructure workflow lists. No add-on code or published archives were changed.

The first-party catalogue is the audit boundary. Arbitrary third-party extensions keep the existing command/path/query fallbacks. MCP gateway titles retain their existing server/tool identity.

## Tool-exposing add-ons

| Add-on | Tools | Title content |
|---|---|---|
| ast-grep-tool | `code_search`, `code_rewrite` | Search/rewrite, language and path; no replacement text |
| autoresearch | `start_autoresearch`, `stop_autoresearch`, `autoresearch_status` | Experiment action and project directory |
| cheapskate | `cheapskate` | Provider-rotation action |
| code-review | `code_review` | Review action, thread/batch/review ID and work state |
| code-validator | `diagnostics` | File validation or validator listing |
| codex-conversion | `apply_patch`, `exec_command`, `write_stdin`, `web_search`, `image_generation`, `view_image` | Patch paths, existing shell command preview, session input/output intent and ID, provider operation or image path |
| delegate | `delegate` | Existing first-sentence task summary; Core owns the current tool |
| dev-tools | `git_history`, `json_query` | History mode and file/ref; JSON file or inline-input intent |
| drawio-editor | `open_drawio_editor` | Open diagram and path |
| editable-table | `editable_table` | Edit table and optional title; no table contents |
| git-query-tools | `git_history`, `json_query` | Same names and presentation as dev-tools |
| goal | `get_goal`, `create_goal`, `goal_complete`, `goal_stop`, `update_goal` | Goal lifecycle action; the native host adopts the add-on factory |
| image-processing | `image_process` | Image operation, input and optional output path |
| imap | `imap` | Mail/account action, account and source/destination folders |
| late-night-regrets | `regrets_review` | Review recent human feedback; no feedback packet |
| linkr | `linkr` | Device action, device/job ID; no typed text or event batches |
| m365 | 28 tools, enumerated below | Mail, Teams, calendar, To Do, Graph and file actions with explicit IDs, dates and paths |
| office-tools | `office_read`, `office_write` | Read/write Office document and path; no Markdown contents |
| office-viewer | `open_office_viewer` | Open Office document and path |
| plan-sidebar | `plan` | Core checklist action/progress summary from PR #2055, included as a dependency |
| portainer | `portainer` | API action; all 42 workflows; target and endpoint IDs; method/path or request count |
| proxmox | `proxmox` | API action; all 55 workflows; guest/node/storage/task target; method/path or request count |
| remote-peer | `remote_peer` | Pairing/permission/discovery/work action and public peer/agent/session/request selector |
| restic | `restic` | Read/update backup configuration or status; no repository/credential configuration |
| sample-addon | `sample_test` | Run sample add-on check |
| stealth-browser | `stealth_browser` | Browser action and URL/selector; no scripts, cookies or typed text |
| vent | `vent` | Record feedback and optional trigger; no thought contents |
| voice-pipeline | `ava` | ThinkSmart command and optional volume/scene; no spoken/subtitle text |
| win-ui | 11 `win_*` tools in the inventory | Window/monitor/element action, target and output path; no typed bytes |

### Microsoft 365 tools

- Teams: `m365_teams_chats`, `m365_teams_messages`, `m365_teams_send`, `m365_teams_send_rich_text`, `m365_teams_send_markdown_card`, `m365_teams_upload_file_card`, `m365_teams_send_link_card`, `m365_teams_send_file_card`.
- Graph and people: `m365_graph_query`, `m365_profile`, `m365_people`.
- Mail and calendar: `m365_mail`, `m365_calendar`, `m365_calendar_svg`.
- Files: `m365_onedrive`, `m365_spo_search`, `m365_spo_browse`, `m365_spo_download`, `m365_document_link_metadata`, `m365_onedrive_share_local_file`, `m365_spo_upload`, `m365_spo_sync`, `m365_spo_move`, `m365_spo_move_many`.
- To Do: `m365_todo`, `m365_todo_lists`, `m365_todo_task`, `m365_todo_step`.

## Add-ons without agent tools

These expose skills, panes, hooks, transports or runtime services, but no agent tool declaration:

`diagram-tools`, `eml-viewer`, `export-timeline-pdf`, `ghostty-terminal`, `kanban-board-widget`, `kanban-editor`, `lite-term`, `mindmap`, `observability`, `session-dashboard`, `session-tree`, `settings-dialog-screenshot`, `skill-model-effort`, `smart-compaction`, `telegram`, `web-viewer`, `whatsapp`, `writer-fonts`, `yolo-vibe`, `yolochat`.

## Presentation and privacy

- Titles describe an operation, with selected targets when the arguments contain them. They do not assert success.
- Infrastructure request titles retain their endpoints and add the HTTP method. Batch titles show the count and first endpoint.
- Fixed-purpose tools with empty argument schemas receive a meaningful operation label. Native provider search/image tools do not expose their query/prompt through these schemas; the title cannot reconstruct that hidden information.
- The existing one-line, 120-character detail limit applies.
- Known add-on titles bypass the generic `command` fallback. Passwords, keychain references, request bodies/headers, full configuration objects, message content, scripts, typed text and pairing tickets are not selected by the new formatter. Operation vocabulary is allowlisted before it is turned into prose.
- Displayed URLs lose user information, query strings and fragments. API paths lose query strings and fragments. Expanded raw arguments remain available under the existing access rules; this change does not redact stored history.
- Existing intentional shell-command previews, delegate briefs and Plan step labels retain their own presentation. A credential embedded in one of those existing text previews needs separate handling.
- Argument wrappers must be objects. A real scalar `input` field is preserved, and an explicit top-level operation takes precedence over nested payload-like fields.

## Regression coverage

`runtime/test/web/addon-tool-titles.test.ts` checks every inventoried name, all 22 infrastructure action variants, all 97 infrastructure workflows and 188 additional documented operation variants. Representative cases assert exact wording and targets. Other cases check secret-bearing fields, URL credentials, malformed data, short commands, one-line clipping and shared live/historical/nested projection.

The existing native sequence test intentionally expects the new empty-command and session summaries. It still verifies that stdin contents do not enter the title. No queue, tool execution, SDK placement or cancellation behaviour changes.

When a first-party tool or workflow is added, update the inventory and the explicit selector/operation coverage together. Do not fall back to serialising arbitrary arguments into the title.
