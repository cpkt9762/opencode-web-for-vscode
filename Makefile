.DEFAULT_GOAL := help
SHELL := /bin/bash

ROOT := $(shell pwd)
REPO := $(abspath $(ROOT)/..)
EXT_VERSION := $(shell node -p "require('./package.json').version")
EXT_ID := opencode.opencode-web-for-vscode-$(EXT_VERSION)
INSTALLED_DIR := $(HOME)/.vscode/extensions/$(EXT_ID)
INSTALLED_LOG := $(INSTALLED_DIR)/debug.log

PKG_NAME := opencode-web-for-vscode
VSIX := $(PKG_NAME)-$(EXT_VERSION).vsix

# Patch that customizes the upstream SPA (packages/app) for this extension.
# Applied to the parent opencode monorepo via `git -C $(REPO) apply`.
PATCH_FILE := patches/spa-customizations.patch
PATCH_ABS  := $(ROOT)/$(PATCH_FILE)

.PHONY: help
help:
	@echo "OpenCode Web for VSCode - Makefile targets:"
	@echo ""
	@echo "  Build:"
	@echo "    make spa           Build SPA assets to ./spa/ (auto-applies patch first)"
	@echo "    make ext           Build extension JS bundle"
	@echo "    make all           spa + ext"
	@echo ""
	@echo "  Patch:"
	@echo "    make patch-apply   Apply $(PATCH_FILE) to opencode monorepo (idempotent)"
	@echo "    make patch-revert  Revert $(PATCH_FILE) from opencode monorepo"
	@echo "    make patch-status  Show whether the patch is currently applied"
	@echo ""
	@echo "  Package:"
	@echo "    make vsix          Build all + package .vsix"
	@echo ""
	@echo "  Install:"
	@echo "    make install       Build + package + install into VSCode"
	@echo "    make uninstall     Remove extension from VSCode"
	@echo "    make reinstall     uninstall + install"
	@echo ""
	@echo "  Develop:"
	@echo "    make watch         esbuild watch mode"
	@echo "    make test          Run unit tests (vitest)"
	@echo "    make test-e2e      Run Playwright E2E tests"
	@echo "    make ci-image      Build local arm64 CI image"
	@echo "    make ci-local      Run local arm64 CI (install/typecheck/build/test)"
	@echo "    make typecheck     Run TypeScript type check"
	@echo "    make clean         Remove build outputs"
	@echo ""
	@echo "  Debug:"
	@echo "    make logs          Tail debug.log"
	@echo "    make logs-clear    Clear debug.log"

# Idempotent patch apply: skip if already applied, apply if cleanly applicable,
# error out if the patch has conflicts (doesn't reverse-apply and doesn't forward-apply).
# Runs `git apply` against the parent monorepo ($(REPO)) because the patch
# targets paths like `packages/app/src/...`.
.PHONY: patch-apply
patch-apply:
	@if [ ! -f "$(PATCH_ABS)" ]; then \
		echo "ERROR: patch file not found: $(PATCH_ABS)"; \
		exit 1; \
	fi
	@if git -C "$(REPO)" apply --reverse --check "$(PATCH_ABS)" >/dev/null 2>&1; then \
		echo ">> $(PATCH_FILE) already applied, skip."; \
	elif git -C "$(REPO)" apply --check "$(PATCH_ABS)" >/dev/null 2>&1; then \
		echo ">> Applying $(PATCH_FILE) to $(REPO)..."; \
		git -C "$(REPO)" apply "$(PATCH_ABS)"; \
		echo ">> Patch applied."; \
	else \
		echo "ERROR: $(PATCH_FILE) does not apply cleanly and is not already applied."; \
		echo "       Run 'git -C $(REPO) apply --check $(PATCH_ABS)' to see conflicts."; \
		echo "       Or regenerate the patch with:"; \
		echo "         git -C $(REPO) diff HEAD packages/app/ > $(PATCH_ABS)"; \
		exit 1; \
	fi

.PHONY: patch-revert
patch-revert:
	@if [ ! -f "$(PATCH_ABS)" ]; then \
		echo "ERROR: patch file not found: $(PATCH_ABS)"; \
		exit 1; \
	fi
	@if git -C "$(REPO)" apply --reverse --check "$(PATCH_ABS)" >/dev/null 2>&1; then \
		echo ">> Reverting $(PATCH_FILE) from $(REPO)..."; \
		git -C "$(REPO)" apply --reverse "$(PATCH_ABS)"; \
		echo ">> Patch reverted."; \
	else \
		echo ">> $(PATCH_FILE) is not currently applied, nothing to revert."; \
	fi

.PHONY: patch-status
patch-status:
	@if [ ! -f "$(PATCH_ABS)" ]; then \
		echo "patch file missing: $(PATCH_ABS)"; \
		exit 1; \
	fi
	@if git -C "$(REPO)" apply --reverse --check "$(PATCH_ABS)" >/dev/null 2>&1; then \
		echo "applied: $(PATCH_FILE) is present in $(REPO) working tree"; \
	elif git -C "$(REPO)" apply --check "$(PATCH_ABS)" >/dev/null 2>&1; then \
		echo "clean: $(PATCH_FILE) can be forward-applied to $(REPO)"; \
	else \
		echo "conflict: $(PATCH_FILE) neither applies nor reverses cleanly"; \
		exit 2; \
	fi

.PHONY: spa
spa: patch-apply
	@echo ">> Building SPA..."
	bash scripts/build-spa.sh

.PHONY: ext
ext:
	@echo ">> Building extension..."
	bun run build

.PHONY: all
all: spa ext

.PHONY: vsix
vsix: spa ext
	@echo ">> Packaging $(VSIX)..."
	npx vsce package --no-dependencies --out $(VSIX)
	@echo ">> Done: $(ROOT)/$(VSIX)"

.PHONY: install
install: vsix
	@echo ">> Installing $(VSIX)..."
	code --install-extension $(VSIX) --force
	@echo ">> Reload VSCode to activate."

.PHONY: uninstall
uninstall:
	code --uninstall-extension $(PKG_NAME) || true

.PHONY: reinstall
reinstall: vsix
	@echo ">> Uninstalling extension via VSCode CLI..."
	code --uninstall-extension opencode.opencode-web-for-vscode || true
	@echo ">> Purging cached extension dir: $(INSTALLED_DIR)"
	@rm -rf "$(INSTALLED_DIR)"
	@echo ">> Installing fresh VSIX..."
	code --install-extension $(VSIX) --force
	@echo ">> Reload VSCode (Cmd+Shift+P → Developer: Reload Window) to activate."

.PHONY: watch
watch:
	bun run watch

.PHONY: test
test:
	bun run test

.PHONY: test-e2e
test-e2e:
	TEST_DIR=$(REPO) npx playwright test --config playwright.config.ts

.PHONY: ci-image
ci-image:
	docker build -f Dockerfile.ci -t ocvs-ci .

.PHONY: ci-local
ci-local: ci-image
	docker run --rm \
	  -v "$$PWD:/work" \
	  -w /work \
	  ocvs-ci \
	  bash -lc 'bun install && bun run check-types && bun run build && bun run test'

.PHONY: typecheck
typecheck:
	bun run check-types

.PHONY: clean
clean:
	rm -rf dist out *.vsix
	@echo ">> Cleaned. (spa/ kept; run 'make spa' to rebuild)"

.PHONY: logs
logs:
	@test -f "$(INSTALLED_LOG)" && tail -f "$(INSTALLED_LOG)" || echo "no debug.log at $(INSTALLED_LOG) — reload VSCode first"

.PHONY: logs-clear
logs-clear:
	@: > "$(INSTALLED_LOG)" 2>/dev/null || true
	@echo ">> cleared $(INSTALLED_LOG)"
