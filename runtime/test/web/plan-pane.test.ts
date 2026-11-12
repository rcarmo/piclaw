import { expect, test } from 'bun:test';

import { PLAN_TAB_PATH, buildPlanSubmissionPrompt, parsePlanChecklist, planPaneExtension, summarisePlan } from '../../web/src/panes/plan-pane.js';

test('plan checklist parsing maps the three Markdown markers and ignores other lines', () => {
  const items = parsePlanChecklist('# Plan\n- [x] Inspect\n- [-] Patch the pane\n* [ ] Test\nNotes\n- [X] Ship');
  expect(items).toEqual([
    { step: 'Inspect', status: 'completed' },
    { step: 'Patch the pane', status: 'in_progress' },
    { step: 'Test', status: 'pending' },
    { step: 'Ship', status: 'completed' },
  ]);
  expect(summarisePlan(items)).toEqual({ total: 4, completed: 2, percent: 50 });
  expect(summarisePlan([])).toEqual({ total: 0, completed: 0, percent: 0 });
  expect(parsePlanChecklist(null)).toEqual([]);
});

test('the plan pane claims only its virtual tab path', () => {
  expect(planPaneExtension.canHandle?.({ path: PLAN_TAB_PATH, mode: 'edit' })).toBe(9000);
  expect(planPaneExtension.canHandle?.({ path: 'notes/plan.md', mode: 'edit' })).toBe(false);
});

test('submitting a plan wraps it in the add-on prompt', () => {
  const prompt = buildPlanSubmissionPrompt('- [ ] Do it');
  expect(prompt.startsWith('Use this `plan` tool checklist as the working plan.')).toBe(true);
  expect(prompt.endsWith('```markdown\n- [ ] Do it\n```')).toBe(true);
});
