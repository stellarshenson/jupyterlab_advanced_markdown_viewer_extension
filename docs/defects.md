# Defects - jupyterlab_advanced_markdown_viewer_extension

Observed wrong behaviour of the extension and the trail of what was tried against it.

## Authors

- `@kj` Konrad Jelen

## Change highlighting `HILITE`

Defects in the rendered-view decorations

- [x] `DEF-HILITE-1` **Added block wraps the whitespace between blocks** - MAJOR; when an external change appends a block, the newline text node markdown-it emits between blocks is marked as added and wrapped in a span, which becomes a new direct child of .jp-RenderedMarkdown and breaks the block count edit-at-content relies on
  - evidence: unit test 'never wraps the whitespace between blocks when a block was added' in src/**tests**/highlight.spec.ts passes (36/36) and Galata 'adds no direct child to the render root' passes, logs/galata.log 2026-09-05, 10/10 on version 0.1.3
  - repro: open a preview, rewrite the file with one extra paragraph, count root.children before and after: one more than the block count
  - test-tags: UNIT, E2E
  - root-cause: 2026-09-04T22:49:49Z @kj decorate() wrapped every span overlapping an added range, including text nodes whose parent is the render root
  - log: 2026-09-04T22:49:49Z @kj added
  - log: 2026-09-04T22:55:27Z @kj closed
- [x] `DEF-HILITE-6` **Word replacement ghost is glued to its replacement** - MINOR; a replaced word renders as the struck old word immediately followed by the new word with no separator, reading as one fused token
  - evidence: unit tests 'adds a gap after a ghost whose replacement starts with a word' and 'adds no gap when the ghost ends at punctuation' in src/**tests**/highlight.spec.ts; Galata 'separates a struck word from its replacement' asserts the ::after content holds a non-breaking space; Galata 15/15 on the installed build v0.6.7 (logs/galata.log 2026-09-05), unit suite 62/62 via make test, adversarial review rounds 9 and 10 adjudicated clean (SHIP)
  - repro: rewrite 'mentions apples.' to 'mentions oranges.': the preview shows 'apples.oranges.' with the first struck
  - test-tags: E2E
  - root-cause: 2026-09-05T07:39:51Z @kj confirmed; resolved with a generated gap after a ghost whose text ends in a word and whose following text starts with one: class jp-AdvancedMd-gap, a non-breaking space in an inline-block ::after so the strike does not cross it; no property is set on the ghost's own box
  - root-cause: 2026-09-04T23:22:21Z @kj the ghost is inserted at the removal offset and the replacement starts at the same offset; no box model property may be set on decorations; adversarial review round 1 finding F10
  - log: 2026-09-04T23:22:21Z @kj added
  - log: 2026-09-05T08:34:56Z @kj closed
- [x] `DEF-HILITE-7` **Changed SVG text labels vanish for the fade window** - MINOR; a decoration span inserted inside an SVG text element is not an SVG element, so a changed diagram label is unpainted until undecorate restores it
  - evidence: unit tests 'reads HTML inside a foreignObject but never SVG text' and 'leaves a changed SVG label untouched' in src/**tests**/highlight.spec.ts; Galata 15/15 on the installed build v0.6.7 (logs/galata.log 2026-09-05), unit suite 62/62 via make test, adversarial review rounds 9 and 10 adjudicated clean (SHIP)
  - repro: render a mermaid diagram, change a node label on disk: the label disappears for fadeDuration plus 300 ms and then returns
  - test-tags: UNIT
  - root-cause: 2026-09-05T07:39:51Z @kj confirmed; resolved in captureText by reading past text nodes whose parent is in the SVG namespace, so a diagram label is never wrapped; HTML inside a foreignObject is still read and decorated
  - root-cause: 2026-09-04T23:22:21Z @kj captureText accepts text nodes inside SVG and decorate wraps them in HTML spans; adversarial review round 1 finding F17
  - log: 2026-09-04T23:22:21Z @kj added
  - log: 2026-09-05T08:34:56Z @kj closed
- [x] `DEF-HILITE-8` **Fade timer outlives decorations cleared by a settings change** - MINOR; turning highlight or the extension off during a fade removes the decorations but leaves the fade timer pending, so the next external change within that window is treated as held: its decorations skip the fade-in and the diff baseline stays put until the orphaned timer fires
  - evidence: unit test 'a settings change during a fade ends the fade and the next change fades in' in src/**tests**/controller.spec.ts; Galata 15/15 on the installed build v0.6.7 (logs/galata.log 2026-09-05), unit suite 62/62 via make test, adversarial review rounds 9 and 10 adjudicated clean (SHIP)
  - repro: apply a change, within 4 s set highlight=false then true, apply another change: the new spans carry --jp-AdvancedMd-fade-in: 0ms
  - test-tags: UNIT
  - root-cause: 2026-09-05T07:39:51Z @kj confirmed; resolved by clearing the fade timer inside _clearDecorations and by advancing the diff baseline to the text on screen whenever a fade ends early (_endFade), so the next change is diffed alone and fades in
  - root-cause: 2026-09-04T23:59:23Z @kj _clearDecorations does not clear _fadeTimer; only dispose and the fade callback do; adversarial review round 5 finding 2, adjudicated immaterial; remedy is moving the timer clear into _clearDecorations
  - log: 2026-09-04T23:59:23Z @kj added
  - log: 2026-09-05T08:34:56Z @kj closed
- [x] `DEF-HILITE-9` **Held write skips the fade-in in regions never tinted before** - MINOR; while a fade is pending every re-created decoration gets a zero fade-in, including spans over text in a block that carried no highlight before, so that text appears at full tint instantly instead of over 300 ms
  - evidence: unit tests 'cuts a held run where the fresh part begins' in src/**tests**/highlight.spec.ts and 'fades in a region never tinted before during a held fade' in src/**tests**/controller.spec.ts; Galata 15/15 on the installed build v0.6.7 (logs/galata.log 2026-09-05), unit suite 62/62 via make test, adversarial review rounds 9 and 10 adjudicated clean (SHIP)
  - repro: apply a change to paragraph one, within the fade apply a change to paragraph two: paragraph two's span has --jp-AdvancedMd-fade-in: 0ms
  - test-tags: UNIT
  - root-cause: 2026-09-05T07:39:51Z @kj confirmed; resolved by a per-span decision: during a fade the controller also diffs the previous render against this one and passes those fresh ranges to decorate, which cuts an added run where the fresh part begins and gives only the part an earlier render already tinted a zero fade-in; a ghost is held when the fresh diff has no removal at its offset
  - root-cause: 2026-09-04T23:59:23Z @kj the hold decision is per render, not per span; a per-span decision needs the previous decoration's snapshot offsets; adversarial review round 4 and 5 finding 1, adjudicated immaterial and deferred as not earned
  - log: 2026-09-04T23:59:23Z @kj added
  - log: 2026-09-05T08:34:56Z @kj closed
- [ ] `DEF-HILITE-10` **Held ghost re-fades when the same position is replaced twice within one fade** - MINOR; isFreshRemoval matches a removal to the fresh diff by offset only, so a ghost already on screen at that offset is treated as new when the word there is replaced again inside the fade window and dips from transparent for 300 ms; adversarial review round 6 finding 4, deferred by the adjudicator as cosmetic
  - repro: rewrite 'mentions apples.' to 'mentions oranges.', then within the fade to 'mentions pears.': the apples ghost fades in a second time
  - test-tags: UNIT
  - log: 2026-09-05T08:02:48Z @kj added
- [x] `DEF-HILITE-11` **Ghost bound misses the coarse diff branch when only the added side passes the token bound** - MAJOR; decorate skipped a removal only when the removal's own token count passed MAX_LCS_TOKENS, but the diff goes coarse when either side of the changed middle passes it, so an early edit plus a 500-word appended section in one write produced a document-sized ghost inside the first block and a layout shift at fade end; adversarial review round 8 finding 4, reproduced under node against lib/diff.js
  - evidence: unit test 'shows no ghost when only the added side of a replacement passes the bound' in src/**tests**/highlight.spec.ts fails before the fix and passes after; review round 9 and 10 confirms traced to the change and planned no edit; Galata 15/15 on the installed build v0.6.7 (logs/galata.log 2026-09-05), unit suite 62/62 via make test, adversarial review rounds 9 and 10 adjudicated clean (SHIP)
  - repro: before 'a ' + 'old '.repeat(400), after 'a ' + 'new '.repeat(600): removal 799 tokens and addition 1199 tokens at offset 2; the old body appears struck inside the first block
  - test-tags: UNIT
  - root-cause: 2026-09-05T08:21:07Z @kj the skip condition tested one side of a two-sided rule; resolved by also skipping a removal when an added range starting at its offset passes the bound, so the guard evaluates the diff's own coarse rule on the diff's own outputs
  - log: 2026-09-05T08:21:07Z @kj added
  - log: 2026-09-05T08:34:56Z @kj closed
- [ ] `DEF-HILITE-12` **Added-side ghost bound hides a short readable ghost when the same write appends a large section** - MINOR; the two-sided ghost bound from DEF-HILITE-11 skips a removal whenever the added range at its offset passes MAX_LCS_TOKENS, so a replaced closing sentence followed by an appended section of more than 1000 tokens loses its strike while the green wash and the tab cue still fire; adversarial review round 10, adjudicated as a product choice (a ghost-size line between 7 and 799 tokens, or a bound in the diff itself) and deferred to the Star Colonel
  - repro: before a 200-word paragraph then 'The old closing sentence here.', after the same paragraph then 'The new closing sentence here.' then 600 appended words: decorate produces 0 removed spans where the 7-token ghost was shown before the DEF-HILITE-11 fix
  - test-tags: UNIT
  - root-cause: 2026-09-05T08:35:14Z @kj the coarse diff branch lumps the whole changed middle into one removal and one addition at the same offset, so the size of the addition says nothing about whether the removal is a readable ghost; reverting the clause re-opens DEF-HILITE-11 (799-token ghost), so a separate ghost-size threshold or a diff-side bound is needed
  - log: 2026-09-05T08:35:14Z @kj added

## Settings `CONFIG`

Defects in how settings are applied

- [x] `DEF-CONFIG-2` **Disabling the extension does not stop the file watcher** - MAJOR; with enabled=false the poll keeps running and external content is still applied to the preview; only decorations and the tab cue were gated
  - evidence: FileWatcher.enabled starts or stops the poll; Galata 'the extension turned off > does not update the preview at all' passes, logs/galata.log 2026-09-05, 10/10 on version 0.1.3
  - repro: set enabled=false in settings, open a preview, rewrite the file, wait two poll intervals: the preview shows the new text
  - test-tags: E2E
  - root-cause: 2026-09-04T22:49:50Z @kj the enabled setting was read by the controller only; FileWatcher had no switch and started its poll unconditionally in context.ready
  - log: 2026-09-04T22:49:50Z @kj added
  - log: 2026-09-04T22:55:27Z @kj closed

## Applying external content `APPLY`

Defects in how disk content reaches the open document

- [x] `DEF-APPLY-3` **Scroll restore never runs its late pass** - MAJOR; scroll events dispatch asynchronously, so the controller's own restore is counted as a reader scroll and the 150 ms late restore always returns early; with a URL hash and the TOC fix installed every external write scrolls the reader back to the anchor
  - evidence: unit tests 'overrides a scroll no input preceded during the restore window', 'keeps the reader at the top' and 'stands down when the reader scrolls' in src/**tests**/controller.spec.ts; Galata 'the reader position > holds through a rewrite while an anchor scroll fires' (stand-in trigger through the TOC fix's setFragment, position drift under 50 px); Galata 15/15 on the installed build v0.6.7 (logs/galata.log 2026-09-05), unit suite 62/62 via make test, adversarial review rounds 9 and 10 adjudicated clean (SHIP)
  - repro: open a preview with a hash in the URL and the TOC fix installed, scroll away, rewrite the file: the view smooth-scrolls back to the anchor on every write
  - test-tags: E2E
  - root-cause: 2026-09-05T07:54:27Z @kj E2E note: in the Galata lab the page URL carries the reset query, which JupyterLab rewrites within seconds and the hash goes with it, so the TOC fix's render-time anchor scroll never fires there (measured: hash gone 2.5 s after replaceState, scrollTop flat through 900 ms after render); the fix's own scrollToFragment does scroll when called (setFragment: 2367 to 32 over 850 ms), so the Galata test stands the trigger in - the fix's patched setFragment called 100 ms after the same rendered signal - and asserts the reader's position holds
  - root-cause: 2026-09-05T07:39:51Z @kj confirmed: the scroll event of the controller's own restore arrives after the flag around the assignment is reset; resolved by recognising the restore by where it lands (the assigned scrollTop) and, while a restore is in flight, by counting only a scroll within 500 ms of a wheel, pointer or key event as the reader's; a scroll no input preceded is another extension's and the late pass overrides it, so the TOC fix sibling needs no change
  - root-cause: 2026-09-04T23:22:20Z @kj _restoring is toggled synchronously around the scrollTop assignment while the scroll event arrives later with the flag already false; adversarial review round 1 finding F15
  - log: 2026-09-04T23:22:20Z @kj added
  - log: 2026-09-05T08:34:56Z @kj closed
- [x] `DEF-APPLY-4` **First save after an applied change raises the File Changed dialog** - MAJOR; the watcher applies disk content to the model but the Context's private contents model keeps the old hash and last_modified, so the next save from the editor compares against disk and raises the conflict dialog; Revert discards the edit
  - evidence: unit tests 'the Context still exposes _updateContentsModel' and 'records the applied revision on the context' in src/**tests**/watcher.spec.ts; Galata 'a document open in the editor as well > saves after an applied change without a dialog' failed on v0.1.6 and passes on v0.6.7; Galata 15/15 on the installed build v0.6.7 (logs/galata.log 2026-09-05), unit suite 62/62 via make test, adversarial review rounds 9 and 10 adjudicated clean (SHIP)
  - repro: open a file in the preview and the editor, rewrite it on disk, wait for the apply, type in the editor and save: the File Changed dialog appears
  - test-tags: E2E
  - root-cause: 2026-09-05T07:39:51Z @kj confirmed: Context._maybeSave compares the recorded hash before writing, so a save after apply would raise the dialog itself and option one is not viable; the collaborative drive reaches the same private updater through a save event the Context accepts only for collaborative models; resolved by calling Context._updateContentsModel with the applied revision after every apply, guarded by a unit test that fails when a JupyterLab release drops the method, and by a warning at runtime; a save over unsaved edits never reaches the apply path so the editor keeps its dialog
  - root-cause: 2026-09-04T23:22:20Z @kj Context._contentsModel is private and refreshed only by load and save; no public way to record the applied revision; the three options are recorded on ACC-APPLY-9 and the choice is the Star Colonel's; adversarial review round 1 findings F1 and F16
  - log: 2026-09-04T23:22:20Z @kj added
  - log: 2026-09-05T08:34:56Z @kj closed

## Tab title cue `CUE`

Defects in the document tab marker and animation

- [x] `DEF-CUE-5` **Blocked cue clears on the first interaction and is never re-established** - MAJOR; a wheel tick, click or key on the preview strips the blocked marker together with the updated marker, and the watcher emits blocked once per external write because it records the new hash before the dirty check, so the stale preview shows no cue until the next write
  - evidence: unit tests 'reports a blocked change once and applies it once the document is clean' and 'lets a blocked change go when a save overwrote it' in src/**tests**/watcher.spec.ts and the 'tab cue' describe in src/**tests**/controller.spec.ts; Galata 'keeps the blocked marker through attention and drops it on Overwrite' and 'drops the blocked marker on Revert' failed on v0.1.6 and pass on v0.6.7; Galata 15/15 on the installed build v0.6.7 (logs/galata.log 2026-09-05), unit suite 62/62 via make test, adversarial review rounds 9 and 10 adjudicated clean (SHIP)
  - repro: open the file in the editor and type, rewrite the file on disk, see the red dot, scroll the preview one tick: the dot is gone and the preview stays stale
  - test-tags: E2E
  - root-cause: 2026-09-05T07:39:51Z @kj confirmed, two causes: the controller cleared every marker on attention, and the watcher recorded the new hash before the dirty check so the change was found once; resolved by keeping the blocked change in the watcher until the document is clean (applied then) or took it by a save or reload (a new unblocked signal then), reporting it once, and by clearing only the updated marker on attention
  - root-cause: 2026-09-04T23:22:20Z @kj _onAttention calls _setTabState(null) without checking for the blocked class; adversarial review round 1 finding F9
  - log: 2026-09-04T23:22:20Z @kj added
  - log: 2026-09-05T08:34:56Z @kj closed
