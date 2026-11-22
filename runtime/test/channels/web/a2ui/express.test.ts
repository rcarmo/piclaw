import { describe, expect, test } from "bun:test";
import { applyA2uiMessages, compileA2uiExpress } from "../../../../src/channels/web/a2ui/express.js";
import { basicCatalog } from '@a2ui/web_core/catalogs/basic/v1';
import { a2uiIconPaths } from '../../../../web/src/components/a2ui-icon-paths.js';
import { readA2uiValue } from '../../../../src/channels/web/a2ui/action.js';
import { CLASSIC_A2UI_PROPERTIES, readA2uiImageUrl } from "../../../../src/channels/web/a2ui/surface.js";

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

  test("compiles native audio and video players with bound sources and poster", () => {
    const source = '$/clip="/media/51"; root=Column([AudioPlayer(url=$/clip, description="Recording"), Video(url="https://media.test/clip.mp4", posterUrl="/media/42")]);';
    const snapshot = applyA2uiMessages('media', compileA2uiExpress(source,'media'))!;
    expect(snapshot.components).toContainEqual(expect.objectContaining({component:'AudioPlayer', url:{'@path':'/clip'}, description:'Recording'}));
    expect(snapshot.components).toContainEqual(expect.objectContaining({component:'Video', url:'https://media.test/clip.mp4', posterUrl:'/media/42'}));
  });

  test('registers every Basic v1 component and has a local vector for every named icon', () => {
    const definition = basicCatalog.toJson().components as unknown as {
      Icon: {properties: {name: {oneOf:[{enum: string[]}]}}};
    };
    expect(Object.keys(CLASSIC_A2UI_PROPERTIES).sort()).toEqual(Object.keys(definition).sort());
    expect(Object.keys(a2uiIconPaths).sort()).toEqual([...definition.Icon.properties.name.oneOf[0].enum].sort());
  });

  test("accepts standard icons, bound SVG paths and icon-only buttons", () => {
    const source = '$/path="M2 2 L8 8"; root=Column([Icon(name="accountCircle"), Icon(name={svgPath:$/path}), Button(Icon(name="check"), action=Event("ok"))]);';
    const result = applyA2uiMessages('icons', compileA2uiExpress(source,'icons'))!;
    expect(result.components.filter(component => component.component === 'Icon').map(component => component.name))
      .toEqual(['accountCircle', { svgPath: { '@path':'/path' } }, 'check']);
  });

  test('accepts catalogue choice presentation and weights only within Rows and Columns', () => {
    const source = '$/values=[]; root=Row([choice, other]); choice=ChoicePicker(value=$/values, options=[{label:"Alpha",value:"a"}], displayStyle="chips", filterable=true, weight=2); other=Text("Other", weight=1);';
    const snapshot = applyA2uiMessages('layout', compileA2uiExpress(source,'layout'))!;
    expect(snapshot.components.find(item => item.id === 'choice')).toMatchObject({displayStyle:'chips', filterable:true, weight:2});
    expect(snapshot.components.find(item => item.id === 'other')?.weight).toBe(1);
    for (const invalid of ['root=Text("Outside", weight=1);', 'root=List(children=[Text("List child", weight=1)]);', source.replace('weight=2','weight=-1')]) {
      expect(() => applyA2uiMessages('layout', compileA2uiExpress(invalid, 'layout'))).toThrow();
    }
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

  test('preserves canonical accessibility descriptors through component updates and JSON rehydration', () => {
    const id = 'accessible';
    const component = { id:'root', component:'Text', text:'Status', '@accessibility':{
      label:{'@path':'/label'}, description:'Current state', live:'polite', hidden:{'@path':'/hide'},
    }};
    const initial = applyA2uiMessages(id, [{ version:'1.0', createSurface:{surfaceId:id,
      catalogId:'https://a2ui.org/specification/v1_0/catalogs/basic/catalog.json', components:[component], dataModel:{label:'State',hide:false},
    }}])!;
    expect(initial.components[0]).toEqual(component);
    const next = applyA2uiMessages(id, [{ version:'1.0', updateDataModel:{surfaceId:id,path:'/hide',value:true} }], JSON.parse(JSON.stringify(initial)))!;
    expect(next.components[0]).toEqual(component);
    for (const properties of [ { ...component, accessibility:{label:'conflict'} },
      { ...component, '@accessibility':{ live:'urgent' } }, { ...component, '@accessibility':{ 'aria-owns':'ancestor' } } ]) {
      expect(() => applyA2uiMessages(id, [{version:'1.0',updateComponents:{surfaceId:id,components:[properties]}}], initial)).toThrow();
    }
  });

  test('keeps opaque surface and component extensions without evaluating unknown keys', () => {
    const surfaceId = 'metadata';
    const catalogId = 'https://a2ui.org/specification/v1_0/catalogs/basic/catalog.json';
    const surfaceMeta = { extensions:{ org_example_audit:{ level:2 } } };
    const componentMeta = { extensions:{ org_example_unknown:{ '@call':'not_a_catalogue_function', '@path':'literal', nested:[1,2] } } };
    const creation = { version:'1.0',createSurface:{surfaceId,catalogId,metadata:surfaceMeta,
      components:[{id:'root',component:'Text',text:'Example','@metadata':componentMeta}],
    }};
    const snapshot = applyA2uiMessages(surfaceId,[creation])!;
    expect(snapshot.metadata).toEqual(surfaceMeta);
    expect(snapshot.components[0]?.['@metadata']).toEqual(componentMeta);
    const dataOnly = applyA2uiMessages(surfaceId,[{version:'1.0',updateDataModel:{surfaceId,value:{}}}], JSON.parse(JSON.stringify(snapshot)))!;
    expect(dataOnly.components[0]?.['@metadata']).toEqual(componentMeta);
    const cleared = applyA2uiMessages(surfaceId,[{version:'1.0',updateComponents:{surfaceId,
      components:[{id:'root',component:'Text',text:'Updated'}],
    }}], dataOnly)!;
    expect(cleared.metadata).toEqual(surfaceMeta);
    expect(cleared.components[0]).not.toHaveProperty('@metadata');
    expect(() => applyA2uiMessages(surfaceId,[{...creation,createSurface:{...creation.createSurface,theme:{primaryColor:'red'}}}])).toThrow();
    expect(() => applyA2uiMessages(surfaceId,[{...creation,createSurface:{...creation.createSurface,metadata:{extensions:{'invalid-key':1}}}}])).toThrow();
  });

  test('bounds expansion across nested templates', () => {
    const surfaceId = 'nested';
    const spec = `
      $/groups = [{items:[{name:"A"},{name:"B"}]},{items:[{name:"C"}]}];
      root = Column(_template($/groups, group));
      group = List(_template($items, item));
      item = Text($name);
    `;
    const initial = applyA2uiMessages(surfaceId, compileA2uiExpress(spec,surfaceId))!;
    const changed = applyA2uiMessages(surfaceId, [{ version:'1.0', updateDataModel:{surfaceId, path:'/groups/1/items', value:[]} }], initial)!;
    expect(changed.dataModel.groups).toEqual([{items:[{name:'A'},{name:'B'}]},{items:[]}]);
    expect(() => applyA2uiMessages(surfaceId, [{ version:'1.0', updateDataModel:{surfaceId, path:'/groups',
      value:Array.from({length:24}, () => ({items:Array.from({length:24}, () => ({name:'x'}))}))} }], initial)).toThrow(/oversized A2UI template tree/);
    expect(() => applyA2uiMessages(surfaceId, compileA2uiExpress(spec.replace('$items, item','$items, root'),surfaceId))).toThrow();
  });

  test('uses the same escaped JSON Pointer for updates and reads', () => {
    const surfaceId = 'pointer';
    const original = applyA2uiMessages(surfaceId, [{ version:'1.0', createSurface: {
      surfaceId, catalogId:'https://a2ui.org/specification/v1_0/catalogs/basic/catalog.json',
      components:[{id:'root',component:'Text',text:{'@path':'/a~1b/~0note label'}}],
      dataModel:{'a/b':{'~note label':'First'}, values:['A','B','C']},
    }}])!;
    const update = (path: string | undefined, value: unknown) => ({ version:'1.0', updateDataModel: {
      surfaceId, ...(path === undefined ? {} : {path}), value,
    }});
    const binding = {'@path':'/a~1b/~0note label'};
    expect(readA2uiValue(original, binding)).toBe('First');
    const changed = applyA2uiMessages(surfaceId, [update('/a~1b/~0note label','Second'), update('/values/1',null)], original)!;
    expect(readA2uiValue(changed, binding)).toBe('Second');
    expect(changed.dataModel.values).toEqual(['A',null,'C']);
    const hydrated = JSON.parse(JSON.stringify(changed));
    const removed = applyA2uiMessages(surfaceId, [update('/a~1b/~0note label',null)], hydrated)!;
    expect(removed.dataModel['a/b']).toEqual({});
    expect(readA2uiValue(removed, binding)).toBeUndefined();
    expect(readA2uiValue(original, binding)).toBe('First');
    expect(applyA2uiMessages(surfaceId, [update(undefined, { kept:true })], removed)?.dataModel).toEqual({kept:true});
    expect(applyA2uiMessages(surfaceId, [update('/',null)], removed)?.dataModel).toEqual({});
    expect(() => applyA2uiMessages(surfaceId, [{ version:'1.0', updateDataModel:{surfaceId, path:'/values'} }], original)).toThrow();
    expect(() => applyA2uiMessages(surfaceId, [update('/bad~2token','blocked')], original)).toThrow();
  });

  test("bounds direct wire input before applying it", () => {
    const messages = compileA2uiExpress(form, "form-1");
    const initial = applyA2uiMessages("form-1", messages)!;
    expect(() => applyA2uiMessages("form-1", [...messages, ...messages])).toThrow();
    for (const path of ["/form/__proto__", "/form/constructor", "/form/prototype", "/9999999"]) {
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
