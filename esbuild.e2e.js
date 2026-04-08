const esbuild = require("esbuild")

const entryPoints = ["src/test/e2e/runTest.ts", "src/test/e2e/suite/index.ts", "src/test/e2e/suite/extension.test.ts"]

esbuild
  .build({
    entryPoints,
    bundle: true,
    format: "cjs",
    outbase: "src/test/e2e",
    outdir: "out/test/e2e",
    platform: "node",
    external: ["@vscode/test-electron", "mocha", "vscode"],
    sourcemap: true,
    logLevel: "silent",
  })
  .catch((err) => {
    console.error(err)
    process.exit(1)
  })
