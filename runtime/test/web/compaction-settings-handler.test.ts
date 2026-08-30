import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import '../helpers.js';
import { importFresh, withTempWorkspaceEnv } from '../helpers.js';

test('saveCompactionSettings persists and applies compaction settings immediately', async () => {
  await withTempWorkspaceEnv('piclaw-compaction-settings-', {
    PICLAW_AUTO_COMPACTION_ENABLED: '',
    PICLAW_SMART_COMPACTION_METHOD: '',
    PICLAW_COMPACTION_TIMEOUT_MS: '',
    PICLAW_COMPACTION_BACKOFF_BASE_MS: '',
    PICLAW_COMPACTION_BACKOFF_MAX_MS: '',
    PICLAW_COMPACTION_THRESHOLD_PERCENT: '',
    PICLAW_COMPACTION_MAX_THRESHOLD_TOKENS: '',
    PICLAW_COMPACTION_BACKOFF_DECAY_FACTOR: '',
    PICLAW_AUTO_COMPACTION_SCOPE: '',
    PICLAW_COMPACTION_HARD_CEILING_PERCENT: '',
    PICLAW_COMPACTION_WARNING_THRESHOLD: '',
    PICLAW_PROGRESS_WATCHDOG_ENABLED: undefined,
    PICLAW_PROGRESS_WATCHDOG_TIMEOUT_MS: undefined,
    PICLAW_TOOL_RESULT_COMPACTION_ENABLED: undefined,
    PICLAW_TOOL_RESULT_COMPACTION_TOOLS: undefined,
    PICLAW_TOOL_RESULT_SEMANTIC_SUMMARY_ENABLED: undefined,
    PICLAW_TOOL_RESULT_SEMANTIC_SUMMARY_MAX_INPUT_CHARS: undefined,
    PICLAW_TOOL_RESULT_SEMANTIC_SUMMARY_MAX_TOKENS: undefined,
    PICLAW_TOOL_RESULT_SEMANTIC_SUMMARY_TIMEOUT_MS: undefined,
  }, async (workspace) => {
    const previousAutoCompactionAlias = process.env.PICLAW_AUTO_COMPACTION_ENABLED;
    delete process.env.PICLAW_AUTO_COMPACTION_ENABLED;
    const config = await import('../../src/core/config.js');
    const runtimeBefore = config.getCompactionRuntimeConfig();
    const db = await importFresh<typeof import('../../src/db.js')>('../src/db.js');
    db.initDatabase();
    const handler = await importFresh<typeof import('../../src/channels/web/handlers/compaction-settings.js')>(
      '../src/channels/web/handlers/compaction-settings.js',
    );

    const saved = await handler.saveCompactionSettings({
      autoCompactionEnabled: false,
      smartCompactionMethod: 'traditional-pipelined',
      compactionModel: 'local/fast-summary',
      remoteCompactionEnabled: true,
      remoteCompactionTimeoutSec: 45,
      compactionTimeoutSec: 240,
      compactionBackoffBaseMin: 12,
      compactionBackoffMaxMin: 180,
      compactionThresholdPercent: 75,
      compactionBackoffDecayFactor: 0.25,
      progressWatchdogEnabled: true,
      progressWatchdogTimeoutSec: 75,
      toolResultCompactionEnabled: false,
      toolResultCompactionTools: ['bash', 'exec_batch'],
      toolResultSemanticSummaryEnabled: true,
      toolResultSemanticSummaryMaxInputChars: 24000,
      toolResultSemanticSummaryMaxTokens: 640,
      toolResultSemanticSummaryTimeoutSec: 30,
    });

    expect(saved).toMatchObject({
      autoCompactionEnabled: false,
      smartCompactionMethod: 'pipelined',
      compactionModel: 'local/fast-summary',
      remoteCompactionEnabled: true,
      remoteCompactionTimeoutSec: 45,
      remoteCompactionSupportedProviders: ['openai', 'openai-codex'],
      compactionTimeoutSec: 240,
      compactionBackoffBaseMin: 12,
      compactionBackoffMaxMin: 180,
      compactionThresholdPercent: 75,
      compactionBackoffDecayFactor: 0.25,
      progressWatchdogEnabled: true,
      progressWatchdogTimeoutSec: 75,
      toolResultCompactionEnabled: false,
      toolResultCompactionTools: ['bash', 'exec_batch'],
      toolResultSemanticSummaryEnabled: true,
      toolResultSemanticSummaryMaxInputChars: 24000,
      toolResultSemanticSummaryMaxTokens: 640,
      toolResultSemanticSummaryTimeoutSec: 30,
    });
    expect(process.env.PICLAW_AUTO_COMPACTION_ENABLED).toBeUndefined();
    expect(process.env.PICLAW_SMART_COMPACTION_METHOD).toBe('');
    expect(process.env.PICLAW_COMPACTION_TIMEOUT_MS).toBe('');
    expect(process.env.PICLAW_COMPACTION_BACKOFF_BASE_MS).toBe('');
    expect(process.env.PICLAW_COMPACTION_BACKOFF_MAX_MS).toBe('');
    expect(process.env.PICLAW_COMPACTION_THRESHOLD_PERCENT).toBe('');
    expect(process.env.PICLAW_COMPACTION_MAX_THRESHOLD_TOKENS).toBe('');
    expect(process.env.PICLAW_COMPACTION_BACKOFF_DECAY_FACTOR).toBe('');
    expect(process.env.PICLAW_PROGRESS_WATCHDOG_ENABLED).toBeUndefined();
    expect(process.env.PICLAW_PROGRESS_WATCHDOG_TIMEOUT_MS).toBeUndefined();

    const persisted = JSON.parse(readFileSync(join(workspace.workspace, '.piclaw', 'config.json'), 'utf8'));
    expect(persisted).toMatchObject({
      domains: {
        tools: {
          toolResultCompactionEnabled: false,
          toolResultCompactionTools: ['bash', 'exec_batch'],
          toolResultSemanticSummaryEnabled: true,
          toolResultSemanticSummaryMaxInputChars: 24000,
          toolResultSemanticSummaryMaxTokens: 640,
          toolResultSemanticSummaryTimeoutMs: 30000,
        },
        compaction: {
          autoCompactionEnabled: false,
          smartCompactionMethod: 'pipelined',
          model: 'local/fast-summary',
          remoteCompactionEnabled: true,
          remoteCompactionTimeoutMs: 45000,
          timeoutMs: 240000,
          backoffBaseMs: 720000,
          backoffMaxMs: 10800000,
          thresholdPercent: 75,
          backoffDecayFactor: 0.25,
        },
        watchdog: {
          enabled: true,
          timeoutMs: 75000,
        },
      },
    });

    config.setCompactionRuntimeConfigForTests({ ...runtimeBefore });
    expect(config.getCompactionRuntimeConfig()).toEqual(runtimeBefore);
    if (previousAutoCompactionAlias === undefined) delete process.env.PICLAW_AUTO_COMPACTION_ENABLED;
    else process.env.PICLAW_AUTO_COMPACTION_ENABLED = previousAutoCompactionAlias;
  });
});

test('compaction settings expose advisory latency estimates without changing the deadline', async () => {
  await withTempWorkspaceEnv('piclaw-compaction-latency-estimate-', {}, async () => {
    const db = await importFresh<typeof import('../../src/db.js')>('../src/db.js');
    db.initDatabase();
    const config = await import('../../src/core/config.js');
    config.setCompactionRuntimeConfigForTests({ compactionModel: 'local/summary', timeoutMs: 100_000 });
    for (const [index, duration] of [40_000, 70_000, 90_000].entries()) {
      db.storeCompactionTelemetry({
        generation_id: `settings-estimate-${index}`, recorded_at: new Date(Date.now() - index * 1000).toISOString(), trigger: 'manual', method: 'selective', execution: 'single_pass', outcome: 'success',
        provider: 'local', model: 'summary', timeout_stage: null, input_tokens: 48_000, total_duration_ms: duration,
        deterministic_duration_ms: 100, time_to_first_token_ms: duration * 0.7, provider_generation_ms: duration * 0.2,
        provider_request_count: 1, processed_chunk_count: null, total_chunk_count: null, settlement_timed_out: false,
      });
    }
    const handler = await importFresh<typeof import('../../src/channels/web/handlers/compaction-settings.js')>('../src/channels/web/handlers/compaction-settings.js');
    const before = config.getCompactionRuntimeConfig().timeoutMs;
    const data = handler.getCompactionSettingsData();
    expect(data.compactionLatencyEstimate).toMatchObject({ sampleCount: 3, warning: true, p90DurationMs: 90_000 });
    expect(config.getCompactionRuntimeConfig().timeoutMs).toBe(before);
    config.resetCompactionRuntimeConfigForTests();
  });
});

test('saveCompactionSettings preserves the current processing method for invalid input', async () => {
  await withTempWorkspaceEnv('piclaw-compaction-method-invalid-', {
    PICLAW_SMART_COMPACTION_METHOD: undefined,
  }, async () => {
    const db = await importFresh<typeof import('../../src/db.js')>('../src/db.js');
    db.initDatabase();
    const handler = await importFresh<typeof import('../../src/channels/web/handlers/compaction-settings.js')>(
      '../src/channels/web/handlers/compaction-settings.js',
    );

    const before = await handler.saveCompactionSettings({
      smartCompactionMethod: 'pipelined',
      compactionModel: 'local/fast-summary',
      compactionTimeoutSec: 211,
      compactionBackoffBaseMin: 17,
      progressWatchdogEnabled: false,
    });
    const saved = await handler.saveCompactionSettings({ smartCompactionMethod: 'unsafe-unknown-method', compactionModel: 'ambiguous' });

    expect(saved.smartCompactionMethod).toBe('pipelined');
    expect(saved.compactionModel).toBe('local/fast-summary');
    expect(saved.compactionTimeoutSec).toBe(before.compactionTimeoutSec);
    expect(saved.compactionBackoffBaseMin).toBe(before.compactionBackoffBaseMin);
    expect(saved.progressWatchdogEnabled).toBe(before.progressWatchdogEnabled);
  });
});

test('saveCompactionSettings normalizes per-tool compaction allowlist', async () => {
  await withTempWorkspaceEnv('piclaw-compaction-tools-normalization-', {
    PICLAW_TOOL_RESULT_COMPACTION_ENABLED: undefined,
    PICLAW_TOOL_RESULT_COMPACTION_TOOLS: undefined,
    PICLAW_TOOL_RESULT_SEMANTIC_SUMMARY_ENABLED: undefined,
    PICLAW_TOOL_RESULT_SEMANTIC_SUMMARY_MAX_INPUT_CHARS: undefined,
    PICLAW_TOOL_RESULT_SEMANTIC_SUMMARY_MAX_TOKENS: undefined,
    PICLAW_TOOL_RESULT_SEMANTIC_SUMMARY_TIMEOUT_MS: undefined,
  }, async (workspace) => {
    const db = await importFresh<typeof import('../../src/db.js')>('../src/db.js');
    db.initDatabase();
    const handler = await importFresh<typeof import('../../src/channels/web/handlers/compaction-settings.js')>(
      '../src/channels/web/handlers/compaction-settings.js',
    );

    const saved = await handler.saveCompactionSettings({
      toolResultCompactionTools: [' Bash ', 'proxmox', 'proxmox'],
    });

    expect(saved.toolResultCompactionTools).toEqual(['bash', 'proxmox']);

    const persisted = JSON.parse(readFileSync(join(workspace.workspace, '.piclaw', 'config.json'), 'utf8'));
    expect(persisted).toMatchObject({
      domains: { tools: { toolResultCompactionTools: ['bash', 'proxmox'] } },
    });
    expect(process.env.PICLAW_TOOL_RESULT_COMPACTION_TOOLS).toBeUndefined();
  });
});

test('saveCompactionSettings normalizes semantic summary settings', async () => {
  await withTempWorkspaceEnv('piclaw-compaction-semantic-summary-normalization-', {
    PICLAW_TOOL_RESULT_SEMANTIC_SUMMARY_ENABLED: undefined,
    PICLAW_TOOL_RESULT_SEMANTIC_SUMMARY_MAX_INPUT_CHARS: undefined,
    PICLAW_TOOL_RESULT_SEMANTIC_SUMMARY_MAX_TOKENS: undefined,
    PICLAW_TOOL_RESULT_SEMANTIC_SUMMARY_TIMEOUT_MS: undefined,
  }, async (workspace) => {
    const db = await importFresh<typeof import('../../src/db.js')>('../src/db.js');
    db.initDatabase();
    const handler = await importFresh<typeof import('../../src/channels/web/handlers/compaction-settings.js')>(
      '../src/channels/web/handlers/compaction-settings.js',
    );

    const saved = await handler.saveCompactionSettings({
      toolResultSemanticSummaryEnabled: true,
      toolResultSemanticSummaryMaxInputChars: 10,
      toolResultSemanticSummaryMaxTokens: 99999,
      toolResultSemanticSummaryTimeoutSec: 999,
    });

    expect(saved).toMatchObject({
      toolResultSemanticSummaryEnabled: true,
      toolResultSemanticSummaryMaxInputChars: 500,
      toolResultSemanticSummaryMaxTokens: 4096,
      toolResultSemanticSummaryTimeoutSec: 300,
    });

    const persisted = JSON.parse(readFileSync(join(workspace.workspace, '.piclaw', 'config.json'), 'utf8'));
    expect(persisted).toMatchObject({
      domains: { tools: {
        toolResultSemanticSummaryEnabled: true,
        toolResultSemanticSummaryMaxInputChars: 500,
        toolResultSemanticSummaryMaxTokens: 4096,
        toolResultSemanticSummaryTimeoutMs: 300000,
      } },
    });
    expect(process.env.PICLAW_TOOL_RESULT_SEMANTIC_SUMMARY_ENABLED).toBeUndefined();
    expect(process.env.PICLAW_TOOL_RESULT_SEMANTIC_SUMMARY_MAX_INPUT_CHARS).toBeUndefined();
    expect(process.env.PICLAW_TOOL_RESULT_SEMANTIC_SUMMARY_MAX_TOKENS).toBeUndefined();
    expect(process.env.PICLAW_TOOL_RESULT_SEMANTIC_SUMMARY_TIMEOUT_MS).toBeUndefined();
  });
});

test('saveCompactionSettings can disable watchdog without clearing its timeout', async () => {
  await withTempWorkspaceEnv('piclaw-compaction-watchdog-disabled-', {
    PICLAW_COMPACTION_TIMEOUT_MS: undefined,
    PICLAW_COMPACTION_BACKOFF_BASE_MS: undefined,
    PICLAW_COMPACTION_BACKOFF_MAX_MS: undefined,
    PICLAW_PROGRESS_WATCHDOG_ENABLED: undefined,
    PICLAW_PROGRESS_WATCHDOG_TIMEOUT_MS: undefined,
    PICLAW_TOOL_RESULT_COMPACTION_ENABLED: undefined,
    PICLAW_TOOL_RESULT_COMPACTION_TOOLS: undefined,
    PICLAW_TOOL_RESULT_SEMANTIC_SUMMARY_ENABLED: undefined,
    PICLAW_TOOL_RESULT_SEMANTIC_SUMMARY_MAX_INPUT_CHARS: undefined,
    PICLAW_TOOL_RESULT_SEMANTIC_SUMMARY_MAX_TOKENS: undefined,
    PICLAW_TOOL_RESULT_SEMANTIC_SUMMARY_TIMEOUT_MS: undefined,
  }, async (workspace) => {
    const db = await importFresh<typeof import('../../src/db.js')>('../src/db.js');
    db.initDatabase();
    const handler = await importFresh<typeof import('../../src/channels/web/handlers/compaction-settings.js')>(
      '../src/channels/web/handlers/compaction-settings.js',
    );

    const saved = await handler.saveCompactionSettings({
      progressWatchdogEnabled: false,
      progressWatchdogTimeoutSec: 120,
    });

    expect(saved).toMatchObject({
      progressWatchdogEnabled: false,
      progressWatchdogTimeoutSec: 120,
    });

    const persisted = JSON.parse(readFileSync(join(workspace.workspace, '.piclaw', 'config.json'), 'utf8'));
    expect(persisted).toMatchObject({
      domains: {
        watchdog: {
          enabled: false,
          timeoutMs: 120000,
        },
      },
    });
  });
});

test('runtime config honors an explicitly disabled progress watchdog in production', async () => {
  await withTempWorkspaceEnv('piclaw-compaction-watchdog-enforce-', {
    PICLAW_COMPACTION_TIMEOUT_MS: '300000',
    PICLAW_PROGRESS_WATCHDOG_ENABLED: '0',
    PICLAW_PROGRESS_WATCHDOG_TIMEOUT_MS: '0',
    PICLAW_ALLOW_DISABLE_PROGRESS_WATCHDOG: undefined,
  }, async () => {
    const previousDbInMemory = process.env.PICLAW_DB_IN_MEMORY;
    const previousNodeEnv = process.env.NODE_ENV;
    delete process.env.PICLAW_DB_IN_MEMORY;
    process.env.NODE_ENV = 'production';
    try {
      const config = await importFresh<typeof import('../../src/core/config.js')>('../src/core/config.js');
      const runtimeConfig = config.getCompactionRuntimeConfig();
      expect(runtimeConfig.progressWatchdogEnabled).toBe(false);
      expect(runtimeConfig.progressWatchdogTimeoutMs).toBe(0);
      expect(config.getProgressWatchdogSafetyWarning()).toBeNull();
    } finally {
      if (previousDbInMemory === undefined) delete process.env.PICLAW_DB_IN_MEMORY;
      else process.env.PICLAW_DB_IN_MEMORY = previousDbInMemory;
      if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = previousNodeEnv;
    }
  });
});

test('getCompactionSettingsData exposes active backoffs and tracked phases and reset clears them', async () => {
  await withTempWorkspaceEnv('piclaw-compaction-settings-state-', {
    PICLAW_PROGRESS_WATCHDOG_TIMEOUT_MS: '30',
    PICLAW_TOOL_RESULT_COMPACTION_ENABLED: undefined,
    PICLAW_TOOL_RESULT_COMPACTION_TOOLS: 'bash,powershell,exec_batch',
    PICLAW_TOOL_RESULT_SEMANTIC_SUMMARY_ENABLED: undefined,
    PICLAW_TOOL_RESULT_SEMANTIC_SUMMARY_MAX_INPUT_CHARS: undefined,
    PICLAW_TOOL_RESULT_SEMANTIC_SUMMARY_MAX_TOKENS: undefined,
    PICLAW_TOOL_RESULT_SEMANTIC_SUMMARY_TIMEOUT_MS: undefined,
  }, async () => {
    const db = await importFresh<typeof import('../../src/db.js')>('../src/db.js');
    db.initDatabase();
    db.setChatCompactionBackoff('web:test-1', {
      failureCount: 2,
      lastFailedAt: '2026-04-29T11:00:00.000Z',
      backoffUntil: new Date(Date.now() + 10 * 60_000).toISOString(),
      lastErrorMessage: 'Compaction timed out',
    });
    db.setChatCompactionBackoff('web:test-expired', {
      failureCount: 1,
      lastFailedAt: '2026-04-29T10:00:00.000Z',
      backoffUntil: new Date(Date.now() - 60_000).toISOString(),
      lastErrorMessage: 'Expired suppression',
    });

    // Use the canonical singleton imported by the handler. Fresh-importing a
    // second watchdog module can reset the wrong process-global instance.
    const watchdog = await import('../../src/runtime/progress-watchdog.js');
    watchdog.resetProgressWatchdogForTests();
    watchdog.beginTrackedPhase('web:test-compaction-settings', 'prompt', { source: 'test' });

    try {
      const handler = await importFresh<typeof import('../../src/channels/web/handlers/compaction-settings.js')>(
        '../src/channels/web/handlers/compaction-settings.js',
      );

      const beforeReset = handler.getCompactionSettingsData();
      expect(typeof beforeReset.toolResultCompactionEnabled).toBe('boolean');
      expect(beforeReset.toolResultCompactionTools).toEqual(
        expect.arrayContaining(['bash', 'powershell', 'exec_batch']),
      );
      expect(typeof beforeReset.toolResultSemanticSummaryEnabled).toBe('boolean');
      expect(typeof beforeReset.toolResultSemanticSummaryMaxInputChars).toBe('number');
      expect(typeof beforeReset.toolResultSemanticSummaryMaxTokens).toBe('number');
      expect(typeof beforeReset.toolResultSemanticSummaryTimeoutSec).toBe('number');
      expect(beforeReset.compactionBackoffs).toEqual([
        expect.objectContaining({ chatJid: 'web:test-1', failureCount: 2, lastErrorMessage: 'Compaction timed out' }),
      ]);
      expect(beforeReset.progressWatchdogPhases).toEqual([
        expect.objectContaining({ chatJid: 'web:test-compaction-settings', phase: 'prompt' }),
      ]);

      const afterReset = handler.resetCompactionBackoff('web:test-1');
      expect(afterReset.compactionBackoffs).toEqual([]);
    } finally {
      watchdog.endTrackedPhase('web:test-compaction-settings');
      watchdog.resetProgressWatchdogForTests();
    }
  });
});
