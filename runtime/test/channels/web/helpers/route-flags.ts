/**
 * test/channels/web/helpers/route-flags.ts – Shared route-flag fixtures for HTTP dispatch tests.
 */

import type { RouteFlags } from "../../../src/channels/web/http/route-flags.js";

/** Build route flags with explicit defaults and optional overrides for focused test cases. */
export function buildRouteFlags(overrides: Partial<RouteFlags> = {}): RouteFlags {
  return {
    isGetOrHead: false,
    isLoginPage: false,
    isAuthVerify: false,
    isWebauthnLoginStart: false,
    isWebauthnLoginFinish: false,
    isWebauthnRegisterStart: false,
    isWebauthnRegisterFinish: false,
    isWebauthnEnrollPage: false,
    isInternalPost: false,
    isInternalPatch: false,
    isIndex: false,
    isManifest: false,
    isFavicon: false,
    isAppleIcon: false,
    isServiceWorker: false,
    isStaticAsset: false,
    isPublicStatic: false,
    isDocsAsset: false,
    isAvatar: false,
    isMutating: false,
    isAuthEndpoint: false,
    ...overrides,
  };
}
