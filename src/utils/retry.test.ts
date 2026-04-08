import { afterEach, describe, expect, it, vi } from "vitest"
import { retry, safe, TimeoutError, withTimeout } from "./retry.js"

afterEach(() => {
  vi.clearAllTimers()
  vi.useRealTimers()
})

describe("retry", () => {
  it("succeeds on first try", async () => {
    const fn = vi.fn(async () => "ok")

    await expect(retry(fn)).resolves.toBe("ok")
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it("succeeds on second try", async () => {
    vi.useFakeTimers()

    const err = new Error("boom")
    const fn = vi.fn(async () => "ok").mockRejectedValueOnce(err)
    const task = retry(fn, { delay: 100, backoff: 2 })

    await vi.advanceTimersByTimeAsync(100)

    await expect(task).resolves.toBe("ok")
    expect(fn).toHaveBeenCalledTimes(2)
  })

  it("fails after max attempts", async () => {
    vi.useFakeTimers()

    const err = new Error("boom")
    const fn = vi.fn(async () => {
      throw err
    })
    const task = retry(fn, { max: 3, delay: 100, backoff: 2 })
    const check = expect(task).rejects.toBe(err)

    await vi.runAllTimersAsync()

    await check
    expect(fn).toHaveBeenCalledTimes(3)
  })
})

describe("withTimeout", () => {
  it("resolves before deadline", async () => {
    vi.useFakeTimers()

    const task = withTimeout(
      () =>
        new Promise<string>((resolve) => {
          setTimeout(() => resolve("ok"), 50)
        }),
      100,
    )

    await vi.advanceTimersByTimeAsync(50)

    await expect(task).resolves.toBe("ok")
  })

  it("rejects after deadline", async () => {
    vi.useFakeTimers()

    const task = withTimeout(
      () =>
        new Promise<string>((resolve) => {
          setTimeout(() => resolve("late"), 200)
        }),
      100,
    )
    const check = expect(task).rejects.toBeInstanceOf(TimeoutError)

    await vi.advanceTimersByTimeAsync(100)

    await check
  })
})

describe("safe", () => {
  it("wraps success", async () => {
    await expect(safe(async () => "ok")).resolves.toEqual({ ok: true, data: "ok" })
  })

  it("wraps error", async () => {
    const err = new Error("boom")

    await expect(
      safe(async () => {
        throw err
      }),
    ).resolves.toEqual({ ok: false, error: err })
  })
})
