async function main() {
  const url = "https://code.visualstudio.com/api/extension-guides/webview"
  const text = await fetch(url).then((res) => res.text())
  const body = text.toLowerCase()
  const checks = [
    {
      ok:
        body.includes("think of a webview as") &&
        body.includes("iframe") &&
        (body.includes("within vs code") ||
          body.includes("within visual studio code") ||
          body.includes("within vscode")),
      pass: "文档明确把 webview 描述为 VSCode 内的 iframe。",
      fail: "未找到 webview≈iframe 的直接表述。",
    },
    {
      ok: body.includes("content security policy"),
      pass: "文档包含 Content Security Policy 安全章节。",
      fail: "未找到 CSP 相关章节。",
    },
    {
      ok: body.includes("scripts can do just about anything that a script on a normal webpage can"),
      pass: "文档确认启用脚本后具备常规网页脚本能力。",
      fail: "未找到 webview 脚本能力说明。",
    },
    {
      ok: body.includes("localresourceroots"),
      pass: "文档区分了 localResourceRoots 与其他加载来源控制。",
      fail: "未找到 localResourceRoots 说明。",
    },
  ]
  const out = [
    "VSCode Webview 文档检查",
    "",
    `来源: ${url}`,
    "",
    "检查结果:",
    ...checks.map((x) => `- ${x.ok ? "PASS" : "FAIL"}: ${x.ok ? x.pass : x.fail}`),
    "",
    "已知限制:",
    "- 官方文档没有单独给出 frame-src http://localhost:* 示例，但 webview CSP 使用标准 meta CSP 机制。",
    "- localResourceRoots 仅约束本地文件，不覆盖 iframe 指向的 localhost HTTP 源。",
    "- 外层 webview CSP 只决定 iframe 是否可嵌入；iframe 内 SSE/WebSocket 由 localhost 页面自身与浏览器能力决定。",
    "- 若后续不走 iframe，本地静态资源回退方案应使用 asWebviewUri。",
  ].join("\n")

  if (checks.some((x) => !x.ok)) {
    throw new Error(out)
  }

  console.log(out)
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err))
  process.exitCode = 1
})
