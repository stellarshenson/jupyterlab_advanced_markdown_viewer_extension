/**
 * The notes panel: what it lists, what it asks the controller to do, and how
 * it sits beside the preview.
 *
 * The panel is checked through its own DOM, because that is what the reader
 * uses, and the four mark colours are checked against the stylesheet the
 * package ships, because a colour that is unreadable or too close to the
 * colour of a change is a defect no DOM assertion would catch.
 */

import { MessageLoop } from '@lumino/messaging';
import { BoxLayout, BoxPanel, Widget } from '@lumino/widgets';

import {
  BUTTON_CLASS,
  CLOSE_CLASS,
  CLOSE_MARK_CLASS,
  COLLAPSE_CLASS,
  EXPAND_CLASS,
  REMOVE_CLASS,
  COUNT_CLASS,
  CONTROLS_CLASS,
  COLOUR_CLASS,
  COLOURS_CLASS,
  COLOUR_OPTION_CLASS,
  ENTRY_CLASS,
  ENTRY_ICON_CLASS,
  ENTRY_ICONS_CLASS,
  ENTRY_REPLY_CLASS,
  EXPANDED_CLASS,
  FORM_CLASS,
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
  ROW_CLOSED_CLASS,
  SHOW_CLOSED_CLASS,
  SELECTED_CLASS,
  STAMP_CLASS,
  STATE_CLASS,
  SWATCH_BUTTON_CLASS,
  SWATCH_CLASS,
  TEXT_CLASS,
  TICK_CLASS,
  TOGGLE_CLASS,
  colourClass,
  installNotesPanel,
  localeTag,
  openingState,
  BADGE_EMPTY_CLASS,
  ADD_CLASS
} from '../notes-panel';
import { IMark, INoteEntry, MARK_COLOURS, MarkColour } from '../marks';
import {
  CLOSE_MARK_ICON,
  MARK_ICONS,
  REOPEN_MARK_ICON,
  SWATCH_RADIUS,
  SWATCH_SIZE
} from '../icons';

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
    closed: false,
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

/** Every element scrolled into view, in order, and how each was asked. */
const scrolled: Element[] = [];
const scrolledWith: (ScrollIntoViewOptions | boolean | undefined)[] = [];

/** What the panel asked the controller to do, in order. */
let asked: string[] = [];

/** What the controller answers a note with: whether the markers were found. */
let noteWritten = true;

const handlers: INotesPanelHandlers = {
  addNote: async (id, text) => {
    asked.push(`note ${id} ${text}`);
    return noteWritten;
  },
  editNote: async (id, note, text) => {
    asked.push(`edit ${id} ${note.text} -> ${text}`);
    return noteWritten;
  },
  removeNote: (id, note) => asked.push(`remove note ${id} ${note.text}`),
  setColour: (id, colour) => asked.push(`colour ${id} ${colour}`),
  setClosed: (id, closed) => asked.push(`closed ${id} ${closed}`),
  setShowClosed: on => asked.push(`show closed ${on}`),
  removeMark: id => asked.push(`remove ${id}`),
  removeEmptyDocument: id => asked.push(`empty document ${id}`),
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
 * Open a row, which is what a click on its head does; a closed row carries no
 * triangle (ACC-NOTES-148).
 */
function expand(row: Element): void {
  row.querySelector<HTMLElement>(`.${HEAD_CLASS}`)!.click();
}

beforeAll(() => {
  // jsdom lays nothing out, so it implements no scrolling.
  Element.prototype.scrollIntoView = function (
    this: Element,
    how?: ScrollIntoViewOptions | boolean
  ) {
    scrolled.push(this);
    scrolledWith.push(how);
  };
});

beforeEach(() => {
  jest.useFakeTimers();
  scrolled.length = 0;
  scrolledWith.length = 0;
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

describe('closed marks (ACC-NOTES-155)', () => {
  const control = (): HTMLButtonElement =>
    panel.node.querySelector<HTMLButtonElement>(`.${SHOW_CLOSED_CLASS}`)!;

  beforeEach(() => {
    panel.setMarks([
      item('a', 'first passage'),
      item('b', 'second passage', { mark: mark('b', { closed: true }) })
    ]);
  });

  it('lists no closed mark and ticks none, and offers to show the closed ones with their count', () => {
    expect(passages()).toEqual(['first passage']);
    expect(panel.node.querySelector(`.${COUNT_CLASS}`)!.textContent).toBe(
      '1 mark'
    );
    expect(control().hidden).toBe(false);
    expect(control().textContent).toBe('Show hidden (1)');
    expect(control().getAttribute('aria-pressed')).toBe('false');
    panel.state = 'minimap';
    expect(ticks()).toHaveLength(1);
  });

  it('hides the control while no mark is closed', () => {
    panel.setMarks([item('a', 'first passage')]);
    expect(control().hidden).toBe(true);
  });

  it('asks the controller to show the closed marks, then lists them dimmed with Reopen', () => {
    control().click();
    expect(asked).toEqual(['show closed true']);
    panel.showClosed = true;
    expect(passages()).toEqual(['first passage', 'second passage']);
    expect(rows()[1].classList.contains(ROW_CLOSED_CLASS)).toBe(true);
    expect(rows()[1].querySelector(`.${STATE_CLASS}`)!.textContent).toBe(
      'closed'
    );
    // One set of words in both states; the pressed state says which is on.
    expect(control().textContent).toBe('Show hidden (1)');
    expect(control().getAttribute('aria-pressed')).toBe('true');
    panel.state = 'minimap';
    expect(ticks()).toHaveLength(2);
    panel.state = 'expanded';
    panel.selectMark('b');
    press(rows()[1], 'Reopen this mark');
    expect(asked).toEqual(['show closed true', 'closed b false']);
  });

  it('draws Close as a crossed eye and Reopen as an open eye, titled and without text (ACC-NOTES-172)', () => {
    panel.showClosed = true;
    panel.selectMark('a');
    panel.selectMark('b');
    const eyes = rows().map(row =>
      row.querySelector<HTMLButtonElement>(`.${CLOSE_MARK_CLASS}`)!
    );
    expect(eyes.map(eye => eye.title)).toEqual([
      'Close this mark',
      'Reopen this mark'
    ]);
    expect(eyes.map(eye => eye.textContent)).toEqual(['', '']);
    // The crossed eye carries the stroke across it; the open eye does not.
    expect(eyes.map(eye => eye.querySelector('svg')!.dataset.icon)).toEqual([
      CLOSE_MARK_ICON.name,
      REOPEN_MARK_ICON.name
    ]);
    expect(CLOSE_MARK_ICON.svgstr).not.toBe(REOPEN_MARK_ICON.svgstr);
    // After Comment, before the removal control.
    const controls = Array.from(
      rows()[0].querySelector(`.${CONTROLS_CLASS}`)!.children
    ).map(child => child.className);
    expect(controls.indexOf(`${BUTTON_CLASS} ${CLOSE_MARK_CLASS}`)).toBe(
      controls.length - 2
    );
    expect(controls[controls.length - 1]).toBe(
      `${BUTTON_CLASS} ${REMOVE_CLASS}`
    );
  });

  it('offers Close on an open row, which asks the controller to close the mark', () => {
    panel.selectMark('a');
    press(rows()[0], 'Close this mark');
    expect(asked).toEqual(['closed a true']);
  });

  it('releases a draft held on a row that was closed and hidden', () => {
    panel.setMarks([item('a', 'first passage'), item('b', 'second passage')]);
    panel.selectMark('a');
    press(rows()[0], 'Comment');
    const draft = panel.node.querySelector('textarea')!;
    draft.value = 'a draft on a';
    draft.dispatchEvent(new Event('input'));
    // The controller closed a: its row is gone, the draft with it.
    panel.setMarks([
      item('a', 'first passage', { mark: mark('a', { closed: true }) }),
      item('b', 'second passage')
    ]);
    panel.selectMark('b');
    press(rows()[0], 'Comment');
    const fields = panel.node.querySelectorAll('textarea');
    expect(fields).toHaveLength(1);
    expect(rows()[0].contains(fields[0])).toBe(true);
    expect(fields[0].value).toBe('');
  });

  it('asks to show the closed marks when the row asked for belongs to a closed mark', async () => {
    panel.setMarks([
      item('a', 'first passage'),
      item('d', '', {
        mark: mark('d', {
          type: 'document',
          close: null,
          passage: null,
          closed: true
        })
      })
    ]);
    documentId = 'd';
    panel.node.querySelector<HTMLButtonElement>(`.${ADD_CLASS}`)!.click();
    await settle();
    expect(asked).toEqual(['document', 'show closed true']);
    // The sync that follows the controller's switch lists the row, with the
    // entry already opened on it.
    panel.showClosed = true;
    const field = panel.node.querySelector('textarea')!;
    expect(field).not.toBeNull();
    expect(field.closest<HTMLElement>(`.${ROW_CLASS}`)!.dataset.mark).toBe('d');
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

  it('shows no note while it is closed (ACC-NOTES-150)', () => {
    expect(texts(rows()[0])).toEqual([]);
    expect(rows()[0].querySelector(`.${ENTRY_CLASS}`)).toBeNull();
    expect(rows()[0].querySelector(`.${CONTROLS_CLASS}`)).toBeNull();
  });

  it('shows every entry in full once it is open', () => {
    expand(rows()[0]);
    expect(texts(rows()[0])).toEqual(['first line\nsecond line', 'a reply']);
  });

  it('reads the first entry as the comment and the rest as replies, indented (ACC-NOTES-171)', () => {
    expand(rows()[0]);
    expand(rows()[1]);
    const entries = (row: Element) =>
      Array.from(row.querySelectorAll(`.${ENTRY_CLASS}`)).map(entry =>
        entry.classList.contains(ENTRY_REPLY_CLASS)
      );
    expect(entries(rows()[0])).toEqual([false, true]);
    expect(entries(rows()[1])).toEqual([false]);
    // Reply on a row that holds a comment; Comment on a bare mark.
    expect(press(rows()[0], 'Reply')).toBeUndefined();
    expect(panel.node.querySelector('textarea')).not.toBeNull();
    panel.setMarks([item('c', 'bare')]);
    expand(rows()[0]);
    expect(
      Array.from(rows()[0].querySelectorAll('button')).map(b => b.textContent)
    ).toContain('Comment');
    expect(
      Array.from(rows()[0].querySelectorAll('button')).map(b => b.textContent)
    ).not.toContain('Reply');
    // The indent is drawn by the stylesheet.
    expect(
      /\.jp-AdvancedMd-notesEntry-reply \{[^}]*margin-left: 8px;/.test(
        readCss()
      )
    ).toBe(true);
  });

  it('carries an edit icon and an x in the corner of every entry, which open the entry for editing and delete it (ACC-NOTES-164, ACC-NOTES-167)', () => {
    expand(rows()[0]);
    const icons = (row: Element) =>
      Array.from(
        row.querySelectorAll<HTMLButtonElement>(`.${ENTRY_ICON_CLASS}`)
      );
    expect(icons(rows()[0]).map(icon => icon.title)).toEqual([
      'Edit this note',
      'Delete this note',
      'Edit this note',
      'Delete this note'
    ]);
    expect(icons(rows()[0]).map(icon => icon.textContent)).toEqual([
      '',
      '',
      '',
      ''
    ]);
    // The corner container is the entry's first child, floated by the
    // stylesheet to the right of its first line.
    expect(
      rows()[0].querySelector(`.${ENTRY_CLASS}`)!.firstElementChild!.className
    ).toBe(ENTRY_ICONS_CLASS);
    expect(
      /\.jp-AdvancedMd-notesEntryIcons \{[^}]*float: right;/.test(readCss())
    ).toBe(true);

    // The x deletes at once, no confirmation, and asks nothing else.
    icons(rows()[0])[3].click();
    expect(asked).toEqual(['remove note a a reply']);

    // The edit icon opens the field in the entry's place, prefilled whole.
    icons(rows()[0])[0].click();
    const field = rows()[0].querySelector<HTMLTextAreaElement>('textarea')!;
    expect(field.value).toBe('first line\nsecond line');
    expect(document.activeElement).toBe(field);
    expect(texts(rows()[0])).toEqual(['a reply']);
    // The form stands where the first entry stood: before the reply, and
    // drawn as the comment, not indented.
    const form = rows()[0].querySelector(`.${FORM_CLASS}`)!;
    expect(form.nextElementSibling!.classList.contains(ENTRY_CLASS)).toBe(true);
    expect(form.classList.contains(ENTRY_REPLY_CLASS)).toBe(false);

    // The field of a reply keeps the reply's indent while it is open.
    press(rows()[0], 'Cancel');
    icons(rows()[0])[2].click();
    expect(
      rows()[0]
        .querySelector(`.${FORM_CLASS}`)!
        .classList.contains(ENTRY_REPLY_CLASS)
    ).toBe(true);
  });

  it('saves an edit through editNote, keeping the entry, and drops an empty edit without asking (ACC-NOTES-164)', async () => {
    expand(rows()[0]);
    const edit = () =>
      rows()[0].querySelector<HTMLButtonElement>(`.${ENTRY_ICON_CLASS}`)!;
    edit().click();
    const field = rows()[0].querySelector<HTMLTextAreaElement>('textarea')!;
    field.value = 'first line, revised\nsecond line';
    field.dispatchEvent(new Event('input'));
    press(rows()[0], 'Save');
    expect(asked).toEqual([
      'edit a first line\nsecond line -> first line, revised\nsecond line'
    ]);
    await Promise.resolve();
    expect(panel.node.querySelector('textarea')).toBeNull();

    // Cleared and saved: nothing is asked and the field goes.
    asked = [];
    edit().click();
    const again = rows()[0].querySelector<HTMLTextAreaElement>('textarea')!;
    again.value = '   ';
    again.dispatchEvent(new Event('input'));
    press(rows()[0], 'Save');
    expect(asked).toEqual([]);
    expect(panel.node.querySelector('textarea')).toBeNull();
    expect(texts(rows()[0])).toEqual(['first line\nsecond line', 'a reply']);
  });

  it('closes an edit whose entry left the marker meanwhile (ACC-NOTES-164)', async () => {
    expand(rows()[0]);
    rows()[0].querySelector<HTMLButtonElement>(`.${ENTRY_ICON_CLASS}`)!.click();
    // Another writer rewrote the entry: the field has no place in the
    // thread and sits below the controls, where Cancel still reaches it.
    panel.setMarks([
      item('a', 'first passage', {
        mark: mark('a', {
          notes: [note('kj', '2026-09-06T16:00:00Z', 'rewritten'), thread[1]]
        })
      })
    ]);
    const form = rows()[0].querySelector(`.${FORM_CLASS}`)!;
    expect(
      form.previousElementSibling!.classList.contains(CONTROLS_CLASS)
    ).toBe(true);
    expect(texts(rows()[0])).toEqual(['rewritten', 'a reply']);
    noteWritten = false;
    press(rows()[0], 'Save');
    expect(asked).toEqual([
      'edit a first line\nsecond line -> first line\nsecond line'
    ]);
    await Promise.resolve();
    expect(panel.node.querySelector('textarea')).toBeNull();
  });

  it('leaves the marker of a document note alone when an edit of its last entry is left after the entry vanished (ACC-NOTES-164)', async () => {
    const noted = () =>
      item('d', '', {
        mark: mark('d', {
          type: 'document',
          close: null,
          passage: null,
          notes: [note('kj', '2026-09-06T16:00:00Z', 'the only entry')]
        })
      });
    const edit = () => {
      const icon = () =>
        rows()[0].querySelector<HTMLButtonElement>(`.${ENTRY_ICON_CLASS}`);
      if (!icon()) {
        expand(rows()[0]);
      }
      icon()!.click();
    };
    panel.setMarks([noted()]);
    edit();
    // An external rewrite dropped the entry: the mark is bare and open.
    panel.setMarks([documentItem('d')]);
    press(rows()[0], 'Cancel');
    expect(asked).toEqual([]);
    expect(panel.node.querySelector('textarea')).toBeNull();

    // The same through an empty Save.
    panel.setMarks([noted()]);
    edit();
    panel.setMarks([documentItem('d')]);
    const field = rows()[0].querySelector<HTMLTextAreaElement>('textarea')!;
    field.value = '';
    field.dispatchEvent(new Event('input'));
    press(rows()[0], 'Save');
    expect(asked).toEqual([]);
    expect(panel.node.querySelector('textarea')).toBeNull();
  });

  it('withholds the icons of the other entries, Comment and Close while the row is being written (ACC-NOTES-166, ACC-NOTES-168)', () => {
    expand(rows()[0]);
    expand(rows()[1]);
    const icons = (row: Element) =>
      row.querySelectorAll(`.${ENTRY_ICON_CLASS}`).length;
    const labelled = (row: Element, title: string) =>
      row.querySelector(`button[title="${title}"]`) !== null;
    expect(icons(rows()[0])).toBe(4);
    expect(labelled(rows()[0], 'Close this mark')).toBe(true);

    // Editing the first entry: the reply offers no icon, the row no Reply
    // and no Close; the dots and the removal stay; the other row is as it was.
    rows()[0].querySelector<HTMLButtonElement>(`.${ENTRY_ICON_CLASS}`)!.click();
    expect(icons(rows()[0])).toBe(0);
    expect(labelled(rows()[0], 'Reply to this comment')).toBe(false);
    expect(labelled(rows()[0], 'Close this mark')).toBe(false);
    expect(rows()[0].querySelectorAll(`.${SWATCH_BUTTON_CLASS}`)).toHaveLength(
      1
    );
    expect(labelled(rows()[0], 'Remove this mark')).toBe(true);
    expect(icons(rows()[1])).toBe(2);
    expect(labelled(rows()[1], 'Close this mark')).toBe(true);

    // Cancel: everything is back.
    press(rows()[0], 'Cancel');
    expect(icons(rows()[0])).toBe(4);
    expect(labelled(rows()[0], 'Reply to this comment')).toBe(true);
    expect(labelled(rows()[0], 'Close this mark')).toBe(true);

    // A new reply withholds the same; a closed row withholds Reopen.
    press(rows()[0], 'Reply');
    expect(icons(rows()[0])).toBe(0);
    expect(labelled(rows()[0], 'Close this mark')).toBe(false);
    press(rows()[0], 'Cancel');
    panel.showClosed = true;
    panel.setMarks([
      item('a', 'first passage', {
        mark: mark('a', { notes: thread, closed: true })
      })
    ]);
    expand(rows()[0]);
    expect(labelled(rows()[0], 'Reopen this mark')).toBe(true);
    press(rows()[0], 'Reply');
    expect(labelled(rows()[0], 'Reopen this mark')).toBe(false);
  });

  it('opens and closes independently of the other rows', () => {
    expand(rows()[0]);
    expect(texts(rows()[0])).toHaveLength(2);
    expect(texts(rows()[1])).toEqual([]);
    rows()[0].querySelector<HTMLButtonElement>(`.${TOGGLE_CLASS}`)!.click();
    expect(texts(rows()[0])).toEqual([]);
  });

  it('shows the triangle on an open row alone, and opens a row from a click or Enter on it', () => {
    const triangle = (row: Element): HTMLButtonElement | null =>
      row.querySelector<HTMLButtonElement>(`.${TOGGLE_CLASS}`);
    // A closed row opens from a click on it, so it carries no triangle.
    expect(triangle(rows()[0])).toBeNull();
    rows()[0].querySelector<HTMLElement>(`.${HEAD_CLASS}`)!.click();
    expect(rows()[0].querySelector(`.${CONTROLS_CLASS}`)).not.toBeNull();
    expect(triangle(rows()[0])!.title).toBe('Collapse');
    expect(triangle(rows()[1])).toBeNull();

    triangle(rows()[0])!.click();
    expect(rows()[0].querySelector(`.${CONTROLS_CLASS}`)).toBeNull();
    expect(triangle(rows()[0])).toBeNull();

    rows()[1].dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })
    );
    expect(rows()[1].querySelector(`.${CONTROLS_CLASS}`)).not.toBeNull();

    panel.setMarks([item('c', '', { anchored: false })]);
    rows()[0].querySelector<HTMLElement>(`.${STATE_CLASS}`)!.click();
    expect(rows()[0].querySelector(`.${CONTROLS_CLASS}`)).not.toBeNull();
  });

  it('selects a row from a click on one of its notes (DEF-NOTES-76)', () => {
    // Only an open row shows its notes (ACC-NOTES-150), so the row is opened
    // and the selection then moved to another row.
    expand(rows()[1]);
    expand(rows()[0]);
    expect(panel.selected).toBe('a');
    rows()[1].querySelector<HTMLElement>(`.${TEXT_CLASS}`)!.click();
    expect(panel.selected).toBe('b');
    expect(rows()[1].querySelector(`.${CONTROLS_CLASS}`)).not.toBeNull();
  });

  it('leaves a row alone when a click ends a selection of its note text', () => {
    expand(rows()[1]);
    expand(rows()[0]);
    // This test environment's Range cannot select contents, so the selection
    // a drag over the note leaves is given directly.
    const selection = jest
      .spyOn(window, 'getSelection')
      .mockReturnValue({ isCollapsed: false } as Selection);
    rows()[1].querySelector<HTMLElement>(`.${TEXT_CLASS}`)!.click();
    // A drag from one note to another ends in a click on the row itself.
    rows()[1].click();
    selection.mockRestore();
    expect(panel.selected).toBe('a');
  });

  it('selects and opens a row from a click on its padding or the gap above a note (DEF-NOTES-80)', () => {
    // The padding, and on an open row the margin above a note line, belong
    // to no part of the row, so a click there has the row itself as its
    // target.
    rows()[1].click();
    expect(panel.selected).toBe('b');
    expect(rows()[1].querySelector(`.${CONTROLS_CLASS}`)).not.toBeNull();
    // On the open row the same click keeps it open and selected.
    rows()[1].click();
    expect(panel.selected).toBe('b');
    expect(rows()[1].querySelector(`.${CONTROLS_CLASS}`)).not.toBeNull();
  });

  it('carries the stamp as local time on a 24-hour clock, and the file value in its title (ACC-NOTES-175)', () => {
    expand(rows()[0]);
    const stamp = rows()[0].querySelector(`.${STAMP_CLASS}`)!;
    expect(stamp.getAttribute('title')).toBe('2026-09-06T16:00:00Z');
    expect(stamp.textContent).toBe(
      new Date('2026-09-06T16:00:00Z').toLocaleString(undefined, {
        hourCycle: 'h23'
      })
    );
    // No lab language reaches this panel, so the reader's browser chooses the
    // words and the order of the date; the clock is 24-hour either way.
    expect(stamp.textContent).not.toMatch(/\b[AP]M\b/i);
    expect(stamp.textContent).toMatch(/\d{1,2}:\d{2}/);
  });

  it('writes the stamp in the language the lab is set to, on a 24-hour clock (ACC-NOTES-175)', () => {
    // JupyterLab writes the code with an underscore where a language tag has
    // a hyphen, and Intl throws on the underscore form. The language is one
    // that reads the clock in AM and PM, so the 24-hour rule is what the
    // assertion below rests on.
    const american = new NotesPanel({
      root: () => root,
      handlers,
      state: 'expanded',
      locale: 'en_US'
    });
    Widget.attach(american, document.body);
    american.setMarks([
      item('a', 'first passage', {
        mark: mark('a', {
          notes: [note('kj', '2026-09-06T16:00:00Z', 'the only entry')]
        })
      })
    ]);
    // Opening the row rebuilds the body, so the row is read again after it.
    const row = (): HTMLElement =>
      american.node.querySelector<HTMLElement>(`.${ROW_CLASS}`)!;
    expand(row());
    const written = row().querySelector(`.${STAMP_CLASS}`)!.textContent;
    expect(written).toBe(
      new Date('2026-09-06T16:00:00Z').toLocaleString('en-US', {
        hourCycle: 'h23'
      })
    );
    expect(written).not.toMatch(/\b[AP]M\b/i);
    // The conversion is asserted directly as well: where the environment's
    // own default is en-US, which is the shape CI runs in, the rendered value
    // alone cannot tell a converted tag from a dropped one.
    expect(localeTag('en_US')).toBe('en-US');
    expect(localeTag('pl_PL')).toBe('pl-PL');
    // A code Intl has no data for leaves the language to the browser.
    expect(localeTag('zz_ZZ')).toBeUndefined();
    expect(localeTag('')).toBeUndefined();
    american.dispose();
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
    // A closed row carries no control to say that it opens (ACC-NOTES-148),
    // so its description says how, read from a hidden element that is not a
    // line of the page.
    const description = (row: Element): string | null => {
      const hint = panel.node.querySelector<HTMLElement>(
        `[id="${row.getAttribute('aria-describedby')}"]`
      );
      return hint?.hidden ? hint.textContent : null;
    };
    expect(rows().map(description)).toEqual([
      'Closed. Press Enter to open.',
      'Closed. Press Enter to open.'
    ]);

    panel.selectMark('b');
    expect(rows().map(row => row.getAttribute('aria-current'))).toEqual([
      null,
      'true'
    ]);
    expect(rows().map(description)).toEqual([
      'Closed. Press Enter to open.',
      'Open. The Collapse button closes it.'
    ]);
    // Two previews of one file list the same marks; each panel's hints carry
    // ids of their own, since an id is unique in the page.
    const other = new NotesPanel({
      root: () => root,
      handlers,
      state: 'expanded'
    });
    other.setMarks([item('a', 'first passage')]);
    expect(
      other.node
        .querySelector(`.${ROW_CLASS}`)!
        .getAttribute('aria-describedby')
    ).not.toBe(rows()[0].getAttribute('aria-describedby'));
    other.dispose();

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
    // Its swatch shows the colour and offers no list (ACC-NOTES-173).
    expect(rows()[0].querySelector(`.${SWATCH_CLASS}`)).not.toBeNull();
    expect(rows()[0].querySelector(`.${SWATCH_BUTTON_CLASS}`)).toBeNull();
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
    // took every Enter that bubbled up would take the one that closes a row
    // and the one that ends a line of a note. Only an open row has the
    // triangle, so the row is opened first and the scroll it made forgotten.
    rows()[1].querySelector<HTMLElement>(`.${HEAD_CLASS}`)!.click();
    scrolled.length = 0;
    const toggle = rows()[1].querySelector<HTMLElement>(`.${TOGGLE_CLASS}`)!;
    toggle.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })
    );
    expect(scrolled).toEqual([]);
  });

  it('selects nothing from a click on the controls row or the note field of an open row', () => {
    rows()[1].querySelector<HTMLElement>(`.${HEAD_CLASS}`)!.click();
    panel.selectMark('a');
    scrolled.length = 0;
    // The first click of a double click on Add note takes Add note out of the
    // row (DEF-NOTES-77), so the second lands on the controls row itself.
    press(rows()[1], 'Comment');
    rows()[1].querySelector<HTMLElement>(`.${CONTROLS_CLASS}`)!.click();
    rows()[1].querySelector('textarea')!.click();
    expect(panel.selected).toBe('a');
    // The field is scrolled into the panel's view (ACC-NOTES-169), nothing
    // in the preview is.
    expect(scrolled).toEqual([panel.node.querySelector(`.${FORM_CLASS}`)]);
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
    // selection there: the reader is at the passage, so nothing in the
    // preview scrolls; the field is brought into the panel's own view.
    panel.selectMark('a', true);
    expect(scrolled).toEqual([panel.node.querySelector(`.${FORM_CLASS}`)]);
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
    expect(scrolled).toEqual([
      panel.node.querySelector(`.${FORM_CLASS}`),
      span
    ]);
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

  it('opens the row alone from a click on a passage whose mark holds a note (ACC-NOTES-153)', () => {
    panel.setMarks([
      item('a', 'first passage', {
        mark: mark('a', { notes: [note('kj', '2026-09-11', 'already said')] })
      })
    ]);
    panel.openFromPassage('a');
    // The row is open with its note and takes the focus, which is what
    // brings it into the list's view; no field is on screen and Reply is
    // offered; the passage, where the reader was, is not scrolled to.
    expect(panel.selected).toBe('a');
    expect(rows()[0].textContent).toContain('already said');
    expect(document.activeElement).toBe(rows()[0]);
    expect(panel.node.querySelector('textarea')).toBeNull();
    expect(
      Array.from(rows()[0].querySelectorAll('button')).map(b => b.textContent)
    ).toContain('Reply');
    expect(scrolled).toEqual([]);
  });

  it('opens the note entry from a click on a bare mark (ACC-NOTES-153)', () => {
    panel.openFromPassage('a');
    expect(panel.node.querySelector('textarea')).not.toBeNull();
    expect(scrolled).toEqual([panel.node.querySelector(`.${FORM_CLASS}`)]);
  });

  it('scrolls the field it opened into the panel by the least distance, focused, and a rebuild it was not asked for by nothing (ACC-NOTES-169)', () => {
    rows()[1].querySelector<HTMLElement>(`.${HEAD_CLASS}`)!.click();
    scrolled.length = 0;
    scrolledWith.length = 0;
    press(rows()[1], 'Comment');
    const form = panel.node.querySelector(`.${FORM_CLASS}`)!;
    expect(scrolled).toEqual([form]);
    expect(scrolledWith).toEqual([{ block: 'nearest' }]);
    expect(document.activeElement).toBe(form.querySelector('textarea'));
    // A change from disk rebuilds the rows with the field kept: the reader
    // is in it already, and the panel moves by nothing.
    scrolled.length = 0;
    panel.setMarks([item('a', 'first passage'), item('b', 'second passage')]);
    expect(panel.node.querySelector('textarea')).not.toBeNull();
    expect(scrolled).toEqual([]);
  });

  it('asks for the expanded state from a click on a passage in the minimap', () => {
    panel.state = 'minimap';
    panel.setMarks([
      item('a', 'first passage', {
        mark: mark('a', { notes: [note('kj', '2026-09-11', 'already said')] })
      })
    ]);
    panel.openFromPassage('a');
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
    press(rows()[0], 'Comment');
    expect(
      panel.node.querySelector('textarea')!.getAttribute('aria-label')
    ).toBe('Note');
  });

  it('keeps the browser menu inside the note field (ACC-NOTES-157)', () => {
    press(rows()[0], 'Comment');
    const field = panel.node.querySelector('textarea')!;
    expect(field.closest('[data-jp-suppress-context-menu]')).not.toBeNull();
  });

  it('lays the entry out as a wide box with its two buttons in a row below', () => {
    press(rows()[0], 'Comment');
    const form = panel.node.querySelector('.jp-AdvancedMd-notesForm')!;
    const box = form.querySelector('textarea')!;
    // Several lines are visible, and the buttons sit in their own row after
    // the box rather than beside it, so the box keeps the panel's width.
    expect(box.rows).toBe(4);
    const buttons = box.nextElementSibling!;
    expect(buttons.className).toBe('jp-AdvancedMd-notesFormButtons');
    // Cancel first and Save last at the right edge, both in the look of the
    // other panel buttons; the box names what it is for while it is empty.
    expect(
      Array.from(buttons.querySelectorAll('button')).map(b => b.textContent)
    ).toEqual(['Cancel', 'Save']);
    expect(
      Array.from(buttons.querySelectorAll('button')).map(b => b.className)
    ).toEqual(['jp-AdvancedMd-notesButton', 'jp-AdvancedMd-notesButton']);
    expect(box.placeholder).toBe('Write a note');
    expect(form.querySelectorAll('button')).toHaveLength(2);
  });

  // jsdom lays nothing out, so the measurements the box grows by are given.
  const measure = (box: HTMLTextAreaElement, scroll: number): void => {
    Object.defineProperty(box, 'scrollHeight', {
      configurable: true,
      get: () => scroll
    });
    Object.defineProperty(box, 'offsetHeight', {
      configurable: true,
      get: () => 82
    });
    Object.defineProperty(box, 'clientHeight', {
      configurable: true,
      get: () => 80
    });
  };

  it('grows the box to what its content needs as the note is typed (ACC-NOTES-152)', () => {
    press(rows()[0], 'Comment');
    const box = panel.node.querySelector('textarea')!;
    const heights: string[] = [];
    // The inline height is cleared before the measurement, so the rows set
    // the floor and a box shrinks back when lines are deleted.
    Object.defineProperty(box.style, 'height', {
      configurable: true,
      get: () => heights[heights.length - 1] ?? '',
      set: (value: string) => {
        heights.push(value);
      }
    });
    measure(box, 80);
    type('one line');
    expect(heights).toEqual(['', '82px']);
    measure(box, 150);
    type('one line\nand six\nmore\nlines\nof\na\nnote');
    expect(heights.slice(2)).toEqual(['', '152px']);
  });

  it('opens a restored draft at the height its lines need (ACC-NOTES-152)', async () => {
    press(rows()[0], 'Comment');
    type('a draft\nof\nfive\nlines\nhere');
    // The rows become ticks and rows again: the form is built anew with the
    // draft, off the document, and measured once it is in it.
    panel.state = 'minimap';
    panel.state = 'expanded';
    const box = panel.node.querySelector('textarea')!;
    expect(box.value).toBe('a draft\nof\nfive\nlines\nhere');
    measure(box, 120);
    await Promise.resolve();
    expect(box.style.height).toBe('122px');
  });

  it('leaves a box that is not laid out alone and measures it when the panel is shown (ACC-NOTES-152)', async () => {
    press(rows()[0], 'Comment');
    type('a draft\nof\nfive\nlines\nhere');
    panel.state = 'minimap';
    panel.state = 'expanded';
    const box = panel.node.querySelector('textarea')!;
    // Every metric reads 0 in a hidden tab, as it does here; a height of 0
    // written from that would collapse the box over the draft.
    await Promise.resolve();
    expect(box.style.height).toBe('');
    measure(box, 120);
    MessageLoop.sendMessage(panel, Widget.Msg.AfterShow);
    expect(box.style.height).toBe('122px');
  });

  it('writes what was typed', async () => {
    press(rows()[0], 'Comment');
    type('needs a number');
    press(rows()[0], 'Save');
    expect(asked).toEqual(['note a needs a number']);
    await Promise.resolve();
    expect(panel.node.querySelector('textarea')).toBeNull();
  });

  it('keeps the draft when the note could not be written', async () => {
    noteWritten = false;
    press(rows()[0], 'Comment');
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

  it('keeps the reader in the panel when the state changes while the colours are rolled down (ACC-NOTES-173)', () => {
    rows()[0]
      .querySelector<HTMLButtonElement>(`.${SWATCH_BUTTON_CLASS}`)!
      .click();
    // The reader stands in the list, which the state change takes away with
    // the rows; taking it away any earlier would drop them on the page body.
    expect(document.activeElement).toBe(
      rows()[0].querySelector(`.${COLOUR_OPTION_CLASS}`)
    );
    panel.state = 'minimap';
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
    press(rows()[0], 'Comment');
    type('half a thought');
    panel.node.querySelector('textarea')!.focus();
    panel.state = 'hidden';
    expect(document.activeElement).toBe(viewer);
    viewer.remove();
  });

  it('moves the focus to the panel body when the rows become ticks while a note is typed', () => {
    press(rows()[0], 'Comment');
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
    press(rows()[0], 'Comment');
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
    expect(row.querySelector(`.${COLOUR_CLASS}`)).toBeNull();
    expect(row.querySelector(`.${REMOVE_CLASS}`)).not.toBeNull();
    expect(
      Array.from(row.querySelectorAll('button')).some(
        control => control.textContent === 'Comment'
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
    // After the count and the Show closed control, before the expand and
    // the hide controls.
    const header = control.parentElement!;
    expect(header.children[1]).toBe(
      panel.node.querySelector(`.${COUNT_CLASS}`)
    );
    expect(header.children[2]).toBe(
      panel.node.querySelector(`.${SHOW_CLOSED_CLASS}`)
    );
    expect(header.children[3]).toBe(control);
    expect(header.children[4]).toBe(
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

  it('opens the document note the file holds from the plus control', async () => {
    // The file holds the document mark: the controller answers its id and
    // writes nothing; the entry opens on the row already listed.
    panel.setMarks([documentItem('d'), item('a', 'first passage')]);
    documentId = 'd';
    const control = panel.node.querySelector<HTMLButtonElement>(
      `.${ADD_CLASS}`
    )!;
    control.click();
    await settle();

    expect(asked).toEqual(['document']);
    expect(rows()).toHaveLength(2);
    expect(rows()[0].querySelector('textarea')).not.toBeNull();
  });

  it('keeps a draft typed on another row when the plus opens the document row', async () => {
    // The plus beside a half-written note must not discard it: the document
    // row opens and is selected, the draft stays in its own row's field.
    panel.setMarks([documentItem('d'), item('a', 'first passage')]);
    press(rows()[1], 'Comment');
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
        control => control.textContent === 'Comment'
      )
    ).toBe(true);
  });

  it('lands a blocked press in the draft, its collapsed row opened', () => {
    // The reader collapsed the row holding a half-written note; a press on
    // Add note elsewhere neither discards it nor does nothing: the draft's
    // row opens and its field takes the focus.
    panel.setMarks([item('a', 'first passage'), item('b', 'second passage')]);
    press(rows()[0], 'Comment');
    type('half a thought');
    (rows()[0].querySelector(`.${TOGGLE_CLASS}`) as HTMLButtonElement).click();
    expect(panel.node.querySelector('textarea')).toBeNull();
    panel.selectMark('b');
    press(rows()[1], 'Comment');

    const field = panel.node.querySelector<HTMLTextAreaElement>('textarea')!;
    expect(field.closest<HTMLElement>(`.${ROW_CLASS}`)!.dataset.mark).toBe('a');
    expect(field.value).toBe('half a thought');
    expect(document.activeElement).toBe(field);
  });

  it('opens the asked row when the field elsewhere holds only whitespace', () => {
    // Save reads a whitespace-only field as nothing; a press on Add note
    // elsewhere reads it the same way, so the field opens on the asked row.
    panel.setMarks([item('a', 'first passage'), item('b', 'second passage')]);
    press(rows()[0], 'Comment');
    type('\n  ');
    panel.selectMark('b');
    press(rows()[1], 'Comment');

    const field = panel.node.querySelector<HTMLTextAreaElement>('textarea')!;
    expect(field.closest<HTMLElement>(`.${ROW_CLASS}`)!.dataset.mark).toBe('b');
    expect(field.value).toBe('');
    expect(document.activeElement).toBe(field);
  });

  it('keeps a draft on one row when Add note is pressed on another', () => {
    panel.setMarks([item('a', 'first passage'), item('b', 'second passage')]);
    press(rows()[0], 'Comment');
    type('half a thought');
    panel.selectMark('b');
    press(rows()[1], 'Comment');

    const field = panel.node.querySelector<HTMLTextAreaElement>('textarea')!;
    expect(field.closest<HTMLElement>(`.${ROW_CLASS}`)!.dataset.mark).toBe('a');
    expect(field.value).toBe('half a thought');
  });

  describe('a field left empty (ACC-NOTES-159)', () => {
    /** A control outside the panel, where a click away lands. */
    let away: HTMLButtonElement;

    beforeEach(() => {
      away = document.createElement('button');
      document.body.appendChild(away);
    });

    afterEach(() => {
      away.remove();
    });

    it('cancels the entry when the reader leaves the panel, the mark left as it is', async () => {
      press(rows()[0], 'Comment');
      expect(document.activeElement).toBe(panel.node.querySelector('textarea'));

      away.focus();
      await settle();

      // Nothing written and nothing removed: the mark keeps its row, and the
      // row offers the note again.
      expect(panel.node.querySelector('textarea')).toBeNull();
      expect(asked).toEqual([]);
      expect(passages()).toEqual(['first passage']);
      expect(
        Array.from(rows()[0].querySelectorAll('button')).some(
          control => control.textContent === 'Comment'
        )
      ).toBe(true);
    });

    it('cancels the entry when the reader leaves the panel from a control of its row', async () => {
      // The swatch sits above the field, so a colour picked with the field
      // open leaves the focus on the row rather than in the field; the click
      // away that follows is still the reader leaving the entry.
      press(rows()[0], 'Comment');
      rows()[0]
        .querySelector<HTMLButtonElement>(`.${SWATCH_BUTTON_CLASS}`)!
        .focus();
      expect(panel.node.querySelector('textarea')).not.toBeNull();

      away.focus();
      await settle();

      expect(panel.node.querySelector('textarea')).toBeNull();
      expect(
        Array.from(rows()[0].querySelectorAll('button')).some(
          control => control.textContent === 'Comment'
        )
      ).toBe(true);
      expect(asked).toEqual([]);
    });

    it("cancels the entry when the reader's pointer lands outside the panel", async () => {
      // A click on text of the preview takes no focus: the browser moves it
      // to the page body and reports no target, so the pointer is what says
      // the reader left.
      press(rows()[0], 'Comment');

      away.dispatchEvent(new Event('pointerdown', { bubbles: true }));
      panel.node.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
      await settle();

      expect(panel.node.querySelector('textarea')).toBeNull();
      expect(asked).toEqual([]);
    });

    it('keeps the entry when the click lands on a part of the panel that takes no focus', async () => {
      // The head of a row, the strip of controls and the gaps between rows
      // take no focus either, and a click there is not the reader leaving.
      press(rows()[0], 'Comment');

      rows()[0]
        .querySelector(`.${HEAD_CLASS}`)!
        .dispatchEvent(new Event('pointerdown', { bubbles: true }));
      panel.node.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
      await settle();

      expect(panel.node.querySelector('textarea')).not.toBeNull();
    });

    it('keeps the entry, and the row, when a context menu takes the focus', async () => {
      // A menu opened from a row is an overlay the reader opened there, not
      // somewhere they went: rows rebuilt under it would take with them the
      // row Copy mark ID reads the identifier from.
      press(rows()[0], 'Comment');
      const menu = document.createElement('div');
      menu.className = 'lm-Menu';
      document.body.appendChild(menu);

      menu.dispatchEvent(new Event('pointerdown', { bubbles: true }));
      panel.node.dispatchEvent(
        new FocusEvent('focusout', { bubbles: true, relatedTarget: menu })
      );
      await settle();

      expect(panel.node.querySelector('textarea')).not.toBeNull();
      menu.remove();
    });

    it('keeps a draft when the reader leaves the panel', async () => {
      press(rows()[0], 'Comment');
      type('half a thought');

      away.focus();
      await settle();

      expect(
        panel.node.querySelector<HTMLTextAreaElement>('textarea')!.value
      ).toBe('half a thought');
    });

    it('keeps an empty entry while the focus stays inside the panel', async () => {
      // A click inside the panel must finish on the control it was aimed at,
      // and rows rebuilt under it would take the click with them.
      press(rows()[0], 'Comment');

      rows()[0].focus();
      await settle();

      expect(panel.node.querySelector('textarea')).not.toBeNull();
    });

    it('cancels an empty entry when another mark is selected', () => {
      panel.setMarks([item('a', 'first passage'), item('b', 'second passage')]);
      press(rows()[0], 'Comment');

      panel.selectMark('b');

      expect(panel.node.querySelector('textarea')).toBeNull();
    });

    it('keeps a draft when another mark is selected', () => {
      panel.setMarks([item('a', 'first passage'), item('b', 'second passage')]);
      press(rows()[0], 'Comment');
      type('half a thought');

      panel.selectMark('b');

      const field = panel.node.querySelector<HTMLTextAreaElement>('textarea')!;
      expect(field.closest<HTMLElement>(`.${ROW_CLASS}`)!.dataset.mark).toBe(
        'a'
      );
      expect(field.value).toBe('half a thought');
    });

    it('keeps the entry a rebuild replaced, whose removed field reports the focus leaving', async () => {
      // A rebuild from disk takes the field the reader is in out and builds it
      // again with their place in it; the browser reports that removal as a
      // focus leaving the panel, and it is the panel's own doing, not the
      // reader's.
      press(rows()[0], 'Comment');
      panel.setMarks([item('a', 'first passage')]);

      panel.node.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
      await settle();

      expect(panel.node.querySelector('textarea')).not.toBeNull();
    });

    it('takes an empty document note out with the entry the reader left', async () => {
      panel.setMarks([documentItem('d'), item('a', 'first passage')]);
      documentId = 'd';
      panel.node.querySelector<HTMLButtonElement>(`.${ADD_CLASS}`)!.click();
      await settle();

      away.focus();
      await settle();

      expect(asked).toEqual(['document', 'empty document d']);
      expect(panel.node.querySelector('textarea')).toBeNull();
    });
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

  it('removes the document note the plus wrote when its field is cancelled', async () => {
    // A document marker holds nothing but its notes: the one the plus wrote
    // for a note the reader then cancelled is taken back out of the file.
    panel.setMarks([item('a', 'first passage')]);
    documentId = 'd';
    onMarkDocument = () =>
      panel.setMarks([documentItem('d'), item('a', 'first passage')]);
    panel.node.querySelector<HTMLButtonElement>(`.${ADD_CLASS}`)!.click();
    await settle();
    type('never mind');
    press(rows()[0], 'Cancel');

    expect(asked).toEqual(['document', 'empty document d']);
    expect(panel.node.querySelector('textarea')).toBeNull();
  });

  it('keeps the marker of a document note the reader closed rather than cancelled (DEF-NOTES-97)', async () => {
    // Close is not Cancel: the reader who closed the row chose to keep the
    // mark, so the entry they left empty takes nothing out of the file.
    panel.setMarks([documentItem('d'), item('a', 'first passage')]);
    documentId = 'd';
    panel.node.querySelector<HTMLButtonElement>(`.${ADD_CLASS}`)!.click();
    await settle();
    asked = [];
    // The parse after Close returns the mark closed, which takes its row out
    // of the list while the closed marks are hidden.
    panel.setMarks([
      item('d', '', {
        mark: mark('d', {
          type: 'document',
          close: null,
          passage: null,
          closed: true
        })
      }),
      item('a', 'first passage')
    ]);

    panel.selectMark('a');

    expect(asked).toEqual([]);
  });

  it('takes the marker out when the document mark is missing from one parse (DEF-NOTES-97)', async () => {
    // A mark absent from one parse is the ordinary shape of a streamed
    // rewrite; the entry the reader left empty still takes its marker with it.
    panel.setMarks([documentItem('d'), item('a', 'first passage')]);
    documentId = 'd';
    panel.node.querySelector<HTMLButtonElement>(`.${ADD_CLASS}`)!.click();
    await settle();
    asked = [];
    panel.setMarks([item('a', 'first passage')]);

    panel.selectMark('a');

    expect(asked).toEqual(['empty document d']);
  });

  it('removes the document note left empty by Save and by the field opened on another row', async () => {
    panel.setMarks([documentItem('d'), item('a', 'first passage')]);
    documentId = 'd';
    const plus = panel.node.querySelector<HTMLButtonElement>(`.${ADD_CLASS}`)!;
    plus.click();
    await settle();
    type('   ');
    press(rows()[0], 'Save');
    expect(asked).toEqual(['document', 'empty document d']);

    asked = [];
    plus.click();
    await settle();
    panel.selectMark('a');
    press(rows()[1], 'Comment');

    expect(asked).toEqual(['document', 'empty document d']);
    const field = panel.node.querySelector<HTMLTextAreaElement>('textarea')!;
    expect(field.closest<HTMLElement>(`.${ROW_CLASS}`)!.dataset.mark).toBe('a');
  });

  it('keeps a document note that holds a note, and a passage mark, when the field is cancelled', async () => {
    panel.setMarks([
      item('d', '', {
        mark: mark('d', {
          type: 'document',
          close: null,
          passage: null,
          notes: [note('ab', '2026-09-10T10:00:00Z', 'kept')]
        })
      }),
      item('a', 'first passage')
    ]);
    documentId = 'd';
    panel.node.querySelector<HTMLButtonElement>(`.${ADD_CLASS}`)!.click();
    await settle();
    press(rows()[0], 'Cancel');
    panel.selectMark('a');
    press(rows()[1], 'Comment');
    press(rows()[1], 'Cancel');

    expect(asked).toEqual(['document']);
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

  it('lets the second click of a double click press no control of the panel or the badge', async () => {
    // The badge sits over the plus and the Hide control of the header it
    // opens (DEF-NOTES-82): the first click opens the panel, and the second
    // click of the same double click, which the browser reports with a detail
    // of 2, lands on the control now under the pointer. A double click on
    // Hide lands its second click on the badge the same way.
    const second = (control: HTMLElement): void => {
      control.dispatchEvent(
        new MouseEvent('click', { bubbles: true, detail: 2 })
      );
    };
    documentId = 'd';
    second(panel.node.querySelector<HTMLButtonElement>(`.${ADD_CLASS}`)!);
    second(panel.node.querySelector<HTMLButtonElement>(`.${CLOSE_CLASS}`)!);
    panel.state = 'hidden';
    second(panel.badge);
    await settle();
    expect(asked).toEqual([]);
  });

  it('acts on a single click and on a key press, which reports no click count', async () => {
    const first = (control: HTMLElement): void => {
      control.dispatchEvent(
        new MouseEvent('click', { bubbles: true, detail: 1 })
      );
    };
    const plus = panel.node.querySelector<HTMLButtonElement>(`.${ADD_CLASS}`)!;
    const hide = panel.node.querySelector<HTMLButtonElement>(
      `.${CLOSE_CLASS}`
    )!;
    first(plus);
    await settle();
    // A key press on a button reports a detail of 0, as click() does.
    plus.click();
    await settle();
    first(hide);
    hide.click();
    panel.state = 'hidden';
    first(panel.badge);
    panel.badge.click();
    expect(asked).toEqual([
      'document',
      'document',
      'state hidden',
      'state hidden',
      'state expanded',
      'state expanded'
    ]);
  });

  it('writes a note once when Save is double-clicked (DEF-NOTES-83)', async () => {
    press(rows()[0], 'Comment');
    type('once');
    const save = Array.from(
      rows()[0].querySelectorAll<HTMLButtonElement>('button')
    ).find(button => button.textContent === 'Save')!;
    // The field is rebuilt only after the write returns, so the second click
    // of the double click reaches the same Save, with a detail of 2.
    save.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }));
    save.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 2 }));
    await settle();
    expect(asked.filter(entry => entry.startsWith('note '))).toEqual([
      'note a once'
    ]);
  });

  it('writes nothing for an empty note, leaving a bare mark', () => {
    press(rows()[0], 'Comment');
    type('   ');
    press(rows()[0], 'Save');
    expect(asked).toEqual([]);
    expect(panel.node.querySelector('textarea')).toBeNull();
  });

  it('writes nothing when the entry is cancelled', () => {
    press(rows()[0], 'Comment');
    type('never mind');
    press(rows()[0], 'Cancel');
    expect(asked).toEqual([]);
    expect(panel.node.querySelector('textarea')).toBeNull();
  });

  it('keeps the focus in the row after Cancel destroyed the pressed button', () => {
    press(rows()[0], 'Comment');
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
    press(rows()[0], 'Comment');
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
    press(rows()[0], 'Comment');
    type('half a thought');
    panel.setMarks([item('a', 'first passage rewritten')]);
    expect(panel.node.querySelector('textarea')!.value).toBe('half a thought');
  });

  it('keeps the caret where it was through a change of the document', () => {
    press(rows()[0], 'Comment');
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
    press(rows()[0], 'Comment');
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
    press(rows()[0], 'Comment');
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
    press(rows()[0], 'Comment');
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
    press(rows()[0], 'Comment');
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
    press(rows()[0], 'Comment');
    type('half a thought');

    panel.setMarks([]);
    elsewhere.focus();

    panel.setMarks([item('a', 'first passage')]);
    expect(panel.node.querySelector('textarea')!.value).toBe('half a thought');
    expect(document.activeElement).toBe(elsewhere);
    elsewhere.remove();
  });

  it('leaves a reader who was on a row out of the field when the rows return', () => {
    press(rows()[0], 'Comment');
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
    press(rows()[0], 'Comment');
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
    press(rows()[0], 'Comment');
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
    press(rows()[0], 'Comment');
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
    press(rows()[0], 'Comment');
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
    press(rows()[0], 'Comment');
    type('half a thought');

    // This rewrite really did take the markers, so the mark never comes back.
    // A draft kept through an absence must not block every other row for the
    // rest of the session.
    panel.setMarks([item('b', 'second passage')]);
    expand(rows()[0]);
    press(rows()[0], 'Comment');

    const field = panel.node.querySelector('textarea')!;
    expect(field.closest<HTMLElement>(`.${ROW_CLASS}`)!.dataset.mark).toBe('b');
    expect(field.value).toBe('');
  });

  it('drops the selection when its mark leaves, and keeps the draft', () => {
    renderMarks('a');
    panel.selectMark('a');
    press(rows()[0], 'Comment');
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

  it('rolls the other colours down from the swatch and asks for the one pressed (ACC-NOTES-173)', () => {
    const swatch = (): HTMLButtonElement =>
      rows()[0].querySelector<HTMLButtonElement>(`.${SWATCH_BUTTON_CLASS}`)!;
    expect(swatch().title).toBe('Colour: yellow');
    expect(swatch().getAttribute('aria-expanded')).toBe('false');
    expect(rows()[0].querySelector(`.${COLOURS_CLASS}`)).toBeNull();

    swatch().click();
    expect(swatch().getAttribute('aria-expanded')).toBe('true');
    const options = (): HTMLButtonElement[] =>
      Array.from(
        rows()[0].querySelectorAll<HTMLButtonElement>(`.${COLOUR_OPTION_CLASS}`)
      );
    // The other five: the mark's own colour is the swatch itself.
    expect(options().map(option => option.title)).toEqual(
      MARK_COLOURS.filter(colour => colour !== 'yellow')
    );
    for (const option of options()) {
      expect(
        option.firstElementChild!.classList.contains(
          colourClass(option.title as MarkColour)
        )
      ).toBe(true);
    }
    // The list takes the focus, so the keyboard is in it.
    expect(document.activeElement).toBe(options()[0]);

    const chosen = options()[0];
    const colour = chosen.title;
    chosen.click();
    expect(asked).toEqual([`colour a ${colour}`]);
    expect(rows()[0].querySelector(`.${COLOURS_CLASS}`)).toBeNull();
    expect(swatch().getAttribute('aria-expanded')).toBe('false');
    // The reader is left on the swatch they opened, not on the page body.
    expect(document.activeElement).toBe(swatch());
  });

  it('rolls the list up on a second press, on Escape and on a press elsewhere (ACC-NOTES-173)', () => {
    const swatch = (): HTMLButtonElement =>
      rows()[0].querySelector<HTMLButtonElement>(`.${SWATCH_BUTTON_CLASS}`)!;
    const list = (): Element | null =>
      rows()[0].querySelector(`.${COLOURS_CLASS}`);

    swatch().click();
    expect(list()).not.toBeNull();
    swatch().click();
    expect(list()).toBeNull();

    swatch().click();
    list()!.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })
    );
    expect(list()).toBeNull();
    expect(document.activeElement).toBe(swatch());

    swatch().click();
    document.body.dispatchEvent(
      new MouseEvent('pointerdown', { bubbles: true })
    );
    expect(list()).toBeNull();
    // Nothing was written by any of it.
    expect(asked).toEqual([]);
  });

  it('keeps the rolled-down list through a rebuild, and rolls it up on a state change (ACC-NOTES-173)', () => {
    const swatch = (): HTMLButtonElement =>
      rows()[0].querySelector<HTMLButtonElement>(`.${SWATCH_BUTTON_CLASS}`)!;
    swatch().click();
    expect(rows()[0].querySelector(`.${COLOURS_CLASS}`)).not.toBeNull();
    panel.setMarks([item('a', 'first passage'), item('b', 'second passage')]);
    expect(rows()[0].querySelector(`.${COLOURS_CLASS}`)).not.toBeNull();
    expect(rows()[1].querySelector(`.${COLOURS_CLASS}`)).toBeNull();
    // The rebuilt list hangs under the rebuilt swatch, which the reader is
    // left on, so Escape still rolls it up.
    expect(document.activeElement).toBe(swatch());

    // A state change empties the rows; the list does not come back with them.
    panel.state = 'minimap';
    panel.state = 'expanded';
    expect(rows()[0].querySelector(`.${COLOURS_CLASS}`)).toBeNull();
  });

  it('leaves Add note out of a row while its note is written, and keeps the colours', async () => {
    panel.setMarks([item('a', 'first passage'), item('b', 'second passage')]);
    expand(rows()[1]);
    const offersNote = (row: Element): boolean =>
      Array.from(row.querySelectorAll('button')).some(
        control => control.textContent === 'Comment'
      );

    press(rows()[0], 'Comment');
    expect(rows()[0].querySelector('textarea')).not.toBeNull();
    expect(offersNote(rows()[0])).toBe(false);
    expect(rows()[0].querySelectorAll(`.${SWATCH_BUTTON_CLASS}`)).toHaveLength(
      1
    );
    expect(rows()[0].querySelector(`.${REMOVE_CLASS}`)).not.toBeNull();
    expect(offersNote(rows()[1])).toBe(true);

    press(rows()[0], 'Cancel');
    expect(offersNote(rows()[0])).toBe(true);

    press(rows()[0], 'Comment');
    const field = rows()[0].querySelector('textarea')!;
    field.value = 'a thought';
    field.dispatchEvent(new Event('input'));
    press(rows()[0], 'Save');
    // Add note returns once the note is written, not at the press.
    expect(offersNote(rows()[0])).toBe(false);
    await Promise.resolve();
    expect(offersNote(rows()[0])).toBe(true);
  });

  it('asks for the mark to be removed', () => {
    press(rows()[0], 'Remove this mark');
    expect(asked).toEqual(['remove a']);
  });

  it('names every button for assistive technology by its title', () => {
    // Add note is left out once its field is open (ACC-NOTES-147), so it is
    // taken before the press.
    const addNote = Array.from(rows()[0].querySelectorAll('button')).find(
      control => control.textContent === 'Comment'
    )!;
    press(rows()[0], 'Comment');
    const buttons = [
      addNote,
      ...Array.from(panel.node.querySelectorAll('button'))
    ];
    // The expand, collapse, Show hidden, add and close controls, the toggle,
    // Comment, the swatch, Remove, Save and Cancel; Close is withheld while
    // the field is open (ACC-NOTES-166).
    expect(buttons).toHaveLength(11);
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

  it('sets the row buttons at a readable size (ACC-NOTES-165)', () => {
    // The text buttons take the size the note text is set in, and the header
    // keeps the smaller one, where there is no room for more.
    expect(declaration('.jp-AdvancedMd-notesButton', 'font-size')).toBe(
      'var(--jp-ui-font-size1)'
    );
    expect(declaration('.jp-AdvancedMd-notesShowClosed', 'font-size')).toBe(
      'var(--jp-ui-font-size0)'
    );
    expect(declaration('.jp-AdvancedMd-notesStamp', 'font-size')).toBe(
      'var(--jp-ui-font-size0)'
    );
    // Every icon control of a row is a 24 px target holding a 16 px icon.
    expect(declaration('.jp-AdvancedMd-notesEntryIcon', 'width')).toBe('24px');
    expect(declaration('.jp-AdvancedMd-notesEntryIcon', 'height')).toBe('24px');
    expect(declaration('.jp-AdvancedMd-notesButton', 'min-height')).toBe(
      '24px'
    );
    expect(declaration('.jp-AdvancedMd-notesRemove', 'min-width')).toBe('24px');
    expect(declaration('.jp-AdvancedMd-notesCloseMark', 'min-width')).toBe(
      '24px'
    );
    // The swatch button, the colours it rolls down and the row's icons are
    // sized by rules the two of them share.
    expect(
      /\.jp-AdvancedMd-notesSwatchButton,\s*\.jp-AdvancedMd-notesColourOption \{[^}]*width: 24px;[^}]*height: 24px;/.test(
        readCss()
      )
    ).toBe(true);
    expect(
      /\.jp-AdvancedMd-notesEntryIcon svg \{[^}]*width: 16px;[^}]*height: 16px;/.test(
        readCss()
      )
    ).toBe(true);
  });

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
    // 2026-09-08, so the x sits above the expand caret.
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

  it('gives the plus control the 24 px target of the icon controls', () => {
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
  });

  it('shows the plus, the expand and the collapse controls in their own state alone', () => {
    // The three controls are hidden by a bare rule and shown by a state-gated
    // one; a later bare rule that sets any other display would show them in
    // every state, as build 0.6.55 did with the carets (DEF-NOTES-59). Every
    // rule whose selector list names a control without a state prefix may set
    // display to none alone.
    for (const control of [ADD_CLASS, EXPAND_CLASS, COLLAPSE_CLASS]) {
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
    expand(rows()[0]);
    const entry = panel.node.querySelector(`.${ENTRY_CLASS}`)!;
    expect(entry.textContent).toBe('orphan line');
  });
});
