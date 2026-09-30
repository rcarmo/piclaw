@shared @implemented @browser-verified @about
Feature: Core runtime versions in About and General
  # Browser mapping: runtime/test/web/workspace-about.playwright.optional.test.ts
  # API mapping: runtime/test/web/runtime-versions.test.ts

  @ux-workspace-about-001
  Scenario: Workspace About uses the Settings dialog style
    Given the Classic workspace menu is open
    Then Scale is immediately above Language
    Then About is the final menu action
    When I choose About
    Then a compact Settings-style dialog lists only PiClaw, pi-ai and Bun versions
    And each version links safely to its GitHub project
    And keyboard focus stays in the dialog until I dismiss it
    And dismissal returns focus to the workspace menu button

  @ux-workspace-about-002
  Scenario: General shows the same core versions
    Given either Settings skin is showing General
    Then About is the last section
    And it shows the same three runtime versions and links as the dialog

  @ux-workspace-window-state-001
  Scenario: Returning to a window preserves its workspace visibility
    Given two Classic windows have opposite explicit workspace states
    When I return to either window and reload it
    Then each restores its own workspace state
    And another window's preference does not open the closed workspace
