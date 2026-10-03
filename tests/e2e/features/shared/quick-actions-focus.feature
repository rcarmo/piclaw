@shared @implemented @browser-verified @quick-actions @theme
Feature: Quick Actions filter has no distracting focus contour
  # Browser mapping: runtime/test/web/quick-actions-focus.playwright.optional.test.ts
  # Classic Quick Actions; shared theme CSS; Chromium and WebKit.

  @ux-quick-actions-focus-001
  Scenario: Only the floating Quick Actions input suppresses its focus outline
    Given the Quick Actions popup is open and its filter is focused
    Then the filter has no outline or focus shadow under any bundled theme
    And its text and caret remain visible
    And ordinary fields and keyboard-focused buttons retain their focus indicators
    And typing, Enter selection and Escape dismissal still work
