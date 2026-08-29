import { afterAll, expect, test } from "bun:test"
import { mkdtemp, mkdir, rm, readdir } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { writeAtomic } from "../src/files"

const root = await mkdtemp(join(tmpdir(), "omadoist-files-"))
afterAll(() => rm(root, { recursive: true, force: true }))

test("the file lands whole and no temp file survives", async () => {
  const dir = join(root, "write")
  await mkdir(dir)
  const target = join(dir, "bar.json")

  await writeAtomic(target, '{"count":1}')
  expect(await Bun.file(target).text()).toBe('{"count":1}')

  await writeAtomic(target, '{"count":2}')
  expect(await Bun.file(target).text()).toBe('{"count":2}')
  expect(await readdir(dir)).toEqual(["bar.json"])
})

test("concurrent writers never leave a reader a half-written document", async () => {
  const dir = join(root, "concurrent")
  await mkdir(dir)
  const target = join(dir, "bar.json")
  const payloads = Array.from({ length: 20 }, (_, index) => JSON.stringify({ tasks: Array(200).fill(index) }))

  const reads: Promise<string>[] = []
  const writes = payloads.map(async (payload) => {
    await writeAtomic(target, payload)
    reads.push(Bun.file(target).text())
  })
  await Promise.all(writes)

  // Every read is one of the whole payloads: rename swaps the file, it never
  // truncates the one a watcher is reading.
  for (const text of await Promise.all(reads)) expect(payloads).toContain(text)
})

test("a write that cannot land leaves the old file alone", async () => {
  const dir = join(root, "failing")
  await mkdir(dir)
  const target = join(dir, "bar.json")
  await writeAtomic(target, "old")

  // A directory where the file should go: the rename fails, the target stands.
  await expect(writeAtomic(join(target, "impossible"), "new")).rejects.toThrow()
  expect(await Bun.file(target).text()).toBe("old")
})
