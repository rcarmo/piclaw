import { afterAll, beforeAll, expect, test } from 'bun:test';
import { chromium, type Browser } from 'playwright';
import { linkifyChatReferences } from '../../web/src/ui/chat-reference-links';
import { normalizeProjectRepository } from '../../src/core/project-repository';
import { getChatProjectRepository, resetChatProjectStateForTests, seedChatProjectRepository, setChatProjectRepository, subscribeChatProject } from '../../web/src/ui/chat-project-state';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const enabled = process.env.PICLAW_RUN_OPTIONAL_BROWSER_TESTS === '1';
const browserTest = enabled ? test : test.skip;
let browser: Browser;
beforeAll(async () => { if (enabled) browser = await chromium.launch({ headless: true }); }, 30000);
afterAll(async () => { await browser?.close(); });

browserTest('numeric references are plain when unset and named hashtags remain timeline links', async () => {
  const page = await browser.newPage();
  try {
    const result = await page.evaluate(([source]) => {
      // Exercise source in a native browser DOM while keeping the test isolated.
      const fn = (0, eval)(`(${source.replace('normalizeProjectRepository(repositoryUrl)', 'repositoryUrl')})`);
      return fn('<p>#42 #bug <code>#43</code> <a href="https://x/#44">#44</a></p>', null);
    }, [linkifyChatReferences.toString()]);
    expect(result).toContain('#42'); expect(result).not.toContain('/issues/42');
    expect(result).toContain('class="hashtag"'); expect(result).toContain('<code>#43</code>');
    expect(result).toContain('href="https://x/#44"');
  } finally { await page.close(); }
}, 30000);

browserTest('numeric project links are safe external links with conservative token boundaries', async () => {
  const page = await browser.newPage();
  try {
    const result = await page.evaluate(([source]) => {
      const fn = (0, eval)(`(${source.replace('normalizeProjectRepository(repositoryUrl)', 'repositoryUrl')})`);
      return fn('<p>#42 #0 #042 owner/#43 color#123456 #44word</p>', 'https://gitea.example/team/repo');
    }, [linkifyChatReferences.toString()]);
    expect(result).toContain('href="https://gitea.example/team/repo/issues/42"');
    expect(result).toContain('target="_blank"'); expect(result).toContain('rel="noopener noreferrer"');
    expect(result).not.toContain('/issues/0'); expect(result).not.toContain('/issues/042');
    expect(result).not.toContain('/issues/43'); expect(result).not.toContain('/issues/123456'); expect(result).not.toContain('/issues/44');
  } finally { await page.close(); }
}, 30000);

test('chat project state keeps snapshots authoritative and rejects stale payload seeds', () => {
  resetChatProjectStateForTests();
  let a = 0, b = 0;
  const offA = subscribeChatProject('a', () => a++), offB = subscribeChatProject('b', () => b++);
  const old = { repository_url: 'https://github.com/a/old', source_branch_id: 'root', revision: '2026-01-01T00:00:00Z:root:1' };
  const next = { repository_url: 'https://github.com/a/next', source_branch_id: 'root', revision: '2026-01-02T00:00:00Z:root:2' };
  seedChatProjectRepository('a', old); seedChatProjectRepository('a', next); seedChatProjectRepository('a', old);
  expect(getChatProjectRepository('a')).toBe('https://github.com/a/next');
  setChatProjectRepository('a', { ...next, repository_url: 'https://github.com/a/live' });
  seedChatProjectRepository('a', { ...next, repository_url: 'https://github.com/a/stale' });
  expect(getChatProjectRepository('a')).toBe('https://github.com/a/live');
  expect(b).toBe(0); expect(a).toBe(3); offA(); offB();
});

test('the shipped markdown surface consume the shared project repository option', () => {
  const root = resolve(import.meta.dir, '../..');
  const classic = readFileSync(resolve(root, 'web/src/markdown.ts'), 'utf8');

  for (const source of [classic]) {
    expect(source).toContain('linkifyChatReferences');
    expect(source).toContain('options.projectRepository');
  }

});

test('repository URL normalisation accepts roots and rejects unsafe or known non-root paths', () => {
  expect(normalizeProjectRepository('https://github.com/o/r.git/')).toBe('https://github.com/o/r');
  expect(normalizeProjectRepository('https://gitea.example/o/r')).toBe('https://gitea.example/o/r');
  expect(normalizeProjectRepository('https://gitea.example/base/o/r')).toBe('https://gitea.example/base/o/r');
  for (const url of ['javascript:alert(1)', 'https://u:p@example.com/o/r', 'https://example.com/o/r?q=1', 'https://github.com/o/r/pull/1395', 'https://gitea.example/alice', 'https://gitea.example/base/o/r/issues/42', 'https://gitea.example/explore/repos', 'https://gitea.example/too/deep/o/r']) expect(() => normalizeProjectRepository(url)).toThrow();
});

browserTest('numeric-only mode leaves named user hashtags unchanged', async () => {
  const page = await browser.newPage();
  try {
    const result = await page.evaluate(([source]) => {
      const fn = (0, eval)(`(${source.replace('normalizeProjectRepository(repositoryUrl)', 'repositoryUrl')})`);
      return fn('<p>#42 #bug</p>', 'https://github.com/example/repo', false);
    }, [linkifyChatReferences.toString()]);
    expect(result).toContain('/issues/42'); expect(result).not.toContain('data-hashtag'); expect(result).toContain('#bug');
  } finally { await page.close(); }
}, 30000);
