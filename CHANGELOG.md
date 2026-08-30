# Changelog

All notable changes to Omadoist are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project
follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

`manifest.json` and `package.json` carry the same version, and CI fails if they
drift; bump both in the release commit.

## Unreleased

### Added

- New tasks choose a Todoist project. `n` in the panel opens a searchable
  picker under the title field (`Tab` to open it), the choice sticks while the
  panel stays open, the **New task…** menu row asks through the Omarchy menu,
  and the CLI takes `omadoist add --project <name>` — a name, a `#Name`, an
  unambiguous prefix or an id. An account with only an Inbox is never asked.
  ([#1](https://github.com/rastermanden/omadoist/pull/1))

- New tasks are parsed with Todoist's own Quick Add, so
  `buy milk tomorrow p1 #Hus @errand` arrives as a task due tomorrow, at p1, in
  #Hus, labelled @errand — dates, priorities, `#Project`, `/Section`, `@label`,
  `{deadlines}`, `!reminders` and a trailing `// description`. A `#Project` in
  the title routes the task and the picker is skipped; otherwise `--project`,
  the panel dropdown or the menu prompt supplies one.
  ([#7](https://github.com/rastermanden/omadoist/issues/7))

- A sync that does not land says so. The failure path keeps the tasks it has —
  stale beats empty — and publishes why they stopped moving, so the panel can
  tell "synced a minute ago" from "hasn't reached Todoist since yesterday". A
  rejected token gets its own wording and a **Reconnect Todoist…** button,
  since waiting fixes a network blip and never fixes a token; a timer that has
  simply stopped is reported once the view is three sync runs old.
  `omadoist status` prints the same reason. Bar view version 3.
  ([#8](https://github.com/rastermanden/omadoist/issues/8))

- Undo a completion. A whole row completes on a plain left click, so a
  mis-click is easy; a strip under the list now offers **Undo** (or `u`) for
  twelve seconds after one, and `omadoist undo` / `omadoist reopen <task-id>`
  do the same from a terminal. A recurring task was advanced rather than
  closed, so no undo is offered for those and `omadoist undo` explains
  instead — `omadoist reopen <id>` still obeys.
  ([#9](https://github.com/rastermanden/omadoist/issues/9))

- A task's description and labels, under the list for the row the cursor is on.
  Both were fetched on every sync and thrown away; neither belongs on the row
  itself, so the list stays as quiet as it was and the detail area appears only
  when the cursor is on a task that has something to add. `showTaskDetails` in
  `config.json` turns it off, which keeps the text out of `bar.json` entirely.
  ([#11](https://github.com/rastermanden/omadoist/issues/11))

- Saved filters. `config.json` keeps a named list — **Today**, **Overdue**,
  **p1** and **All** to begin with — shown as chips above the task list and as
  menu rows, with the one in force marked. Switching between "what's due today"
  and "everything in #Work" was a full retype each way. A chip goes through the
  same validation a typed query does, so a preset cannot leave the sync timer
  failing, and the filter line stays the way to type anything else.
  ([#10](https://github.com/rastermanden/omadoist/issues/10))

### Changed

- Setting a filter no longer announces itself. It notified on every successful
  change — telling you the thing you had just done, from the panel, the menu or
  the command line, where both the panel and the menu already show the filter.
  A refused query still notifies, and so does one Todoist accepts that matches
  nothing (`#Wrok` when you have `#Work`), since that is news and stdout goes
  nowhere when the change came from the panel.

- The CLI is one callable function — `main(argv, effects)` behind an
  `import.meta.main` guard — rather than a module that ran at import and ended
  in `process.exit`, with every spawn and notification behind one injectable
  seam. `src/cli.ts` and `src/todoist.ts` have tests for the first time: the
  sync diff, the add fallbacks, filter validation and the refused-query path,
  and the API client against a stubbed `fetch`.
  ([#6](https://github.com/rastermanden/omadoist/issues/6))

### Fixed

- README: the settings section documents `menuIconFont`, the font the Omarchy
  menu row's glyph is drawn with, which has to be cleared before any other
  glyph shows up. It no longer claims the bar count is the full number of open
  tasks — a sync fetches pages of 200 until it holds at least four times
  `limit`, so a long list counts low.
  ([#13](https://github.com/rastermanden/omadoist/issues/13))
- README screenshot retaken on a clean desktop.

## 0.3.0 - 2026-08-29

First public release. It predates any git tag, so there is no release page
to compare against.

### Added

- Open-task count in the Omarchy bar, in the urgent colour when something is
  overdue, and a panel that lists the tasks with due date, project and
  priority. `Enter` completes a task in place.
- Inline **New task** (`n`) and **Filter** (`f`) in the panel; the whole
  Todoist filter language, with a plain-language "did you mean …" for a query
  Todoist refuses and for projects or labels that match nothing.
- The same list under **Todoist** in the Omarchy menu, generated into
  `~/.config/omarchy/extensions/omarchy-menu.jsonc` between markers.
- A five-minute systemd user timer, and notifications only for tasks added or
  completed somewhere else — never for what you just did here.
- `omadoist setup`, `uninstall`, `auth`, `sync`, `done`, `add`, `filter`,
  `list`, `status`, `menu` and `unlink-menu`, plus shell IPC
  (`omarchy-shell omadoist refresh|add|filter|toggle`).
- The Todoist mark as a one-glyph font built from the CC0 simple-icons SVG, so
  both the menu and the bar can draw it as text.
- The API token in a mode-600 file that the widget never reads;
  `TODOIST_API_TOKEN` overrides it.
