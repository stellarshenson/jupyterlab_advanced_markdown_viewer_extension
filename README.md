# jupyterlab_advanced_markdown_viewer_extension

[![GitHub Actions](https://github.com/stellarshenson/jupyterlab_advanced_markdown_viewer_extension/actions/workflows/build.yml/badge.svg)](https://github.com/stellarshenson/jupyterlab_advanced_markdown_viewer_extension/actions/workflows/build.yml)
[![npm version](https://img.shields.io/npm/v/jupyterlab_advanced_markdown_viewer_extension.svg)](https://www.npmjs.com/package/jupyterlab_advanced_markdown_viewer_extension)
[![PyPI version](https://img.shields.io/pypi/v/jupyterlab-advanced-markdown-viewer-extension.svg)](https://pypi.org/project/jupyterlab-advanced-markdown-viewer-extension/)
[![Total PyPI downloads](https://static.pepy.tech/badge/jupyterlab-advanced-markdown-viewer-extension)](https://pepy.tech/project/jupyterlab-advanced-markdown-viewer-extension)
[![JupyterLab 4](https://img.shields.io/badge/JupyterLab-4-orange.svg)](https://jupyterlab.readthedocs.io/en/stable/)
[![Brought To You By KOLOMOLO](https://img.shields.io/badge/Brought%20To%20You%20By-KOLOMOLO-00ffff?style=flat)](https://kolomolo.com)
[![Donate PayPal](https://img.shields.io/badge/Donate-PayPal-blue?style=flat)](https://www.paypal.com/donate/?hosted_button_id=B4KPBJDLLXTSA)

Keep open Markdown files live. When an AI agentic tool or any other process rewrites a Markdown file on disk, the open rendered view picks up the change on its own: the tab title signals it, removed text is struck on a pale red background, added text stands on a pale green background, and both fade. No more reloading the tab to see the latest content. You can also mark passages and attach notes to them, kept in the Markdown file itself.

**Full disclosure:** the rest of your JupyterLab stays exactly as it was. This extension only makes sure that the Markdown file you are looking at is the one that is actually on disk.

## Features

- **Live updates** - open Markdown documents refresh automatically when the file changes on disk
- **Tab title cue** - the document tab signals that new content arrived
- **Change highlighting** - removed text is struck through on a pale red background, added text stands on a pale green background, both fading out calmly. The strike is deliberate: a reader who cannot tell red from green still sees which text is going by its line, not only by its colour
- **Changes play out as typing** - added text appears letter by letter on its green background, in every changed place at once; removed text first turns red, then is deleted from its last letter backwards. The reader follows a change as it happens and no text disappears without warning. The `animation` setting turns this off; `animationSpeed` sets the speed in characters per second
- **Rendered view** - live updates apply to the rendered Markdown view; an editor open on the same file keeps JupyterLab's own File Changed dialog for a save over unsaved edits
- **Unsaved edits are never overwritten** - a change arriving while the document has unsaved edits is held, shown as a red square on the tab, and applied once the document is clean again
- **A file that is gone says so** - a document whose file has been deleted carries a still cross on the tab, distinct from the held change by shape and by movement, and takes the new content if the file comes back
- **Marks and notes in the file itself** - select a passage in the rendered view, right-click and mark it in one of four colours, with notes attached to it; or select with caret browsing (F7) and press Accel Shift M, also in the command palette as Mark the selected passage. A mark is a pair of HTML comments around the passage, so the Markdown file carries everything and any other renderer shows the document with no trace of it
- **A panel beside the preview** - the marks of the open document listed in order, each with its passage and its notes; a narrow strip of ticks instead, or nothing at all. The state you leave it in is written into the file, so the document opens the way you left it
- **Marking while the agent writes** - a mark is written through the extension's own server route, which compares the file with what the preview holds and writes under a lock, so marking while writes stream in raises no File Changed dialog and the preview keeps following. A writer appending faster than about one line per 50 ms can still lose a line that lands inside the server's own write, a few milliseconds wide. A lab without the server extension, a document holding your unsaved edits, or live updates turned off keeps JupyterLab's save and its File Changed dialog; there, choose Revert, which keeps the agent's text

![A change part way through: added text typed in on green, the last line still mid-word, and the removed text struck on red before it is deleted](docs/images/animation-01.png)

![The three tab markers side by side: a half-filled circle part way through its turn on report.md, whose change is waiting to be read; a red square on draft.md, whose change is held back because the editor beside it holds unsaved edits; and a red cross on archive.md, whose file is gone from disk](docs/images/tab-05-three-markers.png)

## Settings

All settings live under Settings, Advanced Settings Editor, Advanced Markdown Viewer.

- `enabled` - on by default; off, the preview keeps what it showed until the document is reloaded; marks and notes have their own setting
- `pollInterval` - the interval of the fallback check for filesystems that raise no file events, in seconds; file events through the server extension are the primary path, so a lower value does not make updates faster
- `highlight` - green and red backgrounds on changed text
- `fadeDuration` - how long the highlight stays on changed text, in milliseconds; it rises over 0.5 s and fades away over the last 0.75 s
- `animation` - on by default; changes play out as typing
- `animationSpeed` - typing and deletion speed in characters per second; 0 shows a change at once
- `tabCue` - the markers on the document tab
- `notes` - on by default; off, the panel, the marks and the marking entries are hidden and the markers in the file are left alone
- `author` - the handle a note line opens with; empty, the extension uses the name the lab reports for the reader

## Requirements

- JupyterLab >= 4.0.0

## Install

To install the extension, execute:

```bash
pip install jupyterlab_advanced_markdown_viewer_extension
```

## Uninstall

To remove the extension, execute:

```bash
pip uninstall jupyterlab_advanced_markdown_viewer_extension
```
