@classic @touch @source-reviewed
Feature: Classic session swipe target rules
  Source: runtime/web/src/ui/chat-swipe-navigation.ts.
  Eligibility depends on the gesture target and active selection, not merely which panes are visible.

  @ux-mobile-001
  Scenario: Swipe on eligible timeline space
    Given at least two non-archived swipe candidates exist
    And the touch starts on an eligible noninteractive timeline target
    And no active text selection blocks navigation
    When the gesture satisfies the horizontal swipe thresholds
    Then navigation selects the adjacent candidate and wraps at the candidate-list end

  @ux-mobile-002
  Scenario Outline: Ignore gestures originating in excluded controls
    Given a gesture starts inside <surface>
    When the target is checked for swipe eligibility
    Then it is excluded from ordinary chat swipe navigation

    Examples:
      | surface                      |
      | composer input               |
      | workspace explorer           |
      | editor pane container        |
      | terminal content or dock     |
      | attachment preview modal     |
      | A2UI form controls       |
      | model or session popup       |

  @ux-mobile-003
  Scenario: Permit designated thinking and status panel targets
    Given an interactive target has a thinking, status-panel or thinking-intent passthrough ancestor
    When swipe target eligibility is evaluated
    Then that ancestor permits the target through the interactive-target exclusion
    And gesture direction and selection guards still apply

  @ux-mobile-004
  Scenario: Keep swipe order stable as the selected chat changes
    Given candidate sessions have active and archived metadata
    When swipe candidates are resolved
    Then archived and duplicate identifiers are omitted
    And active sessions sort first followed by chat-identifier alphabetical order
    And changing the selected chat does not otherwise reorder that carousel

  @ux-mobile-005
  Scenario: Do not treat primarily vertical movement as chat navigation
    Given an eligible touch gesture has started
    When movement exceeds the vertical cancellation threshold and is primarily vertical
    Then that gesture is cancelled for horizontal chat navigation

  @ux-mobile-006
  Scenario: Limit horizontal wheel navigation to the supported Safari path
    Given the browser is not desktop Safari or is iOS
    When a horizontal wheel event arrives
    Then the Safari wheel-navigation path does not switch chats
