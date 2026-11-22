/** Server-side compiler and admission policy. Never bundle the parser into Classic. */
import {
  ComponentPruningTransformer,
  ExpressParser,
  FunctionPruningTransformer,
  RendererState,
  type AgentToRendererMessage,
} from "@a2ui/agent";
import { basicCatalog } from "@a2ui/web_core/catalogs/basic/v1";
import { absoluteA2uiPointer, scopedA2uiPointer } from "./data-path.js";
import { projectA2uiTemplates, readA2uiTemplate } from "./templates.js";
import { CLASSIC_A2UI_CATALOG, CLASSIC_A2UI_PROPERTIES, a2uiSliderRange, readA2uiLink, type A2uiComponent, type A2uiSnapshot } from "./surface.js";

const MAX_SOURCE_BYTES = 16_384;
const MAX_SURFACE_BYTES = 32_768;
const MAX_COMPONENTS = 96;
const MAX_MESSAGES = 32;
const MAX_DEPTH = 24;
const ID = /^[\p{ID_Start}\p{ID_Continue}_-][\p{ID_Continue}_.-]{0,127}$/u;
const FORBIDDEN_KEYS = new Set(["__proto__", "prototype", "constructor"]);
const encoder = new TextEncoder();
const catalog = new FunctionPruningTransformer(["openUrl"]).transform(
  new ComponentPruningTransformer(Object.keys(CLASSIC_A2UI_PROPERTIES)).transform(basicCatalog),
);

function requireClassic(condition: unknown, reason: string): asserts condition {
  if (!condition) throw new Error(`Invalid Classic A2UI: ${reason}`);
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}

function isId(value: unknown): value is string {
  return typeof value === "string" && ID.test(value) && !FORBIDDEN_KEYS.has(value);
}

function allowedKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).every((key) => keys.includes(key));
}

function checkPath(value: unknown, allowRoot = false): void {
  requireClassic(typeof value === 'string' && value.length <= 256 && absoluteA2uiPointer(value, allowRoot), "unsupported data path");
}

function checkJson(value: unknown, depth = 0): void {
  requireClassic(depth <= MAX_DEPTH, "too deeply nested");
  if (value === null || typeof value === "boolean" || typeof value === "string" || (typeof value === "number" && Number.isFinite(value))) return;
  if (Array.isArray(value)) {
    requireClassic(value.length <= MAX_COMPONENTS, "array too large");
    for (const item of value) checkJson(item, depth + 1);
    return;
  }
  requireClassic(record(value), "expected JSON values");
  const entries = Object.entries(value);
  requireClassic(entries.length <= MAX_COMPONENTS, "object too large");
  for (const [key, item] of entries) {
    requireClassic(!FORBIDDEN_KEYS.has(key) && (key !== "@call" || item === "openUrl") && key !== "@catalogId", "unsupported key");
    if (key === "@path") {
      requireClassic(entries.length === 1, "malformed path binding");
      requireClassic(scopedA2uiPointer(item) !== undefined, "unsupported data binding");
    }
    checkJson(item, depth + 1);
  }
}

function containsCall(value: unknown): boolean {
  return Array.isArray(value) ? value.some(containsCall)
    : record(value) && (Object.hasOwn(value, "@call") || Object.values(value).some(containsCall));
}

function checkComponents(value: unknown): asserts value is A2uiComponent[] {
  requireClassic(Array.isArray(value) && value.length <= MAX_COMPONENTS, "too many components");
  const ids = new Set<string>();
  for (const component of value) {
    requireClassic(record(component) && isId(component.id) && !ids.has(component.id), "invalid or duplicate component id");
    const name = component.component;
    requireClassic(typeof name === "string" && Object.hasOwn(CLASSIC_A2UI_PROPERTIES, name), "unsupported component");
    requireClassic(allowedKeys(component, ["id", "component", "weight", ...CLASSIC_A2UI_PROPERTIES[name as A2uiComponent["component"]]]), "unsupported component property");
    requireClassic(component.weight === undefined || (typeof component.weight === 'number' && component.weight >= 0), "invalid layout weight");
    for (const [key, value] of Object.entries(component)) {
      if (key !== "action" || !readA2uiLink(value)) requireClassic(!containsCall(value), "functions are not supported in values");
    }
    ids.add(component.id);
    if (name === "Row" || name === "Column" || name === "List") {
      const template = readA2uiTemplate(component.children);
      requireClassic((Array.isArray(component.children) && component.children.every(isId)) ||
        (template && isId(template.componentId) && scopedA2uiPointer(template.path) !== undefined), "invalid child list or template");
    }
    if (name === "Tabs") {
      requireClassic(Array.isArray(component.tabs) && component.tabs.length > 0 && component.tabs.every(tab =>
        record(tab) && allowedKeys(tab, ["title", "child"]) && isId(tab.child)), "invalid tabs");
    }
    if (name === "Modal") requireClassic(isId(component.trigger) && isId(component.content), "invalid modal references");
    if (name === "Slider") requireClassic(a2uiSliderRange(component as A2uiComponent), "invalid slider interval");
    if (name === "TextField" && component.variant === "obscured") {
      throw new Error("Invalid Classic A2UI: private inputs require a host-owned surface");
    }
    if (name === "Button") {
      const { action } = component;
      if (readA2uiLink(action)) continue;
      requireClassic(record(action) && allowedKeys(action, ["event"]) && record(action.event)
        && allowedKeys(action.event, ["name", "context"]) && isId(action.event.name), "expected a server event");
      const { context } = action.event;
      requireClassic(context === undefined || (record(context) && Object.entries(context).every(([key, entry]) =>
        isId(key) && (!entry || typeof entry !== "object" || (record(entry) && Object.hasOwn(entry, "@path"))))), "unsupported event context");
    }
  }
}

/** Compile the upstream DSL (bare tool source); compilation alone never grants admission. */
export function compileA2uiExpress(source: string, surfaceId: string): AgentToRendererMessage[] {
  requireClassic(isId(surfaceId), "invalid surface id");
  requireClassic(source.length <= MAX_SOURCE_BYTES && encoder.encode(source).length <= MAX_SOURCE_BYTES, "Express source too large");
  // Bound the grammar's recursion before calling ANTLR. Ignore delimiters in its comments and strings.
  let depth = 0;
  const tokens = /[rR]"""[\s\S]*?"""|"""(?:\\[\s\S]|[^\\])*?"""|[rR]"[^\r\n"]*"|"(?:\\[\s\S]|[^"\\])*"|\/\*[\s\S]*?\*\/|(?:#|\/\/)[^\r\n]*|[()[\]{}]/g;
  for (const [token] of source.matchAll(tokens)) {
    if (token.length !== 1) continue;
    if ("([{".includes(token)) requireClassic(++depth <= MAX_DEPTH, "Express source too deeply nested");
    else if (")]}".includes(token)) depth--;
  }
  return new ExpressParser(catalog, surfaceId, "1.0").compile(source);
}

/** Apply exactly one owned surface's bounded batch to a detached snapshot. */
export function applyA2uiMessages(surfaceId: string, messages: readonly unknown[], previous?: A2uiSnapshot): A2uiSnapshot | null {
  requireClassic(isId(surfaceId) && messages.length > 0 && messages.length <= MAX_MESSAGES, "invalid surface or batch size");
  checkJson(messages);
  requireClassic(encoder.encode(JSON.stringify(messages)).length <= MAX_SURFACE_BYTES, "batch too large");
  const state = new RendererState([catalog]);
  if (previous) {
    requireClassic(previous.surfaceId === surfaceId, "snapshot belongs to another surface");
    // Validate the rehydrated snapshot too and detach the SDK's mutable data model from it.
    verifySnapshot(previous);
    state.checkTopology(state.apply([{ version: "1.0", createSurface: structuredClone(previous) }]));
  }

  let exists = !!previous;
  const operations = ["createSurface", "updateComponents", "updateDataModel", "deleteSurface"] as const;
  for (const [index, message] of messages.entries()) {
    requireClassic(record(message) && message.version === "1.0", "expected a v1.0 message");
    const operation = operations.find((name) => Object.hasOwn(message, name));
    requireClassic(operation && allowedKeys(message, ["version", operation]), "unsupported operation");
    const body = message[operation];
    requireClassic(record(body) && body.surfaceId === surfaceId, "batch targets a different surface");
    if (operation === "createSurface") {
      requireClassic(!exists && index === 0 && body.catalogId === CLASSIC_A2UI_CATALOG
        && allowedKeys(body, ["surfaceId", "catalogId", "components", "dataModel", "sendDataModel"])
        && (body.sendDataModel === undefined || body.sendDataModel === false), "unsupported surface creation");
      if (body.components !== undefined) checkComponents(body.components);
      exists = true;
    } else {
      requireClassic(exists, "surface does not exist");
      if (operation === "updateComponents") checkComponents(body.components);
      if (operation === "updateDataModel") {
        requireClassic(allowedKeys(body, ["surfaceId", "path", "value"]) && Object.hasOwn(body, "value"), "invalid data update");
        if (body.path !== undefined) checkPath(body.path, true);
      }
      if (operation === "deleteSurface") {
        requireClassic(previous && index === messages.length - 1, "delete must finish an existing surface's batch");
        exists = false;
      }
    }
  }
  state.checkTopology(state.apply(structuredClone(messages)));
  if (!exists) return null;

  const result = state.getSurface(surfaceId)!;
  const snapshot: A2uiSnapshot = {
    surfaceId,
    catalogId: CLASSIC_A2UI_CATALOG,
    components: Array.from(result.componentsModel.values, ({ id, type, properties }) => ({ ...properties, id, component: type } as A2uiComponent)),
    // SDK deletion leaves an empty array slot; persisted JSON represents it as null without shifting indices.
    dataModel: JSON.parse(JSON.stringify(result.dataModel.get("/"))),
  };
  verifySnapshot(snapshot);
  return snapshot;
}

function verifySnapshot(snapshot: A2uiSnapshot): void {
  checkJson(snapshot);
  requireClassic(snapshot.catalogId === CLASSIC_A2UI_CATALOG && record(snapshot.dataModel)
    && encoder.encode(JSON.stringify(snapshot)).length <= MAX_SURFACE_BYTES, "invalid snapshot or snapshot too large");
  requireClassic(!containsCall(snapshot.dataModel), "functions are not supported in data models");
  checkComponents(snapshot.components);
  const components = new Map(snapshot.components.map((item) => [item.id, item]));
  const seen = new Set<string>();
  function walk(id: string, depth: number, canWeight = false): void {
    const item = components.get(id);
    requireClassic(item && !seen.has(id) && depth <= MAX_DEPTH, "expected a bounded component tree");
    seen.add(id);
    requireClassic(item.weight === undefined || canWeight, "layout weight requires a Row or Column parent");
    const weightedChildren = item.component === "Row" || item.component === "Column";
    if (Array.isArray(item.children)) for (const child of item.children) walk(child, depth + 1, weightedChildren);
    const template = readA2uiTemplate(item.children);
    if (template) walk(template.componentId, depth + 1, weightedChildren);
    if (item.component === "Tabs" && Array.isArray(item.tabs)) for (const tab of item.tabs) walk(tab.child, depth + 1);
    if (item.component === "Modal" && typeof item.trigger === "string" && typeof item.content === "string") {
      walk(item.trigger, depth + 1);
      walk(item.content, depth + 1);
    }
    if (typeof item.child === "string") {
      if (item.component === "Button") {
        const childKind = components.get(item.child)?.component;
        requireClassic(childKind === "Text" || childKind === "Icon", "button labels must be text or icons");
      }
      walk(item.child, depth + 1);
    }
  }
  walk("root", 0);
  requireClassic(seen.size === components.size, "unreachable components");
  projectA2uiTemplates(snapshot);
}
