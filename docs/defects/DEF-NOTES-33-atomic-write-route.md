# DEF-NOTES-33 - a mark saved during a fast write stream

The mark's save goes through the JupyterLab Context: a refresh reads the file, the markers are
written into the model, then `Context.save` fetches the file's hash, compares it with the one the
watcher synced, and only then sends the PUT. Two windows follow from that sequence:

- W1, from the refresh's read to the hash fetch - an external write here raises the File Changed
  dialog
- W2, from the hash fetch to the PUT - an external write here is overwritten with no dialog; this
  is the lost line observed at 100 ms spacing

Measured on 0.6.28 with a writer appending one line at a fixed spacing while ten marks were made:

| Spacing     | Dialogs     | Lost lines   |
| ----------- | ----------- | ------------ |
| 40 - 100 ms | 1 - 2 in 10 | 1 in one run |
| 200 ms      | 0 in 18     | 0            |
| 1 s         | 0 in 6      | 0            |

## Options weighed

**Client-side reordering** gains nothing: the refresh, the transaction, the flush and the update
are back to back, and W1 is the two round trips themselves. Saving through the contents service
directly skips the hash fetch and the dialog, but a W1 write is then overwritten silently - a
dialog traded for a lost line. The dialog belongs to the Context and cannot be intercepted.

**Accepting the bound** - the choice for now. Writes spaced 200 ms or more apart never meet the
dialog, and below that spacing the server coalesces events to one per 100 - 400 ms, so the preview
is already several writes behind the file. The README names the cadence, what each dialog button
does (Revert keeps the agent's text; Overwrite discards it; Cancel holds the preview) and the two
ways to avoid it.

**A server write route** - the terminal design, not built:

- `routes.py`: `WriteHandler` on `POST .../write` with body `{path, expected, content}`
- `watch.py`: `FileWatchRegistry.swap(path, expected, content)` resolves the path, takes a
  per-path lock, reads the file, answers 409 with the current text when it differs from
  `expected`, otherwise writes a temporary file beside it and `os.replace`s it - the rename the
  watcher already reports as a change
- `src/notes.ts`: `_write` takes its edits as a function of the source; when the model is clean and
  the route exists it POSTs the new text, on 200 applies the same edits through the mark
  transaction, clears the dirty flag and refreshes, which finds disk equal to the model and syncs
  the revision - no `Context.save`, so no dialog; on 409 it refreshes, recomputes and retries up to
  three times. Where the server extension is absent (404 on first use, remembered) the present
  path stays
- Cost: about 60 lines of Python with three pytest cases and about 80 lines of TypeScript that
  turn every write path of the notes controller into a retry loop, plus a second write path to
  keep equal to the first

The route removes the dialog. It does not remove the loss: an agent's write that lands between
the server's read and its rename is still overwritten, and after the rename an in-place writer's
next write goes to the unlinked inode. The window shrinks from two round trips to microseconds.

## Evidence for the bound

A Galata test that appends a numbered line every 200 ms for six seconds while ten marks are made,
asserting zero dialogs and every line present in the file, pins the bound the README states. At
50 ms spacing the same run is a probe, not a test, because the failure is one or two in ten.
