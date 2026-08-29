import { expect, test } from "bun:test"
import { DEFAULT_CONFIG, sanitizeConfig } from "../src/config"

test("a well-formed file passes through, and unset keys keep their default without a word", () => {
  const { config, warnings } = sanitizeConfig({ filter: "today | overdue", limit: 8, showDetails: false })
  expect(config).toEqual({ ...DEFAULT_CONFIG, filter: "today | overdue", limit: 8, showDetails: false })
  expect(warnings).toEqual([])
})

test("a null filter falls back instead of crashing every command", () => {
  const { config, warnings } = sanitizeConfig({ filter: null })
  expect(config.filter).toBe(DEFAULT_CONFIG.filter)
  expect(warnings).toHaveLength(1)
  expect(warnings[0]).toContain("filter")
})

test("a limit that is not a number falls back rather than silently emptying the list", () => {
  // Math.max(1, NaN) → slice(0, NaN) → no rows, while the bar count still said one.
  const { config, warnings } = sanitizeConfig({ limit: "lots" })
  expect(config.limit).toBe(DEFAULT_CONFIG.limit)
  expect(warnings[0]).toContain("limit")

  expect(sanitizeConfig({ limit: 0 }).config.limit).toBe(DEFAULT_CONFIG.limit)
  expect(sanitizeConfig({ limit: -3 }).config.limit).toBe(DEFAULT_CONFIG.limit)
  expect(sanitizeConfig({ limit: Infinity }).config.limit).toBe(DEFAULT_CONFIG.limit)
  // A hand-edited "12" and a 12.7 are both a count of rows.
  expect(sanitizeConfig({ limit: "12" }).config.limit).toBe(12)
  expect(sanitizeConfig({ limit: 12.7 }).config.limit).toBe(12)
})

test("booleans have to be booleans", () => {
  expect(sanitizeConfig({ showDetails: "yes" }).config.showDetails).toBe(DEFAULT_CONFIG.showDetails)
  expect(sanitizeConfig({ notifyRemoteChanges: 0 }).config.notifyRemoteChanges).toBe(DEFAULT_CONFIG.notifyRemoteChanges)
  expect(sanitizeConfig({ showDetails: false }).config.showDetails).toBe(false)
})

test("one bad key does not cost the good ones", () => {
  const { config, warnings } = sanitizeConfig({ filter: "today", limit: null, menuLabel: 7 })
  expect(config.filter).toBe("today")
  expect(config.limit).toBe(DEFAULT_CONFIG.limit)
  expect(config.menuLabel).toBe(DEFAULT_CONFIG.menuLabel)
  expect(warnings).toHaveLength(2)
})

test("a file that is not an object at all is ignored with a word about it", () => {
  for (const raw of [null, [], "nope", 3]) {
    const { config, warnings } = sanitizeConfig(raw)
    expect(config).toEqual(DEFAULT_CONFIG)
    expect(warnings).toHaveLength(1)
  }
})

test("keys the tool does not know are dropped, not carried into the program", () => {
  expect(sanitizeConfig({ nonsense: { deep: true } }).config).toEqual(DEFAULT_CONFIG)
})
