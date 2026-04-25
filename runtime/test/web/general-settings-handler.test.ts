import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import '../helpers.js';
import { importFresh, withTempWorkspaceEnv } from '../helpers.js';

test('saveGeneralSettings persists and applies general settings immediately', async () => {
  await withTempWorkspaceEnv('piclaw-general-settings-', {}, async (workspace) => {
    const handler = await importFresh<typeof import('../../src/channels/web/handlers/general-settings.js')>(
      '../src/channels/web/handlers/general-settings.js',
    );

    const saved = await handler.saveGeneralSettings({
      assistantName: 'Smith',
      assistantAvatar: 'https://example.test/assistant.png',
      userName: 'Rui',
      userAvatar: 'https://example.test/user.png',
      sessionAutoRotate: false,
      sessionMaxSizeMb: 48,
      webTerminalEnabled: false,
      toolUseBudget: 23,
    });

    expect(saved).toMatchObject({
      assistantName: 'Smith',
      assistantAvatar: 'https://example.test/assistant.png',
      userName: 'Rui',
      userAvatar: 'https://example.test/user.png',
      sessionAutoRotate: false,
      sessionMaxSizeMb: 48,
      webTerminalEnabled: false,
      toolUseBudget: 23,
    });
    expect(handler.getGeneralSettingsData()).toMatchObject(saved);

    const persisted = JSON.parse(readFileSync(join(workspace.workspace, '.piclaw', 'config.json'), 'utf8'));
    expect(persisted).toMatchObject({
      assistant: {
        assistantName: 'Smith',
        assistantAvatar: 'https://example.test/assistant.png',
      },
      user: {
        userName: 'Rui',
        userAvatar: 'https://example.test/user.png',
      },
      sessionAutoRotate: false,
      sessionMaxSizeMb: 48,
      turnMaxToolUseMessages: 23,
      web: {
        terminalEnabled: false,
      },
    });
  });
});
