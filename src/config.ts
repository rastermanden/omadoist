import { chmod } from "node:fs/promises"
import { homedir } from "node:os"
import { join } from "node:path"
import { ensureDir } from "./files"
import { normalizeFilter } from "./filter"

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

/** One filter kept by name, so switching is a click rather than a retype. */
export type SavedFilter = {
  name: string
  /** The Todoist query. Empty is the "all active tasks" preset. */
  query: string
}

export type Config = {
  /** Todoist filter query, e.g. "today | overdue". Empty means every active task. */
  filter: string
  /**
   * Filters kept by name, shown as chips above the task list and as menu rows.
   * The one matching `filter` is marked. An empty list simply hides the chips;
   * the filter line stays the way to type any other query.
   */
  filters: SavedFilter[]
  /** Maximum number of task rows written into the menu. */
  limit: number
  /** Show "<due> · <project>" as the row subtitle, in the menu and the panel. */
  showDetails: boolean
  /**
   * Carry each task's description and labels into the bar view, for the detail
   * area the panel shows under the list for the row the cursor is on. Off
   * keeps them out of bar.json entirely.
   */
  showTaskDetails: boolean
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

// A row of chips, not a list: past a dozen the panel is a filter manager.
const MAX_FILTERS = 12
const MAX_FILTER_NAME = 24

export const DEFAULT_CONFIG: Config = {
  filter: "",
  /*
   * What a fresh install is most likely to flip between. "All" is the empty
   * query, the same thing `omadoist filter --clear` sets.
   *
   * No `p1` chip: priority is opt-in in Todoist, and on an account that never
   * sets one the chip empties the panel every time it is clicked, which reads
   * as the tool breaking rather than as a filter matching nothing. Today and
   * Overdue can come up empty too, but there "nothing" is the answer to the
   * question, not an artefact of a scheme the account does not use.
   */
  filters: [
    { name: "Today", query: "today" },
    { name: "Overdue", query: "overdue" },
    { name: "All", query: "" },
  ],
  limit: 25,
  showDetails: true,
  showTaskDetails: true,
  notifyRemoteChanges: true,
  menuLabel: "Todoist",
  // The Omarchy menu draws an extension row's icon as text, so the real Todoist
  // mark has to arrive as a font. install.sh puts assets/omadoist-icons.ttf
  // in ~/.local/share/fonts and this is its one glyph.
  menuIcon: "\u{E900}",
  menuIconFont: "Omadoist Icons",
}

// A key the user never set is not a complaint; a key set to the wrong type is.
function asString(value: unknown, key: string, fallback: string, warnings: string[]): string {
  if (value === undefined) return fallback
  if (typeof value === "string") return value
  warnings.push(`${key} should be a string, not ${describe(value)}; using ${JSON.stringify(fallback)}`)
  return fallback
}

function asBoolean(value: unknown, key: string, fallback: boolean, warnings: string[]): boolean {
  if (value === undefined) return fallback
  if (typeof value === "boolean") return value
  warnings.push(`${key} should be true or false, not ${describe(value)}; using ${fallback}`)
  return fallback
}

/** A count of rows: whole, positive, finite. "25" from a hand edit counts. */
function asCount(value: unknown, key: string, fallback: number, warnings: string[]): number {
  if (value === undefined) return fallback
  const number = typeof value === "number" ? value : typeof value === "string" ? Number(value.trim() || NaN) : NaN
  if (Number.isFinite(number) && number >= 1) return Math.floor(number)
  warnings.push(`${key} should be a positive whole number, not ${describe(value)}; using ${fallback}`)
  return fallback
}

/**
 * Saved filters, each dropped on its own: one malformed entry in a hand-edited
 * list should cost that chip, not the whole row of them. Queries go through
 * the same normalisation the CLI applies, so a saved "all" is the empty query
 * and marks itself as current when nothing is filtered.
 */
function asFilters(value: unknown, key: string, fallback: SavedFilter[], warnings: string[]): SavedFilter[] {
  if (value === undefined) return fallback.map((saved) => ({ ...saved }))
  if (!Array.isArray(value)) {
    warnings.push(`${key} should be a list of {name, query}, not ${describe(value)}; using the defaults`)
    return fallback.map((saved) => ({ ...saved }))
  }

  const saved: SavedFilter[] = []
  const seen = new Set<string>()
  for (const [index, entry] of value.entries()) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      warnings.push(`${key}[${index}] should be {name, query}, not ${describe(entry)}; skipping it`)
      continue
    }
    const { name, query } = entry as { name?: unknown; query?: unknown }
    if (typeof name !== "string" || name.trim() === "") {
      warnings.push(`${key}[${index}] needs a name; skipping it`)
      continue
    }
    if (query !== undefined && typeof query !== "string") {
      warnings.push(`${key}[${index}].query should be a string, not ${describe(query)}; skipping it`)
      continue
    }
    const label = name.replace(/\s+/g, " ").trim().slice(0, MAX_FILTER_NAME)
    if (seen.has(label.toLowerCase())) {
      warnings.push(`${key}[${index}] repeats the name ${JSON.stringify(label)}; skipping it`)
      continue
    }
    seen.add(label.toLowerCase())
    saved.push({ name: label, query: normalizeFilter(String(query ?? "")) })
    if (saved.length === MAX_FILTERS) {
      if (value.length > MAX_FILTERS) warnings.push(`${key} keeps the first ${MAX_FILTERS}; the rest are ignored`)
      break
    }
  }
  return saved
}

function describe(value: unknown): string {
  if (value === null) return "null"
  if (Array.isArray(value)) return "an array"
  return typeof value === "string" || typeof value === "number" || typeof value === "boolean"
    ? JSON.stringify(value)
    : typeof value
}

/**
 * The config file is hand-edited, so every key arrives untrusted. A wrong type
 * used to reach the rest of the program — `{"filter": null}` crashed every
 * command including `status`, and `{"limit": "lots"}` quietly showed no rows
 * at all. Each key falls back to its default on its own, with a line saying so.
 */
export function sanitizeConfig(raw: unknown): { config: Config; warnings: string[] } {
  const warnings: string[] = []
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    if (raw !== undefined) warnings.push(`expected a JSON object, found ${describe(raw)}; using defaults`)
    return { config: { ...DEFAULT_CONFIG }, warnings }
  }

  const given = raw as Partial<Record<keyof Config, unknown>>
  const config: Config = {
    filter: asString(given.filter, "filter", DEFAULT_CONFIG.filter, warnings),
    filters: asFilters(given.filters, "filters", DEFAULT_CONFIG.filters, warnings),
    limit: asCount(given.limit, "limit", DEFAULT_CONFIG.limit, warnings),
    showDetails: asBoolean(given.showDetails, "showDetails", DEFAULT_CONFIG.showDetails, warnings),
    showTaskDetails: asBoolean(given.showTaskDetails, "showTaskDetails", DEFAULT_CONFIG.showTaskDetails, warnings),
    notifyRemoteChanges: asBoolean(given.notifyRemoteChanges, "notifyRemoteChanges", DEFAULT_CONFIG.notifyRemoteChanges, warnings),
    menuLabel: asString(given.menuLabel, "menuLabel", DEFAULT_CONFIG.menuLabel, warnings),
    menuIcon: asString(given.menuIcon, "menuIcon", DEFAULT_CONFIG.menuIcon, warnings),
    menuIconFont: asString(given.menuIconFont, "menuIconFont", DEFAULT_CONFIG.menuIconFont, warnings),
  }
  return { config, warnings }
}

export async function loadConfig(): Promise<Config> {
  const file = Bun.file(CONFIG_FILE)
  if (!(await file.exists())) return { ...DEFAULT_CONFIG }
  let raw: unknown
  try {
    raw = await file.json()
  } catch (err) {
    console.error(`omadoist: ignoring unreadable ${CONFIG_FILE} (${err}); using defaults`)
    return { ...DEFAULT_CONFIG }
  }
  const { config, warnings } = sanitizeConfig(raw)
  for (const warning of warnings) console.error(`omadoist: ${CONFIG_FILE}: ${warning}`)
  return config
}

export async function saveConfig(config: Config): Promise<void> {
  await ensureDir(CONFIG_DIR)
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
  await ensureDir(CONFIG_DIR)
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
  await ensureDir(CONFIG_DIR)
  await Bun.write(CONFIG_FILE, JSON.stringify(next, null, 2) + "\n")
  return sanitizeConfig(next).config
}
