import { test, expect } from "@playwright/test"

const PORT = 57777
const BASE = `http://127.0.0.1:${PORT}`
const DIR = process.env.TEST_DIR || process.cwd()

function slug(dir: string) {
  return Buffer.from(dir).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "")
}

test.beforeAll(async ({ request }) => {
  const res = await request.get(`${BASE}/global/health`)
  expect(res.ok() || res.status() === 401, "Server not reachable — start opencode-cli serve first").toBeTruthy()
})

test.describe("project", () => {
  test("GET /project/current creates project for directory", async ({ request }) => {
    const res = await request.get(`${BASE}/project/current`, {
      params: { directory: DIR },
    })
    expect(res.ok()).toBeTruthy()

    const body = await res.json()
    expect(body.worktree).toBeTruthy()
    expect(body.id).toBeTruthy()
  })

  test("GET /project lists projects including current directory", async ({ request }) => {
    await request.get(`${BASE}/project/current`, { params: { directory: DIR } })

    const res = await request.get(`${BASE}/project`, {
      params: { directory: DIR },
    })
    expect(res.ok()).toBeTruthy()

    const list = await res.json()
    expect(Array.isArray(list)).toBeTruthy()
    expect(list.length).toBeGreaterThan(0)

    const match = list.find(
      (p: { worktree?: string }) => p.worktree === DIR || p.worktree?.endsWith(DIR.split("/").pop()!),
    )
    expect(match, `Directory ${DIR} not found in project list`).toBeTruthy()
  })

  test("project.current is idempotent", async ({ request }) => {
    const a = await request.get(`${BASE}/project/current`, { params: { directory: DIR } })
    const b = await request.get(`${BASE}/project/current`, { params: { directory: DIR } })

    const first = await a.json()
    const second = await b.json()

    expect(first.id).toBe(second.id)
    expect(first.worktree).toBe(second.worktree)
  })
})

test.describe("new project from fresh directory", () => {
  let tmp: string

  test.beforeAll(async () => {
    const { mkdtempSync } = await import("node:fs")
    const { execSync } = await import("node:child_process")
    const { join } = await import("node:path")
    const { tmpdir } = await import("node:os")
    tmp = mkdtempSync(join(tmpdir(), "oc-test-"))
    execSync("git init && git commit --allow-empty -m init", { cwd: tmp, stdio: "ignore" })
  })

  test("project.current creates project for new directory", async ({ request }) => {
    const res = await request.get(`${BASE}/project/current`, {
      params: { directory: tmp },
    })
    expect(res.ok()).toBeTruthy()

    const body = await res.json()
    expect(body.id).toBeTruthy()
    expect(body.worktree).toBeTruthy()
  })

  test("new project appears in project list", async ({ request }) => {
    await request.get(`${BASE}/project/current`, { params: { directory: tmp } })

    const res = await request.get(`${BASE}/project`, { params: { directory: tmp } })
    expect(res.ok()).toBeTruthy()

    const list = await res.json()
    const { realpathSync, existsSync } = await import("node:fs")
    const real = realpathSync(tmp)
    const match = list.find((p: { worktree?: string }) => {
      if (!p.worktree || !existsSync(p.worktree)) return false
      return realpathSync(p.worktree) === real || real.startsWith(realpathSync(p.worktree))
    })
    expect(match, `New dir ${tmp} (${real}) not in project list`).toBeTruthy()
  })

  test("SPA loads at /:dir for new project", async ({ page }) => {
    const res = await page.goto(`${BASE}/${slug(tmp)}`, { waitUntil: "domcontentloaded" })
    expect(res?.ok()).toBeTruthy()

    const root = page.locator("#root")
    await expect(root).toBeAttached({ timeout: 10000 })
    const children = await root.locator("> *").count()
    expect(children).toBeGreaterThan(0)
  })

  test("project.initGit upgrades global to unique project", async ({ request }) => {
    const { mkdtempSync, rmSync } = await import("node:fs")
    const { join } = await import("node:path")
    const { tmpdir } = await import("node:os")
    const bare = mkdtempSync(join(tmpdir(), "oc-nogit-"))

    try {
      const before = await (await request.get(`${BASE}/project/current`, { params: { directory: bare } })).json()
      expect(before.id).toBe("global")

      const init = await request.post(`${BASE}/project/git/init`, {
        headers: { "x-opencode-directory": bare },
      })
      expect(init.ok()).toBeTruthy()

      const after = await init.json()
      const { realpathSync } = await import("node:fs")
      expect(after.vcs).toBe("git")
      expect(realpathSync(after.worktree)).toBe(realpathSync(bare))
      expect(before.worktree).not.toBe(after.worktree)
    } finally {
      rmSync(bare, { recursive: true, force: true })
    }
  })

  test("new project has empty session list", async ({ request }) => {
    const res = await request.get(`${BASE}/session`, {
      headers: { "x-opencode-directory": tmp },
    })
    expect(res.ok()).toBeTruthy()

    const list = await res.json()
    expect(Array.isArray(list)).toBeTruthy()
    expect(list.length).toBe(0)
  })

  test.afterAll(async () => {
    const { rmSync } = await import("node:fs")
    rmSync(tmp, { recursive: true, force: true })
  })
})

test.describe("SPA routing", () => {
  test("/:dir serves SPA HTML", async ({ page }) => {
    const res = await page.goto(`${BASE}/${slug(DIR)}`)
    expect(res?.ok()).toBeTruthy()

    const html = await page.content()
    expect(html).toContain("<!DOCTYPE html>")
    expect(html.length).toBeGreaterThan(500)
  })

  test("/:dir loads SPA JavaScript and renders #root", async ({ page }) => {
    await page.goto(`${BASE}/${slug(DIR)}`, { waitUntil: "domcontentloaded" })

    const root = page.locator("#root")
    await expect(root).toBeAttached({ timeout: 10000 })
    const children = await root.locator("> *").count()
    expect(children, "SPA #root should have rendered children").toBeGreaterThan(0)
  })

  test("/ root loads SPA and renders #root", async ({ page }) => {
    await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded" })

    const root = page.locator("#root")
    await expect(root).toBeAttached({ timeout: 10000 })
    const children = await root.locator("> *").count()
    expect(children).toBeGreaterThan(0)
  })
})

test.describe("project open flow", () => {
  test("SPA at /:dir makes API calls to server", async ({ page, request }) => {
    await request.get(`${BASE}/project/current`, { params: { directory: DIR } })

    const calls: string[] = []
    page.on("request", (req) => {
      const url = req.url()
      if (url.includes("/project") || url.includes("/path") || url.includes("/session")) {
        calls.push(url)
      }
    })

    await page.goto(`${BASE}/${slug(DIR)}/session`, { waitUntil: "domcontentloaded" })
    await page.waitForTimeout(5000)

    expect(calls.length, "SPA should make API calls").toBeGreaterThan(0)
  })

  test("project exists after SPA visit", async ({ page, request }) => {
    await page.goto(`${BASE}/${slug(DIR)}/session`, { waitUntil: "domcontentloaded" })
    await page.waitForTimeout(3000)

    const res = await request.get(`${BASE}/project/current`, {
      params: { directory: DIR },
    })
    expect(res.ok()).toBeTruthy()

    const body = await res.json()
    expect(body.id).toBeTruthy()
    expect(body.worktree).toBeTruthy()
  })
})

test.describe("iframe load simulation", () => {
  test("iframe loads SPA at /:dir and fires load event", async ({ page }) => {
    const url = `${BASE}/${slug(DIR)}`

    const result = await page.evaluate(async (src) => {
      return new Promise<{ loaded: boolean; src: string; root: boolean; error?: string }>((resolve) => {
        const timeout = setTimeout(() => resolve({ loaded: false, src, root: false, error: "timeout" }), 15000)

        const frame = document.createElement("iframe")
        frame.style.width = "100%"
        frame.style.height = "600px"
        frame.src = src

        frame.addEventListener("load", () => {
          clearTimeout(timeout)
          try {
            const doc = frame.contentDocument
            const root = doc?.getElementById("root")
            resolve({
              loaded: true,
              src: frame.src,
              root: (root?.children.length ?? 0) > 0,
            })
          } catch {
            resolve({ loaded: true, src: frame.src, root: false, error: "cross-origin" })
          }
        })

        frame.addEventListener("error", () => {
          clearTimeout(timeout)
          resolve({ loaded: false, src: frame.src, root: false, error: "frame error" })
        })

        document.body.appendChild(frame)
      })
    }, url)

    expect(result.loaded, `iframe did not load: ${result.error}`).toBe(true)
    expect(result.src).toContain(slug(DIR))
  })

  test("iframe SPA makes API calls through proxy", async ({ page }) => {
    const url = `${BASE}/${slug(DIR)}`
    const calls: string[] = []

    page.on("request", (req) => {
      if (req.url().includes("/project") || req.url().includes("/path")) {
        calls.push(req.url())
      }
    })

    await page.goto(url, { waitUntil: "domcontentloaded" })
    await page.waitForTimeout(5000)

    expect(calls.length, "SPA should make API calls via same origin").toBeGreaterThan(0)
  })
})
