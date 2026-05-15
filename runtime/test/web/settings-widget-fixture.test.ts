import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const repoRoot = join(import.meta.dir, "../..");

test("settings widget fixture static shell references the fixture bundle and app CSS", () => {
  const html = readFileSync(join(repoRoot, "test/fixtures/settings-widget-fixture.html"), "utf8");
  expect(html).toContain('/static/classic/dist/app.bundle.css');
  expect(html).toContain('/static/classic/dist/settings-widget-fixture.bundle.js');
});

test("build:web includes the settings widget fixture entrypoint", () => {
  const packageJson = readFileSync(join(repoRoot, "../package.json"), "utf8");
  expect(packageJson).toContain('web/src/dev/settings-widget-fixture.ts');
});

test("settings dialog renders lazy built-in sections", () => {
  const source = readFileSync(join(repoRoot, "web/src/components/settings-dialog.ts"), "utf8");
  expect(source).toContain("recordings: () => import('./settings/recordings.js').then(mod => mod.RecordingsSection)");
  expect(source).toContain("case 'recordings': return html`<${Comp} filter=${filter} setStatus=${setStatus} />`;");
  expect(source).toContain("shell: () => import('./settings/shell.js').then(mod => mod.ShellSection)");
  expect(source).toContain("case 'shell': return html`<${Comp} filter=${filter} setStatus=${setStatus} />`;");
});

test("settings widget fixture HTML helper emits a dashboard-widget iframe shell", async () => {
  const proc = Bun.spawn({
    cmd: ["bun", "runtime/scripts/settings-widget-fixture-html.ts", "addons"],
    cwd: join(repoRoot, ".."),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, exitCode] = await Promise.all([new Response(proc.stdout).text(), proc.exited]);
  expect(exitCode).toBe(0);
  expect(stdout).toContain('/test/fixtures/settings-widget-fixture.html?section=addons');
  expect(stdout).toContain('<iframe');
});
