# Plan: VSCode Native Reflection for Agent File Changes

> **Momus Review History**:
>
> - v1 REJECTED (3 blocking issues): T4 data-contract mismatch, T2 payload shapes wrong, missing QA scenarios
> - v2 REJECTED (1 blocking issue): T4 still assumed DiffProvider could fetch before/after text, but session.diff API only returns patches
> - v3 FIX: T4 redesigned to use `vscode.commands.executeCommand("git.openChange", uri)` — bypasses session.diff entirely, uses VSCode's built-in git diff which is accurate and reliable after agent edits
> - v3 REVIEW FINDINGS (pre-v4 Sisyphus audit): (a) `git.openChange` silently no-ops on untracked (newly created) files — VSCode's `getSCMResource` only scans `workingTreeGroup` / `indexGroup` / `mergeGroup`, excluding `untrackedGroup`. (b) git extension's SCM state is async-updated; calling `git.openChange` immediately after disk write races the scan. (c) T3's `Set<string>` does not preserve last-edited order for the "Open File" button target. (d) Goal bullet 4 ("tree-view refresh") had no corresponding task. (e) `SessionStatus` is a discriminated union — `retry` variant carries `attempt/message/next`.
> - v4 FIX: T4 split into "tracked modification" branch (`git.openChange` with explicit `git.refresh` priming + git-extension liveness check) and "untracked new file" branch (falls back to `vscode.diff` with empty-left URI). T3 debounce container changed to `Map<string, number>` (insertion-replace preserves recency). T3/T4 share a single debounce callback with explicit snapshot-before-clear semantics. T2 now routes `file.watcher.updated` to tree refresh, closing Goal bullet 4. SessionStatus contract annotated with full retry fields.
> - v4 REJECTED by Momus (1 blocking issue): T4's `vscode.commands.executeCommand("git.refresh")` without arguments is unreliable — the VSCode git extension registers `git.refresh` with `{ repository: true }`, meaning it's a repository-scoped command that needs a resource URI to resolve which repo to refresh. Naked invocation goes through a repo-picker fallback that can be wrong (multi-repo workspaces), skip silently (no active editor), or fail to actually prime the SCM state for the files we care about.
> - v4.1 FIX: Replaced `executeCommand("git.refresh")` with direct git extension API call `repo.status()` per unique repo. This bypasses the command's repository-resolution machinery entirely, guarantees the correct repo is primed, and is the documented stable way to force a single-repo refresh (see `vscode.git` extension's `Repository.status(): Thenable<void>` in the public `GitExtension` API).

## Problem Statement

When the OpenCode AI agent modifies files through the extension, those changes are only visible inside the SPA iframe. VSCode's native UI (editors, notifications, diff panels) does not proactively reflect agent-driven file modifications. The backend already emits file-level events (`file.edited`, `file.watcher.updated`, `session.status`), but the extension's `EventListener` drops them due to a hardcoded allowlist, and `extension.ts` only routes events by type prefix without consuming payloads.

## Goal

Make agent file modifications reliably and proactively reflect in VSCode's native UI:

- Notification when agent edits a file (debounced, single summary for bulk edits)
- Auto-trigger native diff panel for modified files — tracked modifications use `git.openChange`, newly-created untracked files use `vscode.diff` with an empty-left document
- Session-completion notification on busy→idle transition (with "View Session" action)
- Refresh `sessions` and `providers` tree views when `file.watcher.updated` fires, so watcher-driven UI stays consistent with disk state

## Non-Goals

- Custom `vscode.SourceControl` provider (future phase)
- Inline gutter decorations / TextEditorDecorationType (future phase)
- Modifying the SPA or opencode backend code
- Changing the opencode SDK

## Verified SDK Event Payload Contracts

Source of truth: `packages/sdk/js/src/v2/gen/types.gen.ts`

```ts
// file.edited — properties.file is the ONLY field (NO sessionID)
EventFileEdited = {
  type: "file.edited"
  properties: { file: string }
}

// file.watcher.updated — file path + event kind
EventFileWatcherUpdated = {
  type: "file.watcher.updated"
  properties: { file: string; event: "add" | "change" | "unlink" }
}

// session.status — has sessionID + status discriminated union
EventSessionStatus = {
  type: "session.status"
  properties: { sessionID: string; status: SessionStatus }
}
// SessionStatus (verified at types.gen.ts lines 333-345) is a discriminated union:
//   | { type: "idle" }
//   | { type: "busy" }
//   | { type: "retry"; attempt: number; message: string; next: number }
// Our type guard only needs to read `.status.type`, so the minimal shape
// `{ sessionID: string; status: { type: string } }` is sufficient; the
// retry variant's additional fields are NOT consumed by this plan.

// session.diff — has sessionID + diff array (patches, NOT full text)
EventSessionDiff = {
  type: "session.diff"
  properties: { sessionID: string; diff: Array<SnapshotFileDiff> }
}
// where SnapshotFileDiff = { file: string; patch: string; additions: number; deletions: number; status?: "added"|"deleted"|"modified" }

// session.idle — convenience event for idle transition
EventSessionIdle = {
  type: "session.idle"
  properties: { sessionID: string }
}

// session.diff API response (GET /session/:id/diff) returns Array<SnapshotFileDiff>
// The existing DiffProvider uses session.diff({ sessionID }) which returns { data: unknown }
// and internally extracts Row = { file: string; before?: string; after?: string }
// This means the DiffProvider's data source provides before/after TEXT, not patches.
```

## Architecture

```
opencode backend (SSE)
   │
   ├─ file.edited             ← properties: { file }
   ├─ file.watcher.updated    ← properties: { file, event: add|change|unlink }
   ├─ session.status          ← properties: { sessionID, status: SessionStatus }
   ├─ session.idle            ← properties: { sessionID }
   └─ session.diff            ← properties: { sessionID, diff: SnapshotFileDiff[] }
   │
   ▼
EventListener (src/events/listener.ts)
   │  ← CURRENT: drops file.* events, only passes 11 hardcoded types
   │  ← TARGET:  accept any event with non-empty type string
   │
   ▼
extension.ts onEvent(type, payload) handler
   │  ← CURRENT: only accepts `type`, calls sessions.refresh() / providers.refresh()
   │  ← TARGET:  accept 2 args, route by exact event type, consume typed payload
   │
   ├─→ file.edited          → pendingFiles.set(file, now); armDebounce(2s)
   │
   ├─→ file.watcher.updated → sessions.refresh(); providers.refresh()
   │
   ├─→ session.status       → statusMap.set(sessionID, status.type)
   ├─→ session.idle         → if lastStatus === "busy": notifySessionComplete(sessionID)
   │
   └─→ session.* / provider.* → sessions.refresh() / providers.refresh() [existing]

Shared debounce callback (fires 2s after last pending file.edited):
   1. snapshot = new Map(pendingFiles); pendingFiles.clear()
   2. if notifications.fileEdits: showFileEditNotification(snapshot)
   3. if autoDiff: openDiffsForSnapshot(snapshot)
      openDiffsForSnapshot(snapshot):
         a. Check git extension active; if not, trace & return
         b. Build Map<repoRoot, Repository> by iterating snapshot and calling gitApi.getRepository(uri)
         c. For each unique repo: await repo.status()  // prime SCM state, per-repo not global
         d. For each file in snapshot:
            - resolve repo via gitApi.getRepository(uri)
            - if !repo: trace & continue
            - if file is in repo.state.untrackedChanges:
                vscode.diff(emptyUri, Uri.file(file), `${basename} (New File)`)
            - else:
                executeCommand("git.openChange", Uri.file(file))
         - All per-file failures caught silently, logged via trace()
```

## Constraints

- Only modify files under `opencode-web-for-vscode/src/` and `opencode-web-for-vscode/package.json` — do NOT touch upstream `packages/` or the SPA
- All changes must pass existing vitest suite (`bun run test` in extension dir)
- TypeScript strict mode, no `any` types
- Follow existing code patterns (no destructuring, const over let, early returns)
- Preserve backward compatibility — new behaviors should be opt-in via extension settings

## Risk Assessment

| Risk                                                   | Severity | Mitigation                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| ------------------------------------------------------ | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Backend event names diverge from SDK types             | Medium   | Use SDK `types.gen.ts` as source of truth; `parse()` accepts any non-empty type string so new events pass through                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| SSE reconnection gap loses file events                 | Medium   | Accept best-effort; no replay mechanism available. Session status can be re-fetched on reconnect but file events are fire-and-forget.                                                                                                                                                                                                                                                                                                                                                                                                                |
| Notification spam on bulk edits                        | High     | Debounce: collect file.edited events for 2s, then show single summary notification                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| file.edited lacks sessionID                            | Low      | For notifications: sessionID not needed (file path alone suffices). For diff: use VSCode's native `git.openChange` command which needs only the file URI, not a sessionID                                                                                                                                                                                                                                                                                                                                                                            |
| DiffProvider data shape mismatch                       | Info     | The existing `DiffProvider` expects `before`/`after` text from `session.diff`, but the API only returns `patch` strings. T4 avoids this entirely by using VSCode's built-in git diff. The DiffProvider issue is a pre-existing bug, not introduced by this plan.                                                                                                                                                                                                                                                                                     |
| `git.openChange` silently no-ops on untracked files    | **High** | VSCode's `getSCMResource` (extensions/git/src/commands.ts L5702-5733) only scans `workingTreeGroup`, `indexGroup`, `mergeGroup` — **excludes `untrackedGroup`**. Agent-created new files would otherwise never show a diff. T4 detects untracked status via git extension API and falls back to `vscode.diff(emptyUri, Uri.file(file), title)`.                                                                                                                                                                                                      |
| SCM state async vs disk write race                     | **High** | Git extension's SCM groups are updated via fs-watcher, which is async. Calling `git.openChange` immediately after disk write can race the scan (file not yet in `workingTreeGroup`, command no-ops). Mitigation: call `repo.status()` via the `vscode.git` extension API **per unique repo in the snapshot** before any diff-open. This primes the correct repo deterministically, unlike `executeCommand("git.refresh")` which is a `{ repository: true }`-scoped command that requires a URI arg and falls back to a repo-picker when called bare. |
| Git extension disabled / not installed                 | Low      | Check `vscode.extensions.getExtension("vscode.git")?.isActive` at call time; if false, trace-log and silently skip T4 flow. No crash, no user-facing error.                                                                                                                                                                                                                                                                                                                                                                                          |
| T3 "Open File" target loses recency with `Set<string>` | Medium   | `Set` preserves first-insertion order, not last. Use `Map<string, number>` storing `performance.now()`; re-inserting a key replaces position so the last edit is the iteration-tail entry. Snapshot iterator gives last-edited file for single-file notification and for selecting the "Open File" target.                                                                                                                                                                                                                                           |
| T3/T4 race on shared pending container                 | Medium   | Both handlers drain the same Map on debounce fire. Strict order: (1) snapshot = new Map(pending), (2) pending.clear(), (3) notify using snapshot, (4) diff-open using snapshot. Never read `pending` after clear. Enforced by a single shared callback (see Architecture diagram).                                                                                                                                                                                                                                                                   |
| postMessage origin validation missing                  | Medium   | Out of scope for this plan; flagged as follow-up security task                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |

---

## TODOs

### Phase 1: Widen EventListener

- [x] T1: Expand EventListener to accept all backend events

  **Scope**: `src/events/listener.ts`

  **Details**:
  - Add to `EVENT_TYPES` object: `file_edited: "file.edited"`, `file_watcher_updated: "file.watcher.updated"`, `session_status: "session.status"`, `session_diff: "session.diff"`, `session_idle: "session.idle"`
  - Keep existing event names (`session_created`, `session_updated`, etc.) — do NOT remove them until verified unused. The backend may still emit them.
  - Change `parse()` function: remove the `if (!TYPES.has(input.type)) return` guard. Instead, accept any event whose `type` is a non-empty string. The `TYPES` Set becomes documentation-only, not a filter.
  - Preserve existing retry/heartbeat logic, `RETRY_MS`, `HEART_MS`, `MAX_RETRY` unchanged
  - Preserve `this.input.onEvent(event.type, event.properties ?? {})` call unchanged — it already forwards properties

  **Acceptance Criteria**:
  - [ ] `EVENT_TYPES` object includes all 5 new event type constants
  - [ ] `parse()` accepts events not in the `TYPES` Set (test: pass `{type: "unknown.future.event", properties: {}}` and verify it returns a valid result)
  - [ ] Existing tests still pass (no removed event types)
  - [ ] New test cases for the 5 new event types
  - [ ] `bun run test` passes in extension dir

  **QA Scenario**:
  - **Tool**: `bun run test` in `opencode-web-for-vscode/`
  - **Steps**: (1) Read `src/events/listener.test.ts` to see existing test patterns. (2) Add test: `parse({type: "file.edited", properties: {file: "/foo.ts"}})` returns `{type: "file.edited", properties: {file: "/foo.ts"}}`. (3) Add test: `parse({type: "some.unknown.event", properties: {}})` returns valid result (not undefined). (4) Run `bun run test`.
  - **Expected**: All existing + new tests pass. Zero failures.

  **Parallelizable**: No (foundation for T2-T5)

### Phase 2: Payload-Aware Event Routing

- [x] T2: Refactor extension.ts onEvent handler to consume typed event payloads

  **Scope**: `src/extension.ts` (onEvent callback, ~lines 201-209)

  **Details**:
  - Change `onEvent` callback signature from `(type: string)` to `(type: string, payload: unknown)`. The `EventListener.Input` type already defines `onEvent: (type: string, payload: unknown) => void` — verify this matches.
  - Define payload type guards matching verified SDK contracts:
    ```ts
    // Matches EventFileEdited.properties
    function filePayload(v: unknown): v is { file: string } {
      return obj(v) && typeof (v as Record<string, unknown>).file === "string"
    }
    // Matches EventSessionStatus.properties — status is a nested object with .type
    function sessionStatusPayload(v: unknown): v is { sessionID: string; status: { type: string } } {
      if (!obj(v)) return false
      const r = v as Record<string, unknown>
      if (typeof r.sessionID !== "string") return false
      if (!obj(r.status)) return false
      return typeof (r.status as Record<string, unknown>).type === "string"
    }
    // Matches EventSessionIdle.properties
    function sessionIdlePayload(v: unknown): v is { sessionID: string } {
      return obj(v) && typeof (v as Record<string, unknown>).sessionID === "string"
    }
    ```
    Note: use the existing `obj()` helper already defined in extension.ts (line 81-83).
  - Create event router in onEvent callback:

    ```ts
    onEvent: (type, payload) => {
      output.appendLine(`[SSE] ${type}`)

      if (type === "file.edited" && filePayload(payload)) handleFileEdited(payload.file)
      if (type === "session.idle" && sessionIdlePayload(payload)) handleSessionIdle(payload.sessionID)
      if (type === "session.status" && sessionStatusPayload(payload))
        handleSessionStatus(payload.sessionID, payload.status.type)

      // New in v4: file.watcher.updated drives tree refresh (closes Goal bullet 4)
      if (type === "file.watcher.updated") {
        sessions.refresh()
        providers.refresh()
      }

      // Preserve existing tree refresh behavior
      if (type.startsWith("session.")) sessions.refresh()
      if (type.startsWith("provider.")) providers.refresh()
    }
    ```

  - `handleFileEdited`, `handleSessionIdle`, `handleSessionStatus` are stub functions for now (just `trace()` calls) — T3/T4/T5 will implement them
  - Note: `file.watcher.updated` routing does NOT need a payload guard or a dedicated handler. It just triggers the same tree refresh as existing session/provider events. Triggering both `sessions.refresh()` and `providers.refresh()` is safe because their `refresh()` methods already debounce internally (see `TreeDataProvider` implementations).

  **Acceptance Criteria**:
  - [ ] `onEvent` callback accepts `(type, payload)` — two parameters
  - [ ] 3 type guard functions defined: `filePayload`, `sessionStatusPayload`, `sessionIdlePayload`
  - [ ] Each guard uses the `obj()` helper already in extension.ts
  - [ ] Existing `sessions.refresh()` / `providers.refresh()` calls preserved (still triggered by prefix match)
  - [ ] `file.watcher.updated` triggers BOTH `sessions.refresh()` and `providers.refresh()` exactly once per event
  - [ ] Stub handlers emit trace log when matched
  - [ ] `bun run check-types` passes — zero new errors
  - [ ] `bun run test` passes

  **QA Scenario**:
  - **Tool**: `bun run check-types` and `bun run test` in `opencode-web-for-vscode/`
  - **Steps**: (1) Verify `onEvent` in EventListener Input type accepts 2 args. (2) Read extension.ts, confirm type guards use `obj()` helper. (3) Unit test: simulate `onEvent("file.watcher.updated", { file: "/x", event: "change" })` → assert both `sessions.refresh()` and `providers.refresh()` spies were called exactly once. (4) Run `bun run check-types` — zero errors. (5) Run `bun run test` — all pass.
  - **Expected**: TypeScript compiles cleanly. All tests pass. `trace()` output includes `[SSE] file.edited` when such events arrive.

  **Parallelizable**: No (depends on T1, required by T3-T5)

### Phase 3: Native Reactions to File Events

- [x] T3: Add file-edit notification with debouncing + recency-preserving container

  **Scope**: `src/extension.ts` (implement `handleFileEdited` and the shared debounce machinery that T4 will extend)

  **Details**:
  - **Container choice**: Use `Map<string, number>` (key = absolute file path, value = `Date.now()` when edited), NOT `Set<string>`. Rationale: `Set` preserves first-insertion order, so repeated edits of the same file leave its position stuck at the first time it appeared. A `Map` with `delete`-then-`set` on every edit moves the key to the tail, so the last entry in iteration order is always the most recently edited file.
  - **Shared state at module scope inside `activate`**:
    ```ts
    const pendingFiles = new Map<string, number>()
    let debounceTimer: NodeJS.Timeout | undefined
    const DEBOUNCE_MS = 2000
    ```
  - Implement `handleFileEdited(filePath: string)`:
    ```ts
    function handleFileEdited(filePath: string) {
      pendingFiles.delete(filePath) // move to tail on repeat
      pendingFiles.set(filePath, Date.now())
      if (debounceTimer) clearTimeout(debounceTimer)
      debounceTimer = setTimeout(flushPendingFiles, DEBOUNCE_MS)
      debounceTimer.unref?.() // mirror provider.ts L438-451 pattern
    }
    ```
  - **Critical: `flushPendingFiles` is the shared callback that both T3 and T4 hook into** (T4 extends it). Order is strict:
    ```ts
    async function flushPendingFiles() {
      debounceTimer = undefined
      if (pendingFiles.size === 0) return
      const snapshot = new Map(pendingFiles) // (1) snapshot
      pendingFiles.clear() // (2) clear BEFORE any async work
      await notifyFileEdits(snapshot) // (3) T3 notification
      await openDiffsForSnapshot(snapshot) // (4) T4 auto-diff (no-op if setting off)
    }
    ```
    Never read `pendingFiles` inside `notifyFileEdits` or `openDiffsForSnapshot`. They receive the snapshot by argument. This prevents any T3/T4 race and makes both handlers pure functions of the snapshot.
  - `notifyFileEdits(snapshot: Map<string, number>)`:
    - Read setting `opencode.notifications.fileEdits` (default: `true`). If false, return.
    - Extract the tail entry (most recent) by iterating; TypeScript-friendly form:
      ```ts
      let lastFile: string | undefined
      for (const key of snapshot.keys()) lastFile = key // last iteration wins
      if (!lastFile) return
      ```
    - If `snapshot.size === 1`: show `"OpenCode edited: ${path.basename(lastFile)}"` with "Open File" action
    - If `snapshot.size > 1`: show `"OpenCode edited ${snapshot.size} files"` with "Open File" action (opens `lastFile`)
    - "Open File" action: `await vscode.window.showTextDocument(vscode.Uri.file(lastFile))`
  - Use `setTimeout` / `clearTimeout` / `.unref?.()` exactly like `provider.ts` L438-451.
  - Keep all helpers inline in `extension.ts`. Do NOT create new files.

  **Acceptance Criteria**:
  - [ ] Notification appears ~2s after last file.edited event
  - [ ] Multiple rapid edits (e.g., 5 files in 500ms) produce ONE notification with count `"edited 5 files"`
  - [ ] Repeated edits of the same file (same key N times) produce a single-file notification naming that file as `lastFile`
  - [ ] `"Open File"` action calls `vscode.window.showTextDocument(Uri.file(lastFile))` where `lastFile` is the most-recently-edited entry in the snapshot
  - [ ] Setting `opencode.notifications.fileEdits = false` suppresses notification entirely
  - [ ] Setting registered in package.json `contributes.configuration`
  - [ ] `pendingFiles` is cleared before any async work in `flushPendingFiles` (verified by reading the code)
  - [ ] Unit test: repeated edits of the same file produce `snapshot.size === 1` and correct basename
  - [ ] Unit test: edits A, B, C in that order → snapshot iteration yields A, B, C (verifies `Map` insertion-order behaviour) → `lastFile === "C"`
  - [ ] Unit test: edits A, B, A (3rd edit re-inserts A) → iteration yields B, A (verifies `delete`-then-`set` moves A to tail) → `lastFile === "A"`
  - [ ] `bun run test` passes

  **QA Scenario**:
  - **Tool**: `bun run test` in `opencode-web-for-vscode/`
  - **Steps**: (1) Use `vi.useFakeTimers()`. (2) Call `handleFileEdited("/a.ts")`, `handleFileEdited("/b.ts")`, `handleFileEdited("/c.ts")` within 100ms. (3) `await vi.advanceTimersByTimeAsync(2100)`. (4) Assert `vscode.window.showInformationMessage` called exactly once with message containing `"3 files"`. (5) Reset mocks. (6) Call `handleFileEdited("/x.ts")`, `handleFileEdited("/y.ts")`, `handleFileEdited("/x.ts")`. (7) Advance 2100ms. (8) Assert message contains `"2 files"` (not 3 — `/x.ts` deduped). (9) Assert the "Open File" action target is `/x.ts` (last insertion). (10) Reset. Call `handleFileEdited("/single.ts")`, advance, assert message contains `"single.ts"` basename only.
  - **Expected**: All assertions pass. `bun run test` passes.

  **Parallelizable**: No — T3 owns the shared `flushPendingFiles` skeleton that T4 extends. T5 remains parallelizable (it operates on a different state path).

- [x] T4: Auto-open native diff for edited files (tracked modifications + untracked new files)

  **Scope**: `src/extension.ts` (implement `openDiffsForSnapshot` hooked into T3's `flushPendingFiles`)

  **Why NOT the existing `showDiff()` / `DiffProvider`**: `session.diff` API returns `SnapshotFileDiff[]` with `{ file, patch, additions, deletions, status }` — unified patches, NOT `before`/`after` text (verified at `packages/sdk/js/src/v2/gen/types.gen.ts` lines 141-155, 3668-3688). The existing `DiffProvider` (`src/views/diff.ts` lines 51-63) expects `{ before, after }` from the response, so `showDiff(session, file, "", "")` would render an empty diff. We avoid that code path entirely.

  **Why `git.openChange` ALONE is insufficient (v3 → v4 correction)**: VSCode's `git.openChange` handler (`3rd-github/vscode/extensions/git/src/commands.ts` L1411-1441) calls `getSCMResource(uri)` (same file, L5702-5733), which ONLY scans `workingTreeGroup`, `indexGroup`, and `mergeGroup` — it **excludes `untrackedGroup`**. When the agent creates a new file, it lands in `untrackedGroup`, so `git.openChange` silently no-ops. Additionally, the SCM groups are async-updated via fs-watcher; a file just written to disk may not have propagated yet, so the call races the scan.

  **Why we prime via `Repository.status()` not `executeCommand("git.refresh")` (v4 → v4.1 correction)**: The git extension registers `git.refresh` with `@command('git.refresh', { repository: true })` — it's a repository-scoped command that needs a URI argument to resolve which repo to target. Bare `executeCommand("git.refresh")` goes through a repo-picker fallback that can prompt the user, refresh the wrong repo in multi-repo workspaces, or silently no-op when no editor is active. The stable, deterministic alternative is the git extension's public `Repository.status(): Thenable<void>` API, which forces a refresh on exactly the repo we hold a reference to. We group files by repo first and call `status()` once per unique repo.

  **Design**:
  1. **Feature-gate**: Read setting `opencode.autoDiff` (default: `false`). If false, return immediately.
  2. **Extension liveness check** (once per flush, not per file):
     ```ts
     const gitExt = vscode.extensions.getExtension("vscode.git")
     if (!gitExt || !gitExt.isActive) {
       trace("autoDiff: git extension not active, skipping")
       return
     }
     // Wrap in try/catch: getAPI throws if the extension is installed but disabled via settings
     let gitApi: GitApi
     try {
       gitApi = (gitExt.exports as { getAPI: (v: number) => GitApi }).getAPI(1)
     } catch (err) {
       trace(`autoDiff: git.getAPI(1) threw, skipping: ${String(err)}`)
       return
     }
     ```
     Type `GitApi` minimally (aligns with the public `vscode.git` API in the extension's published `.d.ts`):
     ```ts
     type GitResource = { uri: vscode.Uri }
     type GitRepository = {
       rootUri: vscode.Uri
       state: { untrackedChanges: readonly GitResource[] }
       status: () => Thenable<void> // forces a refresh of THIS repo only
     }
     type GitApi = {
       repositories: readonly GitRepository[]
       getRepository: (uri: vscode.Uri) => GitRepository | null
     }
     ```
  3. **Resolve repos + prime SCM state per-repo** (NOT via `executeCommand("git.refresh")`). Group files by `repo.rootUri.fsPath` so we call `status()` exactly once per repo even when the snapshot has 50 files in the same repo:
     ```ts
     const fileToRepo = new Map<string, GitRepository>()
     const uniqueRepos = new Map<string, GitRepository>() // key = rootUri.fsPath
     for (const filePath of snapshot.keys()) {
       const repo = gitApi.getRepository(vscode.Uri.file(filePath))
       if (!repo) {
         trace(`autoDiff: no git repo for ${filePath}`)
         continue
       }
       fileToRepo.set(filePath, repo)
       uniqueRepos.set(repo.rootUri.fsPath, repo)
     }
     await Promise.all(
       Array.from(uniqueRepos.values()).map(async (repo) => {
         try {
           await repo.status()
         } catch (err) {
           trace(`autoDiff: repo.status() failed for ${repo.rootUri.fsPath}: ${String(err)}`)
         }
       }),
     )
     ```
  4. **For each file with a resolved repo, dispatch based on git status** (re-read `state.untrackedChanges` AFTER `status()` resolves):

     ```ts
     for (const [filePath, repo] of fileToRepo) {
       const uri = vscode.Uri.file(filePath)
       const isUntracked = repo.state.untrackedChanges.some((r) => r.uri.fsPath === filePath)

       try {
         if (isUntracked) {
           // vscode.diff needs a URI for the "left" side. Use an empty in-memory doc.
           const emptyUri = vscode.Uri.parse(`untitled:${path.basename(filePath)}.empty`)
           const title = `${path.basename(filePath)} (New File)`
           await vscode.commands.executeCommand("vscode.diff", emptyUri, uri, title)
         } else {
           await vscode.commands.executeCommand("git.openChange", uri)
         }
       } catch (err) {
         trace(`autoDiff: failed for ${filePath}: ${String(err)}`)
       }
     }
     ```

  5. **No `visibleTextEditors` filter**: v3 required the file to already be open. v4 drops this filter because the whole point of auto-diff is to surface changes the user hasn't noticed yet. Users who want to suppress unsolicited diff tabs leave `opencode.autoDiff = false` (which is the default).
  6. **All failures swallowed via `trace()`**. Never show an error notification for autoDiff — it's a best-effort enhancement.

  **Acceptance Criteria**:
  - [ ] When `opencode.autoDiff = false`: NO calls to `vscode.commands.executeCommand` OR `repo.status()` are made
  - [ ] When `opencode.autoDiff = true` and git extension inactive (or `getAPI(1)` throws): no diff commands called, no `status()` called, one trace log line, no crash
  - [ ] When `opencode.autoDiff = true` and file is tracked-modified: the target file's `repo.status()` is awaited BEFORE `git.openChange` is called for that file
  - [ ] `executeCommand("git.refresh")` (bare, no args) is NEVER called — plan explicitly forbids it
  - [ ] When snapshot contains N files across M unique repos: `repo.status()` is called exactly M times (one per unique `rootUri.fsPath`), NOT N times and NOT once globally
  - [ ] When file is untracked (in `repo.state.untrackedChanges` after status() resolves): `vscode.diff(emptyUri, fileUri, title)` is called; `git.openChange` is NOT called for that file
  - [ ] When file is outside any git repo (`getRepository` returns null): neither `status()`, `git.openChange`, nor `vscode.diff` fires for that file; other files still process
  - [ ] Any thrown error inside `repo.status()` or the per-file try/catch is logged via `trace()` and does NOT propagate
  - [ ] Setting `opencode.autoDiff` registered in package.json with default `false`
  - [ ] `bun run test` passes

  **QA Scenario**:
  - **Tool**: `bun run test` in `opencode-web-for-vscode/`
  - **Steps**:
    1. Mock `vscode.extensions.getExtension("vscode.git")` to return `{ isActive: true, exports: { getAPI: () => mockGitApi } }`.
    2. Build `mockGitApi.getRepository(uri)` returning configurable fake repos. Each fake repo has `rootUri`, `state.untrackedChanges` (configurable), and a spied `status: vi.fn().mockResolvedValue(undefined)`.
    3. Mock `vscode.workspace.getConfiguration("opencode").get("autoDiff")` → `true`.
    4. Spy on `vscode.commands.executeCommand`.
    5. **Case A (tracked, single repo)**: One file at `/repo/foo.ts` routed to `repoA` with `untrackedChanges = []`. Advance 2100ms. Assert: `repoA.status()` called exactly once; `executeCommand("git.openChange", Uri.file("/repo/foo.ts"))` called AFTER `status()` resolves (verify call order via `mockedResolvedValue` ordering); `executeCommand("git.refresh", ...)` NEVER called; `vscode.diff` NEVER called.
    6. **Case B (untracked)**: File at `/repo/new.ts`, `repoA.state.untrackedChanges = [{ uri: Uri.file("/repo/new.ts") }]`. Advance. Assert `repoA.status()` called once; `executeCommand("vscode.diff", emptyUri, Uri.file("/repo/new.ts"), title)` called; `git.openChange` NOT called.
    7. **Case C (multi-repo deduplication)**: 4 files — 2 in `repoA` (root `/a`), 2 in `repoB` (root `/b`). Advance. Assert `repoA.status()` called **exactly once** and `repoB.status()` called **exactly once** (dedup by `rootUri.fsPath`). Assert 4 subsequent `git.openChange` calls (one per file).
    8. **Case D (disabled ext)**: `isActive: false`. Advance. Assert no `status()`, no `git.openChange`, no `vscode.diff`, no exception.
    9. **Case E (getAPI throws)**: `getAPI` throws `new Error("git disabled")`. Advance. Assert no subsequent calls; trace log emitted.
    10. **Case F (no repo)**: `getRepository` returns `null` for the file. Advance. Assert no `status()`, no diff commands; other files with valid repos still process.
    11. **Case G (setting off)**: `autoDiff` → `false`. Advance. Assert `getExtension` never consulted.
    12. **Case H (git.openChange throws)**: Make `executeCommand` throw for `git.openChange`. Advance. Assert no exception propagates; trace log written; subsequent files in the snapshot still process.
    13. **Case I (repo.status() throws)**: Make `repoA.status()` reject. Advance. Assert trace log emitted; `git.openChange` still called for files in `repoA` (best-effort — stale state may no-op, but we do not abort the whole flush).
    14. **FORBIDDEN call check**: In every case, assert `executeCommand("git.refresh", ...)` with ANY args is never seen. This is a regression guard against accidentally reintroducing the v4 mistake.
  - **Expected**: All cases pass. `bun run test` passes.

  **Parallelizable**: No — T4 must be implemented AFTER T3's `flushPendingFiles` skeleton exists. T5 remains parallelizable.

- [x] T5: Session idle notification on busy→idle transition

  **Scope**: `src/extension.ts` (implement `handleSessionIdle` and `handleSessionStatus`)

  **Details**:
  - Use `session.idle` event (type `"session.idle"`, payload `{ sessionID }`) as the primary signal — it fires exactly on idle transition
  - Use `session.status` event as supplementary: track last status per session in a `Map<string, string>` to detect `busy → idle` transitions as fallback
  - Note on `SessionStatus.retry` variant: the `retry` variant carries `attempt`, `message`, `next` in addition to `type`. T5 only consumes `.status.type`, so these extra fields are irrelevant to the type guard and to `handleSessionStatus`. Do NOT widen the guard to validate them — keeping the guard minimal preserves forward compatibility if the SDK adds more fields.
  - (Optional follow-up, not part of T5 scope): `session.error` (`types.gen.ts` L218-231) would surface agent failures to the user. Out of scope for v4 to keep the plan tight; track as a future enhancement.
  - Implement `handleSessionIdle(sessionID: string)`:
    1. Check setting `opencode.notifications.sessionComplete` (default: `true`). If false, return.
    2. Check if last known status for this session was `"busy"`. If not (or no record), return — prevents notification on startup.
    3. Show `vscode.window.showInformationMessage("OpenCode: Agent completed")` with "View Session" button
    4. "View Session" button: call `vscode.commands.executeCommand("workbench.view.extension.opencode-web")` then `vscode.commands.executeCommand("opencode-web.chatView.focus")` then `bridge?.post(MSG.navigate, { sessionId: sessionID })`
       (This replicates the `focus()` function from `src/commands/registry.ts` lines 38-41)
  - Implement `handleSessionStatus(sessionID: string, statusType: string)`:
    - Update the status map: `statusMap.set(sessionID, statusType)`
    - No notification here — just tracking

  **Acceptance Criteria**:
  - [ ] Notification appears when session.idle fires AND last tracked status was "busy"
  - [ ] No notification if last status was "idle" (prevents initial state notification)
  - [ ] No notification if no status was ever tracked for this session (prevents startup noise)
  - [ ] "View Session" button focuses sidebar and navigates to session
  - [ ] Setting `opencode.notifications.sessionComplete = false` suppresses notification
  - [ ] Setting registered in package.json
  - [ ] `bun run test` passes

  **QA Scenario**:
  - **Tool**: `bun run test` in `opencode-web-for-vscode/`
  - **Steps**: (1) Call `handleSessionStatus("ses_1", "busy")`. (2) Call `handleSessionIdle("ses_1")`. (3) Assert `showInformationMessage` called with "Agent completed". (4) Call `handleSessionIdle("ses_1")` again (idle→idle). (5) Assert `showInformationMessage` NOT called again. (6) Call `handleSessionIdle("ses_new")` (no prior status). (7) Assert `showInformationMessage` NOT called.
  - **Expected**: Notification only fires on genuine busy→idle transition. `bun run test` passes.

  **Parallelizable**: Yes (independent of T3, T4 after T2 is done)

### Phase 4: Settings Registration & Integration Test

- [x] T6: Register all new settings in package.json and write integration smoke tests

  **Scope**: `package.json` (contributes.configuration), new test file or extend existing

  **Details**:
  - Add to `contributes.configuration.properties` in `package.json`:
    ```json
    "opencode.notifications.fileEdits": {
      "type": "boolean",
      "default": true,
      "description": "Show notifications when the AI agent edits files"
    },
    "opencode.notifications.sessionComplete": {
      "type": "boolean",
      "default": true,
      "description": "Show notification when the AI agent finishes working"
    },
    "opencode.autoDiff": {
      "type": "boolean",
      "default": false,
      "description": "Automatically open diff panel for files edited by the AI agent (only for files already open in editor)"
    }
    ```
  - Write integration tests that exercise the full event → handler → notification chain:
    - Test 1: EventListener parse() accepts file.edited
    - Test 2: EventListener parse() accepts unknown future event
    - Test 3: filePayload type guard accepts valid / rejects invalid
    - Test 4: sessionIdlePayload type guard accepts valid / rejects invalid
    - Test 5: Debounce consolidation (3 rapid edits → 1 notification)
    - Test 6: Session idle transition (busy→idle notifies, idle→idle does not)
    - Test 7: Settings respected (fileEdits=false suppresses, autoDiff=false suppresses)
    - Test 8: `Map<string, number>` recency — edits A, B, A → iteration yields B, A → lastFile = A
    - Test 9: `flushPendingFiles` snapshot-before-clear — after flush, `pendingFiles.size === 0` and the notification body matches pre-clear content
    - Test 10: T4 untracked branch — file listed in `repo.state.untrackedChanges` triggers `vscode.diff`, NOT `git.openChange`
    - Test 11: T4 tracked branch — `repo.status()` awaited BEFORE `git.openChange`; assert call order on the spy
    - Test 12: T4 per-repo dedup — 4 files across 2 repos → exactly 2 `repo.status()` calls (not 4, not 1)
    - Test 13: T4 git-extension-inactive fallback — `isActive === false` OR `getAPI(1)` throws → no diff commands called, no exception
    - Test 14: T4 regression guard — `executeCommand("git.refresh", ...)` is NEVER called in any scenario
    - Test 15: T2 `file.watcher.updated` routing — simulating this event triggers BOTH `sessions.refresh()` and `providers.refresh()`

  **Acceptance Criteria**:
  - [ ] All 3 settings in package.json with correct type, default, description
  - [ ] At least 15 test cases covering parse, guards, debounce, transitions, settings, Map recency, snapshot semantics, untracked vs tracked diff branches, `repo.status()` ordering + dedup, git-ext-inactive fallback, the `git.refresh` regression guard, and `file.watcher.updated` routing
  - [ ] `bun run test` passes with all new tests
  - [ ] `bun run check-types` passes

  **QA Scenario**:
  - **Tool**: `bun run test` and `bun run check-types` in `opencode-web-for-vscode/`
  - **Steps**: (1) Read package.json, verify 3 new settings exist under contributes.configuration.properties. (2) Run `bun run check-types` — zero errors. (3) Run `bun run test` — all pass including 15+ new tests.
  - **Expected**: Zero TypeScript errors. All tests pass.

---

## Final Verification Wave

- [x] F1: Code review — read every changed file, verify: no `any`, no destructuring, const-only, early returns, follows existing patterns in each file
- [x] F2: Full test suite — run `bun run test` in `opencode-web-for-vscode/`, expect 0 failures
- [x] F3: TypeScript check — run `bun run check-types` in `opencode-web-for-vscode/`, expect 0 errors
- [x] F4: Scope check — run `git diff --stat` and verify only files under `opencode-web-for-vscode/src/` and `opencode-web-for-vscode/package.json` were modified

---

## Dependency Graph (v4)

```
T1 (EventListener widened) ──→ T2 (Payload Routing + file.watcher.updated)
                                    │
                                    ├──→ T3 (flushPendingFiles skeleton + notify) ──→ T4 (diff dispatch, extends flush)
                                    │                                                              │
                                    └──→ T5 (Session Idle)  ◀─ parallel with T3/T4 ──────────────┤
                                                                                                  ▼
                                                                              T6 (Settings + 15 test cases)
```

Key dependency changes from v3:

- T4 is NO LONGER parallel with T3. T3 owns the shared `flushPendingFiles` callback; T4 extends it.
- T5 remains parallel with T3 (different state path).
- T6 runs last.

## File Change Map

| File                                  | Changes                                                                                                                                                                                                                                                                                                   |
| ------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/events/listener.ts`              | Add 5 event types to EVENT_TYPES, remove allowlist guard from parse()                                                                                                                                                                                                                                     |
| `src/extension.ts`                    | Accept payload in onEvent; add 3 type guards; add `pendingFiles: Map<string, number>` + `flushPendingFiles` + `notifyFileEdits` + `openDiffsForSnapshot` + `handleSessionIdle` + `handleSessionStatus`; import `path` for `basename`                                                                      |
| `package.json`                        | Add 3 new settings under contributes.configuration.properties                                                                                                                                                                                                                                             |
| `src/events/listener.test.ts`         | Tests for new event types and relaxed parse()                                                                                                                                                                                                                                                             |
| `src/extension.test.ts` (or new file) | 15 test cases covering guards, debounce, Map recency, snapshot-before-clear, untracked vs tracked diff branches, `repo.status()` ordering + multi-repo dedup, `git.refresh` regression guard, git-ext-inactive fallback, settings, session busy→idle transitions, and `file.watcher.updated` tree refresh |
