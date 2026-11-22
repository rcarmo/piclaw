import { expect, test } from "bun:test";
import { buildA2uiAction, readA2uiValue, validateA2uiAction } from "../../../../src/channels/web/a2ui/action.js";
import { applyA2uiMessages, compileA2uiExpress } from "../../../../src/channels/web/a2ui/express.js";
import { CLASSIC_A2UI_CATALOG } from '../../../../src/channels/web/a2ui/surface.js';

const snapshot = applyA2uiMessages("owned-1", compileA2uiExpress(`
  $/choice = ["blue"];
  $/note = "";
  $/example = true;
  root = Column([picker, note, submit]);
  picker = ChoicePicker(label="Colour", options=[{label:"Blue", value:"blue"}, {label:"Red", value:"red"}], value=$/choice);
  note = TextField(label="Note", value=$/note);
  submit = Button(Text("Send"), action=Event("send", {colour: $/choice, note: $/note, example: $/example, fixed: "literal"}));
`, "owned-1"))!;

const timestamp = "2026-11-22T09:00:00.000Z";

test("Classic emits a v1.0 action from local drafts without sending the data model", () => {
  const edits = new Map<string, unknown>([["/choice", ["red"]], ["/note", "hello"], ["/example", false]]);
  const event = buildA2uiAction(snapshot, "submit", edits, timestamp);
  expect(event).toEqual({ version: "1.0", action: {
    surfaceId: "owned-1", sourceComponentId: "submit", name: "send", timestamp,
    context: { colour: ["red"], note: "hello", example: true, fixed: "literal" },
  } });
  expect(validateA2uiAction(snapshot, event)).toEqual(event.action);
});

test("a Slider submits a number within the stored range and step grid", () => {
  const slider = applyA2uiMessages("slider", compileA2uiExpress(`
    $/value = 0.2;
    root = Column([Slider(label="Level", min=0.1, max=0.4, steps=3, value=$/value), submit]);
    submit = Button(Text("Send"), action=Event("send", {level:$/value}));
  `, "slider"))!;
  const action = buildA2uiAction(slider, "submit", new Map([["/value", 0.3]]), timestamp);
  expect(action.action.context).toEqual({ level: 0.3 });
  for (const level of [0.09, 0.25, 0.41, "0.3"]) {
    expect(() => validateA2uiAction(slider, { ...action, action: { ...action.action, context: { level } } })).toThrow();
  }
});

test.each([
  { flags:'enableDate=true', initial:'2028-02-29', min:'2028-02-01', max:'2028-03-01', edit:'2028-03-01', invalid:['2028-02-30', '2028-01-31', '2028-03-02', '12:30'] },
  { flags:'enableTime=true', initial:'09:30:00Z', min:'09:00:00', max:'16:00:00', edit:'09:15', invalid:['09:00:60', '08:59', '16:00:00.001', '2028-01-31'] },
  { flags:'enableDate=true, enableTime=true', initial:'2028-02-29T12:00:00+05:30', min:'2028-02-29T09:00:00+05:30', max:'2028-02-29T18:00:00+05:30', edit:'2028-02-29T12:30', invalid:['2028-02-29T25:00', '2028-02-28T12:30', '2028-02-29', '2028-02-29T12:30+24:00'] },
])("DateTimeInput validates and submits ISO values for $flags", ({flags, initial, min, max, edit, invalid}) => {
  const picker = applyA2uiMessages("when", compileA2uiExpress(`
    $/when = ${JSON.stringify(initial)};
    $/earliest = ${JSON.stringify(min)};
    root = Column([DateTimeInput(label="When", ${flags}, min=$/earliest, max=${JSON.stringify(max)}, value=$/when), submit]);
    submit = Button(Text("Send"), action=Event("send", {when:$/when}));
  `, "when"))!;
  expect(buildA2uiAction(picker, "submit", new Map(), timestamp).action.context.when).toBe(initial);
  const message = buildA2uiAction(picker, "submit", new Map([["/when", edit]]), timestamp);
  expect(message.action.context.when).toBe(edit);
  for (const when of [...invalid, 123]) {
    expect(() => validateA2uiAction(picker, { ...message, action: { ...message.action, context: { when } } })).toThrow();
  }
  expect(buildA2uiAction(picker, "submit", new Map([["/when", ""]]), timestamp).action.context.when).toBe("");
});

test("a modal trigger and content keep their explicitly authored actions", () => {
  const modal = applyA2uiMessages("modal", compileA2uiExpress(`
    root = Modal(trigger=show, content=submit);
    show = Button(Text("Open"), action=Event("open"));
    submit = Button(Text("Send"), action=Event("send"));
  `, "modal"))!;
  expect(buildA2uiAction(modal, 'show', new Map(), timestamp).action.name).toBe('open');
  expect(buildA2uiAction(modal, 'submit', new Map(), timestamp).action.name).toBe('send');
});

test('template actions bind relative edits and immutable context to the selected row', () => {
  const forms = applyA2uiMessages('repeated', compileA2uiExpress(`
    $/rows = [{label:"First",note:"one"},{label:"Second",note:"two"}];
    $/tag = "Global";
    root = List(_template($/rows, row));
    row = Row([Text($label), TextField(label="Row note", value=$note), send]);
    send = Button(Text("Apply"), action=Event("apply", {label:$label, note:$note, tag:$/tag}));
  `, 'repeated'))!;
  const drafts = new Map([['/rows/0/note','first draft'], ['/rows/1/note','second draft']]);
  const second = buildA2uiAction(forms, 'send', drafts, timestamp, '/1');
  expect(second.action.sourceComponentId).toBe('send');
  expect(second.action.context).toEqual({label:'Second',note:'second draft',tag:'Global'});
  expect(validateA2uiAction(forms, second, '/1')).toEqual(second.action);
  for (const forged of [undefined, '/0', '/2', '/01', '/1/0']) expect(() => validateA2uiAction(forms, second, forged)).toThrow();
  expect(() => validateA2uiAction(forms, { ...second, action: { ...second.action, sourceComponentId: ':send:/1' } })).toThrow();
  expect(buildA2uiAction(forms, 'send', drafts, timestamp, '/0').action.context.note).toBe('first draft');
});

test('the server derives @index from the selected template, including a declared offset edit', () => {
  const surfaceId = 'indexed';
  const bound = {'@path':'offset'};
  const forms = applyA2uiMessages(surfaceId, [{version:'1.0', createSurface:{surfaceId, catalogId:CLASSIC_A2UI_CATALOG,
    dataModel:{rows:[{offset:1},{offset:4}]}, components:[
      {id:'root', component:'List', children:{componentId:'row',path:'/rows'}},
      {id:'row',component:'Row',children:['label','offset','send']},
      {id:'label',component:'Text',text:{'@call':'@index',args:{offset:1}}},
      {id:'offset',component:'Slider',label:'Offset',max:10,value:bound},
      {id:'send',component:'Button',child:'buttonLabel',action:{event:{name:'apply',context:{row:{'@call':'@index',args:{offset:bound}},offset:bound}}}},
      {id:'buttonLabel',component:'Text',text:'Apply'},
    ],
  }}])!;
  const message = buildA2uiAction(forms, 'send', new Map([['/rows/1/offset', 6]]), timestamp, '/1');
  expect(message.action.context).toEqual({row:7, offset:6});
  expect(validateA2uiAction(forms, message, '/1')).toEqual(message.action);
  expect(() => validateA2uiAction(forms, message, '/0')).toThrow('Invalid form value');
  const forged = {...message, action:{...message.action, context:{row:15,offset:6}}};
  expect(() => validateA2uiAction(forms, forged, '/1')).toThrow('Invalid form value');
  expect(() => applyA2uiMessages('outside', [{ version:'1.0', createSurface:{surfaceId:'outside',catalogId:CLASSIC_A2UI_CATALOG,
    components:[{id:'root',component:'Text',text:{'@call':'@index'}}],
  }}])).toThrow(/template/);
});

test('emits the stored userMessage after resolving only declared draft values', () => {
  const authored = applyA2uiMessages('spoken', compileA2uiExpress(`
    $/note = "Original";
    root=Column([TextField(label="Note",value=$/note),send]);
    send=Button(Text("Send"),action=Event("send",{note:$/note},userMessage=$/note));
  `, 'spoken'))!;
  const event = buildA2uiAction(authored, 'send', new Map([['/note','Edited']]), timestamp);
  expect(event.action.userMessage).toBe('Edited');
  expect(validateA2uiAction(authored,event).userMessage).toBe('Edited');
  expect(() => validateA2uiAction(authored,{...event,action:{...event.action,userMessage:'Forged'}})).toThrow();
  const unset = {...authored, dataModel:{}};
  expect(buildA2uiAction(unset, 'send', new Map(), timestamp).action.userMessage).toBe('');
  const {userMessage: _ignored, ...without} = event.action;
  expect(() => validateA2uiAction(authored,{...event,action:without})).toThrow();
});

test('Basic Catalogue functions resolve on the server and can derive action context', () => {
  const authored = applyA2uiMessages('functions', compileA2uiExpress(`
    $/name="Initial";
    root=Column([Text(formatNumber(1234.5,decimals=2)),TextField(label="Name",value=$/name),send]);
    send=Button(Text("Send"),action=Event("send",{name:$/name,description:formatString("Hello \${/name}")}));
  `, 'functions'))!;
  const message = buildA2uiAction(authored,'send',new Map([['/name','Morgan']]),timestamp);
  expect(message.action.context).toEqual({name:'Morgan',description:'Hello Morgan'});
  expect(() => validateA2uiAction(authored,{...message,action:{...message.action,context:{...message.action.context,description:'Hello Initial'}}})).toThrow();
  const call = (name: string, args: object) => ({'@call':name,args});
  for (const [input,expected] of [
    [call('required',{value:''}),false], [call('regex',{value:'abc',pattern:'^[a-z]+$'}),true],
    [call('numeric',{value:6,min:4,max:8}),true], [call('length',{value:'abc',min:4}),false],
    [call('email',{value:'person@example.test'}),true],
    [call('and',{values:[true,call('not',{value:call('required',{value:''})})]}),true],
    [call('or',{values:[false,true]}),true],
    [call('formatNumber',{value:1234.5,decimals:2}),'1,234.50'],
    [call('formatCurrency',{value:19.5,currency:'USD'}),'$19.50'],
    [call('formatDate',{value:'2028-02-29T12:00:00Z',format:'yyyy-MM-dd'}),'2028-02-29'],
    [call('pluralize',{value:2,one:'one',other:'many'}),'many'],
    [call('formatString',{value:'${name}/${formatNumber(value: 5, decimals: 1)}'}),'Initial/5.0'],
  ] as const) {
    const result = readA2uiValue(authored,input);
    expect(result && typeof result === 'object' && 'valid' in result ? result.valid : result).toEqual(expected);
  }
  expect(readA2uiValue(authored,call('regex',{value:'a'.repeat(1000)+'!',pattern:'^(a+)+$'}))).toBeUndefined();
  expect(readA2uiValue(authored,call('openUrl',{url:'https://example.test'}))).toBeUndefined();
});

test("Classic does not accept authority, options, fixed values or undeclared inputs from the action", () => {
  const message = buildA2uiAction(snapshot, "submit", new Map(), timestamp);
  const action = message.action;
  for (const patch of [
    { surfaceId: "other" }, { sourceComponentId: "picker" }, { name: "recovery-continue" },
    { context: { ...action.context, colour: ["unknown"] } },
    { context: { ...action.context, colour: ["red", "blue"] } },
    { context: { ...action.context, example: false } }, { context: { ...action.context, fixed: "injected" } },
    { context: { ...action.context, intent: "unowned" } }, { context: { ...action.context, note: "a".repeat(4097) } },
    { context: { colour: ["red"] } }, { userMessage: "untrusted" },
  ]) expect(() => validateA2uiAction(snapshot, { ...message, action: { ...action, ...patch } })).toThrow();
  expect(() => validateA2uiAction(snapshot, { ...message, dataModel: snapshot.dataModel })).toThrow();
});
