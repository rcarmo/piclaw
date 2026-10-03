# Quick Actions input focus

The floating Quick Actions filter keeps its borderless appearance when focused. The popup already separates it from the underlying content; an additional theme outline or neon focus halo is distracting.

The existing `.timeline-quick-actions-input:focus-visible` rule set `outline: none`, but the later shared theme focus contract overrode it with an important outline. A scoped exception now sets both outline and focus box-shadow to none for this input only. Other inputs, buttons, links, composer focus and theme colours are unchanged.

## Evidence

Base: `05f46639a`. Worktree: `/workspace/piclaw-worktrees/quick-actions-input-focus`.

- Before correction, both source-CSS Chromium/WebKit cases fail with `outline-style: solid`.
- Corrected source and rebuilt styles: **4 cases, 1,800 assertions**, across all 56 bundled themes. Includes SynthWave Full, Chromium forced colours, visible caret/text, preserved ordinary field/button rings, typed opening, Enter selection and Escape dismissal.
- Independent bounded source review found no blockers.

The first full runtime gate did not complete. Its first Dream test exceeded the existing 5-second timeout while overriding `Date.now`; four offline account-recovery fixtures then failed session access checks. The run stalled at the session-idle timeout test, whose deadline also uses `Date.now`. Source inspection found a possible frozen-clock leak: the Dream tests restore a per-test captured clock and have a no-op `afterEach`, so a timed-out asynchronous test can overlap a later fixture and leave a mocked clock installed. The owned stalled process was stopped after 21 minutes; this is not passing evidence. The original log is retained at `/workspace/tmp/quick-focus-ci.log`.

After fast-forwarding the isolated branch to current main `178fedf65`, final scoped gates pass: **4 browser cases, 1,800 assertions**; **9 Quick Actions/settings unit cases, 40 assertions**; **25 feature checks**; **9 web-build checks**; all five typechecks with the unchanged 95 transitive frontend diagnostics; scoped lint, stale-dist, pack hygiene (24,751 files) and diff checks. The earlier full runtime attempt remains failed/incomplete; its timeout and frozen-clock regression are handled by a separate test-only patch, without changing this CSS slice or relaxing timeouts.

The user explicitly authorised merging the scoped Quick Actions change. Tests use a disposable fixture; no live settings change, installation or restart.
