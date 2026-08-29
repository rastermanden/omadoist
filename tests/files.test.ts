import { afterAll, expect, test } from "bun:test"
import { mkdtemp, mkdir, rm, stat, readdir } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { ensureDir, writeAtomic } from "../src/files"

const root = await mkdtemp(join(tmpdir(), "omadoist-files-"))
afterAll(() => rm(root, { recursive: true, force: true }))

const modeOf = async (path: string) => (await stat(path)).mode & 0o777

test("a new directory is private, and so is one left behind by an earlier install", async () => {
  const fresh = join(root, "fresh")
  await ensureDir(fresh)
  expect(await modeOf(fresh)).toBe(0o700)

  // mkdir applies its mode only when it creates, so the old 755 had to be fixed.
  const old = join(root, "old")
  await mkdir(old, { mode: 0o755 })
  await ensureDir(old)
  expect(await modeOf(old)).toBe(0o700)
})

test("the written file has the mode asked for and no temp file survives", async () => {
  const dir = join(root, "write")
  await ensureDir(dir)
  const target = join(dir, "bar.json")

  await writeAtomic(target, '{"count":1}', 0o600)
  expect(await Bun.file(target).text()).toBe('{"count":1}')
  expect(await modeOf(target)).toBe(0o600)

  await writeAtomic(target, '{"count":2}', 0o600)
  expect(await Bun.file(target).text()).toBe('{"count":2}')
  expect(await readdir(dir)).toEqual(["bar.json"])
})

test("concurrent writers never leave a reader a half-written document", async () => {
  const dir = join(root, "concurrent")
  await ensureDir(dir)
  const target = join(dir, "bar.json")
  const payloads = Array.from({ length: 20 }, (_, index) => JSON.stringify({ tasks: Array(200).fill(index) }))

  const reads: Promise<string>[] = []
  const writes = payloads.map(async (payload) => {
    await writeAtomic(target, payload, 0o600)
    reads.push(Bun.file(target).text())
  })
  await Promise.all(writes)

  // Every read is one of the whole payloads: rename swaps the file, it never
  // truncates the one a watcher is reading.
  for (const text of await Promise.all(reads)) expect(payloads).toContain(text)
})

test("a write that cannot land leaves the old file alone", async () => {
  const dir = join(root, "failing")
  await ensureDir(dir)
  const target = join(dir, "bar.json")
  await writeAtomic(target, "old", 0o600)

  // A directory where the file should go: the rename fails, the target stands.
  await expect(writeAtomic(join(target, "impossible"), "new")).rejects.toThrow()
  expect(await Bun.file(target).text()).toBe("old")
})
