# Vendored xterm.js runtime

This directory vendors the browser terminal runtime used by Piclaw's classic and visual web frontends.

Vendored packages:

- `@xterm/xterm` 6.0.0
- `@xterm/addon-attach` 0.12.0
- `@xterm/addon-canvas` 0.7.0
- `@xterm/addon-clipboard` 0.2.0
- `@xterm/addon-fit` 0.11.0
- `@xterm/addon-image` 0.9.0
- `@xterm/addon-ligatures` 0.10.0
- `@xterm/addon-progress` 0.2.0
- `@xterm/addon-search` 0.16.0
- `@xterm/addon-serialize` 0.14.0
- `@xterm/addon-unicode-graphemes` 0.4.0
- `@xterm/addon-unicode11` 0.9.0
- `@xterm/addon-web-links` 0.12.0
- `@xterm/addon-webgl` 0.19.0

All versions are pinned in `runtime/vendor-manifests/xterm.json`, together with npm registry integrity values and SHA-256 checksums for every source and output file.

Refresh the files and provenance metadata with:

```sh
bun run update:vendor:xterm
```

Verify the checked-in inventory without network access with:

```sh
bun run check:vendor:xterm
```

The updater copies the published files byte-for-byte except for `addon-ligatures.mjs`. That bundle receives the named `browser-safe-dynamic-require` patch, which preserves the existing browser behavior by avoiding bare `require` references in the vendored ESM module. The manifest records both its upstream and patched checksums.

All packages declare the MIT license. `LICENSES.md` records the upstream copyright and license notice; the vendored JavaScript files also retain their upstream license headers. The `@xterm/addon-serialize` 0.14.0 registry tarball declares MIT in `package.json` but does not contain a separate `LICENSE` file.
