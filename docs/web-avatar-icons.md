# Avatar and install icons

Explicit avatar updates validate and refresh the source before changing the active
identity. Reusing a file path or remote URL refreshes its content. Ordinary image
GETs reuse the cache and do not refetch the source.

## Updates and reset

Settings and `/agent-avatar` use the same avatar cache. Agent and user avatar
commands reject unavailable or undecodable images and keep the previous identity.
Settings reports a failed image update instead of reporting success with old
artwork. Clearing through Settings or `/agent-avatar clear` stores an empty avatar;
it does not reinstate the previous value. Identity setters persist these changes.

Cached images carry a SHA-256 content revision. Avatar URLs, manifest icon URLs and
browser icon-link cache busters use that revision. Identical processed artwork can
keep the same revision even when its source changes. Cache writes use temporary
files and atomic renames; work is serialised per avatar kind. A passive request
captured before an explicit update cannot overwrite the refreshed cache afterwards.

The web command path and Settings broadcast `profile_update`. Classic and
family subscribe. Family receives only public instance name and agent-avatar URL;
operator user identity and arbitrary profile fields are removed at the SSE boundary.
Initial/reconnected pages hydrate from the already-public manifest. An older
manifest response cannot overwrite a newer profile event. Family branding represents
the instance, independently of the signed-in account's avatar.

## Generated images

- Agent source preprocessing uses a maximum 512-pixel bound and strips EXIF.
- `/favicon.ico` serves a centre-cropped 48×48 PNG, with the static ICO as fallback.
- Apple icon routes serve square PNGs at 152, 167 or 180 pixels; the unsized and
  precomposed routes use 180 pixels.
- Manifest `any` icons are square 192/512 PNGs. Separate `maskable` variants fit the
  complete image in a centred square whose side is 56% of the canvas, inside the
  central 80%-diameter safe circle, on an opaque white background.
- `format=png` converts cached JPEG/SVG/GIF/WebP originals too. A failed conversion
  does not return a misleading non-PNG response. Shell icon routes use static
  fallback assets.
- Transformed HEAD requests omit the body and avoid pixel conversion. They omit
  Content-Length because computing it would require encoding the image.
- Manifest responses use `no-store`; generated PNGs use `no-cache`; original avatar
  responses use `no-store`. The service worker does not cache these assets.

## iOS installation

Page-level Apple icon links and the Apple app title update with instance branding.
An already-installed Home Screen icon is managed by iOS; the web app cannot force
its replacement. Linux WebKit tests cover links, titles and events, not native
installation or icon-refresh timing.

For physical-device acceptance, install with avatar A, switch to B, inspect the
open page, relaunch the installed app, inspect the Home Screen icon, and compare a
fresh Add to Home Screen installation. Record the device, OS and elapsed time.
Re-adding is a diagnostic step, not a promise of automatic refresh.

## Regression coverage

The avatar fixture uses disposable files/config and real Sharp processing. It
covers same-path replacement, stable content hashes, reset/set persistence in a
fresh process, failed-source preservation, queued stale reads, maskable corners,
PNG formats and sizes, and HEAD bodies. Server projection tests reject private
fields and revoked clients. Shipped Classic browser fixtures cover profile
updates, clears and reloads in Chromium/WebKit. A shipped family-shell fixture
checks initial branding, live changes and clear without changing account identity.

Run through the isolated test launcher:

```sh
bun run test:local --cwd runtime -- bun test test/channels/web/avatar-icon-audit.test.ts test/web/instance-branding.test.ts test/channels/web/sse-hub.test.ts
bun run test:local --cwd runtime --env PICLAW_RUN_OPTIONAL_BROWSER_TESTS=1 --env PLAYWRIGHT_BROWSERS_PATH=/absolute/browser-cache -- bun test test/web/avatar-icon-audit.playwright.optional.test.ts test/web/family.playwright.optional.test.ts --test-name-pattern 'avatar/icon update audit|family public instance branding'
```
