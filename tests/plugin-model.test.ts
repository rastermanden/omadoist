import { expect, test } from "bun:test"

// Model.js is plain ES5 for Quickshell's QML engine; the CommonJS export at
// its foot is what makes it loadable here.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const Model = require("../Model.js")

const now = new Date(2026, 7, 29, 14, 5, 0)

function view(overrides: Record<string, unknown> = {}) {
  return Model.parseView(
    JSON.stringify({
      version: 1,
      generatedAt: "2026-08-29T12:05:00.000Z",
      fetchedAt: "2026-08-29T12:05:00.000Z",
      connected: true,
      count: 2,
      overdue: 1,
      today: 0,
      tasks: [
        { id: "a", title: "Ring mor", due: "Overdue · 27 Aug", overdue: true, project: "Inbox", priority: 1 },
        { id: "b", title: "Køb ris", due: "", project: "Inbox", priority: 4 },
      ],
      ...overrides,
    }),
  )
}

test("garbage in the cache file degrades to the empty view instead of throwing", () => {
  expect(Model.parseView("")).toEqual(Model.emptyView())
  expect(Model.parseView("{not json")).toEqual(Model.emptyView())
  expect(Model.parseView("[]")).toEqual(Model.emptyView())
  expect(Model.parseView('{"tasks":[null,{"title":"no id"},{"id":7}]}').tasks).toEqual([
    { id: "7", title: "Untitled task", due: "", overdue: false, today: false, recurring: false, project: "", priority: 4, url: "https://app.todoist.com/app/task/7" },
  ])
})

test("missing counters are derived from the rows", () => {
  const parsed = view({ count: undefined, overdue: undefined, today: undefined })
  expect(parsed.count).toBe(2)
  expect(parsed.overdue).toBe(1)
  expect(parsed.today).toBe(0)
})

test("the bar shows a count only when connected and there is something to do", () => {
  expect(Model.countLabel(view())).toBe("2")
  expect(Model.countLabel(view({ count: 0, tasks: [] }))).toBe("")
  expect(Model.countLabel(view({ connected: false }))).toBe("")
  expect(Model.countLabel(view({ count: 250 }))).toBe("99+")
})

test("hero and tooltip text follow the state", () => {
  expect(Model.heroMeta(view())).toBe("2 open · 1 overdue")
  expect(Model.heroMeta(view({ overdue: 0, today: 1 }))).toBe("2 open · 1 today")
  expect(Model.heroMeta(view({ count: 0, tasks: [] }))).toBe("All clear")
  expect(Model.heroMeta(view({ fetchedAt: "" }))).toBe("Not synced yet")
  expect(Model.heroMeta(view({ connected: false }))).toBe("Not connected")
  expect(Model.barTooltip(view())).toBe("Todoist · 2 open tasks, 1 overdue")
  expect(Model.barTooltip(view({ count: 1, overdue: 0 }))).toBe("Todoist · 1 open task")
})

test("sync time reads as a clock today and a date otherwise", () => {
  expect(Model.syncedLabel(new Date(2026, 7, 29, 9, 3).toISOString(), now)).toBe("synced 09:03")
  expect(Model.syncedLabel(new Date(2026, 7, 27, 9, 3).toISOString(), now)).toBe("synced 27 Aug")
  expect(Model.syncedLabel("", now)).toBe("")
  expect(Model.syncedLabel("never", now)).toBe("")
})

test("subtitle joins what is there", () => {
  expect(Model.subtitle({ due: "Today", project: "Work" })).toBe("Today · Work")
  expect(Model.subtitle({ due: "", project: "Work" })).toBe("Work")
  expect(Model.subtitle({ due: "", project: "" })).toBe("")
})

test("cursor stays inside the list", () => {
  expect(Model.clampIndex(5, 3)).toBe(2)
  expect(Model.clampIndex(-1, 3)).toBe(0)
  expect(Model.clampIndex(1, 0)).toBe(0)
  expect(Model.taskAt([{ id: "a" }], 0)).toEqual({ id: "a" })
  expect(Model.taskAt([{ id: "a" }], 1)).toBeNull()
})

test("a pending mark survives until the task is gone from the file", () => {
  const pending = Model.withPending({}, "a")
  expect(pending).toEqual({ a: true })
  expect(Model.reconcilePending(pending, view().tasks)).toBe(pending) // same object: nothing to drop
  expect(Model.reconcilePending(pending, view({ tasks: [{ id: "b", title: "x" }] }).tasks)).toEqual({})
})

test("the active filter rides along, with a label for the empty case", () => {
  expect(Model.filterLabel(view({ filter: " today | overdue " }))).toBe("today | overdue")
  expect(Model.filterLabel(view())).toBe("All active tasks")
  expect(Model.filterLabel(view({ filter: 42 }))).toBe("All active tasks")
})

test("a refused filter change rides along, with the suggestion when there is one", () => {
  expect(view().filterError).toBeNull()
  expect(view({ filterError: { query: "todya", message: "nope", suggestion: "today" } }).filterError).toEqual({ query: "todya", message: "nope", suggestion: "today" })
  expect(view({ filterError: { query: "(((", message: "nope", suggestion: null } }).filterError).toEqual({ query: "(((", message: "nope", suggestion: "" })
  expect(view({ filterError: { query: "x", message: "" } }).filterError).toBeNull()
})

test("the projects arrive as picker rows, with the Inbox as the default target", () => {
  const parsed = view({
    projects: [
      { id: "p0", name: "Inbox", inbox: true },
      { id: "p1", name: "  Work  place ", inbox: false },
      { name: "no id" },
      { id: "p3", name: "" },
    ],
  })
  expect(parsed.projects).toEqual([
    { id: "p0", name: "Inbox", inbox: true },
    { id: "p1", name: "Work place", inbox: false },
  ])
  expect(Model.projectOptions(parsed)).toEqual([
    { value: "p0", label: "Inbox" },
    { value: "p1", label: "Work place" },
  ])
  expect(Model.defaultProjectId(parsed)).toBe("p0")
  expect(Model.projectName(parsed, "p1")).toBe("Work place")
  expect(Model.projectName(parsed, "gone")).toBe("")
})

test("a file with no projects leaves the picker empty and the target unset", () => {
  const parsed = view({ projects: "nonsense" })
  expect(parsed.projects).toEqual([])
  expect(Model.defaultProjectId(parsed)).toBe("")
  expect(Model.projectOptions(Model.emptyView())).toEqual([])
  expect(Model.projectName(Model.emptyView(), "p0")).toBe("")
})

test("priority tones", () => {
  expect([1, 2, 3, 4].map(Model.priorityTone)).toEqual(["urgent", "accent", "muted", "none"])
})

// ------------------------------------------------------- a sync that stopped

const FRESH = "2026-08-29T12:00:00.000Z"
const NOW = new Date("2026-08-29T12:05:00.000Z")

function synced(extra = {}) {
  return Model.parseView(JSON.stringify({ connected: true, fetchedAt: FRESH, tasks: [], ...extra }))
}

test("a sync that landed a moment ago says nothing", () => {
  expect(Model.syncWarning(synced(), NOW)).toBeNull()
})

test("nothing is stale before the account is connected", () => {
  expect(Model.syncWarning(Model.parseView("{}"), NOW)).toBeNull()
  // Nor before the very first sync: the hero already reads "Not synced yet".
  expect(Model.syncWarning(synced({ fetchedAt: "" }), NOW)).toBeNull()
})

test("three missed sync runs are worth a line, even with no error to report", () => {
  const warning = Model.syncWarning(synced(), new Date("2026-08-29T12:16:00.000Z"))
  expect(warning.message).toContain("Not synced since")
  expect(warning.reconnect).toBe(false)
  // Two missed runs are a closed lid, not a fault.
  expect(Model.syncWarning(synced(), new Date("2026-08-29T12:14:00.000Z"))).toBeNull()
})

test("a rejected token says so at once, and offers the one thing that fixes it", () => {
  const view = synced({ syncError: { kind: "auth", message: "Todoist rejected the API token.", at: FRESH } })
  const warning = Model.syncWarning(view, NOW)
  expect(warning.message).toBe("Todoist rejected the API token.")
  expect(warning.hint).toContain("Showing tasks from 12:00")
  expect(warning.reconnect).toBe(true)
})

test("a network failure reports itself and keeps the rows it has", () => {
  const view = synced({ syncError: { kind: "offline", message: "Can't reach Todoist.", at: FRESH } })
  const warning = Model.syncWarning(view, NOW)
  expect(warning.message).toBe("Can't reach Todoist.")
  expect(warning.hint).toBe("Showing tasks from 12:00.")
  expect(warning.reconnect).toBe(false)
})

test("a view from another day says the day, not the hour", () => {
  const view = Model.parseView(JSON.stringify({
    connected: true,
    fetchedAt: "2026-08-27T09:00:00.000Z",
    syncError: { kind: "api", message: "Todoist API 500: down", at: FRESH },
    tasks: [],
  }))
  expect(Model.syncWarning(view, NOW).hint).toBe("Showing tasks from 27 Aug.")
})

test("a malformed syncError is dropped rather than shown", () => {
  expect(synced({ syncError: { kind: "auth" } }).syncError).toBeNull()
  expect(synced({ syncError: "broken" }).syncError).toBeNull()
  // An unknown kind still reports, it just does not claim to need a reconnect.
  const odd = synced({ syncError: { kind: "meteor", message: "Something." } })
  expect(odd.syncError.kind).toBe("api")
  expect(Model.syncWarning(odd, NOW).reconnect).toBe(false)
})
