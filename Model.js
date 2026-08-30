// Pure helpers for Panel.qml. No Qt in here so `bun test` can load the file
// through the CommonJS export at the bottom.

var TODOIST_TODAY = "https://app.todoist.com/app/today"
var TODOIST_TASK = "https://app.todoist.com/app/task/"

function emptyView() {
  return { version: 4, generatedAt: "", fetchedAt: "", connected: false, filter: "", filters: [], filterError: null, syncError: null, rolledForward: null, karma: null, projects: [], count: 0, overdue: 0, today: 0, tasks: [] }
}

function count(value, fallback) {
  var n = parseInt(String(value), 10)
  return isNaN(n) || n < 0 ? fallback : n
}

// Label names as `omadoist sync` wrote them, without Todoist's leading `@`.
function normalizeLabels(raw) {
  if (!Array.isArray(raw)) return []
  var out = []
  for (var i = 0; i < raw.length; i++) {
    var name = String(raw[i] === undefined || raw[i] === null ? "" : raw[i]).replace(/\s+/g, " ").trim()
    if (name !== "") out.push(name)
  }
  return out
}

function normalizeTask(raw) {
  var id = String(raw.id)
  var priority = parseInt(String(raw.priority), 10)
  if (isNaN(priority) || priority < 1 || priority > 4) priority = 4
  return {
    id: id,
    title: String(raw.title || "").replace(/\s+/g, " ").trim() || "Untitled task",
    due: String(raw.due || ""),
    overdue: raw.overdue === true,
    today: raw.today === true,
    recurring: raw.recurring === true,
    project: String(raw.project || ""),
    priority: priority,
    url: typeof raw.url === "string" && raw.url !== "" ? raw.url : TODOIST_TASK + encodeURIComponent(id),
    // Only carried when showTaskDetails is on; the CLI writes them empty
    // otherwise, so nothing here has to know about the setting.
    description: String(raw.description || "").trim(),
    labels: normalizeLabels(raw.labels)
  }
}

// The account's projects, Inbox first, as `omadoist sync` wrote them.
function parseProjects(raw) {
  if (!Array.isArray(raw)) return []
  var out = []
  for (var i = 0; i < raw.length; i++) {
    var project = raw[i]
    if (!project || typeof project !== "object" || project.id === undefined || project.id === null) continue
    var name = String(project.name || "").replace(/\s+/g, " ").trim()
    if (name === "") continue
    out.push({ id: String(project.id), name: name, inbox: project.inbox === true })
  }
  return out
}

/**
 * The saved filters as chips, in the order config.json lists them, each marked
 * with whether it is the one in force. A chip whose query is the current one
 * is not a link to anywhere: the panel draws it as the state it is in.
 */
function parseFilters(raw, current) {
  if (!Array.isArray(raw)) return []
  var out = []
  for (var i = 0; i < raw.length; i++) {
    var saved = raw[i]
    if (!saved || typeof saved !== "object") continue
    var name = String(saved.name || "").replace(/\s+/g, " ").trim()
    if (name === "") continue
    var query = String(saved.query || "").trim()
    out.push({ name: name, query: query, active: query === String(current || "").trim() })
  }
  return out
}

// Why the last filter change was refused, and what was probably meant.
function parseFilterError(raw) {
  if (!raw || typeof raw !== "object") return null
  var message = String(raw.message || "").trim()
  if (message === "") return null
  return {
    query: String(raw.query || ""),
    message: message,
    suggestion: typeof raw.suggestion === "string" && raw.suggestion.trim() !== "" ? raw.suggestion.trim() : ""
  }
}

var SYNC_ERROR_KINDS = { auth: true, offline: true, api: true }

// Why the last sync did not land: {kind, message, at}, or null when it did.
function parseSyncError(raw) {
  if (!raw || typeof raw !== "object") return null
  var message = String(raw.message || "").trim()
  if (message === "") return null
  return {
    kind: SYNC_ERROR_KINDS[raw.kind] === true ? String(raw.kind) : "api",
    message: message,
    at: typeof raw.at === "string" ? raw.at : ""
  }
}

// ~/.cache/omadoist/bar.json as written by `omadoist sync`. Anything
// malformed degrades to the empty, disconnected view rather than throwing
// inside the shell.
// A completion that came back: Todoist rolls a recurring task forward instead
// of closing it, and the CLI names the survivor here.
function parseRolledForward(raw) {
  if (!raw || typeof raw !== "object") return null
  var id = String(raw.id === undefined || raw.id === null ? "" : raw.id)
  if (id === "") return null
  return { id: id, title: String(raw.title || ""), due: String(raw.due || "") }
}

/**
 * Todoist's karma, goals and streaks as `omadoist sync` wrote them. Null when
 * the account has Karma switched off, when showKarma is off, or before the
 * first sync — the header line then simply is not there.
 */
function parseKarma(raw) {
  if (!raw || typeof raw !== "object") return null
  return {
    points: count(raw.points, 0),
    trend: raw.trend === "up" || raw.trend === "down" ? String(raw.trend) : "flat",
    today: count(raw.today, 0),
    dailyGoal: count(raw.dailyGoal, 0),
    week: count(raw.week, 0),
    weeklyGoal: count(raw.weeklyGoal, 0),
    dailyStreak: count(raw.dailyStreak, 0),
    maxDailyStreak: count(raw.maxDailyStreak, 0),
    weeklyStreak: count(raw.weeklyStreak, 0),
    maxWeeklyStreak: count(raw.maxWeeklyStreak, 0),
    restDay: raw.restDay === true,
    vacation: raw.vacation === true
  }
}

function parseView(raw) {
  var view = emptyView()
  var data
  try {
    data = JSON.parse(String(raw || ""))
  } catch (e) {
    return view
  }
  if (!data || typeof data !== "object") return view

  var tasks = Array.isArray(data.tasks) ? data.tasks : []
  view.tasks = tasks
    .filter(function(task) { return task && typeof task === "object" && task.id !== undefined && task.id !== null })
    .map(normalizeTask)
  view.generatedAt = typeof data.generatedAt === "string" ? data.generatedAt : ""
  view.fetchedAt = typeof data.fetchedAt === "string" ? data.fetchedAt : ""
  view.connected = data.connected === true
  view.filter = typeof data.filter === "string" ? data.filter.trim() : ""
  view.filters = parseFilters(data.filters, view.filter)
  view.filterError = parseFilterError(data.filterError)
  view.syncError = parseSyncError(data.syncError)
  view.rolledForward = parseRolledForward(data.rolledForward)
  view.karma = parseKarma(data.karma)
  view.projects = parseProjects(data.projects)
  view.count = count(data.count, view.tasks.length)
  view.overdue = count(data.overdue, view.tasks.filter(function(task) { return task.overdue }).length)
  view.today = count(data.today, view.tasks.filter(function(task) { return task.today }).length)
  return view
}

// The project a new task lands in unless the user picks another — the Inbox,
// the same default Todoist itself uses. Empty when nothing is synced yet, and
// the CLI then leaves the choice to Todoist.
function defaultProjectId(view) {
  var projects = (view && view.projects) || []
  for (var i = 0; i < projects.length; i++) {
    if (projects[i].inbox) return projects[i].id
  }
  return ""
}

// The dropdown wants {value, label} rows; the id is what the CLI is told.
function projectOptions(view) {
  var projects = (view && view.projects) || []
  var options = []
  for (var i = 0; i < projects.length; i++) {
    options.push({ value: projects[i].id, label: projects[i].name })
  }
  return options
}

function projectName(view, id) {
  var projects = (view && view.projects) || []
  var wanted = String(id || "")
  if (wanted === "") return ""
  for (var i = 0; i < projects.length; i++) {
    if (projects[i].id === wanted) return projects[i].name
  }
  return ""
}

function plural(n, word) {
  return n + " " + word
}

// The number next to the bar glyph. Nothing when there is nothing to do, so
// the bar stays quiet; nothing before the account is connected either.
function countLabel(view) {
  if (!view || !view.connected || view.count <= 0) return ""
  return view.count > 99 ? "99+" : String(view.count)
}

function barTooltip(view) {
  if (!view || !view.connected) return "Todoist · not connected"
  if (view.fetchedAt === "") return "Todoist · not synced yet"
  if (view.count === 0) return "Todoist · no open tasks"
  var text = "Todoist · " + plural(view.count, view.count === 1 ? "open task" : "open tasks")
  if (view.overdue > 0) text += ", " + plural(view.overdue, "overdue")
  else if (view.today > 0) text += ", " + plural(view.today, "due today")
  return text
}

// Small-caps line under the hero title.
function heroMeta(view) {
  if (!view || !view.connected) return "Not connected"
  if (view.fetchedAt === "") return "Not synced yet"
  if (view.count === 0) return "All clear"
  var parts = [plural(view.count, "open")]
  if (view.overdue > 0) parts.push(plural(view.overdue, "overdue"))
  else if (view.today > 0) parts.push(plural(view.today, "today"))
  return parts.join(" · ")
}

function pluralize(n, one, many) {
  return n + " " + (n === 1 ? one : many)
}

/**
 * The header line above the task list: Todoist's karma, today's goal and the
 * streak it is building, as three cells the panel repeats over. Empty when
 * there is nothing to show — Karma switched off on the account, `showKarma`
 * off, or no sync yet — and the panel then draws no line at all.
 *
 * Every number is Todoist's own. `ratio` is -1 for a cell with no progress to
 * draw, so only the goal gets a bar.
 */
function karmaCells(view) {
  var karma = view && view.connected ? view.karma : null
  if (!karma) return []

  var arrow = karma.trend === "up" ? " ↑" : karma.trend === "down" ? " ↓" : ""
  var trend = karma.trend === "up" ? "trending up" : karma.trend === "down" ? "trending down" : "holding steady"

  var goalSet = karma.dailyGoal > 0
  var met = goalSet && karma.today >= karma.dailyGoal
  var goalTip = pluralize(karma.today, "task", "tasks") + " completed today"
  if (goalSet) goalTip += " of a goal of " + karma.dailyGoal
  if (karma.weeklyGoal > 0) goalTip += " · " + karma.week + " of " + karma.weeklyGoal + " this week"
  // A day off still counts what was done; it just cannot break the streak.
  if (karma.restDay) goalTip += " · today is a day off, so the streak holds either way"

  var streakTip = pluralize(karma.dailyStreak, "day", "days") + " in a row, best " + karma.maxDailyStreak
  if (karma.maxWeeklyStreak > 0) {
    streakTip += " · " + pluralize(karma.weeklyStreak, "week", "weeks") + " in a row, best " + karma.maxWeeklyStreak
  }
  if (karma.vacation) streakTip = "Vacation mode: streaks are paused. " + streakTip

  return [
    {
      key: "karma",
      value: String(karma.points) + arrow,
      label: "karma",
      tooltip: karma.points + " karma, " + trend,
      ratio: -1,
      done: false
    },
    {
      key: "goal",
      value: goalSet ? karma.today + " / " + karma.dailyGoal : String(karma.today),
      label: karma.restDay ? "day off" : "today",
      tooltip: goalTip,
      ratio: goalSet ? Math.min(1, karma.today / karma.dailyGoal) : -1,
      done: met
    },
    {
      key: "streak",
      value: String(karma.dailyStreak),
      label: "day streak",
      tooltip: streakTip,
      ratio: -1,
      done: false
    }
  ]
}

function pad(n) {
  return (n < 10 ? "0" : "") + n
}

var MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]

// "14:05" today, "27 Aug" for anything older — a stale file should read as
// stale.
function stampLabel(fetchedAt, now) {
  if (!fetchedAt) return ""
  var at = new Date(fetchedAt)
  if (isNaN(at.getTime())) return ""
  var ref = now || new Date()
  var sameDay = at.getFullYear() === ref.getFullYear() && at.getMonth() === ref.getMonth() && at.getDate() === ref.getDate()
  if (sameDay) return pad(at.getHours()) + ":" + pad(at.getMinutes())
  return at.getDate() + " " + MONTHS[at.getMonth()]
}

function syncedLabel(fetchedAt, now) {
  var stamp = stampLabel(fetchedAt, now)
  return stamp === "" ? "" : "synced " + stamp
}

// Three runs of the five-minute sync timer. One missed run is a closed lid;
// three in a row is something worth a line on screen.
var STALE_AFTER_MS = 15 * 60 * 1000

function ageMs(fetchedAt, now) {
  if (!fetchedAt) return -1
  var at = new Date(fetchedAt)
  if (isNaN(at.getTime())) return -1
  return (now || new Date()).getTime() - at.getTime()
}

/**
 * The one line the panel shows when the list on screen is not what Todoist
 * has: the reason `omadoist sync` left, or — if it left none and simply
 * stopped running — how old the list is. Null while everything is current, and
 * null before the account is connected, which has its own block.
 *
 * `reconnect` is true only for a rejected token, where waiting fixes nothing
 * and `omadoist auth` is the whole answer.
 */
function syncWarning(view, now) {
  if (!view || view.connected !== true) return null
  var stamp = stampLabel(view.fetchedAt, now)
  var showing = stamp === "" ? "Nothing has synced yet." : "Showing tasks from " + stamp + "."
  var error = view.syncError

  if (error) {
    if (error.kind === "auth") {
      return { message: "Todoist rejected the API token.", hint: showing + " Reconnect to start syncing again.", reconnect: true }
    }
    return { message: error.message, hint: showing, reconnect: false }
  }

  var age = ageMs(view.fetchedAt, now)
  if (age < STALE_AFTER_MS) return null
  return { message: "Not synced since " + stamp + ".", hint: "The five-minute sync has not run. Refresh, or check omadoist-sync.timer.", reconnect: false }
}

// What the rows are filtered by, for the line under the hero.
function filterLabel(view) {
  return view && view.filter ? view.filter : "All active tasks"
}

/**
 * Has this task anything to show beyond its row? The detail area under the
 * list is worth its space only then — most tasks are a title and a date, and
 * the list is deliberately quiet.
 */
function hasDetail(task) {
  if (!task) return false
  return String(task.description || "") !== "" || (task.labels || []).length > 0
}

/** Labels as Todoist writes them, for the one line under the description. */
function labelLine(task) {
  var labels = (task && task.labels) || []
  var out = []
  for (var i = 0; i < labels.length; i++) out.push("@" + labels[i])
  return out.join("  ")
}

/**
 * Chips are worth their row only when there is a choice in them: a single
 * saved filter that is already in force says nothing the filter line does not.
 */
function savedFilters(view) {
  var filters = (view && view.filters) || []
  return filters.length > 1 ? filters : []
}

function subtitle(task) {
  if (!task) return ""
  return [task.due, task.project].filter(function(part) { return !!part }).join(" · ")
}

// p1 shouts, p2 points, p3 whispers, p4 says nothing.
function priorityTone(priority) {
  if (priority === 1) return "urgent"
  if (priority === 2) return "accent"
  if (priority === 3) return "muted"
  return "none"
}

function clampIndex(index, length) {
  if (!length || length <= 0) return 0
  var i = parseInt(String(index), 10)
  if (isNaN(i)) i = 0
  return Math.max(0, Math.min(length - 1, i))
}

function taskAt(tasks, index) {
  if (!tasks || index < 0 || index >= tasks.length) return null
  return tasks[index]
}

/**
 * What an "Undo" would put back, or null when there is nothing to offer. A
 * recurring task was not closed by being completed — it moved to its next due
 * date — so reopening it would not undo anything, and the panel says nothing
 * rather than something untrue.
 */
function undoableFrom(task) {
  if (!task || task.id === undefined || task.id === null) return null
  if (task.recurring === true) return null
  return { id: String(task.id), title: String(task.title || "") }
}

function withPending(pending, id) {
  var next = {}
  for (var key in pending) next[key] = pending[key]
  next[String(id)] = true
  return next
}

// A completed task disappears from the next bar.json; drop its pending mark
// then, and only then, so the row stays ticked while the CLI is still at it.
function reconcilePending(pending, tasks) {
  var present = {}
  for (var i = 0; i < (tasks || []).length; i++) present[tasks[i].id] = true
  var next = {}
  var kept = 0
  for (var key in pending) {
    if (pending[key] === true && present[key]) {
      next[key] = true
      kept++
    }
  }
  return kept === Object.keys(pending || {}).length ? pending : next
}

/**
 * The roll-forward is worth confirming only while it is news. bar.json keeps
 * the field until the next write, so a shell restarted an hour later — or the
 * slow poll re-reading the same file — must not tick a row all over again.
 */
function justRolledForward(view, now, withinMs) {
  var rolled = view && view.rolledForward
  if (!rolled) return null
  var at = Date.parse((view && view.generatedAt) || "")
  if (isNaN(at)) return null
  var age = now.getTime() - at
  return age >= 0 && age <= (withinMs || 30000) ? rolled : null
}

function clearPending(pending, id) {
  var next = {}
  var key = String(id)
  for (var name in pending) {
    if (name !== key) next[name] = pending[name]
  }
  return next
}

function todayUrl() {
  return TODOIST_TODAY
}

if (typeof module !== "undefined") {
  module.exports = {
    emptyView: emptyView,
    parseView: parseView,
    countLabel: countLabel,
    barTooltip: barTooltip,
    heroMeta: heroMeta,
    karmaCells: karmaCells,
    syncedLabel: syncedLabel,
    syncWarning: syncWarning,
    subtitle: subtitle,
    hasDetail: hasDetail,
    labelLine: labelLine,
    filterLabel: filterLabel,
    savedFilters: savedFilters,
    defaultProjectId: defaultProjectId,
    projectOptions: projectOptions,
    projectName: projectName,
    priorityTone: priorityTone,
    clampIndex: clampIndex,
    taskAt: taskAt,
    withPending: withPending,
    reconcilePending: reconcilePending,
    justRolledForward: justRolledForward,
    clearPending: clearPending,
    undoableFrom: undoableFrom,
    todayUrl: todayUrl
  }
}
