# Release process

## Publishing

Pushing a version tag triggers `.github/workflows/publish.yml`. Its first gate calls the reusable `.github/workflows/integration-gate.yml` against that exact immutable tag SHA; no Docker or portable-artifact build starts until that gate succeeds. It then publishes multi-arch GHCR images:

- `ghcr.io/rcarmo/piclaw:<tag>`
- `ghcr.io/rcarmo/piclaw:latest`

After the integration gate, the workflow also builds deterministic source archives and portable YOLO upgrade artifacts and attaches them to the GitHub release:

- `piclaw-<version>-source.tar.gz`
- `piclaw-<version>-source.zip`
- `piclaw-<version>-source.SHA256SUMS`
- `piclaw-<version>-source.manifest.json`
- `piclaw-<version>-linux-x64.run`
- `piclaw-<version>-linux-x64-baseline.run` — non-AVX x64 Linux Bun runtime for older CPUs
- `piclaw-<version>-linux-arm64.run`
- `piclaw-<version>-macos-arm64.tar.gz`
- `piclaw-<version>-windows-x64.zip`

The source archives contain tracked repository files at the release tag. They exclude dependencies, generated artifacts, `.git`, and local runtime state. `SHA256SUMS` records checksums for the source archives.

The portable artifacts bundle Bun, Piclaw, built web assets, `skel/`, vendored runtime assets, and production `node_modules` for the target OS/architecture. The `linux-x64-baseline` artifact uses Bun’s non-AVX baseline build.

### Core add-ons in release artifacts

The release snapshot in `release/core-addons/catalog.json` selects entries tagged `core`; `release/core-addons.lock.json` records their versions, public package URLs, SHA-256 checksums and the catalog checksum. The vendored `.tgz` files and `release/core-addons/bun.lock` fix the bytes and dependency graph for this candidate. `bun pm pack` builds the offline seed under `skel/.piclaw/core-addons/defaults` and removes the generated directory after packing. Docker's builder copies these inputs before packing; global packages and portable artifacts carry the packed seed. Source archives carry the snapshot, lock and tarballs, not installed `node_modules`.

Before tagging a new release, refresh the catalog snapshot from the published `piclaw-addons` catalog, select **every** entry currently tagged `core`, fetch its published tarball, update its checksum and dependency lock, then rerun focused seed tests and pack/Docker/portable checks. A later catalog edit cannot alter a tagged artifact. First startup seeds the bundle only where no workspace add-on directory or persisted `messages.db` exists. After that, add-ons remain ordinary user-managed packages: removing or upgrading one survives later Piclaw upgrades.

When `PICLAW_BUILD_EXPERIMENTAL_DESKTOP` is enabled (disabled by default), the workflow also builds the experimental Electrobun desktop shell with a `piclaw-desktop` prefix:

- `piclaw-desktop-<version>-linux-x64.tar.gz`
- `piclaw-desktop-<version>-linux-arm64.tar.gz`
- `piclaw-desktop-<version>-macos-arm64.tar.gz`
- `piclaw-desktop-<version>-windows-x64.zip`

## Cutting a release

Follow the repository [AGENTS.md](../AGENTS.md#release-process) and workflow definitions. Release work uses a PR; do not commit directly to `main`. Merging source changes does not authorise installation or restart.

### Phase 1: validate the release candidate

1. Review the release delta, update version/release notes on a feature branch, and run `bun run typecheck`, `make build-piclaw` and `make ci-fast`.
2. Merge the release PR only after its exact-head checks pass and merge is approved.
3. Create/push a `vX.Y.Z-ux` or `vX.Y.Z-prerelease` tag at the candidate commit. This runs E2E UX tests without publishing images.
4. Wait for every UX stage to pass and inspect its report. If code changes, validate the new candidate before releasing.

### Phase 2: publish the verified candidate

Create the final `vX.Y.Z` tag only after UX validation for the same source commit. Publishing runs the reusable integration gate against that immutable tag SHA before Docker/portable builds. Monitor the gate and publish jobs, then attach the UX report assets.

| Ref/event | CI | E2E UX | Publish |
|---|---|---|---|
| PR / push to `main` | Relevant path-filtered checks | Not automatic | No |
| `v*-ux` / `v*-prerelease` | No ordinary main CI trigger | Yes | No |
| Final `v*` tag | Integration gate called by publish | No automatic UX run | Only after integration passes |

The Makefile's `bump-*` targets create a final tag locally, and `make push` pushes the current branch with tags. They do not replace the UX prerequisite; do not use them as an unchecked shortcut. Do not move a published final tag to hide a failed release; use a separately verified corrective release.

### Access-mode release constraint

The multi-user backend is incomplete. Passing ordinary CI does not enable `family-shared` or `isolated-containers`: preserve `validateAccessStartup` until [#1133](https://github.com/rcarmo/piclaw/issues/1133) migration, isolation and end-to-end gates pass. Release notes must distinguish code present from user-available functionality. Back up configuration, DB, sessions and key material together; never downgrade an activated store by deleting its access marker. See [Access modes](multi-user/README.md).

Build a local source archive when you need to verify the release source payload:

```bash
bun run release:build-source-archive
cat artifacts/release/piclaw-$(jq -r .version package.json)-source.SHA256SUMS
```

Build a local portable artifact for the current architecture when you need a manual YOLO bundle smoke test:

```bash
make portable       # current OS/arch portable runtime artifact
make portable-linux # Linux-only .run alias
make portable-linux-baseline # Linux x64 .run with non-AVX Bun baseline runtime
make portable-mac   # macOS-only .tar.gz alias
make portable-windows # Windows-only .zip alias
make portable-experimental-shell # current OS/arch Electrobun shell artifact with piclaw-desktop prefix
```

Linux smoke-test example:

```bash
make portable-linux
./artifacts/release/piclaw-$(jq -r .version package.json)-linux-$(uname -m | sed 's/x86_64/x64/;s/aarch64/arm64/').run --extract /tmp/piclaw-run-test
/tmp/piclaw-run-test/piclaw-$(jq -r .version package.json)-linux-$(uname -m | sed 's/x86_64/x64/;s/aarch64/arm64/')/bin/piclaw --version
```

Install/upgrade from a release asset on a YOLO Linux host:

```bash
chmod +x piclaw-<version>-linux-x64.run
sudo ./piclaw-<version>-linux-x64.run --install /opt/piclaw
# writes /usr/local/bin/piclaw unless PICLAW_SKIP_BIN_LINK=1 or PICLAW_BIN_DIR is set
```

Package UX reports as one concatenated PDF plus a data-only ZIP before attaching release assets:

```bash
bun run release:package-ux-reports -- --input /tmp/piclaw-vX.Y.Z-ux-reports --version X.Y.Z
# Upload both:
# /workspace/tmp/piclaw-vX.Y.Z-ux-report.pdf
# /workspace/tmp/piclaw-vX.Y.Z-ux-report-data.zip
```

For manual release-image verification outside GitHub Actions, the repo-owned smoke contract is:

```bash
IMAGE_REF=ghcr.io/rcarmo/piclaw:vX.Y.Z \
PLATFORM=linux/amd64 \
EXPECTED_BUN_VERSION=$(tr -d '[:space:]' < BUN_VERSION) \
EXPECTED_RESTIC_VERSION=$(tr -d '[:space:]' < RESTIC_VERSION) \
make publish-smoke
```

Ownership boundary:
- publish smoke is intentionally repo-owned (`make publish-smoke`)
- release/tag/workflow/package pruning is GitHub-native in `.github/workflows/publish.yml`
  because it depends directly on Actions context and GitHub APIs
- Actions workflow runs and Actions artifacts are pruned after release publishing using the oldest timestamp among the latest 5 GitHub releases as the retention cutoff
- A staggered weekly `Actions cleanup` workflow also enforces the seven-day artifact/run and cache retention window; use its `workflow_dispatch` trigger for exceptional maintenance

## Release naming

Each release gets a cult/classic movie name. Follow the repository release instructions and record the name in the release notes.

## Container runtime compatibility

PiClaw works with any OCI-compliant runtime.

- **Preferred image source:** `ghcr.io/rcarmo/piclaw`
- **Primary target:** Docker / Docker Desktop
- Also works with Apple Containers, Podman, nerdctl, and similar runtimes
