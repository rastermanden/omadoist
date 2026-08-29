import { expect, test } from "bun:test"
import { spawnOptional } from "../src/proc"

test("a missing binary is null, not a throw", () => {
  // Bun.spawn throws synchronously here, which used to abort a sync before it
  // wrote the cache — the widget then froze on stale data.
  expect(spawnOptional(["omadoist-definitely-not-real-xyz"], { stdio: ["ignore", "ignore", "ignore"] })).toBeNull()
})

test("a binary that exists still runs and pipes", async () => {
  const proc = spawnOptional(["echo", "hello"], { stdout: "pipe", stderr: "ignore" })
  expect(proc).not.toBeNull()
  expect((await new Response(proc!.stdout).text()).trim()).toBe("hello")
  expect(await proc!.exited).toBe(0)
})
