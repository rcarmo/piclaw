# Makefile – Top-level build/dev targets for the piclaw project.
#
# Targets:
#   vendor         – Bundle vendored mermaid (minified ESM).
#   build-web      – Build web bundles into static/dist/ (+ sourcemaps).
#   build-ts       – Type-check TypeScript (tsc --noEmit). No generated/dist/ output.
#   build-piclaw   – Full build: build-web (vendor + bundles) + build-ts.
#   pack           – Pack piclaw into a .tgz (depends on build-piclaw).
#   local-install  – Pack and install globally (no restart).
#   lint/test      – Run ESLint and bun test suite.
#   ci-fast        – Run the canonical fast CI guardrails + web build.
#   publish-smoke  – Smoke-test a published piclaw image via env-provided args.
#   up/down/enter  – Docker Compose lifecycle helpers.
#   sync-version   – Sync package.json version to VERSION file.
#   bump-*         – Version bump helpers.
#   push           – Push commits and current tag to origin.
#
# Web build notes:
#   The web frontend now builds into two bundles under web/static/dist/:
#     - app.bundle.js   (authenticated web UI)
#     - login.bundle.js (login page behavior)
#
#   Vendor libs remain separate pre-built assets where useful (e.g. codemirror,
#   marked, katex, mermaid). request-router-service.ts auth-gates app.bundle.js
#   and only allows login.bundle.js pre-auth.

IMAGE ?= pibox
TAG ?= latest
FULL_IMAGE := $(IMAGE):$(TAG)
REGISTRY ?= ghcr.io
GHCR_OWNER ?= $(shell whoami)
GHCR_IMAGE := $(REGISTRY)/$(GHCR_OWNER)/$(IMAGE):$(TAG)

BUN_BIN_REAL ?= $(shell readlink -f $(shell command -v bun 2>/dev/null) 2>/dev/null)
BUN_ROOT ?= $(or $(BUN_INSTALL),$(patsubst %/bin/bun,%,$(BUN_BIN_REAL)),/usr/local/lib/bun)
GLOBAL_PKG := $(BUN_ROOT)/install/global/package.json
GLOBAL_LOCK := $(BUN_ROOT)/install/global/bun.lock
PI_AGENT_VERSION ?= $(shell jq -r '.dependencies["@mariozechner/pi-coding-agent"] // "0.58.3"' package.json)
WEB_BUILD_TEST_TIMEOUT_MS ?= 20000

.PHONY: help up down enter build build-piclaw build-web build-ts vendor update-mermaid-vendor pack \
        local-install restart lint test test-coverage ci-fast ci-integration publish-smoke \
        dual-tag tag-ghcr sync-version bump-minor bump-patch push

help: ## Show this help
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-16s\033[0m %s\n", $$1, $$2}'

# ── Docker ────────────────────────────────────────────────────────────

up: ## Start the container in detached mode
	docker compose up -d

down: ## Stop and remove the container
	docker compose down

enter: ## Enter the running container as agent
	docker exec -u agent -it pibox bash

build: ## Build Docker image
	docker build -t $(FULL_IMAGE) .

# ── Build pipeline ───────────────────────────────────────────────────

vendor: ## Build the checked-in vendored bundles + metadata
	cd runtime && bun run build:vendor
	@ls -lh \
		runtime/web/static/js/vendor/beautiful-mermaid.js \
		runtime/web/static/js/vendor/beautiful-mermaid.meta.json \
		runtime/extensions/viewers/editor/vendor/codemirror.js \
		runtime/extensions/viewers/editor/vendor/codemirror.meta.json \
		runtime/web/static/js/vendor/preact-htm.js \
		runtime/web/static/js/vendor/preact-htm.meta.json \
		runtime/web/static/js/marked.min.js \
		runtime/web/static/js/marked.meta.json \
		runtime/web/static/js/vendor/katex.min.js \
		runtime/web/static/js/vendor/katex.meta.json \
		runtime/web/src/styles/katex.bundle.css \
		runtime/web/src/styles/katex.bundle.meta.json \
		runtime/web/static/fonts/KaTeX_*.woff2 \
		runtime/web/static/fonts/vendor/firacode-nerd-font-mono-regular.ttf \
		runtime/web/static/fonts/vendor/firacode-nerd-font-mono-bold.ttf \
		runtime/web/static/fonts/vendor/firacode-nerd-font.meta.json \
		runtime/web/static/js/vendor/ghostty-web.js \
		runtime/web/static/js/vendor/ghostty-vt.wasm \
		runtime/web/static/js/vendor/ghostty-web.meta.json \
		runtime/extensions/viewers/office-viewer/vendor/docx-preview.min.js \
		runtime/extensions/viewers/office-viewer/vendor/xlsx.full.min.js \
		runtime/extensions/viewers/office-viewer/vendor/PptxViewJS.min.js \
		runtime/extensions/viewers/office-viewer/vendor/jszip.min.js \
		runtime/extensions/viewers/office-viewer/vendor/inter-latin.woff2 \
		runtime/extensions/viewers/office-viewer/vendor/inter-latin-ext.woff2 \
		runtime/extensions/viewers/office-viewer/vendor/office-viewer-libs.meta.json

update-mermaid-vendor: ## Rebuild or upgrade vendored mermaid (use MERMAID_VERSION=1.2.3 to upgrade)
	cd runtime && bun run update:vendor:mermaid $(if $(MERMAID_VERSION),--version $(MERMAID_VERSION),)
	@ls -lh runtime/web/static/js/vendor/beautiful-mermaid.js runtime/web/static/js/vendor/beautiful-mermaid.meta.json

build-web: ## Build web JS/CSS bundles (+ sourcemaps) into static/dist/ (includes vendor bundle)
	cd runtime && bun run build:web
	@cd runtime && bun test --timeout $(WEB_BUILD_TEST_TIMEOUT_MS) test/channels/web/web-build.test.ts test/channels/web/post-link-preview-content.test.ts
	@ls -lh \
		runtime/web/static/dist/app.bundle.js \
		runtime/web/static/dist/app.bundle.js.map \
		runtime/web/static/dist/app.bundle.css \
		runtime/web/static/dist/editor.bundle.js \
		runtime/web/static/dist/editor.bundle.js.map \
		runtime/web/static/dist/login.bundle.js \
		runtime/web/static/dist/login.bundle.js.map \
		runtime/web/static/dist/login.bundle.css

build-ts: ## Type-check TypeScript / validate emit (generated/dist is cleaned up after the run)
	cd runtime && bun run build
# NOTE: generated/dist/ is produced transiently by tsc for validation, then
# removed immediately because Bun runs runtime/src/*.ts directly and release
# artifacts only need runtime/web/static/dist/ bundles plus packaged sources.

build-piclaw: build-web build-ts ## Full build: vendor + web + ts

# ── Pack & install ───────────────────────────────────────────────────

PICLAW_TMPDIR ?= /workspace/.piclaw/tmp
PACK_DIR ?= $(PICLAW_TMPDIR)/piclaw-pack
BUN_CACHE_DIR ?= $(PICLAW_TMPDIR)/bun-cache

pack: build-piclaw ## Pack piclaw into a .tgz (outside the repo)
	@set -e; \
	exec 1>&2; \
	mkdir -p $(PICLAW_TMPDIR); \
	rm -rf $(PACK_DIR) && mkdir -p $(PACK_DIR); \
	TMPDIR=$(PICLAW_TMPDIR) TMP=$(PICLAW_TMPDIR) TEMP=$(PICLAW_TMPDIR) BUN_TMPDIR=$(PICLAW_TMPDIR) \
		bun pm pack --destination $(PACK_DIR); \
	ls -lh $(PACK_DIR)/piclaw-*.tgz || true

restart: ## No-op safety guard: use exit_process from the agent instead of restarting inline
	@printf '%s\n' "[restart] No-op by design." \
		"[restart] Do not restart piclaw inline from an active agent turn." \
		"[restart] Agent-driven reload flow: make local-install, send the final reply, then call exit_process as the last action." \
		"[restart] Manual shell restart (outside the agent turn) should use the native service manager directly if truly needed." \
		"[restart] This target intentionally does nothing to avoid truncating in-flight replies." \
		1>&2

local-install: pack ## Pack and install piclaw globally (no restart)
	@set -e; \
	exec 1>&2; \
	VERSION=$$(jq -r .version package.json); \
	TGZ="$$(find $(PACK_DIR) -maxdepth 1 -type f -name 'piclaw-*.tgz' | sort | tail -1)"; \
	if [ -z "$$TGZ" ]; then printf '%s\n' "[local-install] No package tarball found in $(PACK_DIR)"; exit 1; fi; \
	printf '%s\n' "[local-install] Installing v$${VERSION} globally..."; \
	printf '{"dependencies":{"@mariozechner/pi-coding-agent":"$(PI_AGENT_VERSION)","@mariozechner/pi-agent-core":"$(PI_AGENT_VERSION)","@mariozechner/pi-ai":"$(PI_AGENT_VERSION)","@mariozechner/pi-tui":"$(PI_AGENT_VERSION)","piclaw":"%s"}}\n' \
		"$$TGZ" | sudo tee $(GLOBAL_PKG) >/dev/null; \
	sudo rm -f $(GLOBAL_LOCK); \
	sudo mkdir -p $(PICLAW_TMPDIR) $(BUN_CACHE_DIR); \
	sudo BUN_INSTALL=$(BUN_ROOT) \
		BUN_TMPDIR=$(PICLAW_TMPDIR) \
		BUN_INSTALL_CACHE_DIR=$(BUN_CACHE_DIR) \
		TMPDIR=$(PICLAW_TMPDIR) TMP=$(PICLAW_TMPDIR) TEMP=$(PICLAW_TMPDIR) \
		$(BUN_ROOT)/bin/bun install -g "$$TGZ" \
		--registry https://registry.npmjs.org; \
	sudo chmod -R a+rX $(BUN_ROOT); \
	rm -f "$$TGZ"; \
	DEST_REAL=$(BUN_ROOT)/install/global/node_modules/piclaw; \
	if [ -d "$$DEST_REAL/extensions" ] && [ -d "$$DEST_REAL/node_modules" ]; then \
		sudo ln -sfn "$$DEST_REAL/node_modules" "$$DEST_REAL/extensions/node_modules" 2>/dev/null || true; \
	fi; \
	printf '%s\n' "[local-install] Install complete (no restart)"; \
	printf '%s\n' "[local-install] Done (v$${VERSION})"

# ── Quality ──────────────────────────────────────────────────────────

lint: ## Lint piclaw sources
	cd runtime && bun run lint

test: ## Run piclaw tests
	cd runtime && bun run test

test-coverage: ## Run piclaw tests with coverage
	cd runtime && bun run test:coverage

ci-fast: ## Run the canonical fast CI contract used by GitHub Actions
	bun run ci:fast

ci-integration: ## Run the full integration gate (lint + all tests + static analysis + build + Playwright)
	bun run ci:integration

publish-smoke: ## Smoke-test a published piclaw image (requires IMAGE_REF, PLATFORM, EXPECTED_BUN_VERSION, EXPECTED_RESTIC_VERSION)
	@: "$${IMAGE_REF:?set IMAGE_REF}" "$${PLATFORM:?set PLATFORM}" "$${EXPECTED_BUN_VERSION:?set EXPECTED_BUN_VERSION}" "$${EXPECTED_RESTIC_VERSION:?set EXPECTED_RESTIC_VERSION}"
	bun run ci:publish-smoke

# ── Versioning ───────────────────────────────────────────────────────

sync-version: ## Sync package.json version with VERSION
	@set -e; \
	VERSION=$$(cat VERSION); \
	tmp=$$(mktemp); \
	jq --arg version "$$VERSION" '.version=$$version' package.json > $$tmp; \
	mv $$tmp package.json; \
	echo "Synced package.json to version $$VERSION"

bump-minor: ## Bump minor version, build, commit, and tag
	@OLD=$$(cat VERSION); \
	MAJOR=$$(echo $$OLD | cut -d. -f1); \
	MINOR=$$(echo $$OLD | cut -d. -f2); \
	NEW="$$MAJOR.$$((MINOR + 1)).0"; \
	echo $$NEW > VERSION; \
	$(MAKE) sync-version; \
	$(MAKE) build-piclaw; \
	git add VERSION package.json runtime/web/static; \
	git commit -m "Bump version to $$NEW"; \
	git tag "v$$NEW"; \
	echo "Bumped version: $$OLD -> $$NEW (tagged v$$NEW)"
# NOTE: generated/dist/ remains committed for now, but nothing uses it at runtime.
# Once tsc is switched to --noEmit, remove generated/dist/ from git and keep it out of release artifacts.

bump-patch: ## Bump patch version, build, commit, and tag
	@OLD=$$(cat VERSION); \
	MAJOR=$$(echo $$OLD | cut -d. -f1); \
	MINOR=$$(echo $$OLD | cut -d. -f2); \
	PATCH=$$(echo $$OLD | cut -d. -f3); \
	NEW="$$MAJOR.$$MINOR.$$((PATCH + 1))"; \
	echo $$NEW > VERSION; \
	$(MAKE) sync-version; \
	$(MAKE) build-piclaw; \
	git add VERSION package.json runtime/web/static; \
	git commit -m "Bump version to $$NEW"; \
	git tag "v$$NEW"; \
	echo "Bumped version: $$OLD -> $$NEW (tagged v$$NEW)"

# ── Release ──────────────────────────────────────────────────────────

push: ## Push commits and current tag to origin
	@TAG=$$(git describe --tags --exact-match 2>/dev/null); \
	git push origin main; \
	if [ -n "$$TAG" ]; then \
		echo "Pushing tag $$TAG..."; \
		git push origin "$$TAG"; \
	else \
		echo "No tag on current commit"; \
	fi

dual-tag: build ## Tag image as ghcr.io/<user>/<image>:<tag>
	docker tag $(FULL_IMAGE) $(GHCR_IMAGE)

tag-ghcr: dual-tag ## Convenience alias for dual-tag
