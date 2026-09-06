# Changelog

<!-- <START NEW CHANGELOG ENTRY> -->

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
