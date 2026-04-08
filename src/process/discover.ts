import { execSync } from "node:child_process"
import { existsSync } from "node:fs"
import { homedir, platform } from "node:os"
import { join } from "node:path"
import * as vscode from "vscode"

export type BinaryInfo = {
  path: string
  version: string
  compatible: boolean
}

const SDK_VERSION = "1.3.0"
const SEARCH_PATHS = [
  join(homedir(), ".opencode", "bin"),
  "/usr/local/bin",
  join(homedir(), "bin"),
  join(homedir(), ".local", "bin"),
  "/Applications/OpenCode.app/Contents/MacOS",
  "/Applications/OpenCode Beta.app/Contents/MacOS",
]

export function findBinary(): BinaryInfo | null {
  const isWin = platform() === "win32"
  const cmd = isWin ? "opencode-cli.cmd" : "opencode-cli"
  const custom = vscode.workspace.getConfiguration("opencode").get<string>("binaryPath")?.trim()

  if (custom) {
    const path = existsSync(custom) ? custom : join(custom, cmd)
    if (existsSync(path)) {
      const version = checkVersion(path)
      return {
        path,
        version,
        compatible: isCompatible(version),
      }
    }
  }

  try {
    const path = execSync(`which ${cmd}`, { encoding: "utf-8", stdio: ["pipe", "pipe", "ignore"] as const }).trim()
    if (path) {
      const version = checkVersion(path)
      return {
        path,
        version,
        compatible: isCompatible(version),
      }
    }
  } catch {
    // fallback to common paths
  }

  for (const dir of SEARCH_PATHS) {
    const path = join(dir, cmd)
    if (existsSync(path)) {
      const version = checkVersion(path)
      return {
        path,
        version,
        compatible: isCompatible(version),
      }
    }
  }

  return null
}

export function checkVersion(binary: string): string {
  try {
    const isWin = platform() === "win32"
    const output = isWin
      ? execSync(`"${binary}" --version`, {
          encoding: "utf-8",
          stdio: ["pipe", "pipe", "ignore"] as const,
        }).trim()
      : execSync(`"${binary}" --version`, { encoding: "utf-8", stdio: ["pipe", "pipe", "ignore"] as const }).trim()

    const match = output.match(/(\d+\.\d+\.\d+)/)
    return match ? match[1] : "unknown"
  } catch {
    return "unknown"
  }
}

function isCompatible(version: string): boolean {
  if (version === "unknown") return false

  const [major, minor] = version.split(".").map(Number)
  const [sdkMajor, sdkMinor] = SDK_VERSION.split(".").map(Number)

  return major === sdkMajor && minor >= sdkMinor
}
