# jupyterlab_advanced_markdown_viewer_extension

[![GitHub Actions](https://github.com/stellarshenson/jupyterlab_advanced_markdown_viewer_extension/actions/workflows/build.yml/badge.svg)](https://github.com/stellarshenson/jupyterlab_advanced_markdown_viewer_extension/actions/workflows/build.yml)
[![npm version](https://img.shields.io/npm/v/jupyterlab_advanced_markdown_viewer_extension.svg)](https://www.npmjs.com/package/jupyterlab_advanced_markdown_viewer_extension)
[![PyPI version](https://img.shields.io/pypi/v/jupyterlab-advanced-markdown-viewer-extension.svg)](https://pypi.org/project/jupyterlab-advanced-markdown-viewer-extension/)
[![Total PyPI downloads](https://static.pepy.tech/badge/jupyterlab-advanced-markdown-viewer-extension)](https://pepy.tech/project/jupyterlab-advanced-markdown-viewer-extension)
[![JupyterLab 4](https://img.shields.io/badge/JupyterLab-4-orange.svg)](https://jupyterlab.readthedocs.io/en/stable/)
[![Brought To You By KOLOMOLO](https://img.shields.io/badge/Brought%20To%20You%20By-KOLOMOLO-00ffff?style=flat)](https://kolomolo.com)
[![Donate PayPal](https://img.shields.io/badge/Donate-PayPal-blue?style=flat)](https://www.paypal.com/donate/?hosted_button_id=B4KPBJDLLXTSA)

Keep open Markdown files live. When an AI agentic tool or any other process rewrites a Markdown file on disk, the open viewer and editor pick up the change on their own: the tab title signals it, removed text fades out on a pale red background, added text fades in on a pale green background. No more reloading the tab to see the latest content.

**Full disclosure:** the rest of your JupyterLab stays exactly as it was. This extension only makes sure that the Markdown file you are looking at is the one that is actually on disk.

## Features

- **Live updates** - open Markdown documents refresh automatically when the file changes on disk
- **Tab title cue** - the document tab signals that new content arrived
- **Change highlighting** - removed text on a pale red background, added text on a pale green background, both fading out calmly
- **View and edit mode** - works in the rendered Markdown view and in the editor
- **Safe concurrent editing** - external changes merge without garbling text the user is typing at the same time

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
