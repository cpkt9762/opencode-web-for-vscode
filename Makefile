.DEFAULT_GOAL := help
SHELL := /bin/bash

ROOT := $(shell pwd)
REPO := $(abspath $(ROOT)/..)

PKG_NAME := opencode-web-for-vscode
VSIX := $(PKG_NAME)-$(shell node -p "require('./package.json').version").vsix

.PHONY: help
help:
	@echo "OpenCode Web for VSCode - Makefile targets:"
	@echo ""
	@echo "  Build:"
	@echo "    make spa           Build SPA assets to ./spa/"
	@echo "    make ext           Build extension JS bundle"
	@echo "    make all           spa + ext"
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
	@echo "    make typecheck     Run TypeScript type check"
	@echo "    make clean         Remove build outputs"
	@echo ""
	@echo "  Debug:"
	@echo "    make logs          Tail debug.log"
	@echo "    make logs-clear    Clear debug.log"

.PHONY: spa
spa:
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
reinstall: uninstall install

.PHONY: watch
watch:
	bun run watch

.PHONY: test
test:
	bun run test

.PHONY: test-e2e
test-e2e:
	TEST_DIR=$(REPO) npx playwright test --config playwright.config.ts

.PHONY: typecheck
typecheck:
	bun run check-types

.PHONY: clean
clean:
	rm -rf dist out *.vsix
	@echo ">> Cleaned. (spa/ kept; run 'make spa' to rebuild)"

.PHONY: logs
logs:
	@test -f debug.log && tail -f debug.log || echo "no debug.log yet"

.PHONY: logs-clear
logs-clear:
	@: > debug.log
	@echo ">> debug.log cleared"
