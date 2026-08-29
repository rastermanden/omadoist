import { expect, test } from "bun:test"
import { formatDue, sortTasks } from "../src/tasks"
import type { Task } from "../src/todoist"

const now = new Date(2026, 7, 29, 12, 0, 0) // 29 Aug 2026, local time

function task(id: string, extra: Partial<Task> = {}): Task {
  return { id, content: `task ${id}`, priority: 1, ...extra }
}

test("overdue sorts before today, and undated tasks sort last", () => {
  const ordered = sortTasks([
    task("undated"),
    task("today", { due: { date: "2026-08-29" } }),
    task("overdue", { due: { date: "2026-08-20" } }),
  ]).map((entry) => entry.id)

  expect(ordered).toEqual(["overdue", "today", "undated"])
})

test("same due date falls back to priority, then Todoist's order", () => {
  const due = { date: "2026-08-29" }
  const ordered = sortTasks([
    task("p4-second", { due, priority: 1, child_order: 2 }),
    task("p1", { due, priority: 4 }),
    task("p4-first", { due, priority: 1, child_order: 1 }),
  ]).map((entry) => entry.id)

  expect(ordered).toEqual(["p1", "p4-first", "p4-second"])
})

test("due dates read as relative days", () => {
  expect(formatDue(task("a", { due: { date: "2026-08-29" } }), now)).toBe("Today")
  expect(formatDue(task("a", { due: { date: "2026-08-30" } }), now)).toBe("Tomorrow")
  expect(formatDue(task("a", { due: { date: "2026-08-31" } }), now)).toBe("Monday")
  expect(formatDue(task("a", { due: { date: "2026-08-27" } }), now)).toBe("Overdue · 27 Aug")
  expect(formatDue(task("a", { due: { date: "2026-10-05" } }), now)).toBe("5 Oct")
  expect(formatDue(task("a"), now)).toBe("")
})

test("a timed, recurring due date keeps its time and marker", () => {
  const due = { date: "2026-08-29", datetime: "2026-08-29T14:30:00", is_recurring: true }
  expect(formatDue(task("a", { due }), now)).toBe("Today 14:30 ↻")
})
