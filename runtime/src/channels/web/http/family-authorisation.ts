import type Database from "bun:sqlite";
import type { AuthenticatedPrincipal } from "../../../core/access-types.js";
import { getDb } from "../../../db/connection.js";
import { ChatAccessDenied, resolveAuthorisedChat } from "../../../db/session-ownership.js";
import type { WebChannelLike } from "../core/web-channel-contracts.js";
import { principalResponse } from "../auth/principal.js";
import { enforceBrowserBinding } from "../auth/browser-binding.js";
import { rememberWebOrigin } from "../auth/request-origin.js";
import { getHashtagResponse, getSearchResponse, getThreadResponse, getTimelineResponse } from "../timeline-service.js";
import type { SseAuthorisation } from "../sse/sse.js";
import { handleAuthRoutes } from "./dispatch-auth.js";
import { handleShellRoutes, type ServeStaticAsset } from "./dispatch-shell.js";
import { enforceRequestGuards } from "./request-guards.js";
import { getRouteFlags } from "./route-flags.js";
import { handleFamilyAccountRoutes } from "./family-accounts.js";
import { handleFamilyInvitationRoutes } from "./family-invitations.js";
import { handleFamilyMessageIngress } from "./family-message-ingress.js";
import { handleFamilyMessageRecovery } from "./family-message-recovery.js";
import { handleFamilyScheduledResults } from "./family-scheduled-results.js";
import { handleFamilyScheduledTasks } from "./family-scheduled-tasks.js";
import { handleFamilyMemory } from "./family-memory.js";
import { checkCsrfOrigin } from "./security.js";
import { authoriseExecutionIdentity } from "../../../agent-pool/execution-identity.js";
import { withExecutionIdentity } from "../../../core/execution-context.js";
import { createOwnedRoot, listOwnedLifecycleSessions } from "../../../db/owned-session-lifecycle.js";
import { authoriseOwnedMedia, readOwnedMediaInfo, exportOwnedArchivedTranscript } from "../../../db/owned-resource-reads.js";
import { handleMedia } from "../handlers/media.js";
import { buildContentDisposition } from "./content-disposition.js";
import { requireAccountActor } from "../../../db/account-administration.js";

/** Absent selects the live home; explicit empty/duplicate selectors never fall back. */
function selector(url: URL, key: string): string | undefined {
  const values = url.searchParams.getAll(key);
  if (values.length === 0) return undefined;
  if (values.length !== 1 || !values[0]?.trim()) throw new ChatAccessDenied();
  return values[0].trim();
}

/** Recheck a non-secret login ID, account and parent chain without retaining a cookie. */
export function createSseAuthorisation(database: Database, principal: AuthenticatedPrincipal, chatJid: string): SseAuthorisation {
  const target = resolveAuthorisedChat(database, principal, chatJid, "session.read");
  return Object.freeze({
    chatJid: target.chatJid,
    isAuthorised: () => {
      const login = database.query("SELECT user_id, expires_at FROM web_sessions WHERE session_id = ?")
        .get(principal.authentication.sessionId ?? "") as { user_id: string; expires_at: string } | null;
      if (!login || login.user_id !== principal.userId || !Number.isFinite(Date.parse(login.expires_at)) || Date.parse(login.expires_at) <= Date.now()) return false;
      const current = resolveAuthorisedChat(database, principal, target.chatJid, "session.read");
      return current.rootBranchId === target.rootBranchId;
    },
  });
}

/** Candidate SQL is owner-bound; validate every parent chain before searching it. */
function authorisedSearchChats(database: Database, principal: AuthenticatedPrincipal, rootChatJid?: string): string[] {
  const rows = database.query(`SELECT b.chat_jid FROM session_roots o
    JOIN chat_branches r ON r.branch_id = o.root_branch_id
    JOIN chat_branches b ON b.root_chat_jid = r.chat_jid
    WHERE o.owner_user_id = ? AND (? IS NULL OR r.chat_jid = ?)`)
    .all(principal.userId, rootChatJid ?? null, rootChatJid ?? null) as { chat_jid: string }[];
  return rows.flatMap(row => {
    try { return [resolveAuthorisedChat(database, principal, row.chat_jid, "session.read").chatJid]; }
    catch (error) { if (error instanceof ChatAccessDenied) return []; throw error; }
  });
}

/** Terminal dispatcher: unlisted routes/methods never enter legacy or add-on dispatch. */
export async function handleFamilyRequest(channel: WebChannelLike, req: Request, serveStaticAsset: ServeStaticAsset): Promise<Response> {
  const url = new URL(req.url);
  const path = url.pathname;
  const flags = getRouteFlags(req, path);
  const deny = () => channel.json({ error: "Session access denied." }, 403);
  if (!channel.authGateway.isAuthEnabled()) return channel.json({ error: "Family authentication unavailable." }, 503);

  const invitation = await handleFamilyInvitationRoutes(channel, req);
  if (invitation) return invitation;
  const principal = channel.authGateway.getPrincipal?.(req) ?? null;
  if (path === "/auth/me") {
    if (principal?.mode === "family-shared") {
      const failure = enforceBrowserBinding(req, principal);
      if (failure) return failure;
    }
    return principalResponse(req, principal?.mode === "family-shared" ? principal : null);
  }

  const publicAsset = flags.isGetOrHead && ["/static/common/dist/login.bundle.js", "/static/common/dist/login.bundle.css", "/static/common/dist/invitation.bundle.js"].includes(path);
  const login = flags.isLoginPage || flags.isAuthVerify || flags.isWebauthnLoginStart || flags.isWebauthnLoginFinish;
  if (login || publicAsset || (!principal && flags.isIndex)) {
    // Internal and widget credentials cannot bypass browser account authentication.
    const guard = await enforceRequestGuards({ json: (value, status) => channel.json(value, status), endpointContexts: channel.endpointContexts, authGateway: {
      isAuthEnabled: () => true,
      isInternalSecretEnabled: () => false,
      verifyInternalSecret: () => false,
      isAuthenticated: () => principal?.mode === "family-shared" && principal.kind === "user",
    } }, req, path, publicAsset ? { ...flags, isPublicStatic: true } : flags);
    if (guard) return guard;
    if (publicAsset) return channel.serveStatic(path.slice("/static/".length), req);
    return await handleAuthRoutes(channel, req, flags) ?? deny();
  }

  if (!principal || principal.mode !== "family-shared" || principal.kind !== "user") return channel.json({ error: "Unauthorized" }, 401);
  const bindingFailure = enforceBrowserBinding(req, principal);
  if (bindingFailure) return bindingFailure;
  if (path === "/auth/logout") {
    // Logout always pins the login; a stale tab must not revoke a replacement account.
    if (req.method !== "POST" || !req.headers.has("x-piclaw-account-id") || !req.headers.has("x-piclaw-login-id")
      || !req.headers.get("origin") || !checkCsrfOrigin(req)) return deny();
    const database = getDb();
    database.transaction(() => {
      requireAccountActor(database, principal);
      database.query("DELETE FROM web_sessions WHERE user_id = ? AND session_id = ?").run(principal.userId, principal.authentication.sessionId!);
      database.query("DELETE FROM user_passkey_registrations WHERE user_id = ? AND session_id = ?").run(principal.userId, principal.authentication.sessionId!);
    }).immediate();
    // Do not expire the shared cookie: an in-flight login may already have replaced it.
    return channel.json({ logged_out: true });
  }
  if (path === "/agent/message-recovery") return handleFamilyMessageRecovery(channel, req, principal);
  if (path === "/agent/scheduled-results" || path.startsWith("/agent/scheduled-results/")) return handleFamilyScheduledResults(channel, req, principal);
  if (path === "/agent/scheduled-tasks" || path.startsWith("/agent/scheduled-tasks/")) return handleFamilyScheduledTasks(channel, req, principal);
  if (path === "/agent/family-memory" || path.startsWith("/agent/family-memory/")) return handleFamilyMemory(channel, req, principal);
  if (/^\/agent\/[^/]+\/message$/.test(path)) return handleFamilyMessageIngress(channel, req, principal);
  const accountResponse = await handleFamilyAccountRoutes(channel, req, principal);
  if (accountResponse) return accountResponse;
  // The family shell never loads the legacy app, add-ons, panes, vendor scripts or maps.
  if (flags.isIndex) {
    const response = await channel.serveStatic("family.html", req);
    if (req.method === "HEAD") { await response.body?.cancel(); return new Response(null, { status: response.status, headers: response.headers }); }
    return response;
  }
  if (flags.isGetOrHead && ["/static/common/dist/family.bundle.js", "/static/common/dist/family.bundle.css"].includes(path)) {
    const response = await handleShellRoutes(channel, req, path, flags, serveStaticAsset) ?? deny();
    if (req.method === "HEAD") { await response.body?.cancel(); return new Response(null, { status: response.status, headers: response.headers }); }
    return response;
  }
  const media = path.match(/^\/media\/([1-9]\d*)(?:\/(thumbnail|info))?$/);
  if (req.method === "GET" && media) {
    try {
      const id = Number(media[1]);
      // Deliberately ignore caller-selected chat/owner parameters; resolve stored message links.
      authoriseOwnedMedia(getDb(), principal, id);
      if (media[2] === "info") return channel.json(readOwnedMediaInfo(getDb(), principal, id));
      return handleMedia(channel, id, media[2] === "thumbnail");
    } catch (error) { if (error instanceof ChatAccessDenied) return deny(); throw error; }
  }
  if (req.method === "GET" && path === "/agent/branch-download") {
    try {
      const chatJid = selector(url, "chat_jid");
      if (chatJid === undefined) throw new ChatAccessDenied();
      const limit = selector(url, "limit"), before = selector(url, "before");
      const result = exportOwnedArchivedTranscript(getDb(), principal, chatJid, limit === undefined ? 200 : Number(limit), before === undefined ? undefined : Number(before));
      return new Response(JSON.stringify(result, null, 2) + "\n", { headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Disposition": buildContentDisposition("attachment", `piclaw-transcript-${result.branch.branch_id}.json`),
      } });
    } catch (error) {
      if (error instanceof ChatAccessDenied) return deny();
      return channel.json({ error: "Transcript export failed." }, 400);
    }
  }
  if (path === "/agent/branches" && req.method === "GET") {
    try {
      // Family picker never falls back to runtime-global active sessions.
      const root = selector(url, "root_chat_jid");
      const requested = selector(url, "chat_jid");
      if (requested !== undefined) resolveAuthorisedChat(getDb(), principal, requested, "session.read");
      const archiveFlag = selector(url, "include_archived");
      if (archiveFlag !== undefined && !["true", "false", "1", "0"].includes(archiveFlag)) throw new ChatAccessDenied();
      const branches = listOwnedLifecycleSessions(getDb(), principal, root, archiveFlag === "true" || archiveFlag === "1");
      return channel.json({ branches });
    } catch (error) { if (error instanceof ChatAccessDenied) return deny(); throw error; }
  }
  if (req.method === "POST" && ["/agent/root-session", "/agent/branch-prune", "/agent/branch-restore"].includes(path)) {
    if (!req.headers.get("origin") || !checkCsrfOrigin(req)) return deny();
    const guard = await enforceRequestGuards({ json: (value, status) => channel.json(value, status), endpointContexts: channel.endpointContexts, authGateway: {
      isAuthEnabled: () => true, isInternalSecretEnabled: () => false, verifyInternalSecret: () => false, isAuthenticated: () => true,
    } }, req, path, flags);
    if (guard) return guard;
    try {
      const body = await req.json();
      if (!body || typeof body !== "object" || Array.isArray(body)) return channel.json({ error: "Invalid lifecycle request" }, 400);
      if (path === "/agent/root-session") {
        if (Object.keys(body).length !== 1 || typeof body.agent_name !== "string") return channel.json({ error: "Invalid root request" }, 400);
        return channel.json({ branch: { ...createOwnedRoot(getDb(), principal, body.agent_name), display_name: null } }, 201);
      }
      const allowed = path.endsWith("-restore") ? ["chat_jid", "agent_name"] : ["chat_jid"];
      if (Object.keys(body).some(key => !allowed.includes(key)) || typeof body.chat_jid !== "string"
        || (body.agent_name !== undefined && typeof body.agent_name !== "string")) return channel.json({ error: "Invalid lifecycle request" }, 400);
      const branch = await channel.agentPool.changeOwnedSessionLifecycle(principal, body.chat_jid, path.endsWith("-restore") ? "restore" : "archive", body.agent_name);
      return channel.json({ branch });
    } catch (error) {
      if (error instanceof ChatAccessDenied) return deny();
      return channel.json({ error: "Session lifecycle operation failed." }, 400);
    }
  }
  if (req.method === "POST" && (path === "/agent/branch-fork" || path === "/agent/branch-rename")) {
    // Require a browser origin; internal secrets cannot exempt these mutations.
    if (!req.headers.get("origin") || !checkCsrfOrigin(req)) return deny();
    const guard = await enforceRequestGuards({ json: (value, status) => channel.json(value, status), endpointContexts: channel.endpointContexts, authGateway: {
      isAuthEnabled: () => true, isInternalSecretEnabled: () => false, verifyInternalSecret: () => false,
      isAuthenticated: () => true,
    } }, req, path, flags);
    if (guard) return guard;
    let body: Record<string, unknown>;
    try {
      const value = await req.json();
      if (!value || typeof value !== "object" || Array.isArray(value)) return channel.json({ error: "Invalid JSON object" }, 400);
      body = value;
    } catch { return channel.json({ error: "Invalid JSON object" }, 400); }
    try {
      const keys = path.endsWith("-fork") ? ["chat_jid", "agent_name", "request_id"] : ["chat_jid", "agent_name"];
      if (Object.keys(body).some(key => !keys.includes(key)) || (body.chat_jid !== undefined && typeof body.chat_jid !== "string") || typeof body.agent_name !== "string") return channel.json({ error: "Invalid branch request" }, 400);
      const target = resolveAuthorisedChat(getDb(), principal, body.chat_jid as string | undefined, path.endsWith("-fork") ? "session.fork" : "session.rename");
      if (path.endsWith("-fork") && (typeof body.request_id !== "string" || !/^[a-zA-Z0-9_-]{1,128}$/.test(body.request_id))) return channel.json({ error: "Valid request_id required" }, 400);
      const identity = authoriseExecutionIdentity(getDb(), "family-shared", target.chatJid, {
        actorUserId: principal.userId, ownerUserId: principal.userId, chatJid: target.chatJid, kind: "interactive", authenticationSessionId: principal.authentication.sessionId ?? undefined,
      });
      if (!identity) throw new ChatAccessDenied();
      const branch = await withExecutionIdentity(identity, () => path.endsWith("-fork")
        ? channel.agentPool.createForkedChatBranch(target.chatJid, { agentName: body.agent_name as string, requestId: body.request_id as string })
        : channel.agentPool.renameChatBranch(target.chatJid, { agentName: body.agent_name as string }));
      return channel.json({ branch }, path.endsWith("-fork") ? 201 : 200);
    } catch (error) {
      if (error instanceof ChatAccessDenied) return deny();
      return channel.json({ error: "Branch operation failed." }, 400);
    }
  }
  const readable = req.method === "GET" && (path === "/timeline" || path === "/search" || path === "/sse/stream"
    || /^\/hashtag\/[^/]+$/.test(path) || /^\/thread\/[1-9]\d*$/.test(path));
  if (!readable) return deny();

  try {
    const database = getDb();
    const target = resolveAuthorisedChat(database, principal, selector(url, "chat_jid"), "session.read");
    const root = selector(url, "root_chat_jid");
    if (root !== undefined) {
      const selectedRoot = resolveAuthorisedChat(database, principal, root, "session.read");
      if (selectedRoot.chatJid !== target.rootChatJid) throw new ChatAccessDenied();
    }
    rememberWebOrigin(target.chatJid, req);
    if (path === "/sse/stream") return channel.handleSse(req, createSseAuthorisation(database, principal, target.chatJid));
    const limit = channel.clampInt(url.searchParams.get("limit"), path === "/timeline" ? 10 : 50, 1, 100);
    const offset = channel.clampInt(url.searchParams.get("offset"), 0, 0, Number.MAX_SAFE_INTEGER);
    let result: { status: number; body: unknown };
    if (path === "/timeline") {
      result = getTimelineResponse(target.chatJid, limit, channel.parseOptionalInt(url.searchParams.get("before")) ?? undefined, { user_name: principal.displayName });
      // Only the already-authorised family timeline gets stable IDs for explicit memory preview.
      const body = result.body as { posts: { id: number }[] };
      const source = database.query(`SELECT id FROM messages WHERE rowid=? AND chat_jid=?
        AND length(CAST(content AS BLOB)) BETWEEN 1 AND 102400`);
      result.body = { ...body, posts: body.posts.map(post => {
        const row = source.get(post.id, target.chatJid) as { id: string } | null;
        return row ? { ...post, memory_source: { chat_jid: target.chatJid, message_rowid: post.id, message_id: row.id } } : post;
      }) };
    } else if (path === "/search") {
      const scope = selector(url, "scope") ?? "current";
      if (scope !== "current" && scope !== "root" && scope !== "all") throw new ChatAccessDenied();
      const chats = scope === "current" ? [target.chatJid] : authorisedSearchChats(database, principal, scope === "root" ? target.rootChatJid : undefined);
      const filters = { images: ["1", "true"].includes(url.searchParams.get("images") ?? ""), attachments: ["1", "true"].includes(url.searchParams.get("attachments") ?? "") };
      result = getSearchResponse(target.chatJid, (url.searchParams.get("q") ?? "").trim(), limit, offset, scope, target.rootChatJid, filters, chats);
    } else if (path.startsWith("/thread/")) {
      const id = Number(path.slice("/thread/".length));
      if (!Number.isSafeInteger(id)) throw new ChatAccessDenied();
      result = getThreadResponse(target.chatJid, id);
    } else {
      let tag: string;
      try { tag = decodeURIComponent(path.slice("/hashtag/".length)); } catch { throw new ChatAccessDenied(); }
      result = getHashtagResponse(target.chatJid, tag, limit, offset);
    }
    return channel.json(result.body, result.status);
  } catch (error) {
    if (error instanceof ChatAccessDenied) return deny();
    throw error;
  }
}
