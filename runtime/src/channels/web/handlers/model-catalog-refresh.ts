/**
 * web/handlers/model-catalog-refresh.ts – Settings → Models "Update catalogues".
 *
 * Owner-only equivalent of `pi update --models`: force every provider's
 * model catalogue to refresh from the network, then report per provider.
 */
import type { WebChannelLike } from "../core/web-channel-contracts.js";
import { canPrincipalAct } from "../auth/principal.js";
import { readAccessConfig } from "../../../core/config-access.js";
import { refreshModelCatalogs } from "../../../runtime/model-catalog-refresh.js";

const reply = (body: object, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "private, no-store", Vary: "Cookie" } });

export async function handleModelCatalogRefresh(channel: WebChannelLike, req: Request, url: URL): Promise<Response> {
  const principal = channel.authGateway.getPrincipal?.(req, true);
  if (!principal || principal.mode !== "single-user" || !canPrincipalAct(principal, "instance.configure") || readAccessConfig().mode !== "single-user") {
    return reply({ error: "Updating model catalogues is owner-only." }, 403);
  }
  if (url.search) return reply({ error: "Model catalogue refresh does not accept query parameters." }, 400);
  return reply(await refreshModelCatalogs(channel.agentPool.modelRuntime));
}
