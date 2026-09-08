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

import { MessageLoop } from '@lumino/messaging';
import { BoxLayout, BoxPanel, Widget } from '@lumino/widgets';

import {
  ADD_ICON,
  COLLAPSE_ICON,
  EXPAND_ICON,
  PANEL_ICONS,
  REMOVE_ICON
} from './icons';
import {
  DOCUMENT_TYPE,
  HIDE_MINIMAP_LABEL,
  IMark,
  INoteEntry,
  MARK_COLOURS,
  known,
  MarkColour,
  PANEL_LABELS,
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
export const FORM_BUTTONS_CLASS = 'jp-AdvancedMd-notesFormButtons';
export const TICK_CLASS = 'jp-AdvancedMd-notesTick';

/** Classes of the header and its parts. */
export const HEADER_CLASS = 'jp-AdvancedMd-notesHeader';
export const COUNT_CLASS = 'jp-AdvancedMd-notesCount';
export const CLOSE_CLASS = 'jp-AdvancedMd-notesClose';
/** Class of the header control that expands the minimap to the full list. */
export const EXPAND_CLASS = 'jp-AdvancedMd-notesExpand';
/** Class of the header control that collapses the list to the minimap. */
export const COLLAPSE_CLASS = 'jp-AdvancedMd-notesCollapse';
/** Class of the header control that adds a note on the document as a whole. */
export const ADD_CLASS = 'jp-AdvancedMd-notesAdd';

/** Title of that control, the one route to a document note. */
const ADD_LABEL = 'Add document note';

/** The removal control of an open row. */
export const REMOVE_CLASS = 'jp-AdvancedMd-notesRemove';

/** Class on the word a document note's row shows in place of a passage. */
export const DOCUMENT_CLASS = 'jp-AdvancedMd-notesDocument';

/**
 * Class on the notes badge over the preview, and the class it carries while
 * the document holds no note.
 */
export const BADGE_CLASS = 'jp-AdvancedMd-notesBadge';
export const BADGE_EMPTY_CLASS = 'jp-AdvancedMd-notesBadge-empty';

/**
 * Class the rendered decoration of a marked passage carries, and the attribute
 * naming the mark it belongs to. The panel finds a passage by that attribute,
 * so the two are written here once for the decorator and the panel alike.
 */
export const MARK_CLASS = 'jp-AdvancedMd-mark';
export const MARK_ATTRIBUTE = 'data-mark';

/**
 * JupyterLab's class on the viewer node, the focusable ancestor of the rendered
 * root, where the focus goes when the panel that held it is hidden.
 */
const VIEWER_CLASS = 'jp-MarkdownViewer';

/** Class a marked passage carries while a selected row flashes it. */
export const FLASH_CLASS = 'jp-AdvancedMd-markFlash';

/** How long that flash lasts, matching the animation in style/base.css. */
export const FLASH_MS = 1800;

/** Characters of a passage a row shows before it is cut short. */
export const PASSAGE_LIMIT = 80;

/** Text the row shows for a mark whose passage is not in the rendered view. */
const UNANCHORED = 'unanchored';

/** Text a document note's row shows in place of a passage. */
const DOCUMENT_LABEL = 'Document';

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
 * What the panel calls when the reader acts on a row or on the header.
 *
 * Every one of these changes the document, which is the controller's work: the
 * panel neither parses nor writes the file.
 */
export interface INotesPanelHandlers {
  /**
   * Add a note entry to a mark. Called only with text that is not blank.
   * Answers whether the note was written, which it is not when the mark's
   * markers are no longer in the document.
   */
  addNote(id: string, text: string): Promise<boolean>;
  /** Give a mark another colour. */
  setColour(id: string, colour: MarkColour): void;
  /** Remove both markers of a mark, leaving the passage as it is. */
  removeMark(id: string): void;
  /**
   * Mark the document as a whole, or answer the document mark the file
   * already holds; null when nothing could be written.
   */
  markDocument(): Promise<string | null>;
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
  // The badge sits over the preview's corner while the panel is hidden, so
  // it lives in the box and not in the panel, which is hidden with it.
  box.node.appendChild(panel.badge);
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
  // Assistive technology reads the label, which for most of these buttons is
  // a glyph; the title is what the button does.
  element.setAttribute('aria-label', title);
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
    // The collapse control leads the header, at its left edge, where a caret
    // reads as collapse and not as a second close beside the hide control;
    // shown by the stylesheet in the expanded state alone.
    const collapse = button(COLLAPSE_CLASS, '', PANEL_LABELS.minimap, () =>
      this._handlers.setState('minimap')
    );
    COLLAPSE_ICON.element({ container: collapse, tag: 'span' });
    header.appendChild(collapse);
    header.appendChild(this._count);
    // The one route to a note on the document as a whole: the entry opens on
    // the document mark, written first when the file holds none.
    const add = button(
      ADD_CLASS,
      '',
      ADD_LABEL,
      () => void this._addDocumentNote()
    );
    ADD_ICON.element({ container: add, tag: 'span' });
    header.appendChild(add);
    // Its mirror, shown in the minimap state alone, where the strip has no
    // rows to expand from.
    const expand = button(EXPAND_CLASS, '', PANEL_LABELS.expanded, () =>
      this._handlers.setState('expanded')
    );
    EXPAND_ICON.element({ container: expand, tag: 'span' });
    header.appendChild(expand);
    // Its title is set by _apply, which names what the control hides.
    this._close = button(CLOSE_CLASS, '', '', () =>
      this._handlers.setState('hidden')
    );
    PANEL_ICONS.hidden.element({ container: this._close, tag: 'span' });
    header.appendChild(this._close);

    this._body = document.createElement('div');
    this.node.appendChild(header);
    this.node.appendChild(this._body);

    // The badge over the preview; installNotesPanel mounts it, _apply shows
    // it while the panel is hidden and _render names the count on it.
    this.badge = button(BADGE_CLASS, '', '', () =>
      this._handlers.setState('expanded')
    );
    PANEL_ICONS.expanded.element({ container: this.badge, tag: 'span' });

    this._state = options.state;
    this._apply();
  }

  /**
   * The notes badge over the preview: shown while the panel is hidden, muted
   * while the document holds no note, and a way to the expanded panel.
   */
  readonly badge: HTMLButtonElement;

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
   * all kept, the caret with the text, because the marks are re-read on every
   * change of the document and a reader typing a note must not lose it, or
   * their place in it, to a change elsewhere.
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
   * Select a mark's row and, when the row was chosen in the panel, bring its
   * passage into sight and flash it.
   *
   * @param id - the mark to select
   * @param openNote - also open the note entry, which is what a click on the
   * marked passage itself asks for; the passage is where the reader is, so
   * nothing is scrolled unless the panel's opening pushed it out of the view
   */
  selectMark(id: string, openNote = false): void {
    if (!this._items.some(item => item.mark.id === id)) {
      return;
    }
    // A note entry exists only in the expanded state, and a reader who asked
    // for the entry asked for the state that holds it.
    if (openNote && this._state !== 'expanded') {
      this._handlers.setState('expanded');
    }
    this._selected = id;
    this._open.add(id);
    if (openNote) {
      this._openEntry(id);
    }
    this._render();
    // The entry is opened from the passage itself, where the reader already
    // is; a row selected in the panel is what needs the passage brought in.
    if (!openNote) {
      this._reveal(id);
    } else {
      // The first mark of a document opened the panel, which took its width
      // from the preview: the text above the passage rewrapped and the passage
      // may have left the view. The fit that opening posted is run first, so
      // the check reads the new layout; an open panel leaves nothing to do.
      MessageLoop.flush();
      this._keepInView(id);
    }
  }

  /**
   * Open the note entry on a mark, for the next render.
   *
   * A draft typed on another row is kept, not replaced: the row asked for
   * opens with its Add note control and the draft stays where it was. The
   * press lands the reader in the field that holds the entry, its row opened,
   * so a draft the reader collapsed out of sight never blocks in silence.
   * A field holding only whitespace is no draft, as Save reads it.
   */
  private _openEntry(id: string): void {
    const entry = this._entry?.text.trim() ? this._entry : { id, text: '' };
    this._entry = entry;
    this._open.add(entry.id);
    this._focus = true;
  }

  /**
   * Open the note entry on the document mark, asking the controller for it.
   */
  private async _addDocumentNote(): Promise<void> {
    const id = await this._handlers.markDocument();
    if (id) {
      this.selectMark(id, true);
    }
  }

  /**
   * Scroll a passage the least distance that puts it back in the view, when
   * it is out of it; nothing else moves.
   */
  private _keepInView(id: string): void {
    const root = this._root();
    const marked = root?.querySelector<HTMLElement>(
      `[${MARK_ATTRIBUTE}="${id}"]`
    );
    if (!root || !marked) {
      return;
    }
    const view = root.getBoundingClientRect();
    const passage = marked.getBoundingClientRect();
    if (passage.bottom > view.bottom || passage.top < view.top) {
      marked.scrollIntoView({ block: 'nearest' });
    }
  }

  /**
   * Show what the current state asks for, and let the box beside the preview
   * measure the panel again, since its width comes from the state class.
   */
  private _apply(): void {
    this.toggleClass(EXPANDED_CLASS, this._state === 'expanded');
    this.toggleClass(MINIMAP_CLASS, this._state === 'minimap');
    // The hide control names what it hides.
    const hide =
      this._state === 'minimap' ? HIDE_MINIMAP_LABEL : PANEL_LABELS.hidden;
    this._close.title = hide;
    this._close.setAttribute('aria-label', hide);
    // A control of the panel the reader had focused goes out of reach with the
    // panel, or with the header control that the state class hides (Expand,
    // Collapse); the viewer, or the Hide control that every shown state
    // keeps, takes the focus, so it never falls to the page body. A control
    // in the body is left to _render, which keeps the reader's row, unless
    // the panel hides, when the body is emptied and no row is rebuilt.
    const active = document.activeElement;
    if (
      this.node.contains(active) &&
      (this._state === 'hidden' || !this._body.contains(active))
    ) {
      if (this._state === 'hidden') {
        this._root()?.closest<HTMLElement>(`.${VIEWER_CLASS}`)?.focus();
      } else {
        this._close.focus({ preventScroll: true });
      }
    }
    this.setHidden(this._state === 'hidden');
    this.badge.hidden = this._state !== 'hidden';
    // The badge hides with the state it opened; a focused badge hands the
    // focus to the Hide control, which the shown panel keeps. This runs after
    // the panel is shown, since a focus call into a hidden subtree does
    // nothing.
    if (active === this.badge && this._state !== 'hidden') {
      this._close.focus({ preventScroll: true });
    }
    this._render();
    this.parent?.fit();
  }

  /**
   * Build the body: rows when expanded, ticks when minimap, nothing when
   * hidden.
   */
  private _render(): void {
    const active = document.activeElement;
    const inside = active instanceof HTMLElement && this._body.contains(active);
    const typing = inside && active instanceof HTMLTextAreaElement;
    const keepFocus = this._focus || typing;
    const caret = typing ? [active.selectionStart, active.selectionEnd] : null;
    // The body is rebuilt whole, so a control the reader had focused is
    // destroyed with it; its row is what they were at, and the row built in
    // its place takes the focus, which keeps their place in the tab order.
    // A row that is gone, its mark removed or the rows now ticks, hands the
    // focus to the row at its place, else to the Hide button, so it never
    // falls to the page body.
    const row = inside ? active.closest<HTMLElement>(`.${ROW_CLASS}`) : null;
    const at = row?.dataset.mark ?? null;
    const index = row ? Array.from(this._body.children).indexOf(row) : -1;
    this._focus = false;

    this._count.textContent = countLabel(this._items.length);
    // The count, then the action, under the name the menu gives it.
    const title = `${countLabel(this._items.length)}: ${PANEL_LABELS.expanded}`;
    this.badge.title = title;
    this.badge.setAttribute('aria-label', title);
    this.badge.classList.toggle(BADGE_EMPTY_CLASS, this._items.length === 0);
    this._body.className = this._state === 'minimap' ? MAP_CLASS : LIST_CLASS;
    this._body.textContent = '';
    // The rows are a list a screen reader moves through; the strip of ticks
    // is not.
    if (this._state === 'expanded') {
      this._body.setAttribute('role', 'list');
    } else {
      this._body.removeAttribute('role');
    }
    if (this._state === 'hidden') {
      return;
    }
    for (const item of this._items) {
      // A document note has no place in the document, so no tick.
      if (this._state === 'minimap' && item.mark.type === DOCUMENT_TYPE) {
        continue;
      }
      this._body.appendChild(
        this._state === 'minimap' ? this._tick(item) : this._row(item)
      );
    }
    // The note field takes the focus back when one was built; when the state
    // took it away (the rows became ticks while a note was typed), the row
    // chain below finds the reader a place.
    const text = keepFocus ? this._body.querySelector('textarea') : null;
    if (text) {
      text.focus();
      if (caret) {
        text.setSelectionRange(caret[0], caret[1]);
      }
    } else if (at !== null) {
      const rows = this._body.querySelectorAll<HTMLElement>(`.${ROW_CLASS}`);
      const target =
        this._body.querySelector<HTMLElement>(
          `.${ROW_CLASS}[${MARK_ATTRIBUTE}="${at}"]`
        ) ??
        rows[Math.min(index, rows.length - 1)] ??
        this._close;
      // A rebuild the reader did not ask for, a change from disk, must not
      // scroll the panel to the row.
      target.focus({ preventScroll: true });
    }
  }

  /**
   * One row: the passage, the notes, and the controls when it is open.
   */
  private _row(item: INotesPanelItem): HTMLElement {
    const { mark } = item;
    const open = this._open.has(mark.id);
    const wholeDocument = mark.type === DOCUMENT_TYPE;

    const row = document.createElement('div');
    row.className = ROW_CLASS;
    row.dataset.mark = mark.id;
    row.tabIndex = 0;
    row.setAttribute('role', 'listitem');
    if (mark.id === this._selected) {
      row.classList.add(SELECTED_CLASS);
      row.setAttribute('aria-current', 'true');
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
    const passage = document.createElement('span');
    passage.className = PASSAGE_CLASS;
    if (wholeDocument) {
      // A note on the document as a whole has no colour and no passage: the
      // row says so in place of both.
      passage.classList.add(DOCUMENT_CLASS);
      passage.textContent = DOCUMENT_LABEL;
    } else {
      const swatch = document.createElement('span');
      swatch.className = `${SWATCH_CLASS} ${colourClass(mark.colour)}`;
      // The swatch is the only place the row shows its colour.
      swatch.setAttribute('role', 'img');
      swatch.setAttribute('aria-label', mark.colour);
      head.appendChild(swatch);
      passage.textContent = shorten(item.passage);
    }
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
    const state = [
      known(mark) ? '' : mark.type,
      item.anchored ? '' : UNANCHORED
    ]
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

    if (open && known(mark)) {
      row.appendChild(this._controls(mark));
      if (this._entry?.id === mark.id) {
        row.appendChild(this._form(mark.id, this._entry.text));
      }
    }
    return row;
  }

  /**
   * The controls of an open row: a note, the six colours, and a removal.
   */
  private _controls(mark: IMark): HTMLElement {
    const controls = document.createElement('div');
    controls.className = CONTROLS_CLASS;
    controls.appendChild(
      button(BUTTON_CLASS, 'Add note', 'Add note to this mark', () => {
        this._openEntry(mark.id);
        this._render();
      })
    );
    for (const colour of mark.type === DOCUMENT_TYPE ? [] : MARK_COLOURS) {
      controls.appendChild(
        button(`${DOT_CLASS} ${colourClass(colour)}`, '', colour, () =>
          this._handlers.setColour(mark.id, colour)
        )
      );
    }
    const remove = button(
      `${BUTTON_CLASS} ${REMOVE_CLASS}`,
      '',
      'Remove this mark',
      () => this._handlers.removeMark(mark.id)
    );
    REMOVE_ICON.element({ container: remove, tag: 'span' });
    controls.appendChild(remove);
    return controls;
  }

  /**
   * The note entry: a text box, and the two ways out of it in a row below
   * the box, so the box keeps the panel's whole width.
   *
   * Saving blank text writes nothing, so a mark stays bare rather than gaining
   * an empty note line. The draft stays until the controller says whether the
   * markers were found: a note on a mark whose markers vanished is kept in
   * front of the reader, beside the row's unanchored line, rather than
   * dropped.
   */
  private _form(id: string, draft: string): HTMLElement {
    const form = document.createElement('div');
    form.className = FORM_CLASS;
    const text = document.createElement('textarea');
    text.rows = 4;
    text.setAttribute('aria-label', 'Note');
    text.value = draft;
    text.addEventListener('input', () => {
      this._entry = { id, text: text.value };
    });
    form.appendChild(text);
    const buttons = document.createElement('div');
    buttons.className = FORM_BUTTONS_CLASS;
    form.appendChild(buttons);
    buttons.appendChild(
      button(BUTTON_CLASS, 'Save', 'Save this note', () => {
        const written = text.value.trim();
        if (!written) {
          this._entry = null;
          this._render();
          return;
        }
        void this._handlers.addNote(id, written).then(saved => {
          if (saved && this._entry?.id === id) {
            this._entry = null;
          }
          this._render();
        });
      })
    );
    buttons.appendChild(
      button(BUTTON_CLASS, 'Cancel', 'Cancel this note', () => {
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
    if (!root) {
      return;
    }
    const marked = Array.from(
      root.querySelectorAll<HTMLElement>(`[${MARK_ATTRIBUTE}="${id}"]`)
    );
    if (!marked.length) {
      return;
    }
    marked[0].scrollIntoView({ block: 'center' });
    if (this._flash !== null) {
      window.clearTimeout(this._flash);
    }
    // A passage flashed for an earlier row keeps the class until its own
    // timeout, and adding a class an element already carries restarts no
    // animation. Taking it off every passage first is what makes the flash
    // start again on the passage the reader chose, and what keeps the earlier
    // passage from flashing when the tab is hidden and shown.
    for (const stranded of Array.from(
      root.querySelectorAll<HTMLElement>(`.${FLASH_CLASS}`)
    )) {
      stranded.classList.remove(FLASH_CLASS);
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
  private _close: HTMLButtonElement;
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
