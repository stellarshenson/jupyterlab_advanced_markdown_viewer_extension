import { Signal } from '@lumino/signaling';
import { Title } from '@lumino/widgets';

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

/**
 * The write route is a request to the server, which no unit test has. The
 * stand-in answers what a test tells it to; by default the route is absent,
 * the way a lab without the server extension answers, so every write that
 * does not say otherwise takes the context's save path.
 */
jest.mock('../request', () => ({ fetchAPI: jest.fn() }));

import { ISelectionRange, tokeniseSource } from '../anchor';
import { DEFAULT_SETTINGS, LiveViewController } from '../controller';
import { ADDED_CLASS, captureText } from '../highlight';
import { MARK_COLOURS, parseMarks } from '../marks';
import { MARK_CLASS, MARK_ORIGIN, NotesController } from '../notes';
import { fetchAPI } from '../request';

/** The write route stand-in. */
const route = fetchAPI as jest.Mock;

/** What the route answers: a status and the body, parsed where it is JSON. */
const answer = (status: number, data: unknown) => ({
  response: { status, ok: status < 400 } as Response,
  data
});

/** The answer of a lab without the server extension: a 404 with an HTML body. */
const ABSENT = answer(404, '<html>Not Found</html>');

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
        // A real shared model reports the edit to its document model, which
        // marks itself dirty.
        model.dirty = true;
      }
    }
  };
  model.contentChanged = new Signal<any, void>(model);

  const context: any = {
    ready: Promise.resolve(),
    path: 'live.md',
    model,
    // The revision the document holds, as the watcher last synced it.
    contentsModel: { hash: 'h0' },
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
    title: new Title({ owner: {} })
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
    serverSettings: {} as any,
    user: identity === null ? null : ({ identity } as any),
    settings: { enabled: true, notes: true, author: '' }
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
    external: (value: string, hash = 'h0') => {
      text = value;
      context.contentsModel = { hash };
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

/** Make the window answer with this selection from now on. */
function stubSelection(value: unknown): void {
  (window as any).getSelection = () => value;
}

/**
 * Make the reader's selection the way the browser reports it: the window's
 * selection answers with the range and the document says the selection
 * changed, which is what the controller records.
 */
function selectRange(
  root: HTMLElement,
  from: string,
  to: string,
  notify = true
): void {
  const range = selectText(root, from, to);
  // A live range whose nodes a render took out collapses onto their parent,
  // which is what the browser's selection reports after a render.
  const first = range.startContainer;
  stubSelection({
    get isCollapsed() {
      return !first.isConnected;
    },
    rangeCount: 1,
    get anchorNode() {
      return first.isConnected ? first : root;
    },
    getRangeAt: () => ({
      ...range,
      commonAncestorContainer: root,
      toString: () => `${from}..${to}`
    }),
    removeAllRanges: jest.fn(),
    addRange: jest.fn()
  });
  if (notify) {
    document.dispatchEvent(new Event('selectionchange'));
  }
}

/**
 * The selection collapsed onto a node, as a focus move or a click leaves it.
 */
function collapseSelection(anchorNode: Node): void {
  stubSelection({
    isCollapsed: true,
    rangeCount: 1,
    anchorNode,
    getRangeAt: () => null
  });
  document.dispatchEvent(new Event('selectionchange'));
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

  const originalSelection = (window as any).getSelection;
  const originalCreateRange = document.createRange;

  beforeEach(() => {
    jest.useFakeTimers();
    route.mockReset();
    route.mockResolvedValue(ABSENT);
  });

  afterEach(() => {
    for (const built of harnesses) {
      built.controller.dispose();
    }
    harnesses = [];
    document.body.innerHTML = '';
    (window as any).getSelection = originalSelection;
    document.createRange = originalCreateRange;
    jest.useRealTimers();
  });

  describe('marking', () => {
    it('writes both markers in one transaction, the closing one first', async () => {
      const h = open(BARE);
      await ready();
      h.render(BARE_HTML);

      selectRange(h.root, 'beta', 'gamma');
      const id = await h.controller.mark('yellow');

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

      selectRange(h.root, 'beta', 'gamma');
      const id = await h.controller.mark('blue');

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
        selectRange(h.root, 'beta', 'gamma');
        const id = await h.controller.mark(colour);
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

      selectRange(h.root, 'beta', 'gamma');
      const id = await h.controller.mark('yellow');

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

      selectRange(h.root, 'Words', 'hold');
      const id = await h.controller.mark('yellow');

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

      selectRange(h.root, 'beta', 'gamma');
      const id = await h.controller.mark('yellow');

      // The mark is written, so the reader sees it; the typed text is not
      // committed to disk on their behalf, and the marker goes with their own
      // next save.
      expect(h.source()).toContain(`<!-- mark:${id} note colour=yellow -->`);
      expect(h.saves).toHaveLength(0);
      expect(h.dirty()).toBe(true);
    });
  });

  describe('the write route', () => {
    it('writes a mark through the server route when it exists', async () => {
      const h = open(BARE);
      await ready();
      h.render(BARE_HTML);
      route.mockImplementation(async () => {
        h.order.push('write');
        return answer(200, { hash: 'h1' });
      });

      selectRange(h.root, 'beta', 'gamma');
      const id = await h.controller.mark('yellow');

      const written = `Alpha <!-- mark:${id} note colour=yellow -->beta gamma<!-- /mark:${id} --> delta.\n`;
      expect(route).toHaveBeenCalledTimes(1);
      const [endPoint, , init] = route.mock.calls[0];
      expect(endPoint).toBe('write');
      expect(init.method).toBe('POST');
      expect(JSON.parse(init.body)).toEqual({
        path: 'live.md',
        expected: 'h0',
        content: written
      });
      // The file is written first, then the same edits go into the document,
      // which is clean because disk and document are equal, and the refresh
      // that follows finds them equal and syncs the revision: no save.
      expect(h.order).toEqual(['refresh', 'write', 'transact', 'refresh']);
      expect(h.source()).toBe(written);
      expect(h.transactions[0].origin).toBe(MARK_ORIGIN);
      expect(h.dirty()).toBe(false);
      expect(h.saves).toHaveLength(0);
    });

    it('retries a write the server refused and lands the second', async () => {
      const h = open(BARE);
      await ready();
      h.render(BARE_HTML);
      const newer = `First line.\n\n${BARE}`;
      route.mockImplementationOnce(async () => {
        // The refusal carries the file as it is; the refresh that follows
        // brings it into the document through the watcher's normal path.
        h.duringRefresh(() => {
          h.external(newer, 'h1');
          h.render(`<p>First line.</p>${BARE_HTML}`);
          h.duringRefresh(() => undefined);
        });
        return answer(409, { content: newer, hash: 'h1' });
      });
      route.mockImplementationOnce(async () => answer(200, { hash: 'h2' }));

      selectRange(h.root, 'beta', 'gamma');
      const id = await h.controller.mark('yellow');

      const written = `First line.\n\nAlpha <!-- mark:${id} note colour=yellow -->beta gamma<!-- /mark:${id} --> delta.\n`;
      expect(route).toHaveBeenCalledTimes(2);
      expect(JSON.parse(route.mock.calls[0][2].body)).toEqual(
        expect.objectContaining({ expected: 'h0' })
      );
      expect(JSON.parse(route.mock.calls[1][2].body)).toEqual({
        path: 'live.md',
        expected: 'h1',
        content: written
      });
      expect(h.source()).toBe(written);
      expect(h.transactions).toHaveLength(1);
      expect(h.saves).toHaveLength(0);
    });

    it('takes the save path after three refusals', async () => {
      const h = open(BARE);
      await ready();
      h.render(BARE_HTML);
      // The file on disk keeps a revision the refresh does not bring in, so
      // the route refuses the same revision every time. The write then goes the way it
      // went before the route: into the document and through the Context's
      // save, whose own conflict check is what tells the reader.
      route.mockResolvedValue(answer(409, { content: BARE, hash: 'h0' }));

      selectRange(h.root, 'beta', 'gamma');
      const id = await h.controller.mark('yellow');

      expect(id).not.toBeNull();
      expect(route).toHaveBeenCalledTimes(3);
      expect(h.order).toEqual([
        'refresh',
        'refresh',
        'refresh',
        'transact',
        'save'
      ]);
      expect(h.source()).toContain(`<!-- mark:${id} note colour=yellow -->`);
      expect(h.saves).toEqual([h.source()]);
    });

    it('keeps the context save path where the route is absent', async () => {
      const h = open(BARE);
      await ready();
      h.render(BARE_HTML);

      selectRange(h.root, 'beta', 'gamma');
      const first = await h.controller.mark('yellow');
      expect(route).toHaveBeenCalledTimes(1);
      expect(h.saves).toEqual([h.source()]);
      expect(h.source()).toContain(`<!-- mark:${first} note`);

      // The absence is remembered for the session: the next write asks the
      // route nothing and saves through the context again.
      h.render(markedHtml(first as string));
      selectRange(h.root, 'Alpha', 'Alpha');
      const second = await h.controller.mark('blue');
      expect(second).not.toBeNull();
      expect(route).toHaveBeenCalledTimes(1);
      expect(h.saves).toHaveLength(2);
    });

    it('writes the file with the line ending the context loaded it with', async () => {
      const h = open(BARE);
      await ready();
      h.render(BARE_HTML);
      // The Context holds a CRLF file as LF and remembers the ending for
      // its own save; a write that goes round the save puts it back too.
      h.widget.context._lineEnding = '\r\n';
      route.mockResolvedValue(answer(200, { hash: 'h1' }));

      selectRange(h.root, 'beta', 'gamma');
      const id = await h.controller.mark('yellow');

      expect(JSON.parse(route.mock.calls[0][2].body).content).toBe(
        `Alpha <!-- mark:${id} note colour=yellow -->beta gamma<!-- /mark:${id} --> delta.\r\n`
      );
      // The document itself stays LF, as the Context keeps it.
      expect(h.source()).not.toContain('\r');
    });

    it('takes the save path for a document holding unsaved edits', async () => {
      const h = open(BARE);
      await ready();
      h.render(BARE_HTML);
      route.mockResolvedValue(answer(200, { hash: 'h1' }));
      h.edit();

      selectRange(h.root, 'beta', 'gamma');
      const id = await h.controller.mark('yellow');

      // Nothing reaches disk while the document is dirty, by the route or by
      // a save; the markers wait for the reader's own next save.
      expect(route).not.toHaveBeenCalled();
      expect(h.source()).toContain(`<!-- mark:${id} note colour=yellow -->`);
      expect(h.saves).toHaveLength(0);
      expect(h.dirty()).toBe(true);
    });

    it('keeps the context save path while live updates are off', async () => {
      const h = open(BARE);
      await ready();
      h.render(BARE_HTML);
      // With live updates off the refresh after a 200 reads nothing, so the
      // Context would keep the old revision and refuse the next save; the
      // write goes the way it went before the route.
      h.controller.updateSettings({ enabled: false, notes: true, author: '' });
      route.mockResolvedValue(answer(200, { hash: 'h1' }));

      selectRange(h.root, 'beta', 'gamma');
      await h.controller.mark('yellow');

      expect(route).not.toHaveBeenCalled();
      expect(h.order).toEqual(['refresh', 'transact', 'save']);
      expect(h.saves).toHaveLength(1);
    });

    it('leaves the document alone when the watcher applied the written file before the 200', async () => {
      const h = open(BARE);
      await ready();
      h.render(BARE_HTML);
      let written = '';
      route.mockImplementation(async (_: string, __: unknown, init: any) => {
        h.order.push('write');
        // The watcher's read of the written file lands before the answer
        // does: the document already holds the markers the route wrote.
        written = JSON.parse(init.body).content;
        h.external(written, 'h1');
        return answer(200, { hash: 'h1' });
      });

      selectRange(h.root, 'beta', 'gamma');
      const id = await h.controller.mark('yellow');

      expect(id).not.toBeNull();
      expect(written).toContain(`<!-- mark:${id} note colour=yellow -->`);
      expect(h.order).toEqual(['refresh', 'write', 'refresh']);
      expect(h.source()).toBe(written);
      expect(h.source().match(/<!-- mark:/g)).toHaveLength(1);
      expect(h.dirty()).toBe(false);
      expect(h.saves).toHaveLength(0);
      // The caller is handed an id and a command acts on it straight away, so
      // the list has to hold the mark by the time mark() resolves - on this
      // path as much as on the one that transacts.
      expect(h.controller.marks.map(mark => mark.id)).toContain(id);
      // And the render is asked for here too, or the note box opens over a
      // passage the reader cannot see until the viewer's own timeout runs.
      expect(h.content.update).toHaveBeenCalled();
    });

    it("keeps the reader's edits when they typed while the route wrote", async () => {
      const h = open(BARE);
      await ready();
      h.render(BARE_HTML);
      const typed = `${BARE}Typed.\n`;
      route.mockImplementation(async () => {
        // The reader typed while the POST was in flight: the document moved
        // and holds unsaved edits the watcher keeps its read back behind.
        h.external(typed, 'h0');
        h.edit();
        return answer(200, { hash: 'h1' });
      });

      selectRange(h.root, 'beta', 'gamma');
      const id = await h.controller.mark('yellow');

      expect(h.order).not.toContain('transact');
      expect(h.dirty()).toBe(true);
      expect(h.source()).toBe(typed);
      expect(h.saves).toHaveLength(0);
      // The mark is on disk and not in the document. Answering the caller
      // otherwise is what makes the panel throw a typed note away over a
      // write the document never took.
      expect(id).toBeNull();
    });

    it('answers no when a second external write landed inside the route write', async () => {
      const h = open(BARE);
      await ready();
      h.render(BARE_HTML);
      const agent = 'The agent replaced the whole document.\n';
      route.mockImplementation(async () => {
        // Not the file the route wrote: another writer got there between the
        // server's write and the answer, and the watcher brought that in.
        h.external(agent, 'h2');
        return answer(200, { hash: 'h1' });
      });

      selectRange(h.root, 'beta', 'gamma');
      const id = await h.controller.mark('yellow');

      expect(id).toBeNull();
      expect(h.source()).toBe(agent);
      expect(h.controller.marks).toEqual([]);
      expect(h.order).not.toContain('transact');
      expect(h.saves).toHaveLength(0);
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

    it('addNote says whether the markers were found', async () => {
      const h = open(marked());
      await ready();

      expect(await h.controller.addNote(ONE, 'On a live mark.')).toBe(true);

      // A rewrite from disk took the markers away, so there is nothing to
      // write the note into, and the caller is told so rather than left to
      // assume the note landed.
      h.external(BARE);
      jest.advanceTimersByTime(20);
      expect(await h.controller.addNote(ONE, 'On a vanished mark.')).toBe(
        false
      );
      expect(h.source()).toBe(BARE);
    });
  });

  describe('author', () => {
    const noteAuthor = async (
      identity: unknown,
      author: string
    ): Promise<string> => {
      const h = open(marked(), identity);
      await ready();
      h.controller.updateSettings({ enabled: true, notes: true, author });
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

      h.controller.updateSettings({ enabled: true, notes: false, author: '' });

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
      selectRange(h.root, 'beta', 'gamma');
      const id = await h.controller.mark('pink');

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

  describe('the selection it records', () => {
    it('carries the selection through a render and past a change before it', async () => {
      const h = open(BARE);
      await ready();
      h.render(BARE_HTML);
      selectRange(h.root, 'beta', 'gamma');
      const before = h.controller.selection!;
      expect(captureText(h.root).text.slice(before.start, before.end)).toBe(
        'beta gamma'
      );

      // A change from disk put a paragraph in front of the selected one, so
      // the render rebuilt every node the selection sat in.
      h.render(`<p>Inserted words first.</p>${BARE_HTML}`);

      const after = h.controller.selection!;
      expect(after.start).toBeGreaterThan(before.start);
      expect(captureText(h.root).text.slice(after.start, after.end)).toBe(
        'beta gamma'
      );
    });

    it('marks the recorded selection after a refresh that re-rendered', async () => {
      const h = open(BARE);
      await ready();
      h.render(BARE_HTML);
      selectRange(h.root, 'beta', 'gamma');
      // The refresh applies a change that re-renders, which detaches every
      // node the live selection pointed at.
      h.duringRefresh(() => {
        h.external(`First line.\n\n${BARE}`);
        h.render(`<p>First line.</p>${BARE_HTML}`);
      });

      const id = await h.controller.mark('yellow');

      expect(id).not.toBeNull();
      expect(h.source()).toBe(
        `First line.\n\nAlpha <!-- mark:${id} note colour=yellow -->beta gamma<!-- /mark:${id} --> delta.\n`
      );
    });

    it("restores the selection after a render and keeps a focused textarea's caret", async () => {
      const h = open(BARE);
      await ready();
      h.render(BARE_HTML);
      const bounds: Array<[Node, number]> = [];
      document.createRange = () =>
        ({
          setStart: (node: Node, offset: number) => bounds.push([node, offset]),
          setEnd: (node: Node, offset: number) => bounds.push([node, offset])
        }) as any;
      selectRange(h.root, 'beta', 'gamma');
      const selection = (window as any).getSelection();

      h.render(BARE_HTML);

      // The body is active, so the selection goes back over the same words of
      // the new nodes.
      expect(selection.removeAllRanges).toHaveBeenCalledTimes(1);
      expect(selection.addRange).toHaveBeenCalledTimes(1);
      const text = textNodes(h.root)[0];
      expect(bounds).toEqual([
        [text, 6],
        [text, 16]
      ]);

      // A textarea has the focus: putting the selection back would reset its
      // caret, so the record is kept and nothing is restored.
      const area = document.createElement('textarea');
      document.body.appendChild(area);
      area.focus();
      h.render(BARE_HTML);

      expect(selection.addRange).toHaveBeenCalledTimes(1);
      expect(h.controller.selection).not.toBeNull();
    });

    it('keeps the record on a focus move and drops it for a caret in text', async () => {
      const h = open(BARE);
      await ready();
      h.render(BARE_HTML);
      selectRange(h.root, 'beta', 'gamma');
      expect(h.controller.selection).not.toBeNull();

      // Focusing a control collapses the selection onto an element; the
      // reader still means the words they selected.
      collapseSelection(document.body);
      expect(h.controller.selection).not.toBeNull();

      // A caret in text is the reader's own click, which is a deselection.
      collapseSelection(textNodes(h.root)[0]);
      expect(h.controller.selection).toBeNull();
    });

    it('reads a selection made since the last selectionchange event', async () => {
      const h = open(BARE);
      await ready();
      h.render(BARE_HTML);
      // Chromium fires selectionchange a frame or more after the selection
      // moved, and a context menu opened at once asks before it has: the
      // window is read on the ask as well as on the event.
      selectRange(h.root, 'beta', 'gamma', false);
      expect(h.controller.selection).toEqual(
        expect.objectContaining({ start: 6, end: 16 })
      );
    });
  });

  describe('activation', () => {
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
