import { CACHE_DIR, CACHE_FILE } from "./config"
import { ensureDir, writeAtomic } from "./files"
import type { Task } from "./todoist"

export type Cache = {
  fetchedAt: string
  tasks: Task[]
  /** Project id → name, as pairs so it survives JSON. Inbox first. */
  projects: [string, string][]
  /** Which of them is the Inbox, where a new task lands by default. */
  inboxProjectId: string
}

export const EMPTY_CACHE: Cache = { fetchedAt: "", tasks: [], projects: [], inboxProjectId: "" }

export async function loadCache(): Promise<Cache> {
  const file = Bun.file(CACHE_FILE)
  if (!(await file.exists())) return { ...EMPTY_CACHE }
  try {
    const cached = (await file.json()) as Partial<Cache>
    return {
      fetchedAt: cached.fetchedAt ?? "",
      tasks: Array.isArray(cached.tasks) ? cached.tasks : [],
      projects: Array.isArray(cached.projects) ? cached.projects : [],
      inboxProjectId: typeof cached.inboxProjectId === "string" ? cached.inboxProjectId : "",
    }
  } catch {
    return { ...EMPTY_CACHE }
  }
}

// The cache holds every task title, due date and project name the filter
// matches, so it is written as privately as the token that fetched it — and
// atomically, since a sync, a `done` and a filter change can all publish at
// once and a half-written file reads as no tasks at all.
export async function saveCache(cache: Cache): Promise<void> {
  await ensureDir(CACHE_DIR)
  await writeAtomic(CACHE_FILE, JSON.stringify(cache), 0o600)
}
