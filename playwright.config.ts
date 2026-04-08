import { defineConfig } from "@playwright/test"

export default defineConfig({
  testDir: "./src/test/browser",
  timeout: 30000,
  retries: 0,
  use: {
    baseURL: "http://127.0.0.1:57777",
    headless: true,
  },
  projects: [{ name: "chromium", use: { browserName: "chromium" } }],
})
