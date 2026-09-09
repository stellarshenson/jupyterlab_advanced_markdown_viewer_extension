/**
 * The notes panel: what it lists, what it asks the controller to do, and how
 * it sits beside the preview.
 *
 * The panel is checked through its own DOM, because that is what the reader
 * uses, and the four mark colours are checked against the stylesheet the
 * package ships, because a colour that is unreadable or too close to the
 * colour of a change is a defect no DOM assertion would catch.
 */

import { BoxLayout, BoxPanel, Widget } from '@lumino/widgets';

import {
  BUTTON_CLASS,
  CLOSE_CLASS,
  COLLAPSE_CLASS,
  EXPAND_CLASS,
  REMOVE_CLASS,
  COUNT_CLASS,
  CONTROLS_CLASS,
  DOT_CLASS,
  ENTRY_CLASS,
  EXPANDED_CLASS,
  FLASH_CLASS,
  FLASH_MS,
  HEAD_CLASS,
  INotesHost,
  INotesPanelHandlers,
  INotesPanelItem,
  LIST_CLASS,
  MAP_CLASS,
  MARK_CLASS,
  MINIMAP_CLASS,
  NotesPanel,
  PASSAGE_CLASS,
  PASSAGE_LIMIT,
  ROW_CLASS,
  SELECTED_CLASS,
  STAMP_CLASS,
  STATE_CLASS,
  SWATCH_CLASS,
  TEXT_CLASS,
  TICK_CLASS,
  TOGGLE_CLASS,
  colourClass,
  installNotesPanel,
  openingState,
  BADGE_EMPTY_CLASS,
  ADD_CLASS
} from '../notes-panel';
import { IMark, INoteEntry, MARK_COLOURS, MarkColour } from '../marks';
import { MARK_ICONS, SWATCH_RADIUS, SWATCH_SIZE } from '../icons';

// Type-only, so the module is never loaded: it ships JavaScript jest cannot
// parse, and only its type is needed here.
import type { MarkdownDocument } from '@jupyterlab/markdownviewer';

/**
 * A mark as the controller would hand it over, with only the fields a row
 * shows filled in.
 */
function mark(id: string, over: Partial<IMark> = {}): IMark {
  return {
    id,
    type: 'note',
    attributes: [],
    notes: [],
    colour: 'yellow',
    open: { start: 0, end: 10 },
    close: { start: 20, end: 30 },
    passage: { start: 10, end: 20 },
    ...over
  };
}

/**
 * One row of the panel.
 */
function item(
  id: string,
  passage: string,
  over: Partial<INotesPanelItem> = {}
): INotesPanelItem {
  return {
    mark: mark(id),
    passage,
    anchored: true,
    position: 0.5,
    ...over
  };
}

/**
 * A note entry.
 */
function note(author: string, stamp: string, text: string): INoteEntry {
  return { author, stamp, text };
}

/**
 * A stand-in for the document widget: a top-to-bottom box holding a toolbar,
 * a content header and the content, which is what a MainAreaWidget is.
 */
class HostDocument extends Widget {
  readonly toolbar = new Widget();
  readonly contentHeader = new Widget();
  readonly content = new Widget();

  constructor() {
    super();
    this.layout = new BoxLayout({ spacing: 0 });
    const layout = this.layout as BoxLayout;
    BoxLayout.setStretch(this.toolbar, 0);
    BoxLayout.setStretch(this.contentHeader, 0);
    BoxLayout.setStretch(this.content, 1);
    layout.addWidget(this.toolbar);
    layout.addWidget(this.contentHeader);
    layout.addWidget(this.content);
  }
}

/**
 * The stylesheet the package ships, read from disk.
 *
 * Node's own types are not in this project's type set, so the one function
 * this needs is declared here rather than imported.
 */
declare function require(id: string): {
  readFileSync(path: string, encoding: string): string;
};
declare const __dirname: string;

function readCss(): string {
  return require('fs').readFileSync(
    `${__dirname}/../../style/base.css`,
    'utf8'
  );
}

/** Every element scrolled into view, in order. */
const scrolled: Element[] = [];

/** What the panel asked the controller to do, in order. */
let asked: string[] = [];

/** What the controller answers a note with: whether the markers were found. */
let noteWritten = true;

const handlers: INotesPanelHandlers = {
  addNote: async (id, text) => {
    asked.push(`note ${id} ${text}`);
    return noteWritten;
  },
  setColour: (id, colour) => asked.push(`colour ${id} ${colour}`),
  removeMark: id => asked.push(`remove ${id}`),
  markDocument: async () => {
    asked.push('document');
    onMarkDocument();
    return documentId;
  },
  setState: state => asked.push(`state ${state}`)
};

/** What the stubbed controller answers to markDocument, and what it does first. */
let documentId: string | null = null;
let onMarkDocument: () => void = () => undefined;

/** A document note as the controller lists it. */
function documentItem(id: string): INotesPanelItem {
  return item(id, '', {
    mark: mark(id, { type: 'document', close: null, passage: null })
  });
}

/** Let the add control's asynchronous handler run to its end. */
async function settle(): Promise<void> {
  for (let i = 0; i < 4; i += 1) {
    await Promise.resolve();
  }
}

let root: HTMLElement;
let panel: NotesPanel;

/**
 * A rendered view holding one decoration per mark named, the way the
 * controller decorates a passage.
 */
function renderMarks(...ids: string[]): void {
  root.innerHTML = '';
  for (const id of ids) {
    const span = document.createElement('span');
    span.className = MARK_CLASS;
    span.dataset.mark = id;
    span.textContent = 'marked text';
    root.appendChild(span);
  }
}

const rows = (): HTMLElement[] =>
  Array.from(panel.node.querySelectorAll<HTMLElement>(`.${ROW_CLASS}`));

const ticks = (): HTMLElement[] =>
  Array.from(panel.node.querySelectorAll<HTMLElement>(`.${TICK_CLASS}`));

const passages = (): string[] =>
  Array.from(panel.node.querySelectorAll(`.${PASSAGE_CLASS}`)).map(
    element => element.textContent ?? ''
  );

const texts = (row: Element): string[] =>
  Array.from(row.querySelectorAll(`.${TEXT_CLASS}`)).map(
    element => element.textContent ?? ''
  );

/**
 * Click the button of a row whose label, or whose title for an icon button,
 * is `label`.
 */
function press(row: Element, label: string): void {
  const target = Array.from(
    row.querySelectorAll<HTMLButtonElement>(`.${BUTTON_CLASS}`)
  ).find(button => button.textContent === label || button.title === label);
  if (!target) {
    throw new Error(`no button labelled ${label}`);
  }
  target.click();
}

/**
 * Open a row, which is what the toggle of its head does.
 */
function expand(row: Element): void {
  row.querySelector<HTMLButtonElement>(`.${TOGGLE_CLASS}`)!.click();
}

beforeAll(() => {
  // jsdom lays nothing out, so it implements no scrolling.
  Element.prototype.scrollIntoView = function (this: Element) {
    scrolled.push(this);
  };
});

beforeEach(() => {
  jest.useFakeTimers();
  scrolled.length = 0;
  asked = [];
  noteWritten = true;
  root = document.createElement('div');
  root.className = 'jp-RenderedMarkdown';
  document.body.appendChild(root);
  documentId = null;
  onMarkDocument = () => undefined;
  panel = new NotesPanel({ root: () => root, handlers, state: 'expanded' });
  Widget.attach(panel, document.body);
});

afterEach(() => {
  jest.runOnlyPendingTimers();
  jest.useRealTimers();
  panel.dispose();
  root.remove();
});

describe('installNotesPanel', () => {
  it('puts the content and the panel side by side in the document', () => {
    const host = new HostDocument();
    const solo = new NotesPanel({
      root: () => root,
      handlers,
      state: 'hidden'
    });

    installNotesPanel(host, solo);

    const layout = host.layout as BoxLayout;
    const widgets = Array.from(layout.widgets);
    expect(widgets.slice(0, 2)).toEqual([host.toolbar, host.contentHeader]);
    const box = widgets[2] as BoxPanel;
    expect(box).toBeInstanceOf(BoxPanel);
    expect(box.direction).toBe('left-to-right');
    expect(Array.from(box.widgets)).toEqual([host.content, solo]);
    // The preview takes the width the panel leaves, and the box takes the
    // place the content had.
    expect(BoxPanel.getStretch(host.content)).toBe(1);
    expect(BoxPanel.getStretch(solo)).toBe(0);
    // The badge over the preview lives in the box, beside the panel that
    // hides with its state, and never in the rendered root.
    expect(box.node.contains(solo.badge)).toBe(true);
    expect(root.contains(solo.badge)).toBe(false);
    expect(BoxLayout.getStretch(box)).toBe(1);
    // Lumino moved the content, so nothing rebuilt the rendered view.
    expect(box.node.contains(host.content.node)).toBe(true);
    host.dispose();
  });
});

describe('the host the panel is installed into', () => {
  it('is what the Markdown preview widget already is', () => {
    // A compile-time check: the structural host type must fit the real
    // document widget, which is what the controller will hand over.
    const fits = (document: MarkdownDocument): INotesHost => document;
    expect(typeof fits).toBe('function');
  });
});

describe('the three states', () => {
  beforeEach(() => {
    panel.setMarks([
      item('a', 'first passage'),
      item('b', 'second passage', { mark: mark('b', { colour: 'blue' }) })
    ]);
  });

  it('lists every mark in document order when expanded', () => {
    expect(panel.node.querySelector(`.${LIST_CLASS}`)).not.toBeNull();
    expect(panel.hasClass(EXPANDED_CLASS)).toBe(true);
    expect(passages()).toEqual(['first passage', 'second passage']);
    expect(panel.node.querySelector(`.${COUNT_CLASS}`)!.textContent).toBe(
      '2 marks'
    );
  });

  it('cuts a long passage short', () => {
    const long = 'word '.repeat(40).trim();
    panel.setMarks([item('a', long)]);
    expect(passages()[0]).toBe(`${long.slice(0, PASSAGE_LIMIT)}…`);
  });

  it('shows one coloured tick per mark when minimap', () => {
    panel.state = 'minimap';
    expect(panel.hasClass(MINIMAP_CLASS)).toBe(true);
    expect(panel.node.querySelector(`.${MAP_CLASS}`)).not.toBeNull();
    expect(rows()).toHaveLength(0);
    expect(ticks()).toHaveLength(2);
    expect(ticks()[1].classList.contains(colourClass('blue'))).toBe(true);
    expect(ticks()[0].style.top).toBe('50%');
    expect(ticks()[0].title).toBe('first passage');
  });

  it('puts a tick where its mark sits in the document', () => {
    panel.setMarks([item('a', 'first passage', { position: 0.25 })]);
    panel.state = 'minimap';
    expect(ticks()[0].style.top).toBe('25%');
  });

  it('asks the box to measure it again when its width changes', () => {
    const host = new HostDocument();
    installNotesPanel(host, panel);
    const box = (host.layout as BoxLayout).widgets[2];
    const fit = jest.spyOn(box, 'fit');

    panel.state = 'minimap';

    expect(fit).toHaveBeenCalled();
    host.dispose();
  });

  it('says which state it is in', () => {
    expect(panel.state).toBe('expanded');
    panel.state = 'minimap';
    expect(panel.state).toBe('minimap');
  });

  it('shows nothing when hidden', () => {
    panel.state = 'hidden';
    expect(panel.isHidden).toBe(true);
    expect(rows()).toHaveLength(0);
    expect(ticks()).toHaveLength(0);
  });

  it('closes from its own control and reopens with the same marks', () => {
    panel.node.querySelector<HTMLButtonElement>(`.${CLOSE_CLASS}`)!.click();
    expect(asked).toEqual(['state hidden']);

    panel.state = 'hidden';
    expect(panel.isHidden).toBe(true);

    panel.state = 'expanded';
    expect(panel.isHidden).toBe(false);
    expect(passages()).toEqual(['first passage', 'second passage']);
  });
});

describe('a row', () => {
  const thread = [
    note('kj', '2026-09-06T16:00:00Z', 'first line\nsecond line'),
    note('claude', '2026-09-06T16:05:12Z', 'a reply')
  ];

  beforeEach(() => {
    panel.setMarks([
      item('a', 'first passage', { mark: mark('a', { notes: thread }) }),
      item('b', 'second passage', {
        mark: mark('b', {
          notes: [note('kj', '2026-09-06T16:10:00Z', 'other')]
        })
      })
    ]);
  });

  it('shows the first line of the first entry while it is closed', () => {
    expect(texts(rows()[0])).toEqual(['first line']);
    expect(rows()[0].querySelector(`.${CONTROLS_CLASS}`)).toBeNull();
  });

  it('shows every entry in full once it is open', () => {
    expand(rows()[0]);
    expect(texts(rows()[0])).toEqual(['first line\nsecond line', 'a reply']);
  });

  it('opens and closes independently of the other rows', () => {
    expand(rows()[0]);
    expect(texts(rows()[0])).toHaveLength(2);
    expect(texts(rows()[1])).toEqual(['other']);
    expand(rows()[0]);
    expect(texts(rows()[0])).toEqual(['first line']);
  });

  it('carries the stamp as local time and the file value in its title', () => {
    const stamp = rows()[0].querySelector(`.${STAMP_CLASS}`)!;
    expect(stamp.getAttribute('title')).toBe('2026-09-06T16:00:00Z');
    expect(stamp.textContent).toBe(
      new Date('2026-09-06T16:00:00Z').toLocaleString()
    );
  });

  it('says when a mark is unanchored', () => {
    panel.setMarks([item('a', 'first passage', { anchored: false })]);
    expect(rows()[0].querySelector(`.${STATE_CLASS}`)!.textContent).toBe(
      'unanchored'
    );
  });

  it('lists the marks with list roles and marks the selected one current', () => {
    const list = panel.node.querySelector(`.${LIST_CLASS}`)!;
    expect(list.getAttribute('role')).toBe('list');
    expect(rows().map(row => row.getAttribute('role'))).toEqual([
      'listitem',
      'listitem'
    ]);
    expect(rows().map(row => row.getAttribute('aria-current'))).toEqual([
      null,
      null
    ]);

    panel.selectMark('b');
    expect(rows().map(row => row.getAttribute('aria-current'))).toEqual([
      null,
      'true'
    ]);

    // The swatch is the only place a row shows its colour, so a screen
    // reader is told the colour by name.
    panel.setMarks([
      item('a', 'first passage'),
      item('b', 'second passage', { mark: mark('b', { colour: 'pink' }) })
    ]);
    for (const row of rows()) {
      const swatch = row.querySelector(`.${SWATCH_CLASS}`)!;
      expect(swatch.getAttribute('role')).toBe('img');
    }
    expect(
      rows().map(row =>
        row.querySelector(`.${SWATCH_CLASS}`)!.getAttribute('aria-label')
      )
    ).toEqual(['yellow', 'pink']);

    // The strip of ticks is not a list a reader moves through.
    panel.state = 'minimap';
    expect(
      panel.node.querySelector(`.${MAP_CLASS}`)!.hasAttribute('role')
    ).toBe(false);
  });

  it('names the type of a mark it cannot edit and offers no control', () => {
    panel.setMarks([
      item('a', 'first passage', { mark: mark('a', { type: 'task' }) })
    ]);
    expand(rows()[0]);
    expect(rows()[0].querySelector(`.${STATE_CLASS}`)!.textContent).toBe(
      'task'
    );
    expect(rows()[0].querySelector(`.${CONTROLS_CLASS}`)).toBeNull();
    expect(rows()[0].querySelectorAll(`.${DOT_CLASS}`)).toHaveLength(0);
  });
});

describe('selecting a mark', () => {
  beforeEach(() => {
    panel.setMarks([item('a', 'first passage'), item('b', 'second passage')]);
    renderMarks('a', 'b');
  });

  it('scrolls the passage into view and flashes it', () => {
    rows()[0].querySelector<HTMLElement>(`.${HEAD_CLASS}`)!.click();

    const marked = root.querySelector<HTMLElement>('[data-mark="a"]')!;
    expect(scrolled).toEqual([marked]);
    expect(marked.classList.contains(FLASH_CLASS)).toBe(true);
    expect(rows()[0].classList.contains(SELECTED_CLASS)).toBe(true);

    jest.advanceTimersByTime(FLASH_MS);
    expect(marked.classList.contains(FLASH_CLASS)).toBe(false);
  });

  it('restarts a flash rather than letting the first one end it early', () => {
    panel.selectMark('a');
    jest.advanceTimersByTime(FLASH_MS / 2);
    panel.selectMark('a');

    const marked = root.querySelector<HTMLElement>('[data-mark="a"]')!;
    jest.advanceTimersByTime(FLASH_MS / 2 + 1);
    expect(marked.classList.contains(FLASH_CLASS)).toBe(true);
    jest.advanceTimersByTime(FLASH_MS / 2);
    expect(marked.classList.contains(FLASH_CLASS)).toBe(false);
  });

  it('takes the flash off the passage it left when the reader picks another', () => {
    panel.selectMark('a');
    jest.advanceTimersByTime(FLASH_MS / 2);
    panel.selectMark('b');

    const first = root.querySelector<HTMLElement>('[data-mark="a"]')!;
    const second = root.querySelector<HTMLElement>('[data-mark="b"]')!;
    // Only one timeout is held, so a class left on the first passage would
    // outlive every window and flash again whenever the animation restarts,
    // which hiding and showing the tab does.
    expect(first.classList.contains(FLASH_CLASS)).toBe(false);
    expect(second.classList.contains(FLASH_CLASS)).toBe(true);
    jest.advanceTimersByTime(FLASH_MS + 1);
    expect(second.classList.contains(FLASH_CLASS)).toBe(false);
  });

  it('selects on Enter, since a row is focusable', () => {
    expect(rows()[1].tabIndex).toBe(0);
    rows()[1].dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    expect(scrolled).toEqual([root.querySelector('[data-mark="b"]')]);
  });

  it('leaves Enter to the control inside the row that was typed in', () => {
    // Every control of a row is a descendant of it, so a row handler that
    // took every Enter that bubbled up would take the one that opens a row
    // and the one that ends a line of a note.
    const toggle = rows()[1].querySelector<HTMLElement>(`.${TOGGLE_CLASS}`)!;
    toggle.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })
    );
    expect(scrolled).toEqual([]);
  });

  it('leaves an unanchored mark alone, having nothing to scroll to', () => {
    panel.setMarks([item('c', 'gone', { anchored: false })]);
    panel.selectMark('c');
    expect(scrolled).toEqual([]);
  });

  it('selects from a tick of the minimap', () => {
    panel.state = 'minimap';
    ticks()[1].click();
    expect(scrolled).toEqual([root.querySelector('[data-mark="b"]')]);
    expect(panel.selected).toBe('b');
  });

  it('opens the note entry when the marked passage was clicked', () => {
    panel.selectMark('a', true);
    expect(panel.node.querySelector('textarea')).not.toBeNull();
    expect(panel.selected).toBe('a');
    expect(asked).toEqual([]);
  });

  it('leaves the reader at the passage when the entry is opened from it', () => {
    // The entry is opened by a click on the passage or by Add note over a
    // selection there: the reader is at the passage, so nothing scrolls.
    panel.selectMark('a', true);
    expect(scrolled).toEqual([]);
  });

  it('brings the passage back into the view when the panel opened over it', () => {
    // The first mark opened the panel, which narrowed the preview and pushed
    // the passage below the view: it comes back the least distance, which
    // is what scrollIntoView does for a block of 'nearest'.
    renderMarks('a');
    panel.setMarks([item('a', 'first passage')]);
    const span = root.querySelector<HTMLElement>('[data-mark="a"]')!;
    root.getBoundingClientRect = () => ({ top: 0, bottom: 500 }) as DOMRect;
    span.getBoundingClientRect = () => ({ top: 600, bottom: 620 }) as DOMRect;
    panel.selectMark('a', true);
    expect(scrolled).toEqual([span]);
  });

  it('asks for the expanded state when the entry is opened from the minimap', () => {
    // A note entry exists only in the expanded state, so a reader who asked
    // for the entry asked for that state; a plain selection asks for nothing.
    panel.state = 'minimap';
    panel.selectMark('a');
    expect(asked).toEqual([]);
    panel.selectMark('a', true);
    expect(asked).toEqual(['state expanded']);
  });

  it('names what the hide control hides', () => {
    const control = panel.node.querySelector<HTMLButtonElement>(
      `.${CLOSE_CLASS}`
    )!;
    panel.state = 'minimap';
    expect(control.title).toBe('Hide minimap');
    expect(control.getAttribute('aria-label')).toBe('Hide minimap');
    panel.state = 'expanded';
    expect(control.title).toBe('Hide notes');
    expect(control.getAttribute('aria-label')).toBe('Hide notes');
  });

  it('collapses to the minimap from the control in the expanded header', () => {
    panel.state = 'expanded';
    const control = panel.node.querySelector<HTMLButtonElement>(
      `.${COLLAPSE_CLASS}`
    )!;
    expect(control.title).toBe('Show notes minimap');
    expect(control.querySelector('svg')).not.toBeNull();
    // At the left edge of the header, before the count, apart from Hide.
    expect(control.parentElement!.firstElementChild).toBe(control);
    control.focus();
    control.click();
    expect(asked).toEqual(['state minimap']);
    // The control goes out of view with the state; the focus moves to the
    // Hide control, which the minimap keeps, and not to the page body
    // (DEF-NOTES-58).
    panel.state = 'minimap';
    expect(document.activeElement).toBe(
      panel.node.querySelector(`.${CLOSE_CLASS}`)
    );
  });

  it('expands from the control on the minimap strip', () => {
    panel.state = 'minimap';
    const control = panel.node.querySelector<HTMLButtonElement>(
      `.${EXPAND_CLASS}`
    )!;
    expect(control.title).toBe('Show notes');
    expect(control.querySelector('svg')).not.toBeNull();
    control.focus();
    control.click();
    expect(asked).toEqual(['state expanded']);
    panel.state = 'expanded';
    expect(document.activeElement).toBe(
      panel.node.querySelector(`.${CLOSE_CLASS}`)
    );
  });

  it('asks for the expanded state when the entry is opened while hidden', () => {
    panel.state = 'hidden';
    panel.selectMark('a', true);
    expect(asked).toEqual(['state expanded']);
  });

  it('scrolls to nothing while the document has not been rendered', () => {
    const blind = new NotesPanel({
      root: () => null,
      handlers,
      state: 'expanded'
    });
    blind.setMarks([item('a', 'first passage')]);
    blind.selectMark('a');
    expect(scrolled).toEqual([]);
    blind.dispose();
  });

  it('keeps what was typed when the passage is clicked again', () => {
    panel.selectMark('a', true);
    const box = panel.node.querySelector('textarea')!;
    box.value = 'half a thought';
    box.dispatchEvent(new Event('input'));

    panel.selectMark('a', true);

    expect(panel.node.querySelector('textarea')!.value).toBe('half a thought');
  });

  it('ignores a mark it does not list', () => {
    panel.selectMark('gone');
    expect(scrolled).toEqual([]);
    expect(panel.selected).toBeNull();
  });
});

describe('writing a note', () => {
  beforeEach(() => {
    panel.setMarks([item('a', 'first passage')]);
    expand(rows()[0]);
  });

  const type = (value: string): void => {
    const box = panel.node.querySelector('textarea')!;
    box.value = value;
    box.dispatchEvent(new Event('input'));
  };

  it('names the note field for assistive technology', () => {
    press(rows()[0], 'Add note');
    expect(
      panel.node.querySelector('textarea')!.getAttribute('aria-label')
    ).toBe('Note');
  });

  it('lays the entry out as a wide box with its two buttons in a row below', () => {
    press(rows()[0], 'Add note');
    const form = panel.node.querySelector('.jp-AdvancedMd-notesForm')!;
    const box = form.querySelector('textarea')!;
    // Several lines are visible, and the buttons sit in their own row after
    // the box rather than beside it, so the box keeps the panel's width.
    expect(box.rows).toBe(4);
    const buttons = box.nextElementSibling!;
    expect(buttons.className).toBe('jp-AdvancedMd-notesFormButtons');
    expect(
      Array.from(buttons.querySelectorAll('button')).map(b => b.textContent)
    ).toEqual(['Save', 'Cancel']);
    expect(form.querySelectorAll('button')).toHaveLength(2);
  });

  it('writes what was typed', async () => {
    press(rows()[0], 'Add note');
    type('needs a number');
    press(rows()[0], 'Save');
    expect(asked).toEqual(['note a needs a number']);
    await Promise.resolve();
    expect(panel.node.querySelector('textarea')).toBeNull();
  });

  it('keeps the draft when the note could not be written', async () => {
    noteWritten = false;
    press(rows()[0], 'Add note');
    type('written too late');
    press(rows()[0], 'Save');
    await Promise.resolve();

    // The markers were gone by the time the note was saved, so the text stays
    // in front of the reader instead of vanishing with the mark.
    expect(asked).toEqual(['note a written too late']);
    expect(panel.node.querySelector('textarea')!.value).toBe(
      'written too late'
    );
  });

  it('shows the removal as a trash icon named by its title', () => {
    const remove = rows()[0].querySelector<HTMLButtonElement>(
      `.${REMOVE_CLASS}`
    )!;
    expect(remove.querySelector('svg')).not.toBeNull();
    expect(remove.textContent?.trim()).toBe('');
    expect(remove.title).toBe('Remove this mark');
    expect(remove.getAttribute('aria-label')).toBe('Remove this mark');
  });

  it('moves the focus to the row at its place when Remove took the focused row away', () => {
    panel.setMarks([item('a', 'first passage'), item('b', 'second passage')]);
    const remove = rows()[0].querySelector<HTMLButtonElement>(
      `.${REMOVE_CLASS}`
    )!;
    remove.focus();
    remove.click();
    // The controller took the mark out of the document and the panel is
    // rebuilt without its row; the row at its place takes the focus.
    panel.setMarks([item('b', 'second passage')]);
    expect(asked).toEqual(['remove a']);
    expect(document.activeElement).toBe(rows()[0]);
    expect(rows()[0].dataset.mark).toBe('b');
  });

  it('moves the focus to the panel body when Remove took the last row away', () => {
    const remove = rows()[0].querySelector<HTMLButtonElement>(
      `.${REMOVE_CLASS}`
    )!;
    remove.focus();
    remove.click();
    panel.setMarks([]);
    const body = panel.node.querySelector<HTMLElement>(`.${LIST_CLASS}`)!;
    expect(document.activeElement).toBe(body);
    // Out of the Tab order, so catching the focus moves nothing else.
    expect(body.tabIndex).toBe(-1);
  });

  it('moves the focus to the panel body when the rows become ticks', () => {
    rows()[0].focus();
    panel.state = 'minimap';
    // The strip is the body under its other class.
    expect(document.activeElement).toBe(
      panel.node.querySelector(`.${MAP_CLASS}`)
    );
  });

  it('moves the focus to the viewer when the panel is hidden from its own button', () => {
    const viewer = document.createElement('div');
    viewer.className = 'jp-MarkdownViewer';
    viewer.tabIndex = 0;
    document.body.appendChild(viewer);
    viewer.appendChild(root);
    const hide = panel.node.querySelector<HTMLButtonElement>(
      `.${CLOSE_CLASS}`
    )!;
    hide.focus();
    hide.click();
    expect(asked).toEqual(['state hidden']);
    // The controller follows at once with the state.
    panel.state = 'hidden';
    expect(document.activeElement).toBe(viewer);
    viewer.remove();
  });

  it('moves the focus to the viewer when the panel is hidden while a note is typed', () => {
    // A browser whose button click leaves the focus where it was (Safari,
    // Firefox on macOS): the note field is focused when Hide is pressed.
    const viewer = document.createElement('div');
    viewer.className = 'jp-MarkdownViewer';
    viewer.tabIndex = 0;
    document.body.appendChild(viewer);
    viewer.appendChild(root);
    press(rows()[0], 'Add note');
    type('half a thought');
    panel.node.querySelector('textarea')!.focus();
    panel.state = 'hidden';
    expect(document.activeElement).toBe(viewer);
    viewer.remove();
  });

  it('moves the focus to the panel body when the rows become ticks while a note is typed', () => {
    press(rows()[0], 'Add note');
    type('half a thought');
    panel.node.querySelector('textarea')!.focus();
    panel.state = 'minimap';
    expect(document.activeElement).toBe(
      panel.node.querySelector(`.${MAP_CLASS}`)
    );
  });

  it('ends the focus chain on the body, and not on a control Space acts on', () => {
    // The chain used to end on Hide, whose activation key is Space, so a
    // reader who simply kept typing hid the whole panel within a word or two
    // and was told nothing. The body is a plain div with no activation key.
    press(rows()[0], 'Add note');
    type('half a thought');
    panel.node.querySelector('textarea')!.focus();
    panel.setMarks([]);
    const body = panel.node.querySelector<HTMLElement>(`.${LIST_CLASS}`)!;
    const hide = panel.node.querySelector<HTMLElement>(`.${CLOSE_CLASS}`)!;
    expect(document.activeElement).toBe(body);
    expect(body.tagName).toBe('DIV');
    expect(body.tabIndex).toBe(-1);
    // The control the chain used to end on is still there, and skipped.
    expect(hide.tagName).toBe('BUTTON');
    expect(document.activeElement).not.toBe(hide);
  });

  it('draws a document note with the word Document and no swatch wherever it is handed', () => {
    panel.setMarks([item('a', 'first passage'), documentItem('d')]);
    const [first, second] = rows();
    expect(first.dataset.mark).toBe('a');
    expect(second.dataset.mark).toBe('d');
    // The controller orders the list; the panel shows what it is handed. A
    // document note's row carries the word in place of a passage, no swatch
    // and no state line.
    expect(second.querySelector(`.${PASSAGE_CLASS}`)!.textContent).toBe(
      'Document'
    );
    expect(second.querySelector(`.${SWATCH_CLASS}`)).toBeNull();
    expect(second.querySelector(`.${STATE_CLASS}`)).toBeNull();
    expect(first.querySelector(`.${SWATCH_CLASS}`)).not.toBeNull();
  });

  it('offers a note and a removal, and no colours, on an open document row', () => {
    panel.setMarks([documentItem('d')]);
    panel.selectMark('d');
    const row = rows()[0];
    expect(row.querySelectorAll(`.${DOT_CLASS}`)).toHaveLength(0);
    expect(row.querySelector(`.${REMOVE_CLASS}`)).not.toBeNull();
    expect(
      Array.from(row.querySelectorAll('button')).some(
        control => control.textContent === 'Add note'
      )
    ).toBe(true);
  });

  it('shows no tick for a document note', () => {
    panel.setMarks([documentItem('d'), item('a', 'first passage')]);
    panel.state = 'minimap';
    expect(panel.node.querySelectorAll(`.${TICK_CLASS}`)).toHaveLength(1);
  });

  it('adds a note on the document from the plus control in the header', async () => {
    // The one route to a document note: the controller writes the mark and
    // lists it, and the entry opens on it with the focus in the field.
    panel.setMarks([item('a', 'first passage')]);
    documentId = 'd';
    onMarkDocument = () =>
      panel.setMarks([documentItem('d'), item('a', 'first passage')]);
    const control = panel.node.querySelector<HTMLButtonElement>(
      `.${ADD_CLASS}`
    )!;
    expect(control.title).toBe('Add document note');
    expect(control.getAttribute('aria-label')).toBe(control.title);
    expect(control.querySelector('svg')).not.toBeNull();
    // After the count, before the expand and the hide controls.
    const header = control.parentElement!;
    expect(header.children[1]).toBe(
      panel.node.querySelector(`.${COUNT_CLASS}`)
    );
    expect(header.children[2]).toBe(control);
    expect(header.children[3]).toBe(
      panel.node.querySelector(`.${EXPAND_CLASS}`)
    );

    control.click();
    await settle();

    expect(asked).toEqual(['document']);
    expect(rows()[0].dataset.mark).toBe('d');
    const field = rows()[0].querySelector('textarea')!;
    expect(field).not.toBeNull();
    expect(document.activeElement).toBe(field);
  });

  it('opens the document note the file holds from the plus control on the minimap', async () => {
    // The file holds the document mark: the controller answers its id and
    // writes nothing; the entry needs the expanded state and asks for it.
    panel.setMarks([documentItem('d'), item('a', 'first passage')]);
    panel.state = 'minimap';
    documentId = 'd';
    const control = panel.node.querySelector<HTMLButtonElement>(
      `.${ADD_CLASS}`
    )!;
    control.click();
    await settle();

    expect(asked).toEqual(['document', 'state expanded']);
    panel.state = 'expanded';
    expect(rows()).toHaveLength(2);
    expect(rows()[0].querySelector('textarea')).not.toBeNull();
  });

  it('keeps a draft typed on another row when the plus opens the document row', async () => {
    // The plus beside a half-written note must not discard it: the document
    // row opens and is selected, the draft stays in its own row's field.
    panel.setMarks([documentItem('d'), item('a', 'first passage')]);
    press(rows()[1], 'Add note');
    type('half a thought');
    documentId = 'd';
    panel.node.querySelector<HTMLButtonElement>(`.${ADD_CLASS}`)!.click();
    await settle();

    const field = panel.node.querySelector<HTMLTextAreaElement>('textarea')!;
    expect(field.closest<HTMLElement>(`.${ROW_CLASS}`)!.dataset.mark).toBe('a');
    expect(field.value).toBe('half a thought');
    expect(document.activeElement).toBe(field);
    expect(rows()[0].classList.contains(SELECTED_CLASS)).toBe(true);
    expect(
      Array.from(rows()[0].querySelectorAll('button')).some(
        control => control.textContent === 'Add note'
      )
    ).toBe(true);
  });

  it('lands a blocked press in the draft, its collapsed row opened', () => {
    // The reader collapsed the row holding a half-written note; a press on
    // Add note elsewhere neither discards it nor does nothing: the draft's
    // row opens and its field takes the focus.
    panel.setMarks([item('a', 'first passage'), item('b', 'second passage')]);
    press(rows()[0], 'Add note');
    type('half a thought');
    (rows()[0].querySelector(`.${TOGGLE_CLASS}`) as HTMLButtonElement).click();
    expect(panel.node.querySelector('textarea')).toBeNull();
    panel.selectMark('b');
    press(rows()[1], 'Add note');

    const field = panel.node.querySelector<HTMLTextAreaElement>('textarea')!;
    expect(field.closest<HTMLElement>(`.${ROW_CLASS}`)!.dataset.mark).toBe('a');
    expect(field.value).toBe('half a thought');
    expect(document.activeElement).toBe(field);
  });

  it('opens the asked row when the field elsewhere holds only whitespace', () => {
    // Save reads a whitespace-only field as nothing; a press on Add note
    // elsewhere reads it the same way, so the field opens on the asked row.
    panel.setMarks([item('a', 'first passage'), item('b', 'second passage')]);
    press(rows()[0], 'Add note');
    type('\n  ');
    panel.selectMark('b');
    press(rows()[1], 'Add note');

    const field = panel.node.querySelector<HTMLTextAreaElement>('textarea')!;
    expect(field.closest<HTMLElement>(`.${ROW_CLASS}`)!.dataset.mark).toBe('b');
    expect(field.value).toBe('');
    expect(document.activeElement).toBe(field);
  });

  it('keeps a draft on one row when Add note is pressed on another', () => {
    panel.setMarks([item('a', 'first passage'), item('b', 'second passage')]);
    press(rows()[0], 'Add note');
    type('half a thought');
    panel.selectMark('b');
    press(rows()[1], 'Add note');

    const field = panel.node.querySelector<HTMLTextAreaElement>('textarea')!;
    expect(field.closest<HTMLElement>(`.${ROW_CLASS}`)!.dataset.mark).toBe('a');
    expect(field.value).toBe('half a thought');
  });

  it('puts the focus back in the open document field when the plus is pressed again', async () => {
    panel.setMarks([documentItem('d')]);
    documentId = 'd';
    const plus = panel.node.querySelector<HTMLButtonElement>(`.${ADD_CLASS}`)!;
    plus.click();
    await settle();
    expect(document.activeElement).toBe(panel.node.querySelector('textarea'));
    type('kept');
    plus.focus();
    plus.click();
    await settle();

    const field = panel.node.querySelector<HTMLTextAreaElement>('textarea')!;
    expect(field.value).toBe('kept');
    expect(document.activeElement).toBe(field);
  });

  it('opens nothing when the controller could not write the document mark', async () => {
    panel.setMarks([item('a', 'first passage')]);
    documentId = null;
    panel.node.querySelector<HTMLButtonElement>(`.${ADD_CLASS}`)!.click();
    await settle();

    expect(asked).toEqual(['document']);
    expect(rows()).toHaveLength(1);
    expect(panel.node.querySelector('textarea')).toBeNull();
  });

  it('shows the badge while hidden, muted without notes and named by the count', () => {
    panel.setMarks([]);
    panel.state = 'hidden';
    expect(panel.badge.hidden).toBe(false);
    expect(panel.badge.classList.contains(BADGE_EMPTY_CLASS)).toBe(true);
    expect(panel.badge.title).toBe('No marks: Show notes');
    expect(panel.badge.querySelector('svg')).not.toBeNull();
    panel.setMarks([item('a', 'first passage')]);
    expect(panel.badge.classList.contains(BADGE_EMPTY_CLASS)).toBe(false);
    expect(panel.badge.title).toBe('1 mark: Show notes');
    expect(panel.badge.getAttribute('aria-label')).toBe(panel.badge.title);
  });

  it('hides the badge while the panel is shown and opens the panel from it', () => {
    panel.state = 'expanded';
    expect(panel.badge.hidden).toBe(true);
    panel.state = 'minimap';
    expect(panel.badge.hidden).toBe(true);
    panel.state = 'hidden';
    panel.badge.click();
    expect(asked).toEqual(['state expanded']);
  });

  it('hands the focus to the Hide control when the badge opened the panel', () => {
    // The badge hides with the state it asked for; the focus it held goes to
    // the control the shown panel keeps, not to the page body (DEF-NOTES-64).
    document.body.appendChild(panel.badge);
    panel.state = 'hidden';
    panel.badge.focus();
    panel.badge.click();
    panel.state = 'expanded';
    expect(document.activeElement).toBe(
      panel.node.querySelector(`.${CLOSE_CLASS}`)
    );
    panel.badge.remove();
  });

  it('writes nothing for an empty note, leaving a bare mark', () => {
    press(rows()[0], 'Add note');
    type('   ');
    press(rows()[0], 'Save');
    expect(asked).toEqual([]);
    expect(panel.node.querySelector('textarea')).toBeNull();
  });

  it('writes nothing when the entry is cancelled', () => {
    press(rows()[0], 'Add note');
    type('never mind');
    press(rows()[0], 'Cancel');
    expect(asked).toEqual([]);
    expect(panel.node.querySelector('textarea')).toBeNull();
  });

  it('keeps the focus in the row after Cancel destroyed the pressed button', () => {
    press(rows()[0], 'Add note');
    type('never mind');
    const cancel = Array.from(
      rows()[0].querySelectorAll<HTMLButtonElement>(`.${BUTTON_CLASS}`)
    ).find(button => button.textContent === 'Cancel')!;
    cancel.focus();
    cancel.click();
    // The row is rebuilt without the form, so the button that had the focus
    // is gone; the reader's place in the tab order is the row it was in.
    expect(document.activeElement).toBe(rows()[0]);
  });

  it('keeps the focus in the row after Save', async () => {
    press(rows()[0], 'Add note');
    type('a thought');
    const save = Array.from(
      rows()[0].querySelectorAll<HTMLButtonElement>(`.${BUTTON_CLASS}`)
    ).find(button => button.textContent === 'Save')!;
    save.focus();
    save.click();
    // The row is rebuilt once the note is written.
    await Promise.resolve();
    expect(document.activeElement).toBe(rows()[0]);
  });

  it('keeps a half-written note through a change of the document', () => {
    press(rows()[0], 'Add note');
    type('half a thought');
    panel.setMarks([item('a', 'first passage rewritten')]);
    expect(panel.node.querySelector('textarea')!.value).toBe('half a thought');
  });

  it('keeps the caret where it was through a change of the document', () => {
    press(rows()[0], 'Add note');
    type('hello world');
    const before = panel.node.querySelector('textarea')!;
    before.focus();
    before.setSelectionRange(5, 5);

    panel.setMarks([item('a', 'first passage')]);

    const after = panel.node.querySelector('textarea')!;
    expect(after).not.toBe(before);
    expect(document.activeElement).toBe(after);
    expect(after.value).toBe('hello world');
    expect([after.selectionStart, after.selectionEnd]).toEqual([5, 5]);
  });

  it('keeps the entry when the reader cuts the marked passage and pastes it back', () => {
    press(rows()[0], 'Add note');
    type('half a thought');
    // The document holds no marker for a moment, so the mark is absent from
    // that parse; the file on disk held both markers throughout, so the panel
    // must not say the mark is gone, and the draft stays.
    panel.setMarks([item('b', 'another passage')]);
    expect(panel.node.querySelector('textarea')).toBeNull();

    panel.setMarks([item('a', 'first passage')]);
    expect(panel.node.querySelector('textarea')!.value).toBe('half a thought');
  });

  it('brings the row back open, with the text, after one absence', () => {
    // An agent rewrites the file in pieces and the first chunk stops before
    // the marked passage, so one parse holds no mark and the next holds it
    // whole. ACC-NOTES-144 promises a note being written is not taken away.
    press(rows()[0], 'Add note');
    type('half a thought');

    panel.setMarks([]);
    expect(panel.node.querySelector('textarea')).toBeNull();

    panel.setMarks([item('a', 'first passage')]);
    const after = panel.node.querySelector('textarea')!;
    expect(after.closest<HTMLElement>(`.${ROW_CLASS}`)!.dataset.mark).toBe('a');
    // The row is open, which is what its controls being drawn says.
    expect(rows()[0].querySelector(`.${CONTROLS_CLASS}`)).not.toBeNull();
    expect(after.value).toBe('half a thought');
    // The text without the focus would leave the reader looking at their own
    // draft with their typing landing nowhere. The panel remembers that the
    // rebuild which lost the row took the focus off a field, so the field
    // built in its place takes it back.
    expect(document.activeElement).toBe(after);
  });

  it('returns the reader to their field when a second mark held a row for the focus', () => {
    // With another mark still listed there is a row to park the focus on, so
    // where the focus sits says nothing about where the reader was: the panel
    // has to remember that it took the focus off a field.
    panel.setMarks([item('a', 'first passage'), item('b', 'second passage')]);
    press(rows()[0], 'Add note');
    type('half a thought');
    expect(document.activeElement).toBe(panel.node.querySelector('textarea'));

    panel.setMarks([item('b', 'second passage')]);
    expect(panel.node.querySelector('textarea')).toBeNull();
    expect(document.activeElement).toBe(rows()[0]);
    expect(rows()[0].dataset.mark).toBe('b');

    panel.setMarks([item('a', 'first passage'), item('b', 'second passage')]);
    const after = panel.node.querySelector('textarea')!;
    expect(after.value).toBe('half a thought');
    // Left on the other row, their keystrokes would land on it and the Enter
    // they meant as a newline would select that mark and flash the preview at
    // its passage.
    expect(document.activeElement).toBe(after);
  });

  it('returns the reader to their field after two rebuilds without one', () => {
    // A mark absent from two parses running is the ordinary shape of a
    // streamed rewrite, not an edge: an agent's chunks land one after the
    // other and the panel is handed the marks of each. Left on the body, the
    // reader's typing goes nowhere and the Enter they meant as a newline is
    // read by whatever holds the focus.
    press(rows()[0], 'Add note');
    type('half a thought');

    panel.setMarks([]);
    panel.setMarks([]);
    expect(panel.node.querySelector('textarea')).toBeNull();

    panel.setMarks([item('a', 'first passage')]);
    const after = panel.node.querySelector<HTMLTextAreaElement>('textarea')!;
    expect(after.value).toBe('half a thought');
    expect(document.activeElement).toBe(after);
  });

  it('leaves a reader who moved out of the panel where they went', () => {
    // The draft waits, but the reader is working somewhere else: the rebuilt
    // field must not take the focus off the control they chose.
    const elsewhere = document.createElement('button');
    document.body.appendChild(elsewhere);
    press(rows()[0], 'Add note');
    type('half a thought');

    panel.setMarks([]);
    elsewhere.focus();

    panel.setMarks([item('a', 'first passage')]);
    expect(panel.node.querySelector('textarea')!.value).toBe('half a thought');
    expect(document.activeElement).toBe(elsewhere);
    elsewhere.remove();
  });

  it('leaves a reader who was on a row out of the field when the rows return', () => {
    press(rows()[0], 'Add note');
    type('half a thought');
    // The reader moved off the field onto the row itself and stopped typing.
    rows()[0].focus();

    panel.setMarks([]);
    const body = panel.node.querySelector<HTMLElement>(`.${LIST_CLASS}`)!;
    expect(document.activeElement).toBe(body);

    panel.setMarks([item('a', 'first passage')]);
    // The draft is still there and the field is built again, but the reader
    // was not in it: pulling them in would land their next keystrokes in a
    // note they had left.
    expect(panel.node.querySelector('textarea')!.value).toBe('half a thought');
    expect(document.activeElement).toBe(body);
  });

  it('returns the reader to their field after a run of rebuilds without one', () => {
    // The parking has to survive every rebuild of a streamed rewrite, not one
    // or two: it names the element the last rebuild left the focus on, and
    // each rebuild that finds the reader still there names it again.
    press(rows()[0], 'Add note');
    type('half a thought');

    panel.setMarks([]);
    panel.setMarks([]);
    panel.setMarks([]);
    const body = panel.node.querySelector<HTMLElement>(`.${LIST_CLASS}`)!;
    expect(document.activeElement).toBe(body);

    panel.setMarks([item('a', 'first passage')]);
    const after = panel.node.querySelector<HTMLTextAreaElement>('textarea')!;
    expect(after.value).toBe('half a thought');
    expect(document.activeElement).toBe(after);
  });

  it('leaves a reader who parked and hid the panel on the control the badge gave them', () => {
    // The panel stays hidden as long as the reader leaves it hidden, and the
    // rewrites keep arriving behind it. Showing it again puts the reader on
    // the Hide control, and a parking made before the hide must not pull them
    // off the place the panel has just given them.
    const viewer = document.createElement('div');
    viewer.className = 'jp-MarkdownViewer';
    viewer.tabIndex = 0;
    document.body.appendChild(viewer);
    viewer.appendChild(root);
    document.body.appendChild(panel.badge);
    press(rows()[0], 'Add note');
    type('half a thought');
    panel.setMarks([]);

    panel.state = 'hidden';
    // The mark is back before the panel is shown, so the field is there to be
    // built the moment it is.
    panel.setMarks([item('a', 'first passage')]);
    panel.badge.focus();
    panel.badge.click();
    panel.state = 'expanded';

    expect(panel.node.querySelector('textarea')!.value).toBe('half a thought');
    expect(document.activeElement).toBe(
      panel.node.querySelector(`.${CLOSE_CLASS}`)
    );
    panel.badge.remove();
    viewer.remove();
  });

  it('leaves a reader who parked and collapsed the panel on the control the expand gave them', () => {
    // The body is never destroyed by a change of state, so a parking made on
    // it outlives the collapse; what ends it is the reader being moved off it,
    // which pressing a header control does.
    press(rows()[0], 'Add note');
    type('half a thought');
    panel.setMarks([]);

    const collapse = panel.node.querySelector<HTMLButtonElement>(
      `.${COLLAPSE_CLASS}`
    )!;
    collapse.focus();
    collapse.click();
    panel.state = 'minimap';
    panel.setMarks([item('a', 'first passage')]);

    const expandControl = panel.node.querySelector<HTMLButtonElement>(
      `.${EXPAND_CLASS}`
    )!;
    expandControl.focus();
    expandControl.click();
    panel.state = 'expanded';

    expect(panel.node.querySelector('textarea')!.value).toBe('half a thought');
    expect(document.activeElement).toBe(
      panel.node.querySelector(`.${CLOSE_CLASS}`)
    );
  });

  it('leaves a reader who parked and moved to a control of the panel on that control', () => {
    press(rows()[0], 'Add note');
    type('half a thought');
    panel.setMarks([]);
    const hide = panel.node.querySelector<HTMLElement>(`.${CLOSE_CLASS}`)!;
    // The reader has stopped typing and moved to the control themselves.
    hide.focus();

    panel.setMarks([item('a', 'first passage')]);
    // Pulled into the rebuilt field, the Space or Enter they meant for the
    // control would be typed into the note instead.
    expect(panel.node.querySelector('textarea')!.value).toBe('half a thought');
    expect(document.activeElement).toBe(hide);
  });

  it('opens an entry elsewhere once the draft mark has gone for good', () => {
    panel.setMarks([item('a', 'first passage'), item('b', 'second passage')]);
    press(rows()[0], 'Add note');
    type('half a thought');

    // This rewrite really did take the markers, so the mark never comes back.
    // A draft kept through an absence must not block every other row for the
    // rest of the session.
    panel.setMarks([item('b', 'second passage')]);
    expand(rows()[0]);
    press(rows()[0], 'Add note');

    const field = panel.node.querySelector('textarea')!;
    expect(field.closest<HTMLElement>(`.${ROW_CLASS}`)!.dataset.mark).toBe('b');
    expect(field.value).toBe('');
  });

  it('drops the selection when its mark leaves, and keeps the draft', () => {
    renderMarks('a');
    panel.selectMark('a');
    press(rows()[0], 'Add note');
    type('half a thought');

    panel.setMarks([]);
    // No row is current while the mark is absent, so the selection goes. The
    // open set and the held entry are read by identifier, so they are kept.
    expect(panel.selected).toBeNull();

    panel.setMarks([item('a', 'first passage')]);
    expect(panel.node.querySelectorAll(`.${SELECTED_CLASS}`)).toHaveLength(0);
    expect(panel.node.querySelector('textarea')!.value).toBe('half a thought');
  });
});

describe('the controls of a row', () => {
  beforeEach(() => {
    panel.setMarks([item('a', 'first passage')]);
    expand(rows()[0]);
  });

  it('puts the removal control last, pushed to the right of the dots', () => {
    const controls = rows()[0].querySelector(`.${CONTROLS_CLASS}`)!;
    const remove = controls.querySelector(`.${REMOVE_CLASS}`)!;
    expect(controls.lastElementChild).toBe(remove);
    // jsdom lays nothing out, so the rule that pushes it is read as written.
    expect(
      /\.jp-AdvancedMd-notesRemove \{[^}]*margin-left: auto;/.test(readCss())
    ).toBe(true);
  });

  it('offers the six colours and asks for the one pressed', () => {
    const dots = Array.from(
      rows()[0].querySelectorAll<HTMLButtonElement>(`.${DOT_CLASS}`)
    );
    expect(dots.map(dot => dot.title)).toEqual([...MARK_COLOURS]);
    for (const [index, colour] of MARK_COLOURS.entries()) {
      expect(dots[index].classList.contains(colourClass(colour))).toBe(true);
    }
    dots[2].click();
    expect(asked).toEqual([`colour a ${MARK_COLOURS[2]}`]);
  });

  it('asks for the mark to be removed', () => {
    press(rows()[0], 'Remove this mark');
    expect(asked).toEqual(['remove a']);
  });

  it('names every button for assistive technology by its title', () => {
    press(rows()[0], 'Add note');
    const buttons = Array.from(panel.node.querySelectorAll('button'));
    // The expand, collapse, add and close controls, the toggle, Add note,
    // the six dots, Remove, Save and Cancel.
    expect(buttons).toHaveLength(15);
    for (const button of buttons) {
      expect(button.getAttribute('aria-label')).toBe(button.title);
      // A button with a worded label is spoken and voice-driven by that
      // label, so the accessible name starts with it.
      if (/[A-Za-z]/.test(button.textContent ?? '')) {
        expect(
          button
            .getAttribute('aria-label')!
            .startsWith(button.textContent!.trim())
        ).toBe(true);
      }
    }
  });

  it('paints the swatch in the mark colour', () => {
    panel.setMarks([
      item('a', 'first passage', { mark: mark('a', { colour: 'pink' }) })
    ]);
    expect(panel.node.querySelector(`.${SWATCH_CLASS}`)!.className).toContain(
      colourClass('pink')
    );
  });
});

describe('openingState', () => {
  it('opens a document that carries marks', () => {
    expect(openingState(null, true)).toBe('expanded');
  });

  it('stays out of the way of a document that carries none', () => {
    expect(openingState(null, false)).toBe('hidden');
  });

  it('obeys the state the document stored', () => {
    expect(openingState('minimap', true)).toBe('minimap');
    expect(openingState('expanded', false)).toBe('expanded');
  });
});

describe('the mark colours in the stylesheet', () => {
  const css = readCss();

  /** The backgrounds JupyterLab paints behind the text in the two themes. */
  const LIGHT: [number, number, number] = [255, 255, 255];
  const DARK: [number, number, number] = [17, 17, 17];

  /**
   * The value of one property of one rule, read from the shipped stylesheet.
   */
  function declaration(selector: string, property: string): string {
    const start = css.indexOf(`\n${selector} {`);
    if (start < 0) {
      throw new Error(`the stylesheet has no rule for ${selector}`);
    }
    const body = css.slice(start, css.indexOf('}', start));
    const found = new RegExp(`${property}: ([^;]+);`).exec(body);
    if (!found) {
      throw new Error(`${selector} sets no ${property}`);
    }
    return found[1];
  }

  /**
   * A colour written as `rgb(r g b / a%)`, composited over a background.
   */
  function over(
    value: string,
    background: [number, number, number]
  ): [number, number, number] {
    const parts = /^rgb\((\d+) (\d+) (\d+) \/ (\d+)%\)$/.exec(value);
    if (!parts) {
      throw new Error(`not a colour with an alpha: ${value}`);
    }
    const alpha = Number(parts[4]) / 100;
    return [1, 2, 3].map(
      index =>
        alpha * Number(parts[index]) + (1 - alpha) * background[index - 1]
    ) as [number, number, number];
  }

  /** The channels of a colour with the display gamma taken back off. */
  function linear(colour: [number, number, number]): number[] {
    return colour.map(channel => {
      const unit = channel / 255;
      return unit <= 0.04045
        ? unit / 12.92
        : Math.pow((unit + 0.055) / 1.055, 2.4);
    });
  }

  /** Relative luminance, as the contrast definition uses it. */
  function luminance(colour: [number, number, number]): number {
    const [r, g, b] = linear(colour);
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  }

  /** Contrast ratio between a colour and the text drawn on it. */
  function contrast(
    colour: [number, number, number],
    text: [number, number, number]
  ): number {
    const [high, low] = [luminance(colour), luminance(text)].sort(
      (a, b) => b - a
    );
    return (high + 0.05) / (low + 0.05);
  }

  /** CIE Lab, so two colours can be compared as the eye compares them. */
  function lab(colour: [number, number, number]): number[] {
    const [r, g, b] = linear(colour);
    const white = [0.95047, 1, 1.08883];
    const xyz = [
      0.4124 * r + 0.3576 * g + 0.1805 * b,
      0.2126 * r + 0.7152 * g + 0.0722 * b,
      0.0193 * r + 0.1192 * g + 0.9505 * b
    ].map((value, index) => {
      const ratio = value / white[index];
      return ratio > 0.008856 ? Math.cbrt(ratio) : 7.787 * ratio + 16 / 116;
    });
    return [
      116 * xyz[1] - 16,
      500 * (xyz[0] - xyz[1]),
      200 * (xyz[1] - xyz[2])
    ];
  }

  /** How far apart two colours are to the eye. */
  function distance(
    one: [number, number, number],
    other: [number, number, number]
  ): number {
    const [a, b] = [lab(one), lab(other)];
    return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
  }

  const themes = [
    {
      name: 'light',
      background: LIGHT,
      text: [0, 0, 0] as [number, number, number],
      rule: (colour: MarkColour) => `.${colourClass(colour)}`,
      changes: [
        declaration(':root', '--jp-AdvancedMd-added-bg'),
        declaration(':root', '--jp-AdvancedMd-removed-bg')
      ]
    },
    {
      name: 'dark',
      background: DARK,
      text: [255, 255, 255] as [number, number, number],
      rule: (colour: MarkColour) =>
        `body[data-jp-theme-light='false'] .${colourClass(colour)}`,
      changes: [
        declaration(
          "body[data-jp-theme-light='false']",
          '--jp-AdvancedMd-added-bg'
        ),
        declaration(
          "body[data-jp-theme-light='false']",
          '--jp-AdvancedMd-removed-bg'
        )
      ]
    }
  ];

  // A red and a green mark are kin to the removed and the added run by
  // nature (ACC-NOTES-127) and are told from them by staying where a change
  // highlight fades, so no distance is asked of them and no case is made for
  // them; the other four keep the bar the faint alphas of ACC-NOTES-134 leave.
  const apart = MARK_COLOURS.filter(
    colour => colour !== 'red' && colour !== 'green'
  );

  for (const theme of themes) {
    for (const colour of MARK_COLOURS) {
      it(`keeps ${colour} readable under the ${theme.name} theme`, () => {
        const painted = over(
          declaration(theme.rule(colour), 'background-color'),
          theme.background
        );
        expect(contrast(painted, theme.text)).toBeGreaterThanOrEqual(4.5);
      });
    }

    for (const colour of apart) {
      it(`keeps ${colour} apart from a change under the ${theme.name} theme`, () => {
        const painted = over(
          declaration(theme.rule(colour), 'background-color'),
          theme.background
        );
        for (const change of theme.changes) {
          expect(
            distance(painted, over(change, theme.background))
          ).toBeGreaterThan(13);
        }
      });
    }
  }

  it('borders the minimap tick and gives the bordered buttons the 24 px target', () => {
    // The tick is the mark's faint wash; its border is what the eye finds on
    // the strip. The four bordered buttons of a row share one height.
    expect(declaration('.jp-AdvancedMd-notesTick', 'border')).toMatch(
      /^1px solid /
    );
    expect(declaration('.jp-AdvancedMd-notesButton', 'min-height')).toBe(
      '24px'
    );
  });

  it('puts the hide control at the top of the minimap strip', () => {
    // The strip's column follows the header's order, collapse to close; the
    // hide control is ordered ahead of the rest there by the ruling of
    // 2026-09-08, so the x sits above the plus and the expand caret.
    expect(
      declaration(
        '.jp-AdvancedMd-notes-minimap .jp-AdvancedMd-notesClose',
        'order'
      )
    ).toBe('-1');
  });

  /**
   * The body of every rule whose selector list names the class bare, read
   * with the comments stripped, since a comment glued to a rule would be
   * read as its first selector.
   */
  function rulesNaming(className: string): string[] {
    const rule = /\n((?:[^{}\n][^{}]*))\{([^}]*)\}/g;
    const bare = css.replace(/\/\*[\s\S]*?\*\//g, '');
    const bodies: string[] = [];
    for (let found = rule.exec(bare); found; found = rule.exec(bare)) {
      const [, selectors, body] = found;
      const named = selectors
        .split(',')
        .map((part: string) => part.trim())
        .includes(`.${className}`);
      if (named) {
        bodies.push(body);
      }
    }
    return bodies;
  }

  it('gives the plus control the 24 px target of the icon controls and shows it in both states', () => {
    // The control is named in the shared selector lists; each rule naming
    // it is read for the declarations the control needs.
    const declared: Record<string, string> = {};
    for (const body of rulesNaming(ADD_CLASS)) {
      const property = /([\w-]+): ([^;]+);/g;
      for (let hit = property.exec(body); hit; hit = property.exec(body)) {
        declared[hit[1]] = hit[2];
      }
    }
    expect(declared['min-height']).toBe('24px');
    expect(declared['min-width']).toBe('24px');
    expect(declared.display).toBe('inline-flex');
  });

  it('shows the expand and the collapse controls in their own state alone', () => {
    // The two controls are hidden by a bare rule and shown by a state-gated
    // one; a later bare rule that sets any other display would show both
    // carets in every state, as build 0.6.55 did (DEF-NOTES-59). Every rule
    // whose selector list names a control without a state prefix may set
    // display to none alone.
    for (const control of [EXPAND_CLASS, COLLAPSE_CLASS]) {
      let hidden = false;
      for (const body of rulesNaming(control)) {
        const display = /display: ([^;]+);/.exec(body);
        if (display) {
          expect(display[1]).toBe('none');
          hidden = true;
        }
      }
      expect(hidden).toBe(true);
    }
  });

  it('draws the menu swatch as the row swatch, in geometry and in colour', () => {
    // The panel swatch is a square with rounded corners, sized by the
    // stylesheet; the menu icon is the same square from the same numbers.
    expect(declaration('.jp-AdvancedMd-notesSwatch', 'width')).toBe(
      `${SWATCH_SIZE}px`
    );
    expect(declaration('.jp-AdvancedMd-notesSwatch', 'height')).toBe(
      `${SWATCH_SIZE}px`
    );
    expect(declaration('.jp-AdvancedMd-notesSwatch', 'border-radius')).toBe(
      `${SWATCH_RADIUS}px`
    );
    for (const colour of MARK_COLOURS) {
      const rect = /<rect ([^>]*)\/>/.exec(MARK_ICONS[colour].svgstr)![1];
      const attribute = (name: string): string =>
        new RegExp(`${name}="([^"]*)"`).exec(rect)![1];
      expect(attribute('width')).toBe(String(SWATCH_SIZE));
      expect(attribute('height')).toBe(String(SWATCH_SIZE));
      expect(attribute('rx')).toBe(String(SWATCH_RADIUS));
      expect(rect).not.toContain('stroke');
      // The light-theme colour of the painted mark, hue and alpha alike.
      const painted = /^rgb\((\d+) (\d+) (\d+) \/ (\d+)%\)$/.exec(
        declaration(`.${colourClass(colour)}`, 'background-color')
      )!;
      const hex = [1, 2, 3]
        .map(index => Number(painted[index]).toString(16).padStart(2, '0'))
        .join('');
      expect(attribute('fill')).toBe(`#${hex}`);
      expect(Number(attribute('fill-opacity'))).toBe(Number(painted[4]) / 100);
    }
  });

  it('keeps the colours apart from each other', () => {
    for (const theme of themes) {
      const painted = MARK_COLOURS.map(colour =>
        over(
          declaration(theme.rule(colour), 'background-color'),
          theme.background
        )
      );
      for (let i = 0; i < painted.length; i++) {
        for (let j = i + 1; j < painted.length; j++) {
          // Seven CIE Lab units is three times the just noticeable
          // difference, the room the faint alphas of ACC-NOTES-134 leave.
          expect(distance(painted[i], painted[j])).toBeGreaterThan(7);
        }
      }
    }
  });

  it('keeps the flash under reduced motion, and it ramps nothing but a colour', () => {
    // The flash is what tells the reader which passage the row they chose
    // belongs to, and a colour ramp is not motion - the same reading that
    // kept the removal ghost's opacity fade under this preference. Losing it
    // would leave a reduced-motion reader with a scroll and no locate signal.
    // Written against the class rather than against a media block, so it
    // catches the rule wherever a regression puts it back. The stylesheet
    // carries no reduced-motion block at all since DEF-CUE-68, and cue.spec
    // guards that; this guards the flash on its own terms.
    const guard = new RegExp(
      `\\.${FLASH_CLASS}[^{]*\\{[^}]*animation:\\s*none`
    );
    expect(guard.test(css)).toBe(false);
    const start = css.indexOf('@keyframes jp-AdvancedMd-mark-flash {');
    expect(start).toBeGreaterThan(-1);
    const frames = css.slice(start, css.indexOf('\n}', start));
    expect(frames.match(/^ {4}[a-z-]+:/gm)).toEqual(['    background-color:']);
  });

  it('flashes light enough to be seen away from where the eye already is', () => {
    // The eye finds a passage by lightness, not by hue. The keyframe sets
    // background-color on the mark span itself, so during the flash the
    // mark's own colour is REPLACED rather than covered: the flash composites
    // over the page, and what the reader perceives is the step between the
    // mark at rest and the flash, both taken over the same page. A mid grey
    // over a dark theme lands within a tenth of a percent of the yellow mark's
    // own lightness, which is a hue rotation nobody sees outside the point
    // they are already looking at - the one place the flash is not needed.
    for (const theme of themes) {
      const flashed = over(
        declaration(
          theme.name === 'dark' ? "body[data-jp-theme-light='false']" : ':root',
          '--jp-AdvancedMd-mark-flash-bg'
        ),
        theme.background
      );
      // Readable at the peak, on every theme.
      expect(contrast(flashed, theme.text)).toBeGreaterThan(4.5);
      for (const colour of MARK_COLOURS) {
        const marked = over(
          declaration(theme.rule(colour), 'background-color'),
          theme.background
        );
        expect(
          Math.abs(luminance(flashed) - luminance(marked))
        ).toBeGreaterThan(0.05);
      }
    }
  });

  it('sets nothing but a background and a transition on a mark', () => {
    const start = css.indexOf('\n.jp-AdvancedMd-mark {');
    const shared = css.slice(start, css.indexOf('}', start));
    expect(shared).toContain('transition: background-color');
    expect(shared.match(/^ {2}[a-z-]+:/gm)).toHaveLength(1);
    for (const theme of themes) {
      for (const colour of MARK_COLOURS) {
        const at = css.indexOf(`\n${theme.rule(colour)} {`);
        const body = css.slice(at, css.indexOf('}', at));
        expect(body).toContain('background-color: rgb(');
        expect(body.match(/^ {2}[a-z-]+:/gm)).toHaveLength(1);
      }
    }
  });
});

describe('the panel body', () => {
  it('shows a count that reads for one mark and for none', () => {
    const count = (): string =>
      panel.node.querySelector(`.${COUNT_CLASS}`)!.textContent ?? '';
    panel.setMarks([]);
    expect(count()).toBe('No marks');
    panel.setMarks([item('a', 'only one')]);
    expect(count()).toBe('1 mark');
    panel.setMarks([item('a', 'one'), item('b', 'two')]);
    expect(count()).toBe('2 marks');
  });

  it('drops a selection whose mark has gone', () => {
    panel.setMarks([item('a', 'first passage')]);
    renderMarks('a');
    panel.selectMark('a');
    expect(panel.selected).toBe('a');
    panel.setMarks([item('b', 'second passage')]);
    expect(panel.selected).toBeNull();
    expect(panel.node.querySelectorAll(`.${SELECTED_CLASS}`)).toHaveLength(0);
  });

  it('shows an entry without an author as its text alone', () => {
    panel.setMarks([
      item('a', 'first passage', {
        mark: mark('a', { notes: [note('', '', 'orphan line')] })
      })
    ]);
    const entry = panel.node.querySelector(`.${ENTRY_CLASS}`)!;
    expect(entry.textContent).toBe('orphan line');
  });
});
