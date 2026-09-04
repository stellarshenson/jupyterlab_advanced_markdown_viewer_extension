# Acceptance Criteria - jupyterlab_advanced_markdown_viewer_extension

Open Markdown documents receive external changes from disk live, in the rendered view and in the editor. Changes are applied through the document shared model, highlighted with fading pale red (removed) and pale green (added) backgrounds, and signalled on the tab title, without losing text the user is typing.

## Authors

- `@kj` Konrad Jelen

## Change detection `DETECT`

Noticing that an open Markdown file was rewritten on disk by another process

- [ ] `ACC-DETECT-1` **Open Markdown files are watched** - CRITICAL; CRITICAL; every Markdown document open in a viewer or editor tab is polled for a newer last_modified while its tab exists, and stops being polled when the tab closes
  - test: open a .md file, rewrite it from a terminal, assert the new content appears without a reload; close the tab, assert no further contents requests for that path
  - test-tags: UNIT, E2E
  - mechanism: 2026-09-04T17:46:55Z @kj one poll timer per open document context, contents.get(path, {content: false}) at the configured interval, compare last_modified with context.contentsModel.last_modified recorded at the last load or save; the timer is disposed with the widget
  - log: 2026-09-04T17:46:55Z @kj added
- [ ] `ACC-DETECT-2` **Only external changes trigger a reload** - HIGH; HIGH; a save made from the same JupyterLab session updates the recorded last_modified and never produces a reload, a cue or highlights
  - test: edit and save from the editor, assert no highlight and no tab cue
  - test-tags: UNIT, E2E
  - log: 2026-09-04T17:46:55Z @kj added
- [ ] `ACC-DETECT-3` **Poll interval is configurable** - HIGH; HIGH; the poll interval is a setting in seconds, default 2, minimum 1, and a change takes effect on open documents without reopening them
  - test: set interval to 5, rewrite the file, assert the update lands between 5 and 10 s
  - test-tags: UNIT, E2E
  - log: 2026-09-04T17:46:55Z @kj added
- [ ] `ACC-DETECT-4` **Poll cost is bounded** - MEDIUM; MEDIUM; a poll never fetches file content, only metadata, and the content is fetched once per detected change
  - test: record network requests for 30 s with no change, assert every request carries content=0
  - test-tags: E2E
  - log: 2026-09-04T17:46:55Z @kj added
- [ ] `ACC-DETECT-5` **Server push replaces polling when available** - LOW; LOW; when the server extension exposes a watch channel the frontend subscribes to it and disables the poll timer for that document
  - test: with the server extension enabled, assert zero contents.get polls and an update within 1 s of the write
  - test-tags: INTEGRATION, E2E
  - mechanism: 2026-09-04T17:46:55Z @kj jupyter_server websocket handler backed by a watchdog observer on the open paths; not part of the first release, polling is the baseline
  - log: 2026-09-04T17:46:55Z @kj added
- [ ] `ACC-DETECT-6` **Edge: file removed on disk** - MEDIUM; MEDIUM; when the poll gets 404 the tab keeps its content, the cue shows a removed state, polling stops, and no error dialog opens
  - test: delete the file from a terminal while open, assert content stays and no dialog
  - test-tags: E2E
  - log: 2026-09-04T17:46:55Z @kj added
- [ ] `ACC-DETECT-7` **Edge: file renamed in JupyterLab** - MEDIUM; MEDIUM; renaming the document through the file browser moves the watch to the new path
  - test: rename the open file, rewrite it under the new name, assert the update lands
  - test-tags: E2E
  - log: 2026-09-04T17:46:55Z @kj added

## Applying external content `APPLY`

How new content from disk reaches the open document model without losing the user's work

- [ ] `ACC-APPLY-8` **Content is applied through the document model** - CRITICAL; CRITICAL; the new file content is written into the document's shared model so every consumer of the model, the rendered viewer and the editor, updates through the standard pipeline
  - test: open the same file in viewer and editor, rewrite it, assert both tabs show the new text
  - test-tags: UNIT, E2E
  - mechanism: 2026-09-04T17:46:55Z @kj diff old disk text against new disk text, apply the hunks as sharedModel.updateSource operations inside one Yjs transaction tagged with the extension's own origin so cursor and undo history survive and the standard contentChanged -> render -> rendered pipeline runs; never setSource of the whole text, never context.revert(), never direct DOM replacement
  - log: 2026-09-04T17:46:55Z @kj added
- [ ] `ACC-APPLY-9` **Applied content is not dirty** - CRITICAL; CRITICAL; after an external change is applied the document is clean, the recorded last_modified equals the new disk value, and a following user save succeeds without the 'file has changed on disk' dialog
  - test: rewrite the file, then edit and save from the editor, assert no dialog and the save lands
  - test-tags: E2E
  - log: 2026-09-04T17:46:55Z @kj added
- [ ] `ACC-APPLY-10` **Concurrent user edits are preserved** - CRITICAL; CRITICAL; text the user typed but has not saved is never lost or displaced when an external change is applied; hunks that do not overlap the edited lines are applied at their mapped positions
  - test: type on line 2, rewrite lines 10-12 from a terminal, assert line 2 keeps the typed text and lines 10-12 update
  - test-tags: UNIT, E2E
  - mechanism: 2026-09-04T17:46:55Z @kj three-way merge: base is the last text loaded from disk, ours is the model, theirs is the new disk text; non-overlapping hunks apply, overlapping hunks keep ours
  - log: 2026-09-04T17:46:55Z @kj added
- [ ] `ACC-APPLY-11` **Overlapping change keeps the user's text** - HIGH; HIGH; when an external hunk overlaps lines the user changed, the user's lines stay, the document becomes dirty, and the tab cue shows the conflict state until the user saves or reloads
  - test: edit line 5 unsaved, rewrite line 5 from a terminal, assert the editor keeps the user's line 5 and the cue shows conflict
  - test-tags: UNIT, E2E
  - log: 2026-09-04T17:46:55Z @kj added
- [ ] `ACC-APPLY-12` **No apply while typing** - HIGH; HIGH; an external change detected during active typing is held until 1 s after the last keystroke, then applied
  - test: type continuously for 5 s while the file is rewritten, assert the update lands about 1 s after typing stops
  - test-tags: UNIT, E2E
  - log: 2026-09-04T17:46:55Z @kj added
- [ ] `ACC-APPLY-13` **Cursor and selection survive** - HIGH; HIGH; the editor cursor and selection stay on the same text after an external change is applied above or below them
  - test: place the cursor on line 20, insert 3 lines at line 1 from a terminal, assert the cursor is on the same text at line 23
  - test-tags: UNIT, E2E
  - log: 2026-09-04T17:46:55Z @kj added
- [ ] `ACC-APPLY-14` **Scroll position survives** - HIGH; HIGH; the rendered view and the editor keep the same content in view after an external change is applied outside the visible region
  - test: scroll the viewer to the middle, append text at the end from a terminal, assert the visible heading is unchanged
  - test-tags: E2E
  - mechanism: 2026-09-04T17:46:55Z @kj one scroll guard installed on the rendered signal: snapshot scrollTop, wait for images, restore, abort on user wheel; it stays passive while the switch-tab scrolling fix guard is live and runs after the TOC fix hash scroll so it holds the last write
  - log: 2026-09-04T17:46:55Z @kj added
- [ ] `ACC-APPLY-15` **Undo does not revert external content** - MEDIUM; MEDIUM; external hunks are excluded from the editor's undo stack, so undo reverts only the user's own edits
  - test: rewrite from a terminal, press undo, assert the external change stays
  - test-tags: UNIT, E2E
  - mechanism: 2026-09-04T17:46:55Z @kj the external transaction origin is excluded from the shared model's undo manager tracked origins
  - log: 2026-09-04T17:46:55Z @kj added
- [ ] `ACC-APPLY-16` **Edge: whole file replaced** - MEDIUM; MEDIUM; a rewrite that changes every line applies as one replacement and the document still renders and stays clean
  - test: replace the entire file content from a terminal, assert the render and dirty state
  - test-tags: UNIT, E2E
  - log: 2026-09-04T17:46:55Z @kj added
- [ ] `ACC-APPLY-17` **Edge: empty file** - MEDIUM; MEDIUM; a rewrite to an empty file leaves an empty document, no error, and the removed text highlighted then faded
  - test: truncate the file, assert empty content and a removed-text highlight
  - test-tags: UNIT, E2E
  - log: 2026-09-04T17:46:55Z @kj added
- [ ] `ACC-APPLY-18` **Edge: large file** - LOW; LOW; a 5000-line file applies an external change without blocking the UI for more than 100 ms
  - test: rewrite a 5000-line file, measure the main-thread block with the performance API
  - test-tags: E2E
  - log: 2026-09-04T17:46:56Z @kj added

## Change highlighting `HILITE`

Showing the user what an external change removed and added, in the rendered view and in the editor

- [ ] `ACC-HILITE-19` **Added text is highlighted green** - CRITICAL; CRITICAL; text added by an external change carries a pale green background in the editor and in the rendered view
  - test: append a paragraph from a terminal, assert the new text has the added-highlight class in both tabs
  - test-tags: UNIT, E2E
  - mechanism: 2026-09-04T17:46:56Z @kj editor: CodeMirror Decoration.mark in a StateField over the added ranges, never injected DOM; viewer: on the MarkdownViewer rendered signal wrap added text nodes inside their existing block element in span.jp-AdvancedMd-added, mapping hunks to blocks with a source-to-block map; never add or remove direct children of .jp-RenderedMarkdown and never touch heading ids
  - log: 2026-09-04T17:46:56Z @kj added
- [ ] `ACC-HILITE-20` **Removed text is shown red then disappears** - CRITICAL; CRITICAL; text removed by an external change stays visible with a pale red background for the fade duration, then is taken out of the view; the document model never contains the removed text
  - test: delete a paragraph from a terminal, assert a red ghost of it in both tabs that is gone after the fade
  - test-tags: UNIT, E2E
  - mechanism: 2026-09-04T17:46:56Z @kj editor: CodeMirror inline widget decoration rendering the removed text read-only; viewer: span.jp-AdvancedMd-removed inserted inside the block at the removal point; both removed on fade end; CSS sets only background-color and transition so code-block token colours show through
  - log: 2026-09-04T17:46:56Z @kj added
- [ ] `ACC-HILITE-21` **Highlights fade calmly** - HIGH; HIGH; a highlight fades in over 300 ms and fades out over the configured duration, default 4 s, with CSS transitions and no layout jump when it leaves
  - test: rewrite the file, sample the highlight opacity at 0, 2 and 5 s
  - test-tags: E2E
  - log: 2026-09-04T17:46:56Z @kj added
- [ ] `ACC-HILITE-22` **Highlights follow the theme** - HIGH; HIGH; the highlight colours come from the extension's CSS variables with light and dark defaults that keep the text readable in both JupyterLab themes
  - test: switch theme to dark, rewrite the file, assert the highlight contrast against the text
  - test-tags: MANUAL
  - log: 2026-09-04T17:46:56Z @kj added
- [ ] `ACC-HILITE-23` **Highlights survive a re-render** - HIGH; HIGH; a viewer re-render triggered within the fade window keeps the highlights and their remaining fade time
  - test: rewrite twice within 2 s, assert the first highlight is still visible after the second render
  - test-tags: E2E
  - log: 2026-09-04T17:46:56Z @kj added
- [ ] `ACC-HILITE-24` **Highlights do not alter the document** - MEDIUM; MEDIUM; highlight markup exists only in the DOM and editor decorations; the file on disk and the model text contain no highlight markup
  - test: after a highlight, read the model text and the file, assert no span or class text
  - test-tags: UNIT
  - log: 2026-09-04T17:46:56Z @kj added
- [ ] `ACC-HILITE-25` **Successive changes stack** - MEDIUM; MEDIUM; a second external change during a fade adds its own highlights and each fades on its own timer
  - test: two rewrites 1 s apart, assert two highlight groups with different remaining fades
  - test-tags: E2E
  - log: 2026-09-04T17:46:56Z @kj added
- [ ] `ACC-HILITE-26` **Edge: change inside a code block** - MEDIUM; MEDIUM; a change inside a fenced code block is highlighted without breaking the syntax colouring of the block
  - test: rewrite one line of a fenced block, assert the highlight and the token colours
  - test-tags: E2E
  - log: 2026-09-04T17:46:56Z @kj added
- [ ] `ACC-HILITE-27` **Highlighting can be disabled** - LOW; LOW; a setting turns highlighting off while live updates and the tab cue keep working
  - test: disable highlighting, rewrite the file, assert updated text and no highlight class
  - test-tags: E2E
  - log: 2026-09-04T17:46:56Z @kj added

## Tab title cue `CUE`

Signalling on the document tab that new content arrived

- [ ] `ACC-CUE-28` **Tab shows an updated state** - HIGH; HIGH; when an external change is applied the document tab title gets a visible updated marker
  - test: rewrite the file, assert the tab carries the updated marker class
  - test-tags: UNIT, E2E
  - mechanism: 2026-09-04T17:46:56Z @kj toggle widget.title.className through Lumino, styled with a coloured dot before the label; never inline styles on .lm-TabBar-tab, so tab-colouring extensions reconcile cleanly
  - log: 2026-09-04T17:46:56Z @kj added
- [ ] `ACC-CUE-29` **Cue clears on attention** - HIGH; HIGH; the updated marker clears when the tab is activated and the user scrolls, clicks or types in it, and after the fade duration when the tab is already active
  - test: rewrite while another tab is active, switch back, click in the document, assert the marker is gone
  - test-tags: E2E
  - log: 2026-09-04T17:46:56Z @kj added
- [ ] `ACC-CUE-30` **Cue distinguishes conflict** - HIGH; HIGH; a change held back or merged over user edits shows a distinct conflict marker with a tooltip naming the state
  - test: produce an overlapping change, assert the conflict marker and tooltip text
  - test-tags: E2E
  - log: 2026-09-04T17:46:56Z @kj added
- [ ] `ACC-CUE-31` **Cue shows a removed file** - MEDIUM; MEDIUM; a file removed on disk shows a removed marker until the tab is closed or the file reappears
  - test: delete the file, assert the removed marker; restore it, assert the marker clears
  - test-tags: E2E
  - log: 2026-09-04T17:46:56Z @kj added
- [ ] `ACC-CUE-32` **Cue can be disabled** - LOW; LOW; a setting turns the tab cue off while live updates keep working
  - test: disable the cue, rewrite the file, assert updated text and no marker
  - test-tags: E2E
  - log: 2026-09-04T17:46:56Z @kj added

## Settings `CONFIG`

User settings in schema/plugin.json

- [ ] `ACC-CONFIG-33` **Extension can be disabled** - HIGH; HIGH; an enabled setting, default true, stops all watching, applying, highlighting and cues when false, without a restart
  - test: set enabled false, rewrite the file, assert no update; set true, assert updates resume
  - test-tags: UNIT, E2E
  - log: 2026-09-04T17:47:05Z @kj added
- [ ] `ACC-CONFIG-34` **Settings are validated** - MEDIUM; MEDIUM; the schema declares pollInterval, fadeDuration, highlight, tabCue and enabled with types, defaults and minimums, so an invalid value is rejected by the settings editor
  - test: enter pollInterval 0 in the settings editor, assert the validation error
  - test-tags: MANUAL
  - log: 2026-09-04T17:47:05Z @kj added

## Sibling extension compatibility `COMPAT`

The live update keeps the other Stellars Markdown extensions working; survey of 2026-09-04 in the journal

- [ ] `ACC-COMPAT-35` **GitHub alerts re-render** - CRITICAL; CRITICAL; an external change inside or around a GitHub alert block renders the alert through the standard IMarkdownParser path; no render path bypasses the parser
  - test: rewrite a > [!NOTE] block from a terminal, assert .markdown-alert in the rendered view
  - test-tags: E2E
  - log: 2026-09-04T17:47:05Z @kj added
- [ ] `ACC-COMPAT-36` **Edit-at-content jump keeps working** - HIGH; HIGH; after a live update the rendered view has the same number of direct children as the source has blocks, so the edit-at-content context menu still opens the editor at the clicked block
  - test: rewrite the file, right-click a paragraph, choose edit at content, assert the editor opens at that line
  - test-tags: E2E
  - mechanism: 2026-09-04T17:47:06Z @kj highlight spans are inline inside existing blocks; no banner, wrapper or summary node is added to .jp-RenderedMarkdown
  - log: 2026-09-04T17:47:06Z @kj added
- [ ] `ACC-COMPAT-37` **No anchor jump on live render** - HIGH; HIGH; with a heading anchor in the URL hash, a live update does not scroll the view back to that anchor
  - test: navigate to #heading, scroll away, rewrite the file, assert scrollTop unchanged
  - test-tags: E2E
  - mechanism: 2026-09-04T17:47:06Z @kj the markdown viewer TOC fix scrolls to the hash on every rendered signal (its src/index.ts:193-198); that sibling is changed to scroll only when the hash changed since its last scroll
  - log: 2026-09-04T17:47:06Z @kj added
- [ ] `ACC-COMPAT-38` **Local whole-document writes are not external** - HIGH; HIGH; a setSource by another extension, such as markdown insert content numbering or TOC update, produces no highlight, no cue and no merge
  - test: run markdown-insert:update-numbering, assert no highlight class and no tab marker
  - test-tags: UNIT, E2E
  - mechanism: 2026-09-04T17:47:06Z @kj external changes are recognised by disk last_modified, never by model contentChanged; the extension's own transaction origin marks the hunks to highlight
  - log: 2026-09-04T17:47:06Z @kj added
- [ ] `ACC-COMPAT-39` **Export sees what the user sees** - MEDIUM; MEDIUM; live updates are held while an export-markdown command is in flight, and an export of a document holding an unsaved merge exports the on-screen content
  - test: start a PDF export of a 50-image file, rewrite the file during the export, assert the export completes with the pre-rewrite content and the update lands afterwards
  - test-tags: E2E
  - mechanism: 2026-09-04T17:47:06Z @kj commands.commandExecuted gates the apply step for export-markdown:*; the export extension reads the file from disk, so a merged document is saved before export or the export server accepts the in-memory source - a change to the export sibling
  - log: 2026-09-04T17:47:06Z @kj added
- [ ] `ACC-COMPAT-40` **Refresh view does not discard merged edits** - MEDIUM; MEDIUM; the refresh view command on a dirty Markdown document warns before reverting or delegates to the live-update merge
  - test: make an unsaved edit, run refresh view, assert a prompt or a merge, never a silent revert
  - test-tags: E2E
  - mechanism: 2026-09-04T17:47:06Z @kj change to the jupyterlab_refresh_view_extension sibling: its context.revert() at src/index.ts:155 prompts when the model is dirty
  - log: 2026-09-04T17:47:06Z @kj added
- [ ] `ACC-COMPAT-41` **Tab colours survive the cue** - MEDIUM; MEDIUM; the tab cue and the colourful tab extension coexist; the tab keeps its colour and the marker shows
  - test: with colourful tabs enabled, rewrite the file, assert both the colour and the marker
  - test-tags: E2E
  - log: 2026-09-04T17:47:06Z @kj added
- [ ] `ACC-COMPAT-42` **Switch-tab scroll guard cooperates** - MEDIUM; MEDIUM; a live update within 3 s of a tab activation neither fights nor is reverted by the switch-tab scrolling fix guard
  - test: switch to the tab, rewrite the file within 1 s, assert a single stable scroll position
  - test-tags: E2E
  - mechanism: 2026-09-04T17:47:06Z @kj change to the switch-tab scrolling fix sibling: expose a guard-active signal, and cover the rendered signal too, so one guard owns a widget at a time
  - log: 2026-09-04T17:47:06Z @kj added

