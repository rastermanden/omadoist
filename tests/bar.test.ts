import { expect, test } from "bun:test"
import { buildBarView, humanPriority, taskLabels, toBarTask, trimDescription } from "../src/bar"
import type { Cache } from "../src/cache"
import { DEFAULT_CONFIG } from "../src/config"
import type { Task } from "../src/todoist"

const now = new Date(2026, 7, 29, 12, 0, 0) // 29 Aug 2026, local time
const config = { ...DEFAULT_CONFIG }

function task(id: string, content: string, extra: Partial<Task> = {}): Task {
  return { id, content, project_id: "p1", priority: 1, ...extra }
}

function cache(tasks: Task[]): Cache {
  return { fetchedAt: "2026-08-29T09:30:00.000Z", tasks, projects: [["p1", "Work"]], inboxProjectId: "", lastError: null, lastCompleted: null }
}

test("rows come out sorted the way the menu sorts them, with display strings ready", () => {
  const view = buildBarView(
    cache([
      task("later", "Later", { due: { date: "2026-10-05" } }),
      task("today", "Today", { due: { date: "2026-08-29" } }),
      task("overdue", "Overdue", { due: { date: "2026-08-27" }, priority: 4 }),
      task("undated", "Undated"),
    ]),
    config,
    true,
    now,
  )

  expect(view.connected).toBe(true)
  expect(view.tasks.map((row) => row.id)).toEqual(["overdue", "today", "later", "undated"])
  expect(view.tasks[0]).toMatchObject({ due: "Overdue · 27 Aug", overdue: true, today: false, project: "Work", priority: 1 })
  expect(view.tasks[1]).toMatchObject({ due: "Today", overdue: false, today: true, priority: 4 })
  expect(view.tasks[3]?.due).toBe("")
  expect(view.count).toBe(4)
  expect(view.overdue).toBe(1)
  expect(view.today).toBe(1)
  expect(view.filter).toBe("")
})

test("the projects ride along for the new-task picker, Inbox first", () => {
  const view = buildBarView(
    { fetchedAt: "", tasks: [], projects: [["p1", "Work"], ["p0", "Inbox"]], inboxProjectId: "p0", lastError: null, lastCompleted: null },
    config,
    true,
    now,
  )
  expect(view.projects).toEqual([
    { id: "p0", name: "Inbox", inbox: true },
    { id: "p1", name: "Work", inbox: false },
  ])
  // Nothing to pick from before the account is connected.
  expect(buildBarView(cache([]), config, false, now).projects).toEqual([])
})

test("the filter the rows came from is part of the view", () => {
  const view = buildBarView(cache([]), { ...config, filter: " today | overdue " }, true, now)
  expect(view.filter).toBe("today | overdue")
  expect(view.filterError).toBeNull()
  const refused = buildBarView(cache([]), config, true, now, { query: "todya", message: "nope", suggestion: "today" })
  expect(refused.filterError).toEqual({ query: "todya", message: "nope", suggestion: "today" })
})

test("a timed task earlier today is overdue, not today", () => {
  const row = toBarTask(task("a", "Standup", { due: { date: "2026-08-29", datetime: "2026-08-29T09:00:00", is_recurring: true } }), new Map(), now)
  expect(row.overdue).toBe(true)
  expect(row.today).toBe(false)
  expect(row.recurring).toBe(true)
  expect(row.due).toBe("Today 09:00 ↻")
})

test("the list is capped at the configured limit but the count is not", () => {
  const tasks = Array.from({ length: 7 }, (_, i) => task(`t${i}`, `Task ${i}`))
  const view = buildBarView(cache(tasks), { ...config, limit: 3 }, true, now)
  expect(view.tasks).toHaveLength(3)
  expect(view.count).toBe(7)
})

test("without a token the view is empty and says so", () => {
  const view = buildBarView(cache([task("1", "Buy milk")]), config, false, now)
  expect(view).toMatchObject({ connected: false, count: 0, tasks: [], fetchedAt: "" })
  expect(view.generatedAt).toBe(now.toISOString())
})

test("priority is flipped into the number people see, and the url falls back to the task page", () => {
  expect(humanPriority(task("a", "x", { priority: 4 }))).toBe(1)
  expect(humanPriority(task("a", "x", { priority: 1 }))).toBe(4)
  expect(humanPriority(task("a", "x", {}))).toBe(4)
  expect(toBarTask(task("6hPM", "x"), new Map(), now).url).toBe("https://app.todoist.com/app/task/6hPM")
  expect(toBarTask(task("6hPM", "x", { url: "https://todoist.com/showTask?id=1" }), new Map(), now).url).toBe("https://todoist.com/showTask?id=1")
})

test("whitespace in titles is collapsed so a row stays on one line", () => {
  expect(toBarTask(task("a", "  Call\n  mom \t now "), new Map(), now).title).toBe("Call mom now")
})

test("a task still listed after being completed is named as rolled forward", () => {
  // Todoist advances a recurring task instead of closing it, so `done` is
  // followed by the very same row — with a new due date.
  const recurring: Task = {
    id: "r1",
    content: "Spis mere kød",
    project_id: "p1",
    due: { date: "2026-08-30", is_recurring: true },
  }
  const cache: Cache = { fetchedAt: "2026-08-29T10:00:00.000Z", tasks: [recurring], projects: [["p1", "Livsstil"]], inboxProjectId: "p1", lastError: null, lastCompleted: null }
  const now = new Date("2026-08-29T10:00:00.000Z")

  const view = buildBarView(cache, DEFAULT_CONFIG, true, now, null, "r1")
  expect(view.rolledForward).toEqual({ id: "r1", title: "Spis mere kød", due: view.tasks[0]!.due })
  expect(view.rolledForward!.due).not.toBe("")

  // No completion, or one that really did close: nothing to confirm.
  expect(buildBarView(cache, DEFAULT_CONFIG, true, now).rolledForward).toBeNull()
  expect(buildBarView(cache, DEFAULT_CONFIG, true, now, null, "gone").rolledForward).toBeNull()
})

test("a rolled-forward row is named even when it falls outside the shown limit", () => {
  const tasks: Task[] = Array.from({ length: 5 }, (_, i) => ({
    id: `t${i}`,
    content: `Task ${i}`,
    due: { date: "2026-09-0" + (i + 1), is_recurring: true },
  }))
  const cache: Cache = { fetchedAt: "2026-08-29T10:00:00.000Z", tasks, projects: [], inboxProjectId: "", lastError: null, lastCompleted: null }
  const view = buildBarView(cache, { ...DEFAULT_CONFIG, limit: 1 }, true, new Date("2026-08-29T10:00:00.000Z"), null, "t4")
  expect(view.tasks).toHaveLength(1)
  expect(view.rolledForward?.id).toBe("t4")
})

// ------------------------------------------- a task's own notes and labels

test("description and labels ride along, trimmed, for the panel's detail area", () => {
  const view = buildBarView(
    cache([
      task("t1", "Ring VVS", {
        description: "  Spørg om de kan tage\r\n\n\n\ndet hele på én gang.  ",
        labels: ["  hjem ", "", "gør det selv"],
      }),
    ]),
    config,
    true,
    now,
  )
  // CRLF folded, the gap between paragraphs kept but not the blank run.
  expect(view.tasks[0]!.description).toBe("Spørg om de kan tage\n\ndet hele på én gang.")
  expect(view.tasks[0]!.labels).toEqual(["hjem", "gør det selv"])
})

test("a task with nothing to add carries nothing", () => {
  const view = buildBarView(cache([task("t1", "Ring VVS")]), config, true, now)
  expect(view.tasks[0]!.description).toBe("")
  expect(view.tasks[0]!.labels).toEqual([])
})

test("a description longer than the panel would show is cut, not carried whole", () => {
  const long = trimDescription("x".repeat(900))
  expect(long).toHaveLength(501)
  expect(long.endsWith("…")).toBe(true)
  expect(trimDescription("x".repeat(500))).toHaveLength(500)
})

test("labels that are not strings, or not a list, are dropped rather than shown", () => {
  expect(taskLabels({ id: "t", content: "c" })).toEqual([])
  expect(taskLabels({ id: "t", content: "c", labels: undefined })).toEqual([])
  expect(taskLabels({ id: "t", content: "c", labels: ["  ", "ok"] })).toEqual(["ok"])
})

test("showTaskDetails off keeps the notes out of bar.json entirely", () => {
  const quiet = { ...DEFAULT_CONFIG, showTaskDetails: false }
  const view = buildBarView(
    cache([task("t1", "Ring VVS", { description: "Something", labels: ["hjem"] })]),
    quiet,
    true,
    now,
  )
  expect(view.tasks[0]!.description).toBe("")
  expect(view.tasks[0]!.labels).toEqual([])
})

// ----------------------------------------------------------- saved filters

test("the saved filters ride along for the panel's chips", () => {
  const view = buildBarView(cache([]), { ...config, filter: "overdue" }, true, now)
  expect(view.filters).toEqual(DEFAULT_CONFIG.filters)
})

test("chips are worth showing before the first sync too — they come from the config", () => {
  const view = buildBarView(cache([]), config, false, now)
  expect(view.filters.map((saved) => saved.name)).toEqual(["Today", "Overdue", "All"])
})
