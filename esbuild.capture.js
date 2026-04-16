const esbuild = require("esbuild")

esbuild
  .build({
    entryPoints: ["src/test/smoke/capture.ts"],
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
