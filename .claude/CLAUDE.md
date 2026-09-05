<!-- @import /home/lab/.claude/CLAUDE.md -->
<!-- @import /home/lab/workspace/.claude/CLAUDE.md -->

# Project-Specific Configuration

This file imports two configuration layers and does not repeat them:

- User-level, applies to every project on this machine: `/home/lab/.claude/CLAUDE.md`
- Workspace-level, applies under `/home/lab/workspace`: `/home/lab/workspace/.claude/CLAUDE.md`

All rules in both layers apply. Project-specific rules below strengthen or extend them.

## Mandatory Bans (Reinforced)

The following workspace rules are STRICTLY ENFORCED for this project:

- **No automatic git tags** - only create tags when user explicitly requests
- **No automatic version changes** - only modify version in package.json/pyproject.toml/etc. when user explicitly requests
- **No automatic publishing** - never run `make publish`, `npm publish`, `twine upload`, or similar without explicit user request
- **No manual package installs if Makefile exists** - use `make install` or equivalent Makefile targets, not direct `pip install`/`uv install`/`npm install`
- **No automatic git commits or pushes** - only when user explicitly requests

## Project Context

`jupyterlab_advanced_markdown_viewer_extension` is a JupyterLab 4.x frontend-and-server extension
that keeps open Markdown documents live: when an external process (typically an AI agentic tool)
rewrites a `.md` file on disk, the open viewer and editor receive the new content without a manual
reload. The document tab title signals the change, removed text is highlighted with a pale red
background and added text with a pale green background, both fading out calmly. The mechanism works
in both the rendered view and the editor, and merges external changes without garbling text the user
is typing at the same time.

Scaffolded 2026-09-04 from `jupyterlab/extension-template` v4.6.5 (`.copier-answers.yml`,
`kind: frontend-and-server`, settings enabled, tests enabled). The source is still the template
scaffold: `src/index.ts` activates the plugin and calls the `hello` route, `src/request.ts` wraps
`ServerConnection`, `jupyterlab_advanced_markdown_viewer_extension/routes.py` serves
`/jupyterlab-advanced-markdown-viewer-extension/hello`, `schema/plugin.json` holds an empty
settings schema.

**Architecture**:

- **Frontend** (TypeScript, `src/`) - JupyterLab plugin; the live-update logic, diff highlighting and
  tab cue will live here
- **Server** (Python, `jupyterlab_advanced_markdown_viewer_extension/`) - jupyter_server extension;
  file-change detection for open Markdown documents will live here
- **Schema** (`schema/plugin.json`) - user settings for the extension
- **Tests** - jest in `src/__tests__/`, pytest in `jupyterlab_advanced_markdown_viewer_extension/tests/`,
  Playwright in `ui-tests/`
- **CI/CD** - GitHub Actions in `.github/workflows/` with jupyter-releaser

**Feature specification** - acceptance criteria in `docs/acc-crit-advanced-markdown-viewer.md`,
defects in `docs/defects.md`, both written and read only through `pm-tools`.

## Build Lifecycle (Mandatory)

The project Makefile owns the entire build lifecycle. Never run `pip`, `jlpm`, `yarn`, `npm`,
`python -m build`, `jupyter labextension` or any build, publish or clean command directly.

| Action                                                     | Command                                                         |
| ---------------------------------------------------------- | --------------------------------------------------------------- |
| Build and install the extension                            | `make install`                                                  |
| Release to the registries                                  | `make publish` (explicit approval required, see Mandatory Bans) |
| Remove build artefacts                                     | `make clean`                                                    |
| Remove all build and venv artefacts, including `.nodeenv/` | `make mrproper`                                                 |

- **Makefile version check** - before any build work, compare the local `Makefile` version line with
  `/home/lab/workspace/private/jupyterlab/@utils/jupyterlab-extensions/Makefile`. When the reference
  is newer, copy it over the local Makefile before continuing. Local version at initialisation: 1.37,
  identical to the reference
- **Lockfile rule** - `package.json` and `package-lock.json` are always committed together in the
  same commit, never one without the other

## Acceptance Criteria and Defects (Mandatory)

- **Every feature has acceptance criteria** - created and maintained through the
  `project-management` plugin (`/project-management:acc-crit`) in `docs/acc-crit-*.md`; a feature
  without criteria is not started
- **Every defect is tracked** - filed, triaged and closed through the `project-management` plugin
  (`/project-management:defect`) in `docs/defects.md`
- Both documents are written only by `pm-tools`; run `pm-tools check docs --strict` after every
  edit session

## Required Workspace Skills

These skills MUST be followed for this project:

- **`jupyterlab-extension`** (`~/.claude/skills/jupyterlab-extension/`) - extension development
  guidelines, CI/CD with jupyter-releaser, caveats
- **`playwright`** (official `playwright` plugin) - browser automation for screenshots and UI
  verification of the live-update behaviour

## Journal Rules (Project-Specific)

- **APPEND ONLY**: New journal entries MUST be appended at the end of the file, never inserted between existing entries
- Entries maintain strict chronological order by position - the last entry in the file is always the most recent work
- Never reorder, move, or insert entries out of sequence
- The Stellars **journal plugin** is the canonical tool for this file: create via `/journal:create`, append via `/journal:update`, archive via `/journal:archive`. The `journal:journal` skill auto-triggers on any mention of "journal" and runs `journal-tools check` after every write
- Direct edits to `JOURNAL.md` are a last resort - prefer the plugin so modus secundis format, continuous numbering and append-only order are enforced automatically

## Strengthened Rules

- **Makefile is the build authority** - the project-local `.nodeenv/` toolchain is only used when
  the `make` targets run; a direct `jlpm` or `pip` call bypasses it
- **`make build` increments the patch version** - `make install` therefore bumps `package.json`;
  run it only when the user asks for a build, never as a casual verification step
- **GitHub project** - badges and link-checker configuration follow
  `~/.claude/references/github-badges.md`; validate badge URLs against
  `stellarshenson/jupyterlab_advanced_markdown_viewer_extension`

## Interplay With Sibling Extensions

Eight sibling Markdown extensions live beside this one under `/home/lab/workspace/private/jupyterlab/`
(edit-at-content, export, github-alerts, insert-content, switch-tab-scrolling-fix,
syntax-rendering-fix, viewer-toc-fix, paste-as-markdown), plus `jupyterlab_refresh_view_extension`
and `jupyterlab_colourful_tab_extension`. Surveyed 2026-09-04; the constraints that keep them working
are criteria in `docs/acc-crit-advanced-markdown-viewer.md`, category `COMPAT`. The load-bearing
rules:

- **Apply external content through `context.model.sharedModel` in one tagged Yjs transaction** -
  never `setSource` of the whole text, never `context.revert()`, never direct DOM replacement; this
  drives the standard render pipeline so the alerts parser wrapper and every `rendered` listener re-run
- **Rendered-view highlights are inline spans inside existing blocks** - never add or remove direct
  children of `.jp-RenderedMarkdown` (edit-at-content counts them) and never change heading text or ids
  (TOC fix and anchors depend on them)
- **Editor highlights are CodeMirror decorations**, never injected DOM
- **One scroll guard**, installed on the `rendered` signal, passive while the switch-tab scrolling fix
  guard is live and scheduled after the TOC fix hash scroll
- **Tab cue through `widget.title.className`**, never inline styles on the tab node
- **CSS namespace `jp-AdvancedMd-*`**, setting only `background-color` and `transition`
- **Sibling changes the feature needs** (each is a `COMPAT` criterion): TOC fix scrolls only when the
  hash changed; switch-tab scrolling fix exposes a guard-active signal; refresh view prompts on a dirty
  model; export reads the on-screen source or forces a save. Edit those siblings only with the
  Star Colonel's word per change
