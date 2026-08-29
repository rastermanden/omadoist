import { expect, test } from "bun:test"
import { describeSyncError, parseSyncError } from "../src/sync"
import { TodoistError } from "../src/todoist"

const at = new Date("2026-08-29T12:00:00.000Z")

test("a rejected token is its own kind: waiting will not fix it", () => {
  for (const status of [401, 403]) {
    expect(describeSyncError(new TodoistError("rejected", status), at)).toEqual({
      kind: "auth",
      message: "Todoist rejected the API token.",
      at: "2026-08-29T12:00:00.000Z",
    })
  }
})

test("a request that never left the machine is offline, not an API fault", () => {
  const err = new TodoistError("cannot reach api.todoist.com (TypeError)", 0)
  expect(describeSyncError(err, at)).toMatchObject({ kind: "offline", message: "Can't reach Todoist." })
})

test("anything else is reported in Todoist's own words, trimmed to a line", () => {
  expect(describeSyncError(new TodoistError("Todoist API 500: down", 500), at)).toMatchObject({
    kind: "api",
    message: "Todoist API 500: down",
  })
  expect(describeSyncError(new Error("x".repeat(500)), at).message).toHaveLength(200)
  expect(describeSyncError("something odd", at)).toMatchObject({ kind: "api", message: "something odd" })
  expect(describeSyncError(new Error("  "), at).message).toBe("Sync failed.")
})

test("a reason read back off disk is trusted only as far as it makes sense", () => {
  expect(parseSyncError(null)).toBeNull()
  expect(parseSyncError({ kind: "auth" })).toBeNull()
  expect(parseSyncError({ message: "   " })).toBeNull()
  expect(parseSyncError({ kind: "meteor", message: " Something. " })).toEqual({
    kind: "api",
    message: "Something.",
    at: "",
  })
})
