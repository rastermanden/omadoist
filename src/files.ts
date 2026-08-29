// Two file habits the rest of the tool depends on: nobody else can read what
// we write, and no reader ever sees half of it.
import { chmod, mkdir, rename, unlink } from "node:fs/promises"
import { basename, dirname, join } from "node:path"

/**
 * Create a private directory, and make an existing one private too: `mkdir`
 * applies its mode only when it creates, so a directory left behind by an
 * earlier install keeps whatever the umask gave it.
 */
export async function ensureDir(dir: string, mode = 0o700): Promise<void> {
  await mkdir(dir, { recursive: true, mode })
  await chmod(dir, mode).catch(() => {
    // Someone else's directory (a shared XDG root): ours to write in, not to
    // re-permission.
  })
}

let sequence = 0

/**
 * Write via a sibling temp file and `rename` it over the target. Rename is
 * atomic within a filesystem, so a watcher — Panel.qml has a FileView on
 * bar.json — sees either the whole old file or the whole new one, never a
 * truncated document that fails to parse.
 */
export async function writeAtomic(path: string, contents: string, mode?: number): Promise<void> {
  // Same directory, so the rename stays on one filesystem; pid and counter so
  // two concurrent writers (the sync timer and a `done`) cannot collide.
  const temp = join(dirname(path), `.${basename(path)}.${process.pid}.${sequence++}.tmp`)
  try {
    await Bun.write(temp, contents)
    if (mode !== undefined) await chmod(temp, mode)
    await rename(temp, path)
  } catch (err) {
    await unlink(temp).catch(() => {})
    throw err
  }
}
