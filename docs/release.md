# Release process

## Publishing

Pushing a version tag triggers `.github/workflows/publish.yml`. Its first gate calls the reusable `.github/workflows/integration-gate.yml` against that exact immutable tag SHA; no Docker or portable-artifact build starts until that gate succeeds. It then publishes multi-arch GHCR images:

- `ghcr.io/rcarmo/piclaw:<tag>`
- `ghcr.io/rcarmo/piclaw:latest`

The same workflow also builds deterministic source archives and portable YOLO upgrade artifacts and attaches them to the GitHub release:

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

The workflow also publishes the experimental Electrobun desktop shell for each release runner with a `piclaw-desktop` prefix:

- `piclaw-desktop-<version>-linux-x64.tar.gz`
- `piclaw-desktop-<version>-linux-arm64.tar.gz`
- `piclaw-desktop-<version>-macos-arm64.tar.gz`
- `piclaw-desktop-<version>-windows-x64.zip`

## Cutting a release

The [cut-release skill](/workspace/.pi/skills/cut-release/SKILL.md) defines the full workflow:

- Gathering the delta and drafting release notes
- Local rebuild and CI verification (`make build-piclaw && make ci-fast`)
- Version bump, commit, tag, push
- Remote CI monitoring after push
- GitHub release publishing
- Hotfix retag flow (moving a tag after post-release fixes)
- Local install and restart

### Quick path

```bash
make bump-patch    # or make bump-minor
make push
```

This bumps `VERSION` and `package.json`, commits, tags, and pushes. The CI workflow builds and publishes Docker images for AMD64 and ARM64.

### Full path (recommended)

Always verify locally before pushing:

```bash
make build-piclaw   # full rebuild
make ci-fast        # must show 0 fail
git add -A && git commit -m 'release: <Movie Name> vX.Y.Z'
git tag -a vX.Y.Z -m 'PiClaw vX.Y.Z — <Movie Name>'
git push origin main vX.Y.Z
```

Then monitor CI and publish the GitHub release via the API (see skill for details).

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

Each release gets a cult/classic movie name. See the [cut-release skill](/workspace/.pi/skills/cut-release/SKILL.md) for the full convention and workflow.

## Container runtime compatibility

PiClaw works with any OCI-compliant runtime.

- **Preferred image source:** `ghcr.io/rcarmo/piclaw`
- **Primary target:** Docker / Docker Desktop
- Also works with Apple Containers, Podman, nerdctl, and similar runtimes
