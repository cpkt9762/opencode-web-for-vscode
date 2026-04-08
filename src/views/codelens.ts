import * as vscode from "vscode"

type Sym = vscode.DocumentSymbol | vscode.SymbolInformation

export class OpenCodeLensProvider implements vscode.CodeLensProvider {
  private change = new vscode.EventEmitter<void>()
  readonly onDidChangeCodeLenses = this.change.event

  async provideCodeLenses(document: vscode.TextDocument): Promise<vscode.CodeLens[]> {
    const list = await vscode.commands.executeCommand<readonly Sym[] | undefined>(
      "vscode.executeDocumentSymbolProvider",
      document.uri,
    )
    if (!list?.length) return []
    return walk(document, list)
  }
}

function walk(document: vscode.TextDocument, list: readonly Sym[]): vscode.CodeLens[] {
  return list.flatMap((item) => lens(document, item))
}

function lens(document: vscode.TextDocument, item: Sym): vscode.CodeLens[] {
  const kids = "children" in item ? walk(document, item.children) : []
  if (!keep(item.kind)) return kids

  const body = "range" in item ? item.range : item.location.range
  const head = "selectionRange" in item ? item.selectionRange : item.location.range

  return [
    new vscode.CodeLens(head, {
      command: "opencode-web.sendCode",
      title: "$(comment-discussion) Ask OpenCode",
      arguments: [document.uri, body],
    }),
    ...kids,
  ]
}

function keep(kind: vscode.SymbolKind): boolean {
  return kind === vscode.SymbolKind.Function || kind === vscode.SymbolKind.Class || kind === vscode.SymbolKind.Method
}
