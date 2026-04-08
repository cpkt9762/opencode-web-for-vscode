import * as vscode from "vscode"

export type PermissionReply = "once" | "always" | "reject"

export interface PermissionRequest {
  requestID: string
  description: string
  type: string
}

export interface QuestionRequest {
  requestID: string
  question: string
  options?: string[]
}

export async function showPermission(req: PermissionRequest): Promise<PermissionReply> {
  const choice = await vscode.window.showWarningMessage(req.description, "Allow Once", "Always Allow", "Deny")

  if (choice === "Allow Once") return "once"
  if (choice === "Always Allow") return "always"
  return "reject"
}

export async function showQuestion(req: QuestionRequest): Promise<string | null> {
  if (req.options && req.options.length > 0) {
    const choice = await vscode.window.showQuickPick(req.options, {
      placeHolder: req.question,
    })
    return choice ?? null
  }

  const answer = await vscode.window.showInputBox({
    prompt: req.question,
  })
  return answer ?? null
}
