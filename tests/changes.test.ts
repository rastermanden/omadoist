import { expect, test } from "bun:test"
import { describeChanges, diffTasks } from "../src/changes"
import type { Task } from "../src/todoist"

function task(id: string, content = `task ${id}`): Task {
  return { id, content }
}

test("tasks that appeared or vanished between syncs are reported", () => {
  const changes = diffTasks([task("a"), task("b")], [task("b"), task("c")])
  expect(changes.added.map((t) => t.id)).toEqual(["c"])
  expect(changes.removed.map((t) => t.id)).toEqual(["a"])
})

test("ids this machine just acted on are not news", () => {
  // `done a` pruned a from the cache but the API still listed it for a moment;
  // `add c` created c and the sync sees it for the first time.
  const changes = diffTasks([task("b")], [task("a"), task("b"), task("c")], ["a", "c"])
  expect(changes.added).toEqual([])
  expect(changes.removed).toEqual([])
})

test("nothing changed means no notification", () => {
  expect(describeChanges(diffTasks([task("a")], [task("a")]))).toBeNull()
})

test("the summary names what happened and lists the tasks", () => {
  const summary = describeChanges(diffTasks([task("a", "Ring mor")], [task("b", "Køb ris"), task("c", "Vask bil")]))
  expect(summary).toEqual({ title: "Todoist · 2 new, 1 done", body: "✓ Ring mor\n+ Køb ris\n+ Vask bil" })
  expect(describeChanges(diffTasks([task("a", "Ring mor")], []))?.title).toBe("Todoist · 1 done")
})

test("a flood is truncated", () => {
  const many = Array.from({ length: 8 }, (_, i) => task(`t${i}`, `Task ${i}`))
  const summary = describeChanges(diffTasks([], many))
  expect(summary?.body.split("\n")).toHaveLength(6)
  expect(summary?.body.endsWith("… and 3 more")).toBe(true)
})
