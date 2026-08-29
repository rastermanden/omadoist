// Pure helpers for Panel.qml. No Qt in here so `bun test` can load the file
// through the CommonJS export at the bottom.

var TODOIST_TODAY = "https://app.todoist.com/app/today"
var TODOIST_TASK = "https://app.todoist.com/app/task/"

function emptyView() {
  return { version: 1, generatedAt: "", fetchedAt: "", connected: false, filter: "", filterError: null, count: 0, overdue: 0, today: 0, tasks: [] }
}

function count(value, fallback) {
  var n = parseInt(String(value), 10)
  return isNaN(n) || n < 0 ? fallback : n
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
    url: typeof raw.url === "string" && raw.url !== "" ? raw.url : TODOIST_TASK + encodeURIComponent(id)
  }
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

// ~/.cache/omadoist/bar.json as written by `omadoist sync`. Anything
// malformed degrades to the empty, disconnected view rather than throwing
// inside the shell.
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
  view.filterError = parseFilterError(data.filterError)
  view.count = count(data.count, view.tasks.length)
  view.overdue = count(data.overdue, view.tasks.filter(function(task) { return task.overdue }).length)
  view.today = count(data.today, view.tasks.filter(function(task) { return task.today }).length)
  return view
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

function pad(n) {
  return (n < 10 ? "0" : "") + n
}

var MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]

// "synced 14:05" today, "synced 27 Aug" for anything older — a stale file
// should read as stale.
function syncedLabel(fetchedAt, now) {
  if (!fetchedAt) return ""
  var at = new Date(fetchedAt)
  if (isNaN(at.getTime())) return ""
  var ref = now || new Date()
  var sameDay = at.getFullYear() === ref.getFullYear() && at.getMonth() === ref.getMonth() && at.getDate() === ref.getDate()
  if (sameDay) return "synced " + pad(at.getHours()) + ":" + pad(at.getMinutes())
  return "synced " + at.getDate() + " " + MONTHS[at.getMonth()]
}

// What the rows are filtered by, for the line under the hero.
function filterLabel(view) {
  return view && view.filter ? view.filter : "All active tasks"
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
    syncedLabel: syncedLabel,
    subtitle: subtitle,
    filterLabel: filterLabel,
    priorityTone: priorityTone,
    clampIndex: clampIndex,
    taskAt: taskAt,
    withPending: withPending,
    reconcilePending: reconcilePending,
    todayUrl: todayUrl
  }
}
