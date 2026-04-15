import { execSync } from "node:child_process"
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { createServer } from "node:net"
import { tmpdir } from "node:os"
import { resolve } from "node:path"
import { downloadAndUnzipVSCode } from "@vscode/test-electron"
import { ProcessManager } from "../../process/manager.js"
import { bin, port } from "../e2e/env.js"
import { run } from "./suite.js"

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
        srv.close(() => fail(new Error("Failed to allocate smoke port")))
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

function auth(pwd: string) {
  return `Basic ${Buffer.from(`opencode:${pwd}`).toString("base64")}`
}

function init(dir: string) {
  execSync("git init", { cwd: dir, stdio: "ignore" })
}

function seed(dir: string) {
  execSync('git -c user.name="Smoke" -c user.email="smoke@example.com" commit --allow-empty -m "smoke"', {
    cwd: dir,
    stdio: "ignore",
  })
}

async function register(url: string, pwd: string, dir: string) {
  const target = new URL(`/project/current?directory=${encodeURIComponent(dir)}`, url)
  const res = await fetch(target, {
    headers: {
      Authorization: auth(pwd),
    },
  })
  if (res.ok) return
  throw new Error(`Failed to register project ${dir}: ${res.status} ${await res.text()}`)
}

async function main() {
  const dev = resolve(__dirname, "../../..")
  execSync("node esbuild.config.js --production", { cwd: dev, stdio: "inherit" })

  process.env.E2E_PORT ??= String(await free())
  const num = port()
  const file = bin()
  if (!file) throw new Error("Failed to find opencode-cli for smoke tests")

  const root = mkdtempSync(resolve(tmpdir(), "oc-vscode-smoke-"))
  const ext = resolve(root, "ext")
  const home = resolve(root, "home")
  const data = resolve(root, "data")
  const rawFresh = resolve(root, "fresh")
  const rawReady = resolve(root, "ready")
  const user = resolve(home, "User")

  mkdirSync(ext)
  mkdirSync(user, { recursive: true })
  mkdirSync(data)
  mkdirSync(rawFresh)
  mkdirSync(rawReady)
  const fresh = realpathSync(rawFresh)
  const ready = realpathSync(rawReady)
  init(ready)
  seed(ready)

  symlinkSync(dev, resolve(ext, "opencode.opencode-web-for-vscode"), "dir")

  const mgr = new ProcessManager({
    port: num,
    password: "smoke-secret",
    find: () => ({
      compatible: true,
      path: file,
      version: "1.3.0",
    }),
  })

  let keep = false

  try {
    const srv = await mgr.start()
    const pid = (Reflect.get(mgr, "proc") as { pid?: number } | null)?.pid
    if (!pid) throw new Error("Failed to capture smoke server pid")
    await register(srv.url, srv.password, ready)

    writeFileSync(
      resolve(user, "settings.json"),
      JSON.stringify(
        {
          "extensions.autoCheckUpdates": false,
          "extensions.autoUpdate": false,
          "opencode.autoStart": true,
          "opencode.port": num,
          "opencode.serverPassword": srv.password,
          "security.workspace.trust.enabled": false,
          "telemetry.telemetryLevel": "off",
          "window.restoreWindows": "none",
          "workbench.startupEditor": "none",
        },
        null,
        2,
      ),
    )

    const code = await downloadAndUnzipVSCode({
      cachePath: resolve(dev, ".vscode-test"),
      extensionDevelopmentPath: dev,
    })

    await run({
      code,
      ext,
      fresh,
      password: srv.password,
      pid,
      port: num,
      ready,
      root: data,
    })
  } catch (err) {
    keep = true
    console.error(`Smoke temp root kept at ${root}`)
    throw err
  } finally {
    await mgr.stop().catch(() => null)
    if (!keep) rmSync(root, { force: true, recursive: true })
  }
}

main().catch((err) => {
  console.error("Failed to run smoke tests:", err)
  process.exit(1)
})
