import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const fixturePath = join(import.meta.dir, "../fixtures/markdown-live-preview-parity/atomic-port-parity.md");
const fixture = readFileSync(fixturePath, "utf8");

const parityMatrix = [
  { feature: "heading fold", patterns: ["# H1 Heading Fold Target", "## H2 Child Heading"] },
  { feature: "task checkboxes", patterns: ["- [ ] Top-level unchecked task", "- [x] Top-level checked task"] },
  { feature: "callout fold", patterns: ["> [!warning]- Collapsed warning", "> Body line hidden"] },
  { feature: "regular blockquote", patterns: ["> Regular blockquote", "> with continuation"] },
  { feature: "frontmatter", patterns: ["---\ntitle:", "tags: [piclaw, editor, atomic-port]"] },
  { feature: "footnotes", patterns: ["[^note]", "[^note]: Footnote definition", "[^missing]"] },
  { feature: "hashtags", patterns: ["#tag"] },
  { feature: "links", patterns: ["[safe link](https://example.com \"Example\")", "[reference link][ref-link]", "[collapsed ref][]", "[shortcut ref]", "[ref-link]: https://example.com/reference"] },
  { feature: "images", patterns: [
    "![Alt image](https://example.com/image.png \"Image title\")",
    "![Pasted image](atomic-port-parity-20260831-151050.png)",
    "![Relative image](assets/editor-preview.png)",
  ] },
  { feature: "code-copy blocks", patterns: ["```ts", "export function demo"] },
  { feature: "tables", patterns: ["| Left | Center | Right |", "|:-----|:------:|------:|", "x \\| y"] },
  { feature: "large document / late parse sentinel", patterns: ["### Long/viewport sentinel"] },
];

export const browserScenarioMatrix = [
  { viewport: "desktop", width: 1280, height: 900 },
  { viewport: "tablet", width: 1024, height: 768 },
  { viewport: "mobile", width: 390, height: 844 },
] as const;

test("Atomic port parity fixture covers all required Markdown feature classes", () => {
  for (const { feature, patterns } of parityMatrix) {
    for (const pattern of patterns) {
      expect(fixture.includes(pattern), `${feature}: missing ${pattern}`).toBe(true);
    }
  }
});

test("Atomic port browser scenario matrix covers desktop, tablet, and mobile viewports", () => {
  expect(browserScenarioMatrix.map((scenario) => scenario.viewport)).toEqual([
    "desktop",
    "tablet",
    "mobile",
  ]);
  for (const scenario of browserScenarioMatrix) {
    expect(scenario.width).toBeGreaterThan(0);
    expect(scenario.height).toBeGreaterThan(0);
  }
});
