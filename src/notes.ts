/**
 * Marks and notes for one open Markdown preview.
 *
 * The controller is the whole of the feature that is neither grammar nor
 * widget: it reads the marks out of the document, paints the marked passages
 * in the rendered view, and writes every marker back into the file. One
 * controller belongs to one preview and lives as long as it.
 *
 * Three rules shape the writing. A marker is written through the shared model
 * in one transaction, so the standard render pipeline runs and every other
 * extension observing the model sees an ordinary local edit. The file is
 * refreshed before the write, so a change already on disk lands first and the
 * save that follows cannot report the file as changed; a document that already
 * held unsaved edits is not saved at all, because those edits are the reader's
 * to save. And the passage bytes between the two markers are never touched: a
 * note, a colour and a removal all rewrite or delete markers alone.
 *
 * Painting follows the same invariants as the change highlight: the marks are
 * inline spans inside blocks the renderer produced, never a new direct child
 * of the render root, and heading text and identifiers stay as rendered.
 */

import { DocumentRegistry } from '@jupyterlab/docregistry';
import { MarkdownDocument } from '@jupyterlab/markdownviewer';
import { User } from '@jupyterlab/services';
import { IDisposable } from '@lumino/disposable';
import { ISignal, Signal } from '@lumino/signaling';

import {
  IRenderedRange,
  ISelectionRange,
  passageToRendered,
  renderedWords,
  selectionToSource,
  tokeniseSource
} from './anchor';
import { captureText, DECORATION_CLASS, ITextSnapshot } from './highlight';
import { openingState } from './notes-panel';
import {
  IMark,
  IMarkAttribute,
  IMarkContent,
  ISpan,
  MarkColour,
  newId,
  PanelState,
  parseMarks,
  parseSettings,
  serialiseClosing,
  serialiseOpening,
  serialiseSettings
} from './marks';

/**
 * Class on the span painting a marked passage. The colour is a second class
 * of the same name with the colour appended.
 */
export const MARK_CLASS = 'jp-AdvancedMd-mark';

/**
 * Class held for a moment on a passage the panel has just revealed.
 */
export const MARK_FLASH_CLASS = 'jp-AdvancedMd-markFlash';

/**
 * Transaction origin of a marker write.
 *
 * A mark is written by the reader, so it is a local edit and must not read as
 * a change from disk: the origin the watcher tags applied content with says
 * so, and this one says the opposite.
 */
export const MARK_ORIGIN = 'jupyterlab_advanced_markdown_viewer_extension:mark';

/**
 * The only mark type this version writes. A mark of another type is read and
 * listed but never rewritten, so what a later version wrote survives.
 */
export const MARK_TYPE = 'note';

/**
 * How long a revealed passage keeps its flash.
 */
export const FLASH_MS = 1200;

/**
 * Handle written on a note line when nothing else names the reader.
 */
export const DEFAULT_AUTHOR = 'reader';

/**
 * Settings the notes controller reads.
 */
export interface INotesSettings {
  /** Whether marks are painted and listed at all. */
  notes: boolean;
  /** Handle written on note lines, empty to take the lab identity. */
  author: string;
}

/**
 * A mark as the panel lists it.
 */
export interface IListedMark extends IMark {
  /** The marked text, empty when the mark has no passage any more. */
  text: string;
  /** Where the mark sits in the document, 0 at the start and 1 at the end. */
  position: number;
  /**
   * Whether the mark has lost its place: a marker is missing, or the passage
   * is not in the rendered view.
   */
  unanchored: boolean;
}

/**
 * Options for {@link NotesController}.
 */
export interface INotesControllerOptions {
  widget: MarkdownDocument;
  /**
   * Emitted when the live controller has finished a change, so the rendered
   * DOM is again what the renderer produced and the passages can be found.
   */
  settled: ISignal<unknown, void>;
  /**
   * Read the file now and apply what changed. Called before every write, so a
   * change waiting on disk is in the document before the save.
   */
  refresh: () => Promise<void>;
  /** The lab's user manager, for the identity a note line is signed with. */
  user: User.IManager | null;
  settings: INotesSettings;
}

/**
 * One replacement in the document source.
 */
interface ISourceEdit {
  start: number;
  end: number;
  text: string;
}

/**
 * A mark and where its passage sits in the rendered text.
 */
interface IAnchored {
  mark: IMark;
  range: IRenderedRange;
}

/** Everything a marker's own line may hold before it. */
const BEFORE_MARKER = /^[ \t]*$/;

/** Everything a marker's own line may hold after it. */
const AFTER_MARKER = /^[ \t]*\r?\n?$/;

/** Characters a note handle can carry. */
const HANDLE = /[^A-Za-z0-9_.-]+/g;

/** The name jupyter_server gives a user it does not know. */
const ANONYMOUS = /^Anonymous/;

/**
 * A name that is a generated identifier rather than a login name: eight
 * characters or more of hexadecimal digits and hyphens, one of them a digit,
 * which is the shape of a UUID and of the identifiers a hub hands out when it
 * logs users in by identifier. It names the reader to the software that made
 * it and to nobody else, so it is no use as a handle.
 */
const GENERATED = /^(?=.*[0-9])[0-9a-f-]{8,}$/i;

/**
 * The offsets a marker is deleted or rewritten over.
 *
 * A marker that has a line to itself takes the line with it, so removing it
 * leaves no blank line where the block structure had none.
 */
function markerSpan(source: string, span: ISpan): ISourceEdit {
  const lineStart = source.lastIndexOf('\n', span.start - 1) + 1;
  const newline = source.indexOf('\n', span.end);
  const lineEnd = newline < 0 ? source.length : newline + 1;
  const alone =
    BEFORE_MARKER.test(source.slice(lineStart, span.start)) &&
    AFTER_MARKER.test(source.slice(span.end, lineEnd));
  return alone
    ? { start: lineStart, end: lineEnd, text: '' }
    : { start: span.start, end: span.end, text: '' };
}

/**
 * The attributes of a mark with its colour set, in their original order.
 */
function withColour(
  attributes: IMarkAttribute[],
  colour: MarkColour
): IMarkAttribute[] {
  const next = attributes.map(attribute =>
    attribute.key === 'colour' ? { key: 'colour', value: colour } : attribute
  );
  return next.some(attribute => attribute.key === 'colour')
    ? next
    : [...next, { key: 'colour', value: colour }];
}

/**
 * The edits that leave the document holding exactly one settings marker, at
 * its end, after one blank line.
 *
 * Every marker already there is deleted, whatever it says, so a marker this
 * version cannot read is replaced rather than left broken. A marker inside
 * the trailing whitespace is covered by the edit that writes the new one,
 * because two edits over the same offsets could not both be applied.
 */
function settingsEdits(source: string, state: PanelState): ISourceEdit[] {
  const markers = parseSettings(source).markers.map(span =>
    markerSpan(source, span)
  );
  // Where the document's own content ends: past the last character that is
  // neither whitespace nor part of a settings marker.
  let tail = source.length;
  while (tail > 0) {
    const at = tail - 1;
    const marker = markers.find(span => at >= span.start && at < span.end);
    if (marker) {
      tail = marker.start;
      continue;
    }
    if (!/\s/.test(source.charAt(at))) {
      break;
    }
    tail = at;
  }
  const edits = markers.filter(span => span.end <= tail);
  edits.push({
    start: tail,
    end: source.length,
    text: `${tail > 0 ? '\n\n' : ''}${serialiseSettings({ panel: state })}\n`
  });
  return edits;
}

/**
 * Build the span that paints one mark.
 */
function markSpan(mark: IMark): HTMLElement {
  const span = document.createElement('span');
  span.className = `${MARK_CLASS} ${MARK_CLASS}-${mark.colour}`;
  span.dataset.mark = mark.id;
  return span;
}

/**
 * Paint the marked passages of a render.
 *
 * Each text node the passages reach is rebuilt once from its own slices, so
 * two marks whose passages overlap both paint their whole passage: the slice
 * they share is wrapped in one span for each of them, the earlier mark
 * outermost.
 *
 * @param snapshot - text captured from `root` before painting
 * @param root - the rendered Markdown host
 * @param anchored - the marks to paint and where their passages sit
 */
function paintMarks(
  snapshot: ITextSnapshot,
  root: HTMLElement,
  anchored: IAnchored[]
): void {
  const work = new Map<
    Text,
    Array<{ start: number; end: number; mark: IMark }>
  >();
  for (const item of anchored) {
    for (const span of snapshot.spans) {
      if (span.end <= item.range.start || span.start >= item.range.end) {
        continue;
      }
      // Whitespace between two blocks sits directly under the root, and
      // wrapping it would add a direct child there.
      if (span.node.parentElement === root) {
        continue;
      }
      const start = Math.max(item.range.start, span.start) - span.start;
      const end = Math.min(item.range.end, span.end) - span.start;
      if (end <= start) {
        continue;
      }
      const covers = work.get(span.node) ?? [];
      covers.push({ start, end, mark: item.mark });
      work.set(span.node, covers);
    }
  }

  for (const [node, covers] of work) {
    const value = node.nodeValue ?? '';
    const cuts = new Set<number>([0, value.length]);
    for (const cover of covers) {
      cuts.add(cover.start);
      cuts.add(cover.end);
    }
    const points = Array.from(cuts).sort((a, b) => a - b);
    const fragment = document.createDocumentFragment();
    for (let i = 0; i + 1 < points.length; i++) {
      const [at, next] = [points[i], points[i + 1]];
      const covering = covers.filter(
        cover => cover.start <= at && cover.end >= next
      );
      let child: Node = document.createTextNode(value.slice(at, next));
      for (let j = covering.length - 1; j >= 0; j--) {
        const element = markSpan(covering[j].mark);
        element.appendChild(child);
        child = element;
      }
      fragment.appendChild(child);
    }
    node.parentNode?.replaceChild(fragment, node);
  }
}

/**
 * Take every mark span out of a render, putting back the text it wrapped.
 */
function unpaintMarks(root: HTMLElement): void {
  for (const element of Array.from(root.querySelectorAll(`.${MARK_CLASS}`))) {
    const parent = element.parentNode;
    if (!parent) {
      continue;
    }
    while (element.firstChild) {
      parent.insertBefore(element.firstChild, element);
    }
    parent.removeChild(element);
    parent.normalize();
  }
}

/**
 * Reads the marks of one open preview, paints them, and writes them back.
 */
export class NotesController implements IDisposable {
  constructor(options: INotesControllerOptions) {
    this._widget = options.widget;
    this._refresh = options.refresh;
    this._user = options.user;
    this._settings = options.settings;
    // A Markdown preview is built by the text model factory, so its model is
    // always a code model and its shared model always a shared file.
    this._context = options.widget
      .context as DocumentRegistry.IContext<DocumentRegistry.ICodeModel>;

    options.settled.connect(this._onSettled, this);
    this._widget.content.rendered.connect(this._onRendered, this);
    this._widget.disposed.connect(this._onWidgetDisposed, this);
    this._widget.node.addEventListener('click', this._onClick, true);

    // Nothing is read until the document has loaded: before that the model is
    // empty, so every mark would be reported as gone and remembered as such.
    void this._context.ready.then(() => {
      if (this._disposed) {
        return;
      }
      this._context.model.contentChanged.connect(this._onContentChanged, this);
      this._read();
      this._paint();
    });
  }

  get isDisposed(): boolean {
    return this._disposed;
  }

  /**
   * Emitted when the marks or the panel state have changed.
   */
  get changed(): ISignal<this, void> {
    return this._changed;
  }

  /**
   * Emitted with a mark's identifier when the reader clicks its passage.
   */
  get activated(): ISignal<this, string> {
    return this._activated;
  }

  /**
   * The marks of the document in document order, followed by the ones this
   * session saw whose markers a rewrite has since removed.
   */
  get marks(): IListedMark[] {
    const source = this._source;
    const listed = this._marks.map(mark => this._listed(mark, source));
    const present = new Set(this._marks.map(mark => mark.id));
    for (const [id, remembered] of this._remembered) {
      if (!present.has(id)) {
        listed.push({ ...remembered, unanchored: true });
      }
    }
    return listed;
  }

  /**
   * The state of the notes panel: the document's own, or the default for a
   * document that stores none.
   */
  get panelState(): PanelState {
    return this._state;
  }

  /**
   * Apply changed settings without reopening the document.
   */
  updateSettings(settings: INotesSettings): void {
    this._settings = settings;
    this._paint();
    this._changed.emit();
  }

  dispose(): void {
    if (this._disposed) {
      return;
    }
    this._disposed = true;
    if (this._frame !== null) {
      window.cancelAnimationFrame(this._frame);
      this._frame = null;
    }
    if (this._flashTimer !== null) {
      window.clearTimeout(this._flashTimer);
      this._flashTimer = null;
    }
    this._widget.node.removeEventListener('click', this._onClick, true);
    const root = this._root;
    if (root) {
      unpaintMarks(root);
    }
    Signal.clearData(this);
  }

  /**
   * Mark the selected text.
   *
   * @param selection - the selected range of the rendered view
   * @param colour - the colour to mark it in
   * @returns the identifier of the new mark, or null when the selected words
   * cannot be found in the source and nothing was written
   */
  async mark(
    selection: ISelectionRange,
    colour: MarkColour
  ): Promise<string | null> {
    await this._refresh();
    const root = this._root;
    if (this._disposed || !root) {
      return null;
    }
    // The range is taken after the refresh, so it is offsets into the source
    // the write is applied to even when a change from disk just landed.
    const range = selectionToSource(selection, root, this._source);
    if (!range) {
      return null;
    }
    const id = newId();
    const opening = serialiseOpening({
      id,
      type: MARK_TYPE,
      attributes: [{ key: 'colour', value: colour }],
      notes: []
    });
    const closing = serialiseClosing(id);
    await this._write([
      {
        start: range.start,
        end: range.start,
        text: range.startOwnLine ? `${opening}\n` : opening
      },
      {
        start: range.end,
        end: range.end,
        text: range.endOwnLine ? `\n${closing}` : closing
      }
    ]);
    return id;
  }

  /**
   * Add a note to a mark, signed and stamped.
   *
   * An empty note writes nothing: a mark without notes is the bare mark the
   * reader already has.
   */
  async addNote(id: string, text: string): Promise<void> {
    const body = text.trim();
    if (!body) {
      return;
    }
    const stamp = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
    await this._rewrite(id, mark => ({
      ...mark,
      notes: [...mark.notes, { author: this.author(), stamp, text: body }]
    }));
  }

  /**
   * Change a mark's colour, keeping every other attribute as it stands.
   */
  async setColour(id: string, colour: MarkColour): Promise<void> {
    await this._rewrite(id, mark => ({
      ...mark,
      attributes: withColour(mark.attributes, colour)
    }));
  }

  /**
   * Remove a mark: both markers go and the passage between them stays.
   */
  async remove(id: string): Promise<void> {
    await this._refresh();
    if (this._disposed) {
      return;
    }
    const source = this._source;
    const mark = parseMarks(source).find(found => found.id === id);
    if (mark && mark.type !== MARK_TYPE) {
      return;
    }
    // A mark the reader removed is gone, so it is not one of the marks this
    // session remembers for want of its markers.
    this._remembered.delete(id);
    const edits = [mark?.open, mark?.close]
      .filter((span): span is ISpan => !!span)
      .map(span => markerSpan(source, span));
    if (!edits.length) {
      this._changed.emit();
      return;
    }
    await this._write(edits);
  }

  /**
   * Store the state of the notes panel in the document.
   */
  async setPanelState(state: PanelState): Promise<void> {
    if (state === this._state) {
      return;
    }
    // The panel follows at once; the document follows when the write lands.
    this._state = state;
    this._changed.emit();
    await this._refresh();
    if (this._disposed) {
      return;
    }
    await this._write(settingsEdits(this._source, state));
  }

  /**
   * Bring a mark's passage into view and flash it.
   *
   * @param id - the mark to reveal
   * @returns whether the passage is painted in this render
   */
  reveal(id: string): boolean {
    const root = this._root;
    if (!root) {
      return false;
    }
    const painted = Array.from(
      root.querySelectorAll<HTMLElement>(`[data-mark="${id}"]`)
    );
    if (!painted.length) {
      return false;
    }
    // jsdom has no layout, so the tests run without this call.
    if (typeof painted[0].scrollIntoView === 'function') {
      painted[0].scrollIntoView({ block: 'center' });
    }
    for (const element of painted) {
      element.classList.add(MARK_FLASH_CLASS);
    }
    if (this._flashTimer !== null) {
      window.clearTimeout(this._flashTimer);
    }
    this._flashTimer = window.setTimeout(() => {
      this._flashTimer = null;
      for (const element of painted) {
        element.classList.remove(MARK_FLASH_CLASS);
      }
    }, FLASH_MS);
    return true;
  }

  /**
   * The handle a note line written now is signed with.
   *
   * The setting wins, because a lab without a hub hands every reader the same
   * anonymous identity and their notes would otherwise carry no name. Failing
   * that the lab identity is taken: the username, which is the hub login name
   * where the hub logs users in by name, and otherwise the name it reports for
   * the reader, because a generated identifier tells whoever reads the note
   * next year nothing. Failing both, the default handle. Characters a handle
   * cannot carry, whitespace among them, become a hyphen, so the line reads
   * back as the entry it was written as.
   */
  author(): string {
    const identity = this._user?.identity ?? null;
    const named =
      identity && identity.name && !ANONYMOUS.test(identity.name)
        ? [identity.username, identity.name, identity.display_name].filter(
            name => name && !GENERATED.test(name.trim())
          )
        : [];
    const handle = (this._settings.author || named[0] || '')
      .trim()
      .replace(HANDLE, '-');
    return handle || DEFAULT_AUTHOR;
  }

  /**
   * The element the renderer writes into.
   */
  private get _root(): HTMLElement | null {
    return this._widget.node.querySelector('.jp-RenderedMarkdown');
  }

  /**
   * The document source as the model holds it now.
   */
  private get _source(): string {
    return this._context.model.toString();
  }

  private _onWidgetDisposed(): void {
    this.dispose();
  }

  /**
   * The reader clicked in the preview: a click on a marked passage opens that
   * mark, which is the second way to reach the note entry.
   */
  private _onClick = (event: Event): void => {
    if (!this._settings.notes) {
      return;
    }
    const target = event.target as Element | null;
    const element = target?.closest?.(`.${MARK_CLASS}`) as HTMLElement | null;
    const id = element?.dataset.mark;
    if (id) {
      this._activated.emit(id);
    }
  };

  /**
   * The model changed, by the reader's own writing or by a change from disk.
   * Reading the marks again is deferred one frame, so a burst of edits is
   * read once.
   */
  private _onContentChanged(): void {
    if (this._frame !== null) {
      return;
    }
    this._frame = window.requestAnimationFrame(() => {
      this._frame = null;
      this._read();
    });
  }

  /**
   * A render finished: paint the marks on it.
   *
   * The renderer rebuilt the nodes the spans were in, so nothing is painted
   * any more whatever the marks say and the last painting is forgotten. Two
   * renders of the same text would otherwise leave the second one bare.
   */
  private _onRendered(): void {
    this._flush();
    this._painted = null;
    this._paint();
  }

  /**
   * The live controller has taken its decorations back out, so the rendered
   * text is the whole document again and passages inside a change can be
   * found.
   */
  private _onSettled(): void {
    this._flush();
    this._paint();
  }

  /**
   * Read the marks now when a deferred read is waiting, so a render never
   * paints against marks a change has already replaced.
   */
  private _flush(): void {
    if (this._frame === null) {
      return;
    }
    window.cancelAnimationFrame(this._frame);
    this._frame = null;
    this._read();
  }

  /**
   * Read the marks and the panel state out of the document.
   */
  private _read(): void {
    if (this._disposed) {
      return;
    }
    const source = this._source;
    this._marks = parseMarks(source);
    for (const mark of this._marks) {
      if (mark.open && mark.close) {
        this._remembered.set(mark.id, this._listed(mark, source));
      }
    }
    // The opening rule lives with the panel, which is what it decides for.
    // A read applies it only where it opens the panel: a rewrite that takes
    // the last mark away leaves that mark listed as unanchored, and a listing
    // behind a hidden panel is one the reader cannot read. The state a
    // document with no marks and no settings marker opens in is the default
    // this field already holds.
    const stored = parseSettings(source).settings;
    const hasMarks = this._marks.length > 0;
    if (stored) {
      this._state = stored.panel;
    } else if (hasMarks) {
      this._state = openingState(null, hasMarks);
    }
    this._changed.emit();
  }

  /**
   * A mark in the shape the panel lists it in.
   */
  private _listed(mark: IMark, source: string): IListedMark {
    return {
      ...mark,
      text: mark.passage
        ? source.slice(mark.passage.start, mark.passage.end)
        : '',
      position: mark.open ? mark.open.start / Math.max(source.length, 1) : 0,
      unanchored: !mark.passage || this._lost.has(mark.id)
    };
  }

  /**
   * Paint every anchored passage of the current render.
   *
   * The painting of a render is left alone while it still says what the marks
   * say; anything else is taken out and made again, so a colour change, a new
   * mark and a removal all land, and no span of a mark that is gone is left
   * behind.
   */
  private _paint(): void {
    const root = this._root;
    if (this._disposed || !root) {
      return;
    }
    if (!this._settings.notes) {
      unpaintMarks(root);
      this._painted = null;
      return;
    }
    // Before the first render there is nothing to find a passage in, and a
    // mark is not unanchored for want of a render.
    if (!root.textContent?.trim()) {
      return;
    }
    const source = this._source;
    // The words of the source and the words of the render are the same for
    // every mark, so both are read once here rather than once per mark.
    const scan = tokeniseSource(source);
    const words = renderedWords(captureText(root).text);
    const anchored: IAnchored[] = [];
    const lost = new Set<string>();
    for (const mark of this._marks) {
      if (!mark.passage) {
        continue;
      }
      const range = passageToRendered(mark.passage, scan, words);
      if (!range || range.end <= range.start) {
        lost.add(mark.id);
        continue;
      }
      anchored.push({ mark, range });
    }

    const signature = anchored
      .map(
        item =>
          `${item.mark.id} ${item.mark.colour} ${item.range.start}-${item.range.end}`
      )
      .join('\n');
    if (signature !== this._painted) {
      unpaintMarks(root);
      paintMarks(captureText(root), root, anchored);
      this._painted = signature;
    }

    // A passage the render does not hold makes its mark unanchored, so the
    // panel says so rather than offering a row that leads nowhere. While a
    // change is decorated the text it added is held out of the capture, so a
    // passage inside it is not there to be found and says nothing about the
    // mark; the marks are painted again when the change settles.
    if (
      !root.querySelector(`.${DECORATION_CLASS}`) &&
      (lost.size !== this._lost.size ||
        [...lost].some(id => !this._lost.has(id)))
    ) {
      this._lost = lost;
      this._changed.emit();
    }
  }

  /**
   * Rewrite a mark's opening marker in place.
   *
   * The mark is read out of the document again rather than taken from the
   * last read, because the refresh may just have applied a change from disk.
   * A mark of a type this version does not write is left exactly as it is.
   */
  private async _rewrite(
    id: string,
    change: (mark: IMark) => IMarkContent
  ): Promise<void> {
    await this._refresh();
    if (this._disposed) {
      return;
    }
    const mark = parseMarks(this._source).find(
      found => found.id === id && found.open
    );
    if (!mark || !mark.open || mark.type !== MARK_TYPE) {
      return;
    }
    await this._write([
      {
        start: mark.open.start,
        end: mark.open.end,
        text: serialiseOpening(change(mark))
      }
    ]);
  }

  /**
   * Write edits into the document and save it.
   *
   * One transaction, kept off the undo stack and tagged as a mark, so the
   * whole write renders once and every extension observing the model can tell
   * it from typing and from a change applied from disk. The edits are made
   * from the end backwards, so the offsets of the earlier ones stand.
   *
   * The save is skipped where the document already held unsaved edits. The
   * preview and the editor share one document, so those edits are the
   * reader's own writing, and saving would put them on disk without being
   * asked; a change from disk is held back while the document is dirty as
   * well, so the file would be the newer one and the save would raise the
   * File Changed dialog. The marker stays in the document and reaches disk
   * with the reader's own next save.
   */
  private async _write(edits: ISourceEdit[]): Promise<void> {
    if (!edits.length) {
      return;
    }
    const unsaved = this._context.model.dirty;
    const shared = this._context.model.sharedModel;
    shared.transact(
      () => {
        for (const edit of [...edits].sort((a, b) => b.start - a.start)) {
          shared.updateSource(edit.start, edit.end, edit.text);
        }
      },
      false,
      MARK_ORIGIN
    );
    // Read the marks now rather than on the frame the change scheduled, so
    // what was just written is listed by the time the caller has its answer
    // and a command can act on the mark it made.
    this._flush();
    // The viewer re-renders on its own once its render timeout has run; asking
    // for the render now is what puts the mark on screen at once.
    this._widget.content.update();
    if (!unsaved) {
      await this._context.save();
    }
  }

  private _widget: MarkdownDocument;
  private _context: DocumentRegistry.IContext<DocumentRegistry.ICodeModel>;
  private _refresh: () => Promise<void>;
  private _user: User.IManager | null;
  private _settings: INotesSettings;
  private _marks: IMark[] = [];
  private _remembered = new Map<string, IListedMark>();
  private _lost = new Set<string>();
  private _state: PanelState = 'hidden';
  private _painted: string | null = null;
  private _frame: number | null = null;
  private _flashTimer: number | null = null;
  private _disposed = false;
  private _changed = new Signal<this, void>(this);
  private _activated = new Signal<this, string>(this);
}
