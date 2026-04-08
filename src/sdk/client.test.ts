import { describe, it, expect, vi } from "vitest"
import { createClient, updateDirectory } from "./client.js"

vi.mock("@opencode-ai/sdk/v2", async () => {
  const actual = await vi.importActual("@opencode-ai/sdk/v2")
  return {
    ...actual,
    createOpencodeClient: vi.fn((cfg: any) => {
      const config = { ...cfg }
      if (cfg?.directory) {
        const isNonASCII = Array.from(cfg.directory).some((c: any) => c.charCodeAt(0) > 127)
        const encodedDirectory = isNonASCII ? encodeURIComponent(cfg.directory) : cfg.directory
        config.headers = {
          ...config.headers,
          "x-opencode-directory": encodedDirectory,
        }
      }
      return {
        config,
        session: { list: vi.fn() },
        file: { read: vi.fn() },
        find: { files: vi.fn() },
        provider: { list: vi.fn() },
        event: { subscribe: vi.fn() },
        pty: { create: vi.fn() },
        permission: { check: vi.fn() },
        question: { ask: vi.fn() },
      }
    }),
  }
})

describe("SDK Client", () => {
  it("stores auth header", async () => {
    const cfg = await createClient({
      url: "http://localhost:4096",
      password: "secret123",
      directory: "/home/user/project",
    })

    const expected = `Basic ${btoa("opencode:secret123")}`
    expect(cfg.auth).toBe(expected)
  })

  it("stores url", async () => {
    const cfg = await createClient({
      url: "http://localhost:4096",
      password: "secret",
      directory: "/home/user",
    })

    expect(cfg.url).toBe("http://localhost:4096")
  })

  it("passes directory unchanged for ASCII paths", async () => {
    const cfg = await createClient({
      url: "http://localhost:4096",
      password: "secret",
      directory: "/home/user/project",
    })

    const client = cfg.client as any
    expect(client.config.headers["x-opencode-directory"]).toBe(
      "/home/user/project"
    )
  })

  it("encodes non-ASCII directory paths", async () => {
    const cfg = await createClient({
      url: "http://localhost:4096",
      password: "secret",
      directory: "/home/user/项目",
    })

    const client = cfg.client as any
    expect(client.config.headers["x-opencode-directory"]).toBe(
      encodeURIComponent("/home/user/项目")
    )
  })

  it("passes baseUrl to SDK", async () => {
    const cfg = await createClient({
      url: "http://localhost:4096",
      password: "secret",
      directory: "/home/user",
    })

    const client = cfg.client as any
    expect(client.config.baseUrl).toBe("http://localhost:4096")
  })

  it("passes auth header to SDK", async () => {
    const cfg = await createClient({
      url: "http://localhost:4096",
      password: "secret123",
      directory: "/home/user",
    })

    const expected = `Basic ${btoa("opencode:secret123")}`
    const client = cfg.client as any
    expect(client.config.headers.Authorization).toBe(expected)
  })

  it("exposes SDK sub-clients", async () => {
    const cfg = await createClient({
      url: "http://localhost:4096",
      password: "secret",
      directory: "/home/user",
    })

    expect(cfg.client.session).toBeDefined()
    expect(cfg.client.file).toBeDefined()
    expect(cfg.client.find).toBeDefined()
    expect(cfg.client.provider).toBeDefined()
    expect(cfg.client.event).toBeDefined()
    expect(cfg.client.pty).toBeDefined()
    expect(cfg.client.permission).toBeDefined()
    expect(cfg.client.question).toBeDefined()
  })

  it("updateDirectory creates new client with updated directory", async () => {
    const cfg = await createClient({
      url: "http://localhost:4096",
      password: "secret",
      directory: "/home/user/old",
    })

    const updated = await updateDirectory(cfg, "/home/user/new")

    const client = updated.client as any
    expect(client.config.headers["x-opencode-directory"]).toBe(
      "/home/user/new"
    )
  })

  it("updateDirectory preserves auth", async () => {
    const cfg = await createClient({
      url: "http://localhost:4096",
      password: "secret",
      directory: "/home/user/old",
    })

    const updated = await updateDirectory(cfg, "/home/user/new")

    expect(updated.auth).toBe(cfg.auth)
  })

  it("updateDirectory preserves url", async () => {
    const cfg = await createClient({
      url: "http://localhost:4096",
      password: "secret",
      directory: "/home/user",
    })

    const updated = await updateDirectory(cfg, "/home/user/new")

    expect(updated.url).toBe("http://localhost:4096")
  })
})
