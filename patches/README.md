# SPA Customization Patches

This directory contains patches that customize the upstream OpenCode SPA (`packages/app`)
for use inside the VSCode webview iframe.

## Files

- **`spa-customizations.patch`** — All SPA modifications combined

## What the patch changes

### 1. `prompt-input.tsx` — defensive `Array.isArray` guard

Upstream sometimes returns `command` as `undefined` for fresh sessions. Without
this guard the SPA crashes when initializing the prompt input.

### 2. `prompt-input/submit.ts` — defensive `Array.isArray` guard (2 places)

Same root cause as above. The submit pipeline also reads `sync.data.command`.

### 3. `context/global-sync/bootstrap.ts` — defensive `Array.isArray` guard

The bootstrap loop iterates `command` during initial sync. Same defensive guard.

### 4. `pages/layout/helpers.ts` — `workspaceKey` undefined guard

```ts
export const workspaceKey = (directory: string) => {
  if (!directory) return ""   // <-- patch
  ...
}
```

Without this, the SPA crashes with `Cannot read properties of undefined (reading 'replaceAll')`
during initial render when filtering sessions before the path store is populated.

### 5. `pages/layout.tsx` — diagnostic logging + auto-navigate to last session

- Adds `spaLog()` helper that posts log messages to the parent webview via
  `window.parent.postMessage({type: "opencode-web.spa-log", msg})`. The
  webview shell forwards these to the extension which writes them to `debug.log`.

- Adds `createEffect` watching `params.id` route changes; posts `session-changed`
  message to the parent so the extension can persist `lastSessionId` in
  `workspaceState`.

- Modifies `autoselecting` resource: when `autoselect` is `false` (URL is `/:dir`
  with no session id) AND `store.lastProjectSession[root]` exists, auto-opens
  the project to navigate to the last session. Without this, fresh F5 launches
  show an empty session list even though localStorage has the last session.

- Adds `spaLog` instrumentation in `navigateToProject`, `navigateToSession`,
  and `navigateWithSidebarReset` for debugging session navigation.

## Applying the patch

```bash
# In the opencode monorepo root
git apply opencode-web-for-vscode/patches/spa-customizations.patch
```

## Updating the patch (after upstream changes)

After modifying SPA files in the opencode monorepo:

```bash
# In the opencode monorepo root
git diff HEAD packages/app/ > opencode-web-for-vscode/patches/spa-customizations.patch
```

## Verifying the patch on a new opencode version

```bash
# 1. Checkout new version
git checkout v1.4.0 -b build/v1.4.0

# 2. Test patch applies cleanly
git apply --check opencode-web-for-vscode/patches/spa-customizations.patch

# 3. Apply
git apply opencode-web-for-vscode/patches/spa-customizations.patch

# 4. Build
cd opencode-web-for-vscode && make spa
```
