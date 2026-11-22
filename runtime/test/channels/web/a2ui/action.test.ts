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
