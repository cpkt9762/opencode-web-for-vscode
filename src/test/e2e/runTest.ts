import { execSync } from "node:child_process"
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs"
import { createServer } from "node:net"
import { tmpdir } from "node:os"
import { resolve } from "node:path"
import { runTests } from "@vscode/test-electron"
import { bin } from "./env.js"

async function free() {
  const raw = process.env.E2E_PORT?.trim()
  const num = raw ? Number(raw) : NaN
  if (Number.isInteger(num) && num > 0) return num

  return new Promise<number>((done, fail) => {
    const srv = createServer()
    srv.unref()
    srv.once("error", fail)
    srv.listen(0, "127.0.0.1", () => {
      const addr = srv.address()
      if (!addr || typeof addr === "string") {
        srv.close(() => fail(new Error("Failed to allocate E2E port")))
        return
      }

      srv.close((err) => {
        if (err) {
          fail(err)
          return
        }

        done(addr.port)
      })
    })
  })
}

async function main() {
  const dev = resolve(__dirname, "../../..")
  const tests = resolve(__dirname, "./suite/index.js")
  const root = mkdtempSync(resolve(tmpdir(), "oc-vscode-e2e-"))
  const user = resolve(root, "user")
  const ext = resolve(root, "ext")
  const ws = resolve(root, "ws")
  const dir = resolve(user, "User")
  const file = bin()
  const num = await free()

  mkdirSync(user)
  mkdirSync(ext)
  mkdirSync(ws)
  mkdirSync(dir)
  execSync("git init", { cwd: ws, stdio: "ignore" })
  writeFileSync(
    resolve(dir, "settings.json"),
    JSON.stringify(
      {
        "opencode.autoStart": Boolean(file),
        ...(file ? { "opencode.binaryPath": file } : {}),
        "opencode.port": num,
      },
      null,
      2,
    ),
  )

  await runTests({
    extensionDevelopmentPath: dev,
    extensionTestsPath: tests,
    extensionTestsEnv: {
      E2E_BIN: file ?? "",
      E2E_LOG_DIR: resolve(user, "logs"),
      E2E_PORT: String(num),
    },
    launchArgs: [ws, "--disable-extensions", `--extensions-dir=${ext}`, `--user-data-dir=${user}`],
  })
}

main().catch((err) => {
  console.error("Failed to run tests:", err)
  process.exit(1)
})
