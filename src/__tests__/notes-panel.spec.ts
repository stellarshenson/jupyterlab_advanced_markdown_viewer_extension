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
  openingState
} from '../notes-panel';
import { IMark, INoteEntry, MARK_COLOURS, MarkColour } from '../marks';

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
  setState: state => asked.push(`state ${state}`)
};

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
 * Click the button of a row whose label is `label`.
 */
function press(row: Element, label: string): void {
  const target = Array.from(
    row.querySelectorAll<HTMLButtonElement>(`.${BUTTON_CLASS}`)
  ).find(button => button.textContent === label);
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

  it('asks for the expanded state when the entry is opened from the minimap', () => {
    // A note entry exists only in the expanded state, so a reader who asked
    // for the entry asked for that state; a plain selection asks for nothing.
    panel.state = 'minimap';
    panel.selectMark('a');
    expect(asked).toEqual([]);
    panel.selectMark('a', true);
    expect(asked).toEqual(['state expanded']);
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

  it('drops the entry when the mark it belonged to is gone', () => {
    press(rows()[0], 'Add note');
    type('half a thought');
    panel.setMarks([item('b', 'another passage')]);
    expect(panel.node.querySelector('textarea')).toBeNull();

    // The mark comes back, and the note that was being written does not.
    panel.setMarks([item('a', 'first passage')]);
    expand(rows()[0]);
    expect(panel.node.querySelector('textarea')).toBeNull();
  });
});

describe('the controls of a row', () => {
  beforeEach(() => {
    panel.setMarks([item('a', 'first passage')]);
    expand(rows()[0]);
  });

  it('offers the four colours and asks for the one pressed', () => {
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
    press(rows()[0], 'Remove');
    expect(asked).toEqual(['remove a']);
  });

  it('names every button for assistive technology by its title', () => {
    press(rows()[0], 'Add note');
    const buttons = Array.from(panel.node.querySelectorAll('button'));
    // The close control, the toggle, Add note, the four dots, Remove, Save
    // and Cancel.
    expect(buttons).toHaveLength(10);
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

  for (const theme of themes) {
    for (const colour of MARK_COLOURS) {
      it(`keeps ${colour} readable under the ${theme.name} theme`, () => {
        const painted = over(
          declaration(theme.rule(colour), 'background-color'),
          theme.background
        );
        expect(contrast(painted, theme.text)).toBeGreaterThanOrEqual(4.5);
      });

      it(`keeps ${colour} apart from a change under the ${theme.name} theme`, () => {
        const painted = over(
          declaration(theme.rule(colour), 'background-color'),
          theme.background
        );
        for (const change of theme.changes) {
          expect(
            distance(painted, over(change, theme.background))
          ).toBeGreaterThan(20);
        }
      });
    }
  }

  it('keeps the four colours apart from each other', () => {
    for (const theme of themes) {
      const painted = MARK_COLOURS.map(colour =>
        over(
          declaration(theme.rule(colour), 'background-color'),
          theme.background
        )
      );
      for (let i = 0; i < painted.length; i++) {
        for (let j = i + 1; j < painted.length; j++) {
          expect(distance(painted[i], painted[j])).toBeGreaterThan(10);
        }
      }
    }
  });

  it('keeps the flash under reduced motion, and it ramps nothing but a colour', () => {
    // The flash is what tells the reader which passage the row they chose
    // belongs to, and a colour ramp is not motion - the same reading that
    // kept the removal ghost's opacity fade under this preference. Losing it
    // would leave a reduced-motion reader with a scroll and no locate signal.
    // Written against the class rather than against a media block, because a
    // rule put back as the second one inside the existing reduced-motion
    // block is the likely shape of the regression, and a match bounded by the
    // first closing brace would step straight over it.
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
