---
name: jupyterlab-advanced-markdown-viewer-extension
description: Mark passages of a Markdown file in one of six colours, comment on a passage or on the whole document, answer and close the user's comments, and watch a file for new comments - the HTML-comment markers that jupyterlab_advanced_markdown_viewer_extension shows in the JupyterLab Markdown Preview and its Notes panel. Use when a Markdown file holds `mark:` HTML comments, when the user asks to mark, highlight, colour or comment on text in a Markdown file, to leave a note on the whole document, or to watch a file for comments.
---

# Markdown marks

`jupyterlab_advanced_markdown_viewer_extension` keeps marks and comment threads in the Markdown file as HTML comments. The Markdown Preview paints the marked text in the mark's colour and lists every thread in its Notes panel; other renderers show nothing. Edit the file on disk: an open preview shows the change within half a second.

## A mark

```markdown
The cost is <!-- mark:0f8e5a52-3c1d-4b7a-9e2f-6a1b2c3d4e5f note colour=blue @kj 2026-09-28T09:15:00Z: Per house or per farm?\n@claude 2026-09-28T09:16:40Z: Per house, source table 2 -->40 EUR<!-- /mark:0f8e5a52-3c1d-4b7a-9e2f-6a1b2c3d4e5f --> per house.
```

- **Id** - a new lowercase UUID version 4 (`python3 -c "import uuid; print(uuid.uuid4())"`), the same in the opening and the closing comment. A marker with any other id is ignored
- **Type** - `note`, directly after the id
- **Colour** - `colour=` then `yellow`, `blue`, `pink`, `orange`, `red` or `green`; no colour, or another word, reads as yellow. The extension gives the colours no meaning: use the meanings the user gives
- **Closed** - `status=closed` after the colour. The preview hides the mark; the Notes panel lists it under Show hidden
- **No comment** - the opening comment on one line: `<!-- mark:<id> note colour=green -->`
- **Comment line** - `@<handle> <YYYY-MM-DDTHH:MM:SSZ>: <text>`: UTC, whole seconds, `Z`, then a colon. A line of any other shape continues the line above it, so a stamp with milliseconds joins your text to the user's comment. Sign as `@claude` unless the user names another handle
- **Comments on the marker's line** - an opening comment with text before or after it on its line holds its comments on that line: after the attributes, joined by a literal `\n`, a `|` written `\|`, a `\` written `\\`, then ` -->`. A comment on a line of its own there would end the paragraph, heading, list item, quote or table row, and print the comment on the page
- **Comments on lines of their own** - only an opening comment alone on its line from the first column, such as the comment on the whole document, holds its comments one per line, with `-->` on its own line after the last
- **Adding a comment** - keep the form the marker has: `\n@claude <stamp>: <text>` before ` -->` on the marker's line, or a new line before `-->`. Never spread a one-line marker over several lines: the extension then no longer reads the mark
- **Text** - write `-->` as `-- >`; no blank lines
- **Settings** - leave `<!-- marks:settings panel=... -->` as it is; the Notes panel writes it

## A comment on the whole document

```markdown
<!-- mark:6d2b7c1e-8f3a-4e5b-9c0d-1a2b3c4d5e6f document
@claude 2026-09-28T09:20:00Z: Sections 3 and 5 repeat the cost table. Keep which?
-->

# Pilot proposal
```

- Type `document`, no closing comment, no marked text
- On a line of its own: line 1, or the line directly after a leading YAML front matter block
- One per file: when the file has one, add your line to it

## Where the markers go

The page must look the same with the markers as without them. The opening comment goes directly before the first marked word, the closing comment directly after the last, except in these cases:

- **First word starts a line inside a paragraph** - append the opening comment to the end of the line above, before a hard break's two spaces or backslash. On a line of its own, it splits the paragraph in two
- **First word starts a paragraph** - the opening comment on a line of its own directly above, with that line's `>` and indentation
- **First word of a list item** - the opening comment directly after the bullet, and the item's text moved to the next line, indented to the text's column. Directly before the word, it removes the paragraph of an item in a loose list
- **Code block or Mermaid diagram** - the opening comment on a line of its own directly above the fence, the closing comment on a line of its own directly below, both with the fence's `>` and indentation
- **Never** inside inline code, a fenced or indented code block, a link target or an HTML tag. Do not nest marks

```markdown
- Energy <!-- mark:3c9d1f20-5a4b-4c6d-8e7f-0a1b2c3d4e5f note colour=pink -->budget<!-- /mark:3c9d1f20-5a4b-4c6d-8e7f-0a1b2c3d4e5f --> for the pilot
- <!-- mark:7e1a2b3c-4d5e-4f60-a1b2-c3d4e5f60718 note colour=green -->
  Second<!-- /mark:7e1a2b3c-4d5e-4f60-a1b2-c3d4e5f60718 --> item

| Item   | Use                                                                                                                                                                                                         |
| ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Heater | <!-- mark:9a8b7c6d-5e4f-4a3b-b2c1-d0e1f2a3b4c5 note colour=red @kj 2026-09-28T09:15:00Z: Wrong unit?\n@claude 2026-09-28T09:16:40Z: Fixed, kWh -->40 kWh<!-- /mark:9a8b7c6d-5e4f-4a3b-b2c1-d0e1f2a3b4c5 --> |
```

## Answering the user

1. Read the whole mark from the file: a thread can hold several lines, and the user can add lines while you work
2. Do what the comment says, in the file
3. Add one comment after the user's last one, saying what changed, at most 15 words. Keep the mark
4. When you cannot act without an answer, that line is the question
5. The user's last line is one word - `done`, `close`, `closed`, `ok`, `resolved` or `remove`: delete both comments and keep the marked text. With more words after that word, do the rest first
6. Never delete a mark the user has not closed. Leave a `status=closed` mark as it is
7. Edit by exact replacement, and check that the old text occurs once before you write: the user edits the same file. Never rewrite the whole file to change one part

## Watching a file

`scripts/watch-marks.py` in this skill's directory prints one line for each thread the user adds to. Its options: `python3 scripts/watch-marks.py --help`.

1. Choose a list file for this session only, for example `watch-list.txt` in the session's scratch directory
2. `python3 <skill dir>/scripts/watch-marks.py add --list <list> <file> ...` - stops with an error on a file that does not exist
3. Start one background process: `python3 <skill dir>/scripts/watch-marks.py run --list <list> --me claude`. Each line it prints is one event. In Claude Code, run it with the Monitor tool, `timeout_ms` 1800000, and start it again each time it expires
4. To add a file later, run `add` again: the running process reads it within 5 seconds. `remove` takes a file out
5. Keep a task that holds the absolute paths and both commands, so a new session can start the watch again

| Event                               | Do                  |
| ----------------------------------- | ------------------- |
| `<file> \| watching`                | nothing             |
| `<file> \| missing`                 | tell the user       |
| `<file> \| new note <id> \| <text>` | answer it, as above |
| `<file> \| reply <id> \| <text>`    | answer it, as above |

- The first pass reports every open thread whose last line is not yours
- Your own lines, a closed mark and a change of colour are not reported
- To stop: end the background process, and name every mark that is still open
