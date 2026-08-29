import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

// The CLI writes a token, a config, a cache, a bar view and a menu block into
// XDG directories that src/config.ts reads once at import. Point them at a
// scratch directory before anything else loads, so `bun test` can exercise
// whole commands without touching the developer's own ~/.config/omadoist.
export const TEST_ROOT = mkdtempSync(join(tmpdir(), "omadoist-test-"))

process.env.XDG_CONFIG_HOME = join(TEST_ROOT, "config")
process.env.XDG_CACHE_HOME = join(TEST_ROOT, "cache")
process.env.OMADOIST_MENU_FILE = join(TEST_ROOT, "config", "omarchy", "extensions", "omarchy-menu.jsonc")
// loadToken() prefers this over the token file; a real one in the developer's
// environment would send the stubbed fetch assertions off course.
delete process.env.TODOIST_API_TOKEN
