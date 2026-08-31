---
name: cdp-browser-vnc-setup
description: Check and set up the optional managed Linux desktop used by piclaw://vnc/cdp-browser, or explain bring-your-own CDP/VNC setup on macOS and Windows.
distribution: public
---

# CDP browser VNC setup

Use this skill when `piclaw://vnc/cdp-browser` reports missing dependencies or when an operator wants to prepare browser viewing before opening the pane.

## Check first

Run the packaged check script from the installed Piclaw package or repository root:

```bash
bun runtime/skills/integrations/cdp-browser-vnc-setup/check.ts
```

The check is read-only. It reports:

- platform support;
- `Xvfb`, `x11vnc`, and `xauth` availability;
- the Chromium-family browser command Piclaw can launch;
- whether the stable pane path can use the managed Linux service.

## Linux managed setup

Piclaw starts the managed desktop only after an authenticated request opens `piclaw://vnc/cdp-browser`. It does not start Chromium, Xvfb, or VNC during Piclaw boot.

On Debian or Ubuntu, install the missing packages explicitly:

```bash
sudo apt update
sudo apt install xvfb x11vnc xauth chromium
```

Distribution package names vary. Chrome or Edge can replace Chromium when their executable is in `PATH`.

After installation:

1. run the check script again;
2. optionally run the isolated lifecycle smoke with a disposable workspace:

   ```bash
   bun runtime/scripts/managed-cdp-browser-vnc-smoke.ts /tmp/piclaw-cdp-vnc-smoke
   ```

3. open `piclaw://vnc/cdp-browser` in a Piclaw pane;
4. use `cdp_browser` normally—the tool prefers the same managed browser while it is active.

The managed service:

- binds CDP and VNC to `127.0.0.1`;
- disables X11 TCP listening;
- uses a private Xauthority cookie;
- runs x11vnc with `-shared -forever` so multiple Piclaw viewers can attach;
- stores the Chromium profile under `/workspace/.piclaw/browser/profile` by default;
- stops only processes it launched when Piclaw shuts down.

## macOS and Windows

The managed desktop is Linux-only. Bring your own browser and VNC service:

1. launch Chrome, Edge, or Chromium with a loopback CDP port in the `9224`–`9233` range;
2. expose the same visible desktop through a VNC server bound to loopback or an allowlisted private address;
3. add that VNC endpoint to Piclaw’s configured VNC targets or enable direct targets deliberately;
4. use the ordinary `piclaw://vnc/<target>` pane path.

Do not expose unauthenticated CDP or VNC ports to public interfaces.

## Troubleshooting

- **Missing dependencies:** install only the packages listed by the pane/check script.
- **No free display or port:** stop stale Xvfb/x11vnc/Chromium processes or inspect ports `5901`–`5910` and `9224`–`9233`.
- **Browser starts but CDP does not respond:** verify the browser accepts `--remote-debugging-address=127.0.0.1` and the selected port.
- **VNC connects but shows no browser:** check the browser process has the same `DISPLAY` and `XAUTHORITY` as Xvfb/x11vnc.
- **Container sandbox:** Piclaw uses Chromium’s normal sandbox on native Linux. In recognised Docker, Podman, Kubernetes, or LXC runtimes, it logs a warning and adds `--no-sandbox` because nested user/network namespaces may be unavailable. Treat the container boundary as the browser isolation boundary, or configure a bring-your-own browser/VNC target if that is unsuitable.
