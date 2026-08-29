import { afterEach, beforeEach, expect, test } from "bun:test"
import { rm } from "node:fs/promises"
import type { BarView } from "../src/bar"
import { main, normalizeFilter, type Effects } from "../src/cli"
import { BAR_FILE, CACHE_FILE, CONFIG_FILE, MENU_FILE, TOKEN_FILE, saveToken } from "../src/config"

// ------------------------------------------------------------------ harness

type Reply = { status?: number; body?: unknown; text?: string }
type Route = (url: URL, init: RequestInit) => Reply | undefined

const realFetch = globalThis.fetch
const realLog = console.log
const realError = console.error

let requests: { method: string; url: URL; body: string }[] = []
let routes: Route[] = []

/** Answer the first route that recognises the request; anything else is a 404. */
function api(...added: Route[]) {
  routes.push(...added)
}

function get(path: string, reply: Reply): Route {
  return (url, init) => ((init.method ?? "GET") === "GET" && url.pathname === `/api/v1${path}` ? reply : undefined)
}

function post(path: string, reply: Reply): Route {
  return (url, init) => (init.method === "POST" && url.pathname === `/api/v1${path}` ? reply : undefined)
}

/** An Effects that records instead of spawning; `answers` feed the menu prompts. */
function effects(answers: Record<string, { code?: number; stdout?: string }> = {}) {
  const notifications: { title: string; body: string; urgency: string }[] = []
  const commands: string[][] = []
  const fx: Effects = {
    notify(title, body = "", urgency = "low") {
      notifications.push({ title, body, urgency })
    },
    async run(command) {
      commands.push(command)
      const answer = answers[command[0] ?? ""]
      return { code: answer?.code ?? (answer ? 0 : 127), stdout: answer?.stdout ?? "" }
    },
  }
  return { fx, notifications, commands }
}

async function barView(): Promise<BarView> {
  return (await Bun.file(BAR_FILE).json()) as BarView
}

beforeEach(async () => {
  requests = []
  routes = []
  await Promise.all([CONFIG_FILE, CACHE_FILE, BAR_FILE, TOKEN_FILE, MENU_FILE].map((file) => rm(file, { force: true })))

  globalThis.fetch = (async (input: string | URL | Request, init: RequestInit = {}) => {
    const url = new URL(String(input))
    requests.push({ method: init.method ?? "GET", url, body: String(init.body ?? "") })
    for (const route of routes) {
      const reply = route(url, init)
      if (!reply) continue
      const text = reply.text ?? (reply.body === undefined ? "" : JSON.stringify(reply.body))
      return new Response(text, { status: reply.status ?? 200 })
    }
    return new Response(`no stub for ${init.method ?? "GET"} ${url.pathname}`, { status: 404 })
  }) as typeof fetch

  console.log = () => {}
  console.error = () => {}
})

afterEach(() => {
  globalThis.fetch = realFetch
  console.log = realLog
  console.error = realError
})

const TASK = { id: "1", content: "Water the plants", project_id: "p1", priority: 1 }
const PROJECTS = [
  { id: "p0", name: "Inbox", inbox_project: true },
  { id: "p1", name: "Work" },
]

function connected(tasks: unknown[] = [TASK]) {
  api(get("/tasks", { body: { results: tasks } }), get("/tasks/filter", { body: { results: tasks } }), get("/projects", { body: { results: PROJECTS } }))
}

// -------------------------------------------------------------- normalizeFilter

test("the words that mean “no filter” all reach the same empty query", () => {
  for (const input of ["", "   ", "*", "all", "ALL", " All "]) expect(normalizeFilter(input)).toBe("")
})

test("a real query keeps its shape, minus the surrounding space", () => {
  expect(normalizeFilter("  today | overdue  ")).toBe("today | overdue")
  expect(normalizeFilter("#All Hands")).toBe("#All Hands")
  expect(normalizeFilter("all today")).toBe("all today")
})

// -------------------------------------------------------------------- dispatch

test("help exits 0 and an unknown command exits 2", async () => {
  const { fx } = effects()
  expect(await main(["help"], fx)).toBe(0)
  expect(await main([], fx)).toBe(0)
  expect(await main(["frobnicate"], fx)).toBe(2)
})

test("a failed command exits 1, and the ones the user asked for say so out loud", async () => {
  const { fx, notifications } = effects()
  await saveToken("tok")
  api(post("/tasks/1/close", { status: 500, text: "boom" }))

  expect(await main(["done", "1"], fx)).toBe(1)
  expect(notifications).toHaveLength(1)
  expect(notifications[0]).toMatchObject({ title: "Todoist failed", urgency: "critical" })
})

test("a failing sync stays quiet: it runs on a timer, not on a keypress", async () => {
  const { fx, notifications } = effects()
  await saveToken("tok")
  api(get("/tasks", { status: 500, text: "boom" }))

  expect(await main(["sync"], fx)).toBe(1)
  expect(notifications).toEqual([])
})

// ------------------------------------------------------------------------ sync

test("without a token sync is not an error — it publishes a disconnected view", async () => {
  const { fx } = effects()
  expect(await main(["sync"], fx)).toBe(0)

  const view = await barView()
  expect(view.connected).toBe(false)
  expect(view.tasks).toEqual([])
  expect(await Bun.file(MENU_FILE).text()).toContain("omadoist:begin")
  expect(requests).toEqual([])
})

test("sync writes the cache, the bar view and the menu block together", async () => {
  const { fx } = effects()
  await saveToken("tok")
  connected()

  expect(await main(["sync"], fx)).toBe(0)

  const view = await barView()
  expect(view.connected).toBe(true)
  expect(view.tasks.map((row) => row.title)).toEqual(["Water the plants"])
  expect(view.tasks[0]!.project).toBe("Work")
  // Inbox first, so the panel's picker opens on the default target.
  expect(view.projects.map((choice) => choice.id)).toEqual(["p0", "p1"])
  expect(await Bun.file(MENU_FILE).text()).toContain("Water the plants")
  expect((await Bun.file(CACHE_FILE).json()).tasks).toHaveLength(1)
})

test("--open summons the menu", async () => {
  const { fx, commands } = effects()
  await saveToken("tok")
  connected()
  await main(["sync", "--open"], fx)
  expect(commands).toEqual([["omarchy-menu", "summon", "todoist"]])
})

test("a task completed elsewhere is news; the first sync of all is not", async () => {
  const { fx, notifications } = effects()
  await saveToken("tok")
  connected([TASK, { id: "2", content: "Call the dentist" }])

  await main(["sync"], fx)
  expect(notifications).toEqual([]) // nothing to compare against yet

  routes = []
  connected([TASK])
  await main(["sync"], fx)
  expect(notifications).toHaveLength(1)
  expect(notifications[0]!.body).toContain("Call the dentist")
})

test("a task completed here is not reported back as news", async () => {
  const { fx, notifications } = effects()
  await saveToken("tok")
  connected([TASK, { id: "2", content: "Call the dentist" }])
  await main(["sync"], fx)

  routes = []
  connected([TASK])
  api(post("/tasks/2/close", {}))
  expect(await main(["done", "2"], fx)).toBe(0)

  expect(notifications).toEqual([])
  expect((await barView()).tasks.map((row) => row.id)).toEqual(["1"])
})

test("done needs an id", async () => {
  const { fx } = effects()
  expect(await main(["done"], fx)).toBe(1)
  expect(requests).toEqual([])
})

// ------------------------------------------------------------------------- add

test("--project resolves against the cached projects, without a fresh fetch", async () => {
  const { fx } = effects()
  await saveToken("tok")
  connected()
  await main(["sync"], fx)

  requests = []
  api(post("/tasks", { body: { id: "7", content: "Ship it" } }))
  expect(await main(["add", "--project", "wo", "Ship", "it"], fx)).toBe(0)

  expect(JSON.parse(requests[0]!.body)).toEqual({ content: "Ship it", project_id: "p1" })
})

test("a project made since the last sync is worth one fresh look", async () => {
  const { fx } = effects()
  await saveToken("tok")
  connected()
  await main(["sync"], fx)

  requests = []
  routes = []
  api(
    get("/projects", { body: { results: [...PROJECTS, { id: "p2", name: "Garden" }] } }),
    post("/tasks", { body: { id: "8" } }),
    get("/tasks", { body: { results: [] } }),
    get("/tasks/filter", { body: { results: [] } }),
  )
  expect(await main(["add", "--project", "Garden", "Sow", "beans"], fx)).toBe(0)

  const created = requests.find((request) => request.method === "POST")!
  expect(JSON.parse(created.body)).toEqual({ content: "Sow beans", project_id: "p2" })
})

test("a project name nothing matches is refused rather than filed anywhere", async () => {
  const { fx } = effects()
  await saveToken("tok")
  connected()
  await main(["sync"], fx)

  requests = []
  expect(await main(["add", "--project", "Atlantis", "Sink"], fx)).toBe(1)
  expect(requests.some((request) => request.method === "POST")).toBe(false)
})

test("no text on the command line asks for both the text and the project", async () => {
  const { fx, commands } = effects({
    "omarchy-menu-input": { stdout: "Buy milk\n" },
    "omarchy-menu-select": { stdout: "Work\tsubtitle\n" },
  })
  await saveToken("tok")
  connected()
  await main(["sync"], fx)

  requests = []
  api(post("/tasks", { body: { id: "9" } }))
  expect(await main(["add"], fx)).toBe(0)

  expect(commands.map((command) => command[0])).toEqual(["omarchy-menu-input", "omarchy-menu-select"])
  expect(JSON.parse(requests[0]!.body)).toEqual({ content: "Buy milk", project_id: "p1" })
})

test("cancelling either prompt adds nothing", async () => {
  await saveToken("tok")
  connected()
  const seed = effects()
  await main(["sync"], seed.fx)

  requests = []
  const noText = effects({ "omarchy-menu-input": { code: 1 } })
  expect(await main(["add"], noText.fx)).toBe(0)

  const noProject = effects({
    "omarchy-menu-input": { stdout: "Buy milk" },
    "omarchy-menu-select": { code: 1 },
  })
  expect(await main(["add"], noProject.fx)).toBe(0)
  expect(requests.some((request) => request.method === "POST")).toBe(false)
})

test("a shell with no picker files the task in the Inbox rather than failing", async () => {
  // Only the text prompt answers; omarchy-menu-select is missing (code 127).
  const { fx } = effects({ "omarchy-menu-input": { stdout: "Buy milk" } })
  await saveToken("tok")
  connected()
  await main(["sync"], fx)

  requests = []
  api(post("/tasks", { body: { id: "9" } }))
  expect(await main(["add"], fx)).toBe(0)
  expect(JSON.parse(requests[0]!.body)).toEqual({ content: "Buy milk" })
})

test("a machine with no menu at all cannot be asked for the text, and says so", async () => {
  // Nothing answers: omarchy-menu-input is not installed either (code 127).
  const { fx } = effects()
  await saveToken("tok")
  connected()
  await main(["sync"], fx)

  requests = []
  expect(await main(["add"], fx)).toBe(1)
  expect(requests.some((request) => request.method === "POST")).toBe(false)
})

test("filter --edit without the menu points at the arguments instead", async () => {
  const { fx } = effects()
  await saveToken("tok")
  connected()

  expect(await main(["filter", "--edit"], fx)).toBe(1)
  expect(await Bun.file(CONFIG_FILE).exists()).toBe(false)
})

test("an account with only an Inbox is not asked about", async () => {
  const { fx, commands } = effects({ "omarchy-menu-input": { stdout: "Buy milk" } })
  await saveToken("tok")
  api(
    get("/tasks", { body: { results: [] } }),
    get("/tasks/filter", { body: { results: [] } }),
    get("/projects", { body: { results: [PROJECTS[0]] } }),
  )
  await main(["sync"], fx)

  requests = []
  api(post("/tasks", { body: { id: "9" } }))
  expect(await main(["add"], fx)).toBe(0)
  expect(commands.map((command) => command[0])).toEqual(["omarchy-menu-input"])
  expect(JSON.parse(requests[0]!.body)).toEqual({ content: "Buy milk", project_id: "p0" })
})

// ---------------------------------------------------------------------- filter

test("filter with no arguments prints the current one and changes nothing", async () => {
  const { fx } = effects()
  expect(await main(["filter"], fx)).toBe(0)
  expect(await Bun.file(CONFIG_FILE).exists()).toBe(false)
})

test("a query Todoist accepts lands in the config and re-syncs", async () => {
  const { fx, notifications } = effects()
  await saveToken("tok")
  connected()

  expect(await main(["filter", "today", "|", "overdue"], fx)).toBe(0)

  expect((await Bun.file(CONFIG_FILE).json()).filter).toBe("today | overdue")
  expect((await barView()).filter).toBe("today | overdue")
  expect(notifications[0]).toMatchObject({ title: "Todoist filter", body: "today | overdue" })
  // The whole list turning over after a filter change is not remote news.
  expect(notifications).toHaveLength(1)
})

test("a query Todoist refuses is explained in the bar view and never saved", async () => {
  const { fx, notifications } = effects()
  await saveToken("tok")
  api(
    get("/tasks/filter", { status: 400, text: "the search query is incorrect" }),
    get("/labels", { body: { results: [] } }),
  )

  expect(await main(["filter", "todya"], fx)).toBe(1)

  expect(await Bun.file(CONFIG_FILE).exists()).toBe(false)
  const view = await barView()
  expect(view.filter).toBe("")
  expect(view.filterError?.query).toBe("todya")
  expect(view.filterError?.suggestion).toBe("today")
  expect(notifications[0]!.urgency).toBe("normal")
})

test("backing out of a refused query clears the explanation", async () => {
  const { fx } = effects()
  await saveToken("tok")
  api(
    get("/tasks/filter", { status: 400, text: "the search query is incorrect" }),
    get("/labels", { body: { results: [] } }),
  )
  await main(["filter", "todya"], fx)
  expect((await barView()).filterError).not.toBeNull()

  // "all" normalises to the empty filter, which is what the config already has.
  expect(await main(["filter", "all"], fx)).toBe(0)
  expect((await barView()).filterError).toBeNull()
})

test("a filter naming a project the account does not have is set, with a nudge", async () => {
  const { fx, notifications } = effects()
  await saveToken("tok")
  connected()
  await main(["sync"], fx)
  api(get("/labels", { body: { results: [] } }))

  expect(await main(["filter", "#Wrok"], fx)).toBe(0)

  expect((await Bun.file(CONFIG_FILE).json()).filter).toBe("#Wrok")
  expect(notifications.at(-1)!.body).toContain("#Work")
})

test("--edit asks through the menu, and a cancelled prompt changes nothing", async () => {
  await saveToken("tok")
  connected()

  const cancelled = effects({ "omarchy-menu-input": { code: 1, stdout: "" } })
  expect(await main(["filter", "--edit"], cancelled.fx)).toBe(0)
  expect(await Bun.file(CONFIG_FILE).exists()).toBe(false)

  const answered = effects({ "omarchy-menu-input": { stdout: "  overdue \n" } })
  expect(await main(["filter", "--edit"], answered.fx)).toBe(0)
  expect((await Bun.file(CONFIG_FILE).json()).filter).toBe("overdue")
})

test("--clear puts the filter back to every active task", async () => {
  const { fx } = effects()
  await saveToken("tok")
  connected()
  await main(["filter", "overdue"], fx)

  expect(await main(["filter", "--clear"], fx)).toBe(0)
  expect((await Bun.file(CONFIG_FILE).json()).filter).toBe("")
})

test("setting the filter it already has rewrites the view without a round trip", async () => {
  const { fx } = effects()
  await saveToken("tok")
  connected()
  await main(["filter", "overdue"], fx)

  requests = []
  expect(await main(["filter", "overdue"], fx)).toBe(0)
  expect(requests).toEqual([])
  expect((await barView()).filter).toBe("overdue")
})

test("changing the filter without a token is refused before anything is written", async () => {
  const { fx } = effects()
  expect(await main(["filter", "today"], fx)).toBe(1)
  expect(await Bun.file(CONFIG_FILE).exists()).toBe(false)
})

// ----------------------------------------------------------------- menu, list

test("menu rewrites the block from the cache alone", async () => {
  const { fx } = effects()
  await saveToken("tok")
  connected()
  await main(["sync"], fx)

  requests = []
  expect(await main(["menu"], fx)).toBe(0)
  expect(requests).toEqual([])
  expect(await Bun.file(MENU_FILE).text()).toContain("Water the plants")
})

test("unlink-menu takes the generated block back out", async () => {
  const { fx } = effects()
  await saveToken("tok")
  connected()
  await main(["sync"], fx)

  expect(await main(["unlink-menu"], fx)).toBe(0)
  expect(await Bun.file(MENU_FILE).text()).not.toContain("omadoist:begin")
})

test("list and status read the cache and never the network", async () => {
  const { fx } = effects()
  await saveToken("tok")
  connected()
  await main(["sync"], fx)

  requests = []
  expect(await main(["list"], fx)).toBe(0)
  expect(await main(["status"], fx)).toBe(0)
  expect(requests).toEqual([])
})
