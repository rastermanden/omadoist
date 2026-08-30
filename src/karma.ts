/**
 * Todoist's own gamification, as the account already keeps it: karma points
 * and which way they are going, today's and this week's progress towards the
 * goals, and the streaks those goals build.
 *
 * Nothing here is invented. Every number comes from the productivity stats
 * Todoist computes itself, so the panel and todoist.com never disagree about
 * how long the streak is — a locally counted streak would drift the first time
 * a task is completed on the phone.
 */
export type Karma = {
  /** Karma points, whole; the API reports them as a float. */
  points: number
  /** Which way the last update moved them. "flat" when Todoist says neither. */
  trend: "up" | "down" | "flat"
  /** Tasks completed today, as Todoist counts a day — in the account's timezone. */
  today: number
  dailyGoal: number
  /** Tasks completed in the current week, on the account's week boundaries. */
  week: number
  weeklyGoal: number
  dailyStreak: number
  maxDailyStreak: number
  weeklyStreak: number
  maxWeeklyStreak: number
  /**
   * Today is one of the days the account excused (Todoist's "days off"), so
   * missing the goal costs no streak. Worth knowing before the panel shows
   * 0 of 5 on a Sunday as though something were slipping.
   */
  restDay: boolean
  /** Vacation mode: Todoist has paused the streaks entirely. */
  vacation: boolean
}

function num(value: unknown, fallback = 0): number {
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value.trim() || NaN) : NaN
  return Number.isFinite(parsed) ? parsed : fallback
}

/** A whole count: goals and streaks are never fractional or negative. */
function whole(value: unknown): number {
  return Math.max(0, Math.round(num(value)))
}

function streakCount(raw: unknown): number {
  if (!raw || typeof raw !== "object") return 0
  return whole((raw as { count?: unknown }).count)
}

function flag(value: unknown): boolean {
  return value === true || num(value) === 1
}

/** ISO weekday, 1 = Monday … 7 = Sunday — the numbering `ignore_days` uses. */
function isoWeekday(at: Date): number {
  return at.getUTCDay() === 0 ? 7 : at.getUTCDay()
}

/**
 * The stats payload's day rows, newest first. `days_items[0]` is Todoist's
 * today, which is the day the streak is computed against; deriving "today"
 * from this machine's clock instead would disagree with it whenever the
 * account's timezone is not this one.
 */
function todayRow(raw: Record<string, unknown>): { date: string; total: number } {
  const days = Array.isArray(raw.days_items) ? raw.days_items : []
  const first = days[0]
  if (!first || typeof first !== "object") return { date: "", total: 0 }
  const { date, total_completed } = first as { date?: unknown; total_completed?: unknown }
  return { date: typeof date === "string" ? date : "", total: whole(total_completed) }
}

/** Same shape for weeks: `week_items[0]` is the week in progress. */
function weekTotal(raw: Record<string, unknown>): number {
  const weeks = Array.isArray(raw.week_items) ? raw.week_items : []
  const first = weeks[0]
  if (!first || typeof first !== "object") return 0
  return whole((first as { total_completed?: unknown }).total_completed)
}

/**
 * The stats endpoint's answer, narrowed to what the panel shows. Null when the
 * account has switched Karma off — there is then nothing to show, and an
 * invented substitute would be worse than an empty header.
 */
export function karmaFromStats(raw: unknown, now = new Date()): Karma | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null
  const stats = raw as Record<string, unknown>
  const goals = (stats.goals && typeof stats.goals === "object" ? stats.goals : {}) as Record<string, unknown>
  if (flag(goals.karma_disabled)) return null

  const day = todayRow(stats)
  // The date string is a plain day, so it is read as UTC and asked for its
  // weekday; the local clock only stands in when there are no day rows at all.
  const at = day.date ? new Date(`${day.date}T00:00:00Z`) : now
  const weekday = Number.isNaN(at.getTime()) ? isoWeekday(now) : isoWeekday(at)
  const ignored = Array.isArray(goals.ignore_days) ? goals.ignore_days.map((value) => whole(value)) : []
  const trend = stats.karma_trend === "up" || stats.karma_trend === "down" ? stats.karma_trend : "flat"

  return {
    points: Math.max(0, Math.round(num(stats.karma))),
    trend,
    today: day.total,
    dailyGoal: whole(goals.daily_goal),
    week: weekTotal(stats),
    weeklyGoal: whole(goals.weekly_goal),
    dailyStreak: streakCount(goals.current_daily_streak),
    maxDailyStreak: streakCount(goals.max_daily_streak),
    weeklyStreak: streakCount(goals.current_weekly_streak),
    maxWeeklyStreak: streakCount(goals.max_weekly_streak),
    restDay: ignored.includes(weekday),
    vacation: flag(goals.vacation_mode),
  }
}

/** The same shape back off disk, where the cache last wrote it. */
export function parseKarma(raw: unknown): Karma | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null
  const cached = raw as Partial<Karma>
  const trend = cached.trend === "up" || cached.trend === "down" ? cached.trend : "flat"
  return {
    points: whole(cached.points),
    trend,
    today: whole(cached.today),
    dailyGoal: whole(cached.dailyGoal),
    week: whole(cached.week),
    weeklyGoal: whole(cached.weeklyGoal),
    dailyStreak: whole(cached.dailyStreak),
    maxDailyStreak: whole(cached.maxDailyStreak),
    weeklyStreak: whole(cached.weeklyStreak),
    maxWeeklyStreak: whole(cached.maxWeeklyStreak),
    restDay: cached.restDay === true,
    vacation: cached.vacation === true,
  }
}
