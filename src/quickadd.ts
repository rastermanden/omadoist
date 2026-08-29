/**
 * Todoist's Quick Add syntax — the one the web and mobile composers use, where
 * "buy milk tomorrow p1 #Hus @errand" is a task, a date, a priority, a project
 * and a label. The API parses it for us (POST /tasks/quick), so nothing here
 * interprets the text; these helpers only answer the one question the CLI has
 * to settle before it asks: did the user already name a project?
 */

// A description runs to the end of the line, so a `#` inside one is prose, not
// a project. Everything after the marker is ignored below.
const DESCRIPTION = /\s\/\/\s/

// `#Project`, at a word boundary the way the parser reads it, with `\ ` escapes
// kept together so "#My\ Project" counts once.
const PROJECT = /(?:^|\s)#(?:\\.|[^\s\\])+/

/** Has the text already routed itself, so the picker has nothing left to ask? */
export function hasProjectToken(text: string): boolean {
  return PROJECT.test(text.split(DESCRIPTION)[0] ?? "")
}

/**
 * A project name written the way Quick Add needs to read it back: spaces
 * escaped, as the API reference spells it (`#My\ Project`).
 */
export function projectToken(name: string): string {
  return name.trim().replace(/\\/g, "\\\\").replace(/\s+/g, "\\ ")
}

/**
 * The text with a project appended, unless it already carries one — a `#` the
 * user typed is more specific than a picker that always has some project
 * selected, so it wins.
 */
export function withProject(text: string, name: string): string {
  const trimmed = text.trim()
  const token = projectToken(name)
  if (!token || hasProjectToken(trimmed)) return trimmed
  return `${trimmed} #${token}`
}
