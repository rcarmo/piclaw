/** Classic's subset of the v1.0 action message. Owning a post is a separate server check. */
import { a2uiSliderRange, type A2uiComponent, type A2uiSnapshot } from "./surface.js";

type ActionValue = string | number | boolean | null | string[];
export interface A2uiAction {
  surfaceId: string;
  sourceComponentId: string;
  name: string;
  timestamp: string;
  context: Record<string, ActionValue>;
}

export interface A2uiActionMessage {
  version: "1.0";
  action: A2uiAction;
}

function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

export function a2uiBindingPath(value: unknown): string | undefined {
  return record(value) && Object.hasOwn(value, "@path") && typeof value["@path"] === "string"
    ? value["@path"] : undefined;
}

/** Resolve a validated absolute binding without interpreting strings or following prototypes. */
export function readA2uiValue(snapshot: A2uiSnapshot, value: unknown, edits?: ReadonlyMap<string, unknown>): unknown {
  const path = a2uiBindingPath(value);
  if (!path) return value;
  if (edits?.has(path)) return edits.get(path);
  let current: unknown = snapshot.dataModel;
  for (const key of path.slice(1).split("/")) {
    if ((!record(current) && !Array.isArray(current)) || !Object.hasOwn(current, key)) return undefined;
    current = (current as Record<string, unknown>)[key];
  }
  return current;
}

function sameValue(left: unknown, right: unknown): boolean {
  return left === right || (Array.isArray(left) && Array.isArray(right) && left.length === right.length
    && left.every((item, index) => item === right[index]));
}

function eventDescriptor(snapshot: A2uiSnapshot, sourceComponentId: string) {
  const source = snapshot.components.find(({ id }) => id === sourceComponentId);
  if (source?.component !== "Button" || !record(source.action) || !record(source.action.event)
    || typeof source.action.event.name !== "string") throw new Error("Invalid surface action");
  return { name: source.action.event.name, context: record(source.action.event.context) ? source.action.event.context : {} };
}

function controlForPath(snapshot: A2uiSnapshot, path: string): A2uiComponent | undefined {
  return snapshot.components.find((component) =>
    (component.component === "TextField" || component.component === "CheckBox" || component.component === "ChoicePicker" || component.component === "Slider")
    && a2uiBindingPath(component.value) === path);
}

export function isA2uiActionValue(value: unknown): value is ActionValue {
  return value === null || typeof value === "boolean" || (typeof value === "number" && Number.isFinite(value))
    || (typeof value === "string" && value.length <= 4096)
    || (Array.isArray(value) && value.length <= 96 && value.every((entry) => typeof entry === "string" && entry.length <= 256));
}

function validControlValue(control: A2uiComponent, value: ActionValue): boolean {
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

/** Send only context declared by this button. Neither edits nor snapshot leave the browser wholesale. */
export function buildA2uiAction(snapshot: A2uiSnapshot, sourceComponentId: string, edits: ReadonlyMap<string, unknown>, timestamp: string): A2uiActionMessage {
  const event = eventDescriptor(snapshot, sourceComponentId);
  const context = Object.fromEntries(Object.entries(event.context).map(([key, binding]) => {
    const path = a2uiBindingPath(binding);
    const control = path ? controlForPath(snapshot, path) : undefined;
    const value = readA2uiValue(snapshot, binding, control ? edits : undefined) ?? defaultControlValue(control);
    if (!isA2uiActionValue(value)) throw new Error("Invalid form value");
    return [key, value];
  }));
  const message: A2uiActionMessage = { version: "1.0", action: {
    surfaceId: snapshot.surfaceId, sourceComponentId, name: event.name, timestamp, context,
  } };
  validateA2uiAction(snapshot, message);
  return message;
}

/** Re-resolve authority and field constraints from the stored descriptor, not browser declarations. */
export function validateA2uiAction(snapshot: A2uiSnapshot, payload: unknown): A2uiAction {
  if (!record(payload) || payload.version !== "1.0" || Object.keys(payload).length !== 2 || !record(payload.action)) {
    throw new Error("Invalid surface action");
  }
  const action = payload.action;
  if (Object.keys(action).length !== 5 || action.surfaceId !== snapshot.surfaceId || typeof action.sourceComponentId !== "string"
    || typeof action.timestamp !== "string" || action.timestamp.length > 35 || !Number.isFinite(Date.parse(action.timestamp))
    || !record(action.context)) throw new Error("Invalid surface action");
  const event = eventDescriptor(snapshot, action.sourceComponentId);
  if (event.name !== action.name || Object.keys(event.context).length !== Object.keys(action.context).length) {
    throw new Error("Invalid surface action");
  }
  const boundValues = new Map<string, unknown>();
  for (const [key, binding] of Object.entries(event.context)) {
    const input = action.context[key];
    const path = a2uiBindingPath(binding);
    const control = path ? controlForPath(snapshot, path) : undefined;
    if (!Object.hasOwn(action.context, key) || !isA2uiActionValue(input)
      || (control ? !validControlValue(control, input) : !sameValue(input, readA2uiValue(snapshot, binding) ?? null))) {
      throw new Error("Invalid form value");
    }
    if (path) {
      if (boundValues.has(path) && !sameValue(boundValues.get(path), input)) throw new Error("Conflicting form values");
      boundValues.set(path, input);
    }
  }
  return { surfaceId: snapshot.surfaceId, name: event.name, sourceComponentId: action.sourceComponentId, timestamp: action.timestamp,
    context: Object.fromEntries(Object.keys(event.context).map((key) => [key, (action.context as Record<string, ActionValue>)[key]])) };
}

/** Piclaw transport metadata is not part of the A2UI protocol message. */
export interface A2uiActionRequest {
  chat_jid: string;
  post_id: number;
  thread_id: number;
  revision: number;
  request_id: string;
  message: A2uiActionMessage;
  private_code?: string;
  private_value?: string;
}
