import { execSync } from "node:child_process"
import { mkdirSync, mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { resolve } from "node:path"
import { runTests } from "@vscode/test-electron"

async function main() {
  const dev = resolve(__dirname, "../../..")
  const tests = resolve(__dirname, "./suite/index.js")
  const root = mkdtempSync(resolve(tmpdir(), "oc-vscode-e2e-"))
  const user = resolve(root, "user")
  const ext = resolve(root, "ext")
  const ws = resolve(root, "ws")

  mkdirSync(user)
  mkdirSync(ext)
  mkdirSync(ws)
  execSync("git init", { cwd: ws, stdio: "ignore" })

  await runTests({
    extensionDevelopmentPath: dev,
    extensionTestsPath: tests,
    extensionTestsEnv: {
      E2E_LOG_DIR: resolve(user, "logs"),
    },
    launchArgs: [ws, "--disable-extensions", `--extensions-dir=${ext}`, `--user-data-dir=${user}`],
  })
}

main().catch((err) => {
  console.error("Failed to run tests:", err)
  process.exit(1)
})
