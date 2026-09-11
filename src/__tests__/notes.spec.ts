import { MessageLoop } from '@lumino/messaging';
import { Signal } from '@lumino/signaling';
import { Title, Widget } from '@lumino/widgets';

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
import {
  BREAK_SETTLE_MS,
  MARK_ORIGIN,
  MARK_RENDER_WINDOW_MS,
  SELECTING_CLASS,
  NotesController
} from '../notes';
import { MARK_CLASS, NotesPanel } from '../notes-panel';
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
function harness(initial: string) {
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
    isReady: true,
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

  const content: any = { update: jest.fn(), processMessage: jest.fn() };
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
    /** The reader saved, so the document is clean again. */
    saved: () => {
      model.dirty = false;
    },
    /**
     * Rewrite the document the way typing in the editor does: through the
     * shared model, which leaves the document holding unsaved edits.
     */
    type: (value: string) => {
      model.sharedModel.updateSource(0, text.length, value);
      model.contentChanged.emit(undefined);
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
    collapseToEnd: jest.fn(),
    collapse: jest.fn(),
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

  const open = (source: string): IHarness => {
    const built = harness(source);
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
    });

    it('paints the mark on the render in place, without asking for a render', async () => {
      const h = open(BARE);
      await ready();
      h.render(BARE_HTML);

      selectRange(h.root, 'beta', 'gamma');
      const id = await h.controller.mark('yellow');

      // The markers are comments the renderer leaves out, so the render on
      // screen is already the render of the written document and the mark
      // goes on it as it stands: no node of it is rebuilt.
      const span = h.root.querySelector(`.${MARK_CLASS}[data-mark="${id}"]`);
      expect(span?.textContent).toBe('beta gamma');
      expect(h.root.querySelector('p')?.textContent).toBe(
        'Alpha beta gamma delta.'
      );
      expect(h.content.update).not.toHaveBeenCalled();
    });

    it('drops every render of the written document inside the window, and none after it', async () => {
      const h = open(BARE);
      await ready();
      h.render(BARE_HTML);
      selectRange(h.root, 'beta', 'gamma');
      await h.controller.mark('yellow');

      // The viewer's activity monitor asks for a render once its timeout has
      // run after the change; the document holds exactly what the write left
      // in it, so that render would rebuild the same text for nothing - and
      // so would a second one the watcher forces for the same file.
      MessageLoop.sendMessage(h.content, Widget.Msg.UpdateRequest);
      MessageLoop.sendMessage(h.content, Widget.Msg.UpdateRequest);
      expect(h.content.processMessage).not.toHaveBeenCalled();
      // Past the window the written source is forgotten, so a render asked
      // for later is the viewer's to make.
      jest.advanceTimersByTime(MARK_RENDER_WINDOW_MS);
      MessageLoop.sendMessage(h.content, Widget.Msg.UpdateRequest);
      expect(h.content.processMessage).toHaveBeenCalledTimes(1);
    });

    it('lets the render through when the document moved on after the write', async () => {
      const h = open(BARE);
      await ready();
      h.render(BARE_HTML);
      selectRange(h.root, 'beta', 'gamma');
      await h.controller.mark('yellow');

      // A change from disk, or typed, landed before the viewer's timeout ran:
      // the one render now shows both, and is not the viewer's to lose.
      h.external('Alpha beta gamma delta. Epsilon.\n', 'h1');
      MessageLoop.sendMessage(h.content, Widget.Msg.UpdateRequest);
      expect(h.content.processMessage).toHaveBeenCalledTimes(1);
    });

    it('lets the render through when the document moved before the write', async () => {
      const h = open(BARE);
      await ready();
      h.render(BARE_HTML);
      // A change landed and the viewer's timeout has not run yet: the screen
      // still shows the document before it. A mark written now goes on that
      // screen, and the render the viewer schedules shows the change, so it
      // is not the viewer's to lose.
      h.external('Alpha beta gamma delta. Epsilon.\n', 'h1');
      selectRange(h.root, 'beta', 'gamma');
      await h.controller.mark('yellow');

      MessageLoop.sendMessage(h.content, Widget.Msg.UpdateRequest);
      expect(h.content.processMessage).toHaveBeenCalledTimes(1);
    });

    it('keeps the source the render read when the document moved during the render', async () => {
      const h = open(BARE);
      await ready();
      h.render(BARE_HTML);
      // The viewer's render of the document starts: the request is let
      // through and the source it reads is taken down.
      MessageLoop.sendMessage(h.content, Widget.Msg.UpdateRequest);
      expect(h.content.processMessage).toHaveBeenCalledTimes(1);
      // The reader types while that render is in flight, and the render of
      // the earlier text then finishes: the screen shows the earlier text.
      h.external('Alpha beta gamma delta. Epsilon.\n', 'h1');
      h.render(BARE_HTML);
      // A mark now goes on the earlier text; the render the viewer schedules
      // for the typed change is not the viewer's to lose.
      selectRange(h.root, 'beta', 'gamma');
      await h.controller.mark('yellow');
      MessageLoop.sendMessage(h.content, Widget.Msg.UpdateRequest);
      expect(h.content.processMessage).toHaveBeenCalledTimes(2);
    });

    it('drops the render of a second mark written inside the window', async () => {
      const h = open(BARE);
      await ready();
      h.render(BARE_HTML);
      selectRange(h.root, 'beta', 'gamma');
      await h.controller.mark('yellow');
      MessageLoop.sendMessage(h.content, Widget.Msg.UpdateRequest);
      expect(h.content.processMessage).not.toHaveBeenCalled();

      // The first mark's render was dropped, and the screen with the first
      // mark painted on it is still the render of the document the second
      // mark changes.
      selectRange(h.root, 'delta.', 'delta.');
      await h.controller.mark('blue');
      MessageLoop.sendMessage(h.content, Widget.Msg.UpdateRequest);
      expect(h.content.processMessage).not.toHaveBeenCalled();
    });

    it('lets every render through that no write of its own preceded', async () => {
      const h = open(BARE);
      await ready();
      h.render(BARE_HTML);

      MessageLoop.sendMessage(h.content, Widget.Msg.UpdateRequest);
      expect(h.content.processMessage).toHaveBeenCalledTimes(1);

      selectRange(h.root, 'beta', 'gamma');
      await h.controller.mark('yellow');
      h.controller.dispose();
      MessageLoop.sendMessage(h.content, Widget.Msg.UpdateRequest);
      expect(h.content.processMessage).toHaveBeenCalledTimes(2);
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
      // And the mark is painted here too, in place, or the note box opens
      // over a passage the reader cannot see; the render the watcher forced
      // for the written file is dropped like the viewer's own.
      expect(
        h.root.querySelector(`.${MARK_CLASS}[data-mark="${id}"]`)?.textContent
      ).toBe('beta gamma');
      expect(h.content.update).not.toHaveBeenCalled();
      MessageLoop.sendMessage(h.content, Widget.Msg.UpdateRequest);
      expect(h.content.processMessage).not.toHaveBeenCalled();
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
          author: 'author',
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

    it('writes the note into the first of the two pairs a copy left behind', async () => {
      // A reader who copies a marked paragraph in the editor copies its
      // markers with it. The identifier then names one mark, the first pair,
      // and the copy is text: it holds no note of its own, it is listed
      // nowhere, and the write does not touch it.
      const copied = `${marked()}\n${marked()}`;
      const h = open(copied);
      await ready();
      expect(h.controller.marks).toHaveLength(1);

      expect(await h.controller.addNote(ONE, 'On the first pair.')).toBe(true);

      const [first, second] = h.source().split('\n\n');
      expect(first).toContain('On the first pair.');
      expect(second).toBe(marked());
      expect(parseMarks(h.source()).map(mark => mark.notes)).toEqual([
        [
          {
            author: 'author',
            stamp: expect.stringMatching(
              /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/
            ),
            text: 'On the first pair.'
          }
        ]
      ]);
      expect(h.transactions).toHaveLength(1);
      expect(h.transactions[0].edits).toHaveLength(1);
    });

    it('puts the notes on the painted span as its tooltip, one line each with its author', async () => {
      const h = open(marked());
      await ready();
      h.render(BARE_HTML);
      const span = () =>
        h.root.querySelector<HTMLElement>(`.${MARK_CLASS}[data-mark="${ONE}"]`);
      // A bare mark says nothing on hover.
      expect(span()?.hasAttribute('title')).toBe(false);

      await h.controller.addNote(ONE, 'This needs a rewrite.');
      expect(span()?.title).toBe('author: This needs a rewrite.');

      await h.controller.addNote(ONE, 'And a number.');
      expect(span()?.title).toBe(
        'author: This needs a rewrite.\nauthor: And a number.'
      );

      // A note that continues on a second line is still one line of the
      // tooltip, not a second note without an author.
      await h.controller.addNote(ONE, 'Two lines,\nsecond one here.');
      expect(span()?.title.split('\n')).toHaveLength(3);
      expect(span()?.title.split('\n')[2]).toBe(
        'author: Two lines, second one here.'
      );
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
    const noteAuthor = async (author: string): Promise<string> => {
      const h = open(marked());
      await ready();
      h.controller.updateSettings({ enabled: true, notes: true, author });
      await h.controller.addNote(ONE, 'A note.');
      return parseMarks(h.source())[0].notes[0].author;
    };

    it('writes the author setting when it is set', async () => {
      expect(await noteAuthor('kj')).toBe('kj');
    });

    // The controller is never handed the lab's user manager, so there is no
    // identity for an empty setting to fall back to: the default handle is
    // the only thing an empty setting can write.
    it('writes the default handle when the setting is empty', async () => {
      expect(await noteAuthor('')).toBe('author');
    });

    it('replaces what a handle cannot carry with a hyphen', async () => {
      expect(await noteAuthor('Star Colonel')).toBe('Star-Colonel');
    });

    it('leaves a note line another author wrote as it stands', async () => {
      const written = `@claude 2026-09-06T16:05:12Z: The intro contradicts this.`;
      const h = open(
        `Alpha <!-- mark:${ONE} note colour=yellow\n${written}\n-->beta gamma<!-- /mark:${ONE} --> delta.\n`
      );
      await ready();

      await h.controller.addNote(ONE, 'Agreed.');

      // The agent's line is carried through the rewrite byte for byte, and
      // only the line written here is signed with the handle.
      expect(h.source()).toContain(`\n${written}\n`);
      expect(parseMarks(h.source())[0].notes.map(note => note.author)).toEqual([
        'claude',
        'author'
      ]);
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

    it('lists a passage by its words, without the list number or the emphasis marks around it (DEF-NOTES-84)', async () => {
      // The opening marker of a passage that starts a list item goes on its
      // own line before the item, so the source between the markers holds
      // the item's number and the strong delimiters.
      const h = open(
        `<!-- mark:${ONE} note colour=yellow -->\n` +
          `3. **Ostateczny rygor:**<!-- /mark:${ONE} -->  \n   W przypadku\n`
      );
      await ready();

      expect(h.controller.marks.map(mark => mark.text)).toEqual([
        'Ostateczny rygor:'
      ]);
    });

    it('lists a passage that starts mid-line with a marker character by its whole text (DEF-NOTES-87)', async () => {
      // Read out of its line, a dash or a hash at the start of the slice
      // would pass for a bullet or a heading marker and be stripped.
      const h = open(
        `the plan <!-- mark:${ONE} note colour=yellow -->- and its cost<!-- /mark:${ONE} --> tomorrow\n\n` +
          `ticket <!-- mark:${TWO} note colour=blue -->#12 open<!-- /mark:${TWO} --> still\n`
      );
      await ready();

      expect(h.controller.marks.map(mark => mark.text)).toEqual([
        '- and its cost',
        '#12 open'
      ]);
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

    it('keeps a mark whose passage a rewrite rewrote between its markers', async () => {
      // ACC-NOTES-58: the markers both survived, so the mark did; it is the
      // new passage that is listed.
      const h = open(marked());
      await ready();

      h.external(
        `Alpha <!-- mark:${ONE} note colour=yellow -->quinces and medlars<!-- /mark:${ONE} --> delta.\n`
      );
      jest.advanceTimersByTime(20);

      const [mark] = h.controller.marks;
      expect(mark.id).toBe(ONE);
      expect(mark.unanchored).toBe(false);
      expect(mark.text).toBe('quinces and medlars');
      expect(h.transactions).toHaveLength(0);
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

  describe('broken marks', () => {
    /** The passage of the marked document, with its markers gone. */
    const PLAIN = 'Alpha beta gamma delta.\n';

    /** A rewrite that left the closing marker of the mark behind. */
    const CLOSING_LEFT = `Alpha beta gamma<!-- /mark:${ONE} --> delta.\n`;

    /** A rewrite that left the opening marker of the mark behind. */
    const OPENING_LEFT = `Alpha <!-- mark:${ONE} note colour=yellow -->beta gamma delta.\n`;

    /** A rewrite that emptied the passage between the two markers. */
    const EMPTIED = `Alpha <!-- mark:${ONE} note colour=yellow --> <!-- /mark:${ONE} --> delta.\n`;

    /** A note line the marker already carries. */
    const NOTE_LINE = '@author 2026-09-08T10:00:00Z: Worth checking.';

    /** The marked document with that note line in its opening marker. */
    const NOTED =
      `Alpha <!-- mark:${ONE} note colour=yellow\n${NOTE_LINE}\n-->` +
      `beta gamma<!-- /mark:${ONE} --> delta.\n`;

    /** That document with the passage between its two markers emptied. */
    const NOTED_EMPTIED = NOTED.replace('beta gamma', '');

    /**
     * A mark whose passage holds nothing but the leftover closing marker of
     * another: whole while that marker is there, broken the moment it goes.
     */
    const NESTED =
      `Alpha <!-- mark:${ONE} note colour=yellow --><!-- /mark:${TWO} -->` +
      `<!-- /mark:${ONE} --> delta.\n`;

    /**
     * Let a deletion that has begun run to the end: it refreshes, asks the
     * route, falls back and saves, each an await of its own.
     */
    const deleted = async (): Promise<void> => {
      for (let i = 0; i < 20; i++) {
        await Promise.resolve();
      }
    };

    /**
     * Let the settle a read armed elapse, and the deletion it fires run to
     * the end. Nothing is ever deleted before the settle has, so every case
     * that expects a deletion waits it out.
     */
    const settle = async (): Promise<void> => {
      jest.advanceTimersByTime(BREAK_SETTLE_MS);
      await deleted();
    };

    /** Rewrite the document from outside and let the read and the write run. */
    const rewrite = async (h: IHarness, source: string): Promise<void> => {
      h.external(source);
      jest.advanceTimersByTime(20);
      await settle();
    };

    /** What the reader has half typed into the open note entry. */
    const DRAFT = 'half a thought';

    /**
     * A real panel wired to the controller the way the extension wires it,
     * with the entry of the mark open and that draft typed into it.
     *
     * The panel holds no model: it is handed the marks the controller lists,
     * on every change. These cases assert the draft rather than the listing
     * alone.
     */
    const withDraft = (h: IHarness): NotesPanel => {
      const panel = new NotesPanel({
        root: () => h.root,
        handlers: {
          addNote: async () => true,
          setColour: () => undefined,
          removeMark: () => undefined,
          removeEmptyDocument: () => undefined,
          markDocument: async () => null,
          setState: () => undefined
        },
        state: 'expanded'
      });
      Widget.attach(panel, document.body);
      const sync = (): void =>
        panel.setMarks(
          h.controller.marks.map(mark => ({
            mark,
            passage: mark.text,
            anchored: !mark.unanchored,
            position: mark.position
          }))
        );
      h.controller.changed.connect(sync);
      sync();
      panel.selectMark(ONE, true);
      const field = panel.node.querySelector<HTMLTextAreaElement>('textarea')!;
      field.value = DRAFT;
      field.dispatchEvent(new Event('input'));
      return panel;
    };

    /** The text of the note entry the panel has open, empty for no entry. */
    const draft = (panel: NotesPanel): string =>
      panel.node.querySelector<HTMLTextAreaElement>('textarea')?.value ?? '';

    it('drops a mark a rewrite took both markers from, and writes nothing', async () => {
      const h = open(marked());
      await ready();

      await rewrite(h, PLAIN);

      expect(h.controller.marks).toEqual([]);
      expect(h.source()).toBe(PLAIN);
      expect(h.transactions).toHaveLength(0);
    });

    it('deletes the closing marker a rewrite left behind', async () => {
      const h = open(marked());
      await ready();

      await rewrite(h, CLOSING_LEFT);

      expect(h.controller.marks).toEqual([]);
      expect(h.source()).toBe(PLAIN);
      expect(h.transactions).toHaveLength(1);
    });

    it('deletes the opening marker a rewrite left behind', async () => {
      const h = open(marked());
      await ready();

      await rewrite(h, OPENING_LEFT);

      expect(h.controller.marks).toEqual([]);
      expect(h.source()).toBe(PLAIN);
    });

    it('deletes both markers of a passage a rewrite emptied', async () => {
      const h = open(marked());
      await ready();

      await rewrite(h, EMPTIED);

      expect(h.controller.marks).toEqual([]);
      expect(h.source()).toBe('Alpha   delta.\n');
    });

    it('takes the three broken shapes out in one write', async () => {
      const whole =
        `Alpha <!-- mark:${ONE} note colour=yellow -->beta<!-- /mark:${ONE} --> one.\n\n` +
        `Alpha <!-- mark:${TWO} note colour=blue -->gamma<!-- /mark:${TWO} --> two.\n\n` +
        `Alpha <!-- mark:${MANY[0]} note colour=pink -->delta<!-- /mark:${MANY[0]} --> three.\n`;
      const h = open(whole);
      await ready();
      expect(h.controller.marks).toHaveLength(3);

      // One rewrite that breaks each mark a different way: the first lost its
      // closing marker, the second its opening marker, the third its passage.
      await rewrite(
        h,
        `Alpha <!-- mark:${ONE} note colour=yellow -->beta one.\n\n` +
          `Alpha gamma<!-- /mark:${TWO} --> two.\n\n` +
          `Alpha <!-- mark:${MANY[0]} note colour=pink --> <!-- /mark:${MANY[0]} --> three.\n`
      );

      expect(h.controller.marks).toEqual([]);
      expect(h.source()).toBe(
        'Alpha beta one.\n\nAlpha gamma two.\n\nAlpha   three.\n'
      );
      expect(h.transactions).toHaveLength(1);
      expect(h.transactions[0].edits).toHaveLength(4);
    });

    it('takes the painted passage of a broken mark out of the render', async () => {
      const h = open(marked());
      await ready();
      h.render(markedHtml());
      expect(painted(h.root)).toHaveLength(1);

      await rewrite(h, CLOSING_LEFT);

      expect(painted(h.root)).toHaveLength(0);
    });

    it('deletes a closing marker left behind in a document it opens on', async () => {
      // A closing marker on its own is a mark of no type: the type is written
      // in the opening marker, and what is left says only that some mark once
      // ended there. It goes whether this session saw the mark whole or found
      // the file already holding the leftover.
      const h = open(CLOSING_LEFT);
      await ready();
      await settle();

      expect(h.controller.marks).toHaveLength(0);
      expect(h.source()).toBe('Alpha beta gamma delta.\n');
    });

    it('leaves a marker of a type this version does not write while its opening marker survives', async () => {
      // The type is readable only while the opening marker is there, and only
      // the version that wrote a type knows what a marker of it without its
      // pair means, so a foreign mark that lost its closing marker is left
      // whole. Its passage emptied is the same: not this version's to judge.
      const whole = `Alpha <!-- mark:${ONE} task -->beta gamma<!-- /mark:${ONE} --> delta.\n`;
      const h = open(whole);
      await ready();

      const lostClose = `Alpha <!-- mark:${ONE} task -->beta gamma delta.\n`;
      await rewrite(h, lostClose);
      expect(h.source()).toBe(lostClose);
      expect(h.controller.marks.map(mark => mark.type)).toEqual(['task']);

      const emptied = `Alpha <!-- mark:${ONE} task --><!-- /mark:${ONE} --> delta.\n`;
      await rewrite(h, emptied);
      expect(h.source()).toBe(emptied);
      expect(h.controller.marks.map(mark => mark.type)).toEqual(['task']);
      expect(h.transactions).toHaveLength(0);
    });

    it('leaves a document note alone, having no closing marker to lose', async () => {
      const h = open(`<!-- mark:${ONE} document -->\n${BARE}`);
      await ready();
      await settle();

      expect(h.controller.marks.map(mark => mark.type)).toEqual(['document']);
      expect(h.transactions).toHaveLength(0);
    });

    it('leaves the markers a copied passage brought with it where they are', async () => {
      // The reader copied the paragraph, markers and all, so the file holds
      // the identifier twice. Both pairs are whole, so there is no break to
      // answer, and the second pair is not a mark at all: it is neither
      // listed nor painted, and no write goes near it.
      const copied = `${marked()}\n${marked()}`;
      const h = open(copied);
      await ready();
      h.render(`${markedHtml()}\n${markedHtml()}`);
      await settle();

      expect(h.controller.marks.map(mark => mark.text)).toEqual(['beta gamma']);
      expect(painted(h.root)).toHaveLength(1);
      expect(h.source()).toBe(copied);
      expect(h.transactions).toHaveLength(0);
    });

    it('lists and paints the pair a stray closing marker sits above', async () => {
      // The reader copied the tail of the marked paragraph, so a closing
      // marker of the mark stands above the pair. The identifier still names
      // the pair, with its passage and its note: a mark out of sight is worse
      // than the marker left over, which is not broken and stays put.
      const source = `Stray <!-- /mark:${ONE} --> line.\n\n${NOTED}`;
      const h = open(source);
      await ready();
      h.render(
        `<p>Stray <!-- /mark:${ONE} --> line.</p>\n` +
          `<p>Alpha <!-- mark:${ONE} note colour=yellow\n${NOTE_LINE}\n-->` +
          `beta gamma<!-- /mark:${ONE} --> delta.</p>`
      );
      await settle();

      expect(h.controller.marks.map(mark => mark.text)).toEqual(['beta gamma']);
      expect(h.controller.marks[0].notes).toHaveLength(1);
      expect(h.controller.marks[0].unanchored).toBe(false);
      expect(painted(h.root)).toHaveLength(1);
      expect(h.source()).toBe(source);
      expect(h.transactions).toHaveLength(0);
    });

    it('deletes a stray closing marker nothing in the document opens', async () => {
      const source = `${marked()}\nStray <!-- /mark:${TWO} --> line.\n`;
      const h = open(source);
      await ready();
      await settle();

      // Marks are read by identifier, so the whole mark beside the leftover
      // says nothing about it: no opening marker anywhere carries the
      // leftover's identifier, so it is the mark that identifier names, and
      // it goes.
      expect(h.controller.marks.map(mark => mark.text)).toEqual(['beta gamma']);
      expect(h.source()).toBe(`${marked()}\nStray  line.\n`);
    });

    it('deletes nothing while notes are off', async () => {
      const h = open(marked());
      await ready();
      h.controller.updateSettings({ enabled: true, notes: false, author: '' });

      await rewrite(h, CLOSING_LEFT);

      expect(h.source()).toBe(CLOSING_LEFT);
      expect(h.transactions).toHaveLength(0);
      expect(h.saves).toHaveLength(0);
    });

    it('finds nothing to delete on the read that follows the deletion', async () => {
      const h = open(marked());
      await ready();
      await rewrite(h, CLOSING_LEFT);
      expect(h.transactions).toHaveLength(1);

      // The deletion's own write is the content change that follows it, and
      // the read it caused found nothing broken: no settle is armed, so no
      // second pass and no second write.
      await settle();

      expect(h.source()).toBe(PLAIN);
      expect(h.transactions).toHaveLength(1);
    });

    it('deletes nothing while the document holds unsaved edits, and deletes once it is clean', async () => {
      // A document holding the reader's own unsaved work is not touched at
      // all: the watcher holds a change from disk back behind those edits, so
      // a break met on a dirty document is one the reader is making
      // themselves, and their undo must find the markers still there.
      const h = open(marked());
      await ready();
      h.edit();

      await rewrite(h, CLOSING_LEFT);

      expect(h.source()).toBe(CLOSING_LEFT);
      expect(h.transactions).toHaveLength(0);
      expect(h.saves).toHaveLength(0);
      expect(h.dirty()).toBe(true);

      // Saved, the break is in the file and theirs no longer. A save is no
      // content change and the file is what it already was, so no read
      // follows it: the pass the dirty document refused armed the settle
      // again itself, and the leftover marker goes when it fires.
      h.saved();
      await settle();

      expect(h.source()).toBe(PLAIN);
      expect(h.transactions).toHaveLength(1);
    });

    it('writes nothing when the reader begins typing during the refresh', async () => {
      // The refresh the deletion makes first is a round trip to the server,
      // and the reader begins typing in the editor while it runs. The write
      // is kept off the undo stack, so a note line it took with it would be
      // gone beyond anything they could reach for.
      const h = open(NOTED);
      await ready();
      h.duringRefresh(() => h.edit());

      await rewrite(h, NOTED_EMPTIED);

      expect(h.source()).toBe(NOTED_EMPTIED);
      expect(h.source()).toContain(NOTE_LINE);
      expect(h.transactions).toHaveLength(0);
      expect(h.saves).toHaveLength(0);
      // Nothing left the file, so the row stays where the reader can undo
      // their way back to it.
      expect(h.controller.marks.map(mark => mark.id)).toEqual([ONE]);
    });

    it('deletes once the reader saves what they typed during the refresh', async () => {
      const h = open(NOTED);
      await ready();
      h.duringRefresh(() => h.edit());

      await rewrite(h, NOTED_EMPTIED);
      expect(h.transactions).toHaveLength(0);

      // The pass wrote nothing and armed the settle again: their save is no
      // content change, so nothing else would bring the deletion back.
      h.duringRefresh(() => undefined);
      h.saved();
      await settle();

      expect(h.source()).toBe('Alpha  delta.\n');
      expect(h.transactions).toHaveLength(1);
    });

    it('leaves a break the refresh of the deletion brought in', async () => {
      const h = open(marked());
      await ready();
      // The refresh exists to pull newer content in, and a leftover marker
      // that arrives with it has not stood for the window at all: this pass
      // deletes only what the read that armed it saw broken.
      h.duringRefresh(() =>
        h.external(`${CLOSING_LEFT}\n<!-- /mark:${TWO} -->\n`)
      );

      await rewrite(h, CLOSING_LEFT);

      expect(h.transactions).toHaveLength(1);
      expect(h.transactions[0].edits).toHaveLength(1);
      expect(h.source()).toBe(
        `Alpha beta gamma delta.\n\n<!-- /mark:${TWO} -->\n`
      );
    });

    it('deletes on the pass after one a write in flight refused', async () => {
      const warned = jest
        .spyOn(console, 'warn')
        .mockImplementation(() => undefined);
      const h = open(marked());
      await ready();
      // The first pass reaches the route and waits there.
      let failWrite = (): void => undefined;
      route.mockReturnValue(
        new Promise((_, reject) => {
          failWrite = () => reject(new Error('offline'));
        })
      );
      h.external(CLOSING_LEFT);
      jest.advanceTimersByTime(20);
      jest.advanceTimersByTime(BREAK_SETTLE_MS);
      await deleted();
      expect(h.transactions).toHaveLength(0);

      // A further change from disk arms the settle again, and it fires while
      // that first write is still on its way: this pass is refused, and arms
      // the settle once more rather than dropping the break.
      h.external(CLOSING_LEFT.replace('Alpha', 'Alpha again'));
      jest.advanceTimersByTime(20);
      jest.advanceTimersByTime(BREAK_SETTLE_MS);
      await deleted();
      expect(h.transactions).toHaveLength(0);

      // The first write fails, which reports the failure and arms nothing.
      failWrite();
      await deleted();
      route.mockResolvedValue(ABSENT);

      await settle();

      expect(h.source()).toBe('Alpha again beta gamma delta.\n');
      expect(h.transactions).toHaveLength(1);
      warned.mockRestore();
    });

    it('arms no further settle when the pass it fires finds notes off', async () => {
      const h = open(marked());
      await ready();
      h.controller.updateSettings({ enabled: true, notes: false, author: '' });

      h.external(CLOSING_LEFT);
      jest.advanceTimersByTime(20);
      await settle();

      // The feature does nothing while it is off, so the pass it refuses is
      // not scheduled again: a timer arming itself for ever over a feature
      // that writes nothing is waste.
      expect(h.transactions).toHaveLength(0);
      expect(jest.getTimerCount()).toBe(0);
    });

    it('takes the leftover markers out once notes are turned back on', async () => {
      const h = open(marked());
      await ready();
      h.controller.updateSettings({ enabled: true, notes: false, author: '' });

      h.external(CLOSING_LEFT);
      jest.advanceTimersByTime(20);
      await settle();
      expect(h.source()).toBe(CLOSING_LEFT);
      expect(h.transactions).toHaveLength(0);

      // The pass the setting refused armed no settle, and no content change
      // follows to read again: turning the feature back on is the only thing
      // that can give the leftover marker an owner, so it reads there.
      h.controller.updateSettings({ enabled: true, notes: true, author: '' });
      await settle();

      expect(h.source()).toBe(PLAIN);
      expect(h.transactions).toHaveLength(1);
    });

    it('takes the leftover markers out once live updates are turned back on', async () => {
      const h = open(marked());
      await ready();
      h.controller.updateSettings({ enabled: false, notes: true, author: '' });

      h.external(CLOSING_LEFT);
      jest.advanceTimersByTime(20);
      await settle();
      expect(h.source()).toBe(CLOSING_LEFT);
      expect(h.transactions).toHaveLength(0);

      // The write gave the file up because the route it needs was never
      // asked, and the pass disarmed the settle rather than asking again
      // every window. Live updates are the setting that held it back, so
      // turning them on reads there: the leftover marker finds an owner
      // without waiting for the document to change.
      h.controller.updateSettings({ enabled: true, notes: true, author: '' });
      await settle();

      expect(h.source()).toBe(PLAIN);
      expect(h.transactions).toHaveLength(1);
    });

    it('writes nothing when the route says the file has gone', async () => {
      const h = open(marked());
      await ready();
      // The file was deleted or renamed while the settle ran, so the served
      // route answers 404 for the path. A reader's own write falls back to
      // the Context save here; this deletion nobody asked for must not,
      // because that save would put the file back on disk.
      route.mockResolvedValue(answer(404, { message: 'file not found' }));

      await rewrite(h, CLOSING_LEFT);

      expect(h.source()).toBe(CLOSING_LEFT);
      expect(h.transactions).toHaveLength(0);
      expect(h.saves).toEqual([]);
    });

    it('writes nothing with live updates off, where the route is never asked', async () => {
      const h = open(marked());
      await ready();
      // The route is the only thing that can tell this deletion the file has
      // gone, and with live updates off it is not asked at all. The fallback
      // save is the same save whichever way the route was left out, so it
      // would put a file the reader deleted back on disk.
      h.controller.updateSettings({ enabled: false, notes: true, author: '' });

      await rewrite(h, CLOSING_LEFT);

      expect(route).not.toHaveBeenCalled();
      expect(h.source()).toBe(CLOSING_LEFT);
      expect(h.transactions).toHaveLength(0);
      expect(h.saves).toEqual([]);
    });

    it('writes nothing when the route refused the deletion three times', async () => {
      const h = open(marked());
      await ready();
      // The file on disk keeps a revision the refresh does not bring in, so
      // the route refuses every attempt and the write gives it up. A reader's
      // own write falls back to the Context save there; this deletion nobody
      // asked for must not, because the save would recreate the file and
      // raise the File Changed dialog over a write they never made.
      route.mockResolvedValue(
        answer(409, { content: CLOSING_LEFT, hash: 'h0' })
      );

      await rewrite(h, CLOSING_LEFT);

      expect(route).toHaveBeenCalledTimes(3);
      expect(h.source()).toBe(CLOSING_LEFT);
      expect(h.transactions).toHaveLength(0);
      expect(h.saves).toEqual([]);
    });

    it('leaves no settle armed with live updates off, and asks nothing twice', async () => {
      const h = open(marked());
      await ready();
      h.controller.updateSettings({ enabled: false, notes: true, author: '' });

      await rewrite(h, CLOSING_LEFT);

      // The write gave the file up rather than being held back by a state
      // that waiting mends, so nothing arms the settle again: a document
      // opened on one leftover marker would otherwise spend a refresh on the
      // server every window for the life of the tab, with no change to the
      // document at all.
      expect(jest.getTimerCount()).toBe(0);
      const asked = h.order.filter(step => step === 'refresh').length;

      await settle();

      expect(h.order.filter(step => step === 'refresh')).toHaveLength(asked);
      expect(route).not.toHaveBeenCalled();
      expect(h.source()).toBe(CLOSING_LEFT);
      expect(h.saves).toEqual([]);
    });

    it('leaves no settle armed when the route refused the deletion', async () => {
      const h = open(marked());
      await ready();
      route.mockResolvedValue(
        answer(409, { content: CLOSING_LEFT, hash: 'h0' })
      );

      await rewrite(h, CLOSING_LEFT);

      // A route that refuses the same revision three times refuses it again
      // in the next window: the pass is not repeated, so the three requests
      // of this window are the whole cost of the break.
      expect(jest.getTimerCount()).toBe(0);

      await settle();

      expect(route).toHaveBeenCalledTimes(3);
      expect(h.source()).toBe(CLOSING_LEFT);
      expect(h.saves).toEqual([]);
    });

    it('leaves no settle armed when the route says the file has gone', async () => {
      const h = open(marked());
      await ready();
      route.mockResolvedValue(answer(404, { message: 'file not found' }));

      await rewrite(h, CLOSING_LEFT);

      // A file that has gone is not a state that waiting mends, as unsaved
      // edits and a write in flight are: a pass every window would spend a
      // refresh on a path the route has already answered for, and the tab
      // marker tells the reader the file is missing.
      expect(jest.getTimerCount()).toBe(0);

      await settle();

      expect(h.source()).toBe(CLOSING_LEFT);
      expect(h.saves).toEqual([]);
    });

    it('deletes nothing when the reader empties a marked passage as they type', async () => {
      // The reader selects the passage and presses Backspace, meaning to
      // retype it. For that frame the mark is broken, and a deletion would
      // take both markers and every note line with them, none of which the
      // undo of the typing brings back.
      const h = open(NOTED);
      await ready();

      h.type(NOTED.replace('beta gamma', ''));
      jest.advanceTimersByTime(20);
      await settle();

      expect(h.dirty()).toBe(true);
      expect(h.source()).toContain(`<!-- mark:${ONE} note`);
      expect(h.source()).toContain(`<!-- /mark:${ONE} -->`);
      expect(h.source()).toContain(NOTE_LINE);
      expect(h.transactions).toHaveLength(0);
      expect(h.saves).toHaveLength(0);
    });

    it('lists a mark the first chunk of a streamed write broke, until the rest lands', async () => {
      // The settle guards the file, and the reader's own screen is guarded
      // with it: a row that vanishes for the 375 ms an agent takes over its
      // second chunk takes the reader's open entry with it.
      const h = open(marked());
      await ready();
      h.render(markedHtml());
      expect(painted(h.root)).toHaveLength(1);

      h.external(OPENING_LEFT);
      jest.advanceTimersByTime(20);
      await deleted();

      expect(h.controller.marks.map(mark => mark.id)).toEqual([ONE]);
      expect(painted(h.root)).toHaveLength(1);

      jest.advanceTimersByTime(BREAK_SETTLE_MS / 2);
      h.external(marked());
      jest.advanceTimersByTime(20);
      await settle();

      expect(h.controller.marks.map(mark => mark.id)).toEqual([ONE]);
      expect(h.transactions).toHaveLength(0);
    });

    it('keeps the note being written into a row the first chunk broke', async () => {
      const h = open(marked());
      await ready();
      const panel = withDraft(h);

      h.external(OPENING_LEFT);
      jest.advanceTimersByTime(20);
      await deleted();

      expect(draft(panel)).toBe(DRAFT);
      panel.dispose();
    });

    it('keeps the draft when the rest of the streamed write lands during the refresh', async () => {
      // The agent's first chunk broke the mark and the settle fired; the rest
      // of the write reaches the document inside the refresh the deletion
      // makes first, so the mark is whole again by the time the edits are
      // computed and nothing is written. The file lost nothing, so the row
      // and the note being typed into it are still there.
      const h = open(marked());
      await ready();
      const panel = withDraft(h);
      h.duringRefresh(() => h.external(marked()));

      await rewrite(h, OPENING_LEFT);

      expect(h.source()).toBe(marked());
      expect(h.transactions).toHaveLength(0);
      expect(h.controller.marks.map(mark => mark.id)).toEqual([ONE]);
      expect(draft(panel)).toBe(DRAFT);
      panel.dispose();
    });

    it('keeps the draft when the reader types during the refresh', async () => {
      // The reader begins typing in the editor while the deletion's refresh
      // runs, so the write refuses over their unsaved edits. Nothing left the
      // file, and the note they are writing in the panel is untouched.
      const h = open(marked());
      await ready();
      const panel = withDraft(h);
      h.duringRefresh(() => h.edit());

      await rewrite(h, OPENING_LEFT);

      expect(h.source()).toBe(OPENING_LEFT);
      expect(h.transactions).toHaveLength(0);
      expect(h.controller.marks.map(mark => mark.id)).toEqual([ONE]);
      expect(draft(panel)).toBe(DRAFT);
      panel.dispose();
    });

    it('keeps the draft when the route says the file has gone', async () => {
      // The file was deleted or renamed inside the settle, so the route
      // refuses the write and the Context save is not taken behind it. The
      // markers stay in the document, and so does the reader's half-written
      // note.
      const h = open(marked());
      await ready();
      const panel = withDraft(h);
      route.mockResolvedValue(answer(404, { message: 'file not found' }));

      await rewrite(h, OPENING_LEFT);

      expect(h.source()).toBe(OPENING_LEFT);
      expect(h.transactions).toHaveLength(0);
      expect(h.controller.marks.map(mark => mark.id)).toEqual([ONE]);
      expect(draft(panel)).toBe(DRAFT);
      panel.dispose();
    });

    it('lists a mark the reader emptied for as long as their edits are unsaved', async () => {
      const h = open(NOTED);
      await ready();

      h.type(NOTED_EMPTIED);
      jest.advanceTimersByTime(20);
      await settle();

      // The deletion is refused while the document is dirty, so the panel
      // must not say the mark is gone: the file holds both its markers and
      // its note line, and the reader's undo brings the passage back.
      expect(h.dirty()).toBe(true);
      expect(h.controller.marks.map(mark => mark.id)).toEqual([ONE]);
      expect(h.controller.marks[0].text).toBe('');
    });

    it('never lists a mark left with only its closing marker', async () => {
      const h = open(marked());
      await ready();

      h.external(CLOSING_LEFT);
      jest.advanceTimersByTime(20);

      // A closing marker on its own names no type, no position and no
      // passage, so there is no row to draw from it at any point.
      expect(h.controller.marks).toEqual([]);
      await settle();
      expect(h.controller.marks).toEqual([]);
    });

    it('loses the mark when the markers leave the file, and not before', async () => {
      const h = open(marked());
      await ready();
      let told = 0;
      h.controller.changed.connect(() => {
        told += 1;
      });

      h.external(EMPTIED);
      jest.advanceTimersByTime(20);
      jest.advanceTimersByTime(BREAK_SETTLE_MS - 100);
      expect(h.controller.marks.map(mark => mark.id)).toEqual([ONE]);
      told = 0;

      // The settle fires here, which starts the deletion and no more: the
      // file still holds both markers and every note line in them, so the row
      // is still the reader's to write into.
      jest.advanceTimersByTime(200);
      expect(h.controller.marks.map(mark => mark.id)).toEqual([ONE]);

      // The write takes the markers out and reads the file it left, and the
      // row goes with them.
      await deleted();

      expect(h.source()).toBe('Alpha   delta.\n');
      expect(h.controller.marks).toEqual([]);
      expect(told).toBeGreaterThan(0);
    });

    it('leaves a mark the rest of a streamed write made whole again', async () => {
      const h = open(BARE);
      await ready();

      // The server coalesces file events in a 100 ms window and holds one no
      // longer than 400 ms, so an agent writing the file in pieces reaches
      // the document mid-write: here the opening marker has landed and the
      // closing marker has not.
      h.external(OPENING_LEFT);
      jest.advanceTimersByTime(20);
      await deleted();
      expect(h.transactions).toHaveLength(0);

      // The rest of the write lands inside the settle, so the mark the agent
      // wrote is never judged.
      jest.advanceTimersByTime(BREAK_SETTLE_MS / 2);
      h.external(marked());
      jest.advanceTimersByTime(20);
      await settle();

      expect(h.source()).toBe(marked());
      expect(h.transactions).toHaveLength(0);
      expect(h.controller.marks).toHaveLength(1);
    });

    it('pushes the settle out with every further change', async () => {
      const h = open(marked());
      await ready();

      h.external(CLOSING_LEFT);
      jest.advanceTimersByTime(20);
      // Two thirds of the way through the settle a further change arrives,
      // which arms it again from there: nothing is written where the first
      // settle would have elapsed.
      jest.advanceTimersByTime(500);
      h.external(CLOSING_LEFT.replace('Alpha', 'Alpha again'));
      jest.advanceTimersByTime(20);
      jest.advanceTimersByTime(500);
      await deleted();

      expect(h.transactions).toHaveLength(0);

      // Left alone, the second settle elapses and the leftover marker goes.
      await settle();

      expect(h.source()).toBe('Alpha again beta gamma delta.\n');
      expect(h.transactions).toHaveLength(1);
    });

    it('takes out a mark the deletion of another broke, on the pass after it', async () => {
      // The outer mark encloses the leftover closing marker of an inner one,
      // so its passage holds something and it is whole; deleting the leftover
      // empties that passage and breaks it in turn.
      const h = open(NESTED);
      await ready();

      await settle();

      expect(h.source()).toBe(
        `Alpha <!-- mark:${ONE} note colour=yellow --><!-- /mark:${ONE} --> delta.\n`
      );
      expect(h.transactions).toHaveLength(1);

      // The deletion's own write is a content change, so the read that
      // follows it arms the settle again and the next pass takes the mark it
      // broke out.
      await settle();

      expect(h.source()).toBe('Alpha  delta.\n');
      expect(h.transactions).toHaveLength(2);
      expect(h.controller.marks).toEqual([]);
    });

    it('writes nothing when notes go off while the deletion is in flight', async () => {
      const h = open(marked());
      await ready();
      // The refresh the deletion makes first is awaited, and the reader turns
      // the setting off while it runs.
      h.duringRefresh(() =>
        h.controller.updateSettings({
          enabled: true,
          notes: false,
          author: ''
        })
      );

      await rewrite(h, CLOSING_LEFT);

      expect(h.source()).toBe(CLOSING_LEFT);
      expect(h.transactions).toHaveLength(0);
      expect(h.saves).toHaveLength(0);
    });

    it('names a write the network refused, and leaves no rejection', async () => {
      // The deletion is the one write the reader did not ask for, so nothing
      // of theirs is waiting on it: a network failure of it is named on the
      // console, where every other failure of this extension is named, and
      // leaves no rejection for the page to report as an error.
      const warned = jest
        .spyOn(console, 'warn')
        .mockImplementation(() => undefined);
      const unhandled: unknown[] = [];
      const collect = (reason: unknown): void => {
        unhandled.push(reason);
      };
      // The runner reports a rejection nothing handled on the node process,
      // which the browser type declarations of this suite do not name.
      const runner = (globalThis as any).process;
      runner.on('unhandledRejection', collect);
      try {
        const h = open(marked());
        await ready();
        route.mockRejectedValue(new Error('offline'));

        await rewrite(h, CLOSING_LEFT);

        expect(h.source()).toBe(CLOSING_LEFT);
        expect(h.transactions).toHaveLength(0);

        // Node reports a rejection nothing handled on a later tick of the
        // real event loop, so the fake clock is put down to let one pass.
        jest.useRealTimers();
        await new Promise(resolve => setTimeout(resolve, 0));
      } finally {
        runner.off('unhandledRejection', collect);
      }

      expect(unhandled).toEqual([]);
      expect(warned).toHaveBeenCalledWith(
        expect.stringContaining('could not be deleted')
      );
      expect(warned).toHaveBeenCalledWith(expect.stringContaining('offline'));
      warned.mockRestore();
    });

    it('changes nothing when the preview closed while the route wrote', async () => {
      // The deletion is the one write that fires without the reader, so it is
      // the one that can still be in flight when they close the tab. The
      // document it was computed against is not this controller's any more.
      const h = open(marked());
      await ready();
      let answerWrite = (): void => undefined;
      route.mockReturnValue(
        new Promise(resolve => {
          answerWrite = () => resolve(answer(200, { hash: 'h1' }));
        })
      );

      h.external(CLOSING_LEFT);
      jest.advanceTimersByTime(20);
      jest.advanceTimersByTime(BREAK_SETTLE_MS);
      await deleted();
      const before = h.transactions.length;

      h.controller.dispose();
      answerWrite();
      await deleted();

      expect(h.transactions).toHaveLength(before);
      expect(h.source()).toBe(CLOSING_LEFT);
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
      // The record is carried in place, so its offsets are copied out here.
      const before = { ...h.controller.selection! };
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

    it('writes a document marker at the top of the file', async () => {
      const h = open(BARE);
      await ready();
      h.render(BARE_HTML);

      const id = await h.controller.markDocument();

      expect(id).not.toBeNull();
      expect(h.source()).toBe(`<!-- mark:${id} document -->\n${BARE}`);
      const [listed] = h.controller.marks;
      expect(listed).toMatchObject({
        id,
        type: 'document',
        text: '',
        unanchored: false
      });
    });

    it('writes the document marker after a leading front matter block', async () => {
      // A site generator reads the front matter only as the first bytes of
      // the file, so the marker goes after it.
      const front = '---\ntitle: Alpha\n---\n';
      const h = open(`${front}${BARE}`);
      await ready();
      h.render(BARE_HTML);

      const id = await h.controller.markDocument();

      expect(h.source()).toBe(`${front}<!-- mark:${id} document -->\n${BARE}`);
    });

    it('opens the document mark the file already holds instead of a second', async () => {
      const h = open(BARE);
      await ready();
      h.render(BARE_HTML);

      const first = await h.controller.markDocument();
      const second = await h.controller.markDocument();

      expect(second).toBe(first);
      expect(h.source().match(/mark:[0-9a-f-]{36} document/g)).toHaveLength(1);
    });

    it('writes one document marker for two presses before the first write lands', async () => {
      // A double click or a held Enter on the plus: the second press finds no
      // marker in the document, is refused by the route once the first has
      // landed, and must find the marker on the refresh that refusal brings.
      const h = open(BARE);
      await ready();
      h.render(BARE_HTML);
      let release: () => void = () => undefined;
      route.mockImplementationOnce(
        () =>
          new Promise(
            resolve => (release = () => resolve(answer(200, { hash: 'h1' })))
          )
      );
      route.mockImplementationOnce(async () => {
        const landed = JSON.parse(route.mock.calls[0][2].body).content;
        h.duringRefresh(() => {
          h.external(landed, 'h1');
          h.duringRefresh(() => undefined);
        });
        return answer(409, { content: landed, hash: 'h1' });
      });
      route.mockImplementationOnce(async () => answer(200, { hash: 'h2' }));

      const first = h.controller.markDocument();
      for (let turn = 0; turn < 20 && route.mock.calls.length < 1; turn++) {
        await ready();
      }
      const second = h.controller.markDocument();
      for (let turn = 0; turn < 20 && route.mock.calls.length < 2; turn++) {
        await ready();
      }
      expect(route.mock.calls).toHaveLength(2);
      release();
      const [one, two] = await Promise.all([first, second]);

      expect(one).not.toBeNull();
      expect(two).toBe(one);
      expect(h.source().match(/mark:[0-9a-f-]{36} document/g)).toHaveLength(1);
      expect(route).toHaveBeenCalledTimes(2);
    });

    it('lists the document mark the refresh brought in before answering', async () => {
      // An external tool wrote the marker since the last read: the press's
      // own refresh brings it in, and the panel must list it by the time the
      // entry is opened on the id answered.
      const id = '0d4b0d0a-4a4e-4f6a-9d8c-1d6b0a3c2e11';
      const h = open(BARE);
      await ready();
      h.render(BARE_HTML);
      h.duringRefresh(() => {
        h.external(`<!-- mark:${id} document -->\n${BARE}`, 'h1');
        h.duringRefresh(() => undefined);
      });

      const found = await h.controller.markDocument();

      expect(found).toBe(id);
      expect(h.controller.marks.map(mark => mark.id)).toEqual([id]);
      expect(route).not.toHaveBeenCalled();
    });

    it('paints nothing for a document marker a hand-written closing marker paired', async () => {
      const id = '0d4b0d0a-4a4e-4f6a-9d8c-1d6b0a3c2e11';
      const h = open(
        `Alpha <!-- mark:${id} document -->beta gamma<!-- /mark:${id} --> delta.\n`
      );
      await ready();
      h.render(BARE_HTML);

      expect(h.root.querySelectorAll('[data-mark]')).toHaveLength(0);
      expect(h.controller.marks[0]).toMatchObject({ id, type: 'document' });
    });

    it('takes a note on the document marker and removes it', async () => {
      const h = open(BARE);
      await ready();
      h.render(BARE_HTML);
      const id = (await h.controller.markDocument())!;

      expect(await h.controller.addNote(id, 'On the whole')).toBe(true);
      expect(h.source()).toMatch(
        new RegExp(
          `^<!-- mark:${id} document\\n@\\S+ \\S+: On the whole\\n-->\\n`
        )
      );

      await h.controller.remove(id);
      expect(h.source()).toBe(BARE);
    });

    it('removes a document marker that holds no note', async () => {
      const h = open(BARE);
      await ready();
      h.render(BARE_HTML);
      const id = (await h.controller.markDocument())!;

      await h.controller.removeEmptyDocument(id);

      expect(h.source()).toBe(BARE);
    });

    it('keeps a document marker a note reached before the removal was written', async () => {
      // The reader cancelled on an empty document note while another writer
      // put a note into the marker: the removal reads the file it writes over.
      const id = '0d4b0d0a-4a4e-4f6a-9d8c-1d6b0a3c2e11';
      const noted = `<!-- mark:${id} document\n@ab 2026-09-10T10:00:00Z: Kept\n-->\n${BARE}`;
      const h = open(`<!-- mark:${id} document -->\n${BARE}`);
      await ready();
      h.render(BARE_HTML);
      h.duringRefresh(() => {
        h.external(noted, 'h1');
        h.duringRefresh(() => undefined);
      });

      await h.controller.removeEmptyDocument(id);

      expect(h.source()).toBe(noted);
      expect(route).not.toHaveBeenCalled();
    });

    it('lists a document note first wherever its marker sits', async () => {
      const passage = '0d4b0d0a-4a4e-4f6a-9d8c-1d6b0a3c2e11';
      const whole = '7f2c9c58-3b8a-4b8f-8f7d-2e1a5b6c7d80';
      const h = open(
        `Alpha <!-- mark:${passage} note -->beta gamma<!-- /mark:${passage} --> delta.\n<!-- mark:${whole} document -->\n`
      );
      await ready();
      h.render(BARE_HTML);

      expect(h.controller.marks.map(mark => mark.id)).toEqual([whole, passage]);
      expect(h.controller.marks[0].unanchored).toBe(false);
    });

    it('clears the selection once the passage is marked', async () => {
      const h = open(BARE);
      await ready();
      h.render(BARE_HTML);
      selectRange(h.root, 'beta', 'gamma');
      const selection = (window as any).getSelection();

      const id = await h.controller.mark('yellow');

      // The painted mark shows the passage now; a selection left over it
      // would lie on top of the mark and be put back after every render.
      expect(id).not.toBeNull();
      // Collapsed to the end of the painted mark and not removed: a
      // caret-browsing reader keeps their place, at the end of the passage.
      const spans = h.root.querySelectorAll(`[data-mark="${id}"]`);
      const last = spans[spans.length - 1];
      expect(selection.collapse).toHaveBeenCalledTimes(1);
      expect(selection.collapse).toHaveBeenCalledWith(
        last,
        last.childNodes.length
      );
      expect(selection.collapseToEnd).not.toHaveBeenCalled();
      expect(selection.removeAllRanges).not.toHaveBeenCalled();
      expect(h.controller.selection).toBeNull();
    });

    it('keeps a selection the reader made while the write was on its way', async () => {
      const h = open(BARE);
      await ready();
      h.render(BARE_HTML);
      selectRange(h.root, 'beta', 'gamma');
      let release: () => void = () => undefined;
      route.mockImplementationOnce(
        () => new Promise(resolve => (release = () => resolve(ABSENT)))
      );

      const pending = h.controller.mark('yellow');
      for (let turn = 0; turn < 20 && route.mock.calls.length === 0; turn++) {
        await ready();
      }
      expect(route.mock.calls).toHaveLength(1);
      // The route is still to answer; the reader has moved on to other words.
      selectRange(h.root, 'delta', 'delta');
      const later = (window as any).getSelection();
      release();
      const id = await pending;

      // The mark is written where it was asked, and the later selection is
      // the reader's to keep.
      expect(id).not.toBeNull();
      expect(h.source()).toContain(
        `Alpha <!-- mark:${id} note colour=yellow -->beta gamma<!-- /mark:${id} --> delta.`
      );
      expect(h.controller.selection).not.toBeNull();
      expect(later.collapse).not.toHaveBeenCalled();
    });

    it('clears the selection when the browser reported its own restore during the write', async () => {
      // A render during the round trip restores the selection over the new
      // nodes, and the browser reports that restore as a change: the record
      // must stay the same object, or the mark no longer knows it as its own
      // (round-6 bug-hunter finding).
      const h = open(BARE);
      await ready();
      h.render(BARE_HTML);
      selectRange(h.root, 'beta', 'gamma');
      let release: () => void = () => undefined;
      route.mockImplementationOnce(
        () => new Promise(resolve => (release = () => resolve(ABSENT)))
      );

      const pending = h.controller.mark('yellow');
      for (let turn = 0; turn < 20 && route.mock.calls.length === 0; turn++) {
        await ready();
      }
      expect(route.mock.calls).toHaveLength(1);
      // The render of a change elsewhere completes and the selection is put
      // back over the same words; the browser then says the selection changed.
      h.render(BARE_HTML);
      selectRange(h.root, 'beta', 'gamma');
      const restored = (window as any).getSelection();
      release();
      const id = await pending;

      expect(id).not.toBeNull();
      expect(h.controller.selection).toBeNull();
      expect(restored.collapse).toHaveBeenCalledTimes(1);
    });

    it('writes nothing when the reader let the selection go and a change moved the words during the write', async () => {
      // The reader clicks in the text while the route is on its way, so the
      // record is no longer the one carried; a change ahead of the passage
      // then renders, and the retry must not pair the record's old offsets
      // with the words now at that place (round-6 bug-hunter finding).
      const h = open(BARE);
      await ready();
      h.render(BARE_HTML);
      selectRange(h.root, 'beta', 'gamma');
      let release: () => void = () => undefined;
      route.mockImplementationOnce(
        () =>
          new Promise(
            resolve =>
              (release = () =>
                resolve(
                  answer(409, { content: 'beta gamma delta.\n', hash: 'h1' })
                ))
          )
      );
      route.mockImplementationOnce(async () => ABSENT);

      const pending = h.controller.mark('yellow');
      for (let turn = 0; turn < 20 && route.mock.calls.length === 0; turn++) {
        await ready();
      }
      expect(route.mock.calls).toHaveLength(1);
      collapseSelection(textNodes(h.root)[0]);
      h.external('beta gamma delta.\n', 'h1');
      h.render('<p>beta gamma delta.</p>');
      release();
      const id = await pending;

      expect(id).toBeNull();
      expect(h.source()).toBe('beta gamma delta.\n');
    });

    it('writes nothing when a change closed the selected words during the write', async () => {
      // The agent rewrites the passage out of the file while the route is on
      // its way and the server refuses the write; the render carried the
      // record shut, and the retry must not pair its old offsets with the
      // words now at that place (round-5 bug-hunter finding).
      const h = open(BARE);
      await ready();
      h.render(BARE_HTML);
      selectRange(h.root, 'beta', 'gamma');
      let release: () => void = () => undefined;
      route.mockImplementationOnce(
        () =>
          new Promise(
            resolve =>
              (release = () =>
                resolve(answer(409, { content: 'Alpha delta.\n', hash: 'h1' })))
          )
      );
      route.mockImplementationOnce(async () => ABSENT);

      const pending = h.controller.mark('yellow');
      for (let turn = 0; turn < 20 && route.mock.calls.length === 0; turn++) {
        await ready();
      }
      expect(route.mock.calls).toHaveLength(1);
      h.external('Alpha delta.\n', 'h1');
      h.render('<p>Alpha delta.</p>');
      release();
      const id = await pending;

      expect(id).toBeNull();
      expect(h.source()).toBe('Alpha delta.\n');
      expect(h.controller.selection).toBeNull();
    });

    it('clears the selection when a render carried it during the write', async () => {
      // A change that settles while the route is on its way carries the
      // record onto the new text; the record is moved in place, so the mark
      // still knows it as its own and drops it once painted (round-4
      // bug-hunter finding on ACC-NOTES-129).
      const h = open(BARE);
      await ready();
      h.render(BARE_HTML);
      selectRange(h.root, 'beta', 'gamma');
      const selection = (window as any).getSelection();
      let release: () => void = () => undefined;
      route.mockImplementationOnce(
        () => new Promise(resolve => (release = () => resolve(ABSENT)))
      );

      const pending = h.controller.mark('yellow');
      for (let turn = 0; turn < 20 && route.mock.calls.length === 0; turn++) {
        await ready();
      }
      expect(route.mock.calls).toHaveLength(1);
      // The fade of an earlier change ends: the captured text now holds the
      // words the decorations held out, and the record is carried.
      h.root.innerHTML = '<p>Alpha beta gamma delta. Epsilon.</p>';
      h.settle();
      release();
      const id = await pending;

      expect(id).not.toBeNull();
      expect(h.source()).toContain(`-->beta gamma<!-- /mark:${id} -->`);
      expect(h.controller.selection).toBeNull();
      expect(selection.collapse).toHaveBeenCalledTimes(1);
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

    it('puts the selecting class on the document on a right click ahead of the selectionchange event', async () => {
      const h = open(BARE);
      await ready();
      h.render(BARE_HTML);
      // The selection is made and the right click comes before Chromium
      // reports the change; the menu is built on that click.
      selectRange(h.root, 'beta', 'gamma', false);
      expect(h.widget.node.classList.contains(SELECTING_CLASS)).toBe(false);
      h.root.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true }));
      expect(h.widget.node.classList.contains(SELECTING_CLASS)).toBe(true);
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

      // The mark is gone with its markers, and the panel is left as the
      // reader left it: its state is the document's own, and a rewrite of the
      // text did not ask for another one.
      expect(h.controller.panelState).toBe('expanded');
      expect(h.controller.marks).toEqual([]);
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

    it('keeps the state the reader asked for while an older state write lands', async () => {
      // The reader hid the panel and opened it again before the hide reached
      // the document: the file the next refresh brings in still says hidden,
      // and a read while the newer write is on its way must not put that
      // older state back over the one the reader asked for (DEF-NOTES-71).
      const h = open(BARE);
      await ready();
      route.mockResolvedValue(answer(200, { hash: 'h1' }));
      await h.controller.setPanelState('expanded');
      jest.advanceTimersByTime(20);

      let releaseHide: () => void = () => undefined;
      route.mockImplementationOnce(
        () =>
          new Promise(
            resolve =>
              (releaseHide = () => resolve(answer(200, { hash: 'h2' })))
          )
      );
      const hide = h.controller.setPanelState('hidden');
      for (let turn = 0; turn < 20 && route.mock.calls.length < 2; turn++) {
        await ready();
      }
      expect(route.mock.calls).toHaveLength(2);

      // The server has written the hide; the refresh of the next request
      // brings that file in, and a frame passes while its write is out.
      h.duringRefresh(() => {
        h.external(`${BARE}\n<!-- marks:settings panel=hidden -->\n`, 'h2');
        h.duringRefresh(() => undefined);
      });
      let releaseShow: () => void = () => undefined;
      route.mockImplementationOnce(
        () =>
          new Promise(
            resolve =>
              (releaseShow = () => resolve(answer(200, { hash: 'h3' })))
          )
      );
      const seen: string[] = [];
      h.controller.changed.connect(() => seen.push(h.controller.panelState));
      const show = h.controller.setPanelState('expanded');
      for (let turn = 0; turn < 20 && route.mock.calls.length < 3; turn++) {
        await ready();
      }
      expect(route.mock.calls).toHaveLength(3);
      jest.advanceTimersByTime(20);

      releaseHide();
      await hide;
      releaseShow();
      await show;
      jest.advanceTimersByTime(20);

      expect(seen).not.toContain('hidden');
      expect(h.controller.panelState).toBe('expanded');
      expect(h.source()).toContain('<!-- marks:settings panel=expanded -->');
    });

    it('stores the newer state when an older state write is refused and retried after the newer one lands', async () => {
      // The route refused the hide, and its retry was answered only after the
      // reader had opened the panel again and that write had landed: the
      // retry stores the state as it stands, not the hide (DEF-NOTES-73).
      const h = open(BARE);
      await ready();
      route.mockResolvedValue(answer(200, { hash: 'h1' }));
      await h.controller.setPanelState('expanded');
      jest.advanceTimersByTime(20);

      route.mockImplementationOnce(async () =>
        answer(409, { message: 'changed' })
      );
      let releaseRetry: () => void = () => undefined;
      route.mockImplementationOnce(
        () =>
          new Promise(
            resolve =>
              (releaseRetry = () =>
                resolve(answer(409, { message: 'changed' })))
          )
      );
      const hide = h.controller.setPanelState('hidden');
      for (let turn = 0; turn < 20 && route.mock.calls.length < 3; turn++) {
        await ready();
      }
      expect(route.mock.calls).toHaveLength(3);
      await h.controller.setPanelState('expanded');
      jest.advanceTimersByTime(20);

      releaseRetry();
      await hide;
      jest.advanceTimersByTime(20);
      expect(h.source()).toContain('<!-- marks:settings panel=expanded -->');

      // The next change to the file reads the stored state.
      h.external(`Zeta.\n${h.source()}`, 'h9');
      await ready();
      expect(h.controller.panelState).toBe('expanded');
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
