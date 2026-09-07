# Defects - jupyterlab_advanced_markdown_viewer_extension

Observed wrong behaviour of the extension and the trail of what was tried against it.

## Authors

- `@kj` Konrad Jelen

## Change highlighting `HILITE`

Defects in the rendered-view decorations

- [x] `DEF-HILITE-1` **Added block wraps the whitespace between blocks** - MAJOR; when an external change appends a block, the newline text node markdown-it emits between blocks is marked as added and wrapped in a span, which becomes a new direct child of .jp-RenderedMarkdown and breaks the block count edit-at-content relies on
  - evidence: unit test 'never wraps the whitespace between blocks when a block was added' in `src/__tests__/highlight.spec.ts` passes (36/36) and Galata 'adds no direct child to the render root' passes, logs/galata.log 2026-09-05, 10/10 on version 0.1.3
  - repro: open a preview, rewrite the file with one extra paragraph, count root.children before and after: one more than the block count
  - test-tags: UNIT, E2E
  - root-cause: 2026-09-04T22:49:49Z @kj decorate() wrapped every span overlapping an added range, including text nodes whose parent is the render root
  - log: 2026-09-04T22:49:49Z @kj added
  - log: 2026-09-04T22:55:27Z @kj closed
- [x] `DEF-HILITE-6` **Word replacement ghost is glued to its replacement** - MINOR; a replaced word renders as the struck old word immediately followed by the new word with no separator, reading as one fused token
  - evidence: unit tests 'adds a gap after a ghost whose replacement starts with a word' and 'adds no gap when the ghost ends at punctuation' in `src/__tests__/highlight.spec.ts`; Galata 'separates a struck word from its replacement' asserts the ::after content holds a non-breaking space; Galata 15/15 on the installed build v0.6.7 (logs/galata.log 2026-09-05), unit suite 62/62 via make test, adversarial review rounds 9 and 10 adjudicated clean (SHIP)
  - repro: rewrite 'mentions apples.' to 'mentions oranges.': the preview shows 'apples.oranges.' with the first struck
  - test-tags: E2E
  - root-cause: 2026-09-05T07:39:51Z @kj confirmed; resolved with a generated gap after a ghost whose text ends in a word and whose following text starts with one: class jp-AdvancedMd-gap, a non-breaking space in an inline-block ::after so the strike does not cross it; no property is set on the ghost's own box
  - root-cause: 2026-09-04T23:22:21Z @kj the ghost is inserted at the removal offset and the replacement starts at the same offset; no box model property may be set on decorations; adversarial review round 1 finding F10
  - log: 2026-09-04T23:22:21Z @kj added
  - log: 2026-09-05T08:34:56Z @kj closed
- [x] `DEF-HILITE-7` **Changed SVG text labels vanish for the fade window** - MINOR; a decoration span inserted inside an SVG text element is not an SVG element, so a changed diagram label is unpainted until undecorate restores it
  - evidence: unit tests 'reads HTML inside a foreignObject but never SVG text' and 'leaves a changed SVG label untouched' in `src/__tests__/highlight.spec.ts`; Galata 15/15 on the installed build v0.6.7 (logs/galata.log 2026-09-05), unit suite 62/62 via make test, adversarial review rounds 9 and 10 adjudicated clean (SHIP)
  - repro: render a mermaid diagram, change a node label on disk: the label disappears for fadeDuration plus 300 ms and then returns
  - test-tags: UNIT
  - root-cause: 2026-09-05T07:39:51Z @kj confirmed; resolved in captureText by reading past text nodes whose parent is in the SVG namespace, so a diagram label is never wrapped; HTML inside a foreignObject is still read and decorated
  - root-cause: 2026-09-04T23:22:21Z @kj captureText accepts text nodes inside SVG and decorate wraps them in HTML spans; adversarial review round 1 finding F17
  - log: 2026-09-04T23:22:21Z @kj added
  - log: 2026-09-05T08:34:56Z @kj closed
- [x] `DEF-HILITE-8` **Fade timer outlives decorations cleared by a settings change** - MINOR; turning highlight or the extension off during a fade removes the decorations but leaves the fade timer pending, so the next external change within that window is treated as held: its decorations skip the fade-in and the diff baseline stays put until the orphaned timer fires
  - evidence: unit test 'a settings change during a fade ends the fade and the next change fades in' in `src/__tests__/controller.spec.ts`; Galata 15/15 on the installed build v0.6.7 (logs/galata.log 2026-09-05), unit suite 62/62 via make test, adversarial review rounds 9 and 10 adjudicated clean (SHIP)
  - repro: apply a change, within 4 s set highlight=false then true, apply another change: the new spans carry --jp-AdvancedMd-fade-in: 0ms
  - test-tags: UNIT
  - root-cause: 2026-09-05T07:39:51Z @kj confirmed; resolved by clearing the fade timer inside _clearDecorations and by advancing the diff baseline to the text on screen whenever a fade ends early (_endFade), so the next change is diffed alone and fades in
  - root-cause: 2026-09-04T23:59:23Z @kj _clearDecorations does not clear _fadeTimer; only dispose and the fade callback do; adversarial review round 5 finding 2, adjudicated immaterial; remedy is moving the timer clear into _clearDecorations
  - log: 2026-09-04T23:59:23Z @kj added
  - log: 2026-09-05T08:34:56Z @kj closed
- [x] `DEF-HILITE-9` **Held write skips the fade-in in regions never tinted before** - MINOR; while a fade is pending every re-created decoration gets a zero fade-in, including spans over text in a block that carried no highlight before, so that text appears at full tint instantly instead of over 300 ms
  - evidence: unit tests 'cuts a held run where the fresh part begins' in `src/__tests__/highlight.spec.ts` and 'fades in a region never tinted before during a held fade' in `src/__tests__/controller.spec.ts`; Galata 15/15 on the installed build v0.6.7 (logs/galata.log 2026-09-05), unit suite 62/62 via make test, adversarial review rounds 9 and 10 adjudicated clean (SHIP)
  - repro: apply a change to paragraph one, within the fade apply a change to paragraph two: paragraph two's span has --jp-AdvancedMd-fade-in: 0ms
  - test-tags: UNIT
  - root-cause: 2026-09-05T07:39:51Z @kj confirmed; resolved by a per-span decision: during a fade the controller also diffs the previous render against this one and passes those fresh ranges to decorate, which cuts an added run where the fresh part begins and gives only the part an earlier render already tinted a zero fade-in; a ghost is held when the fresh diff has no removal at its offset
  - root-cause: 2026-09-04T23:59:23Z @kj the hold decision is per render, not per span; a per-span decision needs the previous decoration's snapshot offsets; adversarial review round 4 and 5 finding 1, adjudicated immaterial and deferred as not earned
  - log: 2026-09-04T23:59:23Z @kj added
  - log: 2026-09-05T08:34:56Z @kj closed
- [x] `DEF-HILITE-10` **Held ghost re-fades when the same position is replaced twice within one fade** - MINOR; isFreshRemoval matches a removal to the fresh diff by offset only, so a ghost already on screen at that offset is treated as new when the word there is replaced again inside the fade window and dips from transparent for 300 ms; adversarial review round 6 finding 4, deferred by the adjudicator as cosmetic
  - evidence: unit tests 'holds a ghost already on screen when the word at its offset is replaced again' and 'fades in a ghost of text this render removed' in `src/__tests__/highlight.spec.ts`, 132/132 pass; Galata 18/18 on the installed build (logs/galata.log 2026-09-05)
  - root-cause: 2026-09-05T15:00:12Z @kj resolved: isFreshRemoval matches a fresh removal by offset and text, so a ghost still on screen at an offset where a different word was removed again is held instead of fading in a second time; with the animation on, ghosts carry explicit fresh flags from the animator and this rule serves the speed 0 path
  - repro: rewrite 'mentions apples.' to 'mentions oranges.', then within the fade to 'mentions pears.': the apples ghost fades in a second time
  - test-tags: UNIT
  - log: 2026-09-05T08:02:48Z @kj added
  - log: 2026-09-05T15:00:12Z @kj closed
- [x] `DEF-HILITE-11` **Ghost bound misses the coarse diff branch when only the added side passes the token bound** - MAJOR; decorate skipped a removal only when the removal's own token count passed MAX_LCS_TOKENS, but the diff goes coarse when either side of the changed middle passes it, so an early edit plus a 500-word appended section in one write produced a document-sized ghost inside the first block and a layout shift at fade end; adversarial review round 8 finding 4, reproduced under node against lib/diff.js
  - evidence: unit test 'shows no ghost when only the added side of a replacement passes the bound' in `src/__tests__/highlight.spec.ts` fails before the fix and passes after; review round 9 and 10 confirms traced to the change and planned no edit; Galata 15/15 on the installed build v0.6.7 (logs/galata.log 2026-09-05), unit suite 62/62 via make test, adversarial review rounds 9 and 10 adjudicated clean (SHIP)
  - repro: before 'a ' + 'old '.repeat(400), after 'a ' + 'new '.repeat(600): removal 799 tokens and addition 1199 tokens at offset 2; the old body appears struck inside the first block
  - test-tags: UNIT
  - root-cause: 2026-09-05T08:21:07Z @kj the skip condition tested one side of a two-sided rule; resolved by also skipping a removal when an added range starting at its offset passes the bound, so the guard evaluates the diff's own coarse rule on the diff's own outputs
  - log: 2026-09-05T08:21:07Z @kj added
  - log: 2026-09-05T08:34:56Z @kj closed
- [x] `DEF-HILITE-12` **Added-side ghost bound hides a short readable ghost when the same write appends a large section** - MINOR; the two-sided ghost bound from DEF-HILITE-11 skips a removal whenever the added range at its offset passes MAX_LCS_TOKENS, so a replaced closing sentence followed by an appended section of more than 1000 tokens loses its strike while the green wash and the tab cue still fire; adversarial review round 10, adjudicated as a product choice (a ghost-size line between 7 and 799 tokens, or a bound in the diff itself) and deferred to the Star Colonel
  - evidence: unit test 'shows a short ghost when only the addition beside it passes the bound' in `src/__tests__/highlight.spec.ts` (7-token removal beside a 1206-token addition) and the DEF-HILITE-11 test still hiding the 799-token removal, 132/132 pass; Galata 18/18 on the installed build (logs/galata.log 2026-09-05)
  - repro: before a 200-word paragraph then 'The old closing sentence here.', after the same paragraph then 'The new closing sentence here.' then 600 appended words: decorate produces 0 removed spans where the 7-token ghost was shown before the DEF-HILITE-11 fix
  - test-tags: UNIT
  - root-cause: 2026-09-05T15:00:12Z @kj resolved by a ghost-size line: MAX_GHOST_TOKENS (50) in src/highlight.ts; a removal in the coarse branch is hidden only when it is longer than that, so a short removal keeps its ghost whatever the size of the addition beside it while the lumped middle of a rewritten document (DEF-HILITE-11) stays hidden
  - root-cause: 2026-09-05T08:35:14Z @kj the coarse diff branch lumps the whole changed middle into one removal and one addition at the same offset, so the size of the addition says nothing about whether the removal is a readable ghost; reverting the clause re-opens DEF-HILITE-11 (799-token ghost), so a separate ghost-size threshold or a diff-side bound is needed
  - log: 2026-09-05T08:35:14Z @kj added
  - log: 2026-09-05T15:00:12Z @kj closed
- [x] `DEF-HILITE-14` **Emptied document shows no removal ghost** - MINOR; MINOR; when an external change leaves the rendered view with no text at all, the words that went are not struck out - the reader sees an empty page with no record of what was there
  - evidence: 'shows no ghost when the change left the render with no block', 'puts the ghost of all the text in the block that survived it' and 'passes over a heading when only headings and a block survived' in `src/__tests__/highlight.spec.ts`; removing the deferral fails the last two; the deliberate half is recorded as ACC-HILITE-110
  - repro: open a preview of a file with text, write an empty file over it, watch the rendered view: no struck-out text appears
  - test-tags: UNIT
  - root-cause: 2026-09-06T22:05:27Z @kj a ghost is anchored inside a block the renderer produced; when the change leaves a block but no text the ghost is now deferred to the first surviving block that is not a heading, and when no block survives none is shown, because the only remaining place would be a new direct child of the render root whose count the edit-at-content sibling matches against the Markdown block count
  - root-cause: 2026-09-06T19:24:17Z @kj a ghost is anchored inside a block the renderer produced; an emptied render has no text nodes and so no blocks, so spanAt and ghostAnchor in src/highlight.ts have nowhere to place it
  - log: 2026-09-06T19:24:17Z @kj added
  - log: 2026-09-06T22:05:27Z @kj closed
- [x] `DEF-HILITE-15` **Removal ghost inside a fenced code block carries text from after it** - MINOR; MINOR; when a line inside a fenced code block changes, the struck-out ghost can include words from the paragraph following the block, so for the length of the fade the code reads as nonsense; the text is correct once the highlight goes
  - evidence: 'breaks between two blocks the renderer left nothing between' and 'keeps a ghost inside a fenced block clear of the paragraph after it' in `src/__tests__/highlight.spec.ts`; neutralising the block break fails three tests; jest 185 of 185 on build 0.6.19
  - repro: open a preview of a file with a fenced python block followed by a paragraph, rewrite 'second = 2' to 'second = 33' on disk, read the block during the fade: the ghost reads '2After' and the block shows 'second = 2After33'
  - test-tags: E2E
  - root-cause: 2026-09-06T22:05:27Z @kj captureText concatenated the text of every block with nothing between, so where a fenced block's last word abutted the next paragraph's first word the two became one token and the diff paired a match after the fence with a removal inside it; the captured text now carries a block break between two blocks whose own text abuts, and the break belongs to no span so nothing is decorated over it
  - root-cause: 2026-09-06T20:24:58Z @kj the word diff runs over the rendered text of the whole document with no regard for block boundaries, so a match found after the fence is paired with a removal inside it
  - log: 2026-09-06T20:24:58Z @kj added
  - log: 2026-09-06T22:05:27Z @kj closed
- [x] `DEF-HILITE-21` **Painting the marks rescans the whole document once per mark** - MINOR; MINOR; every mark repeats the same two full scans of the document and of the rendered view, so a long document with many marks spends most of a paint doing the same work again; measured at 240 ms for twenty marks on a 126 KB document under the test harness, against a project bound of 100 ms for applying a change
  - evidence: unit test 'scans the source and the render once for a paint of five marks' pinning one source scan and two render captures against five and six before, and the browser test 'DEF-HILITE-21 paints every passage from the one scan of the source and the render' over a 157 KB document of 1200 paragraphs carrying 20 marks; capping the paint loop at three marks turns it red with the three-mark control green
  - repro: open a 126 KB document carrying twenty marks and time one paint
  - test-tags: UNIT
  - root-cause: 2026-09-07T03:39:11Z @kj the two scans were inside the per-mark loop and are now computed once per paint; the second clause of the original reading is accepted rather than fixed - the guard that skips the rewrite still runs after the scanning, so an unchanged document still pays one source scan and two render captures per paint, measured at about 38 ms on a 126 KB document, inside the project's own 100 ms bound
  - root-cause: 2026-09-07T02:47:38Z @kj the source tokens and the rendered text snapshot are computed inside the per-mark loop although both are the same for every mark, and the guard that skips the DOM rewrite is evaluated after the scanning rather than before it
  - log: 2026-09-07T02:47:38Z @kj added
  - log: 2026-09-07T03:39:11Z @kj closed
- [x] `DEF-HILITE-31` **Reduced motion removes the removal ghost's opacity fade and brings back the layout jump** - MEDIUM; Under prefers-reduced-motion the decoration rule sets animation none on every decoration, which also removes the ghost's opacity fade; the ghost is taken out at full opacity and the following text reflows visibly, the jump ACC-HILITE-21 forbids; colour and opacity ramps are not motion and should run
  - evidence: Galata 'the highlights under reduced motion > keep their colour ramps, the ghost fading out before it is taken out' in ui-tests/tests/live-view.spec.ts fails with the decoration reduced-motion rule put back into the installed CSS bundle (animationName none) while the tab-marker reduced-motion test passes; green on build 0.6.31
  - repro: emulate reduced motion, rewrite the file removing a word, read the computed animation-name on the removed span
  - test-tags: FUNCTIONAL
  - root-cause: 2026-09-07T09:01:37Z @kj The reduced-motion rule at style/base.css:107-111 sets animation none on .jp-AdvancedMd-decoration, which by source order also removes the removal ghost's opacity fade
  - log: 2026-09-07T09:01:37Z @kj added
  - log: 2026-09-07T10:04:33Z @kj closed
  - log: 2026-09-07T10:04:33Z @kj fixed in style/base.css: the decoration reduced-motion block deleted; the tab-marker and mark-flash blocks stay, and the typing animation stays off under reduced motion through the controller

## Settings `CONFIG`

Defects in how settings are applied

- [x] `DEF-CONFIG-2` **Disabling the extension does not stop the file watcher** - MAJOR; with enabled=false the poll keeps running and external content is still applied to the preview; only decorations and the tab cue were gated
  - evidence: FileWatcher.enabled starts or stops the poll; Galata 'the extension turned off > does not update the preview at all' passes, logs/galata.log 2026-09-05, 10/10 on version 0.1.3
  - repro: set enabled=false in settings, open a preview, rewrite the file, wait two poll intervals: the preview shows the new text
  - test-tags: E2E
  - root-cause: 2026-09-04T22:49:50Z @kj the enabled setting was read by the controller only; FileWatcher had no switch and started its poll unconditionally in context.ready
  - log: 2026-09-04T22:49:50Z @kj added
  - log: 2026-09-04T22:55:27Z @kj closed
- [x] `DEF-CONFIG-23` **Live updates reach the document through two doors the enabled switch does not cover** - MEDIUM; MEDIUM; with live updates turned off, a change on disk can still replace the text in the preview: once through the refresh the notes feature calls before every write, and once when a document holding a blocked change becomes clean; neither path tests the switch, and because the highlight and the tab marker are disabled the replacement is silent
  - evidence: four unit tests in `src/__tests__/watcher.spec.ts` covering the refresh door, the clean-document door, a read in flight and the switch round trip, each turning red when its half of the fix is mutated away; and two browser tests, 'DEF-CONFIG-23 reads nothing on the refresh a marker write asks for' in ui-tests/tests/notes.spec.ts and 'DEF-CONFIG-23 lets the held change go, and reports it again once the switch is back on' in ui-tests/tests/settings.spec.ts; green on build 0.6.24
  - related: DEF-CONFIG-2
  - repro: turn live updates off, let an external change arrive while the document is dirty, then make the document clean: the text is replaced with no highlight and no marker
  - test-tags: UNIT
  - root-cause: 2026-09-07T03:39:11Z @kj the switch was tested at the entrances - registration, the event path, then refresh - so every later entrance was a new door; it is now tested in the one function that reads the file and writes the document, at entry and again after the read because a read is a round trip, and turning the switch off lets a held change go rather than leaving it waiting behind the switch
  - root-cause: 2026-09-07T02:47:54Z @kj the switch was placed on the watcher's registration and its event path; refresh and the model-state handler are two later entrances that do not consult it, and turning the switch off leaves a held change pending
  - log: 2026-09-07T02:47:54Z @kj added
  - log: 2026-09-07T03:39:11Z @kj closed

## Applying external content `APPLY`

Defects in how disk content reaches the open document

- [x] `DEF-APPLY-3` **Scroll restore never runs its late pass** - MAJOR; scroll events dispatch asynchronously, so the controller's own restore is counted as a reader scroll and the 150 ms late restore always returns early; with a URL hash and the TOC fix installed every external write scrolls the reader back to the anchor
  - evidence: unit tests 'overrides a scroll no input preceded during the restore window', 'keeps the reader at the top' and 'stands down when the reader scrolls' in `src/__tests__/controller.spec.ts`; Galata 'the reader position > holds through a rewrite while an anchor scroll fires' (stand-in trigger through the TOC fix's setFragment, position drift under 50 px); Galata 15/15 on the installed build v0.6.7 (logs/galata.log 2026-09-05), unit suite 62/62 via make test, adversarial review rounds 9 and 10 adjudicated clean (SHIP)
  - repro: open a preview with a hash in the URL and the TOC fix installed, scroll away, rewrite the file: the view smooth-scrolls back to the anchor on every write
  - test-tags: E2E
  - root-cause: 2026-09-05T07:54:27Z @kj E2E note: in the Galata lab the page URL carries the reset query, which JupyterLab rewrites within seconds and the hash goes with it, so the TOC fix's render-time anchor scroll never fires there (measured: hash gone 2.5 s after replaceState, scrollTop flat through 900 ms after render); the fix's own scrollToFragment does scroll when called (setFragment: 2367 to 32 over 850 ms), so the Galata test stands the trigger in - the fix's patched setFragment called 100 ms after the same rendered signal - and asserts the reader's position holds
  - root-cause: 2026-09-05T07:39:51Z @kj confirmed: the scroll event of the controller's own restore arrives after the flag around the assignment is reset; resolved by recognising the restore by where it lands (the assigned scrollTop) and, while a restore is in flight, by counting only a scroll within 500 ms of a wheel, pointer or key event as the reader's; a scroll no input preceded is another extension's and the late pass overrides it, so the TOC fix sibling needs no change
  - root-cause: 2026-09-04T23:22:20Z @kj _restoring is toggled synchronously around the scrollTop assignment while the scroll event arrives later with the flag already false; adversarial review round 1 finding F15
  - log: 2026-09-04T23:22:20Z @kj added
  - log: 2026-09-05T08:34:56Z @kj closed
- [x] `DEF-APPLY-4` **First save after an applied change raises the File Changed dialog** - MAJOR; the watcher applies disk content to the model but the Context's private contents model keeps the old hash and last_modified, so the next save from the editor compares against disk and raises the conflict dialog; Revert discards the edit
  - evidence: unit tests 'the Context still exposes _updateContentsModel' and 'records the applied revision on the context' in `src/__tests__/watcher.spec.ts`; Galata 'a document open in the editor as well > saves after an applied change without a dialog' failed on v0.1.6 and passes on v0.6.7; Galata 15/15 on the installed build v0.6.7 (logs/galata.log 2026-09-05), unit suite 62/62 via make test, adversarial review rounds 9 and 10 adjudicated clean (SHIP)
  - repro: open a file in the preview and the editor, rewrite it on disk, wait for the apply, type in the editor and save: the File Changed dialog appears
  - test-tags: E2E
  - root-cause: 2026-09-05T07:39:51Z @kj confirmed: Context._maybeSave compares the recorded hash before writing, so a save after apply would raise the dialog itself and option one is not viable; the collaborative drive reaches the same private updater through a save event the Context accepts only for collaborative models; resolved by calling Context._updateContentsModel with the applied revision after every apply, guarded by a unit test that fails when a JupyterLab release drops the method, and by a warning at runtime; a save over unsaved edits never reaches the apply path so the editor keeps its dialog
  - root-cause: 2026-09-04T23:22:20Z @kj Context._contentsModel is private and refreshed only by load and save; no public way to record the applied revision; the three options are recorded on ACC-APPLY-9 and the choice is the Star Colonel's; adversarial review round 1 findings F1 and F16
  - log: 2026-09-04T23:22:20Z @kj added
  - log: 2026-09-05T08:34:56Z @kj closed
- [x] `DEF-APPLY-22` **A mark written while the document has unsaved edits saves them unasked** - MEDIUM; MEDIUM; the preview and the editor share one document, so typing in the editor leaves unsaved edits; marking a passage in the preview then writes the whole document to disk without being asked, which is the opposite of the rule that a document holding unsaved edits is left alone, and with a change already on disk it can raise the File Changed dialog that ACC-NOTES-100 says never appears
  - evidence: unit test 'leaves a document holding unsaved edits unsaved' in `src/__tests__/notes.spec.ts` and the two-widget browser test 'DEF-APPLY-22 writes the mark into the document and puts nothing on disk' in ui-tests/tests/notes.spec.ts, which types in the editor without saving, marks from the preview, and asserts the file on disk is untouched three seconds later with no dialog open; making the write save unconditionally turns it red while the clean-document test stays green
  - related: ACC-NOTES-100
  - repro: open a Markdown file in the editor and its preview, type in the editor without saving, mark a passage in the preview: the file on disk carries the typed text
  - test-tags: UNIT
  - root-cause: 2026-09-07T02:47:54Z @kj the marker write calls save on the shared context with no test of whether the model was already dirty
  - log: 2026-09-07T02:47:54Z @kj added
  - log: 2026-09-07T03:39:11Z @kj closed
- [x] `DEF-APPLY-27` **A CRLF file gains one carriage return per line on every save after the preview opens** - CRITICAL; Open a file with CRLF line endings in the preview: the watcher applies the raw disk text as an external change at once, the tab shows the updated marker, and every later save (a mark, a note, a panel state change) writes one more CR per line, so the file grows CR CR LF then CR CR CR LF; reproduced by the round 1 sceptic on 0.6.28
  - evidence: unit tests 'applies nothing when a CRLF file holds what the document holds as LF' and 'applies a CRLF write as LF text' in `src/__tests__/watcher.spec.ts` fail on the unchanged _read and again when the regex is made a no-op; Galata 'DEF-APPLY-27 keeps one carriage return per line through two marks' in ui-tests/tests/notes.spec.ts fails with the normalisation mutated in the installed bundle; green on build 0.6.31 (jest 427, Galata 99)
  - repro: open a CRLF file in the preview, mark a passage twice, count the CR CR LF sequences in the file
  - test-tags: UNIT, FUNCTIONAL
  - root-cause: 2026-09-07T09:01:36Z @kj FileWatcher._read compares and applies the raw disk text while the Context holds a CRLF file as LF and re-expands on save, so a CRLF file is applied as an external change on open and every save adds one CR per line
  - log: 2026-09-07T09:01:36Z @kj added
  - log: 2026-09-07T10:04:32Z @kj closed
  - log: 2026-09-07T10:04:32Z @kj fixed in FileWatcher._read: the disk text is normalised to LF before the shadow and model comparisons and _apply, while _record(full) keeps the raw revision and hash; consequence kept: a document loaded as LF whose file is later rewritten as CRLF is applied and saved as LF, the Context's own line-ending rule

## Tab title cue `CUE`

Defects in the document tab marker and animation

- [x] `DEF-CUE-5` **Blocked cue clears on the first interaction and is never re-established** - MAJOR; a wheel tick, click or key on the preview strips the blocked marker together with the updated marker, and the watcher emits blocked once per external write because it records the new hash before the dirty check, so the stale preview shows no cue until the next write
  - evidence: unit tests 'reports a blocked change once and applies it once the document is clean' and 'lets a blocked change go when a save overwrote it' in `src/__tests__/watcher.spec.ts` and the 'tab cue' describe in `src/__tests__/controller.spec.ts`; Galata 'keeps the blocked marker through attention and drops it on Overwrite' and 'drops the blocked marker on Revert' failed on v0.1.6 and pass on v0.6.7; Galata 15/15 on the installed build v0.6.7 (logs/galata.log 2026-09-05), unit suite 62/62 via make test, adversarial review rounds 9 and 10 adjudicated clean (SHIP)
  - repro: open the file in the editor and type, rewrite the file on disk, see the red dot, scroll the preview one tick: the dot is gone and the preview stays stale
  - test-tags: E2E
  - root-cause: 2026-09-05T07:39:51Z @kj confirmed, two causes: the controller cleared every marker on attention, and the watcher recorded the new hash before the dirty check so the change was found once; resolved by keeping the blocked change in the watcher until the document is clean (applied then) or took it by a save or reload (a new unblocked signal then), reporting it once, and by clearing only the updated marker on attention
  - root-cause: 2026-09-04T23:22:20Z @kj _onAttention calls _setTabState(null) without checking for the blocked class; adversarial review round 1 finding F9
  - log: 2026-09-04T23:22:20Z @kj added
  - log: 2026-09-05T08:34:56Z @kj closed
- [x] `DEF-CUE-13` **A file gone from disk and a change held over unsaved edits show the same tab marker** - MINOR; the watcher reports blocked('missing') when the file is gone and blocked('dirty') when a change is held over unsaved edits, and the controller gives both the same jp-AdvancedMd-tabBlocked class, so the two states are indistinguishable on the tab; a reader cannot tell a file someone deleted from a change waiting on their own unsaved edits, and the two need opposite actions
  - evidence: the missing-marker tests in `src/__tests__/cue.spec.ts`, which assert its own class and that its rule declares no animation at all, with the other two markers asserted to declare one as a positive control; mapping both blocked reasons back to one class fails three of the cue tests; the Galata test 'stand still and keep their shapes' in ui-tests/tests/tab-cue.spec.ts reads all three markers under reduced motion
  - repro: open a preview, delete the file on disk, note the marker; revert, type an unsaved edit and write the file externally, note the same marker
  - test-tags: E2E
  - root-cause: 2026-09-06T22:05:51Z @kj the controller mapped both blocked reasons to one tab class; a file gone from disk now carries its own class and glyph, a still cross, so the three states differ by shape and by three amounts of movement - continuous turn, occasional nudge, none
  - root-cause: 2026-09-06T18:15:00Z @kj src/controller.ts _onBlocked maps both reasons of the BlockedReason union to one class; style/base.css therefore has one blocked marker to style
  - log: 2026-09-06T18:15:00Z @kj added
  - log: 2026-09-06T22:05:51Z @kj closed
- [x] `DEF-CUE-19` **The missing-file marker occasionally does not appear under load** - MINOR; MINOR; one full-suite run in three left the tab without the marker for a deleted file until the test gave up, and the same test passed on its own immediately afterwards and on the next full run
  - evidence: the test now waits for the checkpoint before deleting the file: two failures in ten under forty busy processes before the change, each with a failed checkpoint request in the server log, and ten of ten after; the fixed test still fails when the missing-marker class is renamed in the installed bundle, so it did not stop discriminating
  - repro: run the whole browser suite repeatedly and watch ui-tests/tests/tab-cue.spec.ts 'stand still and keep their shapes'; it waited out twenty seconds for the missing marker once in three runs
  - test-tags: E2E
  - root-cause: 2026-09-07T01:31:42Z @kj not a product defect: the test deleted the file while JupyterLab was still writing the checkpoint it takes of a document it opens, that request failed on the vanished file, and the platform closed the document with a load error, so no tab survived to carry the marker
  - root-cause: 2026-09-07T00:38:59Z @kj not established; the shape is a deletion event the watcher did not report while the machine was busy, so the state is only reached by the slower fallback
  - log: 2026-09-07T00:38:59Z @kj added
  - log: 2026-09-07T01:31:42Z @kj closed
- [x] `DEF-CUE-30` **The turning half circle, the marker of the commonest state, has no tooltip** - MEDIUM; The held square and the missing cross carry a caption naming the state in words; the updated marker carries none, so the commonest marker reads as a loading glyph to a first-time reader
  - evidence: unit test 'names the change in words for as long as it stands, then gives the caption back' in `src/__tests__/cue.spec.ts` fails with the map entry removed and with the guard removed; Galata tab-cue 'is a half-filled circle in the tab own text colour, with a tooltip' fails with the words reworded or the guard removed in the installed bundle, and siblings 'keeps the colour it gave the tab while the marker shows' fails with the composition removed; green on build 0.6.31 (Galata 99)
  - repro: rewrite an open file externally, hover the tab, read the tooltip
  - test-tags: UNIT, FUNCTIONAL
  - root-cause: 2026-09-07T10:04:33Z @kj the caption map lacked the updated state, and a caption set on an applied change was overwritten about 10 ms later by the document manager, which rewrites the caption on the file-changed signal once it has listed the checkpoints; the earlier held and missing captions also replaced the document's own caption, which the colourful-tab sibling reads for its Path line
  - root-cause: 2026-09-07T09:01:37Z @kj The tab caption map names the held and missing states only, so the updated state has no tooltip
  - log: 2026-09-07T09:01:37Z @kj added
  - log: 2026-09-07T10:04:33Z @kj closed
  - log: 2026-09-07T10:04:33Z @kj fixed in three parts in src/controller.ts: the TAB_CAPTIONS entry for the updated state; a title.changed guard that puts the state's words back over the fresh caption the document manager writes after an applied change; the caption composed as the state's words, a blank line, then the document's own caption, so siblings reading the Path line keep working

## Comments `NOTES`

Marks, note lines and the notes panel

- [x] `DEF-NOTES-16` **Panel hides itself when the last mark is taken away** - MEDIUM; MEDIUM; when an external rewrite removes the markers of the only mark in a document, the panel closes, so the unanchored mark the reader should still see is off screen
  - evidence: unit 'stays open when a rewrite takes the only mark away' and 'opens when the first mark arrives in a document that had none' in `src/__tests__/notes.spec.ts`, and Galata 'ACC-NOTES-59 lists a mark whose markers a rewrite removed' in ui-tests/tests/notes.spec.ts, now written as the single-mark case; reverting the fix fails the first unit test and the browser test while both controls pass, and the naive first-read-only fix fails the second
  - repro: mark one passage, then write the file externally without the markers: the panel closes and the remembered mark is invisible
  - test-tags: UNIT
  - root-cause: 2026-09-07T00:38:47Z @kj NotesController._read applies the opening-state rule on every content change rather than only on the first read, so a document with no settings marker flips to hidden as soon as its mark count reaches zero
  - log: 2026-09-07T00:38:47Z @kj added
  - log: 2026-09-07T01:31:42Z @kj closed
- [x] `DEF-NOTES-17` **A marker that splits a word paints the passage short** - MINOR; MINOR; a closing marker written by hand or by an agent between a word and its punctuation makes the painted highlight stop early, covering only the first words of the passage
  - evidence: two cases in `src/__tests__/anchor.spec.ts` written failing first; restoring containment fails exactly those two and passes the other 46, and widening the filter by a thousand characters either side fails six, so the boundary is pinned in both directions
  - repro: hand-write a mark around 'apples and pears' inside the sentence 'apples and pears.', open the preview: the highlight covers only 'apples and'
  - test-tags: UNIT
  - root-cause: 2026-09-07T01:31:42Z @kj measured: the source scanner emitted one token for the whole word including the punctuation the marker split, so its end lay past the passage, and the passage kept only tokens wholly inside it and dropped that word; the two-word fallback did not shorten the highlight, contrary to the first reading; the passage now selects its source tokens by overlap, so a word a marker splits belongs to the passage whole
  - root-cause: 2026-09-07T00:38:47Z @kj the source token is 'pears' while the rendered word is 'pears.', so locate fails on the full sequence and falls back to matching the first two words; the extension's own writer snaps to whole words, so only markers written by hand or by an agent reach this
  - log: 2026-09-07T00:38:47Z @kj added
  - log: 2026-09-07T01:31:42Z @kj closed
- [x] `DEF-NOTES-18` **A note line can carry an opaque user id instead of a name** - MINOR; MINOR; where the lab reports a named identity whose username is an opaque identifier rather than a login name, the note line opens with that identifier, which tells a later reader nothing about who wrote it
  - evidence: three cases in `src/__tests__/notes.spec.ts` written failing first; the rule is pinned in both directions - a predicate that never fires fails all three, one that also fires on a plain login name fails 'writes the lab identity when the setting is empty', and dropping the two name candidates fails the fallback pair
  - repro: open a lab whose identity carries a generated username and a display name, add a note, read the line: it opens with the generated username
  - test-tags: UNIT
  - root-cause: 2026-09-07T00:38:59Z @kj the author is taken from the identity username without asking whether it reads as a handle; ACC-NOTES-104 asks for the hub login name, which a generated identifier is not
  - log: 2026-09-07T00:38:59Z @kj added
  - log: 2026-09-07T01:31:42Z @kj closed
- [x] `DEF-NOTES-28` **Add note and the passage click open no note entry while the panel is minimap or hidden** - MAJOR; With the panel in the minimap or hidden state, the Add note command and a click on a marked passage select the mark and ask for a note entry, but those states render no rows, so the entry never appears and the reader gets nothing; reproduced by the round 1 sceptic
  - evidence: unit tests 'asks for the expanded state when the entry is opened from the minimap' and 'while hidden' in `src/__tests__/notes-panel.spec.ts` and 'expands a minimap panel when the note entry is asked for' in `src/__tests__/wiring.spec.ts` fail with the setState ask removed; Galata 'DEF-NOTES-28 opens the note entry from the marked passage' fails with the ask removed from the installed bundle; green on build 0.6.31
  - repro: open a document whose settings marker says panel=minimap, click a marked passage, look for the note textarea
  - test-tags: UNIT, FUNCTIONAL
  - root-cause: 2026-09-07T09:01:36Z @kj NotesPanel.selectMark opens a note entry without leaving the minimap or hidden state, whose render builds no rows, so the entry the reader asked for never appears
  - log: 2026-09-07T09:01:36Z @kj added
  - log: 2026-09-07T10:04:33Z @kj closed
  - log: 2026-09-07T10:04:33Z @kj fixed in NotesPanel.selectMark: with openNote and a state other than expanded it asks the handler for the expanded state first, so both routes to the entry are covered by one line
- [x] `DEF-NOTES-29` **The note caret jumps to the end of the draft on every external write** - MAJOR; The panel is rebuilt on every applied write; the textarea is a new node carrying the draft text and the focus but not the caret, so a reader typing a note mid-sentence while the agent writes finds every further keystroke landing at the end; reproduced by the round 1 sceptic (the list scroll position is kept, only the caret moves)
  - evidence: unit test 'keeps the caret where it was through a change of the document' in `src/__tests__/notes-panel.spec.ts` fails with setSelectionRange removed (caret 11 instead of 5); Galata 'DEF-NOTES-29 keeps the caret where it was through an external write' fails with the call removed from the installed bundle; green on build 0.6.31
  - repro: open a note entry, type a sentence, put the caret in its middle, rewrite the file externally, type one character
  - test-tags: UNIT, FUNCTIONAL
  - root-cause: 2026-09-07T09:01:36Z @kj NotesPanel._render recreates the note textarea on every setMarks and carries only its text and focus, so the caret moves to the end of the draft on every external write
  - log: 2026-09-07T09:01:36Z @kj added
  - log: 2026-09-07T10:04:33Z @kj closed
  - log: 2026-09-07T10:04:33Z @kj fixed in NotesPanel._render: the caret of a focused textarea in the body is kept and restored on the new textarea after focus; no scroll handling, the list body node persists
- [x] `DEF-NOTES-32` **Panel buttons are announced by their glyph instead of their title** - MEDIUM; button() sets a title but no aria-label, so assistive technology announces the glyph (multiplication x) for close, expand, collapse, the colour dots, Save, Cancel and Remove
  - evidence: unit test 'names every button for assistive technology by its title' in `src/__tests__/notes-panel.spec.ts` (ten buttons) fails with the aria-label line removed; green on build 0.6.31
  - repro: inspect any panel button: title set, aria-label absent
  - test-tags: UNIT
  - root-cause: 2026-09-07T09:01:37Z @kj button() in src/notes-panel.ts names the panel buttons by their glyph text and sets no aria-label
  - log: 2026-09-07T09:01:37Z @kj added
  - log: 2026-09-07T10:04:33Z @kj closed
  - log: 2026-09-07T10:04:33Z @kj fixed in button() in src/notes-panel.ts: aria-label set to the title
- [ ] `DEF-NOTES-33` **A mark saved during a write stream faster than one write per 200 ms raises File Changed** - MAJOR; Marking while the agent streams writes: at 40-100 ms spacing 1 to 2 marks in 10 raise the File Changed dialog; Overwrite discards the agent's lines since the mark started, Cancel holds the preview until the document is saved or reverted, Revert keeps the agent's text; one line was lost with no dialog at 100 ms; 0 of 18 at 200 ms and 0 of 6 at 1 s; reproduced by the round 1 sceptic. ACC-NOTES-100 is proven for writes spaced 200 ms or more apart and open below that
  - related: ACC-NOTES-100 - the guarantee this defect bounds
  - repro: stream writes every 50 ms to an open file, mark a passage ten times, count File Changed dialogs and lost lines
  - test-tags: FUNCTIONAL
  - root-cause: 2026-09-07T09:01:37Z @kj The mark's save goes through the Context, whose check-then-PUT leaves a window in which a write lands between the hash check and the PUT; a stat before save only narrows it
  - log: 2026-09-07T09:01:37Z @kj added
  - log: 2026-09-07T09:21:51Z @kj round 2 design: no client-side edit closes the Context's check-then-PUT windows; a server write route removes the dialog but not the loss; the bound at 200 ms spacing is accepted for now and the route design is in docs/defects/DEF-NOTES-33-atomic-write-route.md, decision for the Star Colonel
  - log: 2026-09-07T10:18:39Z @kj Star Colonel's decision 2026-09-07: fix it - the server compare-and-write route from docs/defects/DEF-NOTES-33-atomic-write-route.md is being built, server half first, client half after the round 2 executors leave src/notes.ts
  - log: 2026-09-07T10:28:03Z @kj server half built: WriteHandler on POST .../write with @authorized write on contents; FileWatchRegistry.swap takes a per-path lock, compares the file's hash (the contents manager's own algorithm over the raw bytes, the value the client holds as contentsModel.hash) with expected, answers 409 with the current content on a mismatch and otherwise writes in place keeping the inode so an appender holding the file open keeps writing to it; five pytest cases, 29 passing, the lock and the comparison each broken and watched failing
- [ ] `DEF-NOTES-34` **Every applied write collapses the reader's selection and detaches the context-menu hit node** - MAJOR; Each render replaces the rendered nodes, so the selection lives 530-1010 ms at one write a second and a context-menu gesture slower than about half a second after a write marks nothing, silently, because marking() finds its attachment through the stale hit-test node; under a stream of writes a passage can never be marked; reproduced by the round 1 sceptic
  - related: ACC-NOTES-100 - the guarantee this defect bounds; ACC-NOTES-114 - keyboard marking needs the same selection carry
  - repro: stream writes once a second, select a passage, right-click, wait one second, choose Mark: nothing is marked
  - test-tags: FUNCTIONAL
  - root-cause: 2026-09-07T09:01:37Z @kj The selection is not carried across renders and marking() resolves its attachment from the contextMenuHitTest node that the render detached, and mark() holds a live Range across its own refresh
  - log: 2026-09-07T09:01:37Z @kj added
- [ ] `DEF-NOTES-35` **A note typed into the panel is discarded without a word when the mark's markers vanished before Save** - MEDIUM; addNote and _rewrite cannot say whether the write found the markers; Save clears the draft regardless, so a note written while the agent removed the markers is lost and the row only shows unanchored; confirmed by reading src/notes-panel.ts:465-472 and src/notes.ts:836
  - repro: open a note entry, remove the mark's markers externally, type a note, press Save
  - test-tags: UNIT
  - root-cause: 2026-09-07T09:01:37Z @kj addNote and _rewrite in src/notes.ts return nothing about whether the markers were found, so the panel's Save handler clears the draft unconditionally
  - log: 2026-09-07T09:01:37Z @kj added

## Change detection `DETECT`

Noticing that a file on disk has changed

- [x] `DEF-DETECT-20` **A deletion in the first moments after a preview opens can go unreported** - MINOR; MINOR; a preview opened while the change channel is already connected has no recorded baseline until the next fallback tick, so if the file is deleted inside that window and the file event is also lost, the deletion is taken for the baseline and never reported; not reproduced, found by reading the code
  - evidence: unit test 'reports a file deleted between its registration and the first check' in `src/__tests__/channel.spec.ts`, written failing first with no change reported at all, and the control 'reports a file deleted right after its registration once when its event arrived'; restoring the old baseline fails the first and passes the control, and emitting past the event guard fails the control and passes the first; the fix adds no request, so the one-connection criterion is untouched; jest 417 of 417, Galata 94 of 94 on build 0.6.25
  - repro: open a second preview while the channel is connected, delete its file within the fallback interval and suppress the file event, then watch for the missing marker
  - test-tags: UNIT
  - root-cause: 2026-09-07T03:57:38Z @kj confirmed by test: the fallback took every first reading as the baseline, so a first reading of nothing was recorded as the baseline and no later reading could differ from it; the baseline is now taken only from a first reading that found a file, because a path is registered for a document that has already loaded from it, so the file was there when it was registered
  - root-cause: 2026-09-07T01:32:08Z @kj register on an open socket sends the registration but takes no stat, and the fallback treats a first reading of nothing as the baseline rather than as a change; the watcher's own initial check covers only a file already gone at registration
  - log: 2026-09-07T01:32:08Z @kj added
  - log: 2026-09-07T03:57:38Z @kj closed
- [x] `DEF-DETECT-24` **A document on another drive can show a false file-gone marker** - MEDIUM; MEDIUM; a path carrying a drive prefix, as jupyter-collaboration gives every document it manages, cannot be resolved under the server root, and the batched check answers nothing for it; since a first answer of nothing is now read as a deletion, such a document shows the file-gone cross on its tab although the file is there; introduced by the fix for DEF-DETECT-20 and not reachable on this workstation, where jupyter-collaboration is not installed
  - evidence: unit test 'leaves a path the server cannot serve out of the comparison' in `src/__tests__/channel.spec.ts`, written failing first with the false file-gone report, and the server tests test_stat_leaves_out_a_path_it_cannot_serve and test_drive_path_is_ignored; four separate breaks were run, each turning only its own tests red; jest 420 of 420, pytest 23 of 23, Galata 94 of 94 on build 0.6.26
  - repro: install jupyter-collaboration, open a Markdown document it manages, wait one fallback interval and read the tab
  - test-tags: UNIT
  - root-cause: 2026-09-07T04:19:55Z @kj the batched check answered nothing both for a file that is gone and for a path it could not serve; the answer now leaves out a path it cannot serve altogether, so the client can tell the two apart, and that also covers a path outside the root and a path the operating system cannot express
  - root-cause: 2026-09-07T03:57:38Z @kj the batched check answers the same nothing for a file that is gone and for a path it cannot resolve, so the two cannot be told apart by the client
  - log: 2026-09-07T03:57:38Z @kj added
  - log: 2026-09-07T04:19:55Z @kj closed
- [x] `DEF-DETECT-25` **An event arriving before the first check can swallow the change after it** - MINOR; MINOR; when a file event arrives for a document between its registration and its first fallback check, the record of that event is not cleared by the check, so the next change the fallback finds is taken for the one already reported and is not applied; the change after that is reported normally
  - evidence: unit test 'does not let an event before the first check consume the change after it' in `src/__tests__/channel.spec.ts`, written failing first with the second change swallowed; removing the one line that clears the record turns only that test red
  - repro: register a path on a standing connection, deliver an event for it before the first check, then change the file without an event and wait a fallback interval
  - test-tags: UNIT
  - root-cause: 2026-09-07T03:57:38Z @kj the branch that records the first reading returns without clearing the event record that the ordinary branch below it consumes
  - log: 2026-09-07T03:57:38Z @kj added
  - log: 2026-09-07T04:19:55Z @kj closed
- [x] `DEF-DETECT-26` **The same false file-gone marker remains where the server extension is absent** - MINOR; MINOR; where this extension's server side is not installed the fallback compares through JupyterLab's own contents interface, and a document on another drive is not served there either, so its absence is read as a deletion and the tab shows the file-gone cross although the file is there; the server-side half of this was fixed, this half was not
  - evidence: unit test 'leaves a drive path out of the contents comparison too' in `src/__tests__/channel.spec.ts`, written failing first with the false report standing beside the genuine one; three breaks were run - the guard removed, the guard widened to any colon, and the guard always true - each turning only its own tests red, the third also proving the ordinary fallback is not silently disabled; jest 421 of 421, pytest 23 of 23, Galata 94 of 94 on build 0.6.27
  - repro: run a lab with jupyter-collaboration and this extension's frontend but without its server extension, open a document that collaboration manages, wait one fallback interval and read the tab
  - test-tags: UNIT
  - root-cause: 2026-09-07T04:37:00Z @kj measured against jupyter-server 2.21.0: the contents route has no notion of drives and resolves a drive path as a file name under the server root, answering not-found with the same status and the same message as a missing file, so the two cannot be told apart there; the client-side manager does not separate them either, because an unregistered drive name falls through to the default drive; the drive path is therefore left out of the comparison by the same first-segment rule the server uses, which loses nothing because that path was never being compared correctly
  - root-cause: 2026-09-07T04:20:05Z @kj the contents fallback treats a not-found answer as a deletion without asking whether the path is one it can serve at all
  - log: 2026-09-07T04:20:05Z @kj added
  - log: 2026-09-07T04:37:00Z @kj closed
