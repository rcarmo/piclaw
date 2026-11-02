import { expect, test } from 'bun:test';
import { readFileSync,writeFileSync } from 'node:fs';
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

    expect(handler.getCompactionSettingsData().localLitePromptProfileEnabled).toBe(false);
    expect((await handler.saveCompactionSettings({ localLitePromptProfileEnabled: true })).localLitePromptProfileEnabled).toBe(true);
    expect((await handler.saveCompactionSettings({ localLitePromptProfileEnabled: false })).localLitePromptProfileEnabled).toBe(false);
    const saved = await handler.saveCompactionSettings({
      autoCompactionEnabled: false,
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
        },
        watchdog: {
          enabled: true,
        },
      },
    });

    config.setCompactionRuntimeConfigForTests({ ...runtimeBefore });
    expect(config.getCompactionRuntimeConfig()).toEqual(runtimeBefore);
    if (previousAutoCompactionAlias === undefined) delete process.env.PICLAW_AUTO_COMPACTION_ENABLED;
    else process.env.PICLAW_AUTO_COMPACTION_ENABLED = previousAutoCompactionAlias;
  });
});

test('native compaction rejects every retired field before any supported setting is written', async () => {
  await withTempWorkspaceEnv('native-compaction-rejection-', {PICLAW_AUTO_COMPACTION_ENABLED: undefined}, async (workspace) => {
    const db = await importFresh<typeof import('../../src/db.js')>('../src/db.js'); db.initDatabase();
    const config = await import('../../src/core/config.js');
    const beforeRuntime = config.getCompactionRuntimeConfig();
    try {
      config.setCompactionRuntimeConfig({ autoCompactionEnabled: true });
      const handler = await importFresh<typeof import('../../src/channels/web/handlers/compaction-settings.js')>('../src/channels/web/handlers/compaction-settings.js');
      const file = join(workspace.workspace, '.piclaw', 'config.json');
      const historical=JSON.parse(readFileSync(file,'utf8'));Object.assign(historical.domains.compaction,{smartCompactionMethod:'pipelined',model:'local/historical',thresholdPercent:73});writeFileSync(file,JSON.stringify(historical));
      const beforeFile = readFileSync(file, 'utf8'), before = handler.getCompactionSettingsData();
      for (const field of handler.UNSUPPORTED_NATIVE_COMPACTION_FIELDS) {
        for (const value of ['pipelined', false, null, undefined]) {
          await expect(handler.saveCompactionSettings({ autoCompactionEnabled: false, localLitePromptProfileEnabled: true,
            progressWatchdogEnabled: true, [field]: value })).rejects.toThrow('Unsupported native compaction settings: ' + field);
          expect(readFileSync(file, 'utf8')).toBe(beforeFile);
          expect(handler.getCompactionSettingsData()).toEqual(before);
        }
      }
      await expect(handler.saveCompactionSettings({autoCompactionEnabled: 'false'})).rejects.toThrow('must be a boolean');
      expect(readFileSync(file, 'utf8')).toBe(beforeFile);
      process.env.PICLAW_AUTO_COMPACTION_ENABLED = '1';
      await expect(handler.saveCompactionSettings({autoCompactionEnabled: false, localLitePromptProfileEnabled: true})).rejects.toThrow('overridden by PICLAW_AUTO_COMPACTION_ENABLED');
      expect(readFileSync(file, 'utf8')).toBe(beforeFile);
      process.env.PICLAW_AUTO_COMPACTION_ENABLED = 'invalid'; // Domain ignores invalid deprecated overrides.
      const saved = await handler.saveCompactionSettings({autoCompactionEnabled: false});
      expect(saved.compactionPolicy).toBe('pi-durable'); expect(saved.autoCompactionEnabled).toBe(false);
      for (const field of [...handler.UNSUPPORTED_NATIVE_COMPACTION_FIELDS, 'compactionLatencyEstimate', 'remoteCompactionSupportedProviders', 'compactionBackoffs']) expect(saved).not.toHaveProperty(field);
      expect(config.getCompactionRuntimeConfig()).not.toHaveProperty('smartCompactionMethod');
      expect(config.getCompactionRuntimeConfig()).not.toHaveProperty('compactionModel');
      expect(config.getCompactionRuntimeConfig()).not.toHaveProperty('thresholdPercent');
      expect(JSON.parse(readFileSync(file,'utf8')).domains.compaction).toMatchObject({smartCompactionMethod:'pipelined',model:'local/historical',thresholdPercent:73,autoCompactionEnabled:false});
    } finally { config.setCompactionRuntimeConfigForTests({...beforeRuntime}); }
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

test('native settings retain independent tracked phases without exposing or deleting historical backoffs', async () => {
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
    const { initializeChatCursorStorage, legacyCursorArchive } = await import('../../src/db/chat-cursor-storage.js');
    // Replace this blank synthetic polling fixture with its pre-ledger source,
    // then use the real owned upgrade. No production recovery writer remains.
    expect(db.getDb().query('SELECT COUNT(*) AS n FROM chat_cursors').get()).toEqual({n:0});
    db.getDb().transaction(() => {
      db.getDb().exec("DROP TABLE chat_cursors; DELETE FROM piclaw_schema_migrations WHERE owner='host.chat-cursors'");
      db.getDb().exec(readFileSync(new URL('../fixtures/legacy-chat-cursors.sql',import.meta.url),'utf8'));
      const insert = db.getDb().query('INSERT INTO chat_cursors(chat_jid,compaction_failure_count,compaction_last_failed_at,compaction_backoff_until,compaction_last_error) VALUES(?,?,?,?,?)');
      insert.run('web:test-1',2,'2026-04-29T11:00:00.000Z',new Date(Date.now()+10*60_000).toISOString(),'Compaction timed out');
      insert.run('web:test-expired',1,'2026-04-29T10:00:00.000Z',new Date(Date.now()-60_000).toISOString(),'Expired suppression');
      initializeChatCursorStorage(db.getDb());
    })();
    const archived = db.getDb().query('SELECT rowid,* FROM '+legacyCursorArchive+' ORDER BY rowid').all();

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
      expect(beforeReset).not.toHaveProperty('compactionBackoffs');
      expect(beforeReset.progressWatchdogPhases).toEqual([
        expect.objectContaining({ chatJid: 'web:test-compaction-settings', phase: 'prompt' }),
      ]);

      expect(db.getDb().query('SELECT rowid,* FROM '+legacyCursorArchive+' ORDER BY rowid').all()).toEqual(archived);
      expect(db.getDb().query('SELECT compaction_failure_count,compaction_last_error FROM '+legacyCursorArchive+' WHERE chat_jid=?').get('web:test-1')).toEqual({compaction_failure_count:2,compaction_last_error:'Compaction timed out'});
      expect(db.getDb().query('SELECT compaction_failure_count,compaction_last_error FROM '+legacyCursorArchive+' WHERE chat_jid=?').get('web:test-expired')).toEqual({compaction_failure_count:1,compaction_last_error:'Expired suppression'});
    } finally {
      watchdog.endTrackedPhase('web:test-compaction-settings');
      watchdog.resetProgressWatchdogForTests();
    }
  });
});
