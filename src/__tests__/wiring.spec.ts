/**
 * The plugin as the lab activates it: the commands, the context menu and the
 * settings.
 *
 * The other suites cover the pieces. This one covers only what joins them, so
 * it drives the real notes controller and the real panel against a stand-in
 * document and a stand-in lab: a command registry that keeps what was declared
 * so the test can ask a command whether it is visible and then run it, a
 * context menu that keeps what was added to it, and a settings registry whose
 * composite the test writes.
 */

import { Clipboard } from '@jupyterlab/apputils';
import { Signal } from '@lumino/signaling';
import { BoxLayout, Widget } from '@lumino/widgets';

// The plugin takes its types from these four packages and calls only
// Clipboard.copyToSystem, which the apputils mock supplies; two of the four
// ship JavaScript jest cannot parse.
jest.mock('@jupyterlab/application', () => ({}));
jest.mock('@jupyterlab/apputils', () => ({
  Clipboard: { copyToSystem: jest.fn() }
}));
jest.mock('@jupyterlab/markdownviewer', () => ({}));
jest.mock('@jupyterlab/settingregistry', () => ({}));

/**
 * The change channel opens a WebSocket to the server, which no unit test has.
 */
jest.mock('../channel', () => ({
  ChangeChannel: class {
    interval = 10;
    dispose(): void {
      /* nothing to close */
    }
  }
}));

/**
 * The file watcher polls the server. The wiring only has to reach its refresh,
 * so the stand-in records the call and answers at once.
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
    refresh = jest.fn(async () => {
      /* nothing on disk to read */
    });
    constructor() {
      instances.push(this);
    }
    dispose(): void {
      this.isDisposed = true;
    }
  }
  return { FileWatcher, EXTERNAL_ORIGIN: 'external', __instances: instances };
});

/**
 * The write route is a request to the server. The stand-in answers every
 * write as landed, so the chain from the command to the route can be watched.
 */
jest.mock('../request', () => ({
  fetchAPI: jest.fn(async () => ({
    response: { status: 200, ok: true },
    data: { hash: 'h1' }
  }))
}));

import { ISelectionRange } from '../anchor';
import { DEFAULT_SETTINGS, VISIBILITY_ATTRIBUTE } from '../controller';
import { MARK_COLOURS, parseMarks, parseSettings } from '../marks';
import { MARK_ORIGIN } from '../notes';
import { CLOSE_CLASS, ROW_CLASS } from '../notes-panel';
import { fetchAPI } from '../request';
import plugin, { COMMANDS } from '../index';

/** The write route stand-in. */
const route = fetchAPI as jest.Mock;

/** The watcher instances the mock has built, newest last. */
const watchers = (): any[] =>
  (jest.requireMock('../watcher') as any).__instances;

/**
 * A stand-in for the command registry, keeping what the plugin declared so a
 * test can ask a command its label, its visibility and its effect.
 */
class Commands {
  addCommand(id: string, options: any): { dispose(): void } {
    this.declared.set(id, options);
    return { dispose: () => undefined };
  }
  label(id: string, args: any = {}): string {
    const options = this.declared.get(id);
    return typeof options.label === 'function'
      ? options.label(args)
      : options.label;
  }
  isVisible(id: string, args: any = {}): boolean {
    return this.declared.get(id).isVisible(args);
  }
  isEnabled(id: string, args: any = {}): boolean {
    return this.option(id, 'isEnabled', args, true);
  }
  // The rest of what Lumino's menu renderer reads of a command when the Mark
  // submenu renders, answered as the registry answers them for a command
  // that declares nothing.
  isToggled(id: string, args: any = {}): boolean {
    return this.option(id, 'isToggled', args, false);
  }
  caption(id: string, args: any = {}): string {
    return this.option(id, 'caption', args, '');
  }
  className(id: string, args: any = {}): string {
    return this.option(id, 'className', args, '');
  }
  dataset(id: string, args: any = {}): object {
    return this.option(id, 'dataset', args, {});
  }
  icon(id: string, args: any = {}): unknown {
    return this.option(id, 'icon', args, undefined);
  }
  iconClass(id: string, args: any = {}): string {
    return this.option(id, 'iconClass', args, '');
  }
  iconLabel(id: string, args: any = {}): string {
    return this.option(id, 'iconLabel', args, '');
  }
  mnemonic(id: string, args: any = {}): number {
    return this.option(id, 'mnemonic', args, -1);
  }
  readonly keyBindings: unknown[] = [];
  private option(id: string, name: string, args: any, fallback: any): any {
    const value = this.declared.get(id)[name];
    return typeof value === 'function' ? value(args) : (value ?? fallback);
  }
  execute(id: string, args: any = {}): Promise<void> {
    return Promise.resolve(this.declared.get(id).execute(args));
  }
  readonly declared = new Map<string, any>();
}

/**
 * A stand-in for the document toolbar, keeping the items added to it.
 */
class Toolbar extends Widget {
  addItem(name: string, item: Widget): boolean {
    this.items.push({ name, item });
    this.node.appendChild(item.node);
    return true;
  }
  readonly items: { name: string; item: Widget }[] = [];
}

/**
 * A stand-in for one open preview, shaped like the `MarkdownDocument` the
 * plugin attaches to: a top-to-bottom box over a toolbar, a content header and
 * the content, whose node holds the rendered Markdown.
 */
class Document extends Widget {
  constructor(initial: string) {
    super();
    this.addClass('jp-MarkdownViewer');
    this.layout = new BoxLayout({ spacing: 0 });
    const layout = this.layout as BoxLayout;
    this.content.node.appendChild(this.rendered);
    layout.addWidget(this.toolbar);
    layout.addWidget(this.contentHeader);
    layout.addWidget(this.content);
    document.body.appendChild(this.node);

    this.text = initial;
    const model: any = {
      toString: () => this.text,
      sharedModel: {
        transact: (fn: () => void, undoable: boolean, origin: string) => {
          this.transactions.push({ undoable, origin });
          this.order.push('transact');
          fn();
          model.contentChanged.emit(undefined);
        },
        updateSource: (start: number, end: number, value: string) => {
          this.text = this.text.slice(0, start) + value + this.text.slice(end);
        }
      }
    };
    model.contentChanged = new Signal<any, void>(model);
    this.context = {
      ready: Promise.resolve(),
      path: 'live.md',
      model,
      contentsModel: { hash: 'h0' },
      save: async () => {
        this.order.push('save');
      }
    };
  }

  /** Put a render on screen and tell the widget about it. */
  render(html: string): void {
    this.rendered.innerHTML = html;
    this.content.rendered.emit(undefined);
  }

  readonly toolbar = new Toolbar();
  readonly contentHeader = new Widget();
  readonly content: any = Object.assign(new Widget(), {
    rendered: null as any,
    update: jest.fn()
  });
  readonly rendered = document.createElement('div');
  readonly context: any;
  readonly transactions: { undoable: boolean; origin: string }[] = [];
  readonly order: string[] = [];
  text: string;
}

/**
 * Everything one activation of the plugin gives a test.
 */
function activate(source: string, composite: Record<string, unknown> = {}) {
  const commands = new Commands();
  const menu: any[] = [];
  const palette: any[] = [];
  const widget = new Document(source);
  widget.rendered.className = 'jp-RenderedMarkdown';
  widget.content.rendered = new Signal<any, void>(widget.content);

  // The hit test walks up from the node the context menu was opened over, as
  // the lab's does. A test says which node that was, or none for a menu
  // opened elsewhere.
  let hit: HTMLElement | null = widget.rendered;
  const app: any = {
    serviceManager: {
      contents: {},
      serverSettings: {},
      user: { identity: { username: 'lab-user', name: 'Lab User' } }
    },
    commands,
    contextMenu: { addItem: (item: any) => menu.push(item) },
    contextMenuHitTest: (test: (node: HTMLElement) => boolean) => {
      let node: HTMLElement | null = hit;
      while (node) {
        if (test(node)) {
          return node;
        }
        node = node.parentElement;
      }
      return undefined;
    }
  };

  const widgetAdded = new Signal<any, any>({});
  const tracker: any = {
    forEach: (fn: (found: any) => void) => fn(widget),
    widgetAdded,
    currentWidget: widget
  };

  const changed = new Signal<any, void>({});
  const settings: any = {
    composite: { ...composite },
    changed
  };
  const registry: any = { load: async () => settings };

  plugin.activate(app, tracker, registry, {
    addItem: (item: any) => palette.push(item)
  });

  return {
    commands,
    menu,
    palette,
    widget,
    settings,
    /** Let the settings load and the notes controller read the document. */
    ready: async (): Promise<void> => {
      for (let i = 0; i < 6; i += 1) {
        await Promise.resolve();
      }
      jest.advanceTimersByTime(20);
      await Promise.resolve();
    },
    /** Change a setting the way the settings editor would. */
    set: (values: Record<string, unknown>): void => {
      settings.composite = { ...settings.composite, ...values };
      changed.emit(undefined);
    },
    /** Say where the context menu was opened, or nowhere. */
    openedOver: (node: HTMLElement | null): void => {
      hit = node;
    },
    /** The panel the plugin installed beside the content. */
    panel: (): any => {
      const layout = widget.layout as BoxLayout;
      const box = Array.from(layout.widgets)[2] as any;
      return Array.from(box.widgets)[1];
    }
  };
}

type IActivation = ReturnType<typeof activate>;

/** Every text node of an element, in document order. */
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
 * Make the window answer with this selection, and tell the document the
 * selection changed, which is what the notes controller records.
 */
function stubSelection(value: unknown): void {
  (window as any).getSelection = () => value;
  document.dispatchEvent(new Event('selectionchange'));
}

/**
 * Make the reader's selection: from the first occurrence of `from` to the end
 * of the first occurrence of `to` at or after it.
 *
 * JupyterLab's jest shim replaces `document.createRange` with a stub holding
 * no boundaries, so the selection is built as the members the controller reads
 * of a range and handed over as the window's selection.
 */
function select(root: HTMLElement, from: string, to: string): void {
  const nodes = textNodes(root);
  let start: { node: Text; offset: number } | null = null;
  let end: { node: Text; offset: number } | null = null;
  for (const node of nodes) {
    const value = node.nodeValue ?? '';
    if (!start) {
      const at = value.indexOf(from);
      if (at >= 0) {
        start = { node, offset: at };
      }
    }
    if (start) {
      const at = value.indexOf(to, node === start.node ? start.offset : 0);
      if (at >= 0) {
        end = { node, offset: at + to.length };
        break;
      }
    }
  }
  if (!start || !end) {
    throw new Error(`selection ${from}..${to} not found`);
  }
  const range: ISelectionRange & {
    commonAncestorContainer: Node;
    toString(): string;
  } = {
    startContainer: start.node,
    startOffset: start.offset,
    endContainer: end.node,
    endOffset: end.offset,
    commonAncestorContainer: root,
    toString: () => 'selected'
  };
  // A live range whose nodes a render took out collapses onto their parent,
  // which is what the browser's selection reports after a render.
  const first = start.node;
  stubSelection({
    get isCollapsed() {
      return !first.isConnected;
    },
    rangeCount: 1,
    get anchorNode() {
      return first.isConnected ? first : root;
    },
    getRangeAt: () => range,
    removeAllRanges: () => undefined,
    collapseToEnd: () => undefined,
    collapse: () => undefined,
    addRange: () => undefined
  });
}

/**
 * The reader dragged over whitespace: a range with two ends, holding nothing
 * a mark could be put around.
 */
function blankSelection(): void {
  const previous = (window as any).getSelection();
  const range = previous.getRangeAt(0);
  stubSelection({
    isCollapsed: false,
    rangeCount: 1,
    anchorNode: range.startContainer,
    getRangeAt: () => ({ ...range, toString: () => '  \n ' })
  });
}

/**
 * The selection is in another part of the lab, not in this rendered preview.
 */
function elsewhereSelection(): void {
  const previous = (window as any).getSelection();
  const range = previous.getRangeAt(0);
  const outside = document.createElement('div');
  document.body.appendChild(outside);
  stubSelection({
    isCollapsed: false,
    rangeCount: 1,
    anchorNode: range.startContainer,
    getRangeAt: () => ({ ...range, commonAncestorContainer: outside })
  });
}

/** Nothing is selected: the reader clicked in the text. */
function selectNothing(): void {
  stubSelection({
    isCollapsed: true,
    rangeCount: 0,
    anchorNode: document.body.firstChild,
    getRangeAt: () => null
  });
}

/**
 * Write a note the way the reader does: open the mark's row, type into the
 * entry and save it.
 */
async function writeNote(
  lab: IActivation,
  id: string,
  text: string
): Promise<void> {
  const panel = lab.panel();
  panel.selectMark(id, true);
  const area = panel.node.querySelector('textarea') as HTMLTextAreaElement;
  area.value = text;
  area.dispatchEvent(new Event('input'));
  const save = Array.from(panel.node.querySelectorAll('button')).find(
    button => (button as HTMLElement).textContent === 'Save'
  );
  (save as HTMLButtonElement).click();
  await lab.ready();
}

const SOURCE = 'Alpha beta gamma delta.\n';
const HTML = '<p>Alpha beta gamma delta.</p>';

/** A document already carrying one mark over `beta gamma`. */
const ID = '0d4b0d0a-4a4e-4f6a-9d8c-1d6b0a3c2e11';
const MARKED = `Alpha <!-- mark:${ID} note colour=yellow -->beta gamma<!-- /mark:${ID} --> delta.\n`;
const MARKED_HTML = `<p>Alpha <!-- mark:${ID} note colour=yellow -->beta gamma<!-- /mark:${ID} --> delta.</p>`;

describe('the plugin', () => {
  let live: IActivation[] = [];
  let scrolled: Element[] = [];
  let originalScroll: any;
  let originalSelection: any;

  const start = async (
    source: string,
    composite: Record<string, unknown> = {}
  ): Promise<IActivation> => {
    const activation = activate(source, composite);
    live.push(activation);
    await activation.ready();
    return activation;
  };

  beforeEach(() => {
    jest.useFakeTimers();
    scrolled = [];
    originalScroll = Element.prototype.scrollIntoView;
    originalSelection = (window as any).getSelection;
    Element.prototype.scrollIntoView = function (this: Element) {
      scrolled.push(this);
    };
    selectNothing();
  });

  afterEach(() => {
    for (const activation of live) {
      activation.widget.dispose();
      activation.widget.node.remove();
    }
    live = [];
    Element.prototype.scrollIntoView = originalScroll;
    (window as any).getSelection = originalSelection;
    jest.useRealTimers();
  });

  describe('the settings it reads', () => {
    it('signs a note line with the author setting', async () => {
      const lab = await start(MARKED, { author: 'kj' });
      lab.widget.render(MARKED_HTML);

      await writeNote(lab, ID, 'This contradicts the intro.');

      const written = parseMarks(lab.widget.text)[0].notes;
      expect(written).toHaveLength(1);
      expect(written[0].author).toBe('kj');
      expect(written[0].text).toBe('This contradicts the intro.');
    });

    it('signs with author when the setting is empty', async () => {
      const lab = await start(MARKED, { author: '' });
      lab.widget.render(MARKED_HTML);

      await writeNote(lab, ID, 'A note.');

      expect(parseMarks(lab.widget.text)[0].notes[0].author).toBe('author');
    });

    it('falls back to the declared defaults for a value it cannot use', async () => {
      const lab = await start(MARKED, { author: 42, notes: 'yes' });
      lab.widget.render(MARKED_HTML);

      // author fell back to the empty default, which signs the line author,
      // and notes fell back to true, so the marking entries are offered.
      await writeNote(lab, ID, 'A note.');

      expect(parseMarks(lab.widget.text)[0].notes[0].author).toBe('author');
      select(lab.widget.rendered, 'beta', 'gamma');
      expect(lab.commands.isVisible(COMMANDS.addNote)).toBe(true);
    });

    it('follows the author setting when it changes', async () => {
      const lab = await start(MARKED, { author: 'kj' });
      lab.widget.render(MARKED_HTML);

      lab.set({ author: 'claude' });
      await lab.ready();
      await writeNote(lab, ID, 'A note.');

      expect(parseMarks(lab.widget.text)[0].notes[0].author).toBe('claude');
    });
  });

  describe('the marking commands', () => {
    it('marks the selected passage in the colour the entry names', async () => {
      const lab = await start(SOURCE);
      lab.widget.render(HTML);
      select(lab.widget.rendered, 'beta', 'gamma');

      await lab.commands.execute(COMMANDS.mark, { colour: 'pink' });

      const marks = parseMarks(lab.widget.text);
      expect(marks).toHaveLength(1);
      expect(marks[0].colour).toBe('pink');
      expect(
        lab.widget.text.slice(marks[0].passage!.start, marks[0].passage!.end)
      ).toBe('beta gamma');
      // Both markers are in the file, which is the whole store.
      expect(lab.widget.text.split(marks[0].id)).toHaveLength(3);
    });

    it('names its colour in the label so the entries read apart', async () => {
      const lab = await start(SOURCE);
      expect(
        MARK_COLOURS.map(colour =>
          lab.commands.label(COMMANDS.mark, { colour })
        )
      ).toEqual(['Yellow', 'Blue', 'Pink', 'Orange', 'Red', 'Green']);
    });

    it('writes the file through the route and a transaction of its own', async () => {
      const lab = await start(SOURCE);
      lab.widget.render(HTML);
      select(lab.widget.rendered, 'beta', 'gamma');
      route.mockClear();

      await lab.commands.execute(COMMANDS.mark, { colour: 'yellow' });

      // The refresh reaches the watcher before the write, so a change already
      // on disk lands first, and again after it, so the watcher finds the
      // file equal to the document and syncs the revision. The route is asked
      // once per mark, with the revision the document holds, and the context
      // is not asked to save.
      const watcher = watchers()[watchers().length - 1];
      expect(watcher.refresh).toHaveBeenCalledTimes(2);
      expect(route).toHaveBeenCalledTimes(1);
      expect(route.mock.calls[0][0]).toBe('write');
      expect(JSON.parse(route.mock.calls[0][2].body)).toEqual({
        path: 'live.md',
        expected: 'h0',
        content: lab.widget.text
      });
      expect(lab.widget.order).toEqual(['transact']);
      expect(lab.widget.transactions).toEqual([
        { undoable: false, origin: MARK_ORIGIN }
      ]);
    });

    it('marks and opens the note entry for the add-note entry', async () => {
      const lab = await start(SOURCE);
      lab.widget.render(HTML);
      select(lab.widget.rendered, 'beta', 'gamma');

      await lab.commands.execute(COMMANDS.addNote);

      expect(parseMarks(lab.widget.text)).toHaveLength(1);
      expect(lab.panel().node.querySelector('textarea')).not.toBeNull();
    });

    it('is offered only over a rendered preview holding a selection', async () => {
      const lab = await start(SOURCE);
      lab.widget.render(HTML);

      selectNothing();
      expect(lab.commands.isVisible(COMMANDS.mark, { colour: 'yellow' })).toBe(
        false
      );
      expect(lab.commands.isVisible(COMMANDS.addNote)).toBe(false);

      select(lab.widget.rendered, 'beta', 'gamma');
      expect(lab.commands.isVisible(COMMANDS.mark, { colour: 'yellow' })).toBe(
        true
      );
      expect(lab.commands.isVisible(COMMANDS.addNote)).toBe(true);

      // The same selection, and the menu was opened over nothing the hit
      // test reaches: the preview in front holds the selection, so it is the
      // one marked. The menu itself lists the entries only over a preview,
      // through their selector.
      lab.openedOver(null);
      expect(lab.commands.isVisible(COMMANDS.mark, { colour: 'yellow' })).toBe(
        true
      );
      expect(lab.commands.isVisible(COMMANDS.addNote)).toBe(true);
    });

    it('executes the mark after the hit node was detached', async () => {
      const lab = await start(SOURCE);
      lab.widget.render(HTML);
      select(lab.widget.rendered, 'beta', 'gamma');
      // The menu was opened over the paragraph; a write from disk then
      // re-rendered, which replaced every node under the host, so walking up
      // from the paragraph the menu remembers no longer reaches the host.
      lab.openedOver(lab.widget.rendered.firstElementChild as HTMLElement);
      lab.widget.render(HTML);

      await lab.commands.execute(COMMANDS.mark, { colour: 'yellow' });

      const marks = parseMarks(lab.widget.text);
      expect(marks).toHaveLength(1);
      expect(
        lab.widget.text.slice(marks[0].passage!.start, marks[0].passage!.end)
      ).toBe('beta gamma');
    });

    it('the mark-selection command is enabled only while the current preview holds a selection', async () => {
      const lab = await start(SOURCE);
      lab.widget.render(HTML);
      expect(lab.commands.label(COMMANDS.markSelection)).toBe(
        'Mark the selected passage'
      );

      selectNothing();
      expect(lab.commands.isEnabled(COMMANDS.markSelection)).toBe(false);

      select(lab.widget.rendered, 'beta', 'gamma');
      expect(lab.commands.isEnabled(COMMANDS.markSelection)).toBe(true);

      await lab.commands.execute(COMMANDS.markSelection);

      const marks = parseMarks(lab.widget.text);
      expect(marks).toHaveLength(1);
      expect(marks[0].colour).toBe(MARK_COLOURS[0]);
      expect(
        lab.widget.text.slice(marks[0].passage!.start, marks[0].passage!.end)
      ).toBe('beta gamma');
    });

    it('lists the mark-selection and the panel commands in the palette, and no document note', async () => {
      const lab = await start(SOURCE);
      expect(lab.palette).toEqual([
        { command: COMMANDS.markSelection, category: 'Markdown Viewer' },
        {
          command: COMMANDS.panel,
          args: { state: 'expanded' },
          category: 'Markdown Viewer'
        }
      ]);
    });

    it('writes the document marker from the plus control of the panel, the one route to it', async () => {
      const lab = await start(SOURCE);
      lab.widget.render(HTML);
      lab.panel().node.querySelector('.jp-AdvancedMd-notesAdd').click();
      await lab.ready();
      await lab.ready();

      expect(lab.widget.text).toMatch(
        /^<!-- mark:[0-9a-f-]{36} document -->\n/
      );
      expect(lab.panel().state).toBe('expanded');
      expect(lab.panel().node.querySelector('textarea')).not.toBeNull();
    });

    it('is not offered for a selection holding only whitespace', async () => {
      const lab = await start(SOURCE);
      lab.widget.render(HTML);
      select(lab.widget.rendered, 'beta', 'gamma');
      blankSelection();

      expect(lab.commands.isVisible(COMMANDS.mark, { colour: 'yellow' })).toBe(
        false
      );
      expect(lab.commands.isVisible(COMMANDS.addNote)).toBe(false);
    });

    it('is not offered for a selection outside the rendered preview', async () => {
      const lab = await start(SOURCE);
      lab.widget.render(HTML);
      select(lab.widget.rendered, 'beta', 'gamma');
      elsewhereSelection();

      expect(lab.commands.isVisible(COMMANDS.mark, { colour: 'yellow' })).toBe(
        false
      );
    });

    it('writes nothing when a selection cannot be found in the source', async () => {
      const lab = await start(SOURCE);
      lab.widget.render('<p>Words this document does not carry.</p>');
      select(lab.widget.rendered, 'Words', 'carry');

      await lab.commands.execute(COMMANDS.mark, { colour: 'yellow' });

      expect(lab.widget.text).toBe(SOURCE);
      expect(lab.widget.order).toEqual([]);
    });
  });

  describe('the panel commands', () => {
    it('offers every state but the one the panel is in', async () => {
      const lab = await start(MARKED);
      lab.widget.render(MARKED_HTML);

      // A document holding marks opens expanded.
      expect(lab.panel().state).toBe('expanded');
      expect(
        lab.commands.isVisible(COMMANDS.panel, { state: 'expanded' })
      ).toBe(false);
      expect(lab.commands.isVisible(COMMANDS.panel, { state: 'minimap' })).toBe(
        true
      );
      expect(lab.commands.isVisible(COMMANDS.panel, { state: 'hidden' })).toBe(
        true
      );
    });

    it('is offered without a selection, unlike the marking entries', async () => {
      const lab = await start(MARKED);
      lab.widget.render(MARKED_HTML);
      selectNothing();

      expect(lab.commands.isVisible(COMMANDS.panel, { state: 'hidden' })).toBe(
        true
      );
      expect(lab.commands.isVisible(COMMANDS.addNote)).toBe(false);
    });

    it('names each state in its label', async () => {
      const lab = await start(SOURCE);
      expect([
        lab.commands.label(COMMANDS.panel, { state: 'expanded' }),
        lab.commands.label(COMMANDS.panel, { state: 'minimap' }),
        lab.commands.label(COMMANDS.panel, { state: 'hidden' })
      ]).toEqual(['Show notes', 'Show notes minimap', 'Hide notes']);
    });

    it('names the minimap in the hide entry while the panel is one', async () => {
      const lab = await start(MARKED);
      lab.widget.render(MARKED_HTML);
      await lab.commands.execute(COMMANDS.panel, { state: 'minimap' });
      await lab.ready();
      expect(lab.commands.label(COMMANDS.panel, { state: 'hidden' })).toBe(
        'Hide minimap'
      );
      await lab.commands.execute(COMMANDS.panel, { state: 'expanded' });
      await lab.ready();
      expect(lab.commands.label(COMMANDS.panel, { state: 'hidden' })).toBe(
        'Hide notes'
      );
    });

    it('puts the panel into the state and stores it in the document', async () => {
      const lab = await start(MARKED);
      lab.widget.render(MARKED_HTML);

      await lab.commands.execute(COMMANDS.panel, { state: 'minimap' });

      expect(lab.panel().state).toBe('minimap');
      expect(parseSettings(lab.widget.text).settings).toEqual({
        panel: 'minimap'
      });
    });
  });

  describe('the context menu', () => {
    it('offers a Mark submenu of the six colours, the note and the three states', async () => {
      const lab = await start(SOURCE);
      expect(
        lab.menu.map(item => [
          item.type ?? 'command',
          item.command,
          item.args?.colour ?? item.args?.state
        ])
      ).toEqual([
        ['submenu', undefined, undefined],
        ['command', COMMANDS.addNote, undefined],
        ['command', COMMANDS.panel, 'expanded'],
        ['command', COMMANDS.panel, 'minimap'],
        ['command', COMMANDS.panel, 'hidden'],
        ['command', COMMANDS.copyMarkId, undefined]
      ]);
      const submenu = lab.menu[0].submenu;
      expect(submenu.title.label).toBe('Mark');
      expect(submenu.title.icon).toBeDefined();
      expect(
        submenu.items.map((item: any) => [item.command, item.args.colour])
      ).toEqual([
        [COMMANDS.mark, 'yellow'],
        [COMMANDS.mark, 'blue'],
        [COMMANDS.mark, 'pink'],
        [COMMANDS.mark, 'orange'],
        [COMMANDS.mark, 'red'],
        [COMMANDS.mark, 'green']
      ]);
    });

    it('offers them over the rendered Markdown of a preview and nothing else', async () => {
      const lab = await start(SOURCE);
      // A submenu entry is visible whenever its menu exists, so the Mark
      // entry is offered through a selector that needs the class the
      // controller puts on the document while a selection is held.
      expect(lab.menu[0].selector).toBe(
        '.jp-AdvancedMd-selecting .jp-MarkdownViewer .jp-RenderedMarkdown'
      );
      for (const item of lab.menu.slice(1, -1)) {
        expect(item.selector).toBe('.jp-MarkdownViewer .jp-RenderedMarkdown');
      }
      // The identifier is offered on a row of the panel alone.
      expect(lab.menu[lab.menu.length - 1].selector).toBe(
        '.jp-AdvancedMd-notes .jp-AdvancedMd-notesRow'
      );
      // The marking entry leads, so a reader with a selection meets it
      // before the panel entries.
      const ranks = lab.menu.map(item => item.rank);
      expect(ranks).toEqual([...ranks].sort((a, b) => a - b));
    });

    it('copies the identifier of the mark whose row the menu was opened on (ACC-NOTES-157)', async () => {
      const lab = await start(MARKED);
      lab.widget.render(MARKED_HTML);
      const copied = Clipboard.copyToSystem as jest.Mock;
      copied.mockClear();
      const row = lab.panel().node.querySelector('.jp-AdvancedMd-notesRow');
      expect(row.dataset.mark).toBe(ID);
      lab.openedOver(row.querySelector('.jp-AdvancedMd-notesPassage'));
      expect(lab.commands.isVisible(COMMANDS.copyMarkId)).toBe(true);
      await lab.commands.execute(COMMANDS.copyMarkId);
      expect(copied).toHaveBeenCalledWith(ID);
      // Over the preview the entry is not offered and copies nothing.
      lab.openedOver(lab.widget.rendered);
      expect(lab.commands.isVisible(COMMANDS.copyMarkId)).toBe(false);
      await lab.commands.execute(COMMANDS.copyMarkId);
      expect(copied).toHaveBeenCalledTimes(1);
    });

    it('puts the selecting class on the document while a selection is held', async () => {
      const lab = await start(SOURCE);
      lab.widget.render(HTML);
      expect(
        lab.widget.node.classList.contains('jp-AdvancedMd-selecting')
      ).toBe(false);
      select(lab.widget.rendered, 'beta', 'gamma');
      expect(
        lab.widget.node.classList.contains('jp-AdvancedMd-selecting')
      ).toBe(true);
      // A caret in text is a click in the text, which is a deselection; a
      // selection collapsed onto an element is what focusing a control
      // leaves, and keeps the record.
      stubSelection({
        isCollapsed: true,
        rangeCount: 0,
        anchorNode: document.createTextNode(''),
        getRangeAt: () => null
      });
      expect(
        lab.widget.node.classList.contains('jp-AdvancedMd-selecting')
      ).toBe(false);
    });
  });

  describe('the panel beside the preview', () => {
    it('lists the marks of the document', async () => {
      const lab = await start(MARKED);
      lab.widget.render(MARKED_HTML);

      const rows = lab.panel().node.querySelectorAll(`.${ROW_CLASS}`);
      expect(rows).toHaveLength(1);
      expect(rows[0].textContent).toContain('beta gamma');
    });

    it('closes from its own control and comes back from the menu command', async () => {
      const lab = await start(MARKED);
      lab.widget.render(MARKED_HTML);
      const panel = lab.panel();

      panel.node.querySelector(`.${CLOSE_CLASS}`).click();
      await lab.ready();
      expect(panel.state).toBe('hidden');
      expect(panel.isHidden).toBe(true);
      expect(parseSettings(lab.widget.text).settings).toEqual({
        panel: 'hidden'
      });

      // The context menu entry is outside the panel, so it is the way back.
      expect(
        lab.commands.isVisible(COMMANDS.panel, { state: 'expanded' })
      ).toBe(true);
      await lab.commands.execute(COMMANDS.panel, { state: 'expanded' });
      await lab.ready();

      expect(panel.state).toBe('expanded');
      expect(panel.node.querySelectorAll(`.${ROW_CLASS}`)).toHaveLength(1);
    });

    it('adds nothing to the document toolbar', async () => {
      const lab = await start(MARKED);
      lab.widget.render(MARKED_HTML);

      // One visible item would open the toolbar to its full height on every
      // preview; empty, JupyterLab keeps it a two-pixel strip.
      expect(lab.widget.toolbar.items).toEqual([]);
    });

    it('opens the note entry when the reader clicks a marked passage', async () => {
      const lab = await start(MARKED);
      lab.widget.render(MARKED_HTML);

      const painted = lab.widget.rendered.querySelector(
        '[data-mark]'
      ) as HTMLElement;
      expect(painted).not.toBeNull();
      painted.dispatchEvent(new MouseEvent('click', { bubbles: true }));

      expect(lab.panel().selected).toBe(ID);
      expect(lab.panel().node.querySelector('textarea')).not.toBeNull();
    });

    it('expands a minimap panel when the note entry is asked for', async () => {
      const lab = await start(
        `${MARKED}<!-- marks:settings panel=minimap -->\n`
      );
      lab.widget.render(MARKED_HTML);
      expect(lab.panel().state).toBe('minimap');

      lab.panel().selectMark(ID, true);

      expect(lab.panel().state).toBe('expanded');
      const area = lab
        .panel()
        .node.querySelector('.jp-AdvancedMd-notesForm textarea');
      expect(area).not.toBeNull();
      expect(document.activeElement).toBe(area);
    });
  });

  describe('painting the marks', () => {
    it('paints them again on every render, which rebuilt the nodes', async () => {
      const lab = await start(MARKED);
      lab.widget.render(MARKED_HTML);
      expect(lab.widget.rendered.querySelectorAll('[data-mark]')).toHaveLength(
        1
      );

      // The renderer wrote the same Markdown again, so the spans are gone and
      // the marks say exactly what they said before.
      lab.widget.render(MARKED_HTML);

      expect(lab.widget.rendered.querySelectorAll('[data-mark]')).toHaveLength(
        1
      );
    });

    it('lists a new mark before the command that made it returns', async () => {
      const lab = await start(SOURCE);
      lab.widget.render(HTML);
      select(lab.widget.rendered, 'beta', 'gamma');

      await lab.commands.execute(COMMANDS.mark, { colour: 'yellow' });

      // No frame has passed, so a panel that waited for one would be empty.
      expect(lab.panel().node.querySelectorAll(`.${ROW_CLASS}`)).toHaveLength(
        1
      );
    });
  });

  describe('the notes setting turned off', () => {
    it('hides the panel, the marks and the menu entries, and keeps the file', async () => {
      const lab = await start(MARKED);
      lab.widget.render(MARKED_HTML);
      select(lab.widget.rendered, 'beta', 'gamma');
      expect(lab.panel().state).toBe('expanded');

      lab.set({ notes: false });
      await lab.ready();

      expect(lab.panel().state).toBe('hidden');
      expect(lab.panel().isHidden).toBe(true);
      expect(lab.widget.rendered.querySelectorAll('[data-mark]')).toHaveLength(
        0
      );
      expect(lab.commands.isVisible(COMMANDS.mark, { colour: 'yellow' })).toBe(
        false
      );
      expect(lab.commands.isVisible(COMMANDS.addNote)).toBe(false);
      expect(lab.commands.isVisible(COMMANDS.panel, { state: 'hidden' })).toBe(
        false
      );
      // The markers already in the document are untouched.
      expect(lab.widget.text).toBe(MARKED);
    });

    it('takes the badge away with the setting, and a press on it writes nothing', async () => {
      // The badge is the feature's one control outside the panel; with the
      // setting off it is gone, and the state write behind it is refused
      // (DEF-NOTES-63).
      // An unmarked document, so the controller's own state is hidden and
      // the badge's ask for the expanded state reaches the write guard.
      const lab = await start(SOURCE);
      lab.widget.render(HTML);
      lab.set({ notes: false });
      await lab.ready();

      expect(lab.panel().badge.hidden).toBe(true);
      lab.panel().badge.click();
      await lab.ready();
      expect(lab.panel().state).toBe('hidden');
      expect(lab.widget.text).toBe(SOURCE);
    });

    it('gives the marks back when the setting comes back', async () => {
      const lab = await start(MARKED);
      lab.widget.render(MARKED_HTML);

      lab.set({ notes: false });
      await lab.ready();
      lab.set({ notes: true });
      await lab.ready();
      lab.widget.render(MARKED_HTML);

      expect(lab.panel().state).toBe('expanded');
      expect(
        lab.widget.rendered.querySelectorAll('[data-mark]').length
      ).toBeGreaterThan(0);
    });
  });

  describe('the live controller beside it', () => {
    it('keeps its own settings, which are the same object', async () => {
      const lab = await start(SOURCE, { enabled: false });
      expect(watchers()[watchers().length - 1].enabled).toBe(false);
      lab.set({ enabled: true });
      expect(watchers()[watchers().length - 1].enabled).toBe(true);
    });

    it('declares a default for every setting the schema declares', () => {
      expect(Object.keys(DEFAULT_SETTINGS)).toContain('notes');
      expect(Object.keys(DEFAULT_SETTINGS)).toContain('author');
    });

    it('hands it the highlight strength, and refuses one the schema forbids', async () => {
      const lab = await start(SOURCE, { highlightVisibility: 'high' });
      expect(lab.widget.node.getAttribute(VISIBILITY_ATTRIBUTE)).toBe('high');
      // A settings file edited by hand can carry a fourth value; it falls back
      // to the default rather than leaving the stylesheet keyed off a value no
      // rule matches.
      lab.set({ highlightVisibility: 'garish' });
      expect(lab.widget.node.getAttribute(VISIBILITY_ATTRIBUTE)).toBe('medium');
    });
  });
});
