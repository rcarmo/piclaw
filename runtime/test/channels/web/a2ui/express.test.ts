import { describe, expect, test } from "bun:test";
import { applyA2uiMessages, compileA2uiExpress } from "../../../../src/channels/web/a2ui/express.js";
import { readA2uiImageUrl } from "../../../../src/channels/web/a2ui/surface.js";

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

  test("limits image sources to owned media and allowed image schemes", () => {
    const origin = 'https://fixture.test';
    for (const value of ['/media/42', `${origin}/media/42/thumbnail`, 'https://other.test/example.png', 'data:image/png;base64,AAAA']) {
      expect(readA2uiImageUrl(value, origin)).toBe(value);
    }
    for (const value of ['/agent/internal', `${origin}/agent/internal`, '/media/42?next=x', '/media/42\n',
      '//other.test/example.png', 'file:///tmp/image.png', 'data:text/html;base64,AAAA', 'https://user:pass@other.test/example.png']) {
      expect(readA2uiImageUrl(value, origin)).toBeUndefined();
    }
  });

  test("compiles Image with bound URL and catalogue variants", () => {
    const snapshot = applyA2uiMessages('picture', compileA2uiExpress(`
      $/url = "/media/42";
      root = Image(url=$/url, description="Project preview", fit="scaleDown", variant="avatar");
    `, 'picture'))!;
    expect(snapshot.components[0]).toEqual({ id:'root', component:'Image', url:{'@path':'/url'},
      description:'Project preview', fit:'scaleDown', variant:'avatar' });
  });

  test("resolves tab titles and validates their child graph", () => {
    const surface = 'tabs-1';
    const source = '$/title = "Details"; root = Tabs(tabs=[{title:"Overview",child:first},{title:$/title,child:second}]); first = Text("First panel"); second = Text("Second panel");';
    const snapshot = applyA2uiMessages(surface, compileA2uiExpress(source, surface))!;
    expect(snapshot.components.find(({id}) => id === 'root')).toEqual({ id:'root', component:'Tabs', tabs:[
      {title:'Overview', child:'first'}, {title:{'@path':'/title'}, child:'second'},
    ] });
    for (const child of ['root','missing','first']) {
      const invalid = source.replace('child:second', `child:${child}`);
      expect(() => applyA2uiMessages(surface, compileA2uiExpress(invalid, surface))).toThrow();
    }
  });

  test("validates modal trigger and content as separate parts of the component tree", () => {
    const source = 'root=Modal(trigger=show, content=details); show=Text("Open"); details=Text("Details");';
    const snapshot = applyA2uiMessages('modal', compileA2uiExpress(source, 'modal'))!;
    expect(snapshot.components.find(({id}) => id === 'root')).toEqual({ id:'root', component:'Modal', trigger:'show', content:'details' });
    for (const invalid of [source.replace('content=details','content=show'), source.replace('trigger=show','trigger=root'),
      source.replace('content=details','content=missing'), 'root=Button(Text("No action outside a modal"));']) {
      expect(() => applyA2uiMessages('modal', compileA2uiExpress(invalid, 'modal'))).toThrow();
    }
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
    'root = Image(url="https://example.com/x", fit="invalid")',
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
