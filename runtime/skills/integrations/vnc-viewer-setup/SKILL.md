---
name: vnc-viewer-setup
description: Configure saved VNC targets, explain connection history and hidden controls, and test a real disposable x11vnc desktop without touching production.
---

# VNC viewer setup

The web UI hosts the VNC pane. Open `piclaw://vnc` for the connection manager or `piclaw://vnc/<encoded-target-id>` for a configured target. The renderer and WebSocket-to-TCP protocol remain unchanged.

## Configure targets

Read the active instance's settings and service layout first. Do not edit another host's profile or restart without permission. The source-of-truth setting is `domains.web.vncTargets`, a **JSON string**, not a nested array:

```json
{
  "domains": {
    "web": {
      "vncAllowDirect": false,
      "vncTargets": "[{\"id\":\"lab\",\"label\":\"Lab desktop\",\"host\":\"127.0.0.1\",\"port\":5901,\"readOnly\":false}]"
    }
  }
}
```

Merge those keys into the existing settings; do not replace the whole file. Targets are loaded when the VNC service is constructed. Arrange an approved restart to apply a changed target list. The deprecated environment aliases `PICLAW_WEB_VNC_TARGETS` and `PICLAW_WEB_VNC_ALLOW_DIRECT` remain compatibility inputs, not the preferred configuration.

- `id`: stable target reference; `label`: display name.
- `host` and `port`: address reached **from the Piclaw server**, not the browser.
- `readOnly`: disables viewer keyboard, pointer and clipboard sending. It is a client interaction restriction, not an upstream VNC authorization boundary.
- `vncAllowDirect: false`: only configured targets can be selected. A remembered address does not bypass current backend policy.
- Configured targets do not grant family/isolated sessions access to VNC routes. Keep the existing authentication and route restrictions.
- Never place VNC passwords in target JSON, labels, URLs or history. Use the password field for the current connection.

For the managed Linux browser desktop, use [cdp-browser-vnc-setup](../cdp-browser-vnc-setup/SKILL.md). Do not start or reconfigure the production desktop just to test this viewer.

## Viewer behaviour

New direct connections start at `localhost:5901`. Configured targets and recent successful connections are separate. Browser history is scoped to the account, origin and instance workspace, with up to ten recents plus ten pins. Only the first painted frame records a success. Pin, unpin, remove and clear operate on local metadata; clear preserves pins. Missing/corrupt/blocked storage does not stop a connection. Old unscoped preferences are not migrated.

The connected pane has no permanent toolbar. Move to its top centre for a small chevron, then hover or activate it. Touch users tap or swipe down at the top centre, including any letterboxing. Keyboard users press `Ctrl+Alt+Shift+V`; Escape or Hide returns to the desktop. Open details and keyboard focus retain the controls. Clipboard actions require deliberate activation and show manual-copy/paste guidance when browser clipboard access is denied.

Connections & history retains the active session until another target is selected. Disconnect releases input, closes the socket and cancels automatic retries. Authentication failure offers a password retry. Network failures allow reconnect or a return to connections. History contains no passwords or clipboard contents. Existing short-lived pop-out password handoff is separate from history.

## Real disposable acceptance test (Linux)

Requires Bun dependencies and a Playwright Chromium installation, plus `sudo`, `unshare`, `ip`, `Xvfb`, `xterm`, `x11vnc`, `xclip`, and `xprop`.

From the repository root as an ordinary user:

```sh
PLAYWRIGHT_BROWSERS_PATH="$HOME/.cache/ms-playwright" \
  runtime/scripts/test-vnc-disposable.sh /tmp/vnc-evidence
```

The runner creates a private network namespace, enables only loopback, drops back to the invoking user, starts a separate X display and x11vnc at untouched `localhost:5901`, then runs the real pane with the real session service. Port 5902 tests password failure/recovery using a disposable known test password. It cannot reach the host's TCP desktop. The runner refuses to execute its inner mode in the host network namespace. It cleans up its X/VNC processes and temporary files.

The browser tests cover framebuffer pixels, remote keyboard input, ClientCutText in the X cut buffer, remote clipboard reception, reconnect/history, hover/touch/keyboard controls, narrow layouts, read-only input, authentication failure, denied/unavailable targets, blocked storage and pending-load disposal. Screenshots and the test log are saved to the output directory. They test the mounted Classic pane and actual backend services, not the full application authentication shell; route security remains covered by the existing backend suite.

Do not run the optional browser test directly against a live server. Both `PICLAW_E2E_DISPOSABLE=1` and `PICLAW_RUN_OPTIONAL_BROWSER_TESTS=1` are required and are set by the runner.
