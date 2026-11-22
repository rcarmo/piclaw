import { createLogger } from '../../../utils/logger.js';
/** In-process add-on A2UI port. A callback is owned by one committed post and never serialised. */
import { isSingleUserAccess } from '../../../core/config-access.js';
import { captureHostDatabaseBinding } from '../../../db/connection.js';
import { getDb } from '../../../db.js';
import { admitSqliteWrite } from '../../../db/sqlite-async-admission.js';
import { stripInternalTags } from '../../../router.js';
import type { Database } from 'bun:sqlite';
import type { A2uiAction } from './action.js';
import { readA2uiLinkTarget, type A2uiSurfaceBlock } from './surface.js';

const log = createLogger("a2ui.addon");

export type AddonA2uiAction = (context: {
  chatJid: string; postId: number; threadId: number;
  values: Readonly<A2uiAction['context']>;
  assertCurrent(): void;
  sendMessage(content: string): Promise<void>;
}) => void | Promise<void>;
type Post = (chatJid: string, content: string, block: A2uiSurfaceBlock, assert: () => void, signal?: AbortSignal) => Promise<number>;
type AddonA2uiInput = { chatJid: string; fallback: string; express: string; actions: Readonly<Record<string, AddonA2uiAction>> };
type PublicationScope = {
  threadId?: number;
  admitPost: Post;
  assertPublication(): void;
  assertAction(): void;
};
let postAdmission: Post | undefined;
const callbacks = new Map<string, { chatJid: string; postId: number; threadId?: number; expires: number; assertAction: () => void; actions: Map<string, AddonA2uiAction> }>();

export function setAddonA2uiPostAdmission(port: Post | undefined): void {
  if (postAdmission !== port) callbacks.clear();
  postAdmission = port;
}

export async function publishAddonA2ui(input: AddonA2uiInput, signal?: AbortSignal): Promise<number> {
  const port = postAdmission;
  if (!port) throw Error('Add-on surface publication unavailable');
  const assertCurrent = () => { if (postAdmission !== port) throw Error('Add-on surface publication unavailable'); };
  return publishBoundAddonA2ui(input, { admitPost: port, assertPublication: assertCurrent, assertAction: assertCurrent }, signal);
}

/** Host-only. A model admits publication; the stored thread and browser own later actions. */
export async function publishNativeAddonA2ui(input: AddonA2uiInput, scope: PublicationScope & { threadId: number }, signal?: AbortSignal): Promise<number> {
  if (!Number.isSafeInteger(scope.threadId) || scope.threadId < 1) throw Error('Native add-on thread is required');
  return publishBoundAddonA2ui(input, scope, signal);
}

async function publishBoundAddonA2ui(input: AddonA2uiInput, scope: PublicationScope, signal?: AbortSignal): Promise<number> {
  const assertBinding = captureHostDatabaseBinding();
  const assertAction = () => {
    assertBinding();
    if (!isSingleUserAccess()) throw Error('Add-on surface action unavailable');
    scope.assertAction();
  };
  const check = () => { assertAction(); signal?.throwIfAborted(); scope.assertPublication(); };
  check();
  const { chatJid, express } = input;
  const fallback = stripInternalTags(input.fallback).trim();
  if (!chatJid.startsWith('web:') || !fallback || fallback.length > 1024) throw Error('A web chat and visible fallback are required');
  const actions = new Map(Object.entries(input.actions));
  if (Array.from(actions.values()).some(handler => typeof handler !== 'function')) throw Error('Invalid add-on action');
  const id = crypto.randomUUID();
  const { compileA2uiExpress, applyA2uiMessages } = await import('./express.js');
  const surface = applyA2uiMessages(id, compileA2uiExpress(express, id));
  if (!surface || surface.sendDataModel) throw Error('Expected a new add-on surface without agent model sync');
  for (const item of surface.components) {
    if (item.component !== 'Button' || readA2uiLinkTarget(item.action) !== undefined) continue;
    const name = (item.action as {event:{name:string}}).event.name;
    if (!actions.has(name)) throw Error('Every add-on event needs an owning callback');
  }
  check();
  const postId = await scope.admitPost(chatJid, fallback, { type: 'a2ui_surface', owner: 'addon', revision: 1, state: 'active', fallback_text: fallback, surface }, check, signal);
  check();
  if (!Number.isSafeInteger(postId) || postId < 1) throw Error('Add-on surface receipt unavailable');
  const expires = Date.now() + 600_000;
  if (callbacks.size >= 128) callbacks.delete(callbacks.keys().next().value!);
  callbacks.set(id, { chatJid, postId, threadId: scope.threadId, expires, assertAction, actions });
  setTimeout(() => callbacks.delete(id), 600_000).unref();
  return postId;
}

export async function invokeAddonA2ui(options: {
  req: Request; chatJid: string; threadId: number; postId: number; block: A2uiSurfaceBlock; action: A2uiAction;
  authorise(): void; assertBinding(): void; assertConsumed(): void; consume(database: Database): void; publish(): void;
  sendMessage(content: string): Promise<void>;
}): Promise<Response> {
  const { req, chatJid, threadId, postId, block, action } = options;
  const pending = callbacks.get(block.surface.surfaceId);
  const handler = pending?.actions.get(action.name);
  const unavailable = () => Response.json({ error: 'This add-on action is no longer available. Open a fresh surface.' }, { status: 409 });
  if (!pending || !handler || pending.chatJid !== chatJid || pending.postId !== postId || (pending.threadId !== undefined && pending.threadId !== threadId)) return unavailable();
  const checkRequest = () => {
    options.assertBinding(); pending.assertAction(); options.authorise(); req.signal.throwIfAborted();
    if (Date.now() >= pending.expires) throw Error('Add-on action expired');
  };
  const check = () => {
    checkRequest();
    if (callbacks.get(block.surface.surfaceId) !== pending) throw Error('Add-on action unavailable');
  };
  try { await admitSqliteWrite(getDb(), () => options.consume(getDb()), check, req.signal, undefined, options.assertBinding); }
  catch { return unavailable(); }
  callbacks.delete(block.surface.surfaceId);
  try { options.publish(); } catch { log.warn("Committed add-on surface update could not be broadcast", { operation: "a2ui.addon.consume_publish" }); }
  try {
    const assertCurrent = () => { checkRequest(); options.assertConsumed(); };
    assertCurrent();
    await handler({ chatJid, postId, threadId, values: action.context, assertCurrent, async sendMessage(content) {
      assertCurrent();
      await options.sendMessage(content);
      assertCurrent();
    } });
    assertCurrent();
  } catch {
    // A failed response is not evidence that the side effect did not happen.
    return Response.json({ error: 'The add-on action did not confirm completion. Check its status before starting again.' }, { status: 502 });
  }
  return Response.json({ status: 'ok' });
}
