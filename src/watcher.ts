/**
 * Watching one open document for changes made outside JupyterLab.
 *
 * Nothing in JupyterLab looks at a file while it sits open and unmodified, so
 * an external writer is invisible until the next save. This watcher polls the
 * file metadata and, when the content really has changed, applies it to the
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
import { Poll } from '@lumino/polling';
import { ISignal, Signal } from '@lumino/signaling';
import { IDisposable } from '@lumino/disposable';

import { diffWords } from './diff';

/**
 * Transaction origin marking an edit this extension applied from disk.
 *
 * Other extensions observing the shared model use it to tell a rewrite from
 * disk apart from the user's own typing.
 */
export const EXTERNAL_ORIGIN = 'jupyterlab_advanced_markdown_viewer_extension';

/**
 * Why a poll did not apply what it found.
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
  interval: number;
  enabled: boolean;
}

/**
 * Polls one document's file and applies changes made outside JupyterLab.
 */
export class FileWatcher implements IDisposable {
  constructor(options: IFileWatcherOptions) {
    this._context = options.context;
    this._contents = options.contents;
    this._shadow = '';
    this._enabled = options.enabled;

    this._poll = new Poll({
      auto: false,
      factory: () => this._check(),
      frequency: { interval: options.interval, backoff: true, max: 60_000 },
      name: `${EXTERNAL_ORIGIN}:${options.context.path}`,
      standby: 'when-hidden'
    });

    options.context.saveState.connect(this._onSaveState, this);

    // Nothing is compared until the document has loaded. Before that the model
    // is empty and the contents model absent, so the first poll would read the
    // whole file as an external change and apply it over the load in flight.
    void options.context.ready.then(() => {
      if (this._disposed) {
        return;
      }
      this._shadow = this._context.model.toString();
      this._record(this._context.contentsModel);
      this._ready = true;
      if (this._enabled) {
        void this._poll.start();
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
   * Whether the file is polled at all.
   *
   * Turning polling off keeps the shadow, so turning it back on compares the
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
      void this._poll.start();
    } else {
      void this._poll.stop();
    }
  }

  /**
   * Change how often the file is polled.
   */
  set interval(value: number) {
    this._poll.frequency = {
      interval: value,
      backoff: true,
      max: Math.max(value, 60_000)
    };
  }

  dispose(): void {
    if (this._disposed) {
      return;
    }
    this._disposed = true;
    Signal.clearData(this);
    this._poll.dispose();
  }

  /**
   * Poll once immediately, rather than waiting for the next tick.
   */
  async refresh(): Promise<void> {
    await this._poll.refresh();
  }

  /**
   * Record what the file looked like, so the next poll has something to
   * compare against.
   */
  private _record(model: Omit<Contents.IModel, 'content'> | null): void {
    this._lastModified = model?.last_modified ?? null;
    this._hash = (model as { hash?: string } | null)?.hash ?? null;
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
   * Forget a change held back earlier, and say so.
   */
  private _release(): void {
    if (this._pending === null) {
      return;
    }
    this._pending = null;
    this._unblocked.emit();
  }

  /**
   * One poll: look at the metadata, and read the file only when it moved.
   */
  private async _check(): Promise<void> {
    if (this._disposed || this._context.isDisposed) {
      return;
    }
    let stat: Contents.IModel;
    try {
      stat = await this._contents.get(this._context.path, {
        content: false,
        hash: true
      });
    } catch {
      this._blocked.emit('missing');
      return;
    }
    if (this._disposed) {
      return;
    }

    const hash = (stat as { hash?: string }).hash ?? null;
    const moved =
      this._hash !== null && hash !== null
        ? hash !== this._hash
        : stat.last_modified !== this._lastModified;

    let disk: string;
    if (moved) {
      // The metadata moved. Read the file, because a timestamp alone is not
      // evidence that the content differs - touching a file moves it too.
      let full: Contents.IModel;
      try {
        full = await this._contents.get(this._context.path, {
          content: true,
          format: 'text',
          type: 'file',
          // The server hashes only on request; without it the revision handed
          // to the Context, and the next poll's own comparison, would be by
          // timestamp alone.
          hash: true
        });
      } catch {
        this._blocked.emit('missing');
        return;
      }
      if (this._disposed) {
        return;
      }
      disk = typeof full.content === 'string' ? full.content : '';
      this._record(full);
    } else if (this._pending !== null) {
      // Nothing new on disk, but a change held back earlier is still waiting
      // for the document to be clean.
      disk = this._pending;
    } else {
      return;
    }

    if (disk === this._shadow) {
      this._release();
      return;
    }
    const model = this._context.model;
    if (disk === model.toString()) {
      // The document already holds this revision: a reload brought it in.
      this._shadow = disk;
      this._syncContentsModel();
      this._release();
      return;
    }
    if (model.dirty) {
      // Unsaved edits are never overwritten. The change is kept and lands once
      // the document is clean; the same change is reported once.
      if (this._pending !== disk) {
        this._pending = disk;
        this._blocked.emit('dirty');
      }
      return;
    }

    this._pending = null;
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
  private _poll: Poll;
  private _shadow: string;
  private _lastModified: string | null = null;
  private _hash: string | null = null;
  private _revision: Omit<Contents.IModel, 'content'> | null = null;
  private _pending: string | null = null;
  private _syncWarned = false;
  private _disposed = false;
  private _enabled: boolean;
  private _ready = false;
  private _applied = new Signal<this, void>(this);
  private _blocked = new Signal<this, BlockedReason>(this);
  private _unblocked = new Signal<this, void>(this);
}
