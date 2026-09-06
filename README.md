# jupyterlab_advanced_markdown_viewer_extension

[![GitHub Actions](https://github.com/stellarshenson/jupyterlab_advanced_markdown_viewer_extension/actions/workflows/build.yml/badge.svg)](https://github.com/stellarshenson/jupyterlab_advanced_markdown_viewer_extension/actions/workflows/build.yml)
[![npm version](https://img.shields.io/npm/v/jupyterlab_advanced_markdown_viewer_extension.svg)](https://www.npmjs.com/package/jupyterlab_advanced_markdown_viewer_extension)
[![PyPI version](https://img.shields.io/pypi/v/jupyterlab-advanced-markdown-viewer-extension.svg)](https://pypi.org/project/jupyterlab-advanced-markdown-viewer-extension/)
[![Total PyPI downloads](https://static.pepy.tech/badge/jupyterlab-advanced-markdown-viewer-extension)](https://pepy.tech/project/jupyterlab-advanced-markdown-viewer-extension)
[![JupyterLab 4](https://img.shields.io/badge/JupyterLab-4-orange.svg)](https://jupyterlab.readthedocs.io/en/stable/)
[![Brought To You By KOLOMOLO](https://img.shields.io/badge/Brought%20To%20You%20By-KOLOMOLO-00ffff?style=flat)](https://kolomolo.com)
[![Donate PayPal](https://img.shields.io/badge/Donate-PayPal-blue?style=flat)](https://www.paypal.com/donate/?hosted_button_id=B4KPBJDLLXTSA)

Keep open Markdown files live. When an AI agentic tool or any other process rewrites a Markdown file on disk, the open rendered view picks up the change on its own: the tab title signals it, removed text is struck on a pale red background, added text stands on a pale green background, and both fade. No more reloading the tab to see the latest content.

**Full disclosure:** the rest of your JupyterLab stays exactly as it was. This extension only makes sure that the Markdown file you are looking at is the one that is actually on disk.

## Features

- **Live updates** - open Markdown documents refresh automatically when the file changes on disk
- **Tab title cue** - the document tab signals that new content arrived
- **Change highlighting** - removed text on a pale red background, added text on a pale green background, both fading out calmly
- **Changes play out as typing** - added text appears letter by letter, very fast, on its green background, in every changed place at once; removed text first turns red, then is deleted from its last letter backwards. The reader follows a change as it happens and no text disappears without warning. The `animation` setting turns this off; `animationSpeed` sets the speed in characters per second
- **Rendered view** - live updates apply to the rendered Markdown view; an editor open on the same file keeps JupyterLab's own File Changed dialog for a save over unsaved edits
- **Unsaved edits are never overwritten** - a change arriving while the document has unsaved edits is held, shown as a red tab marker, and applied once the document is clean again

![Typing animation: added text grows on green, removed text stands red and is deleted backwards](docs/images/animation-01.png)

![Tab cue: a green dot before the label and a pulsing icon while changes arrive](docs/images/tab-01-arriving.png)

## Settings

All settings live under Settings, Advanced Settings Editor, Advanced Markdown Viewer.

- `enabled` - on by default; off, the preview keeps what it showed until the document is reloaded and nothing else in this extension runs
- `pollInterval` - how often an open preview checks its file, in seconds
- `highlight` - green and red backgrounds on changed text
- `fadeDuration` - how long the highlight takes to fade, in milliseconds
- `animation` - on by default; changes play out as typing
- `animationSpeed` - typing and deletion speed in characters per second; 0 shows a change at once
- `tabCue` - the dot on the document tab

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
