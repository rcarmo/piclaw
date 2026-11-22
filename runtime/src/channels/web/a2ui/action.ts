/** Classic's subset of the v1.0 action message. Owning a post is a separate server check. */
import { a2uiBindingPath, readA2uiValue } from "./functions.js";
export { a2uiBindingPath, readA2uiValue } from "./functions.js";
import { a2uiInstanceId, projectA2uiTemplates } from "./templates.js";
import { a2uiDateTimeType, validA2uiDateTime } from "./date-time.js";
import { a2uiSliderRange, type A2uiComponent, type A2uiSnapshot } from "./surface.js";

type ActionValue = string | number | boolean | null | string[];
export interface A2uiAction {
  surfaceId: string;
  sourceComponentId: string;
  name: string;
  timestamp: string;
  context: Record<string, ActionValue>;
  userMessage?: string;
}

export interface A2uiActionMessage {
  version: "1.0";
  action: A2uiAction;
}

function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function sameValue(left: unknown, right: unknown): boolean {
  return left === right || (Array.isArray(left) && Array.isArray(right) && left.length === right.length
    && left.every((item, index) => item === right[index]));
}

type Projection = ReturnType<typeof projectA2uiTemplates>;

function eventDescriptor(projection: Projection, sourceComponentId: string, instancePath?: string) {
  const instanceId = a2uiInstanceId(sourceComponentId, instancePath);
  const identity = projection.instances.get(instanceId);
  if (identity?.id !== sourceComponentId || identity.instancePath !== instancePath) throw new Error('Invalid surface action');
  const source = projection.snapshot.components.find(({ id }) => id === instanceId);
  if (source?.component !== "Button" || !record(source.action) || !record(source.action.event)
    || typeof source.action.event.name !== "string") throw new Error("Invalid surface action");
  return { name: source.action.event.name, context: record(source.action.event.context) ? source.action.event.context : {},
    userMessage: source.action.event.userMessage, scope: identity.scope };
}

function controlForPath(snapshot: A2uiSnapshot, path: string): A2uiComponent | undefined {
  return snapshot.components.find((component) =>
    (component.component === "TextField" || component.component === "CheckBox" || component.component === "ChoicePicker"
      || component.component === "Slider" || (component.component === "DateTimeInput" && a2uiDateTimeType(component) !== undefined))
    && a2uiBindingPath(component.value) === path);
}

export function isA2uiActionValue(value: unknown): value is ActionValue {
  return value === null || typeof value === "boolean" || (typeof value === "number" && Number.isFinite(value))
    || (typeof value === "string" && value.length <= 4096)
    || (Array.isArray(value) && value.length <= 96 && value.every((entry) => typeof entry === "string" && entry.length <= 256));
}

function validControlValue(snapshot: A2uiSnapshot, control: A2uiComponent, value: ActionValue): boolean {
  if (control.component === "DateTimeInput") {
    const type = a2uiDateTimeType(control);
    return !!type && validA2uiDateTime(type, value, readA2uiValue(snapshot, control.min), readA2uiValue(snapshot, control.max));
  }
  if (control.component === "CheckBox") return typeof value === "boolean";
  if (control.component === "Slider") {
    const range = a2uiSliderRange(control);
    if (typeof value !== "number" || !range || value < range.min || value > range.max) return false;
    if (range.step === undefined) return true;
    const snapped = range.min + Math.round((value - range.min) / range.step) * range.step;
    const rounding = 4 * Number.EPSILON * Math.max(Math.abs(range.min), Math.abs(range.max));
    return Math.abs(value - snapped) <= Math.min(rounding, range.step / 4);
  }
  if (control.component === "ChoicePicker") {
    return Array.isArray(value) && (control.variant === "multipleSelection" || value.length <= 1)
      && new Set(value).size === value.length && Array.isArray(control.options)
      && value.every((selected) => (control.options as unknown[]).some((option) => record(option) && option.value === selected));
  }
  return typeof value === "string" && (control.variant !== "number" || value === "" || /^-?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(value));
}

function defaultControlValue(component: A2uiComponent | undefined): ActionValue {
  if (component?.component === "CheckBox") return false;
  if (component?.component === "ChoicePicker") return [];
  if (component?.component === "Slider") return a2uiSliderRange(component)?.min ?? null;
  return component ? "" : null;
}

function resolveUserMessage(snapshot: A2uiSnapshot, descriptor: unknown, edits: ReadonlyMap<string, unknown>, instancePath: string | undefined, scope: string): string | undefined {
  const value = readA2uiValue(snapshot, descriptor, edits, instancePath, scope);
  if (value === undefined || value === null) return;
  const text = typeof value === 'number' && Number.isFinite(value) ? String(value) : value;
  if (typeof text !== 'string' || text.length > 4096) throw new Error('Invalid action description');
  return text;
}

/** Send only context declared by this button. Neither edits nor snapshot leave the browser wholesale. */
export function buildA2uiAction(source: A2uiSnapshot, sourceComponentId: string, edits: ReadonlyMap<string, unknown>, timestamp: string, instancePath?: string): A2uiActionMessage {
  const projection = projectA2uiTemplates(source);
  const { snapshot } = projection;
  const event = eventDescriptor(projection, sourceComponentId, instancePath);
  const contextBindings = Object.entries(event.context);
  const declaredEdits = new Map<string, unknown>();
  for (const [, binding] of contextBindings) {
    const path = a2uiBindingPath(binding);
    const control = path ? controlForPath(snapshot, path) : undefined;
    if (path && control) declaredEdits.set(path, readA2uiValue(snapshot, binding, edits) ?? defaultControlValue(control));
  }
  const context = Object.fromEntries(contextBindings.map(([key, binding]) => {
    const path = a2uiBindingPath(binding);
    const control = path ? controlForPath(snapshot, path) : undefined;
    const value = readA2uiValue(snapshot, binding, declaredEdits, instancePath, event.scope) ?? defaultControlValue(control);
    if (!isA2uiActionValue(value)) throw new Error("Invalid form value");
    return [key, value];
  }));
  const userMessage = resolveUserMessage(snapshot, event.userMessage, declaredEdits, instancePath, event.scope);
  const message: A2uiActionMessage = { version: "1.0", action: {
    surfaceId: snapshot.surfaceId, sourceComponentId, name: event.name, timestamp, context,
    ...(userMessage === undefined ? {} : {userMessage}),
  } };
  validateProjectedA2uiAction(projection, message, instancePath);
  return message;
}

/** Re-resolve authority and field constraints from the stored descriptor, not browser declarations. */
export function validateA2uiAction(source: A2uiSnapshot, payload: unknown, instancePath?: string): A2uiAction {
  return validateProjectedA2uiAction(projectA2uiTemplates(source), payload, instancePath);
}

function validateProjectedA2uiAction(projection: Projection, payload: unknown, instancePath?: string): A2uiAction {
  const { snapshot } = projection;
  if (!record(payload) || payload.version !== "1.0" || Object.keys(payload).length !== 2 || !record(payload.action)) {
    throw new Error("Invalid surface action");
  }
  const action = payload.action;
  if (Object.keys(action).length !== 5 + Number(Object.hasOwn(action, 'userMessage')) || action.surfaceId !== snapshot.surfaceId || typeof action.sourceComponentId !== "string"
    || typeof action.timestamp !== "string" || action.timestamp.length > 35 || !Number.isFinite(Date.parse(action.timestamp))
    || !record(action.context)) throw new Error("Invalid surface action");
  const event = eventDescriptor(projection, action.sourceComponentId, instancePath);
  if (event.name !== action.name || Object.keys(event.context).length !== Object.keys(action.context).length) {
    throw new Error("Invalid surface action");
  }
  const boundValues = new Map<string, unknown>();
  const derived: [unknown, ActionValue][] = [];
  for (const [key, binding] of Object.entries(event.context)) {
    const input = action.context[key];
    const path = a2uiBindingPath(binding);
    const control = path ? controlForPath(snapshot, path) : undefined;
    if (!Object.hasOwn(action.context, key) || !isA2uiActionValue(input)) throw new Error('Invalid form value');
    if (!path || !control) derived.push([binding, input]);
    else {
      if (!validControlValue(snapshot, control, input)) throw new Error('Invalid form value');
      if (boundValues.has(path) && !sameValue(boundValues.get(path), input)) throw new Error("Conflicting form values");
      boundValues.set(path, input);
    }
  }
  for (const [binding, input] of derived) {
    if (!sameValue(input, readA2uiValue(snapshot, binding, boundValues, instancePath, event.scope) ?? null)) throw new Error('Invalid form value');
  }
  const userMessage = resolveUserMessage(snapshot, event.userMessage, boundValues, instancePath, event.scope);
  if (userMessage !== action.userMessage) throw new Error('Invalid action description');
  return { surfaceId: snapshot.surfaceId, name: event.name, sourceComponentId: action.sourceComponentId, timestamp: action.timestamp,
    ...(userMessage === undefined ? {} : {userMessage}), context: Object.fromEntries(Object.keys(event.context).map((key) => [key, (action.context as Record<string, ActionValue>)[key]])) };
}

/** Piclaw transport metadata is not part of the A2UI protocol message. */
export interface A2uiActionRequest {
  chat_jid: string;
  post_id: number;
  thread_id: number;
  revision: number;
  request_id: string;
  message: A2uiActionMessage;
  instance_path?: string;
  private_code?: string;
  private_value?: string;
}
