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
