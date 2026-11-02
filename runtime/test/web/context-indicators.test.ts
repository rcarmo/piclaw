import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parse } from "@babel/parser";
import { h, type VNode } from "preact";
import htm from "htm";
// Use the same Preact JSX transform as the Visual browser build (the root
// runtime test tsconfig intentionally has no JSX configuration).
const built = await Bun.build({
  entrypoints: [join(import.meta.dir, "../../web/static/visual/frontend/src/components/model-context-bar/ContextRing.tsx")],
  target: "bun",
  jsx: { runtime: "automatic", importSource: "preact" },
});
if (!built.success) throw Error(String(built.logs));
const { ContextRing } = await import(`data:text/javascript;base64,${Buffer.from(await built.outputs[0].text()).toString("base64")}`);

// Evaluate the actual private Classic functions without exporting a production test API.
const source = readFileSync(join(import.meta.dir, "../../web/src/components/compose-box.ts"), "utf8");
const ast = parse(source, { sourceType: "module", plugins: ["typescript"] });
function productionFunction(name: string) {
  const node = ast.program.body.find(node => node.type === "FunctionDeclaration" && node.id?.name === name);
  if (!node || node.start == null || node.end == null) throw Error(`Missing ${name}`);
  return source.slice(node.start, node.end);
}
const ContextPie = new Function("html", `${productionFunction("formatK")}\n${productionFunction("ContextPie")}\nreturn ContextPie;`)(htm.bind(h));
const usage = { tokens: 80000, contextWindow: 100000, percent: 80 };
const classic = ContextPie({ usage, onCompact() {} }) as VNode<any>;
const visual = ContextRing({ ...usage, onClick() {} });

test("both actual context indicator VNodes project backend 80%, not a second safety budget", () => {
  expect(classic.props.title).toContain("Context: 80K / 100K tokens (80%)");
  expect(visual.props.title).toContain("Context: 80k / 100k tokens (80%)");
});

function indicators(value: { tokens: number | null | undefined; contextWindow: number | null | undefined; percent: number | null | undefined }) {
  return [ContextPie({ usage: value, onCompact() {} }), ContextRing({ ...value, onClick() {} })] as VNode<any>[];
}
function mark(node: VNode<any>, skin: number): VNode<any> {
  const children = node.props.children as VNode<any>[];
  return [children[0].props.children].flat()[skin === 0 ? 1 : 0];
}

test("unknown percentages stay unavailable even with known counts; unknown tokens never become zero", () => {
  for (const percent of [null, undefined, NaN, Infinity]) {
    indicators({ ...usage, percent }).forEach((node, skin) => {
      expect(node.props.title).toContain("(unavailable)");
      expect(node.props.title).not.toContain("(0%)");
      expect(mark(node, skin).props[skin === 0 ? "stroke" : "fill"]).toBe(skin === 0 ? "var(--text-secondary)" : "var(--text-muted)");
    });
  }
  for (const tokens of [null, undefined, NaN, Infinity, -1]) {
    indicators({ ...usage, tokens }).forEach((node, skin) => {
      expect(node.props.title).toContain(`Context: ${skin === 0 ? "?" : "--"} /`);
      expect(node.props.title).toContain("(80%)");
    });
  }
  for (const contextWindow of [null, undefined, NaN, Infinity, 0, -1]) {
    indicators({ ...usage, contextWindow }).forEach((node, skin) => {
      expect(node.props.title).toContain(skin === 0 ? "/ ? tokens" : "/ -- tokens");
    });
  }
  indicators({ tokens: null, contextWindow: null, percent: null }).forEach((node, skin) => {
    expect(node.props.title).toBe(`Context: ${skin === 0 ? "? / ?" : "-- / --"} tokens (unavailable)\nCompact context`);
    expect(node.props["aria-label"]).toBe(node.props.title);
  });
});

test("valid zero, token/window notation and backend percentages are independent", () => {
  indicators({ ...usage, tokens: 0, percent: 0 }).forEach((node, skin) => {
    expect(node.props.title).toBe(`Context: ${skin === 0 ? "0 / 100K" : "0k / 100k"} tokens (0%)\nCompact context`);
  });
  for (const [percent, displayed] of [[12.4, 12], [-10, 0], [120, 100]]) {
    indicators({ ...usage, percent }).forEach(node => expect(node.props.title).toContain(`(${displayed}%)`));
  }
  indicators({ tokens: 1200000, contextWindow: 2000000, percent: 40 }).forEach(node => {
    expect(node.props.title).toContain("1.2M / 2.0M tokens (40%)");
  });
});

test("both skins use Classic's strict >75 warning and >90 danger thresholds", () => {
  for (const [percent, level] of [[0, 0], [70, 0], [75, 0], [75.1, 1], [80, 1], [90, 1], [90.1, 2], [100, 2]]) {
    indicators({ ...usage, percent }).forEach((node, skin) => {
      const colors = skin === 0
        ? ["var(--context-green, #22c55e)", "var(--context-amber, #f59e0b)", "var(--context-red, #ef4444)"]
        : ["var(--success)", "var(--warning)", "var(--error)"];
      expect(mark(node, skin).props[skin === 0 ? "stroke" : "fill"]).toBe(colors[level]);
    });
  }
});

test("Classic remains a native button; Visual click/Enter/Space explicitly compact and ignore other keys", () => {
  let calls = 0;
  const pie = ContextPie({ usage, onCompact: () => calls++ });
  expect(pie.type).toBe("button"); expect(pie.props.type).toBe("button"); expect(pie.props.disabled).toBe(false);
  const event = () => ({ preventDefault() {}, stopPropagation() {} });
  pie.props.onClick(event());
  expect(calls).toBe(1);
  const ring = ContextRing({ ...usage, onClick: () => calls++ });
  expect(ring.props.role).toBe("button"); expect(ring.props.tabIndex).toBe(0);
  ring.props.onClick(event());
  for (const key of ["Enter", " ", "Escape", "ArrowDown"]) ring.props.onKeyDown({ ...event(), key });
  expect(calls).toBe(4);
  const disabled = ContextPie({ usage });
  expect(disabled.props.disabled).toBe(true); disabled.props.onClick(event()); expect(calls).toBe(4);
  const compacting = ContextPie({ usage, onCompact() {}, compactionLabel: "0:12", compactionTitle: "Smart compaction" });
  expect(compacting.props.title).toContain("Smart compaction · 0:12");
  expect(compacting.props.class).toContain("is-compacting");
});
