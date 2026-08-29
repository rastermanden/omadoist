// Plain-language help for a Todoist filter Todoist rejected. Todoist only says
// "the search query is incorrect"; this works out which term it choked on and
// what was probably meant, so the notification can say "did you mean …".

// "all" and "*" mean no filter: the menu prompt cannot hand back an empty
// string, and both read naturally on the command line too.
export function normalizeFilter(query: string): string {
  const text = query.trim()
  return text === "" || text === "*" || text.toLowerCase() === "all" ? "" : text
}

export type FilterContext = { projects: string[]; labels: string[] }
export type FilterDiagnosis = { unknown: string[]; suggestion: string | null }
export type FilterError = { query: string; message: string; suggestion: string | null }

const KEYWORDS = [
  "today", "tomorrow", "yesterday", "overdue", "recurring", "subtask", "shared", "assigned",
  "no date", "no due date", "no time", "no labels", "no deadline", "no priority",
  "next 7 days", "next 30 days", "this week", "next week", "last week", "next month",
  "monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday",
]

// Terms that take a value after a colon: "due before: May 5", "search: milk".
const PREFIXES = [
  "due", "due before", "due after", "date", "date before", "date after",
  "deadline", "deadline before", "deadline after",
  "created", "created before", "created after", "added", "added before", "added after",
  "search", "assigned to", "assigned by", "workspace",
]

const HINT = "Try today, overdue, next 7 days, p1, #Project, @label or search: text."

// Optimal string alignment distance: like Levenshtein, but swapping two
// neighbouring letters ("todya") costs one edit, which is what typos look like.
function editDistance(a: string, b: string): number {
  const rows = a.length + 1
  const cols = b.length + 1
  const d: number[] = new Array(rows * cols)
  for (let i = 0; i < rows; i++) d[i * cols] = i
  for (let j = 0; j < cols; j++) d[j] = j
  for (let i = 1; i < rows; i++) {
    for (let j = 1; j < cols; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      let best = Math.min(d[(i - 1) * cols + j]! + 1, d[i * cols + j - 1]! + 1, d[(i - 1) * cols + j - 1]! + cost)
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        best = Math.min(best, d[(i - 2) * cols + j - 2]! + 1)
      }
      d[i * cols + j] = best
    }
  }
  return d[rows * cols - 1]!
}

function squash(text: string): string {
  return text.trim().replace(/\s+/g, " ").toLowerCase()
}

/** Closest candidate within a length-scaled edit distance, else null. */
export function closest(term: string, candidates: readonly string[]): string | null {
  const needle = squash(term)
  if (!needle) return null
  const budget = needle.length <= 3 ? 0 : needle.length <= 5 ? 1 : needle.length <= 9 ? 2 : 3
  let best: string | null = null
  let bestDistance = Infinity
  for (const candidate of candidates) {
    const distance = editDistance(needle, squash(candidate))
    if (distance < bestDistance) {
      best = candidate
      bestDistance = distance
    }
  }
  return best !== null && bestDistance <= budget ? best : null
}

function exact(term: string, candidates: readonly string[]): string | null {
  const needle = squash(term)
  return candidates.find((candidate) => squash(candidate) === needle) ?? null
}

type Term = { text: string; changed: boolean; unknown: string | null }

const ok = (text: string): Term => ({ text, changed: false, unknown: null })
const fixed = (text: string): Term => ({ text, changed: true, unknown: null })
const unknown = (text: string): Term => ({ text, changed: false, unknown: text })

function diagnoseTerm(core: string, ctx: FilterContext): Term {
  const term = core.trim()
  if (term === "") return ok(core)

  // Negation wraps whatever follows.
  const negated = term.match(/^!\s*(.+)$/)
  if (negated) {
    const inner = diagnoseTerm(negated[1]!, ctx)
    return { ...inner, text: `!${inner.text}` }
  }

  // Words where Todoist wants symbols: "today or overdue" → "today | overdue".
  if (/\b(or|and|not)\b/i.test(term) && !/^search\s*:/i.test(term)) {
    const symbols = term
      .replace(/\s+or\s+/gi, " | ")
      .replace(/\s+and\s+/gi, " & ")
      .replace(/(^|\s)not\s+/gi, "$1!")
    const inner = diagnoseFilter(symbols, ctx)
    return { text: inner.suggestion ?? symbols, changed: true, unknown: null }
  }

  const project = term.match(/^(#{1,2})\s*(.+)$/)
  if (project) {
    const [, hashes, name] = project
    if (ctx.projects.length === 0 || exact(name!, ctx.projects)) return ok(term)
    const match = closest(name!, ctx.projects)
    return match ? fixed(`${hashes}${match}`) : unknown(term)
  }

  const label = term.match(/^@\s*(.+)$/)
  if (label) {
    const name = label[1]!
    if (ctx.labels.length === 0 || exact(name, ctx.labels)) return ok(term)
    const match = closest(name, ctx.labels)
    return match ? fixed(`@${match}`) : unknown(term)
  }

  if (term.startsWith("/")) return ok(term)

  const priority = term.match(/^p(?:riority)?\s*([0-9])$/i)
  if (priority) {
    const level = Number(priority[1])
    if (level < 1 || level > 4) return unknown(term)
    const canonical = /^priority/i.test(term) ? `priority ${level}` : `p${level}`
    return canonical === term ? ok(term) : fixed(canonical)
  }

  const colon = term.indexOf(":")
  if (colon !== -1) {
    const prefix = term.slice(0, colon)
    const value = term.slice(colon + 1).trim()
    if (exact(prefix, PREFIXES)) return ok(term)
    const match = closest(prefix, PREFIXES)
    return match ? fixed(`${match}: ${value}`) : unknown(term)
  }

  if (/^(next|last)\s+\d+\s+days?$/i.test(term) || /^-?\d+\s+days?$/i.test(term)) return ok(term)
  if (exact(term, KEYWORDS)) return ok(term)

  const match = closest(term, KEYWORDS)
  if (match) return fixed(match)
  // Dates like "Aug 30" or "2026-08-30" cannot be checked here; let Todoist judge.
  if (/\d/.test(term)) return ok(term)
  return unknown(term)
}

/**
 * Walk the query term by term. `suggestion` is the whole query with every
 * fixable term replaced, or null when nothing looked fixable.
 */
export function diagnoseFilter(query: string, ctx: FilterContext): FilterDiagnosis {
  const pieces = query.split(/([|&,()])/)
  const unknowns: string[] = []
  let changed = false

  const rebuilt = pieces
    .map((piece) => {
      if (/^[|&,()]$/.test(piece) || piece.trim() === "") return piece
      const [, lead = "", core = "", tail = ""] = piece.match(/^(\s*)(.*?)(\s*)$/) ?? []
      const term = diagnoseTerm(core, ctx)
      if (term.unknown) unknowns.push(term.unknown)
      if (term.changed) changed = true
      return `${lead}${term.text}${tail}`
    })
    .join("")

  return { unknown: unknowns, suggestion: changed ? rebuilt : null }
}

/** Todoist's own reason, if the error body carried one. */
export function apiReason(body: string | undefined): string {
  if (!body) return ""
  try {
    const parsed = JSON.parse(body) as { error?: unknown }
    return typeof parsed.error === "string" ? parsed.error : ""
  } catch {
    return ""
  }
}

export function friendlyFilterError(query: string, diagnosis: FilterDiagnosis, reason = ""): string {
  const head = `“${query}” isn't a valid Todoist filter.`
  if (diagnosis.suggestion) return `${head} Did you mean “${diagnosis.suggestion}”?`
  if (diagnosis.unknown.length > 0) {
    const list = diagnosis.unknown.map((term) => `“${term}”`).join(", ")
    return `${head} Todoist doesn't know ${list}. ${HINT}`
  }
  return reason ? `${head} Todoist says: ${reason}. ${HINT}` : `${head} ${HINT}`
}
