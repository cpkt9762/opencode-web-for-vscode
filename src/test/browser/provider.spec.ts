import { test, expect } from "@playwright/test"

const PORT = 57777
const BASE = `http://127.0.0.1:${PORT}`
const DIR = process.env.TEST_DIR || process.cwd()

test.beforeAll(async ({ request }) => {
  const res = await request.get(`${BASE}/global/health`)
  expect(res.ok() || res.status() === 401).toBeTruthy()
})

test.describe("provider API", () => {
  test("GET /provider/list returns valid structure", async ({ request }) => {
    const res = await request.get(`${BASE}/provider`, {
      headers: { "x-opencode-directory": DIR },
    })
    expect(res.ok()).toBeTruthy()

    const body = await res.json()
    expect(body).toHaveProperty("all")
    expect(body).toHaveProperty("connected")
    expect(Array.isArray(body.all)).toBeTruthy()
    expect(Array.isArray(body.connected)).toBeTruthy()
  })

  test("provider list contains provider objects with id and name", async ({ request }) => {
    const res = await request.get(`${BASE}/provider`, {
      headers: { "x-opencode-directory": DIR },
    })
    const body = await res.json()

    if (body.all.length > 0) {
      const first = body.all[0]
      expect(first).toHaveProperty("id")
      expect(first).toHaveProperty("name")
    }
  })

  test("connected providers are subset of all providers", async ({ request }) => {
    const res = await request.get(`${BASE}/provider`, {
      headers: { "x-opencode-directory": DIR },
    })
    const body = await res.json()
    const ids = new Set(body.all.map((p: { id: string }) => p.id))

    for (const id of body.connected) {
      expect(ids.has(id), `connected provider "${id}" not in all`).toBeTruthy()
    }
  })
})

test.describe("config providers", () => {
  test("GET /config returns provider config", async ({ request }) => {
    const res = await request.get(`${BASE}/config`, {
      headers: { "x-opencode-directory": DIR },
    })
    expect(res.ok()).toBeTruthy()

    const body = await res.json()
    expect(body).toBeTruthy()
    expect(typeof body).toBe("object")
  })
})
