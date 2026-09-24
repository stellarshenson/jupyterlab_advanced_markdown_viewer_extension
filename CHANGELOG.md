# Changelog

<!-- <START NEW CHANGELOG ENTRY> -->

## [1.0.23] - 2026-09-24

The preview no longer jumps when a document with pictures is rendered again, and a comment keeps its list item, quote or paragraph intact.

### Changed

- The text in view stays where it is when the file is rewritten on disk or typed in beside the preview, also across rewrites in quick succession. The preview keeps the first block of text in view at its place instead of restoring a pixel offset after a delay
- A picture is not downloaded again on every render. A changed picture file is downloaded in the background and shown once it has loaded, so the picture never shows empty and the text above or below it does not move; a deleted picture file shows as missing
- A scroll you make while the preview renders again, with the wheel, the scrollbar or the keyboard, is kept instead of being pulled back
- The context menu entry that opens a note reads **Add Comment**, and the note box reads Write a comment

### Fixed

- A comment on a list item whose first line is a fence or a heading, or on an item of a nested list, moved the item out of its list
- A comment started right after a closing fence, a thematic break, a heading with closing hashes, a GitHub alert line or a hard line break changed what that line was
- A note on a comment whose marker sits in a blockquote was printed on the page
- A comment started right after a link reference definition broke the definition, and its links showed as plain text

## [1.0.22] - 2026-09-22

A drawn Mermaid diagram, and text a character reference holds together, can now carry a mark and a note.

### Added

- Right-click a drawn Mermaid diagram and pick a colour under Mark, or choose Add note: the whole picture takes the mark's colour. The diagram keeps drawing, and the mark's row in the notes panel scrolls the picture into view and rings it
- A passage whose words a character reference holds together, such as `In&nbsp;Scope` in a raw HTML chip, can be marked. The words of the file are now read through the browser's own character table, the one the renderer itself decodes with, so the words on the page and the words in the file are the same words

### Changed

- The three beats of a removal, the rise, the strike and the drain, keep their order at every highlight duration rather than only above one second, and a highlight a further change carries gives up its rise and its strike instead of restarting them

### Fixed

- Marking a diagram inside a GitHub alert, such as `> [!NOTE]`, wrote the opening marker into the fence's own first line, and the diagram stopped drawing
- A marker written on a line of its own now carries the blockquote markers and the indentation of the block it belongs to, so it stays inside the same quote or list item
- A line of inline code spans, and a backtick in a fence's info string, were read as opening a fenced block, which put markers inside the reader's own text
- The note box in the notes panel no longer draws a scrollbar along its bottom edge on macOS

## [1.0.21] - 2026-09-21

The colour squares in the notes panel stop glaring in the dark theme, and Shift Enter saves a note.

### Added

- Shift Enter in the note box saves the note, doing what the Save button does; Enter on its own still starts a new line

### Changed

- In a dark theme the colour square on a notes panel row, and on a Mark menu entry, is now the mark's own colour laid over the panel at a transparency worked out for that theme, so it sits quietly beside the text instead of standing as far as 6.8 to 1 away from it. Its 1 px edge is the same colour at a weaker transparency, so the edge is darker than the square rather than brighter. In a light theme the squares are unchanged, because a transparency over a pale page washes a colour out rather than calming it
- Each square is now worked out against every surface it is drawn on, the Mark menu included. That menu is painted darker than the panel, and a square worked out against the panel alone stood too far off there

## [1.0.20] - 2026-09-21

The colour squares in the notes panel keep the mark's own colour instead of a darkened stand-in.

### Changed

- The colour square on a notes panel row, and on a Mark menu entry, is the mark's own colour with a thin rim around it: the rim holds the 3 to 1 a graphical object is asked for, so the colour inside it no longer has to be darkened to reach that bar. In the light theme yellow, orange and green stop arriving as muddied versions of themselves; in the dark theme nothing changes

## [1.0.19] - 2026-09-21

A mark whose passage a change took away still shows where it belonged.

### Added

- A mark whose passage the preview no longer holds is drawn as a thin bar at the place the mark began, in the mark's own colour: selecting its row in the notes panel scrolls the bar into view and flashes it, clicking the bar opens the row, and hovering it names the mark's state, its passage and its notes
- The bar keeps its colour under Windows High Contrast, taking that palette's own colours rather than the theme's

### Changed

- A tick in the collapsed notes panel says whether its mark is hidden or unanchored before it says the passage, and a hidden mark's tick gives up its colour as its passage does

## [1.0.18] - 2026-09-19

The colour squares in the notes panel are readable against the page they sit on, and your notes are signed with a handle you are asked for once.

### Added

- The first note you write with no handle set asks for the initials your notes are signed with, and **Set note handle** in the command palette changes them afterwards

### Changed

- The colour square on a notes panel row is worked out from the background the page is actually painted with, so it holds at least 3 to 1 against it, and it is worked out again whenever the theme changes
- A note written with no handle set is signed `@user`, where it was signed `@author` before

## [1.0.17] - 2026-09-17

A drag in the preview offers Add note and Mark on macOS Safari as it does on the other browsers.

### Fixed

- On macOS Safari a drag in the rendered view left Add note and Mark out of the context menu: the selection is now read from the text the range holds rather than the browser's collapsed flag, and a selection the browser drops for the opening menu is kept for the command the menu runs
- A drag across a horizontal rule, a live selection holding no text, is treated as a deselection

## [1.0.16] - 2026-09-15

No change from 1.0.15; the same code is published again.

## [1.0.15] - 2026-09-15

A row in the notes panel shows the state of its mark, and a thread at rest shows only its text.

### Changed

- The eye and the trash of an open row sit at the right of the row's top line, beside the passage, because both act on the whole mark; Comment and Reply stay under the thread
- The triangle that closed an open row is gone: a click on the row's top line, or Enter on the row, closes it
- The eye on a row shows whether the mark is visible: an open eye while the mark is shown and a crossed eye while it is hidden, and pressing it still closes or reopens the mark
- Replies are listed one after another under the comment, without an indent
- A closed row no longer carries the word closed; its passage text is drawn in the secondary text colour
- The edit icon and the x of a note are drawn only while the pointer is on that note or one of the two icons holds the keyboard focus

## [1.0.14] - 2026-09-15

The controls of a row in the notes panel are readable and easier to hit, the colour of a mark is chosen from the row's own swatch, and the time on a note follows JupyterLab rather than the browser.

### Added

- The colour swatch at the left of a row rolls the other five colours down: pick one to recolour the mark, press the swatch again, Escape or anywhere else to roll them back up

### Changed

- The buttons of a row are set in the interface font size again, with every icon control a 24 pixel target holding a 16 pixel icon
- An entry's edit icon and x sit at the right of its first line, so the note text keeps the full width of the row
- The six colour dots are gone from a row's controls, replaced by the swatch of the row itself
- The header control that lists the closed marks reads Show hidden in both states and says which state it is in
- The time on a note entry reads on a 24 hour clock, in the language JupyterLab is set to rather than the language the browser is set to; the tooltip still carries the UTC time the file holds

## [1.0.13] - 2026-09-15

Each mark in the notes panel holds a comment thread whose entries can be edited and deleted, and the address of a link in the preview can be copied.

### Added

- **Copy link address** in the context menu of a link in the preview puts the address the link opens on the clipboard: a link to another file gives that file's address on the server without the session token, and the paragraph mark beside a heading gives the address of that heading
- Every entry of a mark carries an edit icon and an x in its top right corner: the edit icon opens the entry's text for editing and keeps its author and time, and the x deletes the entry at once; deleting the last entry leaves the mark in place
- An opened note field is scrolled into the notes panel together with its Save and Cancel buttons, and the preview does not move

### Changed

- The entries of a mark read as a comment and its replies: the first entry is the comment, every later entry is drawn indented as a reply, and the row's button reads Comment on a mark with no entry and Reply once it holds one, in place of Add note
- Close and Reopen on a row are eye icons: a crossed eye closes the mark and an open eye reopens it
- While a row's note field is open, the row offers no Close or Reopen and its other entries show no edit icon or x
- The buttons of a row are set in the smaller interface font size

## [1.0.12] - 2026-09-14

A note can be added to a heading of one or two words, and a triple-click on a block marks that block alone.

### Fixed

- A heading of one or two words, such as `### Hard criteria`, could not be marked or given a note: the `¶` link JupyterLab adds to every heading was read as part of the heading's last word, so the words no longer matched the file
- A triple-click on a heading or a paragraph marked the block below it as well as the block the reader selected

### Changed

- The context-menu and palette commands describe the arguments they take, and their labels and the note box's accessible name go through JupyterLab's translator

## [1.0.11] - 2026-09-14

Copy Content now takes the passage the reader selected, framed by the tag that gives it its meaning, and the ten sibling Markdown extensions are declared as dependencies of this one.

### Added

- Copy Content puts the selected passage on the clipboard, and the whole rendered document only when nothing is selected
- A selected table row, or a run of rows, arrives at the paste target inside its own table with its cells intact, and a selected fenced block arrives inside its `pre`, so the program keeps its line breaks instead of joining onto one line
- A selection holding a picture and no words - an image, a drawn formula, a rendered diagram - is copied as that picture rather than read as no selection at all
- The ten sibling Markdown extensions are required dependencies of this package, so installing it installs the family it is built to work beside

### Changed

- The copy answers from the selection this extension records when the browser has lost the live one, which is what an open context menu and the command palette's search field both do
- An external change writes each frame of its typing as the smallest edit that reaches the new text, so a selection made over words an agent is still typing stays where the reader put it
- The reader's selection is put back while a context menu stands open, so a change arriving behind the menu no longer costs them the passage they had chosen

### Fixed

- A read of the file already under way when a save completed could put the just-saved text back to what it had been; such a read is now dropped, and the save's own file event carries the correct bytes
- A fenced block selected inside the green paint on newly added text kept its words but lost the `pre` that says its line breaks are the content

## [1.0.10] - 2026-09-13

A Copy Content entry puts the rendered document on the clipboard as basic HTML, and a note entry left empty is cancelled when the reader clicks away.

### Added

- Copy Content, in the preview's context menu and in the command palette: the whole rendered document goes on the clipboard as HTML carrying the tags and the words alone, with no class, no style, no identifier and none of the colours the theme or this extension paint with, so a paste into a mail client arrives as headings, paragraphs, lists, tables, links, images and code and nothing else
- The same copy carries the words a second time as plain text, for a target that takes no HTML

### Changed

- A note entry the reader typed nothing into is cancelled when they click away from the notes panel or select another mark, leaving the marking in place; an entry holding typed text stands until they save or cancel it
- A copy taken while an external change is still typing in carries the finished text: the typing completes on the spot, and a removal ghost keeps its hold

### Fixed

- An empty note on the document as a whole keeps or removes its marker by what the reader did rather than by what the panel's latest parse listed: a marker on a mark they closed is kept, and one whose mark a single parse of a streamed rewrite missed is still taken out

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
