const esbuild = require("esbuild")

const entryPoints = ["src/test/smoke/run.ts", "src/test/smoke/suite.ts"]

esbuild
  .build({
    entryPoints,
    bundle: true,
    format: "cjs",
    outbase: "src/test/smoke",
    outdir: "out/test/smoke",
    platform: "node",
    external: ["@playwright/test", "@vscode/test-electron", "vscode"],
    sourcemap: true,
    logLevel: "silent",
  })
  .catch((err) => {
    console.error(err)
    process.exit(1)
  })
