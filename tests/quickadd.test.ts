import { expect, test } from "bun:test"
import { hasProjectToken, projectToken, withProject } from "../src/quickadd"

test("a #Project anywhere in the line counts as one", () => {
  expect(hasProjectToken("#Hus")).toBe(true)
  expect(hasProjectToken("buy milk #Hus")).toBe(true)
  expect(hasProjectToken("buy milk #Hus tomorrow p1")).toBe(true)
  expect(hasProjectToken("#My\\ Long\\ Project buy milk")).toBe(true)
})

test("text with no project of its own leaves the question open", () => {
  expect(hasProjectToken("buy milk")).toBe(false)
  expect(hasProjectToken("buy milk tomorrow p1 @errand")).toBe(false)
  expect(hasProjectToken("")).toBe(false)
  // A hash inside a word is part of it, not a project.
  expect(hasProjectToken("ticket QA#12")).toBe(false)
  // A bare hash names nothing.
  expect(hasProjectToken("call # ")).toBe(false)
})

test("a hash in the description is prose", () => {
  expect(hasProjectToken("buy milk // the #2 brand")).toBe(false)
  // The description runs to the end, so a project has to come before it.
  expect(hasProjectToken("buy milk #Hus // the #2 brand")).toBe(true)
})

test("a name is written back the way Quick Add reads it", () => {
  expect(projectToken("Hus")).toBe("Hus")
  expect(projectToken("My Project")).toBe("My\\ Project")
  expect(projectToken("  Spaced  Out  ")).toBe("Spaced\\ Out")
  expect(projectToken("a\\b")).toBe("a\\\\b")
})

test("a project is appended only when the text has not named one", () => {
  expect(withProject("buy milk", "Hus")).toBe("buy milk #Hus")
  expect(withProject("buy milk tomorrow p1", "My Project")).toBe("buy milk tomorrow p1 #My\\ Project")
  // What the user typed wins over the picker's standing selection.
  expect(withProject("buy milk #Arbejde", "Hus")).toBe("buy milk #Arbejde")
  expect(withProject("  padded  ", "Hus")).toBe("padded #Hus")
  expect(withProject("buy milk", "  ")).toBe("buy milk")
})
