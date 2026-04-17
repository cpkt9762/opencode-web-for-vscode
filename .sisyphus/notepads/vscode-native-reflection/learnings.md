# Learnings

## [2026-04-17] Session Start

- Plan v4.1 — approved by Momus after 4 revisions
- Key correction: repo.status() per unique repo, NOT executeCommand("git.refresh")
- git.openChange silently no-ops on untracked files — must detect and use vscode.diff fallback
- Map<string, number> for recency-preserving container (delete-then-set pattern)
- Dependency chain: T1 → T2 → T3 → T4, T5 parallel with T3/T4, T6 last
- T2: keep typed SSE payload guards and stub handlers inside activate() so they can reuse trace() and the shared obj() helper without widening module scope
- T2: extension.test.ts did not need mock changes; the existing EventListener vi.fn mock still accepted the runtime callback and the suite passed unchanged
- T3: file edit batching needs snapshot-before-clear plus delete-then-set Map ordering so the notification action opens the most recently edited file after the 2s debounce window
- T5: session complete notifications should gate on a per-session status Map and only fire when session.idle follows a tracked "busy" state, which avoids startup noise and duplicate idle alerts
- T5: extension.test.ts needs a vscode.commands.executeCommand mock and the bridge MSG.navigate constant when asserting the "View Session" action focuses the sidebar and posts navigation back into the webview bridge
- T4: openDiffsForSnapshot can stay entirely inside activate() with local GitApi/GitRepository types, which lets it reuse trace() and basename without widening module scope
- T4: native auto-diff must short-circuit before touching vscode.git when opencode.autoDiff is false; the regression guard is an afterEach assertion that no test ever dispatches git.refresh
- T4: repo.status() should be primed once per unique repo root, then tracked files use git.openChange while untracked files use vscode.diff against an untitled:<basename>.empty left URI
- T6: listener.test.ts already covered EventListener parse passthrough for file.edited and unknown future events, so the remaining smoke gaps were extension-level guards and routing assertions
- T6: package.test.ts only validates commands, menus, and keybindings; configuration property coverage currently lives in direct package.json assertions plus runtime extension tests
- T6: the debounce regression surface is twofold: delete-then-set preserves Map recency for repeated edits, and flushPendingFiles must snapshot one batch before later edits queue a new debounce cycle
