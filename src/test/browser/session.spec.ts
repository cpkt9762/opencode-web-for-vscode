import { test, expect } from "@playwright/test"

const PORT = 57777
const BASE = `http://127.0.0.1:${PORT}`
const DIR = process.env.TEST_DIR || process.cwd()

test.beforeAll(async ({ request }) => {
  const res = await request.get(`${BASE}/global/health`)
  expect(res.ok() || res.status() === 401).toBeTruthy()
})

test.describe("session list", () => {
  test("GET /session returns array", async ({ request }) => {
    const res = await request.get(`${BASE}/session`, {
      headers: { "x-opencode-directory": DIR },
    })
    expect(res.ok()).toBeTruthy()

    const body = await res.json()
    expect(Array.isArray(body)).toBeTruthy()
  })

  test("sessions have required fields", async ({ request }) => {
    const res = await request.get(`${BASE}/session`, {
      headers: { "x-opencode-directory": DIR },
    })
    const list = await res.json()

    for (const s of list.slice(0, 5)) {
      expect(s).toHaveProperty("id")
      expect(s).toHaveProperty("directory")
      expect(s).toHaveProperty("time")
      expect(s.id).toMatch(/^ses_/)
    }
  })

  test("session list respects limit param", async ({ request }) => {
    const res = await request.get(`${BASE}/session`, {
      params: { limit: "2" },
      headers: { "x-opencode-directory": DIR },
    })
    expect(res.ok()).toBeTruthy()

    const list = await res.json()
    expect(list.length).toBeLessThanOrEqual(2)
  })

  test("session list respects roots param", async ({ request }) => {
    const res = await request.get(`${BASE}/session`, {
      params: { roots: "true" },
      headers: { "x-opencode-directory": DIR },
    })
    expect(res.ok()).toBeTruthy()

    const list = await res.json()
    for (const s of list) {
      expect(s.parentID).toBeFalsy()
    }
  })
})

test.describe("session CRUD", () => {
  let sid: string

  test("POST /session creates a session", async ({ request }) => {
    const res = await request.post(`${BASE}/session`, {
      headers: {
        "content-type": "application/json",
        "x-opencode-directory": DIR,
      },
      data: {},
    })
    expect(res.ok()).toBeTruthy()

    const body = await res.json()
    expect(body.id).toMatch(/^ses_/)
    expect(body.directory).toBeTruthy()
    sid = body.id
  })

  test("GET /session/:id retrieves created session", async ({ request }) => {
    expect(sid).toBeTruthy()

    const res = await request.get(`${BASE}/session/${sid}`, {
      headers: { "x-opencode-directory": DIR },
    })
    expect(res.ok()).toBeTruthy()

    const body = await res.json()
    expect(body.id).toBe(sid)
  })

  test("created session appears in list", async ({ request }) => {
    expect(sid).toBeTruthy()

    const res = await request.get(`${BASE}/session`, {
      headers: { "x-opencode-directory": DIR },
    })
    const list = await res.json()
    const match = list.find((s: { id: string }) => s.id === sid)
    expect(match).toBeTruthy()
  })
})

test.describe("session status", () => {
  test("GET /session/status returns object", async ({ request }) => {
    const res = await request.get(`${BASE}/session/status`, {
      headers: { "x-opencode-directory": DIR },
    })
    expect(res.ok()).toBeTruthy()

    const body = await res.json()
    expect(typeof body).toBe("object")
  })
})

test.describe("session navigation", () => {
  let sid: string

  test.beforeAll(async ({ request }) => {
    const res = await request.post(`${BASE}/session`, {
      headers: { "content-type": "application/json", "x-opencode-directory": DIR },
      data: {},
    })
    sid = (await res.json()).id
  })

  test("SPA loads session route", async ({ page }) => {
    const slug = Buffer.from(DIR).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "")
    const url = `${BASE}/${slug}/session/${sid}`

    const res = await page.goto(url, { waitUntil: "domcontentloaded" })
    expect(res?.ok()).toBeTruthy()

    const root = page.locator("#root")
    await expect(root).toBeAttached({ timeout: 10000 })
  })

  test("SPA navigates to session via URL and makes API call", async ({ page }) => {
    const slug = Buffer.from(DIR).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "")

    const calls: string[] = []
    page.on("request", (req) => {
      if (req.url().includes(`/session/${sid}`) || req.url().includes(`/session?`)) {
        calls.push(req.url())
      }
    })

    await page.goto(`${BASE}/${slug}/session/${sid}`, { waitUntil: "domcontentloaded" })
    await page.waitForTimeout(5000)

    expect(calls.length, "SPA should fetch session data").toBeGreaterThan(0)
  })
})

test.describe("related APIs", () => {
  test("GET /path returns directory", async ({ request }) => {
    const res = await request.get(`${BASE}/path`, {
      headers: { "x-opencode-directory": DIR },
    })
    expect(res.ok()).toBeTruthy()

    const body = await res.json()
    expect(body).toHaveProperty("directory")
    expect(body).toHaveProperty("home")
    expect(body.directory).toBeTruthy()
  })

  test("GET /permission/list returns array-like", async ({ request }) => {
    const res = await request.get(`${BASE}/permission`, {
      headers: { "x-opencode-directory": DIR },
    })
    expect(res.ok()).toBeTruthy()

    const body = await res.json()
    expect(Array.isArray(body)).toBeTruthy()
  })

  test("GET /question/list returns array-like", async ({ request }) => {
    const res = await request.get(`${BASE}/question`, {
      headers: { "x-opencode-directory": DIR },
    })
    expect(res.ok()).toBeTruthy()

    const body = await res.json()
    expect(Array.isArray(body)).toBeTruthy()
  })
})
