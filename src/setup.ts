// Everything a fresh `omarchy plugin add` cannot do for us. Omarchy clones the
// repository and loads Panel.qml, but never runs install hooks, so the panel
// offers a "Set up" button that runs `omadoist setup` in a terminal: the
// icon font, the sync timer, the menu block, and a launcher on PATH.
import { chmod, mkdir, readlink, rm, symlink, unlink } from "node:fs/promises"
import { homedir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { spawnOptional } from "./proc"

const HOME = homedir()
const XDG_CONFIG = process.env.XDG_CONFIG_HOME || join(HOME, ".config")
const XDG_DATA = process.env.XDG_DATA_HOME || join(HOME, ".local", "share")

export const ROOT = resolve(dirname(Bun.fileURLToPath(import.meta.url)), "..")
export const BIN_LINK = join(HOME, ".local", "bin", "omadoist")
export const FONT_FILE = join(XDG_DATA, "fonts", "omadoist-icons.ttf")
export const UNIT_DIR = join(XDG_CONFIG, "systemd", "user")
export const UNITS = ["omadoist-sync.service", "omadoist-sync.timer"] as const
export const CACHE_HOME = join(process.env.XDG_CACHE_HOME || join(HOME, ".cache"), "omadoist")
export const CONFIG_HOME = join(XDG_CONFIG, "omadoist")

// systemctl and fc-cache are not guaranteed to exist (a container, a non-systemd
// box): a missing one costs the timer or the font cache, not the whole setup —
// and never a half-finished uninstall.
async function run(command: string[], quiet = true): Promise<number> {
  const proc = spawnOptional(command, { stdio: ["ignore", quiet ? "ignore" : "inherit", quiet ? "ignore" : "inherit"] })
  return proc ? proc.exited : 127
}

async function exists(path: string): Promise<boolean> {
  return Bun.file(path).exists()
}

async function linkLauncher(log: (line: string) => void): Promise<void> {
  const target = join(ROOT, "bin", "omadoist")
  await mkdir(dirname(BIN_LINK), { recursive: true })
  try {
    if ((await readlink(BIN_LINK)) === target) {
      log(`launcher already on PATH: ${BIN_LINK}`)
      return
    }
    await unlink(BIN_LINK)
  } catch {
    // Not a symlink or missing: fall through and (re)create it.
  }
  await symlink(target, BIN_LINK)
  log(`launcher → ${BIN_LINK}`)
}

async function installFont(log: (line: string) => void): Promise<boolean> {
  const had = await exists(FONT_FILE)
  await mkdir(dirname(FONT_FILE), { recursive: true })
  await Bun.write(FONT_FILE, Bun.file(join(ROOT, "assets", "omadoist-icons.ttf")))
  await chmod(FONT_FILE, 0o644)
  await run(["fc-cache", "-f", dirname(FONT_FILE)])
  log(had ? `icon font refreshed: ${FONT_FILE}` : `icon font → ${FONT_FILE}`)
  return !had
}

async function installTimer(log: (line: string) => void): Promise<void> {
  await mkdir(UNIT_DIR, { recursive: true })
  for (const unit of UNITS) {
    // The unit runs the launcher from wherever this checkout lives, so a
    // plugin cloned by `omarchy plugin add` works without ~/.local/bin.
    const text = (await Bun.file(join(ROOT, "systemd", unit)).text()).replace("%h/.local/bin/omadoist", join(ROOT, "bin", "omadoist"))
    await Bun.write(join(UNIT_DIR, unit), text)
  }
  await run(["systemctl", "--user", "daemon-reload"])
  await run(["systemctl", "--user", "enable", "--now", "omadoist-sync.timer"])
  log("sync timer enabled (every 5 minutes)")
}

export async function setup(log: (line: string) => void = console.log): Promise<{ fontInstalled: boolean }> {
  await linkLauncher(log)
  const fontInstalled = await installFont(log)
  await installTimer(log)
  return { fontInstalled }
}

export async function teardown(log: (line: string) => void = console.log, purge = false): Promise<void> {
  await run(["systemctl", "--user", "disable", "--now", "omadoist-sync.timer"])
  for (const unit of UNITS) await rm(join(UNIT_DIR, unit), { force: true })
  await run(["systemctl", "--user", "daemon-reload"])
  log("sync timer removed")

  if (await exists(FONT_FILE)) {
    await rm(FONT_FILE, { force: true })
    await run(["fc-cache", "-f", dirname(FONT_FILE)])
    log("icon font removed")
  }

  try {
    await unlink(BIN_LINK)
    log(`launcher removed from ${dirname(BIN_LINK)}`)
  } catch {
    // Never linked, or not ours; nothing to undo.
  }

  // The cache is derived from Todoist and rebuilt by the next sync; leaving it
  // behind made a reinstall look connected before it was set up.
  await rm(CACHE_HOME, { recursive: true, force: true })
  log("cache removed")

  if (purge) {
    await rm(CONFIG_HOME, { recursive: true, force: true })
    log("token and config removed")
  }
}
