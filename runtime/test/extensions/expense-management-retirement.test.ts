import '../helpers.js';
import { expect, test } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createBuiltinExtensionFactories } from '../../src/extensions/index.js';
import { createFakeExtensionApi } from './fake-extension-api.js';
import { handleAgentRoutes } from '../../src/channels/web/http/dispatch-agent.js';
import { TOOL_PREPARATION_MANIFEST } from '../../src/service-effects/tool-preparation/manifest.js';
import { getToolPreparationPolicy } from '../../src/service-effects/tool-preparation/policy.js';
import { initDatabase, getDb } from '../../src/db/connection.js';
import { storeTokenUsage, getLatestTokenUsage } from '../../src/db/token-usage.js';

const root = join(import.meta.dir, '../..');
const source = (path: string) => readFileSync(join(root, path), 'utf8');

test('expense-management modules are deleted instead of hidden behind a flag or compatibility handler', () => {
  for (const path of ['src/extensions/budget-limits.ts', 'src/channels/web/handlers/budget-settings.ts', 'src/budget/settings.ts', 'src/budget/admission.ts', 'web/src/components/settings/budget.ts', 'web/src/ui/budget-settings-model.ts']) expect(existsSync(join(root, path)), path).toBe(false);
});

test('real builtin factories retain observation tools without a budget command, tool or tool boundary hook', () => {
  initDatabase();
  const fake = createFakeExtensionApi(), commands: string[] = [];
  fake.api.registerCommand = ((name: string) => { commands.push(name); }) as typeof fake.api.registerCommand;
  for (const factory of createBuiltinExtensionFactories()) factory(fake.api);
  expect(fake.tools.has('budget_status')).toBe(false);
  expect(commands).not.toContain('budget');
  expect(fake.handlers.filter(row => row.event === 'tool_call')).toEqual([]);
  for (const name of ['list_models', 'get_model_state', 'provider_quota', 'schedule_task', 'scheduled_tasks']) expect(fake.tools.has(name), name).toBe(true);
  expect(TOOL_PREPARATION_MANIFEST.some(row => row.toolName === 'budget_status')).toBe(false);
  expect(getToolPreparationPolicy('budget_status')).toBeUndefined();
});

for (const [path, method] of [['/agent/settings/budget', 'GET'], ['/agent/settings/budget/action', 'POST']] as const)
test(`retired ${method} ${path} uses ordinary route fallthrough before channel access or parsing`, async () => {
  initDatabase();
  storeTokenUsage({ chat_jid: 'test:expense-retirement', run_at: '2026-11-03T00:00:00.000Z', input_tokens: 3, output_tokens: 2,
    reasoning_tokens: 1, cache_read_tokens: 0, cache_write_tokens: 0, total_tokens: 5,
    cost_input: 0, cost_output: 0, cost_cache_read: 0, cost_cache_write: 0, cost_total: 0,
    provider_cost_total: 0, catalogue_cost_total: null, cost_provenance: 'provider_reported', provider: 'fixture', model: 'fixture-model' });
  const before = getDb().query('SELECT * FROM token_usage').all();
  const channel = new Proxy({}, { get(_target, key) { throw Error('Retired route accessed channel: ' + String(key)); } });
  const request = new Request('https://fixture.invalid' + path, { method, ...(method === 'POST' ? { body: 'invalid json' } : {}) });
  expect(await handleAgentRoutes(channel as any, request, path, new URL(request.url))).toBeNull();
  expect(request.bodyUsed).toBe(false);
  expect(getDb().query('SELECT * FROM token_usage').all()).toEqual(before);
  expect(getLatestTokenUsage('test:expense-retirement')).toMatchObject({ total_tokens: 5, reasoning_tokens: 1,
    provider_cost_total: 0, catalogue_cost_total: null, cost_provenance: 'provider_reported' });
});

test('web UI and shared client remove the pane and API while model pricing and scheduled controls stay present', () => {
  const classic = source('web/src/components/settings-dialog.ts');
  expect(classic).not.toMatch(/BudgetSection|iconBudget|id: 'budget'|case 'budget'/);

  expect(source('web/static/classic/css/settings.css')).not.toContain('.settings-budget-');

  expect(source('web/src/utils/i18n.ts')).not.toContain('settings.section.budget');
  expect(source('web/src/api.ts')).not.toMatch(/getBudgetSettings|updateBudgetSettings|\/agent\/settings\/budget/);
  expect(source('web/src/components/model-picker.ts')).toContain('formatModelCataloguePricing');

  expect(source('web/src/components/settings/scheduled-tasks.ts')).not.toContain('set_budget');
  expect(source('web/src/components/settings/scheduled-tasks.ts')).toContain('onAction(\'pause\'');
});
