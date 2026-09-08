/**
 * The marker grammar: marks, note threads and the panel settings, all stored in
 * the Markdown file itself.
 *
 * A mark is a passage enclosed by two HTML comments sharing one identifier, or
 * the document as a whole under one opening comment of the document type, and
 * a note is a line inside the opening comment. The file alone carries
 * everything, so any Markdown renderer shows the document without a trace and an
 * agent rewriting the file can read and answer a thread as plain text.
 *
 * Everything here is a pure function over strings: no DOM, no document model.
 * Every parser is total - a marker that does not fit the grammar is ignored and
 * left in the source untouched, so a rewrite never destroys what it could not
 * read.
 */

/**
 * Colours a mark can carry: the set a Kindle offers, then red and green.
 */
export type MarkColour =
  'yellow' | 'blue' | 'pink' | 'orange' | 'red' | 'green';

/**
 * The six colours in the order the panel offers them.
 */
export const MARK_COLOURS: readonly MarkColour[] = [
  'yellow',
  'blue',
  'pink',
  'orange',
  'red',
  'green'
];

/**
 * Colour used when a marker names none, or names one this version cannot read.
 */
export const DEFAULT_COLOUR: MarkColour = 'yellow';

/** The type this version writes on a mark around a passage. */
export const NOTE_TYPE = 'note';

/**
 * The type of a note on the document as a whole: an opening marker with no
 * closing marker and no passage, on a line of its own at the top of the file,
 * holding its note lines like any mark.
 */
export const DOCUMENT_TYPE = 'document';

/**
 * Whether a mark is of a type this version writes, and so may be rewritten
 * and offered controls. A mark of any other type is listed but never
 * rewritten, so what a later version wrote survives.
 */
export function known(mark: { type: string }): boolean {
  return mark.type === NOTE_TYPE || mark.type === DOCUMENT_TYPE;
}

/**
 * States the notes panel can be in, stored in the settings marker.
 */
export type PanelState = 'expanded' | 'minimap' | 'hidden';

/**
 * The name of each panel state as the context menu, the palette and the
 * panel's own header offer it. Hiding names what it hides: the minimap while
 * the panel is one, the notes otherwise.
 */
export const PANEL_LABELS: Record<PanelState, string> = {
  expanded: 'Show notes',
  minimap: 'Show notes minimap',
  hidden: 'Hide notes'
};
export const HIDE_MINIMAP_LABEL = 'Hide minimap';

/**
 * A half-open range of source offsets: `start` is included, `end` is not.
 */
export interface ISpan {
  start: number;
  end: number;
}

/**
 * One `key=value` pair of an opening marker.
 *
 * The value is the decoded text, without the quotes a quoted value carries in
 * the source. Attributes this version does not define are kept here in their
 * order and spelling so a rewrite preserves them.
 */
export interface IMarkAttribute {
  key: string;
  value: string;
}

/**
 * One entry of a mark's note thread.
 *
 * `text` may hold several lines: a line inside the marker that does not open a
 * new entry continues the entry above it.
 */
export interface INoteEntry {
  /** Handle of whoever wrote the entry, empty for an entry without one. */
  author: string;
  /** UTC ISO 8601 stamp to the second, empty for an entry without one. */
  stamp: string;
  text: string;
}

/**
 * What an opening marker spells out, which is all a marker needs to be written.
 */
export interface IMarkContent {
  /** Lowercase version 4 UUID shared by the two markers of the pair. */
  id: string;
  /** Bare token after the identifier; this version writes `note` or `document`. */
  type: string;
  attributes: IMarkAttribute[];
  notes: INoteEntry[];
}

/**
 * A mark found in a source, with the places its markers sit.
 *
 * `close` and `passage` are null for an opening marker whose closing marker is
 * missing, and `open` is null for a closing marker whose opening marker is
 * missing. Either way the mark is unanchored and the panel says so, except a
 * mark of the document type, which has no passage and is anchored by its
 * opening marker alone.
 */
export interface IMark extends IMarkContent {
  /** Colour to render with: the `colour` attribute, or the default. */
  colour: MarkColour;
  open: ISpan | null;
  close: ISpan | null;
  /** The marked text, between the two markers. */
  passage: ISpan | null;
}

/**
 * Per-document settings held in the settings marker.
 */
export interface IMarksSettings {
  panel: PanelState;
}

/**
 * What a source says about the settings marker.
 */
export interface IParsedSettings {
  /** Settings read from the last readable marker, null when none reads. */
  settings: IMarksSettings | null;
  /**
   * Where every settings marker sits, in document order, readable or not. The
   * writer replaces all of them so a document ends up with exactly one.
   */
  markers: ISpan[];
}

/** Shape of the identifier `crypto.randomUUID` produces. */
const UUID =
  '[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}';

/** First line of an opening marker: identifier, type, then the attributes. */
const OPENING = new RegExp(
  `^\\s*mark:(${UUID})[ \\t]+([A-Za-z][A-Za-z0-9_-]*)[ \\t]*(.*)$`
);

/** A closing marker, which carries the identifier and nothing else. */
const CLOSING = new RegExp(`^\\s*/mark:(${UUID})\\s*$`);

/** The settings marker, which is always a single line. */
const SETTINGS = /^\s*marks:settings[ \t]*(.*)$/;

/** One attribute and the whitespace after it, matched where parsing stands. */
const ATTRIBUTE = /([a-z][a-z0-9-]*)=(?:"([^"]*)"|([^\s"]+))[ \t]*/y;

/** A line that opens a note entry. */
const ENTRY =
  /^@([A-Za-z0-9_.-]+) (\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z):[ ]?(.*)$/;

/**
 * One HTML comment of the source.
 */
interface IComment {
  /** Text between the delimiters. */
  inner: string;
  /** Bounds of the whole comment, delimiters included. */
  span: ISpan;
}

/**
 * Every HTML comment of the source in document order.
 *
 * A comment ends at its first `-->`, the way a browser reads it, so text a
 * marker carries can never swallow the document past that point.
 */
function comments(source: string): IComment[] {
  const found: IComment[] = [];
  let at = 0;
  for (;;) {
    const start = source.indexOf('<!--', at);
    if (start < 0) {
      return found;
    }
    const stop = source.indexOf('-->', start + 4);
    if (stop < 0) {
      return found;
    }
    const end = stop + 3;
    found.push({ inner: source.slice(start + 4, stop), span: { start, end } });
    at = end;
  }
}

/**
 * Read a run of `key=value` attributes, or null when the text holds anything
 * else, which makes the marker unreadable and so ignored.
 */
function parseAttributes(text: string): IMarkAttribute[] | null {
  const attributes: IMarkAttribute[] = [];
  let at = 0;
  while (at < text.length) {
    ATTRIBUTE.lastIndex = at;
    const match = ATTRIBUTE.exec(text);
    if (!match) {
      return null;
    }
    attributes.push({ key: match[1], value: match[2] ?? match[3] });
    at = ATTRIBUTE.lastIndex;
  }
  return attributes;
}

/**
 * The colour an attribute list asks for, falling back to the default.
 */
function colourOf(attributes: IMarkAttribute[]): MarkColour {
  const named = attributes.find(attribute => attribute.key === 'colour');
  const colour = named?.value as MarkColour | undefined;
  return colour && MARK_COLOURS.includes(colour) ? colour : DEFAULT_COLOUR;
}

/**
 * Drop the carriage return a file with CRLF endings leaves at the end of a line.
 */
function withoutReturn(line: string): string {
  return line.endsWith('\r') ? line.slice(0, -1) : line;
}

/**
 * Read the note lines that follow the first line of an opening marker.
 *
 * A line that does not open an entry continues the one above it, and a first
 * line that opens nothing becomes an entry without an author. Blank lines are
 * dropped, which is the inverse of writing: a blank line would end the
 * paragraph the marker sits in, so one is never written.
 */
function parseNotes(text: string): INoteEntry[] {
  const notes: INoteEntry[] = [];
  for (const raw of text.split('\n')) {
    const line = withoutReturn(raw);
    if (line.trim() === '') {
      continue;
    }
    const entry = ENTRY.exec(line);
    if (entry) {
      notes.push({ author: entry[1], stamp: entry[2], text: entry[3] });
      continue;
    }
    // A continuation that starts with '@' was written with one leading space so
    // it would not read as a new entry; take that space back off.
    const continued = line.startsWith(' @') ? line.slice(1) : line;
    const previous = notes[notes.length - 1];
    if (!previous) {
      notes.push({ author: '', stamp: '', text: continued });
    } else {
      previous.text = previous.text
        ? `${previous.text}\n${continued}`
        : continued;
    }
  }
  return notes;
}

/**
 * Every mark of a source, in the order its markers appear.
 *
 * Markers are paired by identifier rather than by nesting, so two marks whose
 * passages overlap are independent pairs and neither disturbs the other.
 */
export function parseMarks(source: string): IMark[] {
  const marks: IMark[] = [];
  // Identifier to the marks still waiting for their closing marker, oldest
  // first, so a repeated identifier pairs in the order it was opened.
  const pending = new Map<string, IMark[]>();

  for (const comment of comments(source)) {
    const closing = CLOSING.exec(comment.inner);
    if (closing) {
      const waiting = pending.get(closing[1]);
      const mark = waiting?.shift();
      if (mark && mark.open) {
        mark.close = comment.span;
        mark.passage = { start: mark.open.end, end: comment.span.start };
      } else {
        marks.push({
          id: closing[1],
          type: '',
          attributes: [],
          notes: [],
          colour: DEFAULT_COLOUR,
          open: null,
          close: comment.span,
          passage: null
        });
      }
      continue;
    }

    const split = comment.inner.indexOf('\n');
    const first = withoutReturn(
      split < 0 ? comment.inner : comment.inner.slice(0, split)
    );
    const opening = OPENING.exec(first);
    if (!opening) {
      continue;
    }
    const attributes = parseAttributes(opening[3]);
    if (!attributes) {
      continue;
    }
    const mark: IMark = {
      id: opening[1],
      type: opening[2],
      attributes,
      notes: parseNotes(split < 0 ? '' : comment.inner.slice(split + 1)),
      colour: colourOf(attributes),
      open: comment.span,
      close: null,
      passage: null
    };
    marks.push(mark);
    const waiting = pending.get(mark.id);
    if (waiting) {
      waiting.push(mark);
    } else {
      pending.set(mark.id, [mark]);
    }
  }

  return marks;
}

/**
 * Write an attribute value, quoting only what would not read back bare.
 */
function serialiseValue(value: string): string {
  return value === '' || /\s/.test(value) ? `"${value}"` : value;
}

/**
 * Write a line that continues an entry.
 *
 * A continuation starting with '@' would read as a new entry, so it takes one
 * leading space, which reading takes back off.
 */
function continuationLine(line: string): string {
  return line.startsWith('@') ? ` ${line}` : line;
}

/**
 * Write a note thread as the lines that sit inside the opening marker.
 *
 * `-->` in the text becomes `-- >` so it cannot end the comment early, and
 * blank lines are dropped so the marker cannot end the paragraph it sits in.
 * Both rules are idempotent, so rewriting a marker repeatedly does not drift.
 */
function noteLines(notes: INoteEntry[]): string[] {
  const lines: string[] = [];
  for (const note of notes) {
    const body = note.text
      .replace(/-->/g, '-- >')
      .split('\n')
      .filter(line => line.trim() !== '');
    if (!note.author) {
      lines.push(...body.map(continuationLine));
      continue;
    }
    const head = `@${note.author} ${note.stamp}:`;
    lines.push(body.length ? `${head} ${body[0]}` : head);
    lines.push(...body.slice(1).map(continuationLine));
  }
  return lines;
}

/**
 * Write the opening marker of a mark.
 *
 * A bare mark is one line; with notes the comment closes with `-->` on its own
 * line. Attributes are written in the order they are held, so the ones this
 * version does not define survive the rewrite.
 */
export function serialiseOpening(mark: IMarkContent): string {
  const attributes = mark.attributes
    .map(attribute => ` ${attribute.key}=${serialiseValue(attribute.value)}`)
    .join('');
  const head = `mark:${mark.id} ${mark.type}${attributes}`;
  const lines = noteLines(mark.notes);
  return lines.length
    ? `<!-- ${head}\n${lines.join('\n')}\n-->`
    : `<!-- ${head} -->`;
}

/**
 * Write the closing marker of a mark.
 */
export function serialiseClosing(id: string): string {
  return `<!-- /mark:${id} -->`;
}

/**
 * Read the settings marker.
 *
 * Every settings marker is reported so the writer can replace all of them, and
 * one that cannot be read contributes no settings, which leaves the panel on
 * its default until the next change rewrites the marker.
 */
export function parseSettings(source: string): IParsedSettings {
  const markers: ISpan[] = [];
  let settings: IMarksSettings | null = null;

  for (const comment of comments(source)) {
    const marker = SETTINGS.exec(comment.inner);
    if (!marker) {
      continue;
    }
    markers.push(comment.span);
    const attributes = parseAttributes(marker[1]);
    const panel = attributes?.find(attribute => attribute.key === 'panel')
      ?.value as PanelState | undefined;
    if (panel === 'expanded' || panel === 'minimap' || panel === 'hidden') {
      settings = { panel };
    }
  }

  return { settings, markers };
}

/**
 * Write the settings marker whole.
 *
 * Only the keys this version knows are emitted, so a key it no longer writes
 * disappears from the document instead of accumulating.
 */
export function serialiseSettings(state: IMarksSettings): string {
  return `<!-- marks:settings panel=${state.panel} -->`;
}

/**
 * A new mark identifier.
 *
 * `crypto.randomUUID` is only exposed in a secure context, and a lab served
 * over plain HTTP is not one, so the random bytes are shaped into a version 4
 * UUID by hand where it is missing.
 */
export function newId(): string {
  const source = globalThis.crypto;
  if (typeof source.randomUUID === 'function') {
    return source.randomUUID();
  }
  const bytes = new Uint8Array(16);
  source.getRandomValues(bytes);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, byte =>
    byte.toString(16).padStart(2, '0')
  ).join('');
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20)
  ].join('-');
}
