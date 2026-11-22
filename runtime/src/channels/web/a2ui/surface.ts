/** The Classic catalog projection shared by the web renderer and the server. */
export const CLASSIC_A2UI_CATALOG = "https://a2ui.org/specification/v1_0/catalogs/basic/catalog.json";

export const CLASSIC_A2UI_PROPERTIES = {
  Text: ["text", "variant"],
  Image: ["url", "description", "fit", "variant"],
  Icon: ["name"],
  AudioPlayer: ["url", "description"],
  Video: ["url", "posterUrl"],
  Row: ["children", "align", "justify"],
  Column: ["children", "align", "justify"],
  List: ["children", "direction", "align"],
  Card: ["child"],
  Tabs: ["tabs"],
  Modal: ["trigger", "content"],
  Divider: ["axis"],
  Button: ["child", "variant", "action"],
  TextField: ["label", "value", "placeholder", "variant"],
  CheckBox: ["label", "value"],
  ChoicePicker: ["label", "value", "options", "variant", "displayStyle", "filterable"],
  Slider: ["label", "value", "min", "max", "steps"],
  DateTimeInput: ["label", "value", "enableDate", "enableTime", "min", "max"],
} as const;

export type A2uiComponent = Record<string, unknown> & {
  id: string;
  component: keyof typeof CLASSIC_A2UI_PROPERTIES;
};

/** Resolve the catalogue's numeric interval before it reaches a browser control. */
export function a2uiSliderRange(item: A2uiComponent) {
  const min = item.min ?? 0;
  const { max, steps } = item;
  if (typeof min !== "number" || typeof max !== "number" || !Number.isFinite(max - min) || min >= max) return;
  if (steps === undefined) return { min, max, step: undefined, steps: undefined };
  if (typeof steps !== "number" || !Number.isSafeInteger(steps) || steps < 1) return;
  const step = (max - min) / steps;
  if (step <= 0 || min + step === min || max - step === max) return;
  return { min, max, step, steps };
}

export interface A2uiMetadata { extensions?: Record<string, unknown> }

/** Committed v1.0 surface state; no unbounded replay of update messages. */
export interface A2uiSnapshot {
  surfaceId: string;
  catalogId?: typeof CLASSIC_A2UI_CATALOG;
  components: A2uiComponent[];
  dataModel: Record<string, unknown>;
  metadata?: A2uiMetadata;
  /** Host-owned flag for raw wire publication, not an A2UI message field. */
  progressive?: true;
}

export interface A2uiSurfaceBlock {
  type: "a2ui_surface";
  surface: A2uiSnapshot;
  revision: number;
  state: "active" | "completed" | "cancelled" | "failed";
  fallback_text: string;
  owner?: "agent" | "totp" | "login" | "addon" | "recovery";
  submit_behavior?: "keep_active";
  last_submission?: { request_id: string; revision: number; digest: string; row_id?: number };
}

export function isA2uiSurfaceBlock(value: unknown): value is A2uiSurfaceBlock {
  if (!value || typeof value !== "object") return false;
  const block = value as Partial<A2uiSurfaceBlock>;
  return block.type === "a2ui_surface" && Number.isSafeInteger(block.revision) && typeof block.fallback_text === "string"
    && !!block.surface && (block.surface.catalogId === undefined || block.surface.catalogId === CLASSIC_A2UI_CATALOG)
    && typeof block.surface.surfaceId === "string"
    && !!block.surface.dataModel && typeof block.surface.dataModel === "object"
    && Array.isArray(block.surface.components) && block.surface.components.length <= 96;
}

/** Return the declared target of the local openUrl action, without evaluating it. */
export function readA2uiLinkTarget(action: unknown): unknown {
  if (!action || typeof action !== 'object' || Array.isArray(action) || Object.keys(action).length !== 1) return;
  const call = (action as { functionCall?: { '@call'?: unknown; args?: { url?: unknown }; catalogId?: unknown } }).functionCall;
  if (!call || call['@call'] !== 'openUrl' || Object.keys(call).length !== (Object.hasOwn(call, 'catalogId') ? 3 : 2)
    || (call.catalogId !== undefined && call.catalogId !== CLASSIC_A2UI_CATALOG)
    || !call.args || Object.keys(call.args).length !== 1 || !Object.hasOwn(call.args, 'url')) return;
  return call.args.url;
}

/** Navigation is available only as an approved browser link, never as generic RPC. */
export function readA2uiLink(action: unknown, resolve: (value: unknown) => unknown = value => value): string | undefined {
  const target = readA2uiLinkTarget(action);
  return target === undefined ? undefined : readA2uiHttpUrl(resolve(target))?.href;
}

function readA2uiHttpUrl(target: unknown): URL | undefined {
  if (typeof target !== 'string' || target.length > 4096 || !/^https?:\/\//i.test(target) || /[\x00-\x20\x7f]/.test(target)) return;
  try {
    const url = new URL(target);
    if ((url.protocol === 'https:' || url.protocol === 'http:') && !url.username && !url.password) return url;
  } catch { return undefined; }
}

/** A surface may show owned media, typed inline images or external HTTP(S) resources. */
export function readA2uiImageUrl(value: unknown, origin: string): string | undefined {
  if (typeof value !== 'string' || value.length > 32_768 || /[\\\x00-\x20\x7f]/.test(value)) return;
  if (/^data:image\/(?:png|jpeg|gif|webp|avif|svg\+xml);base64,[A-Za-z0-9+/]+=*$/i.test(value)) return value;
  return readA2uiResourceUrl(value, origin, /^\/media\/[1-9]\d*(?:\/thumbnail)?$/)?.url;
}

export function readA2uiPlaybackUrl(value: unknown, origin: string, kind: 'audio' | 'video') {
  if (typeof value !== 'string' || value.length > 32_768 || /[\\\x00-\x20\x7f]/.test(value)) return;
  const inline = kind === 'audio' ? /^data:audio\/(?:mpeg|ogg|wav|webm|mp4);base64,[A-Za-z0-9+/]+=*$/i
    : /^data:video\/(?:mp4|webm|ogg);base64,[A-Za-z0-9+/]+=*$/i;
  if (inline.test(value)) return { url: value, external: false };
  return readA2uiResourceUrl(value, origin, /^\/media\/[1-9]\d*$/);
}

function readA2uiResourceUrl(value: string, origin: string, ownedPath: RegExp) {
  if (ownedPath.test(value)) return { url: value, external: false };
  const url = readA2uiHttpUrl(value);
  if (!url) return;
  const external = url.origin !== origin;
  if (!external && (!ownedPath.test(url.pathname) || url.search || url.hash)) return;
  return { url: url.href, external };
}
