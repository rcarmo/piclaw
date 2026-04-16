/**
 * web/http/route-flags.ts – Route classification helpers for web requests.
 */

const APPLE_ICON_PATHS = new Set([
  "/apple-touch-icon.png",
  "/apple-touch-icon-precomposed.png",
  "/apple-touch-icon-180x180.png",
  "/apple-touch-icon-167x167.png",
  "/apple-touch-icon-152x152.png",
]);

/** Precomputed route classification flags used by web HTTP dispatch. */
export type RouteFlags = {
  /** True when the request method is GET or HEAD. */
  isGetOrHead: boolean;
  /** True when the request targets the login page. */
  isLoginPage: boolean;
  /** True when the request targets `/auth/verify`. */
  isAuthVerify: boolean;
  /** True when the request targets the local E2E auth bootstrap endpoint. */
  isE2eBootstrap: boolean;
  /** True when the request targets WebAuthn login start. */
  isWebauthnLoginStart: boolean;
  /** True when the request targets WebAuthn login finish. */
  isWebauthnLoginFinish: boolean;
  /** True when the request targets WebAuthn register start. */
  isWebauthnRegisterStart: boolean;
  /** True when the request targets WebAuthn register finish. */
  isWebauthnRegisterFinish: boolean;
  /** True when the request targets the WebAuthn enrolment page. */
  isWebauthnEnrollPage: boolean;
  /** True when the request targets the internal post endpoint. */
  isInternalPost: boolean;
  /** True when the request targets internal patch-style post updates. */
  isInternalPatch: boolean;
  /** True when the request targets `/` or `/index.html`. */
  isIndex: boolean;
  /** True when the request targets `/manifest.json`. */
  isManifest: boolean;
  /** True when the request targets `/favicon.ico`. */
  isFavicon: boolean;
  /** True when the request targets known Apple touch icon paths. */
  isAppleIcon: boolean;
  /** True when the request targets `/sw.js`. */
  isServiceWorker: boolean;
  /** True when the request path starts with `/static/`. */
  isStaticAsset: boolean;
  /** True when a static asset is safe to serve unauthenticated. */
  isPublicStatic: boolean;
  /** True when the request path starts with `/docs/`. */
  isDocsAsset: boolean;
  /** True when the request targets the agent avatar endpoint. */
  isAvatar: boolean;
  /** True when the request method mutates state (POST/PUT/DELETE/PATCH). */
  isMutating: boolean;
  /** True when the request targets any auth endpoint. */
  isAuthEndpoint: boolean;
};

/**
 * Determine which `/static/` assets are safe to serve without authentication.
 * Public pages only require styling, icons, and the login bundle.
 * @param pathname Request pathname to classify.
 * @returns True when the static asset can be served on unauthenticated pages.
 */
export function isPublicStaticPath(pathname: string): boolean {
  if (pathname.startsWith("/static/fonts/")) return true;

  if (pathname === "/static/dist/login.bundle.js") return true;
  if (pathname === "/static/dist/login.bundle.js.map") return true;
  if (pathname === "/static/dist/login.bundle.css") return true;
  if (pathname === "/static/dist/login.bundle.css.map") return true;

  if (pathname.startsWith("/static/") && /\.(png|ico|svg|jpg|jpeg|webp|gif)$/i.test(pathname)) return true;
  return false;
}

/**
 * Compute common route flags consumed by auth, security, and dispatch pipelines.
 * @param req Incoming HTTP request.
 * @param pathname Parsed request pathname.
 * @returns Route classification flags used by downstream guard/dispatcher logic.
 */
export function getRouteFlags(req: Request, pathname: string): RouteFlags {
  const isGetOrHead = req.method === "GET" || req.method === "HEAD";
  const isAuthVerify = req.method === "POST" && pathname === "/auth/verify";
  const isE2eBootstrap = req.method === "POST" && pathname === "/auth/e2e/bootstrap";
  const isWebauthnLoginStart = req.method === "POST" && pathname === "/auth/webauthn/login/start";
  const isWebauthnLoginFinish = req.method === "POST" && pathname === "/auth/webauthn/login/finish";
  const isWebauthnRegisterStart = req.method === "POST" && pathname === "/auth/webauthn/register/start";
  const isWebauthnRegisterFinish = req.method === "POST" && pathname === "/auth/webauthn/register/finish";

  const isStaticAsset = pathname.startsWith("/static/");

  const isAuthEndpoint =
    isAuthVerify ||
    isE2eBootstrap ||
    isWebauthnLoginStart ||
    isWebauthnLoginFinish ||
    isWebauthnRegisterStart ||
    isWebauthnRegisterFinish;

  return {
    isGetOrHead,
    isLoginPage: isGetOrHead && (pathname === "/login" || pathname === "/login.html"),
    isAuthVerify,
    isE2eBootstrap,
    isWebauthnLoginStart,
    isWebauthnLoginFinish,
    isWebauthnRegisterStart,
    isWebauthnRegisterFinish,
    isWebauthnEnrollPage: isGetOrHead && pathname === "/auth/webauthn/enrol",
    isInternalPost: req.method === "POST" && pathname === "/internal/post",
    isInternalPatch: req.method === "PATCH" && pathname.startsWith("/post/"),
    isIndex: isGetOrHead && (pathname === "/" || pathname === "/index.html"),
    isManifest: isGetOrHead && pathname === "/manifest.json",
    isFavicon: isGetOrHead && pathname === "/favicon.ico",
    isAppleIcon: isGetOrHead && APPLE_ICON_PATHS.has(pathname),
    isServiceWorker: isGetOrHead && pathname === "/sw.js",
    isStaticAsset,
    isPublicStatic: isStaticAsset && isPublicStaticPath(pathname),
    isDocsAsset: pathname.startsWith("/docs/"),
    isAvatar: isGetOrHead && pathname === "/avatar/agent",
    isMutating: req.method === "POST" || req.method === "PUT" || req.method === "DELETE" || req.method === "PATCH",
    isAuthEndpoint,
  };
}

/**
 * Determine whether auth checks can be skipped for this route classification.
 * @param flags Route classification flags for the current request.
 * @param hasInternalAccess Whether internal-secret bypass access has already been validated.
 * @returns True when the request should bypass standard auth-session checks.
 */
export function shouldSkipAuthCheck(flags: RouteFlags, hasInternalAccess: boolean): boolean {
  return (
    hasInternalAccess ||
    flags.isLoginPage ||
    flags.isAuthVerify ||
    flags.isE2eBootstrap ||
    flags.isWebauthnLoginStart ||
    flags.isWebauthnLoginFinish ||
    flags.isWebauthnRegisterStart ||
    flags.isWebauthnRegisterFinish ||
    flags.isManifest ||
    flags.isFavicon ||
    flags.isAppleIcon ||
    flags.isServiceWorker ||
    flags.isPublicStatic ||
    flags.isAvatar
  );
}
