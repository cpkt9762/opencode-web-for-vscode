import * as vscode from "vscode"

const msg = "OpenCode: No workspace folder open"

type Pick = vscode.QuickPickItem & {
  folder: vscode.WorkspaceFolder
}

async function pick(folders: readonly vscode.WorkspaceFolder[]) {
  if (folders.length === 0) {
    await vscode.window.showWarningMessage(msg)
    return
  }

  if (folders.length === 1) {
    return folders[0].uri.fsPath
  }

  const items: Pick[] = folders.map((folder) => ({
    description: folder.uri.fsPath,
    folder,
    label: folder.name,
  }))
  const pick = await vscode.window.showQuickPick(items, {
    placeHolder: "Select workspace folder",
  })
  return pick?.folder.uri.fsPath
}

export async function getDirectory() {
  return pick(vscode.workspace.workspaceFolders ?? [])
}

export function onDirectoryChange(cb: (dir: string | undefined) => void) {
  return vscode.workspace.onDidChangeWorkspaceFolders(async () => {
    cb(await getDirectory())
  })
}
