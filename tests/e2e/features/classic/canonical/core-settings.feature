@canonical @classic @settings
Feature: Classic Settings dialog core UX
  This audit targets the Classic settings dialog and owner-bound settings routes.
  It does not claim that Visual or other skins expose identical controls or behavior.

  Background:
    Given I am authenticated in the Classic shell
    And visible enabled controls open the native Settings dialog for the current session

  @ux-settings-001 @keyboard @workspace-menu @dismissal
  Scenario: Open Settings once and dismiss it without activating the workspace underneath
    When I open Settings from the keyboard shortcut or the workspace menu
    Then exactly one Settings dialog is rendered in the body portal above workspace content
    And the backdrop blocks pointer interaction with the workspace underneath
    When I dismiss Settings with Escape or a backdrop click
    Then the dialog closes cleanly
    And the current session and workspace state are unchanged

  @ux-settings-002 @loading @general
  Scenario: Cold-open Settings shows a shell immediately and then resolves General
    When I open Settings for the first time in the session
    Then a loading shell is visible immediately instead of a blank frame
    And the dialog fetches shared settings data
    And the General section becomes the first resolved built-in section

  @ux-settings-003 @lazy-load @cache
  Scenario: General is preloaded and other built-in sections lazy-load on first visit
    Given Settings is open on General
    Then General is available without waiting for a section import
    And unopened built-in sections are not loaded yet
    When I switch to a different built-in section for the first time
    Then that section shows a per-pane loading state while its module loads
    And returning to an already visited section reuses the cached module

  @ux-settings-004 @search @responsive
  Scenario: Searchable sections focus the header filter and responsive widths change layout classes only
    Given Settings is open on a searchable section
    Then the header exposes a section-specific search placeholder
    And the search field receives focus when that section becomes active
    When the dialog width crosses the compact and narrow breakpoints
    Then the dialog adds the matching responsive layout classes
    And searchable behavior remains available in the active section

  @ux-settings-005 @compaction @dense-controls
  Scenario: Compaction exposes dense aligned controls for automatic and manual policies
    Given the Compaction section is open
    Then automatic compaction, processing method, compaction model, remote native compaction and tool-result controls appear in a dense form
    And semantic summary, threshold, timeout and backoff controls remain in the same section
    And an unavailable configured compaction model remains visible so the user can repair it explicitly
    And the selected compaction model can be probed from the same row

  @ux-settings-006 @compaction @watchdog @backoff
  Scenario: Compaction surfaces watchdog state, active suppressions and per-chat reset actions
    Given the Compaction section is open
    Then watchdog enablement and timeout are independently visible controls
    And active compaction backoffs are shown by chat with failure detail and a clear action
    And tracked progress phases are shown by chat with started and last-progress timestamps
    When I clear a listed suppression
    Then the returned settings snapshot replaces the visible compaction state

  @ux-settings-007 @providers @auth-flows
  Scenario: Providers expose only the supported setup controls for each provider
    Given the Providers section is open
    Then each provider card shows its configured state and authentication summary
    And OAuth-capable providers expose sign-in flow controls
    And API-key providers expose a password entry field plus save action
    And custom providers expose only their declared custom fields and save action
    And configured providers expose logout and reconfigure controls instead of duplicate setup affordances

  @ux-settings-008 @models @scope
  Scenario: Models loads and mutates the authoritative catalogue for the current chat
    Given the Models section is open for the active chat
    Then the catalogue and context usage are requested for that chat identifier
    And model, thinking and compaction commands target that same chat identifier
    And switching chats prevents stale catalogue results from overwriting the newer active chat state
    And the section can toggle whether enabledModels scopes the catalogue and picker outside the TUI

  @ux-settings-009 @models @filters @keyboard
  Scenario: Models keeps a bounded grouped master-detail catalogue with keyboard navigation
    Given the Models section has loaded catalogue data
    Then the list is grouped and bounded instead of rendering every matching model without limit
    And provider, publisher, family, context-fit, reasoning, variant and sort filters are available
    And the listbox uses aria-activedescendant with Arrow, Home, End, PageUp and PageDown navigation
    And pinning or unpinning a row does not implicitly switch the selected model

  @ux-settings-010 @models @truthful-ui @thinking @compaction
  Scenario: Models actions stay truthful about compatibility, confirmation and next steps
    Given the Models section shows a selected model detail panel
    Then switching is allowed only for a compatible non-current model and only after server confirmation
    And thinking-level controls are enabled only for the current model
    And a blocked model exposes a Compact context action instead of silently switching anyway
    And Provider settings is an explicit navigation action rather than an implied inline mutation

  @ux-settings-011 @budget @access-mode
  Scenario: Budget stays owner-bound, single-user-first and explicit about task-budget ownership
    Given the access mode is single-user and the Budget section is open
    Then the owner can create, edit, enable and disable budget caps with explicit revision-confirmed writes
    And current work may expose allowance, warnings-only, resume and cancel actions with clear continuation guidance
    And per-run scheduled task budget remains edited from Scheduled Tasks as the single source of truth
    But in family-shared or other multi-user modes the owner-bound budget routes are denied before payload parsing
    And the audit must not claim those restricted modes support the same Budget controls

  @ux-settings-012 @scheduled-tasks @budget
  Scenario: Scheduled Tasks lists supported tasks and owns per-run task budget edits
    Given the Scheduled Tasks section is open
    Then scheduled tasks are listed with chat filtering and authoritative counts
    And supported tasks expose pause, resume and delete actions from the detail view
    And agent tasks can set, update or disable a per-run API-equivalent budget with revision confirmation
    And shell tasks reject per-run budget controls rather than simulating support

  @ux-settings-013 @environment @safety
  Scenario: Environment supports refresh and overrides while protecting keychain-injected names
    Given the Environment section is open
    Then the user can refresh the environment snapshot from the backend
    And the section can add a new override by variable name and value
    And each visible row can save a dirty override or clear an existing override
    But keychain-injected environment names remain protected from override writes

  @ux-settings-014 @keychain @reveal @totp
  Scenario: Keychain keeps secrets encrypted, searchable and gated before reveal
    Given the Keychain section is open
    Then the encrypted entry count and current filter match are visible
    And the user can add a named credential with secret, optional username and notes
    And reveal first sends a request for the selected entry
    And a successful response displays that entry's returned values
    And a response requesting a master password or TOTP displays the corresponding prompt
    And submitting that prompt retries reveal with the entered authentication data
    And revealed username or secret values can be copied without exposing unrelated entries
    And delete remains an explicit confirmed action

  @ux-settings-015 @addons @extensions
  Scenario: Add-ons support filtered catalogue actions and extension-pane registration without claiming skin parity
    Given the Add-ons section is open
    Then installed and available add-ons can be filtered by slug, description or tags
    And add-ons expose install, update or remove actions according to their current state
    And a restart notice can surface a restart-now action after add-on changes
    And add-on settings panes join the Settings navigation after the built-in sections instead of replacing them

  @ux-settings-016 @keyboard @shortcuts
  Scenario: Keyboard settings filters and edits shortcut bindings through the shared shortcut model
    Given the Keyboard section is open
    Then shortcut actions can be filtered by their labels and descriptions
    And each shortcut row shows its default binding list
    And each row exposes save and restore-default actions for its draft binding
    And the section exposes a reset-all action for the shared shortcut settings model

  @ux-settings-017 @workspace @terminal @vnc
  Scenario: Workspace settings own terminal, direct-VNC and tree scan preferences
    Given the Workspace section is open
    Then web terminal and direct-VNC are exposed as explicit toggles
    And tree depth, entry limit, refresh interval and folder depth remain numeric workspace controls
    And persisted workspace writes apply immediately to the active client snapshot

  @ux-settings-018 @appearance @theme @tint
  Scenario: Appearance settings apply theme preset, custom tint and output padding from one section
    Given the Appearance section is open
    Then preset themes are listed as explicit selectable rows
    And the default theme can accept a custom tint color with a clear action
    And output padding is editable as a bounded numeric control in the same section
    And successful saves merge the returned appearance settings back into the shared Settings data

  @ux-settings-019 @general @autosave
  Scenario: Save General changes after the debounce
    Given General has loaded its saved settings snapshot
    When I change identity, upload limits or automatic recovery settings
    And the changed snapshot remains mounted for the 800 millisecond debounce
    Then the section posts that snapshot to the general settings endpoint
    And a successful response with settings merges the returned snapshot and shows the applied notice
    And an unsuccessful response reports an error in Settings
    # Closing the section before the timer fires cancels the pending save.

  @ux-settings-020 @general @avatars @meters
  Scenario: Preview avatars and toggle system meters
    Given General is open
    When I choose an avatar image file
    Then its data URL is previewed locally and included in the General draft
    And persisted avatar sources use the corresponding avatar endpoint for previews
    When I toggle system meters
    Then the meters preference is applied locally and a meters-change event is dispatched
    And server UI-state persistence is attempted separately from General autosave

  @ux-settings-021 @api-access @widget-token
  Scenario: Reveal and copy the widget token
    Given Authentication's API access subsection has a widget token
    Then the displayed token starts masked
    When I toggle reveal
    Then the displayed value switches between the token and its mask
    When I copy the token
    Then the section first attempts the Clipboard API and can fall back to the document copy command
    And a successful copy briefly shows copied feedback
    And a failed copy reports status without regenerating the token

  @ux-settings-022 @api-access @widget-token
  Scenario: Confirm widget-token regeneration
    Given Authentication's API access subsection has no regeneration in progress
    When I request regeneration and cancel confirmation
    Then no regeneration request is sent
    When I request regeneration and confirm
    Then regeneration is disabled while its request is in progress
    And a successful response updates the token and shared settings snapshot
    And a failure reports a Settings error and clears the busy state

  @ux-settings-023 @sessions @autosave
  Scenario: Change session lifecycle and agent behaviour settings
    Given the Classic Sessions section is open
    Then auto-rotation, maximum session size, tool-use budget and isolation controls are visible
    And automatic recovery, maximum recovery attempts and the recovery time budget are visible
    And isolation offers none, summary and full
    When I change a setting and leave the section mounted through its 800 millisecond debounce
    Then it posts its session snapshot to the general settings endpoint
    And a successful response merges returned settings and shows the applied notice
    And a failure reports a Settings error
    # Maximum lines and compactions remain in the snapshot but have no controls in this section.

  @ux-settings-027 @tools
  Scenario: Filter and collapse the Tools catalogue
    Given the Tools section has supplied toolsets
    When I filter by tool name, group name or summary
    Then matching tools are displayed case-insensitively
    When I uncheck a toolset header
    Then the group's tool rows are hidden locally
    And this collapse action does not deactivate runtime tools
    And individual enabled indicators are checked and disabled

  @ux-settings-028 @tools @compaction
  Scenario: Persist search mode and tool-result compaction choices
    Given the Tools section is open
    When I toggle search match mode
    Then it posts the next OR or AND mode to general settings
    When I toggle compaction for a tool
    Then it posts the sorted normalised tool selection to compaction settings
    And returned successful settings are merged into shared Settings data
    # Request exceptions are logged; these handlers do not show a dedicated error notice.

  @ux-settings-029 @quick-actions
  Scenario: Edit Quick Actions selections before explicitly saving
    Given the Classic Quick Actions Settings section has loaded
    Then available commands are loaded for web:default
    And a failed command-catalogue request falls back to an empty command list
    When I toggle a workspace or slash command or choose Enable all
    Then only the local selections change until I activate Save and apply
    When saving succeeds
    Then shared settings are updated and a quick-actions-settings-updated event is dispatched
    And Settings reports success
    When saving fails
    Then Settings reports the error and re-enables Save

  @ux-settings-030 @general @authentication
  Scenario: Inspect notification capability and instance TOTP setup
    Given General is open
    Then the notification hint depends on whether the browser has a secure context
    And configured instance TOTP displays supplied issuer, label, secret and available QR markup
    And unconfigured TOTP displays setup guidance
    # These are supplied setup fields, not a new enrolment ceremony in General.

  @ux-settings-031 @editor @local-preferences
  Scenario: Save local editor preferences from the registered pane
    Given the Classic Editor settings pane is registered and open
    When I change Vim mode, whitespace display, Markdown live preview, font size or font family
    Then the pane writes the corresponding localStorage preference
    And the font-size control is bounded from 10 to 24 with fallback 13
    And no server settings save is sent by this pane

  @ux-settings-032 @developer @local-preferences
  Scenario: Gate developer preferences behind local developer mode
    Given the Classic Developer settings pane is registered and open
    When I enable developer mode
    Then catalogue, additional catalogue and repository URL fields become visible
    And SSE and tool-call logging toggles become visible
    And edits write the corresponding localStorage preferences
    When I disable developer mode
    Then those additional controls are hidden without deleting their stored values
