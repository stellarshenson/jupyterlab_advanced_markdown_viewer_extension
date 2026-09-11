/**
 * Watching one open document for changes made outside JupyterLab.
 *
 * Nothing in JupyterLab looks at a file while it sits open and unmodified, so
 * an external writer is invisible until the next save. This watcher registers
 * the file with the change channel, reads it when the channel reports a
 * change and, when the content really has changed, applies it to the
 * document's shared model as positioned edits.
 *
 * The policy on a document with unsaved edits is to leave it alone. That is
 * what every mainstream editor does, and merging into unsaved text needs a
 * three-way merge that this extension does not yet have. Such a change is
 * reported rather than applied, kept, and lands once the document is clean
 * again - or is let go once the document took it some other way, by a save
 * that overwrote it or a reload that loaded it.
 */

import { DocumentRegistry } from '@jupyterlab/docregistry';
import { Contents } from '@jupyterlab/services';
import { ISignal, Signal } from '@lumino/signaling';
import { IDisposable } from '@lumino/disposable';

import { ChangeChannel, IChange } from './channel';
import { diffWords } from './diff';

/**
 * Transaction origin marking an edit this extension applied from disk.
 *
 * Other extensions observing the shared model use it to tell a rewrite from
 * disk apart from the user's own typing, so the text is a wire value: a
 * sibling matches on it. It is also the prefix every console warning of this
 * package carries, in the watcher, the channel and the notes controller, so
 * rewording it for legibility would change what those siblings match on.
 */
export const EXTERNAL_ORIGIN = 'jupyterlab_advanced_markdown_viewer_extension';

/**
 * Why a check did not apply what it found.
 */
export type BlockedReason = 'dirty' | 'missing';

/**
 * A single replacement to make in the document source.
 */
interface ISourceEdit {
  start: number;
  end: number;
  text: string;
}

/**
 * Turn an edit script into replacements against the earlier string.
 *
 * @param before - the text the document currently holds
 * @param after - the text on disk
 * @returns replacements in the coordinates of `before`, in ascending order
 */
export function sourceEdits(before: string, after: string): ISourceEdit[] {
  const edits: ISourceEdit[] = [];
  let offset = 0;
  for (const op of diffWords(before, after)) {
    if (op.kind === 'equal') {
      offset += op.text.length;
      continue;
    }
    if (op.kind === 'delete') {
      const last = edits[edits.length - 1];
      if (last && last.end === offset && last.text === '') {
        last.end = offset + op.text.length;
      } else {
        edits.push({ start: offset, end: offset + op.text.length, text: '' });
      }
      offset += op.text.length;
      continue;
    }
    const last = edits[edits.length - 1];
    if (last && last.end === offset) {
      last.text += op.text;
    } else {
      edits.push({ start: offset, end: offset, text: op.text });
    }
  }
  return edits;
}

/**
 * Options for {@link FileWatcher}.
 */
export interface IFileWatcherOptions {
  context: DocumentRegistry.IContext<DocumentRegistry.ICodeModel>;
  contents: Contents.IManager;
  channel: ChangeChannel;
  enabled: boolean;
}

/**
 * Follows one document's file through the change channel and applies changes
 * made outside JupyterLab.
 */
export class FileWatcher implements IDisposable {
  constructor(options: IFileWatcherOptions) {
    this._context = options.context;
    this._contents = options.contents;
    this._channel = options.channel;
    this._shadow = '';
    this._enabled = options.enabled;

    options.context.saveState.connect(this._onSaveState, this);

    // Nothing is compared until the document has loaded. Before that the model
    // is empty and the contents model absent, so a first check would read the
    // whole file as an external change and apply it over the load in flight.
    void options.context.ready.then(() => {
      if (this._disposed) {
        return;
      }
      // The model holds the text just loaded from disk, unless the reader
      // typed before this watcher was built: a preview opened over a document
      // with unsaved edits. That text is no revision of the file, so the
      // shadow stays empty and the first read holds a change back instead of
      // applying it over their work (DEF-APPLY-90).
      if (!this._context.model.dirty) {
        this._shadow = this._context.model.toString();
      }
      this._record(this._context.contentsModel);
      this._path = this._context.path;
      this._ready = true;
      this._channel.changed.connect(this._onChange, this);
      this._context.pathChanged.connect(this._onPathChanged, this);
      // A held change lands as soon as the document is clean again; without a
      // timer, the dirty flag going down is what says so.
      this._context.model.stateChanged.connect(this._onModelState, this);
      // Reload from Disk loads the file into the document and leaves it dirty,
      // and the file does not move, so neither the dirty flag nor the channel
      // says so. The Context reports the revision it loaded here.
      this._context.fileChanged.connect(this._onFileChanged, this);
      if (this._enabled) {
        this._channel.register(this._path);
        // A write between the load and this registration is reported by
        // nothing: the server matches events only from the registration on,
        // and the channel's first stat is a baseline taken after it. One read
        // here is what closes that gap.
        void this._check();
      }
    });
  }

  /**
   * Emitted after content from disk has been applied to the model.
   */
  get applied(): ISignal<this, void> {
    return this._applied;
  }

  /**
   * Emitted when a change was found but deliberately not applied.
   */
  get blocked(): ISignal<this, BlockedReason> {
    return this._blocked;
  }

  /**
   * Emitted when a change reported as blocked no longer waits, without having
   * been applied here: the document took it through a save or a reload.
   */
  get unblocked(): ISignal<this, void> {
    return this._unblocked;
  }

  get isDisposed(): boolean {
    return this._disposed;
  }

  /**
   * Whether the file is watched at all.
   *
   * Turning watching off keeps the shadow, so turning it back on compares the
   * file against the last content this watcher applied.
   */
  set enabled(value: boolean) {
    if (this._enabled === value) {
      return;
    }
    this._enabled = value;
    if (!this._ready || this._disposed) {
      return;
    }
    if (value) {
      this._channel.register(this._path);
      void this._check();
    } else {
      this._channel.release(this._path);
      // A change held back while watching was on does not wait behind the
      // switch: it is let go, so nothing lands later without the reader
      // having asked for it. Turning watching back on reads the file again
      // and reports the change again if it is still there.
      this._release();
    }
  }

  dispose(): void {
    if (this._disposed) {
      return;
    }
    this._disposed = true;
    if (this._ready && this._enabled) {
      this._channel.release(this._path);
    }
    Signal.clearData(this);
  }

  /**
   * Check the file now, without waiting for an event.
   *
   * The notes feature calls this before every marker write. The switch holds
   * here as on every other entrance, because it is tested in `_read`.
   */
  async refresh(): Promise<void> {
    await this._check();
  }

  /**
   * Record which revision of the file the document holds, for the Context.
   */
  private _record(model: Omit<Contents.IModel, 'content'> | null): void {
    this._revision = model;
  }

  /**
   * A save from this session is not an external change, and it overwrote
   * whatever was waiting on disk.
   */
  private _onSaveState(_: unknown, state: DocumentRegistry.SaveState): void {
    if (state === 'completed') {
      this._shadow = this._context.model.toString();
      this._record(this._context.contentsModel);
      this._release();
    }
  }

  /**
   * The channel reported this file, or another one.
   *
   * The switch is tested here as well as in `_read`, because the report of a
   * removed file is not a read and does not pass through it.
   */
  private _onChange(_: unknown, change: IChange): void {
    if (change.path !== this._path || !this._enabled) {
      return;
    }
    if (change.event === 'deleted') {
      this._missing = true;
      this._blocked.emit('missing');
      return;
    }
    void this._check();
  }

  /**
   * The document was renamed in JupyterLab: the watch moves with it.
   */
  private _onPathChanged(_: unknown, path: string): void {
    if (this._enabled) {
      this._channel.release(this._path);
      this._channel.register(path);
    }
    this._path = path;
  }

  /**
   * The document became clean while a change was held back: apply it.
   */
  private _onModelState(
    _: unknown,
    args: { name: string; newValue: unknown }
  ): void {
    if (
      args.name === 'dirty' &&
      args.newValue === false &&
      this._pending !== null
    ) {
      void this._check();
    }
  }

  /**
   * The Context recorded a new revision of the file while a change was held
   * back: a reload may have loaded it into the document, so check again.
   */
  private _onFileChanged(): void {
    if (this._pending !== null) {
      void this._check();
    }
  }

  /**
   * Forget a change held back earlier, or a file reported as gone that is
   * back with the content the document already holds, and say so.
   */
  private _release(): void {
    if (this._pending === null && !this._missing) {
      return;
    }
    this._pending = null;
    this._missing = false;
    this._unblocked.emit();
  }

  /**
   * One check, with at most one in flight: an event arriving during a check
   * runs it once more when it is done, so the newest write is never missed.
   */
  private _check(): Promise<void> {
    if (this._inFlight) {
      this._again = true;
      return this._inFlight;
    }
    const run = async () => {
      do {
        this._again = false;
        await this._read();
      } while (this._again && !this._disposed);
    };
    this._inFlight = run().finally(() => {
      this._inFlight = null;
    });
    return this._inFlight;
  }

  /**
   * Read the file and apply what differs. The event is the evidence that the
   * file moved; the content decides whether anything changed, because a
   * timestamp alone is not evidence - touching a file moves it too.
   *
   * This is the only place the file is read and the document written, so it
   * is where the switch is tested. Every entrance - the channel event, the
   * refresh the notes feature calls, the check after the document loads and
   * the check when a held change is no longer blocked - arrives here, and
   * none of them reaches disk while watching is off. The test is made again
   * after the read because reading is a round trip to the server: a switch
   * turned off during one still stops what it brings back from being applied.
   */
  private async _read(): Promise<void> {
    if (
      !this._enabled ||
      !this._ready ||
      this._disposed ||
      this._context.isDisposed
    ) {
      return;
    }
    let full: Contents.IModel;
    try {
      full = await this._contents.get(this._path, {
        content: true,
        format: 'text',
        type: 'file',
        // The server hashes only on request; without it the revision handed
        // to the Context would be by timestamp alone.
        hash: true
      });
    } catch {
      this._missing = true;
      this._blocked.emit('missing');
      return;
    }
    if (this._disposed || !this._enabled) {
      return;
    }
    // The Context holds a CRLF or CR file as LF and puts the line ending
    // back on save, so the document is compared with and written from the
    // same LF text; the file keeps its line endings on disk. The revision
    // recorded below stays the raw one, whose hash is the server's hash of
    // the raw bytes.
    const disk = (typeof full.content === 'string' ? full.content : '').replace(
      /\r\n?/g,
      '\n'
    );
    this._record(full);

    if (disk === this._shadow) {
      this._release();
      return;
    }
    const model = this._context.model;
    if (disk === model.toString()) {
      // The document already holds this revision: a reload brought it in.
      // The release comes first, because the record emits the Context's
      // fileChanged and the clean flag the model's stateChanged, and either
      // one with a change still held would start another read.
      this._shadow = disk;
      this._release();
      this._syncContentsModel();
      // Reload from Disk leaves the document dirty though it matches the file.
      model.dirty = false;
      return;
    }
    // Context._revert loads the file into the document and clears no dirty
    // flag, so after Reload from Disk the flag says nothing about unsaved
    // work: the document holds the revision that was held back, or the text
    // this watcher last loaded, applied or saw saved. Either holds nothing
    // unsaved, and a write held behind it would wait for ever (DEF-CUE-85).
    const text = model.toString();
    if (model.dirty && text !== this._pending && text !== this._shadow) {
      // Unsaved edits are never overwritten. The change is kept and lands once
      // the document is clean; the same change is reported once.
      if (this._pending !== disk) {
        this._pending = disk;
        this._blocked.emit('dirty');
      }
      return;
    }

    this._pending = null;
    this._missing = false;
    this._apply(disk);
    this._shadow = disk;
    this._syncContentsModel();
    this._applied.emit();
  }

  /**
   * Write disk content into the shared model as positioned edits.
   */
  private _apply(disk: string): void {
    const model = this._context.model;
    const shared = model.sharedModel;
    const current = model.toString();
    const edits = sourceEdits(current, disk);
    if (!edits.length) {
      return;
    }
    // One transaction, tagged and kept off the undo stack, so the change is
    // distinguishable from typing and a user's undo still means their own work.
    shared.transact(
      () => {
        for (let i = edits.length - 1; i >= 0; i--) {
          const edit = edits[i];
          shared.updateSource(edit.start, edit.end, edit.text);
        }
      },
      false,
      EXTERNAL_ORIGIN
    );
    model.dirty = false;
  }

  /**
   * Tell the Context which revision of the file the document now holds.
   *
   * The Context remembers the hash and modification time of the file as it
   * last loaded or saved it, and compares that record against disk before
   * every save; a mismatch raises the File Changed dialog. Once content from
   * disk has been applied the document holds that revision, so the record is
   * moved to it - the same move the Context makes for itself after a save.
   * JupyterLab offers no public call for it: the collaborative drive reaches
   * the same updater through a save event the Context accepts only for
   * collaborative models. So the Context's own private updater is called,
   * and the guard test in the unit suite fails should a JupyterLab release
   * take it away. A save while edits are unsaved never reaches this path, so
   * the dialog the editor raises against a newer file on disk is untouched.
   */
  private _syncContentsModel(): void {
    const revision = this._revision;
    if (!revision) {
      return;
    }
    const context = this._context as unknown as {
      _updateContentsModel?: (model: Omit<Contents.IModel, 'content'>) => void;
    };
    if (typeof context._updateContentsModel !== 'function') {
      if (!this._syncWarned) {
        this._syncWarned = true;
        console.warn(
          `${EXTERNAL_ORIGIN}: the document context has no contents model updater; the next save may report the file as changed`
        );
      }
      return;
    }
    context._updateContentsModel({
      ...(this._context.contentsModel ?? {}),
      ...revision
    });
  }

  private _context: DocumentRegistry.IContext<DocumentRegistry.ICodeModel>;
  private _contents: Contents.IManager;
  private _channel: ChangeChannel;
  private _path = '';
  private _shadow: string;
  private _inFlight: Promise<void> | null = null;
  private _again = false;
  private _revision: Omit<Contents.IModel, 'content'> | null = null;
  private _pending: string | null = null;
  private _missing = false;
  private _syncWarned = false;
  private _disposed = false;
  private _enabled: boolean;
  private _ready = false;
  private _applied = new Signal<this, void>(this);
  private _blocked = new Signal<this, BlockedReason>(this);
  private _unblocked = new Signal<this, void>(this);
}
