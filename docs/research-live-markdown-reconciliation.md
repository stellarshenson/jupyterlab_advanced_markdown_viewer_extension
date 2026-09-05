# Reconciling an external rewrite with a live editor

How concurrent editing is actually solved, which paradigm fits a Markdown file rewritten on disk by
an agentic tool while the user is typing, and what the mainstream editors do in the same situation.

Research date 2026-09-04. Every claim traces to a paper, a specification, or source read directly.
Where a primary source could not be reached it is named as unreachable rather than replaced with a
secondary one.

## The answer in short

- **Google Docs solves a different problem.** Operational transformation needs every participant to
  emit positioned, version-labelled operations. A file on disk emits none. It is not a matter of a
  better transformation function - the precondition cannot be met
- **The named paradigm that fits is Differential Synchronization**, Fraser 2009. Keep a shadow of the
  last text both sides agreed on, diff the shadow against the new disk snapshot, apply the result as
  positioned operations into the live document
- **The overlay intuition is close but the geometry is wrong.** What the design needs is not a view
  layered over a base, it is a third text held beside both, invisible to the user. That third text is
  what turns an unanswerable two-way question into an answerable three-way one
- **Almost nobody in the mainstream merges into a buffer with unsaved edits.** VS Code refuses, Emacs
  refuses, Vim refuses, IntelliJ asks. JetBrains has specified a merge mode naming AI agents as the
  reason and has not implemented it. This feature attempts what the field deliberately avoids
- **The CRDT that JupyterLab already ships is the transport, not the reconciler.** It applies the
  result; it cannot decide what the result is

## Why operational transformation does not apply

Operational transformation is the family behind Google Docs, and it is the wrong tool here.

- Ellis and Gibbs 1989 introduced the approach and the transformation property later called TP1.
  Nichols and colleagues' Jupiter system, 1995, added the central server and the per-client state
  space that every commercial descendant uses
- The requirement is uniform across dOPT, Jupiter, Google Wave and Google Docs: each peer emits
  operations carrying a version label, and receives acknowledgements. Transformation is undefined on a
  snapshot
- Sun and Ellis 1998 place the root of the original dOPT defect precisely at the precondition a
  snapshot cannot satisfy, that both operations be defined on the same document state. A fabricated
  version label does not repair this, it produces silent displacement
- **What Google Docs runs today is not published.** The last first-party technical description is John
  Day-Richter's Google Drive Blog posts of September 2010. The Realtime API, the only external
  exposure of that model, was retired in January 2019. Any statement about the current implementation
  is inference, and this document does not make one

## Why the CRDT is not the reconciler either

JupyterLab's document model is built on Yjs, so the temptation is to treat the CRDT as the answer.

- A conflict-free replicated data type converges two replicas that both carry the structure: character
  identifiers, a logical clock, tombstones. A Markdown file carries none of it. There is no remote
  replica to converge with, so the merge operation is undefined
- The strongest evidence is from a CRDT library itself. Automerge's own text update runs a diff
  against the previous string first, and only then produces splice operations. Even a pure CRDT
  implementation must diff a snapshot before it can act on one
- What the CRDT genuinely provides, and it is worth having: relative positions that survive an
  insertion, so cursor and selection hold their place against the text rather than an index; correct
  convergence if a second human ever edits the same document; and a transaction origin that
  distinguishes our writes from the user's typing
- Conclusion: the CRDT is the application layer. Something else must decide what to apply

## Differential Synchronization, and the shadow

Fraser's 2009 paper is built on the premise that states our situation exactly - taking a snapshot of
state is easy, capturing edits is hard.

- The scheme keeps a **shadow**: a stored copy of the text both sides last agreed on. Each cycle
  diffs the changed side against the shadow to obtain edits, patches those edits onto the other side,
  and then unconditionally copies the new state over the shadow
- It needs no operation log, no version vector and no cooperation from the remote peer. Reading and
  writing that peer's state is the entire requirement, which is all a file offers
- Fraser resolves an overlap by fuzzy patching - locating each patch near its expected offset by
  approximate match. This is the part to replace
- **The half-duplex case simplifies.** There is no packet loss between a process and its own
  filesystem, so version numbers, the backup shadow and checksum reinitialisation all fall away. It
  complicates in exactly one place: the disk never acknowledges anything, so a modification time or a
  content hash is the only way to learn that a save was clobbered

### Replace the fuzzy patch with a three-way merge

The shadow structure supports a stricter resolution, and for a document the user is reading it is the
right one.

- Three-way merge, formally studied by Khanna, Kunal and Pierce, takes a base, ours and theirs. Here
  the base is the shadow, ours is the live document including unsaved keystrokes, theirs is the new
  disk snapshot
- Non-overlapping changes propagate from both sides. Overlapping changes are reported rather than
  guessed
- The reason to prefer it: a wrong fuzzy match silently corrupts a document the user is looking at,
  while a reported conflict is a decision that can be routed somewhere. The reason to keep Fraser's
  structure around it: the unconditional shadow update is what makes the next cycle self-correcting
- Two documented defects must be respected rather than assumed away. Three-way merge is **not
  idempotent**, so re-running it over its own output is not a safe recovery - recovery is restoring
  from the shadow. And it offers **no locality guarantee**: a large untouched region between two
  changes does not ensure a clean merge, and repetitive Markdown structure such as bullet lists and
  repeated blank lines is exactly the input that defeats the alignment

### The overlay framing, corrected

- What holds: there really are two texts, the user edits one, and they are reconciled
- What fails: an overlay implies a view computed from a base with a precedence rule, so that changing
  the base recomputes the view. There is no such function here. The editor buffer is an independent
  text with its own history, not a projection of the file
- The second failure is the one that matters. An overlay must answer which layer wins. Reconciliation
  has no such rule, which is precisely why conflict exists as a category
- The intuition is reaching for the shadow. The shadow is not underneath the user's view, it is beside
  it and invisible, and it is a checkpoint rather than a substrate

## What the mainstream actually does

Six systems, the same question: the file changed on disk and the buffer holds unsaved edits.

| System                               | Detection                                        | With unsaved edits                                                                                                                                          | Merges | Undo and cursor on reload                                                                                            |
| ------------------------------------ | ------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ | -------------------------------------------------------------------------------------------------------------------- |
| VS Code                              | Native watcher, plus a re-check on window focus  | Refuses. Four separate guards prevent a dirty model being reloaded. Divergence surfaces only at save, as a conflict notification with Compare and Overwrite | No     | Clean reload is a diff-and-apply, so undo survives and the cursor translates                                         |
| Emacs                                | File notifications by default, plus a 5 s poll   | Nothing happens at all. Auto-revert is documented not to revert a modified buffer                                                                           | No     | A manual revert is added to the undo history as one change, so it can be undone                                      |
| Vim and Neovim                       | Timestamp check on focus or on the check command | Warning W12 with three choices, defaulting to doing nothing                                                                                                 | No     | The reload is pushed as one undoable change for buffers under 10000 lines, so one undo brings the unsaved edits back |
| IntelliJ                             | Native watcher, refresh on frame activation      | Modal dialog. Load the disk version, keep the memory version, or view the difference                                                                        | No     | Reload runs inside a command with an explicit undo policy                                                            |
| Jupyter with collaboration installed | Polls every 1 s, modification time only          | **Overwrites silently.** No prompt, no choice                                                                                                               | No     | The overwrite is not undoable; the user cannot recover their text                                                    |
| Stock JupyterLab                     | None while idle                                  | Conflict dialog at save time only, offering Revert or Overwrite                                                                                             | No     | Revert replaces the whole document, collapsing the cursor to the start                                               |

Three observations follow, and they are the most useful findings in the survey.

- **Nobody merges.** Every mainstream editor either refuses to touch a dirty buffer or makes the user
  choose one whole side. The reasons the sources give are consistent: VS Code's guard carries the
  comment that not resolving a dirty model prevents data loss, and Emacs's manual states that
  discarding edits the user made would be wrong
- **The one deliberate exception loses data.** Jupyter's collaborative extension overwrites without
  asking. Its own log line is "Out-of-band changes. Overwriting the content in room", and it clears
  the dirty flag afterwards, so the interface stops indicating that anything was lost. Two open
  issues on that tracker state the position plainly, one saying the current detection results in more
  data loss than necessary, the other reporting out-of-band changes logged immediately before data
  loss incidents
- **JetBrains has specified our feature and not built it.** The platform declares an experimental
  conflict-resolution mode named MERGE, documented for clients that write files behind the user's
  back, naming an AI agent as the example. The implementation comment states that only the ask mode is
  acted on, that merge is not implemented, and that it currently behaves as keep-memory-changes. Even
  the specified semantics stop short: the external change wins when the two turn out to be
  unmergeable

The honest reading is that this extension attempts something the field has judged risky. That is not
a reason to abandon it, since the agentic-rewrite case genuinely is new and the alternatives all lose
one side's work. It is a reason to make the conflict path explicit and visible rather than clever.

## What the JupyterLab ecosystem already has

The closest existing implementation is worth stating precisely, because half of it is the
recommendation and half of it is the failure mode.

- The collaborative extension polls the file every second and compares modification time only. It does
  not use the content hash the server can supply, and its tracker records both false negatives from
  filesystem timestamp resolution and false positives from writes of identical content
- When it detects a change it replaces the room content with the disk content. Whatever was unsaved is
  gone
- The document class underneath, however, **already does a diff and apply**. It runs a sequence matcher
  over the two byte strings and applies the resulting opcodes as granular text operations. This is the
  right mechanism, and it is why a cursor no longer jumps to the top of the document on every external
  touch
- It gets two things wrong, and both are correctable. The diff is **two-way**, taken from the live
  document to the disk content, so unsaved keystrokes appear in the opcode stream as deletions and are
  removed efficiently rather than crudely. And it carries a similarity floor of 0.6 below which it
  clears the whole text and reinserts, which an agent substantially rewriting a document will fall
  through
- The single change implied by the research is small: diff the **shadow** against the snapshot, not
  the live document against the snapshot

## Constraints from this workstation

Established by reading the installed packages and libraries, not upstream documentation.

- JupyterLab 4.6.3. The collaborative extension is **not installed**, so there is no server-side
  document, no server-side file watcher and no second peer. Polling from the frontend is not merely
  the baseline, it is the only option that does not add a server dependency
- The CRDT library ships anyway as the document model implementation, so the shared-model API is
  available without collaboration installed
- The transaction call takes an undoable flag and an origin. Passing false and our own origin keeps
  the external change out of the user's undo stack and makes it distinguishable from typing
- **A trap:** the convenient range-update method calls that transaction with no arguments, so used
  directly an external change lands in the undo stack looking exactly like the user's own work. The
  library's nesting rule is that only the outermost call sets the origin, so wrapping the hunks in one
  outer transaction is both the fix and the way to make the whole reconciliation a single undoable
  unit
- **The unresolved constraint.** JupyterLab core records the file's hash and modification time
  privately and compares them when saving. Merging content into the model without updating that record
  leaves the user's next save raising the File Changed dialog. There is no public interface to update
  it. The only public call that does is revert, whose implementation replaces the whole document and
  destroys unsaved edits
- Three ways out, all with a cost: save immediately after merging, which means writing to disk and
  racing the external writer; reach into the private field, which is fragile across patch releases;
  or accept the dialog. This needs a decision before implementation

## The recommended design

- **Detect** by polling the file metadata per open document. Compare the content hash first and fall
  back to modification time, which is what JupyterLab core itself does and what the collaborative
  extension fails to do. Never fetch content on a poll
- **Hold a shadow** of the text last known to be on disk, updated on every load, every save and every
  successful reconciliation
- **Reconcile** with a three-way merge over shadow, live document and new snapshot. Non-overlapping
  hunks apply. Overlapping hunks keep the user's text, mark the document, and surface the conflict on
  the tab
- **Apply** as positioned range updates inside one outer transaction, tagged with our own origin.
  Never replace the whole source, which discards every relative position in the document. Whether that
  transaction is undoable is a real decision and is listed below, not settled here
- **Update the shadow unconditionally** after each cycle, so a bad cycle does not repeat. Recovery from
  a bad merge is restoring the shadow, never merging again over the output
- **Highlight** from the hunks the merge produced, not from a re-diff of the rendered output. In the
  editor use range decorations, which the library keeps and shrinks rather than dropping when the
  document changes underneath them. In the rendered view decorate inline within existing blocks
- **Defer** while the user is actively typing and while an export is in flight

The one deliberate departure from Fraser: resolution is by three-way classification rather than fuzzy
patching, because a silent wrong guess in a document the user is reading is worse than a visible
conflict.

## Corrections to the acceptance criteria

- Change detection should compare the content hash first and fall back to modification time. The
  filed criterion names modification time alone
- Excluding the external change from the undo stack is done with the undoable flag on the transaction,
  not by manipulating the undo manager's tracked origins. The filed mechanism is wrong. The criterion
  also asserts the exclusion as settled, which the section above shows it is not
- The criteria assume a three-way merge without naming it. The mechanism lines should name
  Differential Synchronization and the shadow, so a future reader can find the source

## The undo decision

This deserves its own section because the survey turned up a precedent that argues against the
obvious choice.

- The obvious choice is to keep the external change out of the undo stack. The user then never has a
  keystroke undone by surprise, and undo continues to mean what it always meant
- The cost is that there is no recovery. If the merge places a hunk badly, the user cannot step back
  from it
- **Vim takes the opposite position and it is worth respecting.** A reload is pushed as a single
  undoable change for buffers under ten thousand lines, so one undo brings the previous text back. The
  documentation states the intent directly, that after a file reappears and is read you can undo to
  see the previous contents. Above the limit the undo tree is discarded and the edits are gone, so the
  behaviour is a deliberate size-bounded safety net rather than an accident
- **A related mechanic removes one common objection.** Excluding a transaction from the editor's
  history does not discard the history that already exists; the stack is rebased through the change
  instead. What actually destroys an undo stack is replacing the whole document, which is a further
  argument for applying hunks rather than the whole text
- Recommendation, held loosely: exclude the external change from the undo stack by default, and offer
  an explicit command that restores the shadow. That gives recovery without making undo unpredictable.
  If a single reversible step is preferred instead, follow Vim and bound it by document size

## Open questions for decision

- **How the save record is kept honest.** Save after merging, patch the private field, or accept the
  dialog. This determines whether the extension writes to disk at all, which changes its risk profile
  entirely
- **Whether an overlapping change is ever applied automatically.** The recommendation holds the user's
  text and surfaces a conflict. The alternative is to apply it and rely on recovery
- **Whether the external change is undoable**, per the section above
- **Whether the merge result is saved automatically.** Leaving it unsaved means the export feature,
  which reads from disk, will export different bytes than the user sees

## Sources

Papers and specifications:

- Ellis and Gibbs 1989, Concurrency Control in Groupware Systems, SIGMOD
- Nichols, Curtis, Dixon and Lamping 1995, High-Latency Low-Bandwidth Windowing in the Jupiter
  Collaboration System, UIST
- Sun and Ellis 1998, Operational Transformation in Real-Time Group Editors, CSCW
- Google Wave operational transformation whitepaper, waveprotocol.org
- Day-Richter 2010, Google Drive Blog, the last first-party description of the Docs model
- Fraser 2009, Differential Synchronization, ACM DocEng - https://neil.fraser.name/writing/sync/
- Khanna, Kunal and Pierce, A Formal Investigation of Diff3
- Myers 1986, An O(ND) Difference Algorithm and Its Variations
- Weidner and Kleppmann 2023, on interleaving anomalies - https://arxiv.org/abs/2305.00583

Source code read directly:

- jupyterlab/jupyter-collaboration, the file loader and the document room
- jupyter-server/jupyter_ydoc, the text document set method
- jupyterlab/jupyterlab, the document registry context
- microsoft/vscode, the text file editor model and the model service
- emacs-mirror/emacs, autorevert, files.el, editfns.c, filelock.c
- vim/vim and neovim/neovim, fileio.c
- JetBrains/intellij-community, the file document manager and the memory-disk conflict resolver
- codemirror state, view, commands, collab and merge packages
- google/diff-match-patch

Unreachable, named rather than substituted:

- The YATA paper full text, behind access control at both publishers
- The RGA paper and the adOPTed paper, both paywalled
- Any current first-party description of the Google Docs implementation, which does not exist publicly
