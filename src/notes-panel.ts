/**
 * The notes panel: the marks of the open document, listed beside the preview.
 *
 * The panel is a Lumino widget that sits in a left-to-right box next to the
 * rendered Markdown, so the preview keeps the remaining width and nothing
 * overlaps. It has three states: expanded lists every mark with its notes and
 * its controls, minimap shows only a strip of ticks saying where the marks
 * sit, and hidden takes the panel out of the layout.
 *
 * The panel holds no model. It is handed the marks to list and a set of
 * handlers to call when the reader acts on a row, so the controller that owns
 * the document decides what a note, a colour or a removal does to the file.
 * The only document the panel touches itself is the rendered view, and only to
 * bring a selected passage into sight.
 */

import { BoxLayout, BoxPanel, Widget } from '@lumino/widgets';

import {
  IMark,
  INoteEntry,
  MARK_COLOURS,
  MarkColour,
  PanelState
} from './marks';

/** Class on the panel's own node. */
export const PANEL_CLASS = 'jp-AdvancedMd-notes';

/** Class the panel carries while it lists the marks in full. */
export const EXPANDED_CLASS = 'jp-AdvancedMd-notes-expanded';

/** Class the panel carries while it shows only the strip of ticks. */
export const MINIMAP_CLASS = 'jp-AdvancedMd-notes-minimap';

/** Class on the list of rows, and on the strip that replaces it. */
export const LIST_CLASS = 'jp-AdvancedMd-notesList';
export const MAP_CLASS = 'jp-AdvancedMd-notesMap';

/** Classes of one row and its parts. */
export const ROW_CLASS = 'jp-AdvancedMd-notesRow';
export const SELECTED_CLASS = 'jp-AdvancedMd-notesRow-selected';
export const HEAD_CLASS = 'jp-AdvancedMd-notesHead';
export const SWATCH_CLASS = 'jp-AdvancedMd-notesSwatch';
export const PASSAGE_CLASS = 'jp-AdvancedMd-notesPassage';
export const TOGGLE_CLASS = 'jp-AdvancedMd-notesToggle';
export const STATE_CLASS = 'jp-AdvancedMd-notesState';
export const ENTRY_CLASS = 'jp-AdvancedMd-notesEntry';
export const AUTHOR_CLASS = 'jp-AdvancedMd-notesAuthor';
export const STAMP_CLASS = 'jp-AdvancedMd-notesStamp';
export const TEXT_CLASS = 'jp-AdvancedMd-notesText';
export const CONTROLS_CLASS = 'jp-AdvancedMd-notesControls';
export const BUTTON_CLASS = 'jp-AdvancedMd-notesButton';
export const DOT_CLASS = 'jp-AdvancedMd-notesDot';
export const FORM_CLASS = 'jp-AdvancedMd-notesForm';
export const TICK_CLASS = 'jp-AdvancedMd-notesTick';

/** Classes of the header and its two parts. */
export const HEADER_CLASS = 'jp-AdvancedMd-notesHeader';
export const COUNT_CLASS = 'jp-AdvancedMd-notesCount';
export const CLOSE_CLASS = 'jp-AdvancedMd-notesClose';

/**
 * Class the rendered decoration of a marked passage carries, and the attribute
 * naming the mark it belongs to. The panel finds a passage by that attribute,
 * so the two are written here once for the decorator and the panel alike.
 */
export const MARK_CLASS = 'jp-AdvancedMd-mark';
export const MARK_ATTRIBUTE = 'data-mark';

/** Class a marked passage carries while a selected row flashes it. */
export const FLASH_CLASS = 'jp-AdvancedMd-markFlash';

/** How long that flash lasts, matching the animation in style/base.css. */
export const FLASH_MS = 1800;

/** Characters of a passage a row shows before it is cut short. */
export const PASSAGE_LIMIT = 80;

/** The only mark type this version writes; another type is read-only. */
const NOTE_TYPE = 'note';

/** Text the row shows for a mark whose passage is not in the rendered view. */
const UNANCHORED = 'unanchored';

/**
 * One mark as the panel lists it.
 */
export interface INotesPanelItem {
  mark: IMark;
  /** The marked text, empty when the passage is gone from the document. */
  passage: string;
  /** Whether the passage was found in the rendered view. */
  anchored: boolean;
  /** Where the mark sits in the document, from 0 at the top to 1 at the end. */
  position: number;
}

/**
 * What the panel calls when the reader acts on a row.
 *
 * Every one of these changes the document, which is the controller's work: the
 * panel neither parses nor writes the file.
 */
export interface INotesPanelHandlers {
  /** Add a note entry to a mark. Called only with text that is not blank. */
  addNote(id: string, text: string): void;
  /** Give a mark another colour. */
  setColour(id: string, colour: MarkColour): void;
  /** Remove both markers of a mark, leaving the passage as it is. */
  removeMark(id: string): void;
  /** Store a new panel state, which is also what the close control does. */
  setState(state: PanelState): void;
}

/**
 * How a panel is built.
 */
export interface INotesPanelOptions {
  /**
   * The rendered Markdown host, read when a row is selected. It is a function
   * because the viewer builds a new host when the document is re-rendered.
   */
  root: () => HTMLElement | null;
  handlers: INotesPanelHandlers;
  /** State the panel opens in. */
  state: PanelState;
}

/**
 * The document widget the panel is installed beside.
 *
 * A `MarkdownDocument` is a `MainAreaWidget`, whose `BoxLayout` runs top to
 * bottom over the toolbar, the content header and the content. Only the layout
 * and the content are needed here, so they are named structurally rather than
 * by importing a package this extension does not otherwise depend on.
 */
export interface INotesHost extends Widget {
  readonly content: Widget;
}

/**
 * The state a document opens its panel in when its settings marker says
 * nothing: a document that carries marks shows them, one that carries none
 * leaves the reader the full width.
 *
 * @param stored - the state the settings marker holds, or null for none
 * @param hasMarks - whether the document holds at least one mark
 */
export function openingState(
  stored: PanelState | null,
  hasMarks: boolean
): PanelState {
  return stored ?? (hasMarks ? 'expanded' : 'hidden');
}

/**
 * Put the panel beside the document's content.
 *
 * The content leaves the document's own top-to-bottom layout and joins the
 * panel in a left-to-right box, which then takes the place the content had.
 * Lumino moves a widget between layouts when it is added to the second one, so
 * no DOM node is moved by hand and the content is never detached and rebuilt.
 */
export function installNotesPanel(host: INotesHost, panel: NotesPanel): void {
  const layout = host.layout as BoxLayout;
  const box = new BoxPanel({ direction: 'left-to-right', spacing: 0 });
  BoxPanel.setStretch(host.content, 1);
  BoxPanel.setStretch(panel, 0);
  box.addWidget(host.content);
  box.addWidget(panel);
  BoxLayout.setStretch(box, 1);
  layout.addWidget(box);
}

/**
 * The class carrying a mark colour, shared by the rendered decoration, the row
 * swatch and the minimap tick, so one rule in the stylesheet paints all three.
 */
export function colourClass(colour: MarkColour): string {
  return `jp-AdvancedMd-mark-${colour}`;
}

/**
 * A passage as a row shows it: one line, cut at the limit.
 */
function shorten(passage: string): string {
  const line = passage.replace(/\s+/g, ' ').trim();
  return line.length > PASSAGE_LIMIT
    ? `${line.slice(0, PASSAGE_LIMIT)}…`
    : line;
}

/**
 * A button of the panel chrome.
 */
function button(
  className: string,
  label: string,
  title: string,
  onClick: (event: MouseEvent) => void
): HTMLButtonElement {
  const element = document.createElement('button');
  element.className = className;
  element.textContent = label;
  element.title = title;
  element.addEventListener('click', onClick);
  return element;
}

/**
 * The marks of one document, listed beside its preview.
 */
export class NotesPanel extends Widget {
  constructor(options: INotesPanelOptions) {
    super();
    this.addClass(PANEL_CLASS);
    this._root = options.root;
    this._handlers = options.handlers;

    this._count = document.createElement('span');
    this._count.className = COUNT_CLASS;
    const header = document.createElement('div');
    header.className = HEADER_CLASS;
    header.appendChild(this._count);
    header.appendChild(
      button(CLOSE_CLASS, '✕', 'Hide notes', () =>
        this._handlers.setState('hidden')
      )
    );

    this._body = document.createElement('div');
    this.node.appendChild(header);
    this.node.appendChild(this._body);

    this._state = options.state;
    this._apply();
  }

  /**
   * Which of the three states the panel is in.
   */
  get state(): PanelState {
    return this._state;
  }
  set state(value: PanelState) {
    if (value !== this._state) {
      this._state = value;
      this._apply();
    }
  }

  /**
   * The mark a row is selected on, or null when none is.
   */
  get selected(): string | null {
    return this._selected;
  }

  /**
   * Replace the listed marks.
   *
   * Which rows are open, which is selected and a note still being written are
   * all kept, because the marks are re-read on every change of the document
   * and a reader typing a note must not lose it to a change elsewhere.
   */
  setMarks(items: INotesPanelItem[]): void {
    this._items = items;
    const ids = new Set(items.map(item => item.mark.id));
    for (const id of this._open) {
      if (!ids.has(id)) {
        this._open.delete(id);
      }
    }
    if (this._selected && !ids.has(this._selected)) {
      this._selected = null;
    }
    if (this._entry && !ids.has(this._entry.id)) {
      this._entry = null;
    }
    this._render();
  }

  /**
   * Select a mark's row, bringing its passage into sight and flashing it.
   *
   * @param id - the mark to select
   * @param openNote - also open the note entry, which is what a click on the
   * marked passage itself asks for
   */
  selectMark(id: string, openNote = false): void {
    if (!this._items.some(item => item.mark.id === id)) {
      return;
    }
    this._selected = id;
    this._open.add(id);
    if (openNote && this._entry?.id !== id) {
      this._entry = { id, text: '' };
      this._focus = true;
    }
    this._render();
    this._reveal(id);
  }

  /**
   * Show what the current state asks for, and let the box beside the preview
   * measure the panel again, since its width comes from the state class.
   */
  private _apply(): void {
    this.toggleClass(EXPANDED_CLASS, this._state === 'expanded');
    this.toggleClass(MINIMAP_CLASS, this._state === 'minimap');
    this.setHidden(this._state === 'hidden');
    this._render();
    this.parent?.fit();
  }

  /**
   * Build the body: rows when expanded, ticks when minimap, nothing when
   * hidden.
   */
  private _render(): void {
    const active = document.activeElement;
    const keepFocus =
      this._focus ||
      (active instanceof HTMLTextAreaElement && this._body.contains(active));
    this._focus = false;

    this._count.textContent = countLabel(this._items.length);
    this._body.className = this._state === 'minimap' ? MAP_CLASS : LIST_CLASS;
    this._body.textContent = '';
    if (this._state === 'hidden') {
      return;
    }
    for (const item of this._items) {
      this._body.appendChild(
        this._state === 'minimap' ? this._tick(item) : this._row(item)
      );
    }
    if (keepFocus) {
      this._body.querySelector('textarea')?.focus();
    }
  }

  /**
   * One row: the passage, the notes, and the controls when it is open.
   */
  private _row(item: INotesPanelItem): HTMLElement {
    const { mark } = item;
    const open = this._open.has(mark.id);
    const known = mark.type === NOTE_TYPE;

    const row = document.createElement('div');
    row.className = ROW_CLASS;
    row.dataset.mark = mark.id;
    row.tabIndex = 0;
    if (mark.id === this._selected) {
      row.classList.add(SELECTED_CLASS);
    }
    row.addEventListener('keydown', event => {
      // Every control of the row is a descendant of it, so only an Enter
      // typed on the row itself selects; the rest belong to the control that
      // was typed in.
      if (event.key === 'Enter' && event.target === row) {
        event.preventDefault();
        this.selectMark(mark.id);
      }
    });

    const head = document.createElement('div');
    head.className = HEAD_CLASS;
    head.addEventListener('click', () => this.selectMark(mark.id));
    const swatch = document.createElement('span');
    swatch.className = `${SWATCH_CLASS} ${colourClass(mark.colour)}`;
    const passage = document.createElement('span');
    passage.className = PASSAGE_CLASS;
    passage.textContent = shorten(item.passage);
    head.appendChild(swatch);
    head.appendChild(passage);
    head.appendChild(
      button(
        TOGGLE_CLASS,
        open ? '▾' : '▸',
        open ? 'Collapse' : 'Expand',
        event => {
          // The toggle sits inside the head, whose own click selects the row,
          // and opening a row is not selecting it.
          event.stopPropagation();
          if (open) {
            this._open.delete(mark.id);
          } else {
            this._open.add(mark.id);
          }
          this._render();
        }
      )
    );
    row.appendChild(head);

    // A mark of a type this version does not know is listed with its type and
    // offered no control, so nothing this extension cannot read is rewritten.
    const state = [known ? '' : mark.type, item.anchored ? '' : UNANCHORED]
      .filter(part => part !== '')
      .join(' ');
    if (state) {
      const line = document.createElement('div');
      line.className = STATE_CLASS;
      line.textContent = state;
      row.appendChild(line);
    }

    for (const note of open ? mark.notes : mark.notes.slice(0, 1)) {
      row.appendChild(entryRow(note, open));
    }

    if (open && known) {
      row.appendChild(this._controls(mark));
      if (this._entry?.id === mark.id) {
        row.appendChild(this._form(mark.id, this._entry.text));
      }
    }
    return row;
  }

  /**
   * The controls of an open row: a note, the four colours, and a removal.
   */
  private _controls(mark: IMark): HTMLElement {
    const controls = document.createElement('div');
    controls.className = CONTROLS_CLASS;
    controls.appendChild(
      button(BUTTON_CLASS, 'Add note', 'Add a note to this mark', () => {
        this._entry = { id: mark.id, text: '' };
        this._focus = true;
        this._render();
      })
    );
    for (const colour of MARK_COLOURS) {
      controls.appendChild(
        button(`${DOT_CLASS} ${colourClass(colour)}`, '', colour, () =>
          this._handlers.setColour(mark.id, colour)
        )
      );
    }
    controls.appendChild(
      button(BUTTON_CLASS, 'Remove', 'Remove this mark', () =>
        this._handlers.removeMark(mark.id)
      )
    );
    return controls;
  }

  /**
   * The note entry: a text box, and the two ways out of it.
   *
   * Saving blank text writes nothing, so a mark stays bare rather than gaining
   * an empty note line.
   */
  private _form(id: string, draft: string): HTMLElement {
    const form = document.createElement('div');
    form.className = FORM_CLASS;
    const text = document.createElement('textarea');
    text.value = draft;
    text.addEventListener('input', () => {
      this._entry = { id, text: text.value };
    });
    form.appendChild(text);
    form.appendChild(
      button(BUTTON_CLASS, 'Save', 'Save this note', () => {
        const written = text.value.trim();
        this._entry = null;
        this._render();
        if (written) {
          this._handlers.addNote(id, written);
        }
      })
    );
    form.appendChild(
      button(BUTTON_CLASS, 'Cancel', 'Discard this note', () => {
        this._entry = null;
        this._render();
      })
    );
    return form;
  }

  /**
   * One tick of the minimap, at the mark's own place in the document.
   */
  private _tick(item: INotesPanelItem): HTMLElement {
    const tick = document.createElement('div');
    tick.className = `${TICK_CLASS} ${colourClass(item.mark.colour)}`;
    tick.dataset.mark = item.mark.id;
    tick.title = shorten(item.passage);
    tick.style.top = `${item.position * 100}%`;
    tick.addEventListener('click', () => this.selectMark(item.mark.id));
    return tick;
  }

  /**
   * Bring a mark's passage into sight and flash it.
   *
   * The decorations carry the mark identifier, so the panel finds the passage
   * without knowing how the document was rendered. An unanchored mark has no
   * decoration and nothing is scrolled.
   */
  private _reveal(id: string): void {
    const root = this._root();
    const marked = root
      ? Array.from(
          root.querySelectorAll<HTMLElement>(`[${MARK_ATTRIBUTE}="${id}"]`)
        )
      : [];
    if (!marked.length) {
      return;
    }
    marked[0].scrollIntoView({ block: 'center' });
    if (this._flash !== null) {
      window.clearTimeout(this._flash);
    }
    for (const element of marked) {
      element.classList.add(FLASH_CLASS);
    }
    this._flash = window.setTimeout(() => {
      this._flash = null;
      for (const element of marked) {
        element.classList.remove(FLASH_CLASS);
      }
    }, FLASH_MS);
  }

  private readonly _root: () => HTMLElement | null;
  private readonly _handlers: INotesPanelHandlers;
  private readonly _count: HTMLElement;
  private readonly _body: HTMLElement;
  private readonly _open = new Set<string>();
  private _items: INotesPanelItem[] = [];
  private _state: PanelState;
  private _selected: string | null = null;
  private _entry: { id: string; text: string } | null = null;
  private _focus = false;
  private _flash: number | null = null;
}

/**
 * What the header says about how many marks the document holds.
 */
function countLabel(count: number): string {
  if (count === 0) {
    return 'No marks';
  }
  return count === 1 ? '1 mark' : `${count} marks`;
}

/**
 * One note entry: who wrote it, when, and what it says.
 *
 * A closed row shows the first line of the entry, which is the short form the
 * reader scans; the open row shows the whole of it.
 */
function entryRow(note: INoteEntry, full: boolean): HTMLElement {
  const entry = document.createElement('div');
  entry.className = ENTRY_CLASS;
  if (note.author) {
    const author = document.createElement('span');
    author.className = AUTHOR_CLASS;
    author.textContent = `@${note.author}`;
    entry.appendChild(author);
  }
  if (note.stamp) {
    const stamp = document.createElement('span');
    stamp.className = STAMP_CLASS;
    stamp.textContent = new Date(note.stamp).toLocaleString();
    // The ISO stamp is what the file holds, so it is the one to read back.
    stamp.title = note.stamp;
    entry.appendChild(stamp);
  }
  const text = document.createElement('div');
  text.className = TEXT_CLASS;
  text.textContent = full ? note.text : note.text.split('\n')[0];
  entry.appendChild(text);
  return entry;
}
