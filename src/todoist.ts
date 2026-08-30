const API = "https://api.todoist.com/api/v1"
const PAGE_SIZE = 200

export type Due = {
  date?: string
  datetime?: string
  string?: string
  is_recurring?: boolean
}

export type Task = {
  id: string
  content: string
  description?: string
  project_id?: string
  priority?: number // 4 = p1 (highest) … 1 = p4
  child_order?: number
  due?: Due | null
  labels?: string[]
  url?: string
}

export type Project = {
  id: string
  name: string
  /** v1 says `inbox_project`; the older REST shape said `is_inbox_project`. */
  inbox_project?: boolean
  is_inbox_project?: boolean
}

export class TodoistError extends Error {
  constructor(
    message: string,
    readonly status = 0,
    /** Raw response body, for callers that can explain an error better than the API does. */
    readonly body = "",
  ) {
    super(message)
    this.name = "TodoistError"
  }
}

async function request(token: string, path: string, init?: RequestInit): Promise<unknown> {
  let res: Response
  try {
    res = await fetch(API + path, {
      ...init,
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        ...(init?.headers ?? {}),
      },
    })
  } catch (err) {
    throw new TodoistError(`cannot reach api.todoist.com (${err})`)
  }

  if (res.status === 401 || res.status === 403) {
    throw new TodoistError("Todoist rejected the API token — run `omadoist auth` again", res.status)
  }
  if (!res.ok) {
    const body = await res.text()
    throw new TodoistError(`Todoist API ${res.status}: ${body.slice(0, 300)}`, res.status, body)
  }

  const body = await res.text()
  return body ? JSON.parse(body) : null
}

// List endpoints answer `{results, next_cursor}`, but a few deployments still
// hand back a bare array. Accept either.
function rowsOf(payload: unknown): unknown[] {
  if (Array.isArray(payload)) return payload
  const results = (payload as { results?: unknown })?.results
  return Array.isArray(results) ? results : []
}

function cursorOf(payload: unknown): string | null {
  if (Array.isArray(payload)) return null
  const next = (payload as { next_cursor?: unknown })?.next_cursor
  return typeof next === "string" && next ? next : null
}

async function paginate(token: string, path: string, params: Record<string, string>, max: number) {
  const collected: unknown[] = []
  let cursor: string | null = null

  do {
    // Ask for no more than the caller wants: filter validation wants one task,
    // and downloading two hundred to learn that a query parses is the slowest
    // part of every filter change.
    const query = new URLSearchParams({ ...params, limit: String(Math.min(PAGE_SIZE, Math.max(1, max))) })
    if (cursor) query.set("cursor", cursor)
    const payload = await request(token, `${path}?${query}`)
    collected.push(...rowsOf(payload))
    cursor = cursorOf(payload)
  } while (cursor && collected.length < max)

  return collected
}

export async function fetchTasks(token: string, filter: string, max: number): Promise<Task[]> {
  const query = filter.trim()
  const rows = query
    ? await paginate(token, "/tasks/filter", { query }, max)
    : await paginate(token, "/tasks", {}, max)
  return rows as Task[]
}

/** Every project on the account, in the account's own order. */
export async function fetchProjects(token: string): Promise<Project[]> {
  return (await paginate(token, "/projects", {}, 1000)) as Project[]
}

export async function fetchLabels(token: string): Promise<string[]> {
  const rows = (await paginate(token, "/labels", {}, 1000)) as { name?: string }[]
  return rows.map((label) => String(label.name ?? "")).filter(Boolean)
}

export async function closeTask(token: string, id: string): Promise<void> {
  await request(token, `/tasks/${encodeURIComponent(id)}/close`, { method: "POST" })
}

/** The other way: a task closed by mistake comes back where it was. */
export async function reopenTask(token: string, id: string): Promise<void> {
  await request(token, `/tasks/${encodeURIComponent(id)}/reopen`, { method: "POST" })
}

/**
 * Quick Add: the same parser Todoist's own composers use, so "buy milk
 * tomorrow p1 #Hus @errand" arrives as a task with a due date, a priority, a
 * project and a label rather than as that sentence. Anything it cannot parse
 * stays in the title, so a plain sentence is still just a task.
 */
export async function quickAddTask(token: string, text: string): Promise<Task> {
  return (await request(token, "/tasks/quick", {
    method: "POST",
    body: JSON.stringify({ text }),
  })) as Task
}

/**
 * The account's productivity stats: karma, the daily and weekly goals, the
 * streaks, and how many tasks each of the last days closed. Everything the
 * panel's header line shows, in one request. The payload is large and mostly
 * per-project detail, so it arrives unnarrowed and `karmaFromStats` keeps the
 * handful of fields that are drawn.
 */
export async function fetchStats(token: string): Promise<unknown> {
  return await request(token, "/tasks/completed/stats")
}

/** Cheap round-trip used to validate a token before it is written to disk. */
export async function verifyToken(token: string): Promise<void> {
  await request(token, "/tasks?limit=1")
}
