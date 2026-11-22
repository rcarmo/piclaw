/** Server-side compiler and admission policy. Never bundle the parser into Classic. */
import {
  ComponentPruningTransformer,
  ExpressParser,
  FunctionPruningTransformer,
  RendererState,
  type AgentToRendererMessage,
} from "@a2ui/agent";
import { basicCatalog } from "@a2ui/web_core/catalogs/basic/v1";
import { CLASSIC_A2UI_FUNCTIONS, isClassicValueFunction } from "./functions.js";
import { absoluteA2uiPointer, scopedA2uiPointer } from "./data-path.js";
import { a2uiChildReferences, projectA2uiTemplates, readA2uiTemplate } from "./templates.js";
import { CLASSIC_A2UI_CATALOG, CLASSIC_A2UI_PROPERTIES, a2uiSliderRange, readA2uiLink, readA2uiLinkTarget, type A2uiComponent, type A2uiSnapshot } from "./surface.js";

const MAX_SOURCE_BYTES = 16_384;
const MAX_SURFACE_BYTES = 32_768;
const MAX_COMPONENTS = 96;
const MAX_MESSAGES = 32;
const MAX_DEPTH = 24;
const ID = /^[\p{ID_Start}\p{ID_Continue}_-][\p{ID_Continue}_.-]{0,127}$/u;
const FORBIDDEN_KEYS = new Set(["__proto__", "prototype", "constructor"]);
const encoder = new TextEncoder();
const catalog = new FunctionPruningTransformer(CLASSIC_A2UI_FUNCTIONS).transform(
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

function checkJson(value: unknown, depth = 0, opaqueMetadata = false): void {
  requireClassic(depth <= MAX_DEPTH, "too deeply nested");
  if (value === null || typeof value === "boolean" || typeof value === "string" || (typeof value === "number" && Number.isFinite(value))) return;
  if (Array.isArray(value)) {
    requireClassic(value.length <= MAX_COMPONENTS, "array too large");
    for (const item of value) checkJson(item, depth + 1, opaqueMetadata);
    return;
  }
  requireClassic(record(value), "expected JSON values");
  const entries = Object.entries(value);
  requireClassic(entries.length <= MAX_COMPONENTS, "object too large");
  for (const [key, item] of entries) {
    if (!opaqueMetadata) requireClassic(!FORBIDDEN_KEYS.has(key) && (key !== "@call" || item === "openUrl" || isClassicValueFunction(item)) && (key !== '@catalogId' || item === CLASSIC_A2UI_CATALOG), "unsupported key");
    if (!opaqueMetadata && key === "@path") {
      requireClassic(entries.length === 1, "malformed path binding");
      requireClassic(scopedA2uiPointer(item) !== undefined, "unsupported data binding");
    }
    checkJson(item, depth + 1, opaqueMetadata || key === 'metadata' || key === '@metadata');
  }
}

function checkMetadata(value: unknown): void {
  if (value === undefined) return;
  requireClassic(record(value) && allowedKeys(value, ['extensions']), 'invalid extension metadata');
  requireClassic(value.extensions === undefined || (record(value.extensions) && Object.keys(value.extensions).every(key =>
    /^[\p{XID_Start}_][\p{XID_Continue}]*$/u.test(key))), 'invalid extension identifier');
}

function containsCall(value: unknown, name?: string): boolean {
  if (Array.isArray(value)) return value.some(item => containsCall(item, name));
  return record(value) && ((Object.hasOwn(value, '@call') && (name === undefined || value['@call'] === name))
    || Object.values(value).some(item => containsCall(item, name)));
}

function checkValueCalls(value: unknown): void {
  if (Array.isArray(value)) return value.forEach(checkValueCalls);
  if (!record(value)) return;
  if (Object.hasOwn(value, '@call')) {
    const name = value['@call'];
    requireClassic(isClassicValueFunction(name) && allowedKeys(value, ['@call', 'args', 'catalogId'])
      && (value.catalogId === undefined || (name !== '@index' && value.catalogId === CLASSIC_A2UI_CATALOG)), 'unsupported function in a value');
    const args = value.args;
    requireClassic(args === undefined || record(args), 'invalid function arguments');
    if (name === '@index' && record(args)) requireClassic(allowedKeys(args, ['offset']) && (args.offset === undefined
      || typeof args.offset === 'number' || (record(args.offset) && (Object.hasOwn(args.offset, '@path') || isClassicValueFunction(args.offset['@call'])))), 'invalid @index arguments');
  }
  Object.values(value).forEach(checkValueCalls);
}

function checkComponents(value: unknown): asserts value is A2uiComponent[] {
  requireClassic(Array.isArray(value) && value.length <= MAX_COMPONENTS, "too many components");
  const ids = new Set<string>();
  for (const component of value) {
    requireClassic(record(component) && isId(component.id) && !ids.has(component.id), "invalid or duplicate component id");
    const name = component.component;
    requireClassic(typeof name === "string" && Object.hasOwn(CLASSIC_A2UI_PROPERTIES, name), "unsupported component");
    requireClassic(allowedKeys(component, ["id", "component", "@catalogId", "weight", "@accessibility", "accessibility", "@checks", "checks", "@metadata", "metadata", ...CLASSIC_A2UI_PROPERTIES[name as A2uiComponent["component"]]]), "unsupported component property");
    requireClassic(!(Object.hasOwn(component, '@metadata') && Object.hasOwn(component, 'metadata')), 'conflicting metadata');
    checkMetadata(Object.hasOwn(component, '@metadata') ? component['@metadata'] : component.metadata);
    requireClassic(!(Object.hasOwn(component, '@checks') && Object.hasOwn(component, 'checks')), 'conflicting check descriptors');
    const checks = component['@checks'] ?? component.checks;
    if (checks !== undefined) requireClassic(['Button','TextField','CheckBox','ChoicePicker','Slider','DateTimeInput'].includes(name)
      && Array.isArray(checks) && checks.length <= 16 && checks.every(rule => record(rule) && allowedKeys(rule, ['condition','message'])
        && record(rule.condition) && (Object.hasOwn(rule.condition, '@path') || isClassicValueFunction(rule.condition['@call']))
        && (rule.message === undefined || (typeof rule.message === 'string' && rule.message.length <= 1024))), 'invalid checks');
    requireClassic(!(Object.hasOwn(component, '@accessibility') && Object.hasOwn(component, 'accessibility')), 'conflicting accessibility descriptors');
    const a11y = component['@accessibility'] ?? component.accessibility;
    if (a11y !== undefined) requireClassic(record(a11y) && allowedKeys(a11y, ['label', 'description', 'hidden', 'live']), 'invalid accessibility descriptor');
    requireClassic(component.weight === undefined || (typeof component.weight === 'number' && component.weight >= 0), "invalid layout weight");
    for (const [key, value] of Object.entries(component)) {
      if (key === 'metadata' || key === '@metadata') continue;
      const target = key === 'action' ? readA2uiLinkTarget(value) : undefined;
      checkValueCalls(target === undefined ? value : target);
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
      const target = readA2uiLinkTarget(action);
      if (target !== undefined) {
        requireClassic(typeof target === 'string' ? !!readA2uiLink(action) : record(target) &&
          (Object.hasOwn(target, '@path') || isClassicValueFunction(target['@call'])), 'unsafe or invalid link target');
        continue;
      }
      requireClassic(record(action) && allowedKeys(action, ["event"]) && record(action.event)
        && allowedKeys(action.event, ["name", "context", "userMessage"]) && isId(action.event.name), "expected a server event");
      const { context } = action.event;
      requireClassic(context === undefined || (record(context) && Object.entries(context).every(([key, entry]) =>
        isId(key) && (!entry || typeof entry !== "object" || (record(entry) && (Object.hasOwn(entry, "@path") || isClassicValueFunction(entry['@call'])))))), "unsupported event context");
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

const surfaceOperations = ["createSurface", "updateComponents", "updateDataModel", "deleteSurface"] as const;

/** A new publication uses a host-assigned ID. Rebind only the protocol envelope of its single draft surface. */
export function bindA2uiDraftId(messages: readonly unknown[], surfaceId: string): unknown[] {
  requireClassic(messages.length > 0 && messages.length <= MAX_MESSAGES, 'invalid draft batch size');
  const first = messages[0];
  const source = record(first) && record(first.createSurface) ? first.createSurface.surfaceId : undefined;
  requireClassic(isId(source), 'first draft message requires a surface ID');
  return messages.map(message => {
    requireClassic(record(message), 'invalid draft message');
    const operation = surfaceOperations.find(name => Object.hasOwn(message, name));
    requireClassic(operation, 'unsupported draft operation');
    const body = message[operation];
    requireClassic(record(body) && body.surfaceId === source, 'draft batch targets a different surface');
    return { ...message, [operation]: { ...body, surfaceId } };
  });
}

/** Adapt the canonical @-prefixed component descriptors to the installed SDK. */
function forRendererState(messages: readonly unknown[]): unknown[] {
  return structuredClone(messages).map(message => {
    if (!record(message)) return message;
    const body = message.createSurface ?? message.updateComponents;
    if (record(body) && Array.isArray(body.components)) {
      for (const item of body.components) if (record(item)) {
        for (const key of ['catalogId','accessibility','checks','metadata'] as const) if (Object.hasOwn(item, `@${key}`)) {
          item[key] = item[`@${key}`];
          delete item[`@${key}`];
        }
      }
    }
    return message;
  });
}

/** Apply exactly one owned surface's bounded batch to a detached snapshot. */
export function applyA2uiMessages(surfaceId: string, messages: readonly unknown[], previous?: A2uiSnapshot, allowProgressive = false): A2uiSnapshot | null {
  const progressive = previous ? previous.progressive === true : allowProgressive;
  requireClassic(isId(surfaceId) && messages.length > 0 && messages.length <= MAX_MESSAGES, "invalid surface or batch size");
  checkJson(messages);
  requireClassic(encoder.encode(JSON.stringify(messages)).length <= MAX_SURFACE_BYTES, "batch too large");
  const state = new RendererState([catalog]);
  if (previous) {
    requireClassic(previous.surfaceId === surfaceId, "snapshot belongs to another surface");
    // Validate the rehydrated snapshot too and detach the SDK's mutable data model from it.
    verifySnapshot(previous);
    const { progressive: _hostFlag, components, ...body } = previous;
    const restored = state.apply(forRendererState([{ version: "1.0", createSurface: {
      ...body, ...(components.length ? { components } : {}),
    } }]));
    if (!progressive) state.checkTopology(restored);
  }

  let exists = !!previous;
  for (const [index, message] of messages.entries()) {
    requireClassic(record(message) && message.version === "1.0", "expected a v1.0 message");
    const operation = surfaceOperations.find((name) => Object.hasOwn(message, name));
    requireClassic(operation && allowedKeys(message, ["version", operation]), "unsupported operation");
    const body = message[operation];
    requireClassic(record(body) && body.surfaceId === surfaceId, "batch targets a different surface");
    if (operation === "createSurface") {
      requireClassic(!exists && index === 0 && (body.catalogId === undefined || body.catalogId === CLASSIC_A2UI_CATALOG)
        && allowedKeys(body, ["surfaceId", "catalogId", "components", "dataModel", "sendDataModel", "metadata"])
        && (body.sendDataModel === undefined || body.sendDataModel === false), "unsupported surface creation");
      checkMetadata(body.metadata);
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
  const touched = state.apply(forRendererState(messages));
  if (!progressive) state.checkTopology(touched);
  if (!exists) return null;

  const result = state.getSurface(surfaceId)!;
  const snapshot: A2uiSnapshot = {
    surfaceId,
    ...(result.defaultCatalog ? { catalogId: CLASSIC_A2UI_CATALOG } : {}),
    ...(progressive ? { progressive: true } : {}),
    ...(result.metadata === undefined ? {} : { metadata: result.metadata }),
    components: Array.from(result.componentsModel.values, ({ id, type, properties, metadata }) => {
      const { accessibility, checks, ...rest } = properties;
      return { ...rest, id, component: type, ...(result.defaultCatalog ? {} : { '@catalogId': CLASSIC_A2UI_CATALOG }), ...(accessibility === undefined ? {} : { '@accessibility': accessibility }),
        ...(checks === undefined ? {} : { '@checks': checks }), ...(metadata === undefined ? {} : { '@metadata': metadata }) } as A2uiComponent;
    }),
    // SDK deletion leaves an empty array slot; persisted JSON represents it as null without shifting indices.
    dataModel: JSON.parse(JSON.stringify(result.dataModel.get("/"))),
  };
  verifySnapshot(snapshot);
  return snapshot;
}

function verifySnapshot(snapshot: A2uiSnapshot): void {
  checkJson(snapshot);
  requireClassic((snapshot.catalogId === undefined || snapshot.catalogId === CLASSIC_A2UI_CATALOG) && record(snapshot.dataModel)
    && encoder.encode(JSON.stringify(snapshot)).length <= MAX_SURFACE_BYTES, "invalid snapshot or snapshot too large");
  checkMetadata(snapshot.metadata);
  requireClassic(!containsCall(snapshot.dataModel), "functions are not supported in data models");
  checkComponents(snapshot.components);
  const components = new Map(snapshot.components.map((item) => [item.id, item]));
  if (snapshot.progressive) {
    // Buffered definitions are not reachable yet, but still must not contain cycles or unbounded chains.
    const heights = new Map<string, number>();
    const visiting = new Set<string>();
    function height(id: string, depth: number): number {
      requireClassic(depth <= MAX_DEPTH + 1 && !visiting.has(id), 'expected a bounded component tree');
      const known = heights.get(id);
      if (known !== undefined) return known;
      const item = components.get(id);
      if (!item) return 0;
      requireClassic(depth <= MAX_DEPTH, 'expected a bounded component tree');
      visiting.add(id);
      const result = 1 + Math.max(0, ...a2uiChildReferences(item).map(ref => height(ref.id, depth + 1)));
      visiting.delete(id);
      requireClassic(result + depth <= MAX_DEPTH + 1, 'expected a bounded component tree');
      heights.set(id, result);
      return result;
    }
    for (const id of components.keys()) height(id, 0);
  }
  const seen = new Set<string>();
  function walk(id: string, depth: number, canWeight = false, inTemplate = false): void {
    const item = components.get(id);
    if (!item && snapshot.progressive) return;
    requireClassic(item && !seen.has(id) && depth <= MAX_DEPTH, "expected a bounded component tree");
    seen.add(id);
    requireClassic(item.weight === undefined || canWeight, "layout weight requires a Row or Column parent");
    if (!inTemplate) for (const [key, value] of Object.entries(item)) {
      if (key !== 'metadata' && key !== '@metadata') requireClassic(!containsCall(value, '@index'), '@index requires a template instance');
    }
    if (item.component === 'Button' && typeof item.child === 'string') {
      const childKind = components.get(item.child)?.component;
      requireClassic((snapshot.progressive && childKind === undefined) || childKind === 'Text' || childKind === 'Icon', 'button labels must be text or icons');
    }
    for (const ref of a2uiChildReferences(item)) walk(ref.id, depth + 1, ref.canWeight, inTemplate || ref.template);
  }
  walk("root", 0);
  requireClassic(snapshot.progressive || seen.size === components.size, "unreachable components");
  projectA2uiTemplates(snapshot);
}
