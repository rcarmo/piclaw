import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
const css = (skin: string, file: string) =>
  readFileSync(
    join(import.meta.dir, `../../web/static/${skin}/css/${file}`),
    "utf8",
  );

test("picker button native appearance reset stays scoped to picker surfaces", () => {
  const classic = css("classic", "chat.css");

  expect(classic).toContain(".compose-model-popup :where(button) {");

  for (const source of [classic]) {
    const reset = source.slice(source.indexOf(":where(button)")).split("}")[0];
    for (const rule of [
      "-webkit-appearance: none;",
      "appearance: none;",
      "box-sizing: border-box;",
      "margin: 0;",
      "font-family: inherit;",
      "line-height: 1.25;",
      "letter-spacing: normal;",
    ])
      expect(reset).toContain(rule);
  }
});

test("picker controls define picker action geometry and retain separate mobile targets", () => {
  const classic = css("classic", "chat.css");

  const blocks = [
    classic.split(".compose-model-popup-btn {")[1].split("}")[0],
  ];
  for (const block of blocks) {
    expect(block).toContain("min-height: 28px;");
    expect(block).toContain("12px/15px");
    expect(block).toContain("padding: 4px 8px;");
    expect(block).toContain("border: 1px solid");
    expect(block).toContain("align-items: center;");
    expect(block).toContain("white-space: nowrap;");
  }
  expect(classic).toContain(
    ".compose-session-popup .compose-model-popup-btn {\n        min-height: 44px;",
  );

  expect(classic).toContain(
    ".compose-model-catalogue-footer-start {\n    display: flex;\n    align-items: center;",
  );
});

test("picker action focus and disabled states are explicit and hover excludes disabled buttons", () => {
  const classic = css("classic", "chat.css");

  expect(classic).toContain(".compose-model-popup-btn:hover:not(:disabled)");
  expect(classic).toContain(
    ".compose-model-popup-btn:focus-visible {\n    outline: 2px solid var(--accent-color);",
  );

  for (const [source, selector] of [
    [classic, ".compose-model-popup-btn:disabled"],
  ]) {
    const block = source.split(selector + " {")[1].split("}")[0];
    expect(block).toContain("opacity: 0.5;");
    expect(block).toContain("cursor: not-allowed;");
  }
});
