/**
 * Marks and notes for one open Markdown preview.
 *
 * The controller is the whole of the feature that is neither grammar nor
 * widget: it reads the marks out of the document, paints the marked passages
 * in the rendered view, and writes every marker back into the file. One
 * controller belongs to one preview and lives as long as it.
 *
 * Three rules shape the writing. A marker is written through the shared model
 * in one transaction, so the standard render pipeline runs and every other
 * extension observing the model sees an ordinary local edit. The file is
 * refreshed before the write, so a change already on disk lands first, and
 * the file is written through the server's compare-and-write route, which
 * rewrites it only while it still holds the revision the document holds, so
 * a write from an agent is neither overwritten nor met with the File Changed
 * dialog; a document that already held unsaved edits is not written to disk
 * at all, because those edits are the reader's to save. And the passage bytes
 * between the two markers are never touched: a note, a colour and a removal
 * all rewrite or delete markers alone.
 *
 * Painting follows the same invariants as the change highlight: the marks are
 * inline spans inside blocks the renderer produced, never a new direct child
 * of the render root, and heading text and identifiers stay as rendered.
 */

import { DocumentRegistry } from '@jupyterlab/docregistry';
import { MarkdownDocument } from '@jupyterlab/markdownviewer';
import { ServerConnection } from '@jupyterlab/services';
import { IDisposable } from '@lumino/disposable';
import { IMessageHandler, Message, MessageLoop } from '@lumino/messaging';
import { ISignal, Signal } from '@lumino/signaling';

import {
  inTableRow,
  IRenderedRange,
  ISourceScan,
  itemContinuation,
  markerText,
  markerToRendered,
  passageToRendered,
  renderedToDomRange,
  renderedToSource,
  renderedWords,
  selectionOffsets,
  tokeniseSource
} from './anchor';
import { diffWords, mapOffsets } from './diff';
import {
  captureText,
  DECORATION_CLASS,
  ITextSnapshot,
  ITextSpan
} from './highlight';
import {
  CARET_CLASS,
  colourClass,
  DIAGRAM_CLASS,
  FLASH_CLASS,
  MARK_CLASS,
  markedBy,
  MARK_CLOSED_CLASS,
  markState,
  openingState,
  shorten,
  swatchClass
} from './notes-panel';
import { fetchAPI } from './request';
import {
  DOCUMENT_TYPE,
  IMark,
  IMarkAttribute,
  IMarkContent,
  INoteEntry,
  ISpan,
  known,
  MARK_COLOURS,
  MarkColour,
  newId,
  NOTE_TYPE,
  PanelState,
  parseMarks,
  parseSettings,
  sameNote,
  serialiseClosing,
  serialiseOpening,
  serialiseSettings
} from './marks';
import { EXTERNAL_ORIGIN } from './watcher';

/**
 * Transaction origin of a marker write.
 *
 * A mark is written by the reader, so it is a local edit and must not read as
 * a change from disk: the origin the watcher tags applied content with says
 * so, and this one says the opposite.
 */
export const MARK_ORIGIN = 'jupyterlab_advanced_markdown_viewer_extension:mark';

/**
 * How long after a marker write a render of the written document is dropped.
 *
 * The viewer renders a change once its render timeout has run, a second by
 * default, and the watcher may force a render the moment the written file
 * comes back in from disk; both would rebuild the same text the marks were
 * painted on in place. Anything asked for after this window is rendered.
 */
export const MARK_RENDER_WINDOW_MS = 1500;

/**
 * How long a broken mark must stay broken before its leftover markers are
 * deleted from the file.
 *
 * A read runs on every content change, the reader's own typing among them, and
 * an agent's file reaches the document in pieces: the server coalesces file
 * events in a 100 ms window and never holds one longer than 400 ms, so a
 * half-written file is delivered by design. This window sits comfortably past
 * that cap, so a file still being written is never judged mid-write, and a
 * passage the reader emptied for a moment while retyping it is not judged at
 * all.
 */
export const BREAK_SETTLE_MS = 750;

/**
 * The class the document widget carries while a selection is recorded, so a
 * context-menu entry that needs one can be offered through its selector.
 */
export const SELECTING_CLASS = 'jp-AdvancedMd-selecting';

/**
 * A drawn diagram in the rendered view.
 *
 * JupyterLab draws a mermaid fence as a picture, with the fence's own source
 * kept beside it and hidden (`@jupyterlab/mermaid`). That hidden source is
 * the block's text in the capture, so a mark put on the block anchors to the
 * fence like any passage; the picture carries no words, so it is washed in
 * the mark's colour rather than wrapped (ACC-NOTES-182).
 *
 * A fence the renderer could not draw is not one of these: it shows its own
 * source on the page, which the reader selects and this paints as the text
 * it is.
 */
const DIAGRAM_SELECTOR = '.jp-RenderedMermaid:not(.jp-mod-warning)';

/**
 * Handle written on a note line while the author setting is empty.
 *
 * The setting is the only source of the handle. A lab identity names the
 * reader to the lab, and a hub that logs users in by identifier names them to
 * nobody at all, so a note line signed from it tells whoever reads the file
 * next year less than the plain word does. The reader is asked for a handle
 * the first time they write a note (ACC-NOTES-178), so this word stands only
 * where they declined to give one.
 */
export const DEFAULT_AUTHOR = 'user';

/**
 * Settings the notes controller reads.
 */
export interface INotesSettings {
  /**
   * Whether live updates are on. The write route is taken only then, because
   * the refresh that moves the revision after a 200 reads nothing while they
   * are off.
   */
  enabled: boolean;
  /** Whether marks are painted and listed at all. */
  notes: boolean;
  /** Handle written on note lines, empty for the default handle. */
  author: string;
}

/**
 * A mark as the panel lists it.
 */
export interface IListedMark extends IMark {
  /** The marked text, empty when the mark has no passage any more. */
  text: string;
  /** Where the mark sits in the document, 0 at the start and 1 at the end. */
  position: number;
  /**
   * Whether the mark has lost its place: the passage is not in the rendered
   * view, or the mark is of a type this version does not write and has no
   * passage at all. A mark this version does write whose markers are gone is
   * broken rather than unanchored, and is not listed.
   */
  unanchored: boolean;
}

/**
 * Options for {@link NotesController}.
 */
export interface INotesControllerOptions {
  widget: MarkdownDocument;
  /**
   * Emitted when the live controller has finished a change, so the rendered
   * DOM is again what the renderer produced and the passages can be found.
   */
  settled: ISignal<unknown, void>;
  /**
   * Read the file now and apply what changed. Called before every write, so a
   * change waiting on disk is in the document before the save.
   */
  refresh: () => Promise<void>;
  /** The server the write route is asked on. */
  serverSettings: ServerConnection.ISettings;
  settings: INotesSettings;
}

/**
 * One replacement in the document source.
 */
interface ISourceEdit {
  start: number;
  end: number;
  text: string;
}

/**
 * A mark and where its passage sits in the rendered text.
 */
interface IAnchored {
  mark: IMark;
  range: IRenderedRange;
}

/**
 * A mark the render has no passage for, and the one place it sits.
 *
 * An offset, not a range: what the mark covered is the part the render does
 * not hold, so there is nothing to wrap and the bar goes between two words.
 */
interface ICaret {
  mark: IMark;
  at: number;
  /** The passage words, which this render is the one not holding. */
  text: string;
}

/**
 * The reader's selection, as offsets into the captured text of the render it
 * was taken from, with that text.
 *
 * A render replaces the nodes a live selection points at and collapses it,
 * so the selection is kept as offsets and carried from one render's text to
 * the next.
 */
interface ISelectionRecord extends IRenderedRange {
  text: string;
}

/** Everything a marker's own line may hold before it. */
const BEFORE_MARKER = /^[ \t]*$/;

/** Everything a marker's own line may hold after it. */
const AFTER_MARKER = /^[ \t]*\r?\n?$/;

/** A line indented as far as an indented code block starts. */
const CODE_INDENT = /^(?: {4}| {0,3}\t)[ \t]*\S/;

/** Characters a note handle can carry. */
const HANDLE = /[^A-Za-z0-9_.-]+/g;

/**
 * The handle a raw setting value signs a note with, empty where it signs
 * nothing. A leading @ is dropped, because the panel shows every handle with
 * one and a reader answering the dialog types back what they see, and every
 * other character a handle cannot carry becomes a hyphen so the line reads
 * back as the entry it was written as.
 *
 * Both readers of the setting pass through here - the signer below and the
 * dialog that fills it - so neither can believe a handle the other does not.
 */
export function handleOf(raw: string): string {
  const handle = raw.trim().replace(/^@/, '').replace(HANDLE, '-');
  // A name in a script the grammar cannot carry - the note head is
  // @([A-Za-z0-9_.-]+) - comes through as nothing but hyphens. That is no
  // handle, so it reads as no answer: the reader is signed with the default
  // rather than with a bare dash they can never correct.
  return /[A-Za-z0-9]/.test(handle) ? handle : '';
}

/**
 * The range of a selection that holds text, or null when nothing is selected.
 *
 * The range is what says so, and not `isCollapsed`: macOS Safari reports a
 * selection made by a drag as collapsed while its range holds the words
 * (DEF-NOTES-111), and a range that holds no text is collapsed whatever the
 * flag says.
 */
function selectedRange(selection: Selection): Range | null {
  const range = selection.rangeCount > 0 ? selection.getRangeAt(0) : null;
  return range && range.toString().trim() !== '' ? range : null;
}

/**
 * Whether a Lumino menu holds the focus, which it does from the right click
 * until the moment it runs the command.
 */
function menuHoldsFocus(): boolean {
  const active = document.activeElement;
  return active instanceof Element && active.closest('.lm-Menu') !== null;
}

/**
 * Where a document marker goes: after a leading YAML front matter block, which
 * a site generator reads only as the first bytes of the file, else at the top.
 */
function frontMatterEnd(source: string): number {
  const found = /^---\r?\n[\s\S]*?\r?\n---\r?\n/.exec(source);
  return found ? found[0].length : 0;
}

/**
 * Whether a marker sits on a line of a blockquote. Only that line carries
 * the quote marker, so notes written on lines of their own after it would
 * stand outside the quote and be printed on the page (DEF-NOTES-118): they go
 * on the marker's one line instead, as in a table row.
 */
function inQuote(source: string, offset: number): boolean {
  const lineStart = source.lastIndexOf('\n', offset - 1) + 1;
  return /^[ \t]*(?:(?:[-+*]|\d{1,9}[.)])[ \t]+)*>/.test(
    source.slice(lineStart, offset)
  );
}

/**
 * Whether the quote markers and spaces ahead of a marker are the prefix the
 * writer gave the marker's own line: the prefix the tokeniser records for
 * the line after it or the line before it. Such a line goes with the marker,
 * unless it stands between paragraph text and a line that would go on that
 * paragraph once the marker line is gone: more text, or a line indented four
 * columns, which reads as code only after a break. There a marker 1.0.22
 * appended to a blank quote line would take that break with it.
 */
function ownPrefix(
  source: string,
  lineStart: number,
  lineEnd: number,
  before: string
): boolean {
  const lines = tokeniseSource(source).lines;
  const next = lines.get(lineEnd);
  const prev =
    lineStart > 0
      ? lines.get(source.lastIndexOf('\n', lineStart - 2) + 1)
      : undefined;
  const joins =
    (next?.tail ?? -1) >= 0 ||
    (source.startsWith(before, lineEnd) &&
      CODE_INDENT.test(source.slice(lineEnd + before.length)));
  return (
    (before === next?.above || before === prev?.below) &&
    !((prev?.tail ?? -1) >= 0 && joins)
  );
}

/**
 * The offsets a marker is deleted or rewritten over.
 *
 * A marker that has a line to itself takes the line with it, so removing it
 * leaves no blank line where the block structure had none. A marker written
 * after a bullet, which moved the item's first content down a line
 * (DEF-NOTES-114), takes that line break and the continuation with it, so
 * the content goes back up beside its bullet.
 */
function markerSpan(source: string, span: ISpan): ISourceEdit {
  const lineStart = source.lastIndexOf('\n', span.start - 1) + 1;
  const newline = source.indexOf('\n', span.end);
  const lineEnd = newline < 0 ? source.length : newline + 1;
  const before = source.slice(lineStart, span.start);
  if (AFTER_MARKER.test(source.slice(span.end, lineEnd))) {
    if (
      BEFORE_MARKER.test(before) ||
      ownPrefix(source, lineStart, lineEnd, before)
    ) {
      return { start: lineStart, end: lineEnd, text: '' };
    }
    const continued = itemContinuation(before);
    if (
      continued !== null &&
      newline >= 0 &&
      source.startsWith(continued, lineEnd)
    ) {
      return { start: span.start, end: lineEnd + continued.length, text: '' };
    }
  }
  return { start: span.start, end: span.end, text: '' };
}

/**
 * The edits that delete several markers in one write.
 *
 * Each edit is computed on the source with the batch's later markers already
 * deleted, so a marker written after a bullet, which takes the line break and
 * the continuation below it with it, sees the line that follows once those
 * markers are gone. The edits come out from the end backwards, the order the
 * write applies them in.
 */
function markerEdits(source: string, spans: ISpan[]): ISourceEdit[] {
  let text = source;
  return [...spans]
    .sort((a, b) => b.start - a.start)
    .map(span => {
      const edit = markerSpan(text, span);
      text = applyEdits(text, [edit]);
      return edit;
    });
}

/**
 * The source with the edits made in it, from the end backwards so the offsets
 * of the earlier ones stand.
 */
function applyEdits(source: string, edits: ISourceEdit[]): string {
  let text = source;
  for (const edit of edits) {
    text = text.slice(0, edit.start) + edit.text + text.slice(edit.end);
  }
  return text;
}

/**
 * The attributes of a mark with its colour set, in their original order.
 */
function withColour(
  attributes: IMarkAttribute[],
  colour: MarkColour
): IMarkAttribute[] {
  const next = attributes.map(attribute =>
    attribute.key === 'colour' ? { key: 'colour', value: colour } : attribute
  );
  return next.some(attribute => attribute.key === 'colour')
    ? next
    : [...next, { key: 'colour', value: colour }];
}

/**
 * The attributes of a mark with its status set: `status=closed` when closed,
 * no status attribute when open, the rest in their original order.
 */
function withStatus(
  attributes: IMarkAttribute[],
  closed: boolean
): IMarkAttribute[] {
  const rest = attributes.filter(attribute => attribute.key !== 'status');
  return closed ? [...rest, { key: 'status', value: 'closed' }] : rest;
}

/**
 * The edits that leave the document holding exactly one settings marker, at
 * its end, after one blank line.
 *
 * Every marker already there is deleted, whatever it says, so a marker this
 * version cannot read is replaced rather than left broken. A marker inside
 * the trailing whitespace is covered by the edit that writes the new one,
 * because two edits over the same offsets could not both be applied.
 */
function settingsEdits(source: string, state: PanelState): ISourceEdit[] {
  const markers = parseSettings(source).markers.map(span =>
    markerSpan(source, span)
  );
  // Where the document's own content ends: past the last character that is
  // neither whitespace nor part of a settings marker.
  let tail = source.length;
  while (tail > 0) {
    const at = tail - 1;
    const marker = markers.find(span => at >= span.start && at < span.end);
    if (marker) {
      tail = marker.start;
      continue;
    }
    if (!/\s/.test(source.charAt(at))) {
      break;
    }
    tail = at;
  }
  const edits = markers.filter(span => span.end <= tail);
  edits.push({
    start: tail,
    end: source.length,
    text: `${tail > 0 ? '\n\n' : ''}${serialiseSettings({ panel: state })}\n`
  });
  return edits;
}

/**
 * The notes of a mark as the tooltip of its span: one line per note, each
 * with its author, the lines of a note run together so a note that continues
 * on a second line is not read as a second note without an author. Empty for
 * a bare mark, which then shows no tooltip.
 */
function tooltip(mark: IMark): string {
  return mark.notes
    .map(note => `${note.author}: ${note.text.replace(/\s*\n\s*/g, ' ')}`)
    .join('\n');
}

/**
 * The words of a passage as the renderer shows them, not the source between
 * the markers: a marker placed on its own line before a list item takes the
 * item's number into the passage, and one widened out of emphasis takes the
 * delimiters (DEF-NOTES-84). They are the scan's tokens that overlap the
 * passage, read in the context of their own line, because a slice read on
 * its own would take a dash or a hash at its start for a bullet or a heading
 * marker (DEF-NOTES-87).
 */
function passageText(
  passage: ISpan | null,
  scan: ISourceScan,
  source: string
): string {
  if (!passage) {
    return '';
  }
  const words = scan.tokens
    .filter(token => token.end > passage.start && token.start < passage.end)
    .map(token => token.text)
    .join(' ');
  return words || imageText(passage, scan, source);
}

/**
 * A passage the source has no words for, named by what stands in it.
 *
 * An agent that rewrites a marked passage into an image leaves the markers
 * around a construct carrying no words at all when it writes no alt text,
 * and a state word on its own says nothing about which note it belongs to.
 * The image is named instead, by the file it points at where the source
 * gives one - the last segment of the target, a whole URL being longer than
 * the line has room for. A query string and a fragment go with the rest of
 * the URL, neither being part of the name. A title after the target is
 * passed over. Only a target in round brackets is read: a reference-style
 * image gives a label, which is not a file name, and naming the label is
 * worse than naming nothing.
 */
function imageText(passage: ISpan, scan: ISourceScan, source: string): string {
  const span = scan.protectedSpans.find(
    entry =>
      entry.kind === 'image' &&
      entry.end > passage.start &&
      entry.start < passage.end
  );
  if (!span) {
    return '';
  }
  const target = /\(([^\s)]*)(?:\s+(?:"[^"]*"|'[^']*'))?\)\s*$/.exec(
    source.slice(span.start, span.end)
  );
  const path = target ? target[1].split(/[?#]/)[0] : '';
  const name = path.split('/').pop() ?? '';
  return name ? `image ${name}` : 'image';
}

/**
 * Build the span that paints one mark.
 */
function markSpan(mark: IMark): HTMLElement {
  const span = document.createElement('span');
  span.className = `${MARK_CLASS} ${colourClass(mark.colour)}`;
  if (mark.closed) {
    span.classList.add(MARK_CLOSED_CLASS);
  }
  span.dataset.mark = mark.id;
  const title = tooltip(mark);
  if (title) {
    span.title = title;
  }
  return span;
}

/**
 * Build the bar that stands where an unanchored mark sits.
 *
 * It takes the swatch colour, not the wash a passage takes: three pixels of
 * a wash of eleven to twenty percent is not a colour anybody can see, where
 * the swatch colour is held to three to one against the page
 * (ACC-NOTES-177). A closed mark's bar gives that hue up as its passage
 * does (ACC-NOTES-155), and says so on its first line.
 *
 * It is kept out of the accessibility tree. It carries no text, so there is
 * nothing in it to read out, and everything it stands for - the note, the
 * colour, the passage the view does not hold - the panel's row says in
 * words.
 */
function caretSpan(mark: IMark, passage: string): HTMLElement {
  const span = document.createElement('span');
  span.className = `${CARET_CLASS} ${swatchClass(mark.colour)}`;
  // A closed mark shown on request is drawn muted wherever it is drawn
  // (ACC-NOTES-155), and colour is what says so for every other mark.
  if (mark.closed) {
    span.classList.add(MARK_CLOSED_CLASS);
  }
  span.dataset.mark = mark.id;
  span.setAttribute('aria-hidden', 'true');
  // The title says the state and what the thing is, then the passage, then
  // the notes. The row puts its passage above its state line; the title
  // leads with the state instead, a passage of eighty characters on the
  // first line burying what the reader opened the tooltip for. The state is
  // always there: a mark with no note yet is the common shape, a passage
  // being marked before it is noted, and an agent writes an image with no
  // alt text often enough that the passage line can be empty too - a bar
  // with no title at all would leave a stroke in the reader's prose saying
  // nothing. The word note is on the end of that line because the bar
  // stands in the document and not in the panel: the reader meets a stroke
  // in their own prose with nothing around it to say what it belongs to,
  // and a state adjective alone answers a question they have not been given
  // the subject of. A tick does not need it, standing in the panel already.
  // The passage is on it because this render is the one not holding it, so
  // it cannot be read off the page beside the bar, which is the same reason
  // a minimap tick carries it and a painted passage does not.
  span.title = [
    `${markState(mark, false)} note`,
    shorten(passage),
    tooltip(mark)
  ]
    .filter(part => part !== '')
    .join('\n');
  return span;
}

/**
 * The tags whose elements sit inside a line of text rather than making one.
 *
 * A short closed set, and a tag left out of it reads as a block, which is
 * what the rule below assumed before this set existed: a tag nobody thought
 * of costs what it cost then and nothing more.
 */
const INLINE = new Set([
  'A',
  'ABBR',
  'B',
  'CODE',
  'DEL',
  'EM',
  'I',
  'IMG',
  'INS',
  'KBD',
  'MARK',
  'Q',
  'S',
  'SMALL',
  'SPAN',
  'STRONG',
  'SUB',
  'SUP',
  'TIME',
  'U',
  'VAR'
]);

/**
 * The text nodes a bar may go in, in document order.
 *
 * A node holding nothing but space is structure where nothing about it says
 * it is a seam in a line: the renderer writes one between the items of a
 * list, the rows of a table, the blocks of a quote, and the blocks of any
 * div or details a document or a sibling extension puts around them. A bar
 * there is a child of that container, which takes a line or a column of its
 * own and is not inside a block at all (COMPAT).
 *
 * Two things say it is a seam. The parent holds text of its own, so the
 * space is between words of a sentence; or an element beside it sits inside
 * a line, so the space is between a link and the image after it. Either is
 * enough, and a block whose whole content is inline elements needs the
 * second: its only text of its own is the seam being judged, and passing it
 * over would put the bar inside the link before it, with the link's
 * underline drawn through it.
 *
 * A heading is not passed over, though. The words before a mark that opens
 * the paragraph under one are the heading's own, so the bar stands at the
 * end of the heading and takes its font, at `h1` about twice the stroke of
 * a bar in body text. It carries no text, so the heading's own text and its
 * id are untouched and the table of contents and the anchors read as before
 * (COMPAT). Passing headings over would put the bar at the head of the
 * paragraph, which the step back then moves into the block above the
 * heading, further from the mark than the heading is.
 *
 * The text of a link is passed over for the same reason, whatever it holds.
 * The link's underline runs through a bar inside it, so seven pixels of what
 * reads as one stretch of link text is not link text, and the click the bar
 * answers is the click the link would have answered. The bar goes to the
 * text after the link instead, a word or two late.
 *
 * It is worked out once for a render, not once for each bar: it does not
 * depend on the bar.
 */
function caretSpans(snapshot: ITextSnapshot, root: HTMLElement): ITextSpan[] {
  return snapshot.spans.filter(span => {
    const parent = span.node.parentElement;
    if (!parent || parent === root || parent.closest('a') !== null) {
      return false;
    }
    if (/\S/.test(span.node.nodeValue ?? '')) {
      return true;
    }
    const before = span.node.previousElementSibling;
    const after = span.node.nextElementSibling;
    return (
      (before !== null && INLINE.has(before.tagName)) ||
      (after !== null && INLINE.has(after.tagName)) ||
      Array.from(parent.childNodes).some(
        child =>
          child.nodeType === Node.TEXT_NODE && /\S/.test(child.nodeValue ?? '')
      )
    );
  });
}

/**
 * The text node a bar goes in, and where inside it, or null where the render
 * holds no node the offset reaches.
 */
function caretPlace(
  spans: ITextSpan[],
  at: number
): { node: Text; offset: number } | null {
  // Inside a node, where the words before the marker end mid-node; at the
  // end of one, where those words end where a block does; for an offset on
  // the break between two blocks and so in no node at all, the first node
  // from there on; and where the offset is past every node there is - the
  // last block of the document renders as a link or an image with no text
  // beside it - the last node before it, at its end. The offset is held to
  // the node it lands in, so each of the four says where inside it by the
  // same arithmetic.
  const inside = spans.find(span => span.start <= at && at < span.end);
  const span =
    inside ??
    spans.find(entry => entry.end === at) ??
    spans.find(entry => entry.start >= at) ??
    spans[spans.length - 1];
  if (!span) {
    return null;
  }
  const offset = Math.max(0, Math.min(at, span.end) - span.start);
  // Never at the head of a block. The bar is the first in-flow content of
  // that block when it goes there, and seven pixels of inline box indent the
  // block's whole first line - the left edge of a text column being the one
  // alignment a reader reads structure from, and an indent in Markdown
  // meaning something. The block above takes it instead, which is where the
  // mark's own words stood: the words this place was read from are after the
  // mark, so stepping back moves the bar onto the mark and not past it. The
  // same step the end-of-block case makes, made for the same reason, and for
  // a mark on the first block of all there is nowhere above to step to.
  if (offset > 0 || !opens(span)) {
    return { node: span.node, offset };
  }
  const index = spans.indexOf(span);
  const above = index > 0 ? spans[index - 1] : null;
  return above
    ? { node: above.node, offset: above.end - above.start }
    : { node: span.node, offset: firstWord(span) };
}

/**
 * Whether a bar at the very start of a span would be the first in-flow
 * content of its block.
 *
 * Asked of the nodes themselves rather than of the offsets, because the
 * offsets no longer answer it: a link's text is not a place a bar may go,
 * so the gap it leaves in that list is the same gap a block break leaves,
 * and reading the gap put the bar before the link rather than after it.
 * Walking out of the inline elements a block can open with - a sentence
 * starting in emphasis is still the block's first content - leaves one
 * question, which is whether anything precedes it in its block.
 */
function opens(span: ITextSpan): boolean {
  let node: Node = span.node;
  while (
    !node.previousSibling &&
    node.parentElement &&
    INLINE.has(node.parentElement.tagName)
  ) {
    node = node.parentElement;
  }
  return !node.previousSibling;
}

/**
 * Where the first word of a span ends.
 *
 * The one place a bar cannot step back from is the first block of the
 * document, which has no block above it. It steps forward instead, over the
 * block's first word, which leaves the left edge alone and puts the bar one
 * word later than the place - the same imprecision every other fallback
 * here already carries.
 */
function firstWord(span: ITextSpan): number {
  const text = span.node.nodeValue ?? '';
  const space = text.search(/\s/);
  return space < 0 ? text.length : space;
}

/**
 * Wash a drawn diagram in the colour of the marks over its fence.
 *
 * The wash goes on the figure the picture is in rather than on the block
 * around it, which is as wide as the text column while the picture is only
 * as wide as it was drawn.
 *
 * A picture has one wash to give, so several marks over one fence share it:
 * it takes the colour and the state of the last of them, which is the one
 * that would lie on top were the diagram text, and the title reads their
 * notes in order. The identifier of every one of them is named, so each
 * mark's row still scrolls to the diagram and flashes it.
 */
function washDiagram(box: HTMLElement, marks: IMark[]): void {
  const last = marks[marks.length - 1];
  box.classList.add(DIAGRAM_CLASS, colourClass(last.colour));
  if (last.closed) {
    box.classList.add(MARK_CLOSED_CLASS);
  }
  box.dataset.mark = marks.map(mark => mark.id).join(' ');
  // A blank line between the threads, so the first reply of the second
  // mark does not read as one more reply to the first.
  const title = marks
    .map(tooltip)
    .filter(text => text !== '')
    .join('\n\n');
  if (title) {
    box.title = title;
  }
}

/**
 * Take a wash off a drawn diagram, leaving the block as the renderer built
 * it.
 */
function unwashDiagram(box: HTMLElement): void {
  // The flash comes off with the rest. A painted passage takes its flash
  // away with the span it was on; a figure is the renderer's own element and
  // survives, so a flash left on it would go on running against the rule
  // that makes a diagram flash a ring rather than a wash.
  box.classList.remove(
    DIAGRAM_CLASS,
    FLASH_CLASS,
    MARK_CLOSED_CLASS,
    ...MARK_COLOURS.map(colourClass)
  );
  delete box.dataset.mark;
  box.removeAttribute('title');
}

/**
 * Paint the marked passages of a render.
 *
 * Each text node the passages reach is rebuilt once from its own slices, so
 * two marks whose passages overlap both paint their whole passage: the slice
 * they share is wrapped in one span for each of them, the earlier mark
 * outermost.
 *
 * A bar goes in on the same pass, so a text node holding both a passage and
 * the place of an unanchored mark is rebuilt once and neither is lost.
 *
 * @param snapshot - text captured from `root` before painting
 * @param root - the rendered Markdown host
 * @param anchored - the marks to paint and where their passages sit
 * @param carets - the marks with no passage in this render, and where they
 * sit
 */
function paintMarks(
  snapshot: ITextSnapshot,
  root: HTMLElement,
  anchored: IAnchored[],
  carets: ICaret[]
): void {
  const work = new Map<
    Text,
    Array<{ start: number; end: number; mark: IMark }>
  >();
  const washes = new Map<HTMLElement, IMark[]>();
  for (const item of anchored) {
    for (const span of snapshot.spans) {
      if (span.end <= item.range.start || span.start >= item.range.end) {
        continue;
      }
      // Whitespace between two blocks sits directly under the root, and
      // wrapping it would add a direct child there.
      if (span.node.parentElement === root) {
        continue;
      }
      // A diagram is drawn, not written: the words in the range are the
      // source JupyterLab hides beside the picture, so wrapping them paints
      // nothing the reader can see. The figure is washed instead, once for
      // however many marks reach it (ACC-NOTES-182).
      const box = span.node.parentElement
        ?.closest(DIAGRAM_SELECTOR)
        ?.querySelector<HTMLElement>(':scope > figure');
      if (box) {
        washes.set(box, [...(washes.get(box) ?? []), item.mark]);
        continue;
      }
      const start = Math.max(item.range.start, span.start) - span.start;
      const end = Math.min(item.range.end, span.end) - span.start;
      if (end <= start) {
        continue;
      }
      const covers = work.get(span.node) ?? [];
      covers.push({ start, end, mark: item.mark });
      work.set(span.node, covers);
    }
  }

  for (const [box, marks] of washes) {
    washDiagram(box, marks);
  }

  const bars = new Map<Text, Array<{ at: number; caret: ICaret }>>();
  const placeable = carets.length ? caretSpans(snapshot, root) : [];
  for (const caret of carets) {
    const place = caretPlace(placeable, caret.at);
    if (!place) {
      continue;
    }
    const standing = bars.get(place.node) ?? [];
    standing.push({ at: place.offset, caret });
    bars.set(place.node, standing);
  }

  for (const node of new Set([...work.keys(), ...bars.keys()])) {
    const covers = work.get(node) ?? [];
    const standing = bars.get(node) ?? [];
    const value = node.nodeValue ?? '';
    const cuts = new Set<number>([0, value.length]);
    for (const cover of covers) {
      cuts.add(cover.start);
      cuts.add(cover.end);
    }
    for (const bar of standing) {
      cuts.add(bar.at);
    }
    const points = Array.from(cuts).sort((a, b) => a - b);
    const fragment = document.createDocumentFragment();
    // The bars standing at one offset, in the order the panel lists their
    // marks, whichever of the two places below they go in.
    const barsAt = (offset: number): DocumentFragment => {
      const built = document.createDocumentFragment();
      for (const bar of standing.filter(one => one.at === offset)) {
        built.appendChild(caretSpan(bar.caret.mark, bar.caret.text));
      }
      return built;
    };
    for (let i = 0; i + 1 < points.length; i++) {
      const [at, next] = [points[i], points[i + 1]];
      const covering = covers.filter(
        cover => cover.start <= at && cover.end >= next
      );
      let child: Node = document.createTextNode(value.slice(at, next));
      let innermost: HTMLElement | null = null;
      for (let j = covering.length - 1; j >= 0; j--) {
        const element = markSpan(covering[j].mark);
        element.appendChild(child);
        child = element;
        innermost = innermost ?? element;
      }
      // A bar stands ahead of the text that follows it, and inside the paint
      // that text carries: standing it between the two spans the cut makes
      // would show the page through the middle of a highlighted phrase.
      // Inserting before nothing is appending, so one call serves both.
      (innermost ?? fragment).insertBefore(
        barsAt(at),
        innermost ? innermost.firstChild : null
      );
      fragment.appendChild(child);
    }
    // The last point is the end of the node, where a bar stands after every
    // slice and no text follows it.
    fragment.appendChild(barsAt(points[points.length - 1]));
    node.parentNode?.replaceChild(fragment, node);
  }
}

/**
 * Take every mark span out of a render, putting back the text it wrapped.
 *
 * A bar wraps nothing, so the same unwrapping removes it and leaves the text
 * around it alone. A washed diagram wraps nothing either and is not a span
 * at all, so its classes come off the block first.
 */
function unpaintMarks(root: HTMLElement): void {
  for (const box of Array.from(
    root.querySelectorAll<HTMLElement>(`.${DIAGRAM_CLASS}`)
  )) {
    unwashDiagram(box);
  }
  for (const element of Array.from(
    root.querySelectorAll(`.${MARK_CLASS}, .${CARET_CLASS}`)
  )) {
    const parent = element.parentNode;
    if (!parent) {
      continue;
    }
    while (element.firstChild) {
      parent.insertBefore(element.firstChild, element);
    }
    parent.removeChild(element);
    parent.normalize();
  }
}

/**
 * Reads the marks of one open preview, paints them, and writes them back.
 */
export class NotesController implements IDisposable {
  constructor(options: INotesControllerOptions) {
    this._widget = options.widget;
    this._refresh = options.refresh;
    this._serverSettings = options.serverSettings;
    this._settings = options.settings;
    // A Markdown preview is built by the text model factory, so its model is
    // always a code model and its shared model always a shared file.
    this._context = options.widget
      .context as DocumentRegistry.IContext<DocumentRegistry.ICodeModel>;

    options.settled.connect(this._onSettled, this);
    this._widget.content.rendered.connect(this._onRendered, this);
    MessageLoop.installMessageHook(this._widget.content, this._dropRender);
    this._widget.disposed.connect(this._onWidgetDisposed, this);
    this._widget.node.addEventListener('click', this._onClick, true);
    this._widget.node.addEventListener('mousedown', this._onMouseDown, true);
    // Chromium reports a selection change a frame or more after the
    // selection is made, and a right click can come first; the menu is built
    // on the document's contextmenu handler, so the record, and the class the
    // Mark entry's selector needs, are brought up to date ahead of it.
    this._widget.node.addEventListener(
      'contextmenu',
      this._onSelectionChange,
      true
    );
    document.addEventListener('selectionchange', this._onSelectionChange);

    // Nothing is read until the document has loaded: before that the model is
    // empty, so every mark would be reported as gone and remembered as such.
    void this._context.ready.then(() => {
      if (this._disposed) {
        return;
      }
      this._context.model.contentChanged.connect(this._onContentChanged, this);
      this._read();
      this._paint();
    });
  }

  get isDisposed(): boolean {
    return this._disposed;
  }

  /**
   * Emitted when the marks or the panel state have changed.
   */
  get changed(): ISignal<this, void> {
    return this._changed;
  }

  /**
   * Emitted with a mark's identifier when the reader clicks its passage.
   */
  get activated(): ISignal<this, string> {
    return this._activated;
  }

  /**
   * The reader's selection in the rendered view, as a range of its captured
   * text, or null when nothing of the view is selected.
   *
   * Kept through a render, which collapses the live selection, and through a
   * focus move into a control, so the commands read this rather than the
   * window's selection; it is the same object across renders, its offsets
   * carried onto each. The window is read once more on the ask, because
   * Chromium fires selectionchange a frame or more after the selection
   * moved, and the keybinding and the palette ask before it has; the context
   * menu is served ahead of that by the contextmenu listener. The ask picks
   * up a selection made since the last event and lets none go on a collapse:
   * the menu runs its command after it has closed, when macOS Safari's drop
   * of the live selection stands with no menu holding the focus
   * (DEF-NOTES-111). An event lets go.
   */
  get selection(): IRenderedRange | null {
    this._readSelection(false);
    return this._selection;
  }

  /**
   * The marks of the document in document order.
   *
   * A mark a rewrite broke stays among them for as long as the file holds
   * its opening marker: its notes are still in the file, and the reader may
   * have an entry open on it. It leaves when the deletion's own write reads
   * a file the markers have gone from. The exception is a mark with no
   * opening marker, which has no type, no position and no passage, so there
   * is no row to draw from it at any point.
   */
  get marks(): IListedMark[] {
    const source = this._source;
    // One scan of the whole source serves every row, as it does in _paint.
    const scan = tokeniseSource(source);
    const listed = this._marks.map(mark => this._listed(mark, source, scan));
    // A note on the document as a whole leads the list wherever its marker
    // sits; the passage marks follow in document order.
    return [
      ...listed.filter(mark => mark.type === DOCUMENT_TYPE),
      ...listed.filter(mark => mark.type !== DOCUMENT_TYPE)
    ];
  }

  /**
   * The state of the notes panel: the document's own, or the default for a
   * document that stores none.
   */
  get panelState(): PanelState {
    return this._state;
  }

  /**
   * Apply changed settings without reopening the document.
   */
  updateSettings(settings: INotesSettings): void {
    // Either setting stops the deletion of leftover markers: with notes off
    // the pass refuses over the setting, and with live updates off its write
    // gives the file up, having no answer from the route to tell a file that
    // has gone from one the server still serves.
    const wasBlocked = !this._settings.notes || !this._settings.enabled;
    this._settings = settings;
    this._paint();
    // A break seen while one of them blocked the deletion left no settle
    // armed: the pass it fired armed none, and nothing but a content change
    // reads again. So turning the last of the two back on reads, and the
    // leftover markers in the file find an owner rather than staying there
    // for the life of the document. The read cannot move the panel from
    // here: its state assignment reads the source alone, and the source has
    // not changed since the last read, so it assigns what that read assigned.
    // The read emits the change this call owes the panel.
    if (wasBlocked && settings.notes && settings.enabled) {
      this._read();
    } else {
      this._changed.emit();
    }
  }

  dispose(): void {
    if (this._disposed) {
      return;
    }
    this._disposed = true;
    if (this._frame !== null) {
      window.cancelAnimationFrame(this._frame);
      this._frame = null;
    }
    this._clearSettle();
    this._forgetWritten();
    this._widget.node.removeEventListener('click', this._onClick, true);
    this._widget.node.removeEventListener('mousedown', this._onMouseDown, true);
    this._widget.node.removeEventListener(
      'contextmenu',
      this._onSelectionChange,
      true
    );
    this._widget.node.classList.remove(SELECTING_CLASS);
    document.removeEventListener('selectionchange', this._onSelectionChange);
    MessageLoop.removeMessageHook(this._widget.content, this._dropRender);
    const root = this._root;
    if (root) {
      unpaintMarks(root);
    }
    Signal.clearData(this);
  }

  /**
   * Mark the selected text.
   *
   * @param colour - the colour to mark it in
   * @returns the identifier of the new mark, or null when nothing is selected
   * or the selected words cannot be found in the source, and nothing was
   * written
   */
  async mark(colour: MarkColour): Promise<string | null> {
    await this._refresh();
    const root = this._root;
    if (this._disposed || !root || !this._selection) {
      return null;
    }
    const id = newId();
    const opening = serialiseOpening({
      id,
      type: NOTE_TYPE,
      attributes: [{ key: 'colour', value: colour }],
      notes: []
    });
    const closing = serialiseClosing(id);
    // The record the mark is made from, read once: the write path asks for
    // the edits again when it falls back from the route or retries after a
    // refusal, and the reader may have selected other words meanwhile, which
    // are not what they asked to mark. The record's offsets are into the
    // render on screen, and a render that completes meanwhile carries them
    // in place, so each turn locates the same words in whichever source the
    // write goes into.
    let used: ISelectionRecord | null = null;
    const written = await this._write(source => {
      if (used === null) {
        used = this._selection;
      }
      // A record the reader let go of during the write (a click, other
      // words) is not carried onto a render that completes meanwhile; its
      // offsets then name other words on screen, so it is used only while
      // it holds the text of the render as it stands, which a carried record
      // always does.
      const selection = used;
      const range =
        selection && selection.text === captureText(root).text
          ? renderedToSource(selection, root, source)
          : null;
      if (!range) {
        return [];
      }
      const written = markerText(range, opening, closing);
      return [
        { start: range.start, end: range.start, text: written.opening },
        { start: range.end, end: range.end, text: written.closing }
      ];
    });
    // The painted mark now shows the passage, so the selection it was made
    // from is dropped: kept, it would be put back over the mark after the next
    // render. The caret is put at the end of the painted mark, where a reader
    // browsing with the caret was: the live range collapsed onto the parent
    // when the paint replaced its nodes, ahead of the mark. A selection the
    // reader made while the write was on its way is theirs and stays.
    if (written && this._selection === used) {
      this._setSelection(null);
      const live = window.getSelection();
      const painted = root.querySelectorAll(markedBy(id));
      const last = painted[painted.length - 1];
      if (last) {
        live?.collapse(last, last.childNodes.length);
      } else {
        live?.collapseToEnd();
      }
    }
    return written ? id : null;
  }

  /**
   * Put a note marker on the document as a whole: an opening marker of the
   * document type with no closing marker, on a line of its own at the top of
   * the file, so it has no passage and any other renderer shows nothing.
   *
   * @returns the identifier of the new mark, or of the document mark the file
   * already holds; null when nothing could be written
   */
  async markDocument(): Promise<string | null> {
    await this._refresh();
    if (this._disposed) {
      return null;
    }
    const id = newId();
    const opening = serialiseOpening({
      id,
      type: DOCUMENT_TYPE,
      attributes: [],
      notes: []
    });
    // The document has one note thread: a marker the file already holds is
    // the one the entry opens, and a second is never written. The check runs
    // inside the edit, on the source of each attempt, since a press during
    // another press's round trip finds the first marker only on the refresh
    // its refused write brings.
    let found: string | null = null;
    const written = await this._write(source => {
      const existing = parseMarks(source).find(
        mark => mark.type === DOCUMENT_TYPE && mark.open
      );
      if (existing) {
        found = existing.id;
        return [];
      }
      const at = frontMatterEnd(source);
      return [{ start: at, end: at, text: `${opening}\n` }];
    });
    // A marker the refresh brought in is read now, as the write paths do, so
    // the panel lists it by the time the caller opens the entry on it.
    this._flush();
    return written ? id : found;
  }

  /**
   * Add a note to a mark, signed and stamped.
   *
   * An empty note writes nothing: a mark without notes is the bare mark the
   * reader already has.
   *
   * @returns whether the note was written, which it is not when the mark's
   * markers are no longer in the document
   */
  async addNote(id: string, text: string): Promise<boolean> {
    const body = text.trim();
    if (!body) {
      return false;
    }
    const stamp = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
    return this._rewrite(id, mark => ({
      ...mark,
      notes: [...mark.notes, { author: this.author(), stamp, text: body }]
    }));
  }

  /**
   * Replace the text of one entry of a mark, keeping its author and stamp
   * (ACC-NOTES-164). The entry is found by what the reader saw of it, in the
   * marker as it stands at the moment of writing.
   *
   * @returns whether the entry was rewritten, which it is not when the mark's
   * markers are no longer in the document or the entry is no longer in the
   * marker as the reader saw it
   */
  async editNote(id: string, note: INoteEntry, text: string): Promise<boolean> {
    const body = text.trim();
    if (!body) {
      return false;
    }
    return this._rewrite(id, mark => {
      const at = mark.notes.findIndex(each => sameNote(each, note));
      if (at < 0) {
        return null;
      }
      const notes = [...mark.notes];
      notes[at] = { ...notes[at], text: body };
      return { ...mark, notes };
    });
  }

  /**
   * Drop one entry of a mark; the last one dropped leaves a bare mark
   * (ACC-NOTES-167).
   */
  async removeNote(id: string, note: INoteEntry): Promise<void> {
    await this._rewrite(id, mark => {
      const at = mark.notes.findIndex(each => sameNote(each, note));
      return at < 0
        ? null
        : { ...mark, notes: mark.notes.filter((_, i) => i !== at) };
    });
  }

  /**
   * Change a mark's colour, keeping every other attribute as it stands.
   */
  async setColour(id: string, colour: MarkColour): Promise<void> {
    await this._rewrite(id, mark => ({
      ...mark,
      attributes: withColour(mark.attributes, colour)
    }));
  }

  /**
   * Close a mark or reopen it, keeping every other attribute as it stands.
   */
  async setClosed(id: string, closed: boolean): Promise<void> {
    await this._rewrite(id, mark => ({
      ...mark,
      attributes: withStatus(mark.attributes, closed)
    }));
  }

  /** Whether the closed marks are painted and listed (ACC-NOTES-155). */
  get showClosed(): boolean {
    return this._showClosed;
  }

  /**
   * Show the closed marks, in the preview and the panel alike, or hide them.
   * A panel switch, not a document setting: it holds for this preview alone.
   */
  setShowClosed(on: boolean): void {
    if (on === this._showClosed) {
      return;
    }
    this._showClosed = on;
    this._paint();
    this._changed.emit();
  }

  /**
   * Remove a mark: both markers go and the passage between them stays.
   */
  async remove(id: string): Promise<void> {
    await this._refresh();
    if (this._disposed) {
      return;
    }
    const mark = parseMarks(this._source).find(found => found.id === id);
    if (mark && !known(mark)) {
      return;
    }
    const written = await this._write(current => {
      const found = parseMarks(current).find(each => each.id === id);
      return markerEdits(
        current,
        [found?.open, found?.close].filter((span): span is ISpan => !!span)
      );
    });
    if (!written) {
      this._changed.emit();
    }
  }

  /**
   * Remove a document marker that holds no note, which is what the plus wrote
   * for a note the reader then left without writing. The test runs inside the
   * edit, on the source of each attempt, so a note another writer put into the
   * marker meanwhile keeps it, and so does a mark the reader closed, since
   * closing it is them keeping it (DEF-NOTES-97).
   */
  async removeEmptyDocument(id: string): Promise<void> {
    await this._refresh();
    if (this._disposed) {
      return;
    }
    await this._write(current => {
      const found = parseMarks(current).find(each => each.id === id);
      if (
        found?.type !== DOCUMENT_TYPE ||
        found.closed ||
        found.notes.length > 0
      ) {
        return [];
      }
      return [found.open, found.close]
        .filter((span): span is ISpan => !!span)
        .map(span => markerSpan(current, span));
    });
  }

  /**
   * Store the state of the notes panel in the document.
   */
  async setPanelState(state: PanelState): Promise<void> {
    // With the notes setting off nothing of the feature writes.
    if (state === this._state || !this._settings.notes) {
      return;
    }
    // The panel follows at once; the document follows when the write lands.
    // Until every such write has returned, a read finds the file holding a
    // state the reader has already moved on from, so it leaves this one be.
    // Each attempt of the write reads the state as it stands, not the state
    // this call was given, so a refused write retried after a newer state
    // landed stores the newer state.
    this._state = state;
    this._panelWrites++;
    this._changed.emit();
    try {
      await this._refresh();
      if (this._disposed) {
        return;
      }
      await this._write(source => settingsEdits(source, this._state));
    } finally {
      this._panelWrites--;
    }
  }

  /**
   * The handle a note line written now is signed with: the author setting
   * as `handleOf` reads it, and the default handle where that is empty.
   *
   * Only lines written here are signed: a line another author already wrote
   * into the marker is carried through the rewrite as it stands.
   */
  author(): string {
    return handleOf(this._settings.author) || DEFAULT_AUTHOR;
  }

  /**
   * The element the renderer writes into.
   */
  private get _root(): HTMLElement | null {
    return this._widget.node.querySelector('.jp-RenderedMarkdown');
  }

  /**
   * The document source as the model holds it now.
   */
  private get _source(): string {
    return this._context.model.toString();
  }

  private _onWidgetDisposed(): void {
    this.dispose();
  }

  /**
   * Select a drawn diagram the reader presses on.
   *
   * A picture holds no words, so a drag across one selects nothing: the
   * browser starts to drag the picture instead. A press puts the selection
   * over the whole block, which is the unit a note goes on, and it is the
   * press rather than the click so the context menu a right button opens is
   * offered the selection its Mark entry needs (ACC-NOTES-182). The press
   * selects whether or not the diagram is already marked, as a press on a
   * painted passage does; the note on it is read from its row in the panel.
   *
   * The browser's own answer to the press is left alone. It focuses the
   * viewer, which the marking shortcut's selector needs, and it lets the
   * picture be dragged, which every other picture in the preview allows.
   *
   * This reads `mousedown` where the rest of the extension reads
   * `pointerdown`. A pointer press is raised by a finger as well, and a
   * finger resting on a picture to scroll it would select the diagram
   * every time; a long press raises the context menu with no mouse press
   * before it, which is the touch gap ACC-NOTES-182 records.
   */
  private _onMouseDown = (event: MouseEvent): void => {
    if (!this._settings.notes) {
      return;
    }
    const root = this._root;
    const target = event.target as Element | null;
    const diagram = target?.closest?.(DIAGRAM_SELECTOR) ?? null;
    const selection = window.getSelection();
    if (!root || !diagram || !root.contains(diagram) || !selection) {
      return;
    }
    selection.selectAllChildren(diagram);
  };

  /**
   * The reader clicked in the preview: a click on a marked passage, or on the
   * bar standing where an unanchored mark sits, opens that mark, which is the
   * second way to reach the note entry. The bar answers the same click as the
   * passage it stands in for: it carries the same identifier and looks like
   * the same thing, and a reader who finds one in their prose has no other
   * way from it to what it means.
   */
  private _onClick = (event: Event): void => {
    if (!this._settings.notes) {
      return;
    }
    const target = event.target as Element | null;
    const element = target?.closest?.(
      `.${MARK_CLASS}, .${CARET_CLASS}`
    ) as HTMLElement | null;
    const id = element?.dataset.mark;
    // The bar is a decoration this module put in the render, not part of the
    // document, so a click on it must not run the activation behaviour of
    // whatever it stands inside. A summary is the case that reaches the
    // preview, JupyterLab's sanitiser passing details through, and the
    // section would open or shut under the reader (ACC-NOTES-180).
    if (element?.classList.contains(CARET_CLASS)) {
      event.preventDefault();
    }
    // A click that ends a drag over the passage is the reader selecting text
    // inside the mark, not asking for its row: an activation would move the
    // focus into the note field and take the selection away (DEF-NOTES-91).
    // The range's text says so, as the window may still call the selection
    // collapsed (DEF-NOTES-111).
    const selection = window.getSelection();
    if (id && !(selection && selectedRange(selection))) {
      this._activated.emit(id);
    }
  };

  /**
   * Drop the render the viewer schedules for a marker write.
   *
   * The viewer renders the document again once its render timeout has run
   * after any change to the model. A write that changed markers alone would
   * render the same text again, rebuilding every node on screen, reloading
   * every image and moving the reader for nothing: the marks were painted on
   * the render in place when they were written. So is the render the watcher
   * forces when the written file comes back in from disk ahead of the
   * write's own answer. A render is dropped only while the document holds
   * exactly what the write left in it and only inside the write's window;
   * the first change of any other kind, typed or from disk, is rendered as
   * ever and ends the dropping.
   */
  private _dropRender = (_: IMessageHandler, message: Message): boolean => {
    if (message.type !== 'update-request') {
      return true;
    }
    if (this._markedSource !== null && this._source === this._markedSource) {
      return false;
    }
    // The document holds something a marker write did not leave in it: that
    // is a change to render, and every render after it as well. The viewer
    // renders a request only once the document is ready, and reads the
    // document as it stands now; the render reports back with that source.
    this._forgetWritten();
    if (this._context.isReady) {
      this._requestedSource = this._source;
    }
    return true;
  };

  /**
   * Remember what a marker write leaves in the document, so the renders it
   * causes are dropped while the document holds exactly that, and for no
   * longer than the window.
   *
   * The marks are painted on the render on screen, which stands in for a
   * render of the written document only when it is the render of the
   * document the write changed. When it is not, a change is still waiting on
   * the viewer's render timeout, the render it schedules shows that change,
   * and nothing is remembered: the render goes through as ever.
   *
   * @param before - the document the write was computed against
   * @param after - the document the write leaves
   */
  private _rememberWritten(before: string, after: string): void {
    if (before !== this._renderedSource) {
      this._forgetWritten();
      return;
    }
    this._renderedSource = after;
    this._markedSource = after;
    if (this._markedTimer !== null) {
      window.clearTimeout(this._markedTimer);
    }
    this._markedTimer = window.setTimeout(() => {
      this._markedTimer = null;
      this._markedSource = null;
    }, MARK_RENDER_WINDOW_MS);
  }

  private _forgetWritten(): void {
    this._markedSource = null;
    if (this._markedTimer !== null) {
      window.clearTimeout(this._markedTimer);
      this._markedTimer = null;
    }
  }

  /**
   * The reader's selection changed: record where it sits in the rendered
   * text, or forget it.
   */
  private _onSelectionChange = (): void => {
    this._readSelection(true);
  };

  /**
   * Read the window's selection into the record.
   *
   * @param reported - whether the browser is reporting a change, which may
   * let the record go, rather than a command asking, which lets none go on
   * a collapse
   */
  private _readSelection(reported: boolean): void {
    const root = this._root;
    const selection = window.getSelection();
    if (!root || !selection) {
      this._setSelection(null);
      return;
    }
    const range = selectedRange(selection);
    if (!range) {
      // Nothing is selected. A live range over no text, as a drag across a
      // rule leaves, is a deselection. So is a caret placed in text, which is
      // the reader's click there, and a selection gone altogether, which is
      // their click on the selection; a collapse onto an element is a focus
      // move, which keeps the record. The exception is a selection gone while
      // a menu holds the focus: macOS Safari drops the selection for the menu
      // it opened, and the reader still means the words (DEF-NOTES-111).
      const live = selection.rangeCount > 0 ? selection.getRangeAt(0) : null;
      if (live?.collapsed === false) {
        this._setSelection(null);
        return;
      }
      if (!reported) {
        return;
      }
      const anchor = selection.anchorNode;
      if (anchor instanceof Element || (!anchor && menuHoldsFocus())) {
        return;
      }
      this._setSelection(null);
      return;
    }
    if (!root.contains(range.commonAncestorContainer)) {
      this._setSelection(null);
      return;
    }
    const offsets = selectionOffsets(range, root);
    const text = offsets ? captureText(root).text : '';
    // The browser reports its own restore of the selection as a change; the
    // record stays the same object for the same selection, so a mark on its
    // way still knows it as its own.
    const held = this._selection;
    if (
      offsets &&
      held &&
      held.start === offsets.start &&
      held.end === offsets.end &&
      held.text === text
    ) {
      return;
    }
    this._setSelection(offsets ? { ...offsets, text } : null);
  }

  /**
   * Record the selection, and say on the document widget whether one is
   * held: a submenu entry has no visibility of its own, so the menu offers
   * the marking submenu through a selector that needs the class.
   */
  private _setSelection(record: ISelectionRecord | null): void {
    this._selection = record;
    this._widget.node.classList.toggle(SELECTING_CLASS, record !== null);
  }

  /**
   * Carry the recorded selection onto the text of the render on screen.
   *
   * The offsets are moved through the diff of the two texts: a change ahead
   * of the selection moves it, a deletion inside it shrinks or closes it, and
   * a replacement of its first word carries it onto the replacement. Called
   * on a render and again when a change settles, because the decorations
   * hold the added text out of the capture until then. The record is moved
   * in place: a mark on its way holds the record it was made from, and tells
   * the record from one the reader made since by identity.
   */
  private _carrySelection(): void {
    const record = this._selection;
    const root = this._root;
    if (!record || !root) {
      return;
    }
    const text = captureText(root).text;
    if (text === record.text) {
      return;
    }
    const map = mapOffsets(diffWords(record.text, text));
    const start = map.toLater(record.start);
    const end = map.toLater(record.end);
    // The record is moved whether the range stays open or closes, so a mark
    // on its way that holds the record sees it closed and writes nothing.
    Object.assign(record, { start, end, text });
    if (end <= start) {
      this._setSelection(null);
    }
  }

  /**
   * Put the recorded selection back over the nodes of the render on screen.
   *
   * Only while nothing but the page or the viewer holds the focus: adding a
   * range while a textarea is focused keeps the focus there but resets its
   * caret, so a reader typing a note is left alone and the record stays for
   * the next render. An open context menu is the exception, since it holds the
   * focus itself from the right-click until the moment it runs the command -
   * and Copy Content is only ever chosen while it stands, so a render or a
   * fade landing under an open menu would otherwise leave the reader's
   * selection gone with nothing to put it back (DEF-COPY-106, DEF-COPY-107). A
   * menu has no caret of its own for the range to disturb.
   */
  private _restoreSelection(): void {
    const record = this._selection;
    const root = this._root;
    if (!record || !root) {
      return;
    }
    const active = document.activeElement;
    if (
      active !== document.body &&
      active !== this._widget.content.node &&
      !menuHoldsFocus()
    ) {
      return;
    }
    const selection = window.getSelection();
    if (!selection) {
      return;
    }
    const range = renderedToDomRange(record, root);
    if (!range) {
      return;
    }
    selection.removeAllRanges();
    selection.addRange(range);
  }

  /**
   * The model changed, by the reader's own writing or by a change from disk.
   * Reading the marks again is deferred one frame, so a burst of edits is
   * read once.
   */
  private _onContentChanged(): void {
    if (this._frame !== null) {
      return;
    }
    this._frame = window.requestAnimationFrame(() => {
      this._frame = null;
      this._read();
    });
  }

  /**
   * A render finished: paint the marks on it.
   *
   * The renderer rebuilt the nodes the spans were in, so nothing is painted
   * any more whatever the marks say and the last painting is forgotten. Two
   * renders of the same text would otherwise leave the second one bare.
   */
  private _onRendered(): void {
    // The screen shows the source the render read: the one the hook took down
    // when it let the update-request through, since the document may have
    // moved during the render; a render no request preceded, the first one,
    // read the document as it stands.
    this._renderedSource = this._requestedSource ?? this._source;
    this._requestedSource = null;
    this._carrySelection();
    this._flush();
    this._painted = null;
    this._paint();
    this._restoreSelection();
  }

  /**
   * The live controller has taken its decorations back out, so the rendered
   * text is the whole document again and passages inside a change can be
   * found.
   */
  private _onSettled(): void {
    this._carrySelection();
    this._flush();
    this._paint();
    this._restoreSelection();
  }

  /**
   * Read the marks now when a deferred read is waiting, so a render never
   * paints against marks a change has already replaced.
   */
  private _flush(): void {
    if (this._frame === null) {
      return;
    }
    window.cancelAnimationFrame(this._frame);
    this._frame = null;
    this._read();
  }

  /**
   * Read the marks and the panel state out of the document.
   */
  private _read(): void {
    if (this._disposed) {
      return;
    }
    const source = this._source;
    const parsed = parseMarks(source);
    // A break is not acted on where the reader can see it either. A mark that
    // still holds its opening marker keeps its row, because the file still
    // holds that marker and the note lines inside it: a note being written
    // into a mark an agent's first chunk broke is not discarded, and a
    // passage the reader emptied while retyping it is listed for as long as
    // their undo can bring it back. The row goes when this read runs over a
    // file the markers have left, which is the write of the deletion and
    // nothing earlier. A mark with no opening marker has no type, no position
    // and no passage, so it is left out at once.
    const broken = parsed.filter(mark => this._isBroken(mark, source));
    this._marks = parsed.filter(mark => mark.open);
    // The opening rule lives with the panel, which is what it decides for.
    // A read applies it only where it opens the panel: a rewrite that takes
    // the last mark away leaves the panel as the reader left it, since its
    // state is the document's and a rewrite elsewhere did not ask for it.
    // The state a document with no marks and no settings marker opens in is
    // the default this field already holds.
    const stored = parseSettings(source).settings;
    const hasMarks = this._marks.length > 0;
    // While a state the reader asked for is still being written, the file
    // says what the panel was before it, and applying that would hide or
    // move the panel under the reader until the write lands.
    if (this._panelWrites === 0) {
      if (stored) {
        this._state = stored.panel;
      } else if (hasMarks) {
        this._state = openingState(null, hasMarks);
      }
    }
    this._changed.emit();
    // A break is never acted on the moment it is seen. This read runs on
    // every content change, so it meets a passage the reader has emptied for
    // one frame while retyping it, and it meets a file an agent is still
    // writing, whose closing marker has not arrived yet. Both are answered by
    // waiting: every further change arms the settle again, so a stream of
    // chunks pushes the deletion out until the writing stops, and a break
    // that is whole again by then is never written about.
    if (broken.length) {
      this._armSettle(broken.map(mark => mark.id));
    } else {
      this._clearSettle();
    }
  }

  /**
   * Arm the settle on the marks a break was seen in, so their leftover
   * markers are deleted once it has stood for the window.
   *
   * Armed by the read that saw the break, and again by a pass that could not
   * act: a write of this controller in flight and the reader's unsaved edits
   * both pass, and neither is a change the model reports, so the pass brings
   * itself back. The marks are named, because a pass may delete only what
   * stood broken for the window and nothing a refresh brought in meanwhile.
   */
  private _armSettle(ids: string[]): void {
    this._clearSettle();
    this._settleTimer = window.setTimeout(() => {
      this._settleTimer = null;
      this._deleteBroken(ids).catch((reason: unknown) => {
        // The one write of this extension the reader did not ask for: nothing
        // of theirs waits on it, so the failure is named here or nowhere. The
        // settle is not armed again, because _write throws on a failure of
        // the network alone and a pass every window would ask an unreachable
        // server for ever.
        console.warn(
          `${EXTERNAL_ORIGIN}: the leftover markers of a broken mark could not be deleted - ${reason}; they stay in the file and nothing retries until the document next changes`
        );
      });
    }, BREAK_SETTLE_MS);
  }

  /**
   * Disarm the settle a read armed, so nothing of a break it saw is deleted.
   */
  private _clearSettle(): void {
    if (this._settleTimer !== null) {
      window.clearTimeout(this._settleTimer);
      this._settleTimer = null;
    }
  }

  /**
   * Whether a rewrite has broken a mark, so that nothing of it means anything
   * any more: only one of its two markers is left, or the passage between
   * them holds nothing but whitespace.
   *
   * A closing marker whose opening marker is gone is a mark of no type at
   * all: the type is written in the opening marker, and what is left says
   * only that some mark once ended there. It is deleted whatever type the
   * session remembers, because a leftover marker is not kept in the file. The
   * other two shapes are read from the opening marker that survives, so their
   * type is known, and a type this version does not write is never broken and
   * never deleted: only the version that wrote it knows what its markers mean.
   * A document note has no closing marker by design and no passage to empty,
   * so nothing but the loss of its own marker can end it, and that leaves
   * nothing in the file to delete.
   */
  private _isBroken(mark: IMark, source: string): boolean {
    if (!mark.open) {
      return true;
    }
    if (mark.type !== NOTE_TYPE) {
      return false;
    }
    if (!mark.close || !mark.passage) {
      return true;
    }
    return source.slice(mark.passage.start, mark.passage.end).trim() === '';
  }

  /**
   * Take every marker of every broken mark out of the file.
   *
   * Reached only through the settle a read arms, so a break is deleted only
   * once it has stood for that long.
   *
   * A document holding the reader's unsaved edits is left alone altogether.
   * A break that came from outside merges in while the reader types and is
   * deleted only once the document is clean; a break the reader made
   * themselves, by emptying a marked passage as they retype
   * it, is theirs to undo, and their undo must find the markers and the notes
   * still there. So is a pass that meets a write of this controller already in
   * flight.
   *
   * The markers are read again from the source of each attempt, inside the
   * write, so a write the server refuses deletes what is broken by the time it
   * is made again; only the marks the read saw broken are deleted, because
   * the refresh pulls newer content in and a break that arrived with it has
   * not settled at all. One pass does not always finish the work: deleting a
   * lone closing marker can empty the passage of a mark enclosing it, which
   * breaks that mark in turn. The deletion's own write is a content change
   * like any other, so the read that follows it arms the settle again,
   * carrying the newly broken mark, and the pass after it takes that mark
   * out. That terminates because every pass only ever removes markers, so the
   * file runs out of them.
   *
   * With the notes setting off nothing of the feature writes, the markers are
   * left as they are, and the settle is not armed again: a timer rescheduling
   * itself while the feature does nothing is waste.
   *
   * @param ids - the marks the read saw broken, which are the only ones this
   * pass may delete
   */
  private async _deleteBroken(ids: string[]): Promise<void> {
    if (!this._settings.notes) {
      return;
    }
    if (this._deleting || this._context.model.dirty) {
      this._armSettle(ids);
      return;
    }
    const settled = new Set(ids);
    this._deleting = true;
    try {
      // The refresh is what every write path makes first: it brings a change
      // waiting on disk into the document, so the save that may follow the
      // write is not met with the File Changed dialog.
      await this._refresh();
      if (this._disposed) {
        return;
      }
      const written = await this._write(source => {
        // The setting and the unsaved edits are read again here rather than
        // at entry alone: the refresh above is a round trip to the server,
        // and the reader may have turned notes off or begun typing while it
        // ran. This write is not undoable, so their note lines would be gone
        // beyond recall.
        if (!this._settings.notes || this._context.model.dirty) {
          return [];
        }
        const spans: ISpan[] = [];
        for (const mark of parseMarks(source)) {
          if (!settled.has(mark.id) || !this._isBroken(mark, source)) {
            continue;
          }
          for (const span of [mark.open, mark.close]) {
            if (span) {
              spans.push(span);
            }
          }
        }
        return markerEdits(source, spans);
      }, false);
      // Nothing was written: the pass refused inside the write, or the served
      // route would not take it. The read that follows arms the settle again,
      // so the deletion follows once the state that held it back has passed.
      if (!written) {
        this._read();
        // Except where the write gave up - the route turned it down, or was
        // never asked - which is not a state waiting mends: the read's settle
        // is disarmed, or every window would spend a refresh on a write that
        // has already stopped. The markers stay in the document they are
        // still in.
        if (this._writeGaveUp) {
          this._clearSettle();
        }
      }
    } finally {
      this._deleting = false;
    }
  }

  /**
   * A mark in the shape the panel lists it in.
   */
  private _listed(mark: IMark, source: string, scan: ISourceScan): IListedMark {
    return {
      ...mark,
      text: passageText(mark.passage, scan, source),
      position: mark.open ? mark.open.start / Math.max(source.length, 1) : 0,
      unanchored:
        mark.type === DOCUMENT_TYPE
          ? false
          : !mark.passage || this._lost.has(mark.id)
    };
  }

  /**
   * Paint every anchored passage of the current render.
   *
   * The painting of a render is left alone while it still says what the marks
   * say; anything else is taken out and made again, so a colour change, a new
   * mark and a removal all land, and no span of a mark that is gone is left
   * behind.
   */
  private _paint(): void {
    const root = this._root;
    if (this._disposed || !root) {
      return;
    }
    if (!this._settings.notes) {
      unpaintMarks(root);
      this._painted = null;
      return;
    }
    // Before the first render there is nothing to find a passage in, and a
    // mark is not unanchored for want of a render.
    if (!root.textContent?.trim()) {
      return;
    }
    const source = this._source;
    // The words of the source and the words of the render are the same for
    // every mark, so both are read once here rather than once per mark.
    const scan = tokeniseSource(source);
    const words = renderedWords(captureText(root).text);
    // While a change is decorated the text it added is held out of the
    // capture, so a passage inside it is not there to be found and says
    // nothing about the mark. The guard at the end of this pass has always
    // held the unanchored wording at what it last read, and the bars are
    // held the same way: at the marks that reading named.
    const decorated = !!root.querySelector(`.${DECORATION_CLASS}`);
    const anchored: IAnchored[] = [];
    const carets: ICaret[] = [];
    const lost = new Set<string>();
    for (const mark of this._marks) {
      // A document note paints nothing and stands nowhere, even one a
      // hand-written closing marker gave a passage: the panel names no
      // colour for it and lists it as anchored wherever its marker sits. A
      // mark with no opening marker is not listed at all and this list holds
      // none, but the place below is read off that marker.
      if (mark.type === DOCUMENT_TYPE || !mark.open) {
        continue;
      }
      // A closed mark is painted only while the closed marks are shown, and
      // stands nowhere while they are not.
      if (mark.closed && !this._showClosed) {
        continue;
      }
      if (mark.passage) {
        const range = passageToRendered(mark.passage, scan, words);
        if (range && range.end > range.start) {
          anchored.push({ mark, range });
          continue;
        }
        lost.add(mark.id);
      }
      // A mark already known to be unanchored is let through, and one this
      // render merely cannot find is given none: a bar there would stand
      // beside the very text that holds the passage. Holding every mark back
      // instead would take away the bar of a mark the change never touched,
      // and with it the only thing its row has to scroll to. A mark with no
      // closing marker is unanchored whatever any render says and never
      // enters that set, so it is named here rather than looked up.
      //
      // What is kept is the mark, not its place: the place is worked out
      // again below against a capture the decorated text is held out of, so
      // a mark whose words either side of the marker are both inside the
      // change loses its bar until the change settles. A remembered place
      // would be a place that change may have moved, and a wrong place is
      // answered here by drawing nothing rather than by drawing it.
      if (decorated && mark.passage && !this._lost.has(mark.id)) {
        continue;
      }
      // The mark is in the file and its passage is not in this render, so
      // the place its opening marker sits is all there is to show
      // (ACC-NOTES-180). The words after the closing marker are the fallback
      // side, which for a mark that lost that marker is the text the mark
      // opened on.
      const at = markerToRendered(
        mark.open.start,
        mark.close ? mark.close.end : mark.open.end,
        scan,
        words
      );
      if (at !== null) {
        carets.push({
          mark,
          at,
          text: passageText(mark.passage, scan, source)
        });
      }
    }

    const signature = [
      ...anchored.map(
        item =>
          `${item.mark.id} ${item.mark.colour} ${item.mark.closed} ${item.range.start}-${item.range.end} ${JSON.stringify(tooltip(item.mark))}`
      ),
      ...carets.map(
        caret =>
          `caret ${caret.mark.id} ${caret.mark.colour} ${caret.mark.closed} ${caret.at} ${JSON.stringify(caret.text)} ${JSON.stringify(tooltip(caret.mark))}`
      )
    ].join('\n');
    if (signature !== this._painted) {
      unpaintMarks(root);
      paintMarks(captureText(root), root, anchored, carets);
      this._painted = signature;
    }

    // A passage the render does not hold makes its mark unanchored, so the
    // panel says so rather than offering a row that leads nowhere. While a
    // change is decorated the text it added is held out of the capture, so a
    // passage inside it is not there to be found and says nothing about the
    // mark; the marks are painted again when the change settles.
    if (
      !decorated &&
      (lost.size !== this._lost.size ||
        [...lost].some(id => !this._lost.has(id)))
    ) {
      this._lost = lost;
      this._changed.emit();
    }
  }

  /**
   * Rewrite a mark's opening marker in place.
   *
   * The mark is read out of the document again rather than taken from the
   * last read, because the refresh may just have applied a change from disk.
   * A mark of a type this version does not write is left exactly as it is,
   * and so is one the change answers null for: nothing of it changes.
   *
   * @returns whether the marker was found and rewritten
   */
  private async _rewrite(
    id: string,
    change: (mark: IMark) => IMarkContent | null
  ): Promise<boolean> {
    await this._refresh();
    if (this._disposed) {
      return false;
    }
    return this._write(source => {
      const mark = parseMarks(source).find(
        found => found.id === id && found.open
      );
      if (!mark || !mark.open || !known(mark)) {
        return [];
      }
      const changed = change(mark);
      if (!changed) {
        return [];
      }
      return [
        {
          start: mark.open.start,
          end: mark.open.end,
          text: serialiseOpening(
            changed,
            inTableRow(source, mark.open.start) ||
              inQuote(source, mark.open.start)
          )
        }
      ];
    });
  }

  /**
   * Write edits into the document and put them on disk.
   *
   * The edits are computed from the source at the moment of writing, because
   * a write the server refuses is made again over the file as it is by then.
   *
   * With the document clean and the server extension present, the file is
   * written first, through the compare-and-write route: the server rewrites
   * it only while it still carries the revision the document holds, under a
   * lock, so two writes of one path from this server are serialised; a write
   * from another process that lands inside the server's own write is the
   * residual DEF-NOTES-33 records. A 409 carries the newer file; the
   * refresh brings it into the document through the watcher's normal path,
   * the edits are computed again and the write is made again, three times at
   * most; after that the write takes the Context path below, whose conflict
   * check raises the File Changed dialog against the newer file, which is
   * what a refresh that moves nothing comes to; with live updates off the
   * route is not taken at all.
   * On a 200 the same edits go into the document, which is then clean
   * because disk and document are equal, and the refresh that follows finds
   * them equal and moves the revision the Context holds. No save, so no File
   * Changed dialog.
   *
   * Without the route - a 404 carrying the server's HTML page rather than the
   * JSON a served answer carries, remembered for the session - the document
   * is written and saved through the Context, as before. A document that
   * already holds unsaved edits is written and not put on disk at all. The
   * preview and the editor share one document, so those edits are the
   * reader's own writing, and saving would put them on disk without being
   * asked. The marker stays in the document and reaches disk with the
   * reader's own next save.
   *
   * The edits go through one transaction, kept off the undo stack and tagged
   * as a mark, so every extension observing the model can tell it from typing
   * and from a change applied from disk.
   * They are made from the end backwards, so the offsets of the earlier ones
   * stand.
   *
   * @param edits - the edits to make, computed from the source of the attempt
   * @param mayCreateFile - whether this write may put the file back on disk
   * when the file may not be there. The route answers 404 for a file deleted
   * or renamed while the write was on its way, and the Context save would
   * create it again: the deletion of broken markers is the one write nobody
   * asked for, so it writes nothing unless the route wrote the file itself.
   * That covers the route's refusal, the route never asked because live
   * updates are off, and the route given up on after three refusals, since
   * the fallback save is the same save in all three. Every write the reader
   * made keeps the Context path whatever the route says. The guard holds only
   * while the route answers at all: where a lab has no server extension the
   * pre-route Context save stands, as it did before the route existed, but
   * only once the route has been asked, which needs live updates on.
   * @returns whether the edits were written into the document, which they
   * are not when there is nothing to write
   */
  private async _write(
    edits: (source: string) => ISourceEdit[],
    mayCreateFile = true
  ): Promise<boolean> {
    let route = !this._routeAbsent;
    let refusals = 0;
    // The record is the unprompted write's own, as its documentation says, so
    // a write the reader made neither sets it nor clears what the last
    // unprompted write left in it.
    if (!mayCreateFile) {
      this._writeGaveUp = false;
    }
    for (;;) {
      const source = this._source;
      const changes = edits(source).sort((a, b) => b.start - a.start);
      if (!changes.length) {
        return false;
      }
      const unsaved = this._context.model.dirty;
      const expected = this._context.contentsModel?.hash;
      // What the document holds once this write is in it, by whichever path:
      // the render on screen already shows that text, so a render of it is
      // dropped from here on.
      const written = applyEdits(source, changes);
      this._rememberWritten(source, written);
      let landed = false;
      if (
        !unsaved &&
        route &&
        this._settings.enabled &&
        typeof expected === 'string'
      ) {
        const { response, data } = await fetchAPI(
          'write',
          this._serverSettings,
          {
            method: 'POST',
            body: JSON.stringify({
              path: this._context.path,
              expected,
              content: this._lineEnded(written)
            })
          }
        );
        if (response.status === 409) {
          if (++refusals < 3) {
            await this._refresh();
            continue;
          }
          // Three refusals of one write: the refresh is not bringing the
          // newer file in, and the route would refuse the same revision for
          // ever. The write goes the way it
          // went before the route, and the Context's own conflict check on
          // the save is what tells the reader.
          route = false;
          continue;
        }
        if (response.status !== 200) {
          route = false;
          if (response.status === 404 && typeof data === 'string') {
            this._routeAbsent = true;
          }
          continue;
        }
        landed = true;
      }
      // Nothing reached disk through the route, and this write may not create
      // the file: the route turned it down, or it was never asked - live
      // updates are off, or there is no revision to compare - or three
      // refusals gave it up. Each of those falls to the Context save, which
      // would put a file that has gone back on disk. The write records that it
      // gave up, so the deletion that made it disarms its settle rather than
      // asking the same question every window for the life of the tab. A lab
      // with no served route is the exception, and only once the route has
      // been asked and answered for, which needs live updates on: nothing
      // answers there, so the pre-route save stands, as it did before the
      // route existed. With no served route and live updates off the markers
      // stay in the file and nothing is saved.
      if (!landed && !mayCreateFile && !this._routeAbsent) {
        this._writeGaveUp = true;
        return false;
      }
      // The preview closed while the route wrote: its document is not this
      // controller's to change any more.
      if (this._disposed) {
        return false;
      }
      if (landed && this._source !== source) {
        // The document moved while the route wrote: the watcher has already
        // brought the written file in, or the reader typed and the watcher
        // merged the written file in around the keystroke, or held it back
        // with no shadow to merge over. The edits computed against `source`
        // no longer fit, and the dirty state is the watcher's to keep.
        await this._refresh();
        // Read the marks now, for the same reason the write path below does:
        // the caller is handed an id and a command acts on it straight away;
        // and paint them on the render as it stands, which is the render of
        // the written file.
        this._flush();
        this._paint();
        // Only one of the states reaching this guard is known to have written
        // into the document: the watcher brought the written file in. When
        // the document moved to something else - a second external write
        // landed after the server wrote and before the answer came back, or
        // the reader typed with no shadow to merge over - the mark is on disk
        // and not in the document, and a caller told otherwise discards the
        // reader's draft over a note the document never took.
        return this._source === written;
      }
      const shared = this._context.model.sharedModel;
      shared.transact(
        () => {
          for (const edit of changes) {
            shared.updateSource(edit.start, edit.end, edit.text);
          }
        },
        false,
        MARK_ORIGIN
      );
      // Read the marks now rather than on the frame the change scheduled, so
      // what was just written is listed by the time the caller has its answer
      // and a command can act on the mark it made.
      this._flush();
      // The markers are comments the renderer leaves out, so the render on
      // screen is already the render of the written document: the marks are
      // painted on it now, in place, and the render the viewer schedules for
      // the change is dropped when it comes, as long as the document still
      // holds exactly what was written.
      this._rememberWritten(written, this._source);
      this._paint();
      if (landed) {
        this._context.model.dirty = false;
        await this._refresh();
      } else if (!unsaved) {
        await this._context.save();
      }
      return true;
    }
  }

  /**
   * The text with the line ending the file had when the Context loaded it.
   *
   * The Context holds a CRLF or CR file as LF and puts the line ending back
   * on its own save, from a record it keeps privately; a write that goes
   * round its save has to put it back the same way, or the file would change
   * its line endings with the first mark.
   */
  private _lineEnded(text: string): string {
    const ending = (this._context as unknown as { _lineEnding?: string | null })
      ._lineEnding;
    return ending ? text.replace(/\n/g, ending) : text;
  }

  private _widget: MarkdownDocument;
  private _context: DocumentRegistry.IContext<DocumentRegistry.ICodeModel>;
  private _refresh: () => Promise<void>;
  private _serverSettings: ServerConnection.ISettings;
  private _settings: INotesSettings;
  private _marks: IMark[] = [];
  private _lost = new Set<string>();
  private _state: PanelState = 'hidden';
  private _painted: string | null = null;
  private _showClosed = false;
  private _renderedSource: string | null = null;
  private _requestedSource: string | null = null;
  private _markedSource: string | null = null;
  private _markedTimer: number | null = null;
  private _selection: ISelectionRecord | null = null;
  private _routeAbsent = false;
  /**
   * Whether the last write that may not create the file - the deletion of
   * broken markers - stopped without writing anything: the served route
   * turned it down, or it was never asked, live updates being off or no
   * revision being there to compare. A write the reader made keeps the
   * Context path whatever the route says, so it leaves this alone.
   */
  private _writeGaveUp = false;
  private _deleting = false;
  /** Panel-state writes started and not yet returned. */
  private _panelWrites = 0;
  private _settleTimer: number | null = null;
  private _frame: number | null = null;
  private _disposed = false;
  private _changed = new Signal<this, void>(this);
  private _activated = new Signal<this, string>(this);
}
