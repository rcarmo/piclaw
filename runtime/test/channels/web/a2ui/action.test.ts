import { expect, test } from "bun:test";
import { buildA2uiAction, validateA2uiAction } from "../../../../src/channels/web/a2ui/action.js";
import { applyA2uiMessages, compileA2uiExpress } from "../../../../src/channels/web/a2ui/express.js";

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
