import * as vscode from "vscode"

type Res<T> = {
  data?: T
}

type Share = {
  share?: {
    url?: string
  }
}

type Summary = {
  summary?: string
}

type SDK = {
  fork?: (opts: { sessionID: string }) => Promise<Res<unknown>>
  revert?: (opts: { sessionID: string; messageID: string }) => Promise<Res<unknown>>
  share?: (opts: { sessionID: string }) => Promise<Res<Share>>
  summarize?: (opts: { sessionID: string }) => Promise<Res<boolean | string | Summary>>
}

type Client = {
  client?: {
    session?: SDK
  }
}

export type GetClient = () => Client | null

function ok(msg: string) {
  return vscode.window.showInformationMessage(msg)
}

function err(msg: string) {
  return vscode.window.showWarningMessage(msg)
}

function get(getClient: GetClient) {
  return getClient()?.client?.session
}

function text(data: boolean | string | Summary | undefined, fallback: string) {
  if (typeof data === "string" && data) return data
  if (typeof data === "object" && data && typeof data.summary === "string" && data.summary) return data.summary
  return fallback
}

export async function forkSession(getClient: GetClient, sessionId: string) {
  const sdk = get(getClient)
  if (!sdk?.fork) {
    await err("OpenCode: Client not available")
    return
  }

  await sdk
    .fork({ sessionID: sessionId })
    .then(() => ok("OpenCode: Session forked"))
    .catch(() => err("OpenCode: Failed to fork session"))
}

export async function revertSession(getClient: GetClient, sessionId: string, messageId: string) {
  const sdk = get(getClient)
  if (!sdk?.revert) {
    await err("OpenCode: Client not available")
    return
  }

  await sdk
    .revert({ sessionID: sessionId, messageID: messageId })
    .then(() => ok("OpenCode: Session reverted"))
    .catch(() => err("OpenCode: Failed to revert session"))
}

export async function shareSession(getClient: GetClient, sessionId: string) {
  const sdk = get(getClient)
  if (!sdk?.share) {
    await err("OpenCode: Client not available")
    return
  }

  await sdk
    .share({ sessionID: sessionId })
    .then(async (res) => {
      const url = res.data?.share?.url
      if (!url) {
        await err("OpenCode: Share URL unavailable")
        return
      }

      await vscode.env.clipboard.writeText(url)
      await ok("OpenCode: Share URL copied")
    })
    .catch(() => err("OpenCode: Failed to share session"))
}

export async function summarizeSession(getClient: GetClient, sessionId: string) {
  const sdk = get(getClient)
  if (!sdk?.summarize) {
    await err("OpenCode: Client not available")
    return
  }

  await sdk
    .summarize({ sessionID: sessionId })
    .then((res) => ok(text(res.data, "OpenCode: Session summarized")))
    .catch(() => err("OpenCode: Failed to summarize session"))
}
