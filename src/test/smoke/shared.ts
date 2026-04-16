import { execFileSync } from "node:child_process"
import { mkdtempSync } from "node:fs"
import { join } from "node:path"
import { setTimeout as wait } from "node:timers/promises"
import { type ElectronApplication, _electron as electron, type Frame, type Page } from "@playwright/test"

export type Cfg = {
  code: string
  ext: string
  fresh: string
  password: string
  pid: number
  port: number
  ready: string
  root: string
}

export type Win = {
  app: ElectronApplication
  page: Page
  user: string
}

export function slug(input: string) {
  return Buffer.from(input).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "")
}

export function auth(pwd: string) {
  return `Basic ${Buffer.from(`opencode:${pwd}`).toString("base64")}`
}

async function pick(page: Page, list: string[], ms = 60000) {
  const stop = Date.now() + ms

  while (Date.now() < stop) {
    for (const item of list) {
      const loc = page.locator(item).first()
      const ok = await loc.isVisible().catch(() => false)
      if (ok) return loc
    }

    await wait(250)
  }

  throw new Error(`Timed out waiting for selector: ${list.join(" | ")}`)
}

export async function open(cfg: Cfg, dir?: string): Promise<Win> {
  const user = mkdtempSync(join(cfg.root, "user-"))
  const args = [
    ...(dir ? [dir] : []),
    `--extensions-dir=${cfg.ext}`,
    `--user-data-dir=${user}`,
    "--disable-gpu",
    "--disable-dev-shm-usage",
    "--locale=en-US",
    "--disable-workspace-trust",
    "--new-window",
    "--skip-release-notes",
    "--skip-welcome",
  ]

  if (process.platform === "linux") args.push("--no-sandbox")

  const app = await electron.launch({
    args,
    cwd: cfg.root,
    env: {
      ...process.env,
      ...(process.platform === "linux" ? { DISPLAY: process.env.DISPLAY || ":99" } : {}),
      LANG: "en_US.UTF-8",
      LC_ALL: "en_US.UTF-8",
    },
    executablePath: cfg.code,
    timeout: 60000,
  })
  const page = await app.firstWindow()
  await page.waitForSelector(".monaco-workbench", { timeout: 60000 })
  return { app, page, user }
}

export function swap(cfg: Cfg, win: Win, dir: string) {
  const args = [
    dir,
    `--extensions-dir=${cfg.ext}`,
    `--user-data-dir=${win.user}`,
    "--disable-gpu",
    "--disable-dev-shm-usage",
    "--locale=en-US",
    "--disable-workspace-trust",
    "--reuse-window",
    "--skip-release-notes",
    "--skip-welcome",
  ]

  if (process.platform === "linux") args.push("--no-sandbox")

  execFileSync(cfg.code, args, {
    cwd: cfg.root,
    env: {
      ...process.env,
      ...(process.platform === "linux" ? { DISPLAY: process.env.DISPLAY || ":99" } : {}),
      LANG: "en_US.UTF-8",
      LC_ALL: "en_US.UTF-8",
    },
    stdio: "ignore",
  })
}

export async function icon(page: Page) {
  return pick(page, [
    '[role="tab"][aria-label="OpenCode"]',
    '[role="tab"][aria-label^="OpenCode"]',
    '[id="workbench.view.extension.opencode-web"] .action-label',
    '[id="workbench.view.extension.opencode-web"]',
    '.composite-bar [aria-label="OpenCode"]',
    '.activitybar [aria-label="OpenCode"]',
    '.composite-bar [aria-label^="OpenCode"]',
    '.activitybar [aria-label^="OpenCode"]',
  ])
}

export function spa(frame: Frame) {
  return frame.frameLocator("#opencode-frame")
}

export async function url(frame: Frame, test?: (item: URL) => boolean, ms = 60000) {
  const stop = Date.now() + ms

  while (Date.now() < stop) {
    const raw = await frame
      .locator("#opencode-frame")
      .getAttribute("src")
      .catch(() => null)
    if (raw) {
      const item = new URL(raw)
      if (!test || test(item)) return item
    }

    await wait(250)
  }

  throw new Error("Timed out waiting for OpenCode iframe URL")
}

export async function home(frame: Frame) {
  const app = spa(frame)
  const stop = Date.now() + 30000

  while (Date.now() < stop) {
    const btn = await app
      .getByRole("button")
      .count()
      .catch(() => 0)
    const list = await app
      .locator("ul button")
      .count()
      .catch(() => 0)
    const icon = await app
      .locator("svg")
      .count()
      .catch(() => 0)
    if (btn >= 2 && (list > 0 || icon > 0)) return app

    await wait(250)
  }

  throw new Error("Timed out waiting for welcome page content")
}

export async function web(page: Page, ms = 60000): Promise<Frame> {
  const stop = Date.now() + ms

  while (Date.now() < stop) {
    for (const item of page.frames()) {
      if (item === page.mainFrame()) continue
      const ok = await item
        .locator("#opencode-frame")
        .count()
        .then((n) => n > 0)
        .catch(() => false)
      if (ok) return item
    }

    await wait(250)
  }

  throw new Error("Timed out waiting for OpenCode webview frame")
}

export async function show(page: Page, ms = 60000) {
  const item = await icon(page)
  await item.click({ force: true })
  return web(page, ms)
}

export async function reveal(page: Page, ms = 60000) {
  const stop = Date.now() + ms

  while (Date.now() < stop) {
    const item = await icon(page)
    await item.click({ force: true }).catch(() => null)
    await page
      .locator("iframe.webview")
      .first()
      .waitFor({ state: "visible", timeout: 5000 })
      .catch(() => null)

    const frame = await web(page, 5000).catch(() => null)
    if (frame) return frame

    await wait(500)
  }

  throw new Error("Timed out opening OpenCode sidebar")
}

export async function shut(win: Win) {
  await Promise.race([win.app.close().catch(() => null), wait(5000)])
}
