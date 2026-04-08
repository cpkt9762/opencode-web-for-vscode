import { resolve } from "node:path"
import { glob } from "glob"
import Mocha from "mocha"

export async function run(): Promise<void> {
  const mocha = new Mocha({
    color: true,
    timeout: 30000,
    ui: "bdd",
  })
  const root = resolve(__dirname)
  const list = await glob("**/*.test.js", { cwd: root })

  list.forEach((file) => {
    mocha.addFile(resolve(root, file))
  })

  await new Promise<void>((done, fail) => {
    mocha.run((count) => {
      if (count > 0) {
        fail(new Error(`${count} tests failed`))
        return
      }

      done()
    })
  })
}
