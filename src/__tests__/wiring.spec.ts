/**
 * The plugin as the lab activates it: the commands, the context menu, the
 * toolbar control and the settings.
 *
 * The other suites cover the pieces. This one covers only what joins them, so
 * it drives the real notes controller and the real panel against a stand-in
 * document and a stand-in lab: a command registry that keeps what was declared
 * so the test can ask a command whether it is visible and then run it, a
 * context menu that keeps what was added to it, and a settings registry whose
 * composite the test writes.
 */

import { Signal } from '@lumino/signaling';
import { BoxLayout, Widget } from '@lumino/widgets';

// The plugin declares its types from these three packages and calls nothing in
// them, and one of the three ships JavaScript jest cannot parse.
jest.mock('@jupyterlab/application', () => ({}));
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

import { ISelectionRange } from '../anchor';
import { DEFAULT_SETTINGS } from '../controller';
import { MARK_COLOURS, parseMarks, parseSettings } from '../marks';
import { MARK_ORIGIN } from '../notes';
import { CLOSE_CLASS, ROW_CLASS } from '../notes-panel';
import plugin, { COMMANDS } from '../index';

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
      model,
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
  const widget = new Document(source);
  widget.rendered.className = 'jp-RenderedMarkdown';
  widget.content.rendered = new Signal<any, void>(widget.content);

  // The hit test walks up from the node the context menu was opened over. A
  // test says which node that was, or none for a menu opened elsewhere.
  let hit: HTMLElement | null = widget.rendered;
  const app: any = {
    serviceManager: {
      contents: {},
      serverSettings: {},
      user: { identity: { username: 'lab-user', name: 'Lab User' } }
    },
    commands,
    contextMenu: { addItem: (item: any) => menu.push(item) },
    contextMenuHitTest: (test: (node: HTMLElement) => boolean) =>
      hit && test(hit) ? hit : undefined
  };

  const widgetAdded = new Signal<any, any>({});
  const tracker: any = {
    forEach: (fn: (found: any) => void) => fn(widget),
    widgetAdded
  };

  const changed = new Signal<any, void>({});
  const settings: any = {
    composite: { ...composite },
    changed
  };
  const registry: any = { load: async () => settings };

  plugin.activate(app, tracker, registry, null);

  return {
    commands,
    menu,
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
 * Make the reader's selection: from the first occurrence of `from` to the end
 * of the first occurrence of `to` at or after it.
 *
 * JupyterLab's jest shim replaces `document.createRange` with a stub holding
 * no boundaries, so the selection is built as the members the plugin reads of
 * a range and handed over as the window's selection.
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
  (window as any).getSelection = () => ({
    isCollapsed: false,
    rangeCount: 1,
    getRangeAt: () => range
  });
}

/**
 * The reader dragged over whitespace: a range with two ends, holding nothing
 * a mark could be put around.
 */
function blankSelection(): void {
  const previous = (window as any).getSelection();
  const range = previous.getRangeAt(0);
  (window as any).getSelection = () => ({
    isCollapsed: false,
    rangeCount: 1,
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
  (window as any).getSelection = () => ({
    isCollapsed: false,
    rangeCount: 1,
    getRangeAt: () => ({ ...range, commonAncestorContainer: outside })
  });
}

/** Nothing is selected. */
function selectNothing(): void {
  (window as any).getSelection = () => ({
    isCollapsed: true,
    rangeCount: 0,
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

    it('signs with the lab identity when the setting is empty', async () => {
      const lab = await start(MARKED, { author: '' });
      lab.widget.render(MARKED_HTML);

      await writeNote(lab, ID, 'A note.');

      expect(parseMarks(lab.widget.text)[0].notes[0].author).toBe('lab-user');
    });

    it('falls back to the declared defaults for a value it cannot use', async () => {
      const lab = await start(MARKED, { author: 42, notes: 'yes' });
      lab.widget.render(MARKED_HTML);

      // author fell back to the empty default, so the identity names the line,
      // and notes fell back to true, so the marking entries are offered.
      await writeNote(lab, ID, 'A note.');

      expect(parseMarks(lab.widget.text)[0].notes[0].author).toBe('lab-user');
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

    it('names its colour in the label so four entries read apart', async () => {
      const lab = await start(SOURCE);
      expect(
        MARK_COLOURS.map(colour =>
          lab.commands.label(COMMANDS.mark, { colour })
        )
      ).toEqual(['Mark yellow', 'Mark blue', 'Mark pink', 'Mark orange']);
    });

    it('writes the file through a transaction of its own and saves', async () => {
      const lab = await start(SOURCE);
      lab.widget.render(HTML);
      select(lab.widget.rendered, 'beta', 'gamma');

      await lab.commands.execute(COMMANDS.mark, { colour: 'yellow' });

      // The refresh reaches the watcher, so a change already on disk lands
      // before the write and the save cannot report the file as changed.
      expect(watchers()[watchers().length - 1].refresh).toHaveBeenCalled();
      expect(lab.widget.order).toEqual(['transact', 'save']);
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

      // The same selection, but the menu was opened somewhere else.
      lab.openedOver(null);
      expect(lab.commands.isVisible(COMMANDS.mark, { colour: 'yellow' })).toBe(
        false
      );
      expect(lab.commands.isVisible(COMMANDS.addNote)).toBe(false);
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
    it('offers the four colours, the note and the three states', async () => {
      const lab = await start(SOURCE);
      expect(
        lab.menu.map(item => [
          item.command,
          item.args?.colour ?? item.args?.state
        ])
      ).toEqual([
        [COMMANDS.mark, 'yellow'],
        [COMMANDS.mark, 'blue'],
        [COMMANDS.mark, 'pink'],
        [COMMANDS.mark, 'orange'],
        [COMMANDS.addNote, undefined],
        [COMMANDS.panel, 'expanded'],
        [COMMANDS.panel, 'minimap'],
        [COMMANDS.panel, 'hidden']
      ]);
    });

    it('offers them over the rendered Markdown of a preview and nothing else', async () => {
      const lab = await start(SOURCE);
      for (const item of lab.menu) {
        expect(item.selector).toBe('.jp-MarkdownViewer .jp-RenderedMarkdown');
      }
      // The marking entries lead, so a reader with a selection meets them
      // before the panel entries.
      const ranks = lab.menu.map(item => item.rank);
      expect(ranks).toEqual([...ranks].sort((a, b) => a - b));
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

    it('closes from its own control and comes back from the toolbar', async () => {
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

      // The toolbar control is outside the panel, so it is the way back.
      const button = lab.widget.toolbar.items[0];
      expect(button.name).toBe('advancedMdNotes');
      (button.item.node as HTMLButtonElement).click();
      await lab.ready();

      expect(panel.state).toBe('expanded');
      expect(panel.node.querySelectorAll(`.${ROW_CLASS}`)).toHaveLength(1);
    });

    it('cycles the three states from the toolbar control', async () => {
      const lab = await start(MARKED);
      lab.widget.render(MARKED_HTML);
      const click = async () => {
        (lab.widget.toolbar.items[0].item.node as HTMLButtonElement).click();
        await lab.ready();
        return lab.panel().state;
      };

      expect(lab.panel().state).toBe('expanded');
      expect(await click()).toBe('minimap');
      expect(await click()).toBe('hidden');
      expect(await click()).toBe('expanded');
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
      // The toolbar control goes too, so no write path is left reachable.
      expect(lab.widget.toolbar.items[0].item.isHidden).toBe(true);
      // The markers already in the document are untouched.
      expect(lab.widget.text).toBe(MARKED);
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
  });
});
