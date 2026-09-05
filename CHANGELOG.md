# Changelog

<!-- <START NEW CHANGELOG ENTRY> -->

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
