import { expect, test } from "bun:test"
import { karmaFromStats, parseKarma } from "../src/karma"

// A trimmed copy of what /tasks/completed/stats answers: the day rows come
// newest first, the week rows likewise, and the goals carry the streaks.
const STATS = {
  completed_count: 35,
  karma: 691.0,
  karma_trend: "up",
  days_items: [
    { date: "2026-08-30", total_completed: 4 },
    { date: "2026-08-29", total_completed: 31 },
  ],
  week_items: [
    { from: "2026-08-24", to: "2026-08-30", total_completed: 35 },
    { from: "2026-08-17", to: "2026-08-23", total_completed: 0 },
  ],
  goals: {
    daily_goal: 5,
    weekly_goal: 30,
    ignore_days: [6, 7],
    karma_disabled: 0,
    vacation_mode: 0,
    current_daily_streak: { count: 2, start: "2026-08-29", end: "2026-08-30" },
    max_daily_streak: { count: 9, start: "2026-01-02", end: "2026-01-10" },
    current_weekly_streak: { count: 1, start: "2026-08-24", end: "2026-08-30" },
    max_weekly_streak: { count: 3, start: "2026-01-05", end: "2026-01-25" },
  },
}

test("the stats payload narrows to the numbers the header line shows", () => {
  expect(karmaFromStats(STATS)).toEqual({
    points: 691,
    trend: "up",
    today: 4,
    dailyGoal: 5,
    week: 35,
    weeklyGoal: 30,
    dailyStreak: 2,
    maxDailyStreak: 9,
    weeklyStreak: 1,
    maxWeeklyStreak: 3,
    // 30 Aug 2026 is a Sunday, and the account excuses Saturdays and Sundays.
    restDay: true,
    vacation: false,
  })
})

test("today is Todoist's today, not this machine's", () => {
  // A weekday first row: the streak is at stake, so it is not a day off — even
  // though the clock here says otherwise.
  const stats = { ...STATS, days_items: [{ date: "2026-08-28", total_completed: 6 }] }
  const karma = karmaFromStats(stats, new Date(2026, 7, 30, 12, 0, 0))
  expect(karma?.today).toBe(6)
  expect(karma?.restDay).toBe(false)
})

test("an account with Karma switched off has nothing to show", () => {
  expect(karmaFromStats({ ...STATS, goals: { ...STATS.goals, karma_disabled: 1 } })).toBeNull()
  expect(karmaFromStats(null)).toBeNull()
  expect(karmaFromStats("nope")).toBeNull()
  expect(karmaFromStats([])).toBeNull()
})

test("vacation mode is carried, since it is why a streak stopped moving", () => {
  expect(karmaFromStats({ ...STATS, goals: { ...STATS.goals, vacation_mode: 1 } })?.vacation).toBe(true)
})

test("a payload missing its day, week and goal rows still parses", () => {
  expect(karmaFromStats({ karma: 12.6, karma_trend: "sideways" })).toEqual({
    points: 13,
    trend: "flat",
    today: 0,
    dailyGoal: 0,
    week: 0,
    weeklyGoal: 0,
    dailyStreak: 0,
    maxDailyStreak: 0,
    weeklyStreak: 0,
    maxWeeklyStreak: 0,
    restDay: false,
    vacation: false,
  })
})

test("the cached shape comes back off disk, and garbage does not", () => {
  const karma = karmaFromStats(STATS)
  expect(parseKarma(JSON.parse(JSON.stringify(karma)))).toEqual(karma)
  expect(parseKarma(null)).toBeNull()
  expect(parseKarma("691")).toBeNull()
  expect(parseKarma({ points: "not a number", trend: "up" })?.points).toBe(0)
})
