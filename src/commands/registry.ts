import * as vscode from "vscode"
import type { ProcessManager } from "../process/manager.js"
import { createTerminal } from "../terminal/pty.js"
import { showDiff } from "../views/diff.js"
import { type MessageBridge, MSG } from "../webview/bridge.js"
import { searchFiles, searchSymbols, searchText } from "./search.js"
import { type GetClient, sendCode } from "./sendcode.js"
import { forkSession, revertSession, shareSession, summarizeSession } from "./session.js"

type Diff = {
  after?: string
  before?: string
  file?: string
  modified?: string
  original?: string
  path?: string
  session?: string
  sessionId?: string
}

type Drop = {
  delete?: (opts: { sessionID: string }) => Promise<unknown>
}

type Opts = {
  bridge?: () => MessageBridge | null
  sessions?: {
    refresh: () => void
  }
  manager?: ProcessManager
  output?: vscode.OutputChannel
  getSpaUrl?: () => string | undefined
}

function errMsg(err: unknown) {
  return err instanceof Error ? err.message : String(err)
}

async function ask(prompt: string, placeHolder?: string) {
  return vscode.window.showInputBox({
    placeHolder,
    prompt,
  })
}

async function focus() {
  await vscode.commands.executeCommand("workbench.view.extension.opencode-web")
  await vscode.commands.executeCommand("opencode-web.chatView.focus")
}

function sid(value: unknown) {
  if (typeof value === "string") return value
  if (!value || typeof value !== "object" || Array.isArray(value)) return
  if (typeof (value as { id?: unknown }).id !== "string") return
  return (value as { id: string }).id
}

function drop(getClient: GetClient) {
  return (getClient as unknown as () => { client?: { session?: Drop } } | null)()?.client?.session?.delete
}

function diff(args: unknown[]) {
  const [a, b, c, d] = args
  if (typeof a === "string" && typeof b === "string" && typeof c === "string" && typeof d === "string") {
    return [a, b, c, d] as const
  }

  const [value] = args
  if (!value || typeof value !== "object" || Array.isArray(value)) return

  const item = value as Diff
  const session = item.session ?? item.sessionId
  const file = item.file ?? item.path
  const original = item.original ?? item.before
  const modified = item.modified ?? item.after
  if (typeof session !== "string") return
  if (typeof file !== "string") return
  if (typeof original !== "string") return
  if (typeof modified !== "string") return
  return [session, file, original, modified] as const
}

export function registerCommands(
  context: vscode.ExtensionContext,
  getClient: GetClient = () => null,
  opts: Opts = {},
): void {
  const find = getClient as unknown as Parameters<typeof searchFiles>[0]
  const pty = getClient as unknown as Parameters<typeof createTerminal>[1]
  const code = sendCode(getClient)
  const session = getClient as unknown as Parameters<typeof forkSession>[0]
  const commands = [
    {
      id: "opencode-web.sendCode",
      handler: (uri?: vscode.Uri, range?: vscode.Range) => code(uri, range),
    },
    {
      id: "opencode-web.newSession",
      handler: async () => {
        await vscode.window.showInformationMessage("Not implemented yet")
      },
    },
    {
      id: "opencode-web.openChat",
      handler: focus,
    },
    {
      id: "opencode-web.openInBrowser",
      handler: async () => {
        const url = opts.getSpaUrl?.() ?? opts.manager?.getUrl() ?? undefined
        if (!url) {
          await vscode.window.showWarningMessage("OpenCode: Server is not running")
          return
        }
        await vscode.env.openExternal(vscode.Uri.parse(url))
      },
    },
    {
      id: "opencode-web.restart",
      handler: async () => {
        const manager = opts.manager
        if (!manager) {
          await vscode.window.showWarningMessage("OpenCode: Manager unavailable")
          return
        }
        await vscode.window
          .withProgress(
            {
              location: vscode.ProgressLocation.Notification,
              title: "OpenCode: Restarting server...",
              cancellable: false,
            },
            async () => {
              await manager.stop()
              await manager.start()
            },
          )
          .then(
            () => vscode.window.showInformationMessage("OpenCode: Server restarted"),
            (err) => vscode.window.showErrorMessage(`OpenCode: Restart failed - ${errMsg(err)}`),
          )
      },
    },
    {
      id: "opencode-web.stop",
      handler: async () => {
        const manager = opts.manager
        if (!manager) {
          await vscode.window.showWarningMessage("OpenCode: Manager unavailable")
          return
        }
        await manager.stop().then(
          () => vscode.window.showInformationMessage("OpenCode: Server stopped"),
          (err) => vscode.window.showErrorMessage(`OpenCode: Stop failed - ${errMsg(err)}`),
        )
      },
    },
    {
      id: "opencode-web.showOutput",
      handler: () => {
        opts.output?.show()
      },
    },
    {
      id: "opencode-web.searchFiles",
      handler: searchFiles(find),
    },
    {
      id: "opencode-web.searchText",
      handler: searchText(find),
    },
    {
      id: "opencode-web.searchSymbols",
      handler: searchSymbols(find),
    },
    {
      id: "opencode-web.openTerminal",
      handler: () => {
        createTerminal("OpenCode", pty).show()
      },
    },
    {
      id: "opencode-web.forkSession",
      handler: async (input?: unknown) => {
        const sessionId = sid(input) ?? (await ask("Session ID", "ses_..."))
        if (!sessionId) return
        await forkSession(session, sessionId)
      },
    },
    {
      id: "opencode-web.revertSession",
      handler: async (input?: unknown) => {
        const sessionId = sid(input) ?? (await ask("Session ID", "ses_..."))
        if (!sessionId) return
        const messageId = await ask("Message ID", "msg_...")
        if (!messageId) return
        await revertSession(session, sessionId, messageId)
      },
    },
    {
      id: "opencode-web.shareSession",
      handler: async (input?: unknown) => {
        const sessionId = sid(input) ?? (await ask("Session ID", "ses_..."))
        if (!sessionId) return
        await shareSession(session, sessionId)
      },
    },
    {
      id: "opencode-web.summarizeSession",
      handler: async (input?: unknown) => {
        const sessionId = sid(input) ?? (await ask("Session ID", "ses_..."))
        if (!sessionId) return
        await summarizeSession(session, sessionId)
      },
    },
    {
      id: "opencode-web.deleteSession",
      handler: async (input?: unknown) => {
        const sessionId = sid(input) ?? (await ask("Session ID", "ses_..."))
        if (!sessionId) return

        const fn = drop(getClient)
        if (!fn) {
          await vscode.window.showWarningMessage("OpenCode: Client not available")
          return
        }

        await fn({ sessionID: sessionId })
          .then(async () => {
            opts.sessions?.refresh()
            await vscode.window.showInformationMessage("OpenCode: Session deleted")
          })
          .catch(() => vscode.window.showWarningMessage("OpenCode: Failed to delete session"))
      },
    },
    {
      id: "opencode-web.showDiff",
      handler: async (...args: unknown[]) => {
        const input = diff(args)
        if (!input) return
        await showDiff(...input)
      },
    },
    {
      id: "opencode-web.selectSession",
      handler: async (input?: unknown) => {
        const sessionId = sid(input)
        await focus()
        if (!sessionId) return
        await opts.bridge?.()?.post(MSG.navigate, { sessionId })
      },
    },
  ]

  for (const cmd of commands) {
    const disposable = vscode.commands.registerCommand(cmd.id, cmd.handler)
    context.subscriptions.push(disposable)
  }
}
