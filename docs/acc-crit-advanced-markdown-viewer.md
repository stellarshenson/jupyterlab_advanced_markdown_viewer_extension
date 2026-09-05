# Acceptance Criteria - jupyterlab_advanced_markdown_viewer_extension

Open Markdown documents receive external changes from disk live, in the rendered view and in the editor. Changes are applied through the document shared model, highlighted with fading pale red (removed) and pale green (added) backgrounds, and signalled on the tab title, without losing text the user is typing.

## Authors

- `@kj` Konrad Jelen

## Change detection `DETECT`

Noticing that an open Markdown file was rewritten on disk by another process

- [ ] `ACC-DETECT-1` **Open Markdown files are watched** - CRITICAL; every Markdown document open in a viewer or editor tab is polled for a newer last_modified while its tab exists, and stops being polled when the tab closes
  - test: open a .md file, rewrite it from a terminal, assert the new content appears without a reload; close the tab, assert no further contents requests for that path
  - test-tags: UNIT, E2E
  - mechanism: 2026-09-04T19:57:21Z @kj poll contents.get(path, {content:false}) per open document; compare the content hash first and fall back to last_modified with a 500 ms margin, which is what JupyterLab core's Context does and what jupyter-collaboration fails to do (it compares mtime alone, and its tracker records both false negatives from filesystem timestamp resolution and false positives from identical-content writes)
  - mechanism: 2026-09-04T17:46:55Z @kj one poll timer per open document context, contents.get(path, {content: false}) at the configured interval, compare last_modified with context.contentsModel.last_modified recorded at the last load or save; the timer is disposed with the widget
  - log: 2026-09-04T17:46:55Z @kj added
- [ ] `ACC-DETECT-2` **Only external changes trigger a reload** - HIGH; a save made from the same JupyterLab session updates the recorded last_modified and never produces a reload, a cue or highlights
  - test: edit and save from the editor, assert no highlight and no tab cue
  - test-tags: UNIT, E2E
  - log: 2026-09-04T17:46:55Z @kj added
- [ ] `ACC-DETECT-3` **Poll interval is configurable** - HIGH; the poll interval is a setting in seconds, default 2, minimum 1, and a change takes effect on open documents without reopening them
  - test: set interval to 5, rewrite the file, assert the update lands between 5 and 10 s
  - test-tags: UNIT, E2E
  - log: 2026-09-04T17:46:55Z @kj added
- [ ] `ACC-DETECT-4` **Poll cost is bounded** - MEDIUM; a poll never fetches file content, only metadata, and the content is fetched once per detected change
  - test: record network requests for 30 s with no change, assert every request carries content=0
  - test-tags: E2E
  - log: 2026-09-04T17:46:55Z @kj added
- [ ] `ACC-DETECT-5` **Server push replaces polling when available** - LOW; when the server extension exposes a watch channel the frontend subscribes to it and disables the poll timer for that document
  - test: with the server extension enabled, assert zero contents.get polls and an update within 1 s of the write
  - test-tags: INTEGRATION, E2E
  - mechanism: 2026-09-04T17:46:55Z @kj jupyter_server websocket handler backed by a watchdog observer on the open paths; not part of the first release, polling is the baseline
  - log: 2026-09-04T17:46:55Z @kj added
  - log: 2026-09-04T19:57:21Z @kj jupyter-collaboration is not installed on this workstation and is opt-in upstream, so there is no server-side ydoc or file watcher; frontend polling is the only option without adding a server dependency
- [ ] `ACC-DETECT-6` **Edge: file removed on disk** - MEDIUM; when the poll gets 404 the tab keeps its content, the cue shows a removed state, polling stops, and no error dialog opens
  - test: delete the file from a terminal while open, assert content stays and no dialog
  - test-tags: E2E
  - log: 2026-09-04T17:46:55Z @kj added
- [ ] `ACC-DETECT-7` **Edge: file renamed in JupyterLab** - MEDIUM; renaming the document through the file browser moves the watch to the new path
  - test: rename the open file, rewrite it under the new name, assert the update lands
  - test-tags: E2E
  - log: 2026-09-04T17:46:55Z @kj added

## Applying external content `APPLY`

How new content from disk reaches the open document model without losing the user's work

- [ ] `ACC-APPLY-8` **Content is applied through the document model** - CRITICAL; the new file content is written into the document's shared model so every consumer of the model, the rendered viewer and the editor, updates through the standard pipeline
  - test: open the same file in viewer and editor, rewrite it, assert both tabs show the new text
  - test-tags: UNIT, E2E
  - mechanism: 2026-09-04T19:57:21Z @kj Differential Synchronization (Fraser 2009, ACM DocEng), single-machine common-shadow variant run in one direction: hold a shadow of the last text agreed with disk, diff shadow against the new snapshot, apply the result as positioned updateSource hunks in one outer transaction tagged with our origin; update the shadow unconditionally so a bad cycle self-corrects; never setSource, which discards every relative position
  - mechanism: 2026-09-04T17:46:55Z @kj diff old disk text against new disk text, apply the hunks as sharedModel.updateSource operations inside one Yjs transaction tagged with the extension's own origin so cursor and undo history survive and the standard contentChanged -> render -> rendered pipeline runs; never setSource of the whole text, never context.revert(), never direct DOM replacement
  - log: 2026-09-04T17:46:55Z @kj added
- [ ] `ACC-APPLY-9` **Applied content is not dirty** - CRITICAL; after an external change is applied the document is clean, the recorded last_modified equals the new disk value, and a following user save succeeds without the 'file has changed on disk' dialog
  - mechanism: 2026-09-05T07:40:06Z @kj RESOLVED: after each apply the watcher records the applied revision (hash, last_modified) on the Context through its own private _updateContentsModel, the move the Context makes for itself after a save and the collaborative drive triggers through a save event; a unit test guards the method's presence in the installed docregistry and a runtime warning names its absence; a save from the editor over unsaved edits never reaches this path and keeps the File Changed dialog, which is the editor's own conflict
  - mechanism: 2026-09-04T19:57:21Z @kj UNRESOLVED: JupyterLab core keeps the disk hash and mtime in the private Context._contentsModel and compares them in _maybeSave; merging without updating it raises the File Changed dialog on the user's next save, and there is no public setter - the only public call that updates it is revert(), whose _revert does model.fromString and destroys unsaved edits; the three options are save-after-merge, patch the private field, or accept the dialog
  - test: rewrite the file, then edit and save from the editor, assert no dialog and the save lands
  - test-tags: E2E
  - log: 2026-09-04T17:46:55Z @kj added
- [ ] `ACC-APPLY-10` **Concurrent user edits are preserved** - CRITICAL; text the user typed but has not saved is never lost or displaced when an external change is applied; hunks that do not overlap the edited lines are applied at their mapped positions
  - test: type on line 2, rewrite lines 10-12 from a terminal, assert line 2 keeps the typed text and lines 10-12 update
  - test-tags: UNIT, E2E
  - mechanism: 2026-09-04T19:57:21Z @kj three-way merge in place of Fraser's fuzzy patching: base is the shadow, ours is the live text with unsaved keystrokes, theirs is the new snapshot; a wrong fuzzy match silently corrupts a document the user is reading, a reported conflict can be routed to the user; note diff3 is not idempotent, so recovery from a bad merge is restoring the shadow, never merging again over the output
  - mechanism: 2026-09-04T17:46:55Z @kj three-way merge: base is the last text loaded from disk, ours is the model, theirs is the new disk text; non-overlapping hunks apply, overlapping hunks keep ours
  - log: 2026-09-04T17:46:55Z @kj added
- [ ] `ACC-APPLY-11` **Overlapping change keeps the user's text** - HIGH; when an external hunk overlaps lines the user changed, the user's lines stay, the document becomes dirty, and the tab cue shows the conflict state until the user saves or reloads
  - test: edit line 5 unsaved, rewrite line 5 from a terminal, assert the editor keeps the user's line 5 and the cue shows conflict
  - test-tags: UNIT, E2E
  - log: 2026-09-04T17:46:55Z @kj added
- [ ] `ACC-APPLY-12` **No apply while typing** - HIGH; an external change detected during active typing is held until 1 s after the last keystroke, then applied
  - test: type continuously for 5 s while the file is rewritten, assert the update lands about 1 s after typing stops
  - test-tags: UNIT, E2E
  - log: 2026-09-04T17:46:55Z @kj added
- [ ] `ACC-APPLY-13` **Cursor and selection survive** - HIGH; the editor cursor and selection stay on the same text after an external change is applied above or below them
  - test: place the cursor on line 20, insert 3 lines at line 1 from a terminal, assert the cursor is on the same text at line 23
  - test-tags: UNIT, E2E
  - log: 2026-09-04T17:46:55Z @kj added
- [ ] `ACC-APPLY-14` **Scroll position survives** - HIGH; the rendered view and the editor keep the same content in view after an external change is applied outside the visible region
  - test: scroll the viewer to the middle, append text at the end from a terminal, assert the visible heading is unchanged
  - test-tags: E2E
  - mechanism: 2026-09-04T17:46:55Z @kj one scroll guard installed on the rendered signal: snapshot scrollTop, wait for images, restore, abort on user wheel; it stays passive while the switch-tab scrolling fix guard is live and runs after the TOC fix hash scroll so it holds the last write
  - log: 2026-09-04T17:46:55Z @kj added
- [ ] `ACC-APPLY-15` **Undo does not revert external content** - MEDIUM; external hunks are excluded from the editor's undo stack, so undo reverts only the user's own edits
  - test: rewrite from a terminal, press undo, assert the external change stays
  - test-tags: UNIT, E2E
  - mechanism: 2026-09-04T19:57:21Z @kj sharedModel.transact(fn, false, ORIGIN) - @jupyter/ydoc passes 'undoable ? this : origin' and constructs the UndoManager with trackedOrigins Set([this]), so undoable=false both excludes the change and tags it; note updateSource calls transact with no arguments, so it must be wrapped in an outer transaction or the change lands in the undo stack looking like typing
  - mechanism: 2026-09-04T17:46:55Z @kj the external transaction origin is excluded from the shared model's undo manager tracked origins
  - log: 2026-09-04T17:46:55Z @kj added
  - log: 2026-09-04T19:57:21Z @kj open decision: exclusion is not settled. Vim pushes a reload as one undoable change for buffers under 10000 lines so undo recovers the previous text. Excluding transactions does not discard existing history, it rebases it. See docs/research-live-markdown-reconciliation.md
- [ ] `ACC-APPLY-16` **Edge: whole file replaced** - MEDIUM; a rewrite that changes every line applies as one replacement and the document still renders and stays clean
  - test: replace the entire file content from a terminal, assert the render and dirty state
  - test-tags: UNIT, E2E
  - log: 2026-09-04T17:46:55Z @kj added
- [ ] `ACC-APPLY-17` **Edge: empty file** - MEDIUM; a rewrite to an empty file leaves an empty document, no error, and the removed text highlighted then faded
  - test: truncate the file, assert empty content and a removed-text highlight
  - test-tags: UNIT, E2E
  - log: 2026-09-04T17:46:55Z @kj added
- [ ] `ACC-APPLY-18` **Edge: large file** - LOW; a 5000-line file applies an external change without blocking the UI for more than 100 ms
  - test: rewrite a 5000-line file, measure the main-thread block with the performance API
  - test-tags: E2E
  - log: 2026-09-04T17:46:56Z @kj added
- [ ] `ACC-APPLY-43` **Shadow of the last disk text is maintained** - CRITICAL; a per-document shadow holds the text last agreed with disk, is set on load, on save and after every reconciliation, and is the base of every merge; it is never shown to the user and never written to disk
  - test: load a file, type without saving, assert the shadow equals the disk text and not the model text
  - test-tags: UNIT
  - mechanism: 2026-09-04T19:57:21Z @kj Fraser's shadow. Without it the merge degenerates to a two-way diff of live against disk and the user's unsaved keystrokes are classified as deletions - which is exactly the defect in jupyter_ydoc's YUnicode.set today
  - log: 2026-09-04T19:57:21Z @kj added

## Change highlighting `HILITE`

Showing the user what an external change removed and added, in the rendered view and in the editor

- [ ] `ACC-HILITE-19` **Added text is highlighted green** - CRITICAL; text added by an external change carries a pale green background in the editor and in the rendered view
  - test: append a paragraph from a terminal, assert the new text has the added-highlight class in both tabs
  - test-tags: UNIT, E2E
  - mechanism: 2026-09-04T17:46:56Z @kj editor: CodeMirror Decoration.mark in a StateField over the added ranges, never injected DOM; viewer: on the MarkdownViewer rendered signal wrap added text nodes inside their existing block element in span.jp-AdvancedMd-added, mapping hunks to blocks with a source-to-block map; never add or remove direct children of .jp-RenderedMarkdown and never touch heading ids
  - log: 2026-09-04T17:46:56Z @kj added
- [ ] `ACC-HILITE-20` **Removed text is shown red then disappears** - CRITICAL; text removed by an external change stays visible with a pale red background for the fade duration, then is taken out of the view; the document model never contains the removed text
  - test: delete a paragraph from a terminal, assert a red ghost of it in both tabs that is gone after the fade
  - test-tags: UNIT, E2E
  - mechanism: 2026-09-05T08:34:56Z @kj the ghost rule is two-sided, matching the diff's own coarse branch: a removal is not shown when its own token count passes MAX_LCS_TOKENS or when the added range starting at the same offset passes it (DEF-HILITE-11); the added text is still marked and the tab cue fires
  - mechanism: 2026-09-04T23:59:23Z @kj a removal longer than the diff's token bound MAX_LCS_TOKENS (1000 tokens, the coarse branch) is not shown as a ghost; the added text is still marked and the tab cue fires
  - mechanism: 2026-09-04T17:46:56Z @kj editor: CodeMirror inline widget decoration rendering the removed text read-only; viewer: span.jp-AdvancedMd-removed inserted inside the block at the removal point; both removed on fade end; CSS sets only background-color and transition so code-block token colours show through
  - log: 2026-09-04T17:46:56Z @kj added
- [ ] `ACC-HILITE-21` **Highlights fade calmly** - HIGH; a highlight fades in over 300 ms and fades out over the configured duration, default 4 s, with CSS transitions and no layout jump when it leaves
  - test: rewrite the file, sample the highlight opacity at 0, 2 and 5 s
  - test-tags: E2E
  - log: 2026-09-04T17:46:56Z @kj added
- [ ] `ACC-HILITE-22` **Highlights follow the theme** - HIGH; the highlight colours come from the extension's CSS variables with light and dark defaults that keep the text readable in both JupyterLab themes
  - test: switch theme to dark, rewrite the file, assert the highlight contrast against the text
  - test-tags: MANUAL
  - log: 2026-09-04T17:46:56Z @kj added
- [ ] `ACC-HILITE-23` **Highlights survive a re-render** - HIGH; a viewer re-render triggered within the fade window keeps the highlights and their remaining fade time
  - mechanism: 2026-09-04T23:59:23Z @kj implemented as one held highlight group: the diff baseline is kept while a fade is pending, decorations re-created by a render during the hold skip their fade-in, and the fade restarts from full on every write
  - test: rewrite twice within 2 s, assert the first highlight is still visible after the second render
  - test-tags: E2E
  - log: 2026-09-04T17:46:56Z @kj added
- [ ] `ACC-HILITE-24` **Highlights do not alter the document** - MEDIUM; highlight markup exists only in the DOM and editor decorations; the file on disk and the model text contain no highlight markup
  - test: after a highlight, read the model text and the file, assert no span or class text
  - test-tags: UNIT
  - log: 2026-09-04T17:46:56Z @kj added
- [ ] `ACC-HILITE-25` **Successive changes stack** - MEDIUM; a second external change during a fade adds its own highlights and each fades on its own timer
  - mechanism: 2026-09-04T23:59:23Z @kj implemented without per-change timers: a second external change during a fade joins the held highlight and the whole group fades fadeDuration after the last change; per-group timers are not to be implemented (locked in adversarial review round 1)
  - test: two rewrites 1 s apart, assert two highlight groups with different remaining fades
  - test-tags: E2E
  - log: 2026-09-04T17:46:56Z @kj added
- [ ] `ACC-HILITE-26` **Edge: change inside a code block** - MEDIUM; a change inside a fenced code block is highlighted without breaking the syntax colouring of the block
  - test: rewrite one line of a fenced block, assert the highlight and the token colours
  - test-tags: E2E
  - log: 2026-09-04T17:46:56Z @kj added
- [ ] `ACC-HILITE-27` **Highlighting can be disabled** - LOW; a setting turns highlighting off while live updates and the tab cue keep working
  - test: disable highlighting, rewrite the file, assert updated text and no highlight class
  - test-tags: E2E
  - log: 2026-09-04T17:46:56Z @kj added

## Tab title cue `CUE`

Signalling on the document tab that new content arrived

- [ ] `ACC-CUE-28` **Tab shows an updated state** - HIGH; when an external change is applied the document tab title gets a visible updated marker
  - test: rewrite the file, assert the tab carries the updated marker class
  - test-tags: UNIT, E2E
  - mechanism: 2026-09-04T17:46:56Z @kj toggle widget.title.className through Lumino, styled with a coloured dot before the label; never inline styles on .lm-TabBar-tab, so tab-colouring extensions reconcile cleanly
  - log: 2026-09-04T17:46:56Z @kj added
- [ ] `ACC-CUE-29` **Cue clears on attention** - HIGH; the updated marker clears when the tab is activated and the user scrolls, clicks or types in it, and after the fade duration when the tab is already active
  - mechanism: 2026-09-05T07:40:06Z @kj a wheel, pointer or key event on the preview clears the updated marker only; the blocked marker is not the reader's to clear because the change it reports is still on disk
  - test: rewrite while another tab is active, switch back, click in the document, assert the marker is gone
  - test-tags: E2E
  - log: 2026-09-04T17:46:56Z @kj added
- [ ] `ACC-CUE-30` **Cue distinguishes conflict** - HIGH; a change held back or merged over user edits shows a distinct conflict marker with a tooltip naming the state
  - mechanism: 2026-09-05T07:40:06Z @kj the watcher keeps a change held back by unsaved edits and reports it once; the blocked marker stays through any interaction and ends when the change lands (document clean, applied, marker becomes updated) or when the document took it another way, a save that overwrote it or a reload that loaded it (unblocked signal, marker cleared)
  - test: produce an overlapping change, assert the conflict marker and tooltip text
  - test-tags: E2E
  - log: 2026-09-04T17:46:56Z @kj added
- [ ] `ACC-CUE-31` **Cue shows a removed file** - MEDIUM; a file removed on disk shows a removed marker until the tab is closed or the file reappears
  - test: delete the file, assert the removed marker; restore it, assert the marker clears
  - test-tags: E2E
  - log: 2026-09-04T17:46:56Z @kj added
- [ ] `ACC-CUE-32` **Cue can be disabled** - LOW; a setting turns the tab cue off while live updates keep working
  - test: disable the cue, rewrite the file, assert updated text and no marker
  - test-tags: E2E
  - log: 2026-09-04T17:46:56Z @kj added
- [ ] `ACC-CUE-71` **Tab animates while changes are arriving** - HIGH; while external changes keep arriving the tab icon pulses, and once no change has arrived for a quiet period the icon stops and the static updated marker remains
  - test: rewrite the file every second for five seconds, assert the tab carries the active class during that time and loses it within a few seconds after the last write
  - test-tags: E2E
  - mechanism: 2026-09-04T22:42:07Z @kj each applied change sets an active class on the tab title and resets a quiet timer; the timer swaps the tab to the static updated state
  - log: 2026-09-04T22:42:07Z @kj added
- [ ] `ACC-CUE-72` **Tab animation respects reduced motion** - MEDIUM; when the reader has asked the system for reduced motion, the tab icon does not animate and the static marker alone shows the change
  - test: emulate prefers-reduced-motion, rewrite the file, assert no animation on the tab icon and the marker present
  - test-tags: E2E
  - log: 2026-09-04T22:42:07Z @kj added

## Settings `CONFIG`

User settings in schema/plugin.json

- [ ] `ACC-CONFIG-33` **Extension can be disabled** - HIGH; an enabled setting, default true, stops all watching, applying, highlighting and cues when false, without a restart
  - test: set enabled false, rewrite the file, assert no update; set true, assert updates resume
  - test-tags: UNIT, E2E
  - log: 2026-09-04T17:47:05Z @kj added
- [ ] `ACC-CONFIG-34` **Settings are validated** - MEDIUM; the schema declares pollInterval, fadeDuration, highlight, tabCue and enabled with types, defaults and minimums, so an invalid value is rejected by the settings editor
  - test: enter pollInterval 0 in the settings editor, assert the validation error
  - test-tags: MANUAL
  - log: 2026-09-04T17:47:05Z @kj added

## Sibling extension compatibility `COMPAT`

The live update keeps the other Stellars Markdown extensions working; survey of 2026-09-04 in the journal

- [ ] `ACC-COMPAT-35` **GitHub alerts re-render** - CRITICAL; an external change inside or around a GitHub alert block renders the alert through the standard IMarkdownParser path; no render path bypasses the parser
  - test: rewrite a > [!NOTE] block from a terminal, assert .markdown-alert in the rendered view
  - test-tags: E2E
  - log: 2026-09-04T17:47:05Z @kj added
- [ ] `ACC-COMPAT-36` **Edit-at-content jump keeps working** - HIGH; after a live update the rendered view has the same number of direct children as the source has blocks, so the edit-at-content context menu still opens the editor at the clicked block
  - test: rewrite the file, right-click a paragraph, choose edit at content, assert the editor opens at that line
  - test-tags: E2E
  - mechanism: 2026-09-04T17:47:06Z @kj highlight spans are inline inside existing blocks; no banner, wrapper or summary node is added to .jp-RenderedMarkdown
  - log: 2026-09-04T17:47:06Z @kj added
- [ ] `ACC-COMPAT-37` **No anchor jump on live render** - HIGH; with a heading anchor in the URL hash, a live update does not scroll the view back to that anchor
  - test: navigate to #heading, scroll away, rewrite the file, assert scrollTop unchanged
  - test-tags: E2E
  - mechanism: 2026-09-05T07:40:06Z @kj handled in this extension: the controller's late scroll restore (150 ms after rendered) lands after the TOC fix's hash scroll (100 ms) and cancels it; a scroll during the restore that no wheel, pointer or key event preceded within 500 ms is another extension's and is not taken for the reader's, so the sibling needs no change
  - mechanism: 2026-09-04T17:47:06Z @kj the markdown viewer TOC fix scrolls to the hash on every rendered signal (its src/index.ts:193-198); that sibling is changed to scroll only when the hash changed since its last scroll
  - log: 2026-09-04T17:47:06Z @kj added
- [ ] `ACC-COMPAT-38` **Local whole-document writes are not external** - HIGH; a setSource by another extension, such as markdown insert content numbering or TOC update, produces no highlight, no cue and no merge
  - test: run markdown-insert:update-numbering, assert no highlight class and no tab marker
  - test-tags: UNIT, E2E
  - mechanism: 2026-09-04T17:47:06Z @kj external changes are recognised by disk last_modified, never by model contentChanged; the extension's own transaction origin marks the hunks to highlight
  - log: 2026-09-04T17:47:06Z @kj added
- [ ] `ACC-COMPAT-39` **Export sees what the user sees** - MEDIUM; live updates are held while an export-markdown command is in flight, and an export of a document holding an unsaved merge exports the on-screen content
  - test: start a PDF export of a 50-image file, rewrite the file during the export, assert the export completes with the pre-rewrite content and the update lands afterwards
  - test-tags: E2E
  - mechanism: 2026-09-04T17:47:06Z @kj commands.commandExecuted gates the apply step for export-markdown:*; the export extension reads the file from disk, so a merged document is saved before export or the export server accepts the in-memory source - a change to the export sibling
  - log: 2026-09-04T17:47:06Z @kj added
- [ ] `ACC-COMPAT-40` **Refresh view does not discard merged edits** - MEDIUM; the refresh view command on a dirty Markdown document warns before reverting or delegates to the live-update merge
  - test: make an unsaved edit, run refresh view, assert a prompt or a merge, never a silent revert
  - test-tags: E2E
  - mechanism: 2026-09-04T17:47:06Z @kj change to the jupyterlab_refresh_view_extension sibling: its context.revert() at src/index.ts:155 prompts when the model is dirty
  - log: 2026-09-04T17:47:06Z @kj added
- [ ] `ACC-COMPAT-41` **Tab colours survive the cue** - MEDIUM; the tab cue and the colourful tab extension coexist; the tab keeps its colour and the marker shows
  - test: with colourful tabs enabled, rewrite the file, assert both the colour and the marker
  - test-tags: E2E
  - log: 2026-09-04T17:47:06Z @kj added
- [ ] `ACC-COMPAT-42` **Switch-tab scroll guard cooperates** - MEDIUM; a live update within 3 s of a tab activation neither fights nor is reverted by the switch-tab scrolling fix guard
  - test: switch to the tab, rewrite the file within 1 s, assert a single stable scroll position
  - test-tags: E2E
  - mechanism: 2026-09-04T17:47:06Z @kj change to the switch-tab scrolling fix sibling: expose a guard-active signal, and cover the rendered signal too, so one guard owns a widget at a time
  - log: 2026-09-04T17:47:06Z @kj added

## Comments `NOTES`

Reader comments anchored to a block of text, stored in the Markdown file as HTML comments so a plain renderer ignores them

- [ ] `ACC-NOTES-44` **Add a comment from a selection** - CRITICAL; selecting text in the rendered preview and choosing Add Comment from the context menu creates a comment anchored to that text
  - test: select a paragraph, right-click, choose Add Comment, type and confirm; assert the comment appears in the panel
  - test-tags: E2E
  - log: 2026-09-04T22:37:49Z @kj added
- [ ] `ACC-NOTES-45` **Menu entry appears only with a selection** - HIGH; the Add Comment context-menu entry is offered only when the pointer is over rendered Markdown and text is selected
  - test: right-click with no selection and assert the entry is hidden; a hidden Lumino item is still in the DOM, so assert hidden rather than absent
  - test-tags: E2E
  - log: 2026-09-04T22:37:49Z @kj added
- [ ] `ACC-NOTES-46` **Comment is stored in the Markdown file** - CRITICAL; a comment and its anchor are written into the document as HTML comments, so the file alone carries them and no sidecar store is needed
  - test: add a comment, read the file from disk, assert the comment text and both markers are present
  - test-tags: UNIT, E2E
  - mechanism: 2026-09-04T22:37:49Z @kj an opening marker before the anchored block and a closing marker after it, both carrying the same identifier, with the comment body in the opening marker
  - log: 2026-09-04T22:37:49Z @kj added
- [ ] `ACC-NOTES-47` **Anchor markers share one identifier** - CRITICAL; the opening and closing marker of one comment carry the same identifier, and that identifier appears exactly twice in the document
  - test: add three comments, assert each identifier occurs exactly twice and no identifier is shared between comments
  - test-tags: UNIT
  - log: 2026-09-04T22:37:49Z @kj added
- [ ] `ACC-NOTES-48` **Identifier is a UUID** - HIGH; each comment identifier is a version 4 UUID, so identifiers stay unique across documents, sessions and authors with no coordination
  - test: add a comment, assert the identifier matches the version 4 UUID form
  - test-tags: UNIT
  - log: 2026-09-04T22:37:49Z @kj added
- [ ] `ACC-NOTES-49` **Markers are invisible without the extension** - CRITICAL; a document carrying comments renders identically to the same document without them in any standard Markdown renderer
  - test: render a commented document with the extension disabled, assert no marker text is visible and the rendered text equals the uncommented render
  - test-tags: E2E
  - log: 2026-09-04T22:37:49Z @kj added
- [ ] `ACC-NOTES-50` **Panel opens on the first comment** - HIGH; adding a comment to a document that had none opens the comments panel without further action
  - test: add the first comment, assert the panel becomes visible
  - test-tags: E2E
  - log: 2026-09-04T22:37:49Z @kj added
- [ ] `ACC-NOTES-51` **Panel opens for a document that already has comments** - HIGH; opening a document that already carries comments shows the panel listing them
  - test: open a document holding two comments, assert the panel is visible and lists both
  - test-tags: E2E
  - log: 2026-09-04T22:37:49Z @kj added
- [ ] `ACC-NOTES-52` **Panel can be closed and reopened** - HIGH; the panel carries a visible control that closes it, and a visible control reopens it with no comment lost
  - test: close the panel, assert it is hidden and the reopen control visible; reopen and assert the same comments are listed
  - test-tags: E2E
  - log: 2026-09-04T22:37:49Z @kj added
- [ ] `ACC-NOTES-53` **Panel is a narrow strip beside the document** - MEDIUM; the panel occupies a narrow column on the right of the preview and the document keeps the remaining width, with no overlap
  - test: open the panel, assert the rendered Markdown and the panel do not overlap and the panel is the narrower of the two
  - test-tags: E2E
  - log: 2026-09-04T22:37:49Z @kj added
- [ ] `ACC-NOTES-54` **Comments expand and collapse** - MEDIUM; each comment shows a short form in the panel and expands to its full text, independently of the others
  - test: add a long comment, assert the panel shows it collapsed, expand it and assert the full text
  - test-tags: E2E
  - log: 2026-09-04T22:37:49Z @kj added
- [ ] `ACC-NOTES-55` **Selecting a comment reveals its text** - HIGH; choosing a comment in the panel scrolls the preview so the text it is anchored to is in view
  - test: add a comment near the end of a long document, scroll to the top, select the comment, assert the anchored text is in the viewport
  - test-tags: E2E
  - log: 2026-09-04T22:37:49Z @kj added
- [ ] `ACC-NOTES-56` **Commented text is marked in the document** - HIGH; text carrying a comment is visibly marked in the rendered preview, so a reader scrolling the document sees which passages have comments
  - test: scroll through a document with three comments, assert each anchored passage carries the marker
  - test-tags: E2E
  - log: 2026-09-04T22:37:49Z @kj added
- [ ] `ACC-NOTES-57` **Comment can be removed** - MEDIUM; a comment can be deleted from the panel, which removes both of its markers and leaves the anchored text unchanged
  - test: add a comment, delete it, assert the file holds neither marker and the text is unchanged
  - test-tags: E2E
  - log: 2026-09-04T22:37:49Z @kj added
- [ ] `ACC-NOTES-58` **Comments survive an external rewrite** - HIGH; a live update that does not touch a commented passage leaves that comment anchored and listed
  - test: add a comment to paragraph one, rewrite paragraph three on disk, assert the comment is still anchored to paragraph one
  - test-tags: E2E
  - log: 2026-09-04T22:37:50Z @kj added
- [ ] `ACC-NOTES-59` **Edge: anchor destroyed by an external rewrite** - MEDIUM; when an external rewrite removes one or both markers, the comment is listed as unanchored rather than dropped silently and the panel says so
  - test: add a comment, rewrite the file on disk without its markers, assert the comment is shown unanchored
  - test-tags: E2E
  - log: 2026-09-04T22:37:50Z @kj added
- [ ] `ACC-NOTES-60` **Edge: selection spanning several blocks** - MEDIUM; a selection crossing block boundaries anchors the comment to the whole run of blocks it covers, with the markers placed outside them
  - test: select from the middle of one paragraph to the middle of the next, add a comment, assert both paragraphs are marked
  - test-tags: E2E
  - log: 2026-09-04T22:37:50Z @kj added
- [ ] `ACC-NOTES-61` **Edge: overlapping comments** - MEDIUM; two comments whose anchored passages overlap are both kept, both listed and both marked, and neither corrupts the other's markers
  - test: comment on paragraphs one and two, then on paragraphs two and three, assert both are listed and all four markers intact
  - test-tags: UNIT, E2E
  - log: 2026-09-04T22:37:50Z @kj added
- [ ] `ACC-NOTES-62` **Edge: empty comment is refused** - MEDIUM; confirming a comment with no text makes no change to the document
  - test: open the comment entry, confirm an empty body, assert the file is unchanged
  - test-tags: E2E
  - log: 2026-09-04T22:37:50Z @kj added
- [ ] `ACC-NOTES-63` **Comments can be turned off** - LOW; a setting hides the panel, the marks and the context-menu entry, and leaves existing markers in the document untouched
  - test: disable comments, assert no panel, no marks and no menu entry, and that the file still holds its markers
  - test-tags: E2E
  - log: 2026-09-04T22:37:50Z @kj added
- [ ] `ACC-NOTES-64` **Panel is shown and hidden from the context menu** - HIGH; the context menu in the rendered preview offers showing and hiding the comments panel, whether or not the document has comments
  - test: right-click with the panel open, choose Hide Comments, assert it is hidden; right-click again and choose Show Comments
  - test-tags: E2E
  - log: 2026-09-04T22:39:35Z @kj added
- [ ] `ACC-NOTES-65` **Panel has three states** - HIGH; the panel is expanded, minimap or hidden; expanded shows comment text, minimap shows only where comments sit in the document, hidden shows nothing
  - test: cycle the three states from the context menu and assert what each shows
  - test-tags: E2E
  - log: 2026-09-04T22:39:35Z @kj added
- [ ] `ACC-NOTES-66` **Panel state is stored in the document** - HIGH; the panel state is written into the Markdown file in a settings HTML comment, so the document reopens the way it was left
  - test: set the panel to minimap, close and reopen the document, assert it opens in minimap
  - test-tags: E2E
  - mechanism: 2026-09-04T22:39:35Z @kj one settings marker per document, distinct from the comment anchors, holding the extension's per-document state
  - log: 2026-09-04T22:39:35Z @kj added
- [ ] `ACC-NOTES-67` **Settings marker is rewritten whole** - CRITICAL; changing any stored setting replaces the entire settings marker, so a key this extension no longer writes disappears from the document rather than accumulating
  - test: hand-write a settings marker carrying an obsolete key, change the panel state, assert the obsolete key is gone
  - test-tags: UNIT, E2E
  - log: 2026-09-04T22:39:35Z @kj added
- [ ] `ACC-NOTES-68` **There is exactly one settings marker** - MEDIUM; a document holds at most one settings marker whatever the sequence of changes, and a document that had none gains one only when a setting is first stored
  - test: change the panel state three times, assert the settings marker occurs once
  - test-tags: UNIT
  - log: 2026-09-04T22:39:36Z @kj added
- [ ] `ACC-NOTES-69` **Edge: malformed settings marker** - MEDIUM; a settings marker that cannot be read is ignored, the panel falls back to its default state, and the marker is replaced on the next change rather than left broken
  - test: hand-write a settings marker with invalid content, open the document, assert the default state and no error dialog
  - test-tags: UNIT, E2E
  - log: 2026-09-04T22:39:36Z @kj added
- [ ] `ACC-NOTES-70` **Storing a setting does not disturb the reader** - MEDIUM; writing the settings marker leaves the rendered text unchanged and does not scroll the preview
  - test: scroll to the middle, change the panel state, assert the scroll position and rendered text are unchanged
  - test-tags: E2E
  - log: 2026-09-04T22:39:36Z @kj added

## Change animation `ANIM`

How an applied change is played out in the rendered view over time, so the reader can follow it as it happens

- [x] `ACC-ANIM-73` **Added text is typed in, not shown at once** - CRITICAL; text an external change added appears in the rendered view letter by letter, very fast, on its green background, instead of a whole phrase or paragraph landing in one frame; intent: the reader follows the change as it goes, the same way they would watch someone type, and the animation is the point of the live view alongside not needing a refresh
  - evidence: unit tests 'types added text in letter by letter' (controller.spec) and the 'typing order' describe (animate.spec); Galata 'types added text in letter by letter on its green background'; 132/132 unit tests via make test, Galata 18/18 on the installed build v0.6.8 (logs/galata.log 2026-09-05), adversarial review (architect, ux-designer, bug-hunter) rounds 4 and 5 clean, SHIP
  - test: rewrite a paragraph on disk, sample the added span's text length every 20 ms: it grows monotonically from 0 to the full length over more than one frame
  - test-tags: UNIT, E2E
  - mechanism: 2026-09-05T15:00:12Z @kj src/animate.ts ChangeAnimator: one requestAnimationFrame loop per document writes a growing prefix into the text node of every added decoration at animationSpeed characters per second; nodes of one contiguous added range are chained so they type in document order; the green fade-out is paused by the jp-AdvancedMd-typing class until the span is complete
  - mechanism: 2026-09-05T08:59:25Z @kj after decorate, each added span holds the full text but shows a growing prefix, advanced by one shared timer at animationSpeed characters per second; the document model already holds the whole change, only the view is animated; the green fade-out starts when the span is complete
  - log: 2026-09-05T08:59:25Z @kj added
  - log: 2026-09-05T15:00:12Z @kj closed
- [x] `ACC-ANIM-74` **Removed text warns before it goes** - CRITICAL; text an external change removed first stands on its red background, unchanged, then is deleted from its last letter backwards, very fast, and only then leaves the view; intent: no text disappears without warning, the reader sees what is about to go and watches it go
  - evidence: unit tests in controller.spec 'holds removed text, deletes it from the end, then takes it out' and the ghost continuation cases (S7, S9b, S10); Galata 'holds removed text, deletes it from the end, then takes it out'; 132/132 unit tests via make test, Galata 18/18 on the installed build v0.6.8 (logs/galata.log 2026-09-05), adversarial review (architect, ux-designer, bug-hunter) rounds 4 and 5 clean, SHIP
  - test: remove a sentence on disk, sample the ghost: full red text for a hold, then a text length that shrinks from the end to 0, then no ghost
  - test-tags: UNIT, E2E
  - mechanism: 2026-09-05T15:00:12Z @kj a removal ghost is decorated struck on the red background, held for GHOST_HOLD_MS (750 ms), then the animator removes characters from its end at animationSpeed and takes the element out when empty; ghosts of a later write are built from the fresh diff plus the animator's live runs so a ghost already shown never warns twice and text that left never comes back
  - mechanism: 2026-09-05T08:59:25Z @kj the ghost is decorated struck on the red background and held for a short warning pause, then the same shared timer removes characters from its end at animationSpeed until it is empty and the ghost element is taken out; a removal past the diff token bound still shows no ghost (ACC-HILITE-20)
  - log: 2026-09-05T08:59:25Z @kj added
  - log: 2026-09-05T15:00:12Z @kj closed
- [x] `ACC-ANIM-75` **Distant changes animate at the same time** - HIGH; when one write changes several paragraphs or places far apart, every added span types and every ghost deletes concurrently, not one after another; intent: a burst rewrite is followed as one event, and the animation length is set by the longest change, not by their sum
  - evidence: unit tests 'types separate blocks at the same time' (animate.spec) and the coarse-guard cases in controller.spec ('lands a rewrite past the diff token bound on the removed side at once', 'lands two distant removals whose removed middle passes the bound at once'); 132/132 unit tests via make test, Galata 18/18 on the installed build v0.6.8 (logs/galata.log 2026-09-05), adversarial review (architect, ux-designer, bug-hunter) rounds 4 and 5 clean, SHIP
  - test: rewrite two paragraphs in one write, sample both added spans in the same tick: both lengths grow in the same samples
  - test-tags: UNIT
  - mechanism: 2026-09-05T15:00:12Z @kj every run of a render shares one frame loop and one per-tick character budget (dt times speed); separate blocks start together because root-level whitespace is never decorated; a coarse render (either diff side past MAX_LCS_TOKENS) is not animated so unchanged text is never retyped
  - mechanism: 2026-09-05T08:59:25Z @kj one timer per document advances every animating span by the same character budget per tick; spans are independent, each stops when complete
  - log: 2026-09-05T08:59:25Z @kj added
  - log: 2026-09-05T15:00:12Z @kj closed
- [x] `ACC-ANIM-76` **Animation speed is a setting** - HIGH; the setting animationSpeed sets how many characters per second the typing and the deletion play at; 0 turns the animation off and text appears and leaves at once as before; intent: the speed is tuned by the user, very fast by default
  - evidence: unit tests 'a speed of 0 mid-typing completes every run on the next frame' and the speed-0 branch test in controller.spec; Galata 'animation turned off > shows the whole change at once'; 132/132 unit tests via make test, Galata 18/18 on the installed build v0.6.8 (logs/galata.log 2026-09-05), adversarial review (architect, ux-designer, bug-hunter) rounds 4 and 5 clean, SHIP
  - test: set animationSpeed to a low value and observe slow typing; set 0 and observe the whole span present on the first frame
  - test-tags: UNIT, E2E
  - mechanism: 2026-09-05T15:00:12Z @kj schema/plugin.json key animationSpeed (integer, minimum 0, default 200) read by readSettings into ILiveViewSettings; the controller passes it to ChangeAnimator.start on every render and to the running animator on a settings change; 0 makes start record nothing so the DOM is the pre-animation one
  - mechanism: 2026-09-05T08:59:25Z @kj schema/plugin.json key animationSpeed (integer, characters per second, minimum 0), read by readSettings and passed to the controller through ILiveViewSettings alongside fadeDuration
  - log: 2026-09-05T08:59:25Z @kj added
  - log: 2026-09-05T15:00:12Z @kj closed
- [x] `ACC-ANIM-77` **Reduced motion disables the typing animation** - MEDIUM; when the operating system asks for reduced motion the typing and deletion animation is off and the change lands at once, as the fades already do
  - evidence: unit tests in the 'under reduced motion' describe of controller.spec (speed 0 under a matching media query) and 'ends the animation when the operating system turns reduced motion on'; 132/132 unit tests via make test, Galata 18/18 on the installed build v0.6.8 (logs/galata.log 2026-09-05), adversarial review (architect, ux-designer, bug-hunter) rounds 4 and 5 clean, SHIP
  - test: emulate prefers-reduced-motion: reduce, rewrite the file: the added span is complete on the first frame
  - test-tags: UNIT
  - mechanism: 2026-09-05T15:00:13Z @kj the controller reads matchMedia('(prefers-reduced-motion: reduce)') (guarded for jsdom) and treats a match as speed 0, also on a change event of the media query while an animation runs
  - mechanism: 2026-09-05T08:59:25Z @kj the controller reads matchMedia('(prefers-reduced-motion: reduce)') and treats a match as animationSpeed 0
  - log: 2026-09-05T08:59:25Z @kj added
  - log: 2026-09-05T15:00:13Z @kj closed
  - log: 2026-09-05T15:01:12Z @kj reopened: reopened to name the tests exactly in the evidence line; evidence retired: unit tests for reduced motion in controller.spec (speed 0 under a matching media query, and the change listener); 132/132 unit tests via make test, Galata 18/18 on the installed build v0.6.8 (logs/galata.log 2026-09-05), adversarial review (architect, ux-designer, bug-hunter) rounds 4 and 5 clean, SHIP
  - log: 2026-09-05T15:01:12Z @kj closed
- [x] `ACC-ANIM-78` **A write during an animation continues it** - HIGH; when the next write arrives while text is still being typed, the text already typed stays on screen and only the fresh part is typed; nothing is retyped and no ghost warns twice
  - evidence: unit tests 'does not retype a run the next render continues' (animate.spec), 'never brings back a ghost already deleted when the next write inserts where it stood', 'keeps the rest of the warning pause when the next write inserts where a ghost stands', 'forgets a ghost when a write puts the removed text back exactly' (controller.spec); 132/132 unit tests via make test, Galata 18/18 on the installed build v0.6.8 (logs/galata.log 2026-09-05), adversarial review (architect, ux-designer, bug-hunter) rounds 4 and 5 clean, SHIP
  - test: rewrite twice within the animation window: the second render's added span starts at the length already shown, not at 0
  - test-tags: UNIT
  - mechanism: 2026-09-05T15:00:13Z @kj the animator keeps its runs across a render; a decoration an earlier render already showed (wasShownBefore) continues its run by mapped offset and text, otherwise lands complete; a render that creates no decorations clears the runs so stale coordinates never resurrect a ghost; a removal inside a run still typing is clipped to the shown prefix
  - mechanism: 2026-09-05T08:59:25Z @kj the per-span fresh ranges already computed for the held fade (ACC-HILITE-21) decide what still types: a slice an earlier render already showed is complete on arrival, a fresh slice types from its start
  - log: 2026-09-05T08:59:25Z @kj added
  - log: 2026-09-05T15:00:13Z @kj closed
- [x] `ACC-ANIM-79` **Headings and the document source are never animated** - HIGH; a heading changed by a write shows its new text at once, and the document model receives the whole change in one transaction; only the rendered body text is typed and deleted; intent: heading text and ids stay intact for the TOC fix and anchors, and the model never holds a partial write
  - evidence: unit tests 'leaves a decoration inside a heading complete' (animate.spec), 'never animates a heading' and 'shows a heading renamed by a write complete on the first frame' (controller.spec), 'moves a given ghost out of a heading like any other' (highlight.spec); the watcher suite is unchanged; 132/132 unit tests via make test, Galata 18/18 on the installed build v0.6.8 (logs/galata.log 2026-09-05), adversarial review (architect, ux-designer, bug-hunter) rounds 4 and 5 clean, SHIP
  - test: change a heading on disk: heading textContent equals the new text on the first frame and its id is unchanged; model text equals disk text immediately
  - test-tags: UNIT
  - mechanism: 2026-09-05T15:00:13Z @kj ChangeAnimator.start skips every decoration inside a heading (element.closest on h1 to h6), so heading text is complete on the first frame; decorate places a removal ghost outside the heading (ghostAnchor), never inside it; the watcher's apply is unchanged and the model receives the whole write at once
  - mechanism: 2026-09-05T08:59:25Z @kj decorate marks spans inside heading elements as not animatable; the watcher's apply is unchanged
  - log: 2026-09-05T08:59:25Z @kj added
  - log: 2026-09-05T15:00:13Z @kj closed
  - log: 2026-09-05T15:01:12Z @kj reopened: reopened to correct the evidence line: a cited test name did not exist; evidence retired: unit tests 'leaves a heading's text complete on the first frame' (animate.spec) and 'moves a given ghost out of a heading like any other' (highlight.spec); the watcher suite unchanged (62 original tests still pass); 132/132 unit tests via make test, Galata 18/18 on the installed build v0.6.8 (logs/galata.log 2026-09-05), adversarial review (architect, ux-designer, bug-hunter) rounds 4 and 5 clean, SHIP
  - log: 2026-09-05T15:01:12Z @kj closed
