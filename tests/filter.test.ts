import { expect, test } from "bun:test"
import { apiReason, closest, diagnoseFilter, friendlyFilterError, normalizeFilter } from "../src/filter"

const ctx = { projects: ["Inbox", "Livsstil Hus", "Ødegård Septima"], labels: ["errand", "waiting"] }

test("misspelled keywords are corrected term by term, operators untouched", () => {
  expect(diagnoseFilter("todya | overdeu", ctx).suggestion).toBe("today | overdue")
  expect(diagnoseFilter("(tomorow & !recuring) | nex 7 days", ctx).suggestion).toBe("(tomorrow & !recurring) | next 7 days")
})

test("a valid query yields no suggestion and no unknowns", () => {
  for (const query of ["today | overdue", "next 7 days & #Inbox", "p1", "priority 2", "search: milk", "due before: Aug 30", "no date", "@errand", "-7 days", "##Livsstil Hus", "/Kitchen", "!subtask"]) {
    expect(diagnoseFilter(query, ctx)).toEqual({ unknown: [], suggestion: null })
  }
})

test("projects and labels are matched against the account", () => {
  expect(diagnoseFilter("#inbox", ctx).suggestion).toBeNull() // case-insensitive exact
  expect(diagnoseFilter("#Livstil Hus | @errands", ctx).suggestion).toBe("#Livsstil Hus | @errand")
  expect(diagnoseFilter("#Nope", ctx).unknown).toEqual(["#Nope"])
  // Without a project list there is nothing to judge against.
  expect(diagnoseFilter("#Nope", { projects: [], labels: [] })).toEqual({ unknown: [], suggestion: null })
})

test("words where Todoist wants symbols", () => {
  expect(diagnoseFilter("today or overdue", ctx).suggestion).toBe("today | overdue")
  expect(diagnoseFilter("today and not subtask", ctx).suggestion).toBe("today & !subtask")
  expect(diagnoseFilter("search: not milk", ctx).suggestion).toBeNull()
})

test("priorities and prefixes", () => {
  expect(diagnoseFilter("p 1", ctx).suggestion).toBe("p1")
  expect(diagnoseFilter("priority1", ctx).suggestion).toBe("priority 1")
  expect(diagnoseFilter("p7", ctx).unknown).toEqual(["p7"])
  expect(diagnoseFilter("du before: May 5", ctx).suggestion).toBe("due before: May 5")
  expect(diagnoseFilter("serch: milk", ctx).suggestion).toBe("search: milk")
})

test("garbage is reported as unknown rather than guessed", () => {
  expect(diagnoseFilter("(((", ctx)).toEqual({ unknown: [], suggestion: null })
  expect(diagnoseFilter("bananas", ctx)).toEqual({ unknown: ["bananas"], suggestion: null })
  expect(closest("xyz", ["today"])).toBeNull()
})

test("messages read like a person wrote them", () => {
  expect(friendlyFilterError("todya", diagnoseFilter("todya", ctx))).toBe("“todya” isn't a valid Todoist filter. Did you mean “today”?")
  expect(friendlyFilterError("bananas", diagnoseFilter("bananas", ctx))).toBe(
    "“bananas” isn't a valid Todoist filter. Todoist doesn't know “bananas”. Try today, overdue, next 7 days, p1, #Project, @label or search: text.",
  )
  expect(friendlyFilterError("(((", diagnoseFilter("(((", ctx), "The search query is incorrect")).toBe(
    "“(((” isn't a valid Todoist filter. Todoist says: The search query is incorrect. Try today, overdue, next 7 days, p1, #Project, @label or search: text.",
  )
})

test("the API reason is pulled out of the error body", () => {
  expect(apiReason('{"error":"The search query is incorrect","error_code":55}')).toBe("The search query is incorrect")
  expect(apiReason("not json")).toBe("")
  expect(apiReason(undefined)).toBe("")
})

// ------------------------------------------------------------ normalizeFilter

test("the words that mean “no filter” all reach the same empty query", () => {
  for (const input of ["", "   ", "*", "all", "ALL", " All "]) expect(normalizeFilter(input)).toBe("")
})

test("a real query keeps its shape, minus the surrounding space", () => {
  expect(normalizeFilter("  today | overdue  ")).toBe("today | overdue")
  expect(normalizeFilter("#All Hands")).toBe("#All Hands")
  expect(normalizeFilter("all today")).toBe("all today")
})
