import type { Task } from "./todoist"

export type TaskChanges = { added: Task[]; removed: Task[] }

/**
 * What changed between two syncs, ignoring ids this machine just acted on
 * itself: a task the user completed or added here is not news to them.
 */
export function diffTasks(previous: Task[], next: Task[], ignore: Iterable<string> = []): TaskChanges {
  const skip = new Set([...ignore].map(String))
  const before = new Set(previous.map((task) => String(task.id)))
  const after = new Set(next.map((task) => String(task.id)))
  return {
    added: next.filter((task) => !before.has(String(task.id)) && !skip.has(String(task.id))),
    removed: previous.filter((task) => !after.has(String(task.id)) && !skip.has(String(task.id))),
  }
}

const MAX_LINES = 5

/** One notification per sync, or nothing when nothing moved. */
export function describeChanges(changes: TaskChanges): { title: string; body: string } | null {
  const lines = [
    ...changes.removed.map((task) => `✓ ${task.content}`),
    ...changes.added.map((task) => `+ ${task.content}`),
  ]
  if (lines.length === 0) return null

  const parts: string[] = []
  if (changes.added.length) parts.push(`${changes.added.length} new`)
  if (changes.removed.length) parts.push(`${changes.removed.length} done`)

  const shown = lines.slice(0, MAX_LINES)
  if (lines.length > MAX_LINES) shown.push(`… and ${lines.length - MAX_LINES} more`)
  return { title: `Todoist · ${parts.join(", ")}`, body: shown.join("\n") }
}
