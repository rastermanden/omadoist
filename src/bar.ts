import type { Cache } from "./cache"
import type { Config } from "./config"
import type { FilterError } from "./filter"
import { choicesFromPairs, type ProjectChoice } from "./projects"
import type { SyncError } from "./sync"
import { formatDue, isOverdue, sortTasks } from "./tasks"
import type { Task } from "./todoist"

export const BAR_VIEW_VERSION = 3

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
}

export type BarView = {
  version: typeof BAR_VIEW_VERSION
  /** When this file was written — changes on every write, unlike fetchedAt. */
  generatedAt: string
  /** When the tasks were last fetched from Todoist; empty before the first sync. */
  fetchedAt: string
  /** The Todoist filter query the rows were fetched with; empty means every active task. */
  filter: string
  /** Set when the last attempt to change the filter was rejected; cleared by the next write. */
  filterError: FilterError | null
  /**
   * Why the last sync failed, or null. Together with `fetchedAt` this is what
   * lets the panel tell "synced a minute ago" from "hasn't reached Todoist
   * since yesterday".
   */
  syncError: SyncError | null
  connected: boolean
  /** The account's projects, Inbox first, for the new-task picker. */
  projects: ProjectChoice[]
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

export function toBarTask(task: Task, projects: Map<string, string>, now = new Date()): BarTask {
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
): BarView {
  const view: BarView = {
    version: BAR_VIEW_VERSION,
    generatedAt: now.toISOString(),
    fetchedAt: connected ? cache.fetchedAt : "",
    connected,
    filter: config.filter.trim(),
    filterError,
    // Nothing to be stale about before the account is connected.
    syncError: connected ? cache.lastError : null,
    projects: [],
    count: 0,
    overdue: 0,
    today: 0,
    tasks: [],
  }
  if (!connected) return view

  view.projects = choicesFromPairs(cache.projects, cache.inboxProjectId)

  const projects = new Map(cache.projects)
  const rows = sortTasks(cache.tasks).map((task) => toBarTask(task, projects, now))
  view.count = rows.length
  view.overdue = rows.filter((row) => row.overdue).length
  view.today = rows.filter((row) => row.today).length
  view.tasks = rows.slice(0, Math.max(1, config.limit))
  return view
}
