/** The Classic catalog projection shared by the web renderer and the server. */
export const CLASSIC_A2UI_CATALOG = "https://a2ui.org/specification/v1_0/catalogs/basic/catalog.json";

export const CLASSIC_A2UI_PROPERTIES = {
  Text: ["text", "variant"],
  Row: ["children", "align", "justify"],
  Column: ["children", "align", "justify"],
  Card: ["child"],
  Divider: ["axis"],
  Button: ["child", "variant", "action"],
  TextField: ["label", "value", "placeholder", "variant"],
  CheckBox: ["label", "value"],
  ChoicePicker: ["label", "value", "options", "variant"],
} as const;

export type A2uiComponent = Record<string, unknown> & {
  id: string;
  component: keyof typeof CLASSIC_A2UI_PROPERTIES;
};

/** A canonical v1.0 createSurface body; no unbounded replay of update messages. */
export interface A2uiSnapshot {
  surfaceId: string;
  catalogId: typeof CLASSIC_A2UI_CATALOG;
  components: A2uiComponent[];
  dataModel: Record<string, unknown>;
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
    && block.surface?.catalogId === CLASSIC_A2UI_CATALOG && typeof block.surface.surfaceId === "string"
    && !!block.surface.dataModel && typeof block.surface.dataModel === "object"
    && Array.isArray(block.surface.components) && block.surface.components.length <= 96;
}

/** One local catalog action: open a static HTTP(S) link in the viewer's browser. */
export function readA2uiLink(action: unknown): string | undefined {
  if (!action || typeof action !== 'object' || Array.isArray(action) || Object.keys(action).length !== 1) return;
  const call = (action as { functionCall?: { '@call'?: unknown; args?: { url?: unknown } } }).functionCall;
  if (!call || call['@call'] !== 'openUrl' || Object.keys(call).length !== 2 || !call.args || Object.keys(call.args).length !== 1) return;
  const target = call.args.url;
  if (typeof target !== 'string' || target.length > 4096 || !/^https?:\/\//i.test(target) || /[\x00-\x20\x7f]/.test(target)) return;
  try {
    const url = new URL(target);
    if ((url.protocol === 'https:' || url.protocol === 'http:') && !url.username && !url.password) return url.href;
  } catch { return undefined; }
}
