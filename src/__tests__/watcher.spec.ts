import { Signal } from '@lumino/signaling';

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
 * A file on the server, and a document context holding a copy of it.
 */
function makeFixture(text: string) {
  const disk = { content: text, hash: 'h0', last_modified: 't0' };
  // The server's contract: the hash is computed only when asked for.
  const stat = (hash: boolean) => ({
    path: 'live.md',
    name: 'live.md',
    type: 'file',
    hash: hash ? disk.hash : null,
    last_modified: disk.last_modified
  });
  const contents = {
    get: jest.fn(
      async (_path: string, options?: { content?: boolean; hash?: boolean }) =>
        options?.content
          ? { ...stat(!!options.hash), content: disk.content }
          : stat(!!options?.hash)
    )
  };

  let source = text;
  const model = {
    dirty: false,
    toString: () => source,
    sharedModel: {
      transact: (fn: () => void) => fn(),
      updateSource: (start: number, end: number, value: string) => {
        source = source.slice(0, start) + value + source.slice(end);
      }
    }
  };
  const context: any = {
    path: 'live.md',
    isDisposed: false,
    model,
    contentsModel: stat(true),
    ready: Promise.resolve(),
    _updateContentsModel: jest.fn()
  };
  context.saveState = new Signal(context);

  const write = (content: string, hash: string) => {
    disk.content = content;
    disk.hash = hash;
    disk.last_modified = `t-${hash}`;
  };
  return { contents, context, model, write, source: () => source };
}

describe('FileWatcher', () => {
  let fixture: ReturnType<typeof makeFixture>;
  let watcher: FileWatcher;
  const events: string[] = [];

  // The poll is timer driven; the tests call one check directly instead.
  const poll = () => (watcher as any)._check() as Promise<void>;

  beforeEach(async () => {
    events.length = 0;
    fixture = makeFixture('alpha\n');
    watcher = new FileWatcher({
      context: fixture.context,
      contents: fixture.contents as any,
      interval: 60_000,
      enabled: false
    });
    watcher.applied.connect(() => events.push('applied'));
    watcher.blocked.connect((_, reason) => events.push(`blocked:${reason}`));
    watcher.unblocked.connect(() => events.push('unblocked'));
    await fixture.context.ready;
    await Promise.resolve();
  });

  afterEach(() => {
    watcher.dispose();
  });

  it('applies a change from disk and records the revision on the context', async () => {
    fixture.write('alpha beta\n', 'h1');
    await poll();
    expect(fixture.source()).toBe('alpha beta\n');
    expect(fixture.model.dirty).toBe(false);
    expect(events).toEqual(['applied']);
    expect(fixture.context._updateContentsModel).toHaveBeenCalledWith(
      expect.objectContaining({ hash: 'h1', last_modified: 't-h1' })
    );
  });

  it('reports a change once while the document is dirty, then applies it once clean', async () => {
    fixture.model.dirty = true;
    fixture.write('alpha beta\n', 'h1');
    await poll();
    await poll();
    expect(events).toEqual(['blocked:dirty']);
    expect(fixture.source()).toBe('alpha\n');

    fixture.model.dirty = false;
    await poll();
    expect(events).toEqual(['blocked:dirty', 'applied']);
    expect(fixture.source()).toBe('alpha beta\n');
    // The file was read once; the held change was applied from memory.
    expect(
      fixture.contents.get.mock.calls.filter(([, o]) => o?.content).length
    ).toBe(1);
  });

  it('lets a held change go when a save from this session overwrote it', async () => {
    fixture.model.dirty = true;
    fixture.write('alpha beta\n', 'h1');
    await poll();
    fixture.model.dirty = false;
    fixture.context.contentsModel = {
      ...fixture.context.contentsModel,
      hash: 'h2'
    };
    fixture.write(fixture.source(), 'h2');
    fixture.context.saveState.emit('completed');
    expect(events).toEqual(['blocked:dirty', 'unblocked']);
    await poll();
    expect(events).toEqual(['blocked:dirty', 'unblocked']);
  });

  it('lets a held change go when a reload brought it into the document', async () => {
    fixture.model.dirty = true;
    fixture.write('alpha beta\n', 'h1');
    await poll();
    fixture.model.dirty = false;
    fixture.model.sharedModel.updateSource(0, 6, 'alpha beta\n');
    await poll();
    expect(events).toEqual(['blocked:dirty', 'unblocked']);
  });

  it('relies on a contents model updater the installed Context still has', () => {
    expect(typeof (Context.prototype as any)._updateContentsModel).toBe(
      'function'
    );
  });
});
