import QtQuick
import QtQuick.Controls as Controls
import Quickshell
import Quickshell.Io
import qs.Commons
import qs.Ui
import "Model.js" as Model

// Todoist in the bar: the open-task count beside the Todoist mark, and a
// keyboard-driven panel listing the tasks themselves.
//
// Nothing here talks to Todoist. `omadoist sync` — the systemd timer, or
// the refresh action — writes ~/.cache/omadoist/bar.json and this widget
// watches it. Completing or adding a task shells out to the same CLI, which
// re-syncs and so rewrites the file. The menu, the bar and the terminal all
// read one source.
Panel {
  id: root
  moduleName: "omadoist"
  ipcTarget: "omadoist"
  // Own the IPC target so `omarchy-shell omadoist refresh` and `add` exist
  // beside the open/close/toggle the base would register.
  manageIpc: false

  readonly property string home: Quickshell.env("HOME")
  readonly property string cacheHome: Quickshell.env("XDG_CACHE_HOME") || (home + "/.cache")
  readonly property string viewPath: cacheHome + "/omadoist/bar.json"
  // The launcher ships next to this file, so a plugin cloned by `omarchy plugin
  // add` needs nothing on PATH. The setting is for anyone who moved it.
  readonly property string bundledCommand: String(Qt.resolvedUrl("bin/omadoist")).replace(/^file:\/\//, "")
  readonly property string command: String(setting("command", "") || "") || bundledCommand
  readonly property bool showCount: setting("showCount", true) === true
  readonly property bool hideWhenEmpty: setting("hideWhenEmpty", false) === true
  readonly property string wantedIcon: String(setting("icon", "\uE900") || "")
  readonly property string wantedIconFont: String(setting("iconFont", "Omadoist Icons") || "")
  // The Todoist mark lives in a one-glyph font bundled with the plugin. Loading
  // it from here means the bar shows the real mark straight after `plugin add`,
  // with no system font install and no shell restart; `omadoist setup` still
  // installs the font system-wide for the menu rows. A custom family named in
  // the settings is used as-is when the system knows it; otherwise a Nerd Font
  // checkbox stands in rather than an empty slot.
  readonly property string defaultIconFont: "Omadoist Icons"
  readonly property bool usingBundledFont: wantedIconFont === defaultIconFont && brandFont.status === FontLoader.Ready
  readonly property bool iconFontAvailable: wantedIconFont === "" || usingBundledFont || Qt.fontFamilies().indexOf(wantedIconFont) !== -1
  readonly property string icon: iconFontAvailable ? wantedIcon : "\u{F0132}"
  readonly property string iconFont: usingBundledFont ? brandFont.name : (iconFontAvailable ? wantedIconFont : "")

  FontLoader {
    id: brandFont
    source: Qt.resolvedUrl("assets/omadoist-icons.ttf")
  }

  readonly property bool vertical: bar ? bar.vertical : false
  readonly property color foreground: bar ? bar.foreground : Color.foreground
  readonly property color urgent: bar ? bar.urgent : Color.urgent
  readonly property string fontFamily: bar ? bar.fontFamily : Style.font.family
  readonly property string glyphFont: iconFont !== "" ? iconFont : fontFamily
  readonly property color dim: Qt.darker(foreground, 1.4)
  readonly property color dimmer: Qt.darker(foreground, 1.7)
  readonly property color hoverFill: Style.hoverFillFor(foreground, Color.accent)

  property var view: Model.emptyView()
  // No bar.json yet: the plugin was just added and `omadoist setup` has not run.
  property bool viewMissing: false
  readonly property bool needsSetup: viewMissing
  readonly property var tasks: view.tasks
  readonly property bool connected: view.connected === true
  readonly property string countText: showCount ? Model.countLabel(view) : ""
  readonly property string heroMeta: needsSetup ? "Not set up yet" : Model.heroMeta(view)
  readonly property string syncedLabel: Model.syncedLabel(view.fetchedAt, new Date())

  // Task id → true while `omadoist done` is in flight. The row stays put,
  // ticked and struck through, until the next bar.json no longer lists it.
  property var pending: ({})
  // {id, title} of the last task completed here, for as long as the strip
  // under the list offers to put it back. The pending window is far too short
  // to hold this: it ends as soon as the next sync drops the row.
  property var undoable: null
  property bool undoing: false
  // The recurring task the last completion rolled forward. It never leaves the
  // list, so the tick has to be released on a timer instead.
  property string rolledForwardId: ""
  property bool refreshing: false
  property bool adding: false
  property bool composing: false
  property bool filtering: false
  property bool filterBusy: false
  readonly property string filterLabel: Model.filterLabel(view)
  // The account's projects, Inbox first, as the new-task picker offers them.
  readonly property var projectOptions: Model.projectOptions(view)
  // Which project the next task lands in; empty leaves the choice to Todoist.
  property string composeProject: ""
  readonly property string composeProjectName: Model.projectName(view, composeProject)
  // null, or {query, message, suggestion} when the last filter change was refused.
  readonly property var filterError: view.filterError
  // null, or {message, hint, reconnect} when the list on screen is older than
  // Todoist's. Re-evaluated whenever applyView hands over a fresh view object,
  // which the 60-second reload below guarantees even when nothing changed.
  readonly property var syncWarning: Model.syncWarning(view, new Date())

  // One cursor shared by keyboard and mouse; rows paint from hasCursor only.
  property bool cursorActive: false
  property int selectedIndex: 0

  visible: opened || !(hideWhenEmpty && connected && tasks.length === 0)
  implicitWidth: button.implicitWidth
  implicitHeight: button.implicitHeight

  // argv straight into exec, so a task title is never re-tokenised by a shell.
  function exec(argv) {
    Quickshell.execDetached(["bash", "-lc", 'exec "$@"', "bash"].concat(argv))
  }

  function shellQuote(value) {
    return "'" + String(value || "").replace(/'/g, "'\\''") + "'"
  }

  function applyView(raw) {
    var next = Model.parseView(raw)
    var rewritten = next.generatedAt !== view.generatedAt
    view = next
    // A project renamed, archived or never synced cannot stay selected.
    if (Model.projectName(next, composeProject) === "") composeProject = Model.defaultProjectId(next)
    pending = Model.reconcilePending(pending, next.tasks)

    // A completed recurring task comes back with its next due date. Hold the
    // tick a moment longer, now showing where it went, so the row returning
    // reads as "done, see you Tuesday" rather than as nothing having happened.
    var rolled = rewritten ? Model.justRolledForward(next, new Date()) : null
    if (rolled) {
      rolledForwardId = rolled.id
      pending = Model.withPending(pending, rolled.id)
      rolledForwardTimeout.restart()
    }

    selectedIndex = Model.clampIndex(selectedIndex, next.tasks.length)
    if (rewritten) {
      refreshing = false
      adding = false
      filterBusy = false
      // The reopened task is back in the list, so the offer has been taken.
      // Only then: every other sync — the one the completion itself triggers
      // first of all — must leave the strip standing.
      if (undoing) {
        undoing = false
        undoable = null
        undoingTimeout.stop()
      }
    }
  }

  function taskAt(index) {
    return Model.taskAt(tasks, index)
  }

  function moveCursor(delta) {
    selectedIndex = Model.clampIndex(selectedIndex + delta, tasks.length)
  }

  function activateCursor() {
    complete(taskAt(selectedIndex))
  }

  function complete(task) {
    if (!task || pending[task.id] === true) return
    pending = Model.withPending(pending, task.id)
    pendingTimeout.restart()
    // A mis-click is easy: the whole row completes on a plain left click. The
    // way back was the Todoist web app until now.
    undoable = Model.undoableFrom(task)
    if (undoable !== null) undoTimeout.restart()
    exec([root.command, "done", String(task.id)])
  }

  function undo() {
    if (undoable === null || undoing) return
    undoing = true
    undoTimeout.stop()
    undoingTimeout.restart()
    exec([root.command, "reopen", String(undoable.id)])
  }

  function refresh() {
    if (refreshing) return
    refreshing = true
    refreshTimeout.restart()
    exec([root.command, "sync"])
  }

  function startCompose() {
    if (!connected) return
    composing = true
    Qt.callLater(function() {
      addField.text = ""
      // Assigned rather than bound: the dropdown writes its own `value` when
      // the user picks, which would break a binding on the first choice.
      projectPicker.value = root.composeProject
      addField.forceActiveFocus()
    })
  }

  function cancelCompose() {
    composing = false
    addField.text = ""
    Qt.callLater(function() { keyCatcher.forceActiveFocus() })
  }

  function submitCompose() {
    var text = addField.text.trim()
    if (text === "") {
      cancelCompose()
      return
    }
    adding = true
    addTimeout.restart()
    // `--` last, so a task title may start with a dash.
    var argv = [root.command, "add"]
    if (root.composeProject !== "") argv = argv.concat(["--project", root.composeProject])
    exec(argv.concat(["--", text]))
    cancelCompose()
  }

  function startFilter() {
    if (!connected) return
    composing = false
    filtering = true
    Qt.callLater(function() {
      filterField.text = root.filterError ? root.filterError.query : root.view.filter
      filterField.selectAll()
      filterField.forceActiveFocus()
    })
  }

  function cancelFilter() {
    filtering = false
    Qt.callLater(function() { keyCatcher.forceActiveFocus() })
  }

  // An empty field is a deliberate "show everything": the CLI clears the
  // filter for "" just as it does for "all".
  function submitFilter() {
    var text = filterField.text.trim()
    filtering = false
    Qt.callLater(function() { keyCatcher.forceActiveFocus() })
    applyFilter(text)
  }

  function applyFilter(text) {
    if (text === root.view.filter && !root.filterError) return
    filterBusy = true
    filterTimeout.restart()
    exec(text === "" ? [root.command, "filter", "--clear"] : [root.command, "filter", text])
  }

  function openTodoist(url) {
    exec(["omarchy-launch-webapp", url || Model.todayUrl()])
    close()
  }

  // First run: install the font, timer, menu block and launcher in a terminal
  // the user can read, since Omarchy runs no hooks when a plugin is added.
  function runSetup() {
    exec(["omarchy-launch-floating-terminal-with-presentation", shellQuote(root.command) + " setup"])
    close()
  }

  function connectAccount() {
    exec(["omarchy-launch-floating-terminal-with-presentation", shellQuote(root.command) + " auth"])
    close()
  }

  onOpenedChanged: {
    if (opened) {
      viewFile.reload()
      cursorActive = false
      selectedIndex = 0
      composing = false
      filtering = false
      // Each visit starts at the Inbox; a choice made here sticks for as long
      // as the panel stays open, so several tasks can go to one project.
      composeProject = Model.defaultProjectId(view)
    } else {
      composing = false
      filtering = false
    }
  }

  FileView {
    id: viewFile
    path: root.viewPath
    watchChanges: true
    printErrors: false
    onFileChanged: reload()
    onLoaded: {
      root.viewMissing = false
      root.applyView(text())
    }
    onLoadFailed: {
      root.viewMissing = true
      root.applyView("")
    }
  }

  // The first read can race shell startup; one delayed reload self-corrects.
  Timer {
    interval: 1500
    running: true
    onTriggered: viewFile.reload()
  }

  // The watch can be lost when the file is replaced rather than rewritten;
  // a slow poll keeps the count honest either way.
  Timer {
    interval: 60000
    repeat: true
    running: true
    onTriggered: viewFile.reload()
  }

  // Failure paths: the CLI notifies on error but nothing rewrites bar.json,
  // so the optimistic marks would otherwise stick forever.
  Timer {
    id: pendingTimeout
    interval: 20000
    onTriggered: root.pending = ({})
  }

  // Long enough to read the new due date, short enough that the row is honest
  // again before the next glance.
  Timer {
    id: rolledForwardTimeout
    interval: 4000
    onTriggered: {
      root.pending = Model.clearPending(root.pending, root.rolledForwardId)
      root.rolledForwardId = ""
    }
  }

  Timer {
    id: refreshTimeout
    interval: 30000
    onTriggered: root.refreshing = false
  }

  // Long enough to notice the row go and reach for it, short enough that the
  // strip is not still sitting there next time the panel is opened.
  Timer {
    id: undoTimeout
    interval: 12000
    onTriggered: root.undoable = null
  }

  // The reopen is out of our hands once spawned; clear the strip either way.
  Timer {
    id: undoingTimeout
    interval: 30000
    onTriggered: {
      root.undoing = false
      root.undoable = null
    }
  }

  Timer {
    id: addTimeout
    interval: 30000
    onTriggered: root.adding = false
  }

  Timer {
    id: filterTimeout
    interval: 30000
    onTriggered: root.filterBusy = false
  }

  IpcHandler {
    target: "omadoist"

    function open(): void { root.open() }
    function close(): void { root.close() }
    function show(): void { root.open() }
    function hide(): void { root.close() }
    function toggle(): void { root.toggle() }
    function refresh(): void { root.refresh() }
    function filter(): void {
      root.open()
      root.startFilter()
    }
    function add(): void {
      root.open()
      root.startCompose()
    }
  }

  // ---------------------------------------------------------------- bar

  WidgetButton {
    id: button
    anchors.fill: parent
    bar: root.bar
    labelVisible: false
    hasVisualContent: true
    active: root.view.overdue > 0
    fixedWidth: root.vertical ? -1 : barContent.implicitWidth + scaledHorizontalMargin * 2
    fixedHeight: root.vertical ? barContent.implicitHeight + scaledVerticalPadding * 2 : -1
    tooltipText: root.opened ? "" : (root.needsSetup ? "Todoist · click to set up" : Model.barTooltip(root.view))

    onPressed: function(b) {
      if (b === Qt.RightButton) {
        root.open()
        root.startCompose()
      } else if (b === Qt.MiddleButton) {
        root.refresh()
      } else {
        root.toggle()
      }
    }

    Row {
      id: barContent
      anchors.centerIn: parent
      spacing: Style.space(5)

      Text {
        text: root.icon
        color: button.active ? button.activeColor : button.foreground
        font.family: root.glyphFont
        font.pixelSize: Style.bar.iconFont
        renderType: Text.NativeRendering
        anchors.verticalCenter: parent.verticalCenter

        Behavior on color { ColorAnimation { duration: 160 } }
      }

      Text {
        visible: !root.vertical && root.countText !== ""
        text: root.countText
        color: button.active ? button.activeColor : button.foreground
        font.family: root.fontFamily
        font.pixelSize: Style.font.body
        renderType: Text.NativeRendering
        anchors.verticalCenter: parent.verticalCenter

        Behavior on color { ColorAnimation { duration: 160 } }
      }
    }
  }

  // -------------------------------------------------------------- panel

  KeyboardPanel {
    id: panel
    anchorItem: button
    owner: root
    bar: root.bar
    open: root.opened
    focusTarget: keyCatcher
    contentWidth: panel.fittedContentWidth(Style.space(400))
    contentHeight: panel.fittedContentHeight(column.implicitHeight)

    PanelKeyCatcher {
      id: keyCatcher
      anchors.fill: parent
      // The compose field takes every key while it has focus; Esc there is
      // "cancel the task", not "close the panel".
      blocked: addField.activeFocus || filterField.activeFocus || root.composing || projectPicker.popupOpen

      onMoveRequested: function(dx, dy) {
        if (!root.cursorActive) { root.cursorActive = true; return }
        if (dy !== 0) root.moveCursor(dy)
      }
      onActivateRequested: if (root.cursorActive) root.activateCursor()
      onCloseRequested: root.close()
      onTabRequested: function(direction) { root.switchPanel(direction) }
      onTextKey: function(t) {
        if (t === "n" || t === "N") root.startCompose()
        else if (t === "r" || t === "R") root.refresh()
        else if (t === "f" || t === "F") root.startFilter()
        else if (t === "o" || t === "O") root.openTodoist("")
        else if (t === "u" || t === "U") root.undo()
      }

      Column {
        id: column
        anchors.fill: parent
        spacing: Style.space(14)

        // ---------- Hero: Todoist mark · count · last sync ----------
        PanelHero {
          title: "Todoist"
          meta: root.heroMeta
          detail: root.syncedLabel
          foreground: root.foreground
          fontFamily: root.fontFamily

          iconComponent: Component {
            Text {
              text: root.icon
              color: root.foreground
              font.family: root.glyphFont
              font.pixelSize: Style.font.display
            }
          }

          trailingControl: Component {
            Button {
              iconText: "󰑐"
              iconSpinning: root.refreshing
              tooltipText: root.refreshing ? "Syncing…" : "Refresh (r)"
              foreground: root.foreground
              fontFamily: root.fontFamily
              onClicked: root.refresh()
            }
          }
        }

        PanelSeparator {
          foreground: root.foreground
        }

        // ---------- Filter: what the list is showing; click or f to change ----------
        CursorSurface {
          id: filterRow
          visible: root.connected && !root.filtering
          width: parent.width
          implicitHeight: filterRowContent.implicitHeight + Style.space(8)
          foreground: root.foreground
          fill: root.hoverFill
          hasCursor: filterMouse.containsMouse

          MouseArea {
            id: filterMouse
            anchors.fill: parent
            hoverEnabled: true
            cursorShape: Qt.PointingHandCursor
            onClicked: root.startFilter()
          }

          PanelToolTip {
            visible: filterMouse.containsMouse
            text: "Change filter (f)"
            fontFamily: root.fontFamily
          }

          Row {
            id: filterRowContent
            anchors.left: parent.left
            anchors.right: parent.right
            anchors.leftMargin: Style.space(10)
            anchors.rightMargin: Style.space(10)
            anchors.verticalCenter: parent.verticalCenter
            spacing: Style.space(8)

            Text {
              id: filterIcon
              text: "󰈲"
              color: root.dim
              font.family: root.fontFamily
              font.pixelSize: Style.font.bodySmall
              anchors.verticalCenter: parent.verticalCenter
            }

            Text {
              width: parent.width - filterIcon.width - parent.spacing
              text: root.filterBusy ? "Applying filter…" : root.filterLabel
              color: root.view.filter !== "" ? root.foreground : root.dim
              font.family: root.fontFamily
              font.pixelSize: Style.font.bodySmall
              elide: Text.ElideRight
              anchors.verticalCenter: parent.verticalCenter
            }
          }
        }

        // ---------- Why the last filter was refused, with the fix one click away ----------
        Column {
          visible: root.connected && !root.filtering && root.filterError !== null && !root.filterBusy
          width: parent.width
          spacing: Style.space(8)

          Text {
            width: parent.width
            text: root.filterError ? root.filterError.message : ""
            color: root.urgent
            font.family: root.fontFamily
            font.pixelSize: Style.font.bodySmall
            wrapMode: Text.WordWrap
          }

          Button {
            visible: !!(root.filterError && root.filterError.suggestion)
            text: root.filterError && root.filterError.suggestion ? "Use “" + root.filterError.suggestion + "”" : ""
            iconText: "󰈲"
            bordered: true
            foreground: root.foreground
            fontFamily: root.fontFamily
            fontSize: Style.font.bodySmall
            onClicked: root.applyFilter(root.filterError.suggestion)
          }
        }

        // ---------- A sync that is not landing: say so rather than show stale rows as current ----------
        Column {
          visible: root.syncWarning !== null && !root.filtering && !root.refreshing
          width: parent.width
          spacing: Style.space(8)

          Text {
            width: parent.width
            text: root.syncWarning ? root.syncWarning.message : ""
            color: root.urgent
            font.family: root.fontFamily
            font.pixelSize: Style.font.bodySmall
            wrapMode: Text.WordWrap
          }

          Text {
            width: parent.width
            text: root.syncWarning ? root.syncWarning.hint : ""
            color: root.dim
            font.family: root.fontFamily
            font.pixelSize: Style.font.bodySmall
            wrapMode: Text.WordWrap
          }

          // Waiting fixes a network blip; it never fixes a rejected token.
          Button {
            visible: !!(root.syncWarning && root.syncWarning.reconnect)
            text: "Reconnect Todoist…"
            iconText: "󰌷"
            bordered: true
            foreground: root.foreground
            fontFamily: root.fontFamily
            fontSize: Style.font.bodySmall
            onClicked: root.connectAccount()
          }
        }

        // ---------- Filter editor ----------
        Row {
          visible: root.filtering
          width: parent.width
          spacing: Style.space(8)

          TextField {
            id: filterField
            width: parent.width - filterApply.width - parent.spacing
            placeholderText: "Todoist filter, e.g. today | overdue — empty shows everything"
            foreground: root.foreground
            font.family: root.fontFamily
            onAccepted: root.submitFilter()
            Keys.onEscapePressed: root.cancelFilter()
          }

          Button {
            id: filterApply
            text: "Apply"
            iconText: "󰈲"
            bordered: true
            foreground: root.foreground
            fontFamily: root.fontFamily
            anchors.verticalCenter: parent.verticalCenter
            onClicked: root.submitFilter()
          }
        }

        // ---------- First run ----------
        Column {
          visible: root.needsSetup
          width: parent.width
          spacing: Style.space(10)

          Text {
            width: parent.width
            text: "One step left: install the icon font, the five-minute sync timer, the menu rows and a launcher on PATH. Needs bun (omarchy pkg add bun)."
            color: root.dim
            font.family: root.fontFamily
            font.pixelSize: Style.font.bodySmall
            wrapMode: Text.WordWrap
          }

          Button {
            text: "Set up Todoist…"
            iconText: "󰐊"
            bordered: true
            foreground: root.foreground
            fontFamily: root.fontFamily
            onClicked: root.runSetup()
          }
        }

        // ---------- Not connected ----------
        Column {
          visible: !root.connected && !root.needsSetup
          width: parent.width
          spacing: Style.space(10)

          Text {
            width: parent.width
            text: "Paste an API token from Todoist → Settings → Integrations → Developer, and your tasks show up here."
            color: root.dim
            font.family: root.fontFamily
            font.pixelSize: Style.font.bodySmall
            wrapMode: Text.WordWrap
          }

          Button {
            text: "Connect Todoist…"
            iconText: "󰌷"
            bordered: true
            foreground: root.foreground
            fontFamily: root.fontFamily
            onClicked: root.connectAccount()
          }
        }

        // ---------- New task ----------
        // Title on top, then where it goes: the project picker carries the
        // Inbox by default, which is where Todoist would have put it anyway.
        Column {
          id: composeBlock
          visible: root.composing
          width: parent.width
          spacing: Style.space(8)

          // Esc cancels from the picker too, not just from the title field.
          Keys.onEscapePressed: root.cancelCompose()

          TextField {
            id: addField
            width: parent.width
            placeholderText: "What needs doing?  tomorrow p1 #Project @label"
            foreground: root.foreground
            font.family: root.fontFamily
            onAccepted: root.submitCompose()
            Keys.onEscapePressed: root.cancelCompose()
            // Tab out of the title goes to the one other decision there is.
            Keys.onTabPressed: projectPicker.open()
          }

          Row {
            width: parent.width
            spacing: Style.space(8)

            SearchableDropdown {
              id: projectPicker
              width: parent.width - addButton.width - parent.spacing
              showLabel: false
              options: root.projectOptions
              triggerLabel: "Inbox"
              placeholderText: "Search projects…"
              emptyText: "No project like that"
              foreground: root.foreground
              fontFamily: root.fontFamily
              onChanged: function(value) { root.composeProject = value }
              // Picked or dismissed, the title field gets the keys back.
              onPopupOpenChanged: if (!popupOpen && root.composing) Qt.callLater(function() { addField.forceActiveFocus() })
            }

            Button {
              id: addButton
              text: "Add"
              iconText: "󰐕"
              bordered: true
              foreground: root.foreground
              fontFamily: root.fontFamily
              anchors.verticalCenter: parent.verticalCenter
              onClicked: root.submitCompose()
            }
          }
        }

        Text {
          visible: root.adding && !root.composing
          width: parent.width
          text: root.composeProjectName === "" ? "Adding…" : "Adding to " + root.composeProjectName + "…"
          color: root.dim
          font.family: root.fontFamily
          font.pixelSize: Style.font.caption
          font.bold: true
          font.letterSpacing: 1.2
        }

        // ---------- Tasks ----------
        // ListView rather than a Flickable: it owns the scroll position, so
        // j/k keep the cursor row visible and a shrinking list re-clamps.
        ListView {
          id: taskList
          visible: root.tasks.length > 0
          width: parent.width
          height: Math.min(contentHeight, Style.space(420))
          spacing: Style.space(2)
          clip: true
          boundsBehavior: Flickable.StopAtBounds
          interactive: contentHeight > height

          Controls.ScrollBar.vertical: Controls.ScrollBar { policy: Controls.ScrollBar.AsNeeded }

          model: root.tasks
          currentIndex: root.cursorActive ? root.selectedIndex : -1
          onCurrentIndexChanged: if (currentIndex >= 0) Qt.callLater(keepCurrentVisible)
          function keepCurrentVisible() {
            if (currentIndex >= 0) positionViewAtIndex(currentIndex, ListView.Contain)
          }

          delegate: TaskRow {
            required property var modelData
            required property int index
            width: ListView.view.width
            task: modelData
            rowIndex: index
          }
        }

        // ---------- Just completed, and the way back ----------
        CursorSurface {
          visible: root.undoable !== null
          width: parent.width
          implicitHeight: undoContent.implicitHeight + Style.space(8)
          foreground: root.foreground
          fill: root.hoverFill
          hasCursor: undoMouse.containsMouse

          MouseArea {
            id: undoMouse
            anchors.fill: parent
            hoverEnabled: true
            cursorShape: Qt.PointingHandCursor
            onClicked: root.undo()
          }

          PanelToolTip {
            visible: undoMouse.containsMouse
            text: "Put it back"
            fontFamily: root.fontFamily
          }

          Row {
            id: undoContent
            anchors.left: parent.left
            anchors.right: parent.right
            anchors.leftMargin: Style.space(10)
            anchors.rightMargin: Style.space(10)
            anchors.verticalCenter: parent.verticalCenter
            spacing: Style.space(8)

            Text {
              id: undoIcon
              text: "󰕌"
              color: root.dim
              font.family: root.fontFamily
              font.pixelSize: Style.font.bodySmall
              anchors.verticalCenter: parent.verticalCenter
            }

            Text {
              width: parent.width - undoIcon.width - undoAction.width - parent.spacing * 2
              text: root.undoing ? "Putting it back…"
                : root.undoable && root.undoable.title !== "" ? "Completed “" + root.undoable.title + "”"
                : "Completed"
              color: root.dim
              font.family: root.fontFamily
              font.pixelSize: Style.font.bodySmall
              elide: Text.ElideRight
              anchors.verticalCenter: parent.verticalCenter
            }

            Text {
              id: undoAction
              visible: !root.undoing
              text: "Undo"
              color: Color.accent
              font.family: root.fontFamily
              font.pixelSize: Style.font.bodySmall
              font.bold: true
              anchors.verticalCenter: parent.verticalCenter
            }
          }
        }

        Text {
          visible: root.connected && root.tasks.length === 0 && root.undoable === null
          width: parent.width
          text: root.view.fetchedAt === "" ? "Nothing synced yet — press r to fetch your tasks."
            : root.view.filter !== "" ? "Nothing matches this filter."
            : "No open tasks. Enjoy it."
          color: root.dim
          font.family: root.fontFamily
          font.pixelSize: Style.font.bodySmall
          wrapMode: Text.WordWrap
        }

        Text {
          visible: root.connected && root.view.count > root.tasks.length
          width: parent.width
          text: (root.view.count - root.tasks.length) + " more in Todoist"
          color: root.dimmer
          font.family: root.fontFamily
          font.pixelSize: Style.font.caption
        }

        PanelSeparator {
          visible: root.connected
          foreground: root.foreground
        }

        // ---------- Actions ----------
        Row {
          visible: root.connected
          width: parent.width
          spacing: Style.space(6)

          Button {
            text: "New task"
            iconText: "󰐕"
            tooltipText: "n"
            bordered: true
            foreground: root.foreground
            fontFamily: root.fontFamily
            fontSize: Style.font.bodySmall
            onClicked: root.startCompose()
          }

          Button {
            text: "Open Todoist"
            iconText: "󰖟"
            tooltipText: "o"
            bordered: true
            foreground: root.foreground
            fontFamily: root.fontFamily
            fontSize: Style.font.bodySmall
            onClicked: root.openTodoist("")
          }
        }
      }
    }
  }

  // One task: checkbox, title, "due · project", and a priority dot. Clicking
  // anywhere on the row completes it; right-click opens it in Todoist.
  component TaskRow: CursorSurface {
    id: row
    required property var task
    required property int rowIndex

    readonly property bool isPending: root.pending[task.id] === true
    readonly property string subtitleText: Model.subtitle(task)
    readonly property string tone: Model.priorityTone(task.priority)
    readonly property color priorityColor: tone === "urgent" ? root.urgent
      : tone === "accent" ? Color.accent
      : root.dimmer

    hasCursor: root.cursorActive && root.selectedIndex === rowIndex
    foreground: root.foreground
    fill: root.hoverFill
    implicitHeight: rowContent.implicitHeight + Style.spacing.rowPaddingX
    opacity: isPending ? 0.55 : 1

    Behavior on opacity { NumberAnimation { duration: 120 } }

    MouseArea {
      id: rowMouse
      anchors.fill: parent
      hoverEnabled: true
      acceptedButtons: Qt.LeftButton | Qt.RightButton
      cursorShape: Qt.PointingHandCursor

      onContainsMouseChanged: if (containsMouse) {
        root.cursorActive = true
        root.selectedIndex = row.rowIndex
      }

      onClicked: function(mouse) {
        if (mouse.button === Qt.RightButton) root.openTodoist(row.task.url)
        else root.complete(row.task)
      }
    }

    PanelToolTip {
      visible: rowMouse.containsMouse && !row.isPending
      text: "Complete · right-click opens in Todoist"
      fontFamily: root.fontFamily
    }

    Item {
      id: rowContent
      anchors.left: parent.left
      anchors.right: parent.right
      anchors.verticalCenter: parent.verticalCenter
      anchors.leftMargin: Style.space(10)
      anchors.rightMargin: Style.space(10)
      implicitHeight: Math.max(checkbox.implicitHeight, info.implicitHeight)

      Text {
        id: checkbox
        text: row.isPending ? "󰄲" : "󰄱"
        color: row.isPending ? Color.accent : (row.hasCursor ? root.foreground : root.dim)
        font.family: root.fontFamily
        font.pixelSize: Style.font.heading
        anchors.left: parent.left
        anchors.verticalCenter: parent.verticalCenter
      }

      Column {
        id: info
        spacing: Style.space(1)
        anchors.left: checkbox.right
        anchors.leftMargin: Style.space(10)
        anchors.right: flag.visible ? flag.left : parent.right
        anchors.rightMargin: flag.visible ? Style.space(10) : 0
        anchors.verticalCenter: parent.verticalCenter

        Text {
          width: parent.width
          text: row.task.title
          color: root.foreground
          font.family: root.fontFamily
          font.pixelSize: Style.font.body
          font.strikeout: row.isPending
          elide: Text.ElideRight
        }

        Text {
          visible: row.subtitleText !== ""
          width: parent.width
          text: row.subtitleText
          color: row.task.overdue ? root.urgent : root.dim
          font.family: root.fontFamily
          font.pixelSize: Style.font.caption
          elide: Text.ElideRight
        }
      }

      Rectangle {
        id: flag
        visible: row.tone !== "none"
        width: Style.space(7)
        height: width
        radius: width / 2
        color: row.priorityColor
        anchors.right: parent.right
        anchors.verticalCenter: parent.verticalCenter
      }
    }
  }
}
