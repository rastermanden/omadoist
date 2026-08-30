import type { Cache } from "./cache"
import type { Config, SavedFilter } from "./config"
import type { FilterError } from "./filter"
import type { Karma } from "./karma"
import { choicesFromPairs, type ProjectChoice } from "./projects"
import type { SyncError } from "./sync"
import { formatDue, isOverdue, sortTasks } from "./tasks"
import type { Task } from "./todoist"

export const BAR_VIEW_VERSION = 4

/** One row as the bar panel shows it. Everything is already a display string. */
export type BarTask = {
  id: string
  title: string
  /** Relative due label, the same one the menu shows ("Today 14:30 ↻"); empty when undated. */
  due: string
  overdue: boolean
  /** Due today and not yet overdue. */
  today: boolean
  recurring: boolean
  project: string
  /** Human priority: 1 is Todoist's p1 (most urgent), 4 is none. */
  priority: 1 | 2 | 3 | 4
  url: string
  /**
   * The task's own notes, trimmed and capped. Empty when it has none, and
   * empty for every row when `showTaskDetails` is off: bar.json is re-read on
   * every panel open, so what the panel will not draw is not written.
   */
  description: string
  /** Label names, without Todoist's leading `@`. */
  labels: string[]
}

// A description is free text and can run to pages. The panel shows a few
// lines of it, so the rest is weight in a file rewritten every five minutes.
const MAX_DESCRIPTION = 500

export function trimDescription(raw: string): string {
  const text = raw
    .replace(/\r\n?/g, "\n")
    // Keep paragraphs, drop the gaps someone left between them.
    .replace(/\n{3,}/g, "\n\n")
    .trim()
  return text.length > MAX_DESCRIPTION ? text.slice(0, MAX_DESCRIPTION).trimEnd() + "…" : text
}

export function taskLabels(task: Task): string[] {
  if (!Array.isArray(task.labels)) return []
  return task.labels.map((label) => String(label ?? "").replace(/\s+/g, " ").trim()).filter(Boolean)
}

/**
 * A task that was just completed and came straight back: Todoist rolls a
 * recurring task forward to its next occurrence instead of closing it. Without
 * this the row simply reappears, which reads as a failed completion — and
 * clicking again advances the schedule another step.
 */
export type RolledForward = {
  id: string
  title: string
  /** The new due label, already formatted ("Tomorrow ↻"). */
  due: string
}

export type BarView = {
  version: typeof BAR_VIEW_VERSION
  /** When this file was written — changes on every write, unlike fetchedAt. */
  generatedAt: string
  /** When the tasks were last fetched from Todoist; empty before the first sync. */
  fetchedAt: string
  /** The Todoist filter query the rows were fetched with; empty means every active task. */
  filter: string
  /** Saved filters as chips, in config order; the one matching `filter` is the current one. */
  filters: SavedFilter[]
  /** Set when the last attempt to change the filter was rejected; cleared by the next write. */
  filterError: FilterError | null
  /**
   * Why the last sync failed, or null. Together with `fetchedAt` this is what
   * lets the panel tell "synced a minute ago" from "hasn't reached Todoist
   * since yesterday".
   */
  syncError: SyncError | null
  /** Set by the sync after a completion when the task rolled forward; cleared by the next write. */
  rolledForward: RolledForward | null
  connected: boolean
  /** The account's projects, Inbox first, for the new-task picker. */
  projects: ProjectChoice[]
  /**
   * Todoist's karma, goals and streaks, or null when the account has Karma
   * switched off, `showKarma` is false, or nothing has fetched them yet.
   */
  karma: Karma | null
  /** Open tasks in the cache, which may be more than the rows listed. */
  count: number
  overdue: number
  today: number
  tasks: BarTask[]
}

function localDate(at: Date): string {
  const month = String(at.getMonth() + 1).padStart(2, "0")
  const day = String(at.getDate()).padStart(2, "0")
  return `${at.getFullYear()}-${month}-${day}`
}

/** Todoist reports 4 for p1 and 1 for p4; the panel wants the number people see. */
export function humanPriority(task: Task): BarTask["priority"] {
  const raw = Math.min(4, Math.max(1, Math.round(task.priority ?? 1)))
  return (5 - raw) as BarTask["priority"]
}

function dueDate(task: Task): string {
  const due = task.due
  if (!due) return ""
  if (due.date) return due.date.slice(0, 10)
  if (due.datetime) {
    const at = new Date(Date.parse(due.datetime))
    return Number.isNaN(at.getTime()) ? "" : localDate(at)
  }
  return ""
}

export function toBarTask(task: Task, projects: Map<string, string>, now = new Date(), details = true): BarTask {
  const id = String(task.id)
  const overdue = isOverdue(task, now)
  return {
    id,
    title: task.content.replace(/\s+/g, " ").trim(),
    due: formatDue(task, now),
    overdue,
    today: !overdue && dueDate(task) === localDate(now),
    recurring: task.due?.is_recurring === true,
    project: (task.project_id && projects.get(String(task.project_id))) || "",
    priority: humanPriority(task),
    url: task.url || `https://app.todoist.com/app/task/${encodeURIComponent(id)}`,
    description: details ? trimDescription(String(task.description ?? "")) : "",
    labels: details ? taskLabels(task) : [],
  }
}

/**
 * The bar's view of the cache. Sorting and due labels come from the same
 * functions the menu uses, so the two never disagree about order or wording.
 */
export function buildBarView(
  cache: Cache,
  config: Config,
  connected: boolean,
  now = new Date(),
  filterError: FilterError | null = null,
  /** Task just completed, so a row that survives the sync can be named as rolled forward. */
  completedId = "",
): BarView {
  const view: BarView = {
    version: BAR_VIEW_VERSION,
    generatedAt: now.toISOString(),
    fetchedAt: connected ? cache.fetchedAt : "",
    connected,
    filter: config.filter.trim(),
    // From the config, not the account, so they are worth showing even before
    // the first sync — the panel just has nothing to apply them to yet.
    filters: config.filters.map((saved) => ({ ...saved })),
    filterError,
    // Nothing to be stale about before the account is connected.
    syncError: connected ? cache.lastError : null,
    rolledForward: null,
    karma: null,
    projects: [],
    count: 0,
    overdue: 0,
    today: 0,
    tasks: [],
  }
  if (!connected) return view

  view.projects = choicesFromPairs(cache.projects, cache.inboxProjectId)
  // The cache may still hold the numbers from before the setting was turned
  // off; the view is what the panel reads, so the switch is honoured here.
  view.karma = config.showKarma ? cache.karma : null

  const projects = new Map(cache.projects)
  const rows = sortTasks(cache.tasks).map((task) => toBarTask(task, projects, now, config.showTaskDetails))
  view.count = rows.length
  view.overdue = rows.filter((row) => row.overdue).length
  view.today = rows.filter((row) => row.today).length
  view.tasks = rows.slice(0, Math.max(1, config.limit))

  // Still listed after being completed: Todoist moved it to its next
  // occurrence. Named here even when the row falls outside the limit, so the
  // panel can say so either way.
  if (completedId) {
    const survivor = rows.find((row) => row.id === completedId)
    if (survivor) view.rolledForward = { id: survivor.id, title: survivor.title, due: survivor.due }
  }
  return view
}
