import { spawnSync } from "node:child_process"
import { existsSync } from "node:fs"
import { homedir, platform } from "node:os"
import { join } from "node:path"

const DEF = 57777
const WIN = platform() === "win32"
const CMD = WIN ? "opencode-cli.cmd" : "opencode-cli"
const DIRS = [
  join(homedir(), ".opencode", "bin"),
  "/usr/local/bin",
  join(homedir(), "bin"),
  join(homedir(), ".local", "bin"),
  "/Applications/OpenCode.app/Contents/MacOS",
  "/Applications/OpenCode Beta.app/Contents/MacOS",
]

export function port() {
  const raw = process.env.E2E_PORT?.trim()
  const num = raw ? Number(raw) : NaN
  if (Number.isInteger(num) && num > 0) return num
  return DEF
}

export function bin() {
  if (Object.hasOwn(process.env, "E2E_BIN")) {
    const raw = process.env.E2E_BIN?.trim()
    return raw ? raw : null
  }

  const raw = process.env.OPENCODE_BIN?.trim()
  if (raw) {
    const file = existsSync(raw) ? raw : join(raw, CMD)
    if (existsSync(file)) return file
  }

  const hit = which()
  if (hit) return hit

  for (const dir of DIRS) {
    const file = join(dir, CMD)
    if (existsSync(file)) return file
  }

  return null
}

function which() {
  const out = spawnSync(WIN ? "where" : "which", [CMD], {
    encoding: "utf-8",
    stdio: ["ignore", "pipe", "ignore"],
  })
  if (out.status !== 0) return null
  return out.stdout
    .split(/\r?\n/)
    .map((item) => item.trim())
    .find(Boolean)
}
