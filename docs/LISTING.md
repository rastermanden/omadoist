# Listing copy

Ready-to-paste text for the omarchyplugins.com submission form, the GitHub
repository, and release posts.

## Marketplace fields

| Field | Value |
| --- | --- |
| Name | Omadoist |
| Category | Widgets |
| Short description | Todoist in your Omarchy bar: open-task count, a keyboard-driven panel to tick tasks off, add and filter, and the same list in the menu. |
| Repository | <https://github.com/rastermanden/omadoist> |
| License | MIT |
| Tags | `bar`, `productivity`, `todoist`, `tasks`, `quickshell` |
| Suggested GitHub topics | `omarchy`, `omarchy-plugin`, `quickshell`, `todoist`, `todo`, `bun` |

## Long description

Omadoist puts Todoist in the Omarchy 4 bar. The open-task count sits next
to the Todoist mark and turns the urgent colour when something is overdue.
Click it for a panel that lists your tasks with due date, project and
priority; `Enter` completes one, `n` adds one inline — with a project picker,
so it lands where it belongs rather than always in the Inbox — `f` changes the Todoist
filter — any filter query works, and a refused one comes back in words with a
"did you mean" fix one click away. The same list lives under **Todoist** in
the Omarchy menu.

A five-minute background sync keeps everything current and notifies only
about tasks added or completed somewhere else — never about what you just did
here. The API token stays in a mode-600 file; the widget itself never touches
the network. Everything is themed with the shell's own components and works
with the keyboard end to end.

## Feature bullets

- Open-task count in the bar, urgent colour when overdue.
- Panel: tasks with due date, project and priority; complete with a click or `Enter`.
- Inline **New task** with a searchable project picker, and a **Filter** field
  taking the full Todoist filter language.
- Plain-language filter errors with "did you mean …" and a one-click fix.
- The list under **Todoist** in the Omarchy menu.
- Notifications only for changes made elsewhere (phone, web).
- Token in a mode-600 file, never read by the QML.
- Native theming, keyboard navigation, bar placement anywhere.

## Install

```bash
omarchy plugin add https://github.com/rastermanden/omadoist.git --enable --yes
```

Click the checkbox in the bar, choose **Set up Todoist…**, then **Connect
Todoist…** and paste your API token. Needs bun (`omarchy pkg add bun`).

Remove it cleanly with:

```bash
omadoist uninstall
omarchy plugin remove omadoist
```

Removing the plugin keeps your token and config in `~/.config/omadoist/`.

## One line

Todoist in your Omarchy bar: see what's open, tick it off, add and filter —
without leaving the keyboard.

## Artwork

Listing and README image: [preview.png](../preview.png) — a real screenshot of
the panel over a normal desktop. Retake it with the panel open and a few
harmless tasks; never include real names, notifications or other personal
data.

## Disclosures

- Omadoist talks to the Todoist REST API with your personal API token. The
  token is stored in `~/.config/omadoist/token` (mode 600) and only ever
  read by the CLI, never by the shell plugin.
- Plugins run unsandboxed as the logged-in user inside `omarchy-shell`; review
  the source before enabling it.
- The Todoist name and logo are trademarks of Doist; this project is not
  affiliated with or endorsed by Doist. The mark is the CC0 simple-icons SVG.
