import { defineConfig } from "vitest/config"

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    exclude: ["prototype/**", "dist/**", "out/**", "src/test/e2e/**", "node_modules/**"],
  },
})
