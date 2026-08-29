import { afterEach, expect, test } from "bun:test"
import { fetchTasks } from "../src/todoist"

const realFetch = globalThis.fetch
afterEach(() => {
  globalThis.fetch = realFetch
})

/** Records every URL asked for, and answers with `pages` in order. */
function stubFetch(pages: unknown[]): string[] {
  const seen: string[] = []
  let call = 0
  globalThis.fetch = (async (input: string | URL | Request) => {
    seen.push(String(input instanceof Request ? input.url : input))
    return new Response(JSON.stringify(pages[Math.min(call++, pages.length - 1)]))
  }) as typeof fetch
  return seen
}

test("the caller's max is what the API is asked for, not a hardcoded 200", async () => {
  // Filter validation wants a single task: downloading 200 to learn that a
  // query parses ran on every filter change, from the panel and the menu.
  const seen = stubFetch([{ results: [{ id: "1" }], next_cursor: null }])
  await fetchTasks("t", "today", 1)
  expect(seen).toHaveLength(1)
  expect(new URL(seen[0]!).searchParams.get("limit")).toBe("1")
  expect(new URL(seen[0]!).searchParams.get("query")).toBe("today")
})

test("a large max still asks for whole pages", async () => {
  const seen = stubFetch([{ results: [], next_cursor: null }])
  await fetchTasks("t", "", 1000)
  expect(new URL(seen[0]!).searchParams.get("limit")).toBe("200")
  expect(new URL(seen[0]!).pathname).toEndWith("/tasks")
})

test("a max below one is still a legal request", async () => {
  const seen = stubFetch([{ results: [], next_cursor: null }])
  await fetchTasks("t", "", 0)
  expect(new URL(seen[0]!).searchParams.get("limit")).toBe("1")
})

test("paging continues on a cursor until max is reached", async () => {
  const page = (cursor: string | null) => ({ results: [{ id: "a" }, { id: "b" }], next_cursor: cursor })
  const seen = stubFetch([page("c1"), page("c2"), page(null)])
  const tasks = await fetchTasks("t", "", 5)
  expect(tasks).toHaveLength(6)
  expect(seen).toHaveLength(3)
  expect(new URL(seen[1]!).searchParams.get("cursor")).toBe("c1")
})
