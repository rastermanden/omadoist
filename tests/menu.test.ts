import { expect, test } from "bun:test"
import { DEFAULT_CONFIG } from "../src/config"
import { buildRows, mergeIntoMenu, removeFromMenu, renderBlock, shellQuote } from "../src/menu"
import type { Task } from "../src/todoist"

const config = { ...DEFAULT_CONFIG }
const projects = new Map([["p1", "Work"]])

function task(id: string, content: string, extra: Partial<Task> = {}): Task {
  return { id, content, project_id: "p1", priority: 1, ...extra }
}

test("every task becomes a row whose action closes that task", () => {
  const rows = buildRows([task("1", "Buy milk"), task("2", "Call plumber")], projects, config)
  const ids = rows.map((row) => row.id)

  expect(ids).toContain("todoist.task-001")
  expect(ids).toContain("todoist.task-002")
  expect(rows.find((row) => row.id === "todoist.task-001")?.entry.action).toBe("omadoist done '1'")
})

test("a task id with a quote cannot break out of the action", () => {
  const rows = buildRows([task("a'b", "Odd id")], projects, config)
  expect(rows[1]?.entry.action).toBe("omadoist done 'a'\\''b'")
  expect(shellQuote("x; rm -rf /")).toBe("'x; rm -rf /'")
})

test("rows are valid JSONC lines with the project in the subtitle", () => {
  const due = { date: new Date().toISOString().slice(0, 10) }
  const block = renderBlock(buildRows([task("1", 'Say "hi"', { due })], projects, config))

  expect(block).toContain('"todoist.task-001"')
  expect(block).toContain('Say \\"hi\\"')
  expect(block).toContain("Today · Work")
  for (const line of block.split("\n").filter((line) => !line.trim().startsWith("//"))) {
    expect(() => JSON.parse(`{${line.replace(/,$/, "")}}`)).not.toThrow()
  }
})

test("the submenu row asks for the icon font, task rows do not", () => {
  const rows = buildRows([task("1", "Buy milk")], projects, config)
  const brand = rows.find((row) => row.id === "todoist")?.entry
  expect(brand?.icon).toBe(DEFAULT_CONFIG.menuIcon)
  expect(brand?.iconFont).toBe("Omadoist Icons")
  expect(rows.find((row) => row.id === "todoist.task-001")?.entry.iconFont).toBeUndefined()
})

test("clearing menuIconFont drops the field instead of writing an empty family", () => {
  const rows = buildRows([task("1", "Buy milk")], projects, { ...config, menuIconFont: "" })
  expect(rows[0]?.entry).not.toHaveProperty("iconFont")
})

test("the filter row shows what the list is filtered by", () => {
  const all = buildRows([task("1", "Buy milk")], projects, config).find((row) => row.id === "todoist.filter")?.entry
  expect(all?.description).toBe("All active tasks")
  expect(all?.action).toBe("omadoist filter --edit")
  const today = buildRows([], projects, { ...config, filter: "today | overdue" }).find((row) => row.id === "todoist.filter")?.entry
  expect(today?.description).toBe("today | overdue")
})

test("an empty list still offers a way back", () => {
  const rows = buildRows([], projects, config)
  expect(rows.map((row) => row.id)).toContain("todoist.empty")
})

test("the block is appended inside the closing brace and hand-written rows survive", () => {
  const source = '{\n  // mine\n  "personal": {"icon":"","label":"Personal"},\n}\n'
  const merged = mergeIntoMenu(source, renderBlock(buildRows([task("1", "Buy milk")], projects, config)))

  expect(merged).toContain('"personal"')
  expect(merged.trimEnd().endsWith("}")).toBe(true)
  expect(merged.indexOf("todoist:begin")).toBeLessThan(merged.lastIndexOf("}"))
})

test("re-syncing replaces the previous block instead of stacking copies", () => {
  const source = '{\n  "personal": {"icon":"","label":"Personal"},\n}\n'
  const first = mergeIntoMenu(source, renderBlock(buildRows([task("1", "Buy milk")], projects, config)))
  const second = mergeIntoMenu(first, renderBlock(buildRows([task("2", "Call plumber")], projects, config)))

  expect(second.match(/omadoist:begin/g)).toHaveLength(1)
  expect(second).toContain("Call plumber")
  expect(second).not.toContain("Buy milk")
  expect(second).toContain('"personal"')
})

test("removing the block leaves the rest of the file behind", () => {
  const source = '{\n  "personal": {"icon":"","label":"Personal"},\n}\n'
  const merged = mergeIntoMenu(source, renderBlock(buildRows([task("1", "Buy milk")], projects, config)))

  expect(removeFromMenu(merged)).toContain('"personal"')
  expect(removeFromMenu(merged)).not.toContain("Buy milk")
})
