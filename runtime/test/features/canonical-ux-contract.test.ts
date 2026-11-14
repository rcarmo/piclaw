import { expect, test } from "bun:test";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, relative, resolve } from "node:path";

// Specification structure only. Browser behaviour is tested separately; no text/hash
// oracle establishes implementation. Real browser assertions for shared SVG live
// in test/web/svg-images.optional.test.ts (Chromium and WebKit in CI).
const featuresRoot = resolve(import.meta.dir, "../../../tests/e2e/features");

function featureFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    return entry.isDirectory() ? featureFiles(path) : entry.name.endsWith(".feature") ? [path] : [];
  });
}

function stableIds(source: string): string[] {
  return source.split("\n")
    .filter((line) => /^\s*@/.test(line))
    .flatMap((line) => line.match(/@ux-[a-z0-9-]+/g) ?? []);
}

const files = featureFiles(featuresRoot);
const sourceFor = (path: string) => readFileSync(join(featuresRoot, path), "utf8");

test("current and planned specifications have disjoint stable scenario identities", () => {
  const allIds: string[] = [];
  for (const file of files) {
    const path = relative(featuresRoot, file).replaceAll("\\", "/");
    expect(["classic", "shared", "planned"]).toContain(path.split("/")[0]);
    const source = readFileSync(file, "utf8");
    const ids = stableIds(source);
    const scenarios = source.match(/^\s*Scenario(?: Outline)?:/gm) ?? [];
    expect(ids.length).toBe(scenarios.length);
    allIds.push(...ids);
    const featureTags = source.split(/^\s*Feature:/m)[0];
    if (path.startsWith("planned/")) {
      expect(featureTags).toContain("@planned");
      expect(featureTags).toContain("@not-implemented");
      expect(featureTags).not.toContain("@source-reviewed");
      expect(featureTags).not.toContain("@current-behavior");
    } else {
      if (path.startsWith("shared/")) {
        expect(featureTags).toContain("@shared");
        expect(featureTags).toContain("@implemented");
        expect(featureTags).toContain("@browser-verified");
      }
      expect(featureTags).not.toContain("@planned");
      expect(featureTags).not.toContain("@not-implemented");
    }
  }
  expect(new Set(allIds).size).toBe(allIds.length);
  expect(existsSync(join(featuresRoot, "canonical/canonical-ux.feature"))).toBe(false);
});

test("the original SVG identity belongs to shared image acceptance, not a source-only rule", () => {
  const classic = sourceFor("classic/canonical/canonical-ux.feature");
  const planned = sourceFor("shared/svg-images.feature");
  expect(stableIds(classic)).toEqual(Array.from({ length: 28 }, (_, i) => `@ux-original-${String(i + 1).padStart(3, "0")}`));
  expect(stableIds(planned)).toEqual([
    "@ux-original-029",
    ...Array.from({ length: 9 }, (_, i) => `@ux-svg-${String(i + 1).padStart(3, "0")}`),
  ]);
  expect(planned.split(/^\s*Feature:/m)[0]).toContain("@issue-1325");
});
