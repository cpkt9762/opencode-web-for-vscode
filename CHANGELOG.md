# Changelog

## [0.1.2] - 2026-04-17

### Fixed

- Copy button in webview messages now works via 3-level clipboard fallback polyfill
- Three redundant toolbar buttons (terminal/review/file-tree toggle) hidden in favor of VSCode native
- `^` / `⌘\` shortcuts forward to VSCode native terminal / Explorer
- "Changes" tab hidden to defer to VSCode Source Control
- Entire mobile session tab bar hidden when only "Sessions" would remain
- `⌘B` in webview no longer hijacked by VSCode — defers to SPA native workspace sidebar toggle

### Changed

- VSCode default `workbench.action.toggleSidebarVisibility` is disabled only when chatView is focused

## [0.1.0] - 2026-04-07

### Added

- Initial release
- Sidebar Webview with iframe embedding
- Process management with auto-start
- SDK client integration
- Send code command with @filepath format
- Session/Provider tree views
- Inline diff preview
- PTY terminal
- SSE event synchronization
- Permission/question native dialogs
- CodeLens provider
- File/text/symbol search
- Error recovery with retry logic
- Multi-workspace folder support
