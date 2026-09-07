import { Signal } from '@lumino/signaling';

/**
 * The live controller owns a file watcher that polls a server; the one test
 * that builds a live controller here only needs its signals.
 */
jest.mock('../watcher', () => {
  const signaling = jest.requireActual(
    '@lumino/signaling'
  ) as typeof import('@lumino/signaling');
  const instances: any[] = [];
  class FileWatcher {
    applied = new signaling.Signal<any, void>(this);
    blocked = new signaling.Signal<any, string>(this);
    unblocked = new signaling.Signal<any, void>(this);
    enabled = true;
    isDisposed = false;
    constructor() {
      instances.push(this);
    }
    dispose(): void {
      this.isDisposed = true;
    }
  }
  return { FileWatcher, EXTERNAL_ORIGIN: 'test', __instances: instances };
});

/**
 * The two scans a paint makes are counted, so a test can pin how many of them
 * one paint of a document carrying several marks costs. Everything else of
 * both modules is the real thing.
 */
jest.mock('../anchor', () => {
  const actual = jest.requireActual('../anchor') as typeof import('../anchor');
  return { ...actual, tokeniseSource: jest.fn(actual.tokeniseSource) };
});
jest.mock('../highlight', () => {
  const actual = jest.requireActual(
    '../highlight'
  ) as typeof import('../highlight');
  return { ...actual, captureText: jest.fn(actual.captureText) };
});

import { ISelectionRange, tokeniseSource } from '../anchor';
import { DEFAULT_SETTINGS, LiveViewController } from '../controller';
import { ADDED_CLASS, captureText } from '../highlight';
import { MARK_COLOURS, parseMarks } from '../marks';
import {
  FLASH_MS,
  MARK_CLASS,
  MARK_FLASH_CLASS,
  MARK_ORIGIN,
  NotesController
} from '../notes';

/** Identifiers of the marks the hand-written sources carry. */
const ONE = '0d4b0d0a-4a4e-4f6a-9d8c-1d6b0a3c2e11';
const TWO = '7f2c9c58-3b8a-4b8f-8f7d-2e1a5b6c7d80';

/** Identifiers of the five marks the counting case carries. */
const MANY = [0, 1, 2, 3, 4].map(
  n => `0d4b0d0a-4a4e-4f6a-9d8c-1d6b0a3c2e2${n}`
);

/** One edit of one transaction, as the shared model received it. */
interface IEdit {
  start: number;
  end: number;
  text: string;
}

/** One transaction the controller made on the shared model. */
interface ITransaction {
  undoable: boolean;
  origin: string;
  edits: IEdit[];
}

/**
 * A stand-in for one open preview: the render host, a model holding the
 * source as a string, and the signals the controller listens to.
 *
 * The shared model applies the edits to that string, so a test reads the
 * document the controller wrote by reading `source()`.
 */
function harness(initial: string, identity: unknown = null) {
  const node = document.createElement('div');
  const root = document.createElement('div');
  root.className = 'jp-RenderedMarkdown';
  node.appendChild(root);
  document.body.appendChild(node);

  let text = initial;
  const transactions: ITransaction[] = [];
  const order: string[] = [];
  const saves: string[] = [];
  let open: ITransaction | null = null;

  const model: any = {
    // The preview and the editor share one document, so the model carries the
    // editor's unsaved edits as well.
    dirty: false,
    toString: () => text,
    sharedModel: {
      transact: (fn: () => void, undoable: boolean, origin: string) => {
        order.push('transact');
        open = { undoable, origin, edits: [] };
        transactions.push(open);
        fn();
        open = null;
        model.contentChanged.emit(undefined);
      },
      updateSource: (start: number, end: number, value: string) => {
        open?.edits.push({ start, end, text: value });
        text = text.slice(0, start) + value + text.slice(end);
      }
    }
  };
  model.contentChanged = new Signal<any, void>(model);

  const context: any = {
    ready: Promise.resolve(),
    model,
    save: async () => {
      order.push('save');
      saves.push(text);
      model.dirty = false;
    }
  };

  const content: any = { update: jest.fn() };
  content.rendered = new Signal<any, void>(content);
  const widget: any = {
    node,
    context,
    content,
    isVisible: true,
    title: { className: '' }
  };
  widget.disposed = new Signal<any, void>(widget);

  const settledSource = {};
  const settled = new Signal<any, void>(settledSource);
  let onRefresh: (() => void) | null = null;
  const refresh = async () => {
    order.push('refresh');
    onRefresh?.();
  };

  const controller = new NotesController({
    widget,
    settled,
    refresh,
    user: identity === null ? null : ({ identity } as any),
    settings: { notes: true, author: '' }
  });

  return {
    controller,
    root,
    node,
    widget,
    transactions,
    order,
    saves,
    content,
    source: () => text,
    /** Whether the document holds unsaved edits. */
    dirty: () => model.dirty as boolean,
    /** Leave unsaved edits in the document, as typing in the editor does. */
    edit: () => {
      model.dirty = true;
    },
    /** Rewrite the document the way a change from disk would. */
    external: (value: string) => {
      text = value;
      model.contentChanged.emit(undefined);
    },
    /** Run something inside the next refresh, as a change landing would. */
    duringRefresh: (fn: () => void) => {
      onRefresh = fn;
    },
    /** Put a render on screen and tell the controller about it. */
    render: (html: string) => {
      root.innerHTML = html;
      content.rendered.emit(undefined);
    },
    settle: () => settled.emit(undefined)
  };
}

type IHarness = ReturnType<typeof harness>;

/**
 * Let the controller's read of the document, which waits for the context and
 * then for a frame, run to the end.
 */
async function ready(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  jest.advanceTimersByTime(20);
}

/**
 * Every text node of a render, in document order.
 */
function textNodes(root: HTMLElement): Text[] {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const nodes: Text[] = [];
  let node = walker.nextNode();
  while (node) {
    nodes.push(node as Text);
    node = walker.nextNode();
  }
  return nodes;
}

/**
 * Select from the first occurrence of `from` to the end of the first
 * occurrence of `to` at or after it.
 *
 * JupyterLab's jest shim replaces `document.createRange` with a stub holding
 * no boundaries, so the selection is built as the four members the controller
 * reads of a range.
 */
function selectText(root: HTMLElement, from: string, to: string) {
  const nodes = textNodes(root);
  let start: ISelectionRange | null = null;
  let end: { node: Text; offset: number } | null = null;
  for (const node of nodes) {
    const value = node.nodeValue ?? '';
    if (!start) {
      const at = value.indexOf(from);
      if (at >= 0) {
        start = {
          startContainer: node,
          startOffset: at,
          endContainer: node,
          endOffset: at
        };
      }
      continue;
    }
    const at = value.indexOf(to);
    if (at >= 0) {
      end = { node, offset: at + to.length };
      break;
    }
  }
  if (start && !end) {
    const value = start.startContainer.nodeValue ?? '';
    const at = value.indexOf(to, start.startOffset);
    if (at >= 0) {
      end = { node: start.startContainer as Text, offset: at + to.length };
    }
  }
  if (!start || !end) {
    throw new Error(`selection ${from}..${to} not found`);
  }
  return {
    ...start,
    endContainer: end.node,
    endOffset: end.offset
  } as ISelectionRange;
}

/** The mark spans of a render, in document order. */
const painted = (root: HTMLElement): HTMLElement[] =>
  Array.from(root.querySelectorAll<HTMLElement>(`.${MARK_CLASS}`));

const BARE = 'Alpha beta gamma delta.\n';
const BARE_HTML = '<p>Alpha beta gamma delta.</p>';

/** A document holding one bare yellow mark over `beta gamma`. */
const marked = (id = ONE, attributes = 'colour=yellow') =>
  `Alpha <!-- mark:${id} note ${attributes} -->beta gamma<!-- /mark:${id} --> delta.\n`;

const markedHtml = (id = ONE, attributes = 'colour=yellow') =>
  `<p>Alpha <!-- mark:${id} note ${attributes} -->beta gamma<!-- /mark:${id} --> delta.</p>`;

describe('NotesController', () => {
  let harnesses: IHarness[] = [];

  const open = (source: string, identity: unknown = null): IHarness => {
    const built = harness(source, identity);
    harnesses.push(built);
    return built;
  };

  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    for (const built of harnesses) {
      built.controller.dispose();
    }
    harnesses = [];
    document.body.innerHTML = '';
    jest.useRealTimers();
  });

  describe('marking', () => {
    it('writes both markers in one transaction, the closing one first', async () => {
      const h = open(BARE);
      await ready();
      h.render(BARE_HTML);

      const id = await h.controller.mark(
        selectText(h.root, 'beta', 'gamma'),
        'yellow'
      );

      expect(id).not.toBeNull();
      expect(h.transactions).toHaveLength(1);
      const [transaction] = h.transactions;
      expect(transaction.origin).toBe(MARK_ORIGIN);
      expect(transaction.undoable).toBe(false);
      expect(transaction.edits).toHaveLength(2);
      // The closing marker is written first, so the opening marker's offset in
      // the source it was computed against still stands.
      expect(transaction.edits[0].start).toBeGreaterThan(
        transaction.edits[1].start
      );
      expect(transaction.edits[0].text).toBe(`<!-- /mark:${id} -->`);
      expect(transaction.edits[1].text).toContain(`<!-- mark:${id} note`);
      expect(h.source()).toBe(
        `Alpha <!-- mark:${id} note colour=yellow -->beta gamma<!-- /mark:${id} --> delta.\n`
      );
      expect(h.saves).toEqual([h.source()]);
      // The viewer renders on its own only after its render timeout, so the
      // render is asked for, which is what puts the mark on screen at once.
      expect(h.content.update).toHaveBeenCalled();
    });

    it('gives the pair one version 4 identifier that occurs exactly twice', async () => {
      const h = open(BARE);
      await ready();
      h.render(BARE_HTML);

      const id = await h.controller.mark(
        selectText(h.root, 'beta', 'gamma'),
        'blue'
      );

      expect(id).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
      );
      expect(h.source().split(id as string)).toHaveLength(3);
    });

    it('writes the colour it was asked for', async () => {
      for (const colour of MARK_COLOURS) {
        const h = open(BARE);
        await ready();
        h.render(BARE_HTML);
        const id = await h.controller.mark(
          selectText(h.root, 'beta', 'gamma'),
          colour
        );
        expect(h.source()).toContain(`mark:${id} note colour=${colour} -->`);
      }
    });

    it('applies a change that reached the disk before writing the marker', async () => {
      const h = open(BARE);
      await ready();
      h.render(BARE_HTML);
      // The refresh stands for the watcher applying a write that landed
      // between the reader selecting the words and choosing the command.
      h.duringRefresh(() => h.external(`First line.\n\n${BARE}`));

      const id = await h.controller.mark(
        selectText(h.root, 'beta', 'gamma'),
        'yellow'
      );

      expect(h.order).toEqual(['refresh', 'transact', 'save']);
      expect(h.source()).toBe(
        `First line.\n\nAlpha <!-- mark:${id} note colour=yellow -->beta gamma<!-- /mark:${id} --> delta.\n`
      );
      expect(h.saves).toEqual([h.source()]);
    });

    it('writes nothing when the selected words are not in the source', async () => {
      const h = open(BARE);
      await ready();
      h.render('<p>Words the source does not hold.</p>');

      const id = await h.controller.mark(
        selectText(h.root, 'Words', 'hold'),
        'yellow'
      );

      expect(id).toBeNull();
      expect(h.transactions).toHaveLength(0);
      expect(h.saves).toHaveLength(0);
    });

    it('leaves a document holding unsaved edits unsaved', async () => {
      const h = open(BARE);
      await ready();
      h.render(BARE_HTML);
      // The preview and the editor share one document, so typing in the
      // editor leaves the model dirty.
      h.edit();

      const id = await h.controller.mark(
        selectText(h.root, 'beta', 'gamma'),
        'yellow'
      );

      // The mark is written, so the reader sees it; the typed text is not
      // committed to disk on their behalf, and the marker goes with their own
      // next save.
      expect(h.source()).toContain(`<!-- mark:${id} note colour=yellow -->`);
      expect(h.saves).toHaveLength(0);
      expect(h.dirty()).toBe(true);
    });
  });

  describe('notes', () => {
    it('adds a note line and leaves the passage and the closing marker alone', async () => {
      const h = open(marked());
      await ready();

      await h.controller.addNote(ONE, 'This needs a rewrite.');

      expect(h.transactions).toHaveLength(1);
      expect(h.transactions[0].edits).toHaveLength(1);
      const [mark] = parseMarks(h.source());
      expect(mark.notes).toEqual([
        {
          author: 'reader',
          stamp: expect.stringMatching(
            /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/
          ),
          text: 'This needs a rewrite.'
        }
      ]);
      expect(h.source().slice(mark.passage!.start, mark.passage!.end)).toBe(
        'beta gamma'
      );
      expect(h.source()).toContain(`<!-- /mark:${ONE} --> delta.\n`);
      expect(h.saves).toHaveLength(1);
    });

    it('writes nothing for an empty note', async () => {
      const h = open(marked());
      await ready();

      await h.controller.addNote(ONE, '   ');

      expect(h.transactions).toHaveLength(0);
      expect(h.saves).toHaveLength(0);
      expect(h.source()).toBe(marked());
    });

    it('keeps attributes it does not define, in their order', async () => {
      const h = open(marked(ONE, 'colour=blue owner=agent due=2026-09-30'));
      await ready();

      await h.controller.addNote(ONE, 'Answer me.');

      expect(h.source()).toContain(
        `<!-- mark:${ONE} note colour=blue owner=agent due=2026-09-30\n`
      );
    });

    it('leaves a mark of a type it does not write exactly as it is', async () => {
      const source = `Alpha <!-- mark:${ONE} task colour=blue -->beta gamma<!-- /mark:${ONE} --> delta.\n`;
      const h = open(source);
      await ready();

      await h.controller.addNote(ONE, 'A note.');
      await h.controller.setColour(ONE, 'pink');
      await h.controller.remove(ONE);

      expect(h.transactions).toHaveLength(0);
      expect(h.source()).toBe(source);
    });

    it('reads a change that landed on disk before rewriting the marker', async () => {
      const h = open(marked());
      await ready();
      // The refresh puts a paragraph in front of the mark, so the offsets of
      // the read before it would rewrite the wrong bytes.
      h.duringRefresh(() => h.external(`Before.\n\n${marked()}`));

      await h.controller.addNote(ONE, 'Still in place.');

      expect(h.source()).toContain('Before.\n\n');
      expect(h.source()).toContain('-->beta gamma<!-- /mark:');
      expect(parseMarks(h.source())[0].notes[0].text).toBe('Still in place.');
    });
  });

  describe('author', () => {
    const noteAuthor = async (
      identity: unknown,
      author: string
    ): Promise<string> => {
      const h = open(marked(), identity);
      await ready();
      h.controller.updateSettings({ notes: true, author });
      await h.controller.addNote(ONE, 'A note.');
      return parseMarks(h.source())[0].notes[0].author;
    };

    it('writes the author setting when it is set', async () => {
      expect(await noteAuthor({ username: 'ada', name: 'Ada' }, 'kj')).toBe(
        'kj'
      );
    });

    it('writes the lab identity when the setting is empty', async () => {
      expect(await noteAuthor({ username: 'ada', name: 'Ada' }, '')).toBe(
        'ada'
      );
    });

    it('writes the default handle for an anonymous identity', async () => {
      expect(
        await noteAuthor({ username: 'f4b1', name: 'Anonymous Fox' }, '')
      ).toBe('reader');
    });

    it('writes the default handle when the lab hands out no identity', async () => {
      expect(await noteAuthor(null, '')).toBe('reader');
    });

    it('replaces what a handle cannot carry with a hyphen', async () => {
      expect(await noteAuthor(null, 'Star Colonel')).toBe('Star-Colonel');
    });

    it('writes the name when the username is a generated identifier', async () => {
      expect(
        await noteAuthor(
          {
            username: '4fcdf4bd-4331-4e06-bdfe-66b0eddbccac',
            name: 'Konrad Jelen'
          },
          ''
        )
      ).toBe('Konrad-Jelen');
    });

    it('writes the displayed name when the name is generated as well', async () => {
      expect(
        await noteAuthor(
          {
            username: '4fcdf4bd4331',
            name: '4fcdf4bd4331',
            display_name: 'Ada Lovelace'
          },
          ''
        )
      ).toBe('Ada-Lovelace');
    });

    it('writes the default handle when nothing but an identifier names the reader', async () => {
      expect(
        await noteAuthor({ username: 'f4b1c0de99', name: 'f4b1c0de99' }, '')
      ).toBe('reader');
    });
  });

  describe('colour', () => {
    it('rewrites the colour attribute in place', async () => {
      const h = open(marked(ONE, 'colour=yellow owner=agent'));
      await ready();

      await h.controller.setColour(ONE, 'pink');

      expect(h.source()).toContain(
        `<!-- mark:${ONE} note colour=pink owner=agent -->`
      );
    });

    it('adds a colour to a mark that carries none', async () => {
      const h = open(marked(ONE, 'owner=agent'));
      await ready();

      await h.controller.setColour(ONE, 'orange');

      expect(h.source()).toContain(
        `<!-- mark:${ONE} note owner=agent colour=orange -->`
      );
    });
  });

  describe('removal', () => {
    it('removes both markers and leaves the passage byte for byte', async () => {
      const h = open(marked());
      await ready();

      await h.controller.remove(ONE);

      expect(h.source()).toBe(BARE);
      expect(h.transactions[0].edits).toHaveLength(2);
      expect(h.saves).toEqual([BARE]);
    });

    it('removes a marker that has a line to itself with its line', async () => {
      const h = open(
        `<!-- mark:${ONE} note colour=blue -->\n# Title here\n<!-- /mark:${ONE} -->\n\nBody text follows.\n`
      );
      await ready();

      await h.controller.remove(ONE);

      expect(h.source()).toBe('# Title here\n\nBody text follows.\n');
    });

    it('forgets a mark the reader removed', async () => {
      const h = open(marked());
      await ready();

      await h.controller.remove(ONE);
      jest.advanceTimersByTime(20);

      expect(h.controller.marks).toEqual([]);
    });
  });

  describe('listing', () => {
    it('lists a mark by its passage, colour and position', async () => {
      const h = open(marked(ONE, 'colour=blue'));
      await ready();

      const [mark] = h.controller.marks;
      expect(mark.id).toBe(ONE);
      expect(mark.text).toBe('beta gamma');
      expect(mark.colour).toBe('blue');
      expect(mark.unanchored).toBe(false);
      expect(mark.position).toBeGreaterThan(0);
      expect(mark.position).toBeLessThan(1);
    });

    it('says so whenever the marks of the document change', async () => {
      const h = open(BARE);
      await ready();
      let changes = 0;
      h.controller.changed.connect(() => changes++);

      h.external(marked());
      jest.advanceTimersByTime(20);

      expect(changes).toBe(1);
      expect(h.controller.marks.map(mark => mark.id)).toEqual([ONE]);
    });

    it('keeps a mark whose markers an external rewrite removed, as unanchored', async () => {
      const h = open(marked());
      await ready();

      h.external('Alpha beta gamma delta.\n');
      jest.advanceTimersByTime(20);

      const [mark] = h.controller.marks;
      expect(mark.id).toBe(ONE);
      expect(mark.unanchored).toBe(true);
      expect(mark.text).toBe('beta gamma');
    });

    it('lists a mark whose closing marker is gone as unanchored', async () => {
      const h = open(`Alpha <!-- mark:${ONE} note colour=yellow -->beta.\n`);
      await ready();

      const [mark] = h.controller.marks;
      expect(mark.unanchored).toBe(true);
      expect(mark.text).toBe('');
    });

    it('drops a remembered mark the reader removes', async () => {
      const h = open(marked());
      await ready();
      h.external(BARE);
      jest.advanceTimersByTime(20);
      expect(h.controller.marks).toHaveLength(1);

      await h.controller.remove(ONE);

      expect(h.controller.marks).toEqual([]);
      expect(h.transactions).toHaveLength(0);
      expect(h.source()).toBe(BARE);
    });

    it('leaves a mark anchored while a change is still decorated', async () => {
      const h = open(marked());
      await ready();
      // The change decoration holds the text it wraps out of the capture, so
      // the passage cannot be found in this render; that is not a lost anchor.
      h.render(
        '<p>Alpha <span class="jp-AdvancedMd-decoration jp-AdvancedMd-added">beta gamma</span> delta.</p>'
      );

      expect(h.controller.marks[0].unanchored).toBe(false);
    });

    it('lists a mark the render does not hold as unanchored', async () => {
      const h = open(marked());
      await ready();
      h.render('<p>Nothing of that document is here.</p>');

      expect(h.controller.marks[0].unanchored).toBe(true);
    });
  });

  describe('painting', () => {
    it('paints the passage inside the block it belongs to', async () => {
      const h = open(marked());
      await ready();
      h.root.innerHTML = markedHtml();
      // What the renderer produced, before anything of this extension is in it.
      const before = h.root.childNodes.length;
      h.settle();

      const spans = painted(h.root);
      expect(spans).toHaveLength(1);
      expect(spans[0].textContent).toBe('beta gamma');
      expect(spans[0].dataset.mark).toBe(ONE);
      expect(spans[0].className).toBe(`${MARK_CLASS} ${MARK_CLASS}-yellow`);
      expect(spans[0].parentElement?.tagName).toBe('P');
      expect(h.root.textContent).toBe('Alpha beta gamma delta.');
      expect(h.root.childNodes.length).toBe(before);
    });

    it('leaves heading text and identifier as the renderer wrote them', async () => {
      const h = open(
        `<!-- mark:${ONE} note colour=blue -->\n# Title here\n<!-- /mark:${ONE} -->\n\nBody text follows.\n`
      );
      await ready();
      h.render(
        `<!-- mark:${ONE} note colour=blue -->\n<h1 id="Title-here">Title here</h1>\n<!-- /mark:${ONE} -->\n<p>Body text follows.</p>`
      );

      const heading = h.root.querySelector('h1')!;
      expect(heading.textContent).toBe('Title here');
      expect(heading.id).toBe('Title-here');
      expect(painted(h.root)).toHaveLength(1);
      expect(painted(h.root)[0].parentElement).toBe(heading);
    });

    it('paints both marks of an overlapping pair', async () => {
      const source =
        `One <!-- mark:${ONE} note colour=yellow -->two ` +
        `<!-- mark:${TWO} note colour=pink -->three<!-- /mark:${ONE} --> four` +
        `<!-- /mark:${TWO} --> five.\n`;
      const h = open(source);
      await ready();
      h.render(`<p>${source.trim()}</p>`);

      const ids = painted(h.root).map(span => span.dataset.mark);
      expect(ids).toContain(ONE);
      expect(ids).toContain(TWO);
      expect(h.root.textContent).toBe('One two three four five.');
      // The passage they share carries both marks, the earlier one outside.
      const shared = painted(h.root).filter(
        span => span.textContent === 'three'
      );
      expect(shared).toHaveLength(2);
      expect(shared[0].dataset.mark).toBe(ONE);
      expect(shared[1].dataset.mark).toBe(TWO);
    });

    it('leaves the spans of a render alone while they still say what the marks say', async () => {
      const h = open(marked());
      await ready();
      h.render(markedHtml());
      const first = painted(h.root)[0];

      h.settle();

      expect(painted(h.root)[0]).toBe(first);
    });

    it('takes the spans of a mark that is gone back out', async () => {
      const h = open(marked());
      await ready();
      h.render(markedHtml());
      expect(painted(h.root)).toHaveLength(1);

      h.external(BARE);
      jest.advanceTimersByTime(20);
      h.settle();

      expect(painted(h.root)).toHaveLength(0);
      expect(h.root.textContent).toBe('Alpha beta gamma delta.');
    });

    it('paints a passage that the change decorations hid, once the change has settled', async () => {
      const h = open(marked());
      await ready();
      // While a change is decorated its added text is held out of the capture,
      // so the passage cannot be found; the render is left unpainted.
      h.render(
        `<p>Alpha <span class="jp-AdvancedMd-decoration jp-AdvancedMd-added">beta gamma</span> delta.</p>`
      );
      expect(painted(h.root)).toHaveLength(0);

      h.root.innerHTML = markedHtml();
      h.settle();

      expect(painted(h.root)).toHaveLength(1);
    });

    it('paints nothing while notes are off, and takes what it painted out', async () => {
      const h = open(marked());
      await ready();
      h.render(markedHtml());
      expect(painted(h.root)).toHaveLength(1);

      h.controller.updateSettings({ notes: false, author: '' });

      expect(painted(h.root)).toHaveLength(0);
      expect(h.root.textContent).toBe('Alpha beta gamma delta.');
      h.render(markedHtml());
      expect(painted(h.root)).toHaveLength(0);
    });

    it('paints a passage that runs across two blocks, wrapping nothing between them', async () => {
      const source =
        `Intro <!-- mark:${ONE} note colour=yellow -->first passage.\n\n` +
        `Second paragraph here<!-- /mark:${ONE} --> and more.\n`;
      const h = open(source);
      await ready();
      h.root.innerHTML =
        `<p>Intro <!-- mark:${ONE} note colour=yellow -->first passage.</p>\n` +
        `<p>Second paragraph here<!-- /mark:${ONE} --> and more.</p>`;
      const before = h.root.childNodes.length;
      h.settle();

      const spans = painted(h.root);
      expect(spans.map(span => span.textContent)).toEqual([
        'first passage.',
        'Second paragraph here'
      ]);
      // The whitespace between two blocks is a direct child of the render
      // root, and wrapping it would add one.
      expect(spans.every(span => span.parentElement?.tagName === 'P')).toBe(
        true
      );
      expect(h.root.childNodes.length).toBe(before);
    });

    it('paints a mark it has just written on the render that follows it', async () => {
      const h = open(BARE);
      await ready();
      h.render(BARE_HTML);
      const id = await h.controller.mark(
        selectText(h.root, 'beta', 'gamma'),
        'pink'
      );

      // The render arrives before the deferred read of the document would
      // have run, so the read is made first and the new mark is painted.
      h.render(markedHtml(id as string, 'colour=pink'));

      const spans = painted(h.root);
      expect(spans).toHaveLength(1);
      expect(spans[0].dataset.mark).toBe(id);
      expect(spans[0].className).toBe(`${MARK_CLASS} ${MARK_CLASS}-pink`);
    });

    it('scans the source and the render once for a paint of five marks', async () => {
      const lines = MANY.map(
        (id, n) =>
          `Line ${n} opens <!-- mark:${id} note colour=yellow -->passage ` +
          `${n} of five<!-- /mark:${id} --> and closes.`
      );
      const h = open(`${lines.join('\n\n')}\n`);
      await ready();
      const html = lines.map(line => `<p>${line}</p>`).join('\n');
      h.render(html);
      expect(painted(h.root)).toHaveLength(5);

      (tokeniseSource as jest.Mock).mockClear();
      (captureText as jest.Mock).mockClear();
      h.render(html);

      // Both scans read the same source and the same render for every mark,
      // so one paint makes one of each; the render is captured a second time
      // to paint on, because taking the spans of the last paint out rebuilds
      // the text nodes the first capture read.
      expect({
        source: (tokeniseSource as jest.Mock).mock.calls.length,
        render: (captureText as jest.Mock).mock.calls.length
      }).toEqual({ source: 1, render: 2 });
    });

    it('takes its spans out when the widget is disposed', async () => {
      const h = open(marked());
      await ready();
      h.render(markedHtml());

      h.controller.dispose();

      expect(painted(h.root)).toHaveLength(0);
      expect(h.root.textContent).toBe('Alpha beta gamma delta.');
    });
  });

  describe('reveal and activation', () => {
    it('brings a passage into view and flashes it', async () => {
      const h = open(marked());
      await ready();
      h.render(markedHtml());
      const span = painted(h.root)[0];
      const scrolled = jest.fn();
      span.scrollIntoView = scrolled;

      expect(h.controller.reveal(ONE)).toBe(true);

      expect(scrolled).toHaveBeenCalled();
      expect(span.classList.contains(MARK_FLASH_CLASS)).toBe(true);
      jest.advanceTimersByTime(FLASH_MS);
      expect(span.classList.contains(MARK_FLASH_CLASS)).toBe(false);
    });

    it('holds the flash of a passage revealed twice until the second is over', async () => {
      const h = open(marked());
      await ready();
      h.render(markedHtml());
      const span = painted(h.root)[0];

      h.controller.reveal(ONE);
      jest.advanceTimersByTime(FLASH_MS - 100);
      h.controller.reveal(ONE);
      jest.advanceTimersByTime(200);

      expect(span.classList.contains(MARK_FLASH_CLASS)).toBe(true);
      jest.advanceTimersByTime(FLASH_MS);
      expect(span.classList.contains(MARK_FLASH_CLASS)).toBe(false);
    });

    it('says so when the mark is not painted in this render', async () => {
      const h = open(marked());
      await ready();
      h.render('<p>Another document entirely.</p>');

      expect(h.controller.reveal(ONE)).toBe(false);
    });

    it('emits the identifier of a marked passage that is clicked', async () => {
      const h = open(marked());
      await ready();
      h.render(markedHtml());
      const seen: string[] = [];
      h.controller.activated.connect((_, id) => seen.push(id));

      painted(h.root)[0].dispatchEvent(
        new MouseEvent('click', { bubbles: true })
      );

      expect(seen).toEqual([ONE]);
    });

    it('says nothing when the click is not on a marked passage', async () => {
      const h = open(marked());
      await ready();
      h.render(markedHtml());
      const seen: string[] = [];
      h.controller.activated.connect((_, id) => seen.push(id));

      h.root.dispatchEvent(new MouseEvent('click', { bubbles: true }));

      expect(seen).toEqual([]);
    });
  });

  describe('panel state', () => {
    it('opens expanded for a document holding marks', async () => {
      const h = open(marked());
      await ready();
      expect(h.controller.panelState).toBe('expanded');
    });

    it('stays hidden for a document holding none', async () => {
      const h = open(BARE);
      await ready();
      expect(h.controller.panelState).toBe('hidden');
    });

    it('opens when the first mark arrives in a document that had none', async () => {
      const h = open(BARE);
      await ready();
      expect(h.controller.panelState).toBe('hidden');

      h.external(marked());
      jest.advanceTimersByTime(20);

      expect(h.controller.panelState).toBe('expanded');
    });

    it('stays open when a rewrite takes the only mark away', async () => {
      const h = open(marked());
      await ready();
      expect(h.controller.panelState).toBe('expanded');

      h.external(BARE);
      jest.advanceTimersByTime(20);

      // The mark is still listed, unanchored, and a listing behind a hidden
      // panel is one the reader cannot read.
      expect(h.controller.panelState).toBe('expanded');
      expect(h.controller.marks.map(mark => mark.unanchored)).toEqual([true]);
    });

    it('takes the state the document stores', async () => {
      const h = open(`${marked()}\n<!-- marks:settings panel=minimap -->\n`);
      await ready();
      expect(h.controller.panelState).toBe('minimap');
    });

    it('takes the state of a settings marker an external rewrite adds', async () => {
      const h = open(BARE);
      await ready();
      expect(h.controller.panelState).toBe('hidden');

      h.external(`${BARE}\n<!-- marks:settings panel=minimap -->\n`);
      jest.advanceTimersByTime(20);

      expect(h.controller.panelState).toBe('minimap');
    });

    it('falls back to the default for a settings marker it cannot read', async () => {
      const h = open(`${BARE}\n<!-- marks:settings panel= -->\n`);
      await ready();
      expect(h.controller.panelState).toBe('hidden');
    });

    it('writes the marker at the end of the document after one blank line', async () => {
      const h = open(BARE);
      await ready();

      await h.controller.setPanelState('minimap');

      expect(h.source()).toBe(
        `${BARE}\n<!-- marks:settings panel=minimap -->\n`
      );
      expect(h.order).toEqual(['refresh', 'transact', 'save']);
    });

    it('leaves exactly one settings marker after three changes', async () => {
      const h = open(BARE);
      await ready();

      await h.controller.setPanelState('minimap');
      jest.advanceTimersByTime(20);
      await h.controller.setPanelState('hidden');
      jest.advanceTimersByTime(20);
      await h.controller.setPanelState('expanded');
      jest.advanceTimersByTime(20);

      expect(h.source().split('marks:settings')).toHaveLength(2);
      expect(h.source()).toBe(
        `${BARE}\n<!-- marks:settings panel=expanded -->\n`
      );
    });

    it('drops a key it no longer writes and a marker it cannot read', async () => {
      const h = open(
        `${BARE}\n<!-- marks:settings panel=minimap sidebar=wide -->\n`
      );
      await ready();

      await h.controller.setPanelState('hidden');

      expect(h.source()).toBe(
        `${BARE}\n<!-- marks:settings panel=hidden -->\n`
      );
      expect(h.source()).not.toContain('sidebar');
    });

    it('replaces a settings marker that sits anywhere else in the document', async () => {
      const h = open(
        'Alpha.\n\n<!-- marks:settings panel=minimap -->\n\nBeta.\n'
      );
      await ready();

      await h.controller.setPanelState('hidden');

      // The blank line the hand-written marker sat on stays where it was; the
      // marker itself is gone and the only one left is at the end.
      expect(h.source().split('marks:settings')).toHaveLength(2);
      expect(h.source()).not.toContain('minimap');
      expect(
        h.source().endsWith('\n\n<!-- marks:settings panel=hidden -->\n')
      ).toBe(true);
      expect(h.source()).toContain('Alpha.');
      expect(h.source()).toContain('Beta.');
    });

    it('writes nothing when the state is already the one asked for', async () => {
      const h = open(`${marked()}\n<!-- marks:settings panel=minimap -->\n`);
      await ready();

      await h.controller.setPanelState('minimap');

      expect(h.transactions).toHaveLength(0);
      expect(h.order).toEqual([]);
    });
  });

  describe('disposal', () => {
    it('goes when the widget goes', async () => {
      const h = open(marked());
      await ready();
      h.render(markedHtml());
      h.controller.reveal(ONE);

      h.widget.disposed.emit(undefined);

      expect(h.controller.isDisposed).toBe(true);
      expect(painted(h.root)).toHaveLength(0);
    });
  });

  describe('the live controller signal it waits for', () => {
    it('says when the decorations of a change are complete', () => {
      const h = open(BARE);
      const live = new LiveViewController({
        widget: h.widget,
        contents: {} as any,
        channel: {} as any,
        settings: {
          ...DEFAULT_SETTINGS,
          animation: false,
          fadeDuration: 100
        }
      });
      const watcher = (jest.requireMock('../watcher') as any).__instances.pop();
      const settled: number[] = [];
      live.settled.connect(() => {
        settled.push(h.root.querySelectorAll(`.${ADDED_CLASS}`).length);
      });

      h.render('<p>alpha</p>');
      watcher.applied.emit(undefined);
      h.render('<p>alpha beta</p>');

      // The decoration is on screen, so the change is not complete yet.
      expect(h.root.querySelectorAll(`.${ADDED_CLASS}`)).toHaveLength(1);
      expect(settled).toEqual([]);

      jest.advanceTimersByTime(5000);

      // It fires once the fade has run, with the decorations already out.
      expect(settled).toEqual([0]);
      live.dispose();
    });
  });
});
