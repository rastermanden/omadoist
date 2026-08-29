import { TodoistError } from "./todoist"

/**
 * Why the last sync did not land. Without this a failed sync is invisible: the
 * process exits 1 into the journal, bar.json is not rewritten, and the panel
 * goes on showing yesterday's tasks as though they were today's.
 */
export type SyncError = {
  /**
   * `auth` will not fix itself — the token has to be replaced. `offline` and
   * `api` are worth waiting another five minutes for.
   */
  kind: "auth" | "offline" | "api"
  /** One sentence, for the panel and the menu; not a stack trace. */
  message: string
  /** When it failed, ISO. The last sync that worked is the view's fetchedAt. */
  at: string
}

const KINDS: SyncError["kind"][] = ["auth", "offline", "api"]

// Long enough for an API message to be useful, short enough for a panel line.
const MAX_MESSAGE = 200

export function describeSyncError(err: unknown, at = new Date()): SyncError {
  const stamp = at.toISOString()
  if (err instanceof TodoistError) {
    if (err.status === 401 || err.status === 403) {
      return { kind: "auth", message: "Todoist rejected the API token.", at: stamp }
    }
    // Status 0 is this machine's side of it: no network, DNS, a captive portal.
    if (err.status === 0) return { kind: "offline", message: "Can't reach Todoist.", at: stamp }
  }
  const message = (err instanceof Error ? err.message : String(err)).trim()
  return { kind: "api", message: message.slice(0, MAX_MESSAGE) || "Sync failed.", at: stamp }
}

/** The same shape back off disk, or null when there is nothing to report. */
export function parseSyncError(raw: unknown): SyncError | null {
  if (!raw || typeof raw !== "object") return null
  const { kind, message, at } = raw as Partial<SyncError>
  if (typeof message !== "string" || message.trim() === "") return null
  return {
    kind: KINDS.includes(kind as SyncError["kind"]) ? (kind as SyncError["kind"]) : "api",
    message: message.trim(),
    at: typeof at === "string" ? at : "",
  }
}
