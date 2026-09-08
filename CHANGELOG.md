# Changelog

<!-- <START NEW CHANGELOG ENTRY> -->

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

<!-- <END NEW CHANGELOG ENTRY> -->

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

<!-- <END NEW CHANGELOG ENTRY> -->
