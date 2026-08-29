import type { Project } from "./todoist"

/** One project as the pickers show it: the panel dropdown and the menu prompt. */
export type ProjectChoice = { id: string; name: string; inbox: boolean }

// The v1 API answers `inbox_project`; the REST v2 shape this account may still
// be served used `is_inbox_project`. Either one, or the name as a last resort.
function isInbox(project: Project): boolean {
  if (project.inbox_project === true || project.is_inbox_project === true) return true
  return String(project.name ?? "").trim().toLowerCase() === "inbox"
}

/**
 * Inbox first — a new task lands there unless it is told otherwise — then the
 * account's own order. A row without an id or a name is dropped: a picker
 * cannot show it and the API cannot be told about it.
 */
export function projectChoices(projects: Project[]): ProjectChoice[] {
  const choices = projects
    .map((project) => ({
      id: String(project.id ?? "").trim(),
      name: String(project.name ?? "").replace(/\s+/g, " ").trim(),
      inbox: isInbox(project),
    }))
    .filter((choice) => choice.id !== "" && choice.name !== "")

  // Only one project can be the Inbox; a stray second flag stays where it is.
  const inbox = choices.findIndex((choice) => choice.inbox)
  if (inbox <= 0) return choices
  return [choices[inbox]!, ...choices.filter((_, index) => index !== inbox)]
}

/** The cache keeps id → name pairs; the pickers want them back as choices. */
export function choicesFromPairs(pairs: [string, string][], inboxId: string): ProjectChoice[] {
  return projectChoices(
    pairs.map(([id, name]) => ({ id, name, inbox_project: id === inboxId && id !== "" })),
  )
}

export function inboxId(choices: ProjectChoice[]): string {
  return choices.find((choice) => choice.inbox)?.id ?? ""
}

/**
 * What `--project` meant: an id, a name (with or without Todoist's leading
 * `#`), or the unambiguous start of one. Case never matters. Null when the
 * account has nothing like it, so the caller can say so instead of guessing.
 */
export function resolveProject(choices: ProjectChoice[], wanted: string): ProjectChoice | null {
  const query = wanted.trim().replace(/^#\s*/, "").replace(/\s+/g, " ")
  if (query === "") return null

  const byId = choices.find((choice) => choice.id === query)
  if (byId) return byId

  const folded = query.toLowerCase()
  const byName = choices.find((choice) => choice.name.toLowerCase() === folded)
  if (byName) return byName

  const prefixed = choices.filter((choice) => choice.name.toLowerCase().startsWith(folded))
  return prefixed.length === 1 ? prefixed[0]! : null
}

export type AddArgs = { project: string; words: string[] }

/**
 * `add [--project <name|id>] [--] [text…]`. Everything after `--` is the title
 * verbatim, which is how the panel passes a task that starts with a dash.
 */
export function parseAddArgs(args: string[]): AddArgs {
  let project = ""
  const words: string[] = []

  for (let index = 0; index < args.length; index++) {
    const arg = args[index]!
    if (arg === "--") {
      words.push(...args.slice(index + 1))
      break
    }
    if (arg === "--project" || arg === "-p") {
      project = args[++index] ?? ""
      continue
    }
    if (arg.startsWith("--project=")) {
      project = arg.slice("--project=".length)
      continue
    }
    words.push(arg)
  }

  return { project: project.trim(), words }
}
