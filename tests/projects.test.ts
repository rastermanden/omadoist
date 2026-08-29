import { expect, test } from "bun:test"
import { choicesFromPairs, inboxId, parseAddArgs, projectChoices, resolveProject } from "../src/projects"
import type { Project } from "../src/todoist"

const rows: Project[] = [
  { id: "p1", name: "Work" },
  { id: "p0", name: "Inbox", inbox_project: true },
  { id: "p2", name: " Livsstil  Hus " },
]

test("the Inbox leads, the account's own order follows, and junk rows are dropped", () => {
  const choices = projectChoices([...rows, { id: "", name: "No id" }, { id: "p3", name: "  " }])
  expect(choices).toEqual([
    { id: "p0", name: "Inbox", inbox: true },
    { id: "p1", name: "Work", inbox: false },
    { id: "p2", name: "Livsstil Hus", inbox: false },
  ])
  expect(inboxId(choices)).toBe("p0")
  expect(inboxId(projectChoices([{ id: "p1", name: "Work" }]))).toBe("")
})

test("the Inbox is recognised by either API spelling, or failing both by its name", () => {
  expect(projectChoices([{ id: "a", name: "Inbox", is_inbox_project: true }])[0]?.inbox).toBe(true)
  expect(projectChoices([{ id: "a", name: "inbox" }])[0]?.inbox).toBe(true)
  expect(projectChoices([{ id: "a", name: "Work" }])[0]?.inbox).toBe(false)
})

test("the cached id → name pairs come back as choices", () => {
  expect(choicesFromPairs([["p1", "Work"], ["p0", "Inbox"]], "p0")).toEqual([
    { id: "p0", name: "Inbox", inbox: true },
    { id: "p1", name: "Work", inbox: false },
  ])
  // Nothing synced, or an inbox id that no longer matches: order stands.
  expect(choicesFromPairs([["p1", "Work"]], "")).toEqual([{ id: "p1", name: "Work", inbox: false }])
  expect(choicesFromPairs([], "p0")).toEqual([])
})

test("--project takes an id, a name, a #name, or an unambiguous start of one", () => {
  const choices = projectChoices(rows)
  expect(resolveProject(choices, "p1")?.name).toBe("Work")
  expect(resolveProject(choices, "work")?.id).toBe("p1")
  expect(resolveProject(choices, "#Work")?.id).toBe("p1")
  expect(resolveProject(choices, "# livsstil hus")?.id).toBe("p2")
  expect(resolveProject(choices, "liv")?.id).toBe("p2")
  expect(resolveProject(choices, "")).toBeNull()
  expect(resolveProject(choices, "Nope")).toBeNull()
})

test("an ambiguous prefix is refused rather than guessed", () => {
  const choices = projectChoices([{ id: "a", name: "House" }, { id: "b", name: "Housing" }])
  expect(resolveProject(choices, "Hous")).toBeNull()
  expect(resolveProject(choices, "House")?.id).toBe("a") // an exact name still wins
})

test("add parses the project option and keeps the title verbatim", () => {
  expect(parseAddArgs(["Buy", "milk"])).toEqual({ project: "", words: ["Buy", "milk"] })
  expect(parseAddArgs(["--project", "Work", "Buy", "milk"])).toEqual({ project: "Work", words: ["Buy", "milk"] })
  expect(parseAddArgs(["-p", " Work ", "Buy"])).toEqual({ project: "Work", words: ["Buy"] })
  expect(parseAddArgs(["--project=Work", "Buy"])).toEqual({ project: "Work", words: ["Buy"] })
  // The panel always ends its options, so a title may start with a dash.
  expect(parseAddArgs(["--project", "p1", "--", "--not", "a", "flag"])).toEqual({
    project: "p1",
    words: ["--not", "a", "flag"],
  })
  expect(parseAddArgs(["--project"])).toEqual({ project: "", words: [] })
})
