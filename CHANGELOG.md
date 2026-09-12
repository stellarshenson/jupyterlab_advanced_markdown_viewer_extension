# Changelog

<!-- <START NEW CHANGELOG ENTRY> -->

## [1.0.9] - 2026-09-12

An external change now merges around unsaved edits instead of waiting for them, the typing animation carries a jitter, and marks gained a status, an identifier copy and a table-safe form.

### Added

- A three-way merge: an agent's edits on disk are isolated as positioned hunks and land each at its own place around the reader's unsaved edits, with a shadow of the text the document and the file last agreed on as the base
- A mark carries a status, open or closed; closed marks are hidden with their paint until the panel's Show closed control lists them
- A right click on a notes row copies the mark's identifier
- An animation jitter setting, 0 to 1, that varies the time to the next character while keeping the mean at the speed set

### Changed

- Animation speed default 75 characters per second, from 50, with a quarter of jitter
- The removed-text ghost holds for the 500 ms the added highlight takes to rise, then deletes beside the typing
- The note field grows with its content as a note is typed, and keeps the browser's own context menu for paste and spelling
- A click on a marked passage whose mark already holds a note opens its row rather than a new note entry
- The tab's red square now reports a conflict as well as a held change, with words of its own naming what a save and what Reload Markdown File from Disk each keep

### Fixed

- Text inside a marked passage can be selected again; a drag over it keeps its selection
- A marking on a table row no longer splits the table: the opening marker stays on one line with its note lines escaped
- Two edits far apart in a long document are tinted apart, rather than as one replacement, past the line bound
- A rewrite of the line the reader is editing is dropped whole rather than woven into their sentence word by word
- A change whose dropped part would take half of a code fence or an HTML comment pair is refused entirely, so the preview never runs a block to the end of the document
- Reload from Disk over a conflict, and a save after one, both clear the marker without a File Changed dialog

## [1.0.8] - 2026-09-11

The 1.0.7 content published again with no change to the extension; the 1.0.7 section below is the release content.

## [1.0.7] - 2026-09-11

Everything since 1.0.5: the eight items filed after using 1.0.5, the four limitations recorded when that work shipped, and two adversarial review campaigns of six rounds each. 1.0.6 was built and installed locally throughout and never published.

### Added

- A highlight visibility setting with Low, Medium and High, written as a data attribute on the viewer widget so a change recolours the highlights already on screen
- An empty author setting signs a note @author; the identity lookup is gone
- A mark that an external rewrite broke is removed and its leftover markers deleted from the file, once the break has survived a settling step of 750 ms and only while the document holds no unsaved edits
- The plus that adds a document note shows only in the expanded panel, and is reachable there by the keyboard
- A closed notes row opens from a click anywhere on it, on its padding, its passage or its state line, and from Enter; only an open row carries the collapse triangle; a click on a note in an open row selects its row unless it ends a text selection
- Every notes row tells a screen reader whether it is open and how to change that, through a description rather than aria-expanded, which a list item may not carry
- Reload Markdown File from Disk takes a held change into the document, drops the red square and the dirty flag, and the next write is shown live; the held-change tooltip names it as the way to take the change and a save as the way to keep the reader's version

### Changed

- Animation speed default 50 characters per second, from 10; highlight duration default 5 s, from 3; the four change-highlight colours five percentage points more opaque
- The note field is a rounded box in the panel's font at the size of a row's note text, its border alone taking the theme's brand colour while focused, with the placeholder Write a note, and Cancel then Save at its right edge in the look of Add note; Add note is left out of a row while its note is being written
- A closed notes row shows no note; the notes are listed in full once the row is open
- Headings in the preview take the font's own line height, so a wrapped heading's second line no longer covers the letters of the first when selected or marked
- Only this extension's own settings stop its motion: the reduced-motion preference, which Windows reports whenever its animation switch is off, no longer silences the tab marker and the typing animation
- Galata cases that need a sibling extension skip on the continuous-integration runner, which installs none

### Fixed

- A preview opened over a document with unsaved edits had them overwritten by the file's text at open; the file's text is now held back from the moment the preview opens and no write lands over typed text
- A line pushed into a long document, past the diff's token bound, highlighted the whole document green; a middle past the bound is aligned line by line first, so two edits far apart in a document of up to 1500 lines stay two edits
- A write landing while a reload was read, or the next write after a reload with nothing held, was held behind the reload's stale dirty flag; a document whose text is the file's holds nothing back
- A passage ending at a hard line break, or at a br element written in the source, could not be marked, and a passage starting mid-line lost its first token in the panel
- The second click of a double click on the notes badge pressed the header control under it, and Save wrote a note twice
- A panel-state write no longer loses to an older state still in the file; Cancel on a new document note removes its empty marker
- A reader's Backspace no longer destroys a mark and its notes; the broken-mark deletion no longer retries for the life of the tab against a server that cannot answer
- One identifier could name two rows, so a note saved on a duplicated paragraph landed in the wrong row
- The panel discarded a note being written when its mark left the listing for a frame

## [1.0.5] - 2026-09-08

The first stable release of the notes feature. The 0.6 line was built and installed locally more than thirty times while the feature was reviewed and reworked; the builds between 0.6.41 and 1.0.2 were never published, and 1.0.3 and 1.0.4 shipped an intermediate state of this work on the same day.

### Added

- Notes on the document as a whole: a plus control in the notes panel header opens a note thread on the document itself, with no passage. The thread is stored as a document marker at the top of the file, after any YAML front matter, so any other renderer shows the document with no trace of it; the panel lists it first, with the word Document in place of a passage. It is the one route to such a note: neither the context menu nor the command palette offers it
- A notes badge at the top right of the preview while the panel is hidden, faint without notes and in the chrome's own grey with them; it opens the panel and hands the keyboard focus to the panel's Hide control. It is gone with the notes setting off
- Two more mark colours, red and green, six in all; the colours sit in one Mark submenu of the context menu, each entry drawn with the swatch the panel shows
- Two header controls that collapse the panel to the minimap and expand it back; on the strip the hide control sits at the top, the plus and the expand caret below it
- The minimap's ticks carry a border in the theme's border colour, so a tick at the muted alpha is still found on the strip

### Changed

- The mark highlights are muted to a fifth of the colour at most, and the swatches, dots and menu icons follow; the yellow, blue, pink and orange highlights stay apart from the change highlights, and red and green are told from a change by staying where a change fades
- The notes panel header: the collapse caret leads it at the left edge, then the count, the plus, the expand caret and the hide control; the hide control says what it hides, Hide notes or Hide minimap
- The removal control of a row is a trash icon set apart at the right of the colour dots; the bordered buttons share one 24 px height
- Marking clears the text selection and leaves the caret at the end of the marked passage; adding a note neither renders nor scrolls the preview
- The notes toolbar button is gone, so the preview toolbar stays a micro strip; the panel is reached from the context menu, the palette and the badge
- The README gains a Usage section and four screenshots taken in the JupyterLab Dark theme
- The build Makefile is at 1.39: its upgrade target reports dependency advisories instead of forcing fixes that downgraded the JupyterLab packages

### Fixed

- A mark retried after a refused write could land on other words when a change during the write moved, closed or replaced the selected passage; a mark is now written around the words the reader selected or not at all
- A render the viewer still needed was dropped when the document moved before a marker write
- The note entry was unthemed in the dark theme; the focused row and the note field drew the browser's own focus ring; the note field had no accessible name
- Add note scrolled the passage the reader was already at, and the passage left the view when the panel opened beside it
- Keyboard focus fell to the page body after Save, Cancel, Expand, Collapse, Hide and the badge, and when a panel action took the focused row away
- A note continuing on a second line read as a second note in the tooltip
- A bright unthemed ring framed the rendered Markdown after its tab came back to the front
- Both header carets showed in every panel state on an intermediate build
- The scroll restore after a tab activation was skipped for three seconds
- A document note asked for twice wrote a second document marker; a hand-paired document marker was painted as a passage
- A press on Add note with a draft typed on another row did nothing, and a draft in a collapsed row left every Add note dead; the press now lands in the field that holds the draft, its row re-opened, and a field holding only whitespace counts as no draft, as Save reads it
- A document marker that arrived with the press's own refresh was answered before the panel had listed it, so the entry did not open

<!-- <END NEW CHANGELOG ENTRY> -->

## [0.6.41] - 2026-09-08

### Added

- A keyboard route to marking: select a passage with caret browsing (F7) and press Accel Shift M, or run Mark the selected passage from the command palette
- Marks are written through the extension's own server route, which compares the file with what the preview holds and writes under a lock, so marking while an agent streams writes raises no File Changed dialog and the preview keeps following
- A tooltip on the turning half circle, the marker of the commonest state, naming it in words as the held square and the missing cross already did; every marker tooltip keeps the document's own Name, Path and Last Modified lines below it

### Changed

- The mark flash and the removal ghost's fade keep running when the operating system asks for reduced motion: a colour or opacity ramp is not motion, and suppressing them cost a reader the signal locating a chosen passage and put the layout jump at removal back on screen. The three tab markers, which do move, still stand still under that preference
- The grey of the mark flash is themed, so choosing a row in the notes panel is visible over a dark theme; the previous grey sat within a tenth of a percent of the yellow mark's own lightness there

### Fixed

- A file with CRLF line endings gained one carriage return per line on every save once the preview had opened it
- A mark made while writes streamed in faster than one every 200 ms could raise the File Changed dialog, where Overwrite discarded the writer's lines; a line could also be lost with no dialog at all
- A note typed into the panel could reach no document while the note box closed as though it had been saved, when the reader typed in the editor or a second write landed inside the mark's own write
- Marking a passage while a write was in flight could apply the mark's edits twice, mark the document clean while it differed from disk, and write the garbled text to the file on the next mark
- Add note and a click on a passage opened no note entry while the panel was a minimap or hidden, and on the delayed path the mark was written but the note box never opened
- The note caret jumped to the end of the draft on every external write
- An applied write collapsed the reader's selection, so a mark could not be made while a document was being written to
- A note was discarded without a word when the mark's markers had vanished from the file before Save
- The passage a note was being written about carried no highlight until the viewer's own render timeout had run
- A passage flashed for an earlier row kept its flash and played it again when the tab was hidden and shown
- Panel buttons were announced to assistive technology by their glyph instead of their title

## [0.6.28] - 2026-09-07

### Added

- Marks and notes kept in the Markdown file itself: select a passage in the rendered view and mark it in one of four colours, with notes attached to it. A mark is a pair of HTML comments around the passage, so any other renderer shows the document with no trace of it
- A notes panel beside the preview listing the marks of the open document, each with its passage and its notes; a narrow strip of ticks instead, or hidden. The state is written into the file, so a document opens the way it was left
- Settings `notes` (on by default) and `author`, the handle a note line opens with; empty, the name the lab reports for the reader is used
- Change detection through operating-system file events: one WebSocket shared by every open preview, one watch per directory on the server, and a batched check for filesystems that raise no events. A change now appears within half a second instead of within a poll interval
- A still cross on the tab for a document whose file has been deleted, distinct from the held-change square by shape and by movement
- A tooltip naming the state of a tab that carries a held change or a missing file

### Changed

- The tab marker for an arriving change is a half-filled circle that turns, faster while changes keep arriving than after the writer has gone quiet, replacing the dot that pulsed
- The highlight rises over half a second, holds its colour, then drains over the last three quarters of a second, instead of vanishing at nearly full colour
- `pollInterval` is now the fallback interval for filesystems that raise no events; `animationSpeed` defaults to 10 characters per second
- A change held back because the document has unsaved edits is applied through the switch-tab scrolling fix sibling's own guard marker rather than a fixed three-second guess
- Marking a passage in a document that holds unsaved edits no longer saves them: the marker reaches disk with the reader's own next save

### Fixed

- With live updates turned off, a change on disk could still replace the text in the preview through the refresh a marker write asks for, or when a held change became clean; the switch is now tested where the file is read
- A removal ghost inside a fenced code block could carry text from the paragraph after the block
- A change that emptied a document showed no record of what went; the ghost is now placed in the first surviving block, and a render left with no block at all shows none by design
- A deletion in the moments after a preview opened could be taken for the baseline and never reported
- A document served from another drive could show the file-gone marker although the file was there
- A document reached through a symbolic link stopped raising events when the link was repointed
- A burst of writes from a process still writing is now reported while it writes, instead of only once it stops

## [0.6.10] - 2026-09-06

### Added

- Changes play out as typing in the rendered view: added text grows letter by letter on its green background in every changed place at once; removed text stands red for a pause, then is deleted from its last letter backwards
- Settings `animation` (on by default) and `animationSpeed` in characters per second, default 200; off, or speed 0, shows a change at once; a reduced-motion preference turns the animation off
- A write arriving during an animation continues it: shown text is not retyped and a ghost already shown warns once
- Screenshots and a video of the typing animation and of the tab cue under `docs/images/`, embedded in the README

### Changed

- The `enabled` setting description states the off state: the preview keeps what it showed until the document is reloaded and nothing else in the extension runs
- README gains a Settings section listing every key with its default

### Fixed

- A ghost already on screen no longer fades in again when the word at its offset is replaced twice within one fade
- A short removal keeps its ghost when the same write appends a long section beside it

## [0.6.8] - 2026-09-05

### Added

- Live Markdown preview: an open rendered Markdown document follows the file on disk without a manual reload
- Change highlighting in the rendered view: added text on a pale green background, removed text struck through as an inline ghost, both fading out
- Document tab marker for an arrived change, a pulsing icon while changes keep arriving, and a red marker for a change held back by unsaved edits
- Settings: poll interval, fade duration, highlight on or off, tab cue on or off, extension enabled
- Reader position is restored after each applied change, including against another extension's anchor scroll
- Jest suite (62 tests) for the diff, the decorations, the controller and the watcher; Galata suite (15 tests) for the end-to-end behaviour

### Changed

- A save from the editor after an applied external change no longer raises the File Changed dialog; the document context records the applied revision
- A change arriving while the document has unsaved edits is held until the document is clean, reported once, and dropped once a save or reload took it

### Fixed

- Word replacement ghost separated from its replacement by a gap
- Changed SVG text labels no longer vanish during the fade
- Fade timer cleared when a settings change removes the decorations
- Held writes fade in text in regions that carried no highlight before
- Ghost suppression follows both sides of the diff's coarse branch
