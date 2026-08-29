import { chmod, mkdir } from "node:fs/promises"
import { homedir } from "node:os"
import { join } from "node:path"

const HOME = homedir()
const XDG_CONFIG = process.env.XDG_CONFIG_HOME || join(HOME, ".config")
const XDG_CACHE = process.env.XDG_CACHE_HOME || join(HOME, ".cache")

export const CONFIG_DIR = join(XDG_CONFIG, "omadoist")
export const CACHE_DIR = join(XDG_CACHE, "omadoist")
export const CONFIG_FILE = join(CONFIG_DIR, "config.json")
export const TOKEN_FILE = join(CONFIG_DIR, "token")
export const CACHE_FILE = join(CACHE_DIR, "tasks.json")
// Pre-sorted, pre-formatted rows for the bar widget (plugin/Panel.qml watches it).
export const BAR_FILE = join(CACHE_DIR, "bar.json")

// The Omarchy menu watches this one file and hot-reloads it on save, so the
// generated block lands in the menu without restarting the shell.
export const MENU_FILE =
  process.env.OMADOIST_MENU_FILE || join(XDG_CONFIG, "omarchy", "extensions", "omarchy-menu.jsonc")

export type Config = {
  /** Todoist filter query, e.g. "today | overdue". Empty means every active task. */
  filter: string
  /** Maximum number of task rows written into the menu. */
  limit: number
  /** Show "<due> · <project>" as the row subtitle. */
  showDetails: boolean
  /**
   * Notify when a sync finds tasks added or completed elsewhere (phone, web).
   * Local completes and adds never notify: the user just did them.
   */
  notifyRemoteChanges: boolean
  /** Label of the submenu on the menu root. */
  menuLabel: string
  /** Glyph used for the submenu. */
  menuIcon: string
  /**
   * Font family the submenu glyph is drawn with. Empty falls back to the shell
   * font, which has no Todoist mark — set it together with `menuIcon`.
   */
  menuIconFont: string
}

export const DEFAULT_CONFIG: Config = {
  filter: "",
  limit: 25,
  showDetails: true,
  notifyRemoteChanges: true,
  menuLabel: "Todoist",
  // The Omarchy menu draws an extension row's icon as text, so the real Todoist
  // mark has to arrive as a font. install.sh puts assets/omadoist-icons.ttf
  // in ~/.local/share/fonts and this is its one glyph.
  menuIcon: "\u{E900}",
  menuIconFont: "Omadoist Icons",
}

export async function loadConfig(): Promise<Config> {
  const file = Bun.file(CONFIG_FILE)
  if (!(await file.exists())) return { ...DEFAULT_CONFIG }
  try {
    return { ...DEFAULT_CONFIG, ...(await file.json()) }
  } catch (err) {
    console.error(`omadoist: ignoring unreadable ${CONFIG_FILE} (${err}); using defaults`)
    return { ...DEFAULT_CONFIG }
  }
}

export async function saveConfig(config: Config): Promise<void> {
  await mkdir(CONFIG_DIR, { recursive: true, mode: 0o700 })
  await Bun.write(CONFIG_FILE, JSON.stringify(config, null, 2) + "\n")
}

export async function loadToken(): Promise<string | null> {
  const fromEnv = process.env.TODOIST_API_TOKEN?.trim()
  if (fromEnv) return fromEnv

  const file = Bun.file(TOKEN_FILE)
  if (!(await file.exists())) return null
  const token = (await file.text()).trim()
  return token || null
}

// The token is a bearer credential for the whole account, so it never lands in
// a world-readable file.
export async function saveToken(token: string): Promise<void> {
  await mkdir(CONFIG_DIR, { recursive: true, mode: 0o700 })
  await Bun.write(TOKEN_FILE, token.trim() + "\n")
  await chmod(TOKEN_FILE, 0o600)
}

/**
 * Change one or more keys in the user's config file, touching nothing else.
 * Only the keys the user has set are written back, so a later change to a
 * default is not frozen into their file.
 */
export async function updateConfig(patch: Partial<Config>): Promise<Config> {
  const file = Bun.file(CONFIG_FILE)
  let current: Record<string, unknown> = {}
  if (await file.exists()) {
    try {
      const parsed = await file.json()
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) current = parsed
    } catch {
      // Unreadable: start over rather than fail the command; loadConfig
      // already warned about it.
    }
  }
  const next = { ...current, ...patch }
  await mkdir(CONFIG_DIR, { recursive: true, mode: 0o700 })
  await Bun.write(CONFIG_FILE, JSON.stringify(next, null, 2) + "\n")
  return { ...DEFAULT_CONFIG, ...next }
}
