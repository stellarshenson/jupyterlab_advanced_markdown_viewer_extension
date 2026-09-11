import { Signal } from '@lumino/signaling';

import { changeRanges, diffWords } from '../diff';
import { captureText, decorate } from '../highlight';
import { FileWatcher, sourceEdits } from '../watcher';

// The Context class is loaded for one guard test. Its dialog and rendering
// imports are not needed for that and are cut off here, because they drag a
// module graph into jsdom that jest is not configured to transform.
jest.mock('@jupyterlab/apputils', () => ({}));
jest.mock('@jupyterlab/rendermime', () => ({}));
import { Context } from '@jupyterlab/docregistry/lib/context';

/**
 * Apply replacements the way the watcher does, from the end backwards.
 */
function apply(before: string, edits: ReturnType<typeof sourceEdits>): string {
  let text = before;
  for (let i = edits.length - 1; i >= 0; i--) {
    const edit = edits[i];
    text = text.slice(0, edit.start) + edit.text + text.slice(edit.end);
  }
  return text;
}

describe('sourceEdits', () => {
  it('produces no edits for identical text', () => {
    expect(sourceEdits('same text', 'same text')).toHaveLength(0);
  });

  it('turns the earlier text into the later text', () => {
    const before = '# Title\n\nfirst paragraph\n';
    const after = '# Title\n\nfirst paragraph revised\n';
    expect(apply(before, sourceEdits(before, after))).toBe(after);
  });

  it('handles an insertion at the start', () => {
    const before = 'body\n';
    const after = '# Heading\n\nbody\n';
    expect(apply(before, sourceEdits(before, after))).toBe(after);
  });

  it('handles a deletion at the end', () => {
    const before = 'one\ntwo\nthree\n';
    const after = 'one\ntwo\n';
    expect(apply(before, sourceEdits(before, after))).toBe(after);
  });

  it('handles a full replacement', () => {
    const before = 'completely different content here\n';
    const after = 'nothing alike at all now\n';
    expect(apply(before, sourceEdits(before, after))).toBe(after);
  });

  it('handles emptying the file', () => {
    const before = 'something\n';
    expect(apply(before, sourceEdits(before, ''))).toBe('');
  });

  it('handles filling an empty file', () => {
    expect(apply('', sourceEdits('', 'new content\n'))).toBe('new content\n');
  });

  it('reports edits in ascending order and never overlapping', () => {
    const before = 'alpha beta gamma delta epsilon\n';
    const after = 'alpha BETA gamma DELTA epsilon\n';
    const edits = sourceEdits(before, after);
    for (let i = 1; i < edits.length; i++) {
      expect(edits[i].start).toBeGreaterThanOrEqual(edits[i - 1].end);
    }
  });

  it('leaves an untouched prefix and suffix alone', () => {
    const before = 'keep this\nchange me\nkeep that\n';
    const after = 'keep this\nchanged\nkeep that\n';
    const edits = sourceEdits(before, after);
    expect(edits.length).toBeGreaterThan(0);
    expect(edits[0].start).toBeGreaterThan(0);
    expect(apply(before, edits)).toBe(after);
  });
});

/**
 * The change channel, reduced to what the watcher uses: registrations and a
 * signal the test fires.
 */
function makeChannel() {
  const channel: any = {
    register: jest.fn(),
    release: jest.fn()
  };
  channel.changed = new Signal(channel);
  return channel;
}

/**
 * A file on the server, and a document context holding a copy of it.
 */
function makeFixture(text: string) {
  const disk: { content: string | null; hash: string; last_modified: string } =
    { content: text, hash: 'h0', last_modified: 't0' };
  const stat = () => ({
    path: 'live.md',
    name: 'live.md',
    type: 'file',
    hash: disk.hash,
    last_modified: disk.last_modified
  });
  const contents = {
    get: jest.fn(async (_path: string) => {
      if (disk.content === null) {
        throw new Error('404');
      }
      return { ...stat(), content: disk.content };
    })
  };

  let source = text;
  let transactions = 0;
  const model: any = {
    dirty: false,
    toString: () => source,
    sharedModel: {
      transact: (fn: () => void) => {
        transactions++;
        fn();
      },
      updateSource: (start: number, end: number, value: string) => {
        source = source.slice(0, start) + value + source.slice(end);
        // A real shared model reports the edit to its document model, which
        // marks itself dirty; the watcher clears that after applying.
        model.dirty = true;
      }
    }
  };
  model.stateChanged = new Signal(model);
  const context: any = {
    path: 'live.md',
    isDisposed: false,
    model,
    contentsModel: stat(),
    ready: Promise.resolve(),
    _updateContentsModel: jest.fn()
  };
  context.saveState = new Signal(context);
  context.pathChanged = new Signal(context);
  context.fileChanged = new Signal(context);

  const write = (content: string, hash: string) => {
    disk.content = content;
    disk.hash = hash;
    disk.last_modified = `t-${hash}`;
  };
  const remove = () => {
    disk.content = null;
  };
  return {
    contents,
    context,
    model,
    write,
    remove,
    source: () => source,
    transactions: () => transactions
  };
}

describe('FileWatcher', () => {
  let fixture: ReturnType<typeof makeFixture>;
  let channel: ReturnType<typeof makeChannel>;
  let watcher: FileWatcher;
  const events: string[] = [];

  // The check a signal starts runs on its own; the tests wait for it.
  const settle = () =>
    ((watcher as any)._inFlight ?? Promise.resolve()) as Promise<void>;
  // What the channel does on a write: report the path.
  const change = (event: 'changed' | 'deleted' = 'changed') => {
    channel.changed.emit({ path: 'live.md', event });
    return settle();
  };
  const reads = () => fixture.contents.get.mock.calls.length;
  // Unsaved edits: the reader types, which the shared model reports as
  // dirty. A flag flipped without a change of text is what a reload leaves
  // behind, and the watcher treats that as nothing unsaved (DEF-CUE-85).
  const type = (text = 'typed ') =>
    fixture.model.sharedModel.updateSource(0, 0, text);
  // Build a watcher over the fixture and let the check its registration
  // starts finish.
  const create = async () => {
    watcher = new FileWatcher({
      context: fixture.context,
      contents: fixture.contents as any,
      channel,
      enabled: true
    });
    watcher.applied.connect(() => events.push('applied'));
    watcher.blocked.connect((_, reason) => events.push(`blocked:${reason}`));
    watcher.unblocked.connect(() => events.push('unblocked'));
    await fixture.context.ready;
    await Promise.resolve();
    await settle();
  };

  beforeEach(async () => {
    events.length = 0;
    fixture = makeFixture('alpha\n');
    channel = makeChannel();
    await create();
  });

  afterEach(() => {
    watcher.dispose();
  });

  it('registers its path once loaded and releases it on dispose', () => {
    expect(channel.register).toHaveBeenCalledWith('live.md');
    // One read closes the gap between the load and the registration; the
    // file had not moved, so nothing was reported.
    expect(reads()).toBe(1);
    expect(events).toEqual([]);
    watcher.dispose();
    expect(channel.release).toHaveBeenCalledWith('live.md');
  });

  it('applies a write that landed between the load and the registration', async () => {
    watcher.dispose();
    events.length = 0;
    // The file moved after the context loaded it and before the channel knew
    // the path, so no event will ever report this revision.
    fixture.write('alpha beta\n', 'h1');
    await create();
    expect(fixture.source()).toBe('alpha beta\n');
    expect(events).toEqual(['applied']);
  });

  it('applies a change from disk and records the revision on the context', async () => {
    fixture.write('alpha beta\n', 'h1');
    await change();
    expect(fixture.source()).toBe('alpha beta\n');
    expect(fixture.model.dirty).toBe(false);
    expect(events).toEqual(['applied']);
    expect(fixture.context._updateContentsModel).toHaveBeenCalledWith(
      expect.objectContaining({ hash: 'h1', last_modified: 't-h1' })
    );
  });

  it('ignores events for other paths', async () => {
    fixture.write('alpha beta\n', 'h1');
    channel.changed.emit({ path: 'other.md', event: 'changed' });
    await Promise.resolve();
    expect(reads()).toBe(1);
    expect(events).toEqual([]);
  });

  it('applies nothing when the content on disk is what the document holds', async () => {
    fixture.write('alpha\n', 'h1');
    await change();
    expect(events).toEqual([]);
    expect(fixture.context._updateContentsModel).not.toHaveBeenCalled();
  });

  it('reads once more when an event arrives during a check', async () => {
    fixture.write('alpha beta\n', 'h1');
    channel.changed.emit({ path: 'live.md', event: 'changed' });
    fixture.write('alpha beta gamma\n', 'h2');
    channel.changed.emit({ path: 'live.md', event: 'changed' });
    await settle();
    expect(reads()).toBe(3);
    expect(fixture.source()).toBe('alpha beta gamma\n');
    expect(events).toEqual(['applied', 'applied']);
  });

  it('reports a missing file on a deleted event and on a failed read', async () => {
    channel.changed.emit({ path: 'live.md', event: 'deleted' });
    expect(events).toEqual(['blocked:missing']);
    expect(reads()).toBe(1);
    fixture.remove();
    await change();
    expect(events).toEqual(['blocked:missing', 'blocked:missing']);
    expect(fixture.source()).toBe('alpha\n');
  });

  it('takes the missing report back when the file returns with the same bytes', async () => {
    fixture.remove();
    await change('deleted');
    expect(events).toEqual(['blocked:missing']);
    // Moved away and back, or stashed and restored: the file is there again
    // and holds what the document holds, so nothing waits any more.
    fixture.write('alpha\n', 'h0');
    await change();
    expect(events).toEqual(['blocked:missing', 'unblocked']);
  });

  it('reports a change once while the document is dirty, then applies it once clean', async () => {
    type();
    fixture.write('alpha beta\n', 'h1');
    await change();
    await change();
    expect(events).toEqual(['blocked:dirty']);
    expect(fixture.source()).toBe('typed alpha\n');

    fixture.model.dirty = false;
    fixture.model.stateChanged.emit({
      name: 'dirty',
      oldValue: true,
      newValue: false
    });
    await settle();
    expect(events).toEqual(['blocked:dirty', 'applied']);
    expect(fixture.source()).toBe('alpha beta\n');
  });

  it('lets a held change go when a save from this session overwrote it', async () => {
    type();
    fixture.write('alpha beta\n', 'h1');
    await change();
    fixture.model.dirty = false;
    fixture.context.contentsModel = {
      ...fixture.context.contentsModel,
      hash: 'h2'
    };
    fixture.write(fixture.source(), 'h2');
    fixture.context.saveState.emit('completed');
    expect(events).toEqual(['blocked:dirty', 'unblocked']);
    await change();
    expect(events).toEqual(['blocked:dirty', 'unblocked']);
  });

  /**
   * What Reload from Disk does to the Context: it writes the file into the
   * model, records the revision it read and reports it. It clears no dirty
   * flag and emits no save state, and the file does not move, so the channel
   * reports nothing.
   */
  const reload = () => {
    fixture.model.sharedModel.updateSource(
      0,
      fixture.source().length,
      'alpha beta\n'
    );
    fixture.context.contentsModel = {
      ...fixture.context.contentsModel,
      hash: 'h1',
      last_modified: 't-h1'
    };
    fixture.context.fileChanged.emit(fixture.context.contentsModel);
  };

  it('lets a held change go when a reload brought it into the document', async () => {
    type();
    fixture.write('alpha beta\n', 'h1');
    await change();
    reload();
    await settle();
    expect(events).toEqual(['blocked:dirty', 'unblocked']);
    // The document holds what the file holds, so it is not unsaved any more.
    expect(fixture.model.dirty).toBe(false);
    expect(reads()).toBe(3);
  });

  it('keeps holding the change when the reader typed between the reload and the read', async () => {
    type();
    fixture.write('alpha beta\n', 'h1');
    await change();
    let open: () => void = () => undefined;
    const gate = new Promise<void>(resolve => {
      open = resolve;
    });
    const read = fixture.contents.get.getMockImplementation();
    fixture.contents.get.mockImplementationOnce(async path => {
      await gate;
      return read!(path);
    });
    reload();
    fixture.model.sharedModel.updateSource(11, 11, 'typed\n');
    open();
    await settle();
    // The document is no longer what the file holds: the reader's text is
    // unsaved and the change stays reported.
    expect(events).toEqual(['blocked:dirty']);
    expect(fixture.model.dirty).toBe(true);
    expect(fixture.source()).toBe('alpha beta\ntyped\n');
  });

  it('applies a write that landed while the reload was being read, the held revision being what the document holds', async () => {
    type();
    fixture.write('alpha beta\n', 'h1');
    await change();
    let open: () => void = () => undefined;
    const gate = new Promise<void>(resolve => {
      open = resolve;
    });
    const read = fixture.contents.get.getMockImplementation();
    fixture.contents.get.mockImplementationOnce(async path => {
      await gate;
      return read!(path);
    });
    reload();
    // The document holds the held revision with the flag still set, and the
    // file moves on before the read the reload started resolves.
    fixture.write('alpha beta gamma\n', 'h2');
    open();
    await settle();
    expect(events).toEqual(['blocked:dirty', 'applied']);
    expect(fixture.model.dirty).toBe(false);
    expect(fixture.source()).toBe('alpha beta gamma\n');
  });

  it('applies the next write after a reload that loaded the file over typed text with nothing held', async () => {
    type();
    // Reload from Disk with nothing held: the file did not move, so the
    // Context records nothing and reports nothing, and the flag stays set
    // over a document holding what the file holds.
    fixture.model.sharedModel.updateSource(
      0,
      fixture.source().length,
      'alpha\n'
    );
    expect(fixture.model.dirty).toBe(true);
    fixture.write('alpha beta\n', 'h1');
    await change();
    expect(events).toEqual(['applied']);
    expect(fixture.model.dirty).toBe(false);
    expect(fixture.source()).toBe('alpha beta\n');
  });

  it('holds the first write over text typed before the watcher was built (DEF-APPLY-90)', async () => {
    watcher.dispose();
    events.length = 0;
    // The reader typed in the editor, then opened the preview: the document
    // is dirty before this watcher exists, and the text it holds is not a
    // revision of the file. The read that closes the registration gap holds
    // the file's text back instead of applying it over the reader's.
    type();
    await create();
    expect(events).toEqual(['blocked:dirty']);
    expect(fixture.source()).toBe('typed alpha\n');
    fixture.write('alpha beta\n', 'h1');
    await change();
    expect(events).toEqual(['blocked:dirty', 'blocked:dirty']);
    expect(fixture.source()).toBe('typed alpha\n');
  });

  it('reads nothing when the Context records a revision and nothing is held', async () => {
    fixture.context.fileChanged.emit({
      ...fixture.context.contentsModel,
      hash: 'h9'
    });
    await settle();
    expect(reads()).toBe(1);
    expect(events).toEqual([]);
  });

  it('starts no second read from its own record or clean flag when it lets a held change go', async () => {
    // The Context reports every revision it records, and the model reports
    // its dirty flag going down; both happen inside the check that lets the
    // change go, and a change still held at that moment would be read again.
    fixture.context._updateContentsModel.mockImplementation((next: any) => {
      const moved = next.hash !== fixture.context.contentsModel.hash;
      fixture.context.contentsModel = next;
      if (moved) {
        fixture.context.fileChanged.emit(next);
      }
    });
    let dirty = false;
    Object.defineProperty(fixture.model, 'dirty', {
      get: () => dirty,
      set: (value: boolean) => {
        if (value !== dirty) {
          dirty = value;
          fixture.model.stateChanged.emit({
            name: 'dirty',
            oldValue: !value,
            newValue: value
          });
        }
      }
    });
    type();
    fixture.write('alpha beta\n', 'h1');
    await change();
    // The reader types what the file holds, so the document matches the file
    // while the Context still records the revision it loaded.
    fixture.model.sharedModel.updateSource(0, 11, 'alpha beta');
    await change();
    expect(events).toEqual(['blocked:dirty', 'unblocked']);
    expect(fixture.context.contentsModel.hash).toBe('h1');
    expect(fixture.model.dirty).toBe(false);
    expect(reads()).toBe(3);
  });

  it('moves the registration when the document is renamed', () => {
    fixture.context.path = 'moved.md';
    fixture.context.pathChanged.emit('moved.md');
    expect(channel.release).toHaveBeenCalledWith('live.md');
    expect(channel.register).toHaveBeenLastCalledWith('moved.md');
  });

  it('releases the path while disabled and registers it again when enabled', () => {
    watcher.enabled = false;
    expect(channel.release).toHaveBeenCalledWith('live.md');
    channel.changed.emit({ path: 'live.md', event: 'changed' });
    expect(reads()).toBe(1);
    watcher.enabled = true;
    expect(channel.register).toHaveBeenCalledTimes(2);
    expect(reads()).toBe(2);
  });

  it('reads nothing on an explicit refresh while disabled', async () => {
    // The notes feature refreshes before every marker write, so the switch
    // has to hold that entrance too: with it off nothing is read from disk
    // and nothing is applied.
    watcher.enabled = false;
    fixture.write('rewritten by another process\n', 'h1');
    await watcher.refresh();
    expect(reads()).toBe(1);
    expect(events).toEqual([]);
    expect(fixture.source()).toBe('alpha\n');
  });

  it('applies nothing when the document becomes clean while disabled', async () => {
    // A change arrives while the document is dirty, so it is held back. The
    // reader then turns live updates off. The document becoming clean must
    // not bring the held change in: with the switch off the highlight and
    // the tab marker are off too, so the replacement would be silent.
    type();
    fixture.write('rewritten by another process\n', 'h1');
    await change();
    expect(events).toEqual(['blocked:dirty']);

    watcher.enabled = false;
    // Nothing waits any more, so the marker the block raised comes down.
    expect(events).toEqual(['blocked:dirty', 'unblocked']);

    const before = reads();
    fixture.model.dirty = false;
    fixture.model.stateChanged.emit({
      name: 'dirty',
      oldValue: true,
      newValue: false
    });
    await settle();
    expect(reads()).toBe(before);
    expect(fixture.source()).toBe('typed alpha\n');
    expect(events).toEqual(['blocked:dirty', 'unblocked']);
  });

  it('reports the held change again when watching is turned back on', async () => {
    // The held change is let go when the switch goes off, so the check the
    // switch coming back on runs is what reports it again.
    type();
    fixture.write('rewritten by another process\n', 'h1');
    await change();
    watcher.enabled = false;
    watcher.enabled = true;
    await settle();
    expect(events).toEqual(['blocked:dirty', 'unblocked', 'blocked:dirty']);
    expect(fixture.source()).toBe('typed alpha\n');
  });

  it('applies nothing from a read in flight when watching is turned off', async () => {
    // Reading the file is a round trip to the server. A switch turned off
    // while one is in flight still stops what it brings back.
    let open: () => void = () => undefined;
    const gate = new Promise<void>(resolve => {
      open = resolve;
    });
    const read = fixture.contents.get.getMockImplementation();
    fixture.contents.get.mockImplementationOnce(async path => {
      await gate;
      return read!(path);
    });

    fixture.write('rewritten by another process\n', 'h1');
    channel.changed.emit({ path: 'live.md', event: 'changed' });
    watcher.enabled = false;
    open();
    await settle();
    expect(fixture.source()).toBe('alpha\n');
    expect(events).toEqual([]);
  });

  it('replaces every line of the document in one transaction, leaving it clean', async () => {
    watcher.dispose();
    events.length = 0;
    fixture = makeFixture('alpha\nbeta\ngamma\n');
    await create();
    const rewritten = 'delta\nepsilon\nzeta\n';
    fixture.write(rewritten, 'h1');
    await change();
    expect(fixture.source()).toBe(rewritten);
    // One transaction, so every observer of the shared model sees the rewrite
    // as one change rather than as a run of separate edits.
    expect(fixture.transactions()).toBe(1);
    expect(fixture.model.dirty).toBe(false);
    expect(events).toEqual(['applied']);
  });

  it('empties the document when the file is truncated, without an error', async () => {
    fixture.write('', 'h1');
    // A rejected read or apply would reject this await.
    await change();
    expect(fixture.source()).toBe('');
    expect(fixture.transactions()).toBe(1);
    expect(fixture.model.dirty).toBe(false);
    expect(events).toEqual(['applied']);
  });

  it('applies nothing when a CRLF file holds what the document holds as LF', async () => {
    watcher.dispose();
    events.length = 0;
    // The Context loads a CRLF file as LF and puts the CR back on save, so
    // the document and the file agree even though their bytes differ.
    fixture = makeFixture('# one\n\ntwo\n');
    await create();
    fixture.write('# one\r\n\r\ntwo\r\n', 'h1');
    await change();
    expect(fixture.transactions()).toBe(0);
    expect(events).toEqual([]);
    expect(fixture.source()).toBe('# one\n\ntwo\n');
  });

  it('applies a CRLF write as LF text', async () => {
    watcher.dispose();
    events.length = 0;
    fixture = makeFixture('# one\n');
    await create();
    fixture.write('# one\r\n\r\ntwo\r\n', 'h2');
    await change();
    expect(fixture.source()).toBe('# one\n\ntwo\n');
    expect(fixture.source()).not.toContain('\r');
    expect(events).toEqual(['applied']);
  });

  it('applies a change to a five thousand line document in under 100 ms', async () => {
    watcher.dispose();
    events.length = 0;
    const lines = Array.from(
      { length: 5000 },
      (_, i) => `line ${i} of a document an agent is rewriting\n`
    );
    fixture = makeFixture(lines.join(''));
    await create();
    const rewritten = [...lines];
    rewritten[2500] = 'line 2500 of a document an agent has rewritten\n';
    fixture.write(rewritten.join(''), 'h1');

    // The read resolves from a mock, so this measures the diff and the
    // transaction: the main-thread work of an apply, without the render.
    const started = performance.now();
    await change();
    const elapsed = performance.now() - started;

    expect(fixture.source()).toBe(rewritten.join(''));
    expect(events).toEqual(['applied']);
    expect(elapsed).toBeLessThan(100);
  });

  it('takes a whole-document write by another extension for local', async () => {
    // A sibling extension renumbers or reformats the document with one
    // setSource of the whole text. The file on disk still holds what this
    // watcher last agreed with, so the check finds nothing: no applied and no
    // blocked signal, and so no tab cue, and the sibling's text stands.
    const local = '1. alpha\n2. beta\n';
    fixture.model.sharedModel.updateSource(0, fixture.source().length, local);
    await watcher.refresh();
    expect(events).toEqual([]);
    expect(fixture.source()).toBe(local);
    expect(fixture.model.dirty).toBe(true);
    expect(fixture.context._updateContentsModel).not.toHaveBeenCalled();
  });

  it('leaves no highlight markup in the document text', async () => {
    watcher.dispose();
    events.length = 0;
    fixture = makeFixture('the quick brown fox');
    await create();
    fixture.write('the quick red fox', 'h1');
    await change();
    const applied = fixture.source();

    // Decorate the render of the applied text the way the controller does.
    const root = document.createElement('div');
    root.className = 'jp-RenderedMarkdown';
    root.innerHTML = '<p>the quick red fox</p>';
    const snapshot = captureText(root);
    const created = decorate(
      root,
      snapshot,
      changeRanges(diffWords('the quick brown fox', snapshot.text)),
      1000
    );
    expect(created.length).toBeGreaterThan(0);
    expect(root.innerHTML).toContain('jp-AdvancedMd');

    // The decorations live in the DOM alone: the document still holds the text
    // that was read from disk, and nothing of the markup.
    expect(fixture.source()).toBe(applied);
    expect(fixture.source()).toBe('the quick red fox');
    expect(fixture.source()).not.toContain('jp-AdvancedMd');
    expect(fixture.source()).not.toContain('<span');
  });

  it('relies on a contents model updater the installed Context still has', () => {
    expect(typeof (Context.prototype as any)._updateContentsModel).toBe(
      'function'
    );
  });
});
