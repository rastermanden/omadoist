import type { Task } from "./todoist"

const DAY_MS = 86_400_000
const FAR_FUTURE = Number.MAX_SAFE_INTEGER

/** Local midnight of the given moment, as milliseconds. */
function startOfDay(at: Date): number {
  return new Date(at.getFullYear(), at.getMonth(), at.getDate()).getTime()
}

/**
 * When a task is due, as a sortable number. A date without a time sorts at the
 * end of its day so a timed task earlier that day comes first; a task with no
 * due date sorts last.
 */
export function dueAt(task: Task): number {
  const due = task.due
  if (!due) return FAR_FUTURE
  if (due.datetime) {
    const at = Date.parse(due.datetime)
    if (!Number.isNaN(at)) return at
  }
  if (due.date) {
    const at = Date.parse(`${due.date}T23:59:59`)
    if (!Number.isNaN(at)) return at
  }
  return FAR_FUTURE
}

/** Overdue and today first, then by priority (p1 highest), then Todoist's own order. */
export function sortTasks(tasks: Task[]): Task[] {
  return [...tasks].sort((a, b) => {
    const byDue = dueAt(a) - dueAt(b)
    if (byDue !== 0) return byDue
    const byPriority = (b.priority ?? 1) - (a.priority ?? 1)
    if (byPriority !== 0) return byPriority
    return (a.child_order ?? 0) - (b.child_order ?? 0)
  })
}

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"]
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]

export function formatDue(task: Task, now = new Date()): string {
  const due = task.due
  if (!due) return ""

  const iso = due.datetime ?? due.date
  if (!iso) return due.string ?? ""
  const at = new Date(Date.parse(due.datetime ? iso : `${iso}T12:00:00`))
  if (Number.isNaN(at.getTime())) return due.string ?? ""

  const time = due.datetime
    ? ` ${String(at.getHours()).padStart(2, "0")}:${String(at.getMinutes()).padStart(2, "0")}`
    : ""
  const days = Math.round((startOfDay(at) - startOfDay(now)) / DAY_MS)

  let day: string
  if (days < 0) day = `Overdue · ${at.getDate()} ${MONTHS[at.getMonth()]}`
  else if (days === 0) day = "Today"
  else if (days === 1) day = "Tomorrow"
  else if (days < 7) day = WEEKDAYS[at.getDay()]!
  else day = `${at.getDate()} ${MONTHS[at.getMonth()]}`

  const recurring = due.is_recurring ? " ↻" : ""
  return `${day}${time}${recurring}`
}

export function isOverdue(task: Task, now = new Date()): boolean {
  return dueAt(task) < now.getTime()
}

/** Row subtitle: when it is due, and which project it lives in. */
export function taskDetails(task: Task, projects: Map<string, string>, now = new Date()): string {
  const parts: string[] = []
  const due = formatDue(task, now)
  if (due) parts.push(due)
  const project = task.project_id ? projects.get(String(task.project_id)) : undefined
  if (project) parts.push(project)
  return parts.join(" · ")
}
