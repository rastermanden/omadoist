#!/usr/bin/env bun
import { mkdir } from "node:fs/promises"
import { dirname } from "node:path"
import { createInterface } from "node:readline/promises"
import { buildBarView } from "./bar"
import { loadCache, saveCache, type Cache } from "./cache"
import { describeChanges, diffTasks } from "./changes"
import { apiReason, diagnoseFilter, friendlyFilterError, type FilterError } from "./filter"
import { loadConfig, loadToken, saveToken, updateConfig, BAR_FILE, CACHE_DIR, MENU_FILE, TOKEN_FILE, CONFIG_FILE, type Config } from "./config"
import { ensureDir, writeAtomic } from "./files"
import { buildRows, buildUnauthenticatedRows, mergeIntoMenu, removeFromMenu, renderBlock, shellQuote } from "./menu"
import { choicesFromPairs, inboxId, parseAddArgs, projectChoices, resolveProject, type ProjectChoice } from "./projects"
import { spawnOptional } from "./proc"
import { formatDue } from "./tasks"
import { setup, teardown } from "./setup"
import { closeTask, createTask, fetchLabels, fetchProjects, fetchTasks, TodoistError, verifyToken, type Task } from "./todoist"

const APP = "Todoist"

// notify-send and the Omarchy menu binaries are conveniences: a machine
// without them still syncs. spawnOptional keeps a missing binary from throwing
// past the work that matters — the notify below used to abort cmdSync before
// it ever reached saveCache, freezing the widget on stale data.
function notify(title: string, body = "", urgency: "low" | "normal" | "critical" = "low") {
  spawnOptional(["notify-send", "-a", APP, "-u", urgency, title, body], {
    stdio: ["ignore", "ignore", "ignore"],
  })?.unref()
}

async function run(command: string[]): Promise<void> {
  await spawnOptional(command, { stdio: ["ignore", "ignore", "ignore"] })?.exited
}

async function requireToken(): Promise<string> {
  const token = await loadToken()
  if (!token) {
    throw new TodoistError(`no API token yet — run \`omadoist auth\` (stored in ${TOKEN_FILE})`)
  }
  return token
}

// ---------------------------------------------------------------- menu file

async function writeMenu(cache: Cache, config: Config, authenticated: boolean): Promise<void> {
  const rows = authenticated
    ? buildRows(cache.tasks, new Map(cache.projects), config)
    : buildUnauthenticatedRows(config)

  const file = Bun.file(MENU_FILE)
  const source = (await file.exists()) ? await file.text() : "{\n}\n"
  const next = mergeIntoMenu(source, renderBlock(rows))

  await mkdir(dirname(MENU_FILE), { recursive: true })
  await Bun.write(MENU_FILE, next)
}

// The bar widget (plugin/Panel.qml) watches this file instead of re-deriving
// sort order and due labels in QML: the CLI is the one place that knows them.
// It watches with watchChanges: true, so a read must never land mid-write — a
// truncated document fails to parse and the panel falls back to "not
// connected" — hence the atomic rename. The directory is private for the same
// reason the cache is: these rows are the user's task titles.
async function writeBar(cache: Cache, config: Config, authenticated: boolean, filterError: FilterError | null = null): Promise<void> {
  await ensureDir(CACHE_DIR)
  await writeAtomic(BAR_FILE, JSON.stringify(buildBarView(cache, config, authenticated, new Date(), filterError)), 0o600)
}

// Menu block and bar view always change together.
async function publish(cache: Cache, config: Config, authenticated: boolean): Promise<void> {
  await writeMenu(cache, config, authenticated)
  await writeBar(cache, config, authenticated)
}

// ---------------------------------------------------------------- commands

async function cmdAuth(args: string[]): Promise<number> {
  let token = args[0]?.trim()
  if (!token) {
    // One line, so a paste into an interactive terminal is enough and a piped
    // `echo $TOKEN | omadoist auth` works the same way.
    const rl = createInterface({ input: process.stdin, output: process.stdout })
    token = (await rl.question("Todoist API token (Settings → Integrations → Developer):\n> ")).trim()
    rl.close()
  }
  if (!token) {
    console.error("omadoist: no token given")
    return 1
  }

  await verifyToken(token)
  await saveToken(token)
  console.log(`Token stored in ${TOKEN_FILE} (mode 600).`)
  return cmdSync([])
}

type SyncOptions = {
  /** Tasks this machine just completed or added; their arrival or departure is not news. */
  silentIds?: string[]
  /** False after a filter change, when the whole list legitimately turns over. */
  notifyChanges?: boolean
}

async function cmdSync(args: string[], { silentIds = [], notifyChanges = true }: SyncOptions = {}): Promise<number> {
  const config = await loadConfig()
  const token = await loadToken()
  const previous = await loadCache()

  if (!token) {
    await publish({ fetchedAt: "", tasks: [], projects: [], inboxProjectId: "" }, config, false)
    // Not an error, just unconfigured: the menu now carries a "Connect
    // Todoist…" row, and the sync timer should not keep failing in the journal.
    console.error("omadoist: not connected — run `omadoist auth`")
    if (args.includes("--open")) await run(["omarchy-menu", "summon", "todoist"])
    return 0
  }

  // The projects come along on every sync, not just when the menu shows them
  // in a subtitle: the new-task picker is filled from the same cache.
  const [tasks, projects] = await Promise.all([
    fetchTasks(token, config.filter, config.limit * 4),
    fetchProjects(token),
  ])
  const choices = projectChoices(projects)

  // Changes made elsewhere — on the phone, on the web — are worth a heads-up.
  // Not before the first sync, when everything would look new.
  if (notifyChanges && config.notifyRemoteChanges && previous.fetchedAt) {
    const summary = describeChanges(diffTasks(previous.tasks, tasks, silentIds))
    if (summary) notify(summary.title, summary.body)
  }

  const cache: Cache = {
    fetchedAt: new Date().toISOString(),
    tasks,
    projects: choices.map((choice) => [choice.id, choice.name] as [string, string]),
    inboxProjectId: inboxId(choices),
  }
  await saveCache(cache)
  await publish(cache, config, true)

  console.log(`Synced ${tasks.length} task${tasks.length === 1 ? "" : "s"} into ${MENU_FILE}`)
  if (args.includes("--open")) await run(["omarchy-menu", "summon", "todoist"])
  return 0
}

async function cmdDone(args: string[]): Promise<number> {
  const id = args[0]?.trim()
  if (!id) {
    console.error("usage: omadoist done <task-id>")
    return 1
  }

  const token = await requireToken()
  const cache = await loadCache()

  await closeTask(token, id)

  // Drop the row right away so a menu reopened before the next sync no longer
  // offers it, then refresh in full (a recurring task returns with a new due
  // date, and the API is the only source for that).
  const config = await loadConfig()
  const pruned: Cache = { ...cache, tasks: cache.tasks.filter((candidate) => String(candidate.id) !== id) }
  await saveCache(pruned)
  await publish(pruned, config, true)

  return cmdSync([], { silentIds: [id] })
}

/**
 * Which project the task belongs to, asked through the same Omarchy menu the
 * user is already looking at. An account with nothing but an Inbox is not
 * worth a question, and a shell without the picker gets the Inbox rather than
 * a failed add.
 */
async function askProject(choices: ProjectChoice[]): Promise<{ cancelled: boolean; choice: ProjectChoice | null }> {
  if (choices.length < 2) return { cancelled: false, choice: choices[0] ?? null }

  const picker = spawnOptional(["omarchy-menu-select", "Project", ...choices.map((choice) => choice.name), "--", "--width", "460"], {
    stdout: "pipe",
    stderr: "ignore",
  })
  if (!picker) return { cancelled: false, choice: null }

  const answer = (await new Response(picker.stdout).text()).trim()
  if ((await picker.exited) !== 0 || !answer) return { cancelled: true, choice: null }
  // The menu hands back "<label>\t<subtext>" when a row carries one.
  return { cancelled: false, choice: resolveProject(choices, answer.split("\t")[0] ?? answer) }
}

async function cmdAdd(args: string[]): Promise<number> {
  const { project: wanted, words } = parseAddArgs(args)
  let content = words.join(" ").trim()

  const token = await requireToken()
  const cache = await loadCache()
  // The cache is the fast path; a project made since the last sync only exists
  // in the API, so a name that misses there is worth one fresh look.
  let choices = choicesFromPairs(cache.projects, cache.inboxProjectId)
  let target: ProjectChoice | null = null

  if (wanted) {
    target = resolveProject(choices, wanted)
    if (!target) {
      choices = projectChoices(await fetchProjects(token))
      target = resolveProject(choices, wanted)
    }
    if (!target) {
      console.error(`omadoist: no project matching '${wanted}'`)
      if (choices.length > 0) console.error(`  projects: ${choices.map((choice) => choice.name).join(", ")}`)
      return 1
    }
  }

  if (!content) {
    // No text on the command line means the menu triggered it: ask through the
    // same Quickshell menu the user is already looking at.
    const prompt = spawnOptional(["omarchy-menu-input", "New task"], { stdout: "pipe", stderr: "ignore" })
    if (!prompt) {
      console.error("omadoist: no task text, and omarchy-menu-input is not installed to ask for it")
      return 1
    }
    content = (await new Response(prompt.stdout).text()).trim()
    if ((await prompt.exited) !== 0 || !content) return 0 // cancelled

    if (!target) {
      if (choices.length === 0) choices = projectChoices(await fetchProjects(token))
      const asked = await askProject(choices)
      if (asked.cancelled) return 0
      target = asked.choice
    }
  }

  const task = await createTask(token, content, target?.id)
  console.log(`Added “${content}”${target ? ` to ${target.name}` : ""}`)
  return cmdSync([], { silentIds: [String(task.id)] })
}

// "all" and "*" mean no filter: the menu prompt cannot hand back an empty
// string, and both read naturally on the command line too.
function normalizeFilter(query: string): string {
  const text = query.trim()
  return text === "" || text === "*" || text.toLowerCase() === "all" ? "" : text
}

async function cmdFilter(args: string[]): Promise<number> {
  const config = await loadConfig()

  if (args.length === 0) {
    console.log(config.filter || "(all active tasks)")
    return 0
  }

  let query: string
  if (args[0] === "--clear") {
    query = ""
  } else if (args[0] === "--edit") {
    // From the menu or the panel: ask through the Omarchy menu, with the
    // current filter in the prompt since the input cannot be prefilled.
    const prompt = `Todoist filter — now: ${config.filter || "all"}  (all = no filter)`
    const input = spawnOptional(["omarchy-menu-input", prompt, "--width", "560"], { stdout: "pipe", stderr: "ignore" })
    if (!input) {
      console.error("omadoist: omarchy-menu-input is not installed — pass the filter as arguments instead")
      return 1
    }
    const text = (await new Response(input.stdout).text()).trim()
    if ((await input.exited) !== 0) return 0 // cancelled
    query = normalizeFilter(text)
  } else {
    query = normalizeFilter(args.join(" "))
  }

  if (query === config.filter) {
    console.log(query ? `Filter unchanged: ${query}` : "Filter unchanged: all active tasks")
    // Still rewrite the view: this may be the user backing out of a refused
    // attempt, and the explanation should not outlive it.
    await writeBar(await loadCache(), config, true)
    return 0
  }

  // Todoist is the only judge of what a valid query is: try it before it
  // lands in the config, so a typo cannot leave the timer failing every
  // five minutes. When it says no, say why in words and offer a fix.
  const token = await requireToken()
  try {
    await fetchTasks(token, query, 1)
  } catch (err) {
    if (!(err instanceof TodoistError) || err.status !== 400) throw err
    const cache = await loadCache()
    const labels = await fetchLabels(token).catch(() => [] as string[])
    const diagnosis = diagnoseFilter(query, { projects: [...new Map(cache.projects).values()], labels })
    const message = friendlyFilterError(query, diagnosis, apiReason(err.body))
    // The panel reads bar.json, so the explanation lands where the user is
    // looking, with the suggestion one click away.
    await writeBar(cache, config, true, { query, message, suggestion: diagnosis.suggestion })
    console.error(`omadoist: ${message}`)
    if (diagnosis.suggestion) console.error(`  try: omadoist filter ${shellQuote(diagnosis.suggestion)}`)
    notify("Todoist filter", message, "normal")
    return 1
  }

  await updateConfig({ filter: query })
  // Todoist accepts a project or label that does not exist — it just matches
  // nothing — so a near-miss against the account still deserves a nudge.
  let suggestion = ""
  let hint = ""
  if (query) {
    const cache = await loadCache()
    const labels = await fetchLabels(token).catch(() => [] as string[])
    const diagnosis = diagnoseFilter(query, { projects: [...new Map(cache.projects).values()], labels })
    suggestion = diagnosis.suggestion ?? ""
    const missing = diagnosis.unknown.filter((term) => /^[#@]/.test(term))
    if (suggestion) hint = ` — did you mean “${suggestion}”?`
    else if (missing.length > 0) {
      hint = " — " + missing.map((term) => `no ${term.startsWith("@") ? "label" : "project"} named “${term.replace(/^[#@]+\s*/, "")}”`).join(", ")
    }
  }
  console.log(query ? `Filter set: ${query}${hint}` : "Filter cleared: all active tasks")
  if (suggestion) console.log(`  try: omadoist filter ${shellQuote(suggestion)}`)
  notify("Todoist filter", (query || "All active tasks") + hint)
  // Everything may change now; that is the point, not remote news.
  return cmdSync([], { notifyChanges: false })
}

async function cmdList(): Promise<number> {
  const cache = await loadCache()
  const projects = new Map(cache.projects)
  if (cache.tasks.length === 0) {
    console.log("No cached tasks — run `omadoist sync`.")
    return 0
  }
  for (const task of cache.tasks) {
    const due = formatDue(task)
    const project = task.project_id ? projects.get(String(task.project_id)) : undefined
    const meta = [due, project].filter(Boolean).join(" · ")
    console.log(`${String(task.id).padEnd(22)} ${task.content}${meta ? `  (${meta})` : ""}`)
  }
  return 0
}

async function cmdMenu(): Promise<number> {
  const config = await loadConfig()
  const token = await loadToken()
  await publish(await loadCache(), config, Boolean(token))
  return 0
}

async function cmdStatus(): Promise<number> {
  const cache = await loadCache()
  const config = await loadConfig()
  console.log(`token:   ${(await loadToken()) ? "present" : "missing (run `omadoist auth`)"}`)
  console.log(`config:  ${CONFIG_FILE}`)
  console.log(`filter:  ${config.filter || "(all active tasks)"}`)
  console.log(`limit:   ${config.limit}`)
  console.log(`menu:    ${MENU_FILE}`)
  console.log(`bar:     ${BAR_FILE}`)
  console.log(`cached:  ${cache.tasks.length} tasks${cache.fetchedAt ? ` at ${cache.fetchedAt}` : ""}`)
  return 0
}

// First run after `omarchy plugin add`: the panel launches this in a terminal.
async function cmdSetup(): Promise<number> {
  const { fontInstalled } = await setup()
  await cmdMenu()
  console.log(`menu block and bar view written`)
  if (fontInstalled) {
    // The bar loads the font itself; the menu rows use the system copy, and
    // Quickshell reads the font database once at startup.
    console.log("\nThe Todoist mark in the menu appears after: omarchy restart shell")
  }
  if (!(await loadToken())) {
    console.log("\nNext: connect your account.\n  1. Open https://app.todoist.com/app/settings/integrations/developer\n  2. Copy the API token\n  3. Run: omadoist auth   (or use Connect Todoist… in the panel)")
  }
  return 0
}

async function cmdUninstall(args: string[]): Promise<number> {
  const purge = args.includes("--purge")
  await cmdUninstallMenu()
  await teardown(console.log, purge)
  if (!purge) console.log("Token and config kept in ~/.config/omadoist (use --purge to remove them).")
  console.log("Remove the plugin itself with: omarchy plugin remove omadoist")
  return 0
}

async function cmdUninstallMenu(): Promise<number> {
  const file = Bun.file(MENU_FILE)
  if (!(await file.exists())) return 0
  await Bun.write(MENU_FILE, removeFromMenu(await file.text()))
  console.log(`Removed the omadoist block from ${MENU_FILE}`)
  return 0
}

function usage(): number {
  console.log(`omadoist — Todoist in the Omarchy menu

Usage:
  omadoist auth [token]     Store an API token and sync
  omadoist sync [--open]    Fetch tasks, rewrite the menu block and the bar view
  omadoist done <task-id>   Complete a task, then re-sync
  omadoist add [--project <name>] [text...]
                            Add a task (prompts for text and project when empty)
  omadoist filter [query]   Show or set the Todoist filter (--clear, --edit; "all" = none)
  omadoist list             Print the cached tasks
  omadoist menu             Rewrite the menu block and bar view from the cache only
  omadoist status           Show token, config and cache state
  omadoist setup            Install the icon font, sync timer, menu block and launcher
  omadoist uninstall        Undo setup; --purge also removes token and config
  omadoist unlink-menu      Remove the generated block from the menu
`)
  return 0
}

const [command = "help", ...rest] = process.argv.slice(2)

try {
  const handlers: Record<string, () => Promise<number>> = {
    auth: () => cmdAuth(rest),
    sync: () => cmdSync(rest),
    done: () => cmdDone(rest),
    add: () => cmdAdd(rest),
    filter: () => cmdFilter(rest),
    list: () => cmdList(),
    menu: () => cmdMenu(),
    status: () => cmdStatus(),
    setup: () => cmdSetup(),
    uninstall: () => cmdUninstall(rest),
    "unlink-menu": () => cmdUninstallMenu(),
  }

  const handler = handlers[command]
  if (!handler) {
    if (command !== "help" && command !== "--help" && command !== "-h") {
      console.error(`omadoist: unknown command '${command}'\n`)
      usage()
      process.exit(2)
    }
    process.exit(usage())
  }
  process.exit(await handler())
} catch (err) {
  const message = err instanceof TodoistError ? err.message : String(err)
  console.error(`omadoist: ${message}`)
  if (["done", "add", "filter"].includes(command)) notify("Todoist failed", message, "critical")
  process.exit(1)
}
