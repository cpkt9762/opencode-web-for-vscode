type Opts = {
  max?: number
  delay?: number
  backoff?: number
}

type Cfg = {
  max: number
  delay: number
  backoff: number
}

export class TimeoutError extends Error {
  constructor(ms: number) {
    super(`Timed out after ${ms}ms`)
    this.name = "TimeoutError"
  }
}

export function retry<T>(fn: () => Promise<T>, opts: Opts = {}) {
  return run(fn, {
    max: opts.max ?? 3,
    delay: opts.delay ?? 1000,
    backoff: opts.backoff ?? 2,
  })
}

export function withTimeout<T>(fn: () => Promise<T>, ms: number) {
  return new Promise<T>((resolve, reject) => {
    const id = setTimeout(() => reject(new TimeoutError(ms)), ms)

    call(fn).then(
      (data) => done(id, () => resolve(data)),
      (err) => done(id, () => reject(cast(err))),
    )
  })
}

export function safe<T>(fn: () => Promise<T>) {
  return call(fn).then(
    (data) => ({ ok: true as const, data }),
    (err) => ({ ok: false as const, error: cast(err) }),
  )
}

function run<T>(fn: () => Promise<T>, cfg: Cfg, n = 1): Promise<T> {
  return call(fn).catch(async (err) => {
    if (n >= cfg.max) throw cast(err)

    await wait(cfg.delay * cfg.backoff ** (n - 1))
    return run(fn, cfg, n + 1)
  })
}

function call<T>(fn: () => Promise<T>) {
  return Promise.resolve().then(fn)
}

function done(id: ReturnType<typeof setTimeout>, fn: () => void) {
  clearTimeout(id)
  fn()
}

function cast(err: unknown) {
  if (err instanceof Error) return err
  return new Error(String(err))
}

function wait(ms: number) {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, ms)
  })
}
