import { describe, expect, test } from "bun:test";
import { applyA2uiMessages, compileA2uiExpress } from "../../../../src/channels/web/a2ui/express.js";

const form = `
  # Standard upstream Express, not a Piclaw form parser.
  $/form/name = "";
  $/form/notify = false;
  root = Column([
    Text("Your details"),
    TextField(label="Name", value=$/form/name),
    CheckBox(label="Notify me", value=$/form/notify),
    Button(child=Text("Send"), action=Event("submit", {name: $/form/name, notify: $/form/notify}))
  ])
`;

describe("Classic A2UI Express", () => {
  test("compiles upstream Express to v1.0 wire messages and a durable snapshot", () => {
    const messages = compileA2uiExpress(form, "form-1");
    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({ version: "1.0", createSurface: { surfaceId: "form-1" } });
    const snapshot = applyA2uiMessages("form-1", messages)!;
    expect(snapshot.dataModel).toEqual({ form: { name: "", notify: false } });
    expect(snapshot.components).toContainEqual(expect.objectContaining({
      component: "Button",
      action: { event: { name: "submit", context: { name: { "@path": "/form/name" }, notify: { "@path": "/form/notify" } } } },
    }));
  });

  test("compiles standard fixed List children and keeps their order in the snapshot", () => {
    const messages = compileA2uiExpress('root = List(children=[first, second], direction="horizontal", align="center"); first = Text("First"); second = Text("Second")', "list-1");
    const snapshot = applyA2uiMessages("list-1", messages)!;
    expect(snapshot.components.find(({ id }) => id === "root")).toEqual({
      id: "root", component: "List", children: ["first", "second"], direction: "horizontal", align: "center",
    });
    const broken = { ...snapshot, components: snapshot.components.filter(({ id }) => id !== "second") };
    expect(() => applyA2uiMessages("list-1", [{ version: "1.0", updateDataModel: { surfaceId: "list-1", path: "/x", value: 1 } }], broken)).toThrow();
  });

  test("applies component and data updates atomically to a rehydrated snapshot, then deletes it", () => {
    const initial = applyA2uiMessages("form-1", compileA2uiExpress(form, "form-1"))!;
    const original = JSON.stringify(initial);
    const messages = compileA2uiExpress('surface("form-1", update=true); root_children_0 = Text("Updated"); $/form/name = "Sam"', "form-1");
    const next = applyA2uiMessages("form-1", messages, JSON.parse(original))!;
    expect(next.dataModel).toEqual({ form: { name: "Sam", notify: false } });
    expect(next.components).toContainEqual({ id: "root_children_0", component: "Text", text: "Updated" });
    expect(JSON.stringify(initial)).toBe(original);
    expect(() => applyA2uiMessages("form-1", [...messages, ...compileA2uiExpress('surface("other", update=true); $/x = 1', "form-1")], initial)).toThrow();
    expect(JSON.stringify(initial)).toBe(original);
    expect(applyA2uiMessages("form-1", compileA2uiExpress('deleteSurface("form-1")', "form-1"), next)).toBeNull();
  });

  test.each([
    'not even express',
    'root = Image("https://example.com/x")',
    'root = Button(Text("Go"), action=openUrl("javascript:alert(1)"))',
    'surface("form-1", sendDataModel=true); root = Text("Hello")',
    'surface("other"); root = Text("Wrong surface")',
    'root = Text("One"); surface("other"); root = Text("Two")',
    'root = Column([missing])',
    'root = Text($/constructor/name)',
    `root = ${"Card(".repeat(64)}Text("Nested")${")".repeat(64)}`,
    `root = Text("${"x".repeat(32_768)}")`,
  ])("rejects invalid or unsupported authoring: %.60s", (source) => {
    expect(() => applyA2uiMessages("form-1", compileA2uiExpress(source, "form-1"))).toThrow();
  });

  test("bounds direct wire input before applying it", () => {
    const messages = compileA2uiExpress(form, "form-1");
    const initial = applyA2uiMessages("form-1", messages)!;
    expect(() => applyA2uiMessages("form-1", [...messages, ...messages])).toThrow();
    for (const path of ["/form/__proto__", "/form/constructor", "/form/~1prototype", "/9999999"]) {
      expect(() => applyA2uiMessages("form-1", [{ version: "1.0", updateDataModel: { surfaceId: "form-1", path, value: 1 } }], initial)).toThrow();
    }
    expect(() => applyA2uiMessages("form-1", [{ version: "1.0", callFunction: { surfaceId: "form-1" } }], initial)).toThrow();
    expect(() => applyA2uiMessages("form-1", [{ version: "1.0", updateComponents: { surfaceId: "form-1", components: [{ id: "root", component: "Column", children: ["root"] }] } }], initial)).toThrow();
  });
});

test('allows a static HTTP(S) browser link, not a remote call or an expression URL', () => {
  const link = 'root = Button(Text("Docs"), action=openUrl("https://example.com/docs"))';
  expect(applyA2uiMessages('docs', compileA2uiExpress(link,'docs'))?.components[0]).toMatchObject({
    action: { functionCall: { '@call': 'openUrl', args: { url: 'https://example.com/docs' } } },
  });
  for (const source of [
    '$/target = "https://example.com"; root = Button(Text("Docs"), action=openUrl($/target))',
    'root = Button(Text("Docs"), action=openUrl("https://user:password@example.com"))',
    'root = Text(openUrl("https://example.com"))',
  ]) expect(() => applyA2uiMessages('docs', compileA2uiExpress(source,'docs'))).toThrow();
});
