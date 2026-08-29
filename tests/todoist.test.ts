import { afterEach, expect, test } from "bun:test"
import {
  closeTask,
  createTask,
  fetchLabels,
  fetchProjects,
  fetchTasks,
  TodoistError,
  verifyToken,
} from "../src/todoist"

const realFetch = globalThis.fetch
afterEach(() => {
  globalThis.fetch = realFetch
})

type Call = { url: URL; init: RequestInit }

/** Answer every request with the next reply in the queue, remembering the call. */
function stub(replies: (Response | (() => Response | Promise<Response>))[]): Call[] {
  const calls: Call[] = []
  let index = 0
  globalThis.fetch = (async (input: string | URL | Request, init: RequestInit = {}) => {
    calls.push({ url: new URL(String(input)), init })
    const reply = replies[Math.min(index++, replies.length - 1)]
    if (!reply) throw new Error("stub ran out of replies")
    return typeof reply === "function" ? await reply() : reply.clone()
  }) as typeof fetch
  return calls
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } })
}

// ------------------------------------------------------------------ requests

test("the token rides along as a bearer header", async () => {
  const calls = stub([json({ results: [] })])
  await fetchProjects("tok")
  expect(new Headers(calls[0]!.init.headers).get("Authorization")).toBe("Bearer tok")
})

test("a filter goes to /tasks/filter, no filter to /tasks", async () => {
  let calls = stub([json({ results: [{ id: "1", content: "a" }] })])
  expect(await fetchTasks("tok", "  today | overdue  ", 100)).toEqual([{ id: "1", content: "a" }] as never)
  expect(calls[0]!.url.pathname).toBe("/api/v1/tasks/filter")
  expect(calls[0]!.url.searchParams.get("query")).toBe("today | overdue")

  calls = stub([json({ results: [] })])
  await fetchTasks("tok", "   ", 100)
  expect(calls[0]!.url.pathname).toBe("/api/v1/tasks")
  expect(calls[0]!.url.searchParams.has("query")).toBe(false)
})

// --------------------------------------------------------------- pagination

test("pages are followed with the cursor the previous page handed back", async () => {
  const calls = stub([
    json({ results: [{ id: "1" }, { id: "2" }], next_cursor: "page-2" }),
    json({ results: [{ id: "3" }], next_cursor: null }),
  ])

  const tasks = await fetchTasks("tok", "", 100)

  expect(tasks.map((task) => task.id)).toEqual(["1", "2", "3"])
  expect(calls).toHaveLength(2)
  expect(calls[0]!.url.searchParams.has("cursor")).toBe(false)
  expect(calls[1]!.url.searchParams.get("cursor")).toBe("page-2")
})

test("paging continues on a cursor until max is reached", async () => {
  const page = (cursor: string | null) => json({ results: [{ id: "a" }, { id: "b" }], next_cursor: cursor })
  const calls = stub([page("c1"), page("c2"), page(null)])

  expect(await fetchTasks("tok", "", 5)).toHaveLength(6)
  expect(calls).toHaveLength(3)
  expect(calls[1]!.url.searchParams.get("cursor")).toBe("c1")
})

test("the caller's max is what the API is asked for, not a hardcoded 200", async () => {
  // Filter validation wants a single task: downloading 200 to learn that a
  // query parses ran on every filter change, from the panel and the menu.
  const calls = stub([json({ results: [{ id: "1" }], next_cursor: null })])
  await fetchTasks("tok", "today", 1)
  expect(calls).toHaveLength(1)
  expect(calls[0]!.url.searchParams.get("limit")).toBe("1")
  expect(calls[0]!.url.searchParams.get("query")).toBe("today")
})

test("a large max still asks for whole pages", async () => {
  const calls = stub([json({ results: [], next_cursor: null })])
  await fetchTasks("tok", "", 1000)
  expect(calls[0]!.url.searchParams.get("limit")).toBe("200")
  expect(calls[0]!.url.pathname).toEndWith("/tasks")
})

test("a max below one is still a legal request", async () => {
  const calls = stub([json({ results: [], next_cursor: null })])
  await fetchTasks("tok", "", 0)
  expect(calls[0]!.url.searchParams.get("limit")).toBe("1")
})

test("paging stops once max rows are in hand, cursor or not", async () => {
  const calls = stub([json({ results: [{ id: "1" }, { id: "2" }], next_cursor: "more" })])
  expect(await fetchTasks("tok", "", 2)).toHaveLength(2)
  expect(calls).toHaveLength(1)
})

test("a bare array is accepted as one and only page", async () => {
  const calls = stub([json([{ id: "1", content: "a" }])])
  expect(await fetchTasks("tok", "", 100)).toEqual([{ id: "1", content: "a" }] as never)
  expect(calls).toHaveLength(1)
})

test("a payload that is neither shape reads as no rows", async () => {
  stub([json({ nothing: true })])
  expect(await fetchTasks("tok", "", 100)).toEqual([])
})

test("an empty next_cursor ends the paging rather than repeating the page", async () => {
  const calls = stub([json({ results: [{ id: "1" }], next_cursor: "" })])
  expect(await fetchTasks("tok", "", 100)).toHaveLength(1)
  expect(calls).toHaveLength(1)
})

// ------------------------------------------------------------------- errors

for (const status of [401, 403]) {
  test(`${status} says to run auth again, and carries the status`, async () => {
    stub([json({ error: "nope" }, status)])
    const err = (await fetchProjects("bad").catch((e) => e)) as TodoistError
    expect(err).toBeInstanceOf(TodoistError)
    expect(err.status).toBe(status)
    expect(err.message).toContain("omadoist auth")
  })
}

test("400 keeps the raw body, which is how a bad filter is explained", async () => {
  stub([new Response("the search query is incorrect", { status: 400 })])
  const err = (await fetchTasks("tok", "todya", 1).catch((e) => e)) as TodoistError
  expect(err.status).toBe(400)
  expect(err.body).toBe("the search query is incorrect")
  expect(err.message).toContain("Todoist API 400")
})

test("a very long error body is trimmed in the message but kept whole in body", async () => {
  const body = "x".repeat(500)
  stub([new Response(body, { status: 500 })])
  const err = (await fetchProjects("tok").catch((e) => e)) as TodoistError
  expect(err.body).toHaveLength(500)
  expect(err.message.length).toBeLessThan(360)
})

test("an unreachable host is a TodoistError, not a raw fetch failure", async () => {
  stub([
    () => {
      throw new TypeError("Unable to connect")
    },
  ])
  const err = (await fetchProjects("tok").catch((e) => e)) as TodoistError
  expect(err).toBeInstanceOf(TodoistError)
  expect(err.status).toBe(0)
  expect(err.message).toContain("cannot reach api.todoist.com")
})

// ------------------------------------------------------------------ writes

test("createTask posts the content, and a project only when there is one", async () => {
  let calls = stub([json({ id: "9", content: "buy milk" })])
  const task = await createTask("tok", "buy milk", "p1")
  expect(task.id).toBe("9")
  expect(calls[0]!.url.pathname).toBe("/api/v1/tasks")
  expect(calls[0]!.init.method).toBe("POST")
  expect(JSON.parse(String(calls[0]!.init.body))).toEqual({ content: "buy milk", project_id: "p1" })

  calls = stub([json({ id: "10" })])
  await createTask("tok", "buy milk")
  expect(JSON.parse(String(calls[0]!.init.body))).toEqual({ content: "buy milk" })
})

test("closeTask posts to the task's close endpoint with the id escaped", async () => {
  const calls = stub([new Response("", { status: 204 })])
  await closeTask("tok", "6X/7")
  expect(calls[0]!.url.pathname).toBe("/api/v1/tasks/6X%2F7/close")
  expect(calls[0]!.init.method).toBe("POST")
})

test("labels come back as names, and the nameless ones are dropped", async () => {
  stub([json({ results: [{ name: "errand" }, { name: "" }, {}, { name: "home" }] })])
  expect(await fetchLabels("tok")).toEqual(["errand", "home"])
})

test("verifyToken asks for a single task and throws on a rejected token", async () => {
  const calls = stub([json({ results: [] })])
  await verifyToken("tok")
  expect(calls[0]!.url.pathname).toBe("/api/v1/tasks")
  expect(calls[0]!.url.searchParams.get("limit")).toBe("1")

  stub([json({}, 401)])
  expect(verifyToken("bad")).rejects.toThrow(TodoistError)
})
