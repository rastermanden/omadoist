// One file habit the rest of the tool depends on: no reader ever sees half of
// what we write.
import { chmod, rename, unlink } from "node:fs/promises"
import { basename, dirname, join } from "node:path"

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
