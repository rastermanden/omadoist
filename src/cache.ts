import { CACHE_DIR, CACHE_FILE } from "./config"
import { ensureDir, writeAtomic } from "./files"
import { parseSyncError, type SyncError } from "./sync"
import type { Task } from "./todoist"

/** The last task this machine completed, so `omadoist undo` knows which one. */
export type Completion = {
  id: string
  title: string
  /**
   * Completing a recurring task advances it to its next due date rather than
   * closing it, so there is nothing for a reopen to put back.
   */
  recurring: boolean
  at: string
}

export type Cache = {
  fetchedAt: string
  tasks: Task[]
  /** Project id → name, as pairs so it survives JSON. Inbox first. */
  projects: [string, string][]
  /** Which of them is the Inbox, where a new task lands by default. */
  inboxProjectId: string
  /**
   * Why the last sync failed, if it did. It lives here rather than only in the
   * bar view so that every later write — `omadoist menu`, a completed task —
   * carries it forward instead of quietly clearing it; only a sync that works
   * sets it back to null.
   */
  lastError: SyncError | null
  /** Cleared once undone, so the same completion cannot be undone twice. */
  lastCompleted: Completion | null
}

export const EMPTY_CACHE: Cache = {
  fetchedAt: "",
  tasks: [],
  projects: [],
  inboxProjectId: "",
  lastError: null,
  lastCompleted: null,
}

function parseCompletion(raw: unknown): Completion | null {
  if (!raw || typeof raw !== "object") return null
  const { id, title, recurring, at } = raw as Partial<Completion>
  if (typeof id !== "string" || id === "") return null
  return {
    id,
    title: typeof title === "string" ? title : "",
    recurring: recurring === true,
    at: typeof at === "string" ? at : "",
  }
}

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
      lastError: parseSyncError(cached.lastError),
      lastCompleted: parseCompletion(cached.lastCompleted),
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
