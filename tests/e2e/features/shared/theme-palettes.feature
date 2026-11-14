@shared @implemented @browser-verified @themes
Feature: Web palette identities
  # Acceptance prose; executable mappings:
  # runtime/test/web/shared-themes.test.ts
  # runtime/test/web/shared-themes.playwright.optional.test.ts
  # Run through test:local with PICLAW_RUN_OPTIONAL_BROWSER_TESTS=1; no live theme changes.

  @ux-themes-001
  Scenario: Select every named palette
    Given Classic consumes the palette catalogue
    When a named palette is selected
    Then shared token aliases have matching surfaces, foregrounds and accents
    And the document and native control colour scheme match the selected mode
    And code and terminal roles are populated from that palette
    And authored code foregrounds and syntax colours are separate from UI contrast adjustments
    And all syntax roles render consistently in chat and the actual editor

  @ux-themes-002
  Scenario: Keep Monokai Original and Monokai Pro distinct
    When I choose Monokai Original through Appearance
    Then the theme identity is monokai with its vivid pink accent
    When I choose Monokai Pro through Appearance
    Then the theme identity is monokai-pro with its softer pink accent
    And the labels and palette identities are consistent in the web UI
    And the Classic dialog has aligned Theme, Mode and Palette columns at desktop and phone widths

  @ux-themes-003
  Scenario: Honour explicit variants and browser-local automatic mode
    Given an automatic Default, Solarized or GitHub palette is selected
    When I choose a local light, dark or system mode preference
    Then the automatic palette follows that preference
    When I select an explicit light or dark palette
    Then its declared mode wins over the system colour scheme

  @ux-themes-004
  Scenario: Keep SynthWave glow intrinsic and decorative
    Given normal SynthWave 84 is selected
    Then syntax tokens and selected accents have static glow
    And ordinary prose does not glow
    And there is no separate glow control
    And an old browser opt-out cannot disable the theme's glow
    When I enable forced colours
    Then decorative shadows disappear
    When I select SynthWave 84 Full
    Then bright syntax cores have layered halos and slow pulsing
    And ordinary prose, controls and the compose box have neon glow
    And the compose frame and UI text pulse without changing layout
    And selected actions have animated neon lighting
    When I request reduced motion
    Then Full retains strong static glow without animation
    When the document becomes hidden
    Then the visibility handler pauses Full animations
    When I select a different palette
    Then no SynthWave glow or animation remains

  @ux-themes-007
  Scenario: Select the requested source-verified catalogue families
    Given the shared catalogue includes Turbo Pascal, Tokyo Night, Noctis, Bearded Arc, Catppuccin, Nord, AS400 and Lumon
    When I select each requested variant in Appearance
    Then its stable ID and source-derived background are applied
    And Turbo Pascal is dark while Tokyo Night Light is light despite inconsistent source metadata
    And only SynthWave Full starts the Full-theme animations
    And explicit terminal ANSI colours retain the theme's identity
    And AS400 uses only green and black in syntax, status, overlays and every ANSI role

  @ux-themes-008
  Scenario: Theme all input focus surfaces and clear Full effects on palette changes
    Given the web UI with a selected bundled palette
    When I focus a picker, settings field, dialog, custom select or compose input
    Then its focus ring follows the palette focus colour
    And compose focus belongs to the outer frame while its inner textarea has no outline, border or focus shadow
    And blurring the composer removes its focus ring without changing its geometry
    And field and composer focus use one sharp contour without a detached outer rim
    And its caret, text selection and native control accent follow the palette
    And disabled controls remain disabled and read-only fields remain read-only
    When I select SynthWave 84 Full
    Then input text and focus surfaces receive neon halos
    When I select any other palette
    Then Full UI and compose animations and inherited text glow are removed
    And attachment preview backdrops remain translucent without reducing image opacity

  @ux-themes-010 @pwa
  Scenario: Apply standalone chrome colours without opening a dashboard
    Given the web UI starts with a saved bundled palette
    Then the early document background and browser theme colours match the selected palette before application hydration
    And explicit colour mode takes precedence over the system preference
    When I change the palette or resume the standalone webapp
    Then root and body backgrounds and all theme-colour tags match the active palette
    And the Apple status-bar style remains black-translucent
    And the theme update does not change scroll position, focus or viewport geometry
    And visible Apple standalone pages schedule at most one coalesced chrome refresh frame per update batch
    And hidden pages and normal browser tabs do not run that repaint callback
    # Desktop WebKit verifies metadata/lifecycle only. Native iOS safe-area paint needs device confirmation.

  @ux-themes-009
  Scenario: Keep workspace charts and meter traces consistent with the selected palette
    Given the web UI shows a selected folder and its size chart
    When I change the palette
    Then explorer selection, icons, chart fills and legend colours use shared palette roles
    And existing chart geometry and folder data are retained
    And AS400 chart and meter colours remain green-only
    When I select normal SynthWave 84
    Then meter traces have steady neon halos
    When I select SynthWave 84 Full
    Then meter traces pulse and chart edges glow
    And reduced motion retains steady glow and hidden documents pause animations
    When I select another palette or enable forced colours
    Then the SynthWave chart effects disappear
