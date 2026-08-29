// Every helper binary this tool reaches for — notify-send, the Omarchy menu,
// systemctl, fc-cache — is optional: a machine without it should lose the
// notification, not the sync. `Bun.spawn` throws synchronously when the
// executable is missing from $PATH, so nothing may call it unguarded.
import type { SpawnOptions, Subprocess } from "bun"

/** Like `Bun.spawn`, but `null` instead of a throw when the binary is absent. */
export function spawnOptional<
  const In extends SpawnOptions.Writable = "ignore",
  const Out extends SpawnOptions.Readable = "pipe",
  const Err extends SpawnOptions.Readable = "inherit",
>(command: string[], options?: SpawnOptions.SpawnOptions<In, Out, Err>): Subprocess<In, Out, Err> | null {
  try {
    return Bun.spawn(command, options)
  } catch {
    return null
  }
}
