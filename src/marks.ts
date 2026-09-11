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

/** Where the escaped notes of a single-line marker begin: the first entry head. */
const INLINE_NOTES =
  /(?:^|[ \t])@[A-Za-z0-9_.-]+ \d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z:/;

/**
 * The note lines of a marker written on one line, as a table row needs it
 * (ACC-NOTES-154): a newline is written as a backslash and n, a pipe as a
 * backslash and a pipe, so the row's cells stay where they are, and a
 * backslash is doubled so the two read back apart.
 */
function escapeInline(text: string): string {
  return text
    .replace(/\\/g, '\\\\')
    .replace(/\n/g, '\\n')
    .replace(/\|/g, '\\|');
}

/**
 * The inverse of {@link escapeInline}; any other backslash stays as it is.
 */
function unescapeInline(text: string): string {
  return text.replace(/\\([\\n|])/g, (_, char: string) =>
    char === 'n' ? '\n' : char
  );
}

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
 * One readable marker of a source.
 */
interface IMarker {
  id: string;
  span: ISpan;
  /** What an opening marker spells out, null for a closing marker. */
  content: IMarkContent | null;
}

/**
 * Every readable marker of a source, in document order.
 *
 * A marker the grammar does not admit is dropped here, once, so the pass that
 * finds the opened identifiers and the pass that builds the marks can never
 * disagree about which markers the source holds at all.
 */
function readMarkers(source: string): IMarker[] {
  const found: IMarker[] = [];

  for (const comment of comments(source)) {
    const closing = CLOSING.exec(comment.inner);
    if (closing) {
      found.push({ id: closing[1], span: comment.span, content: null });
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
    // A marker on one line never holds notes in the multi-line form, so a
    // tail that carries an entry head after the attributes is the escaped
    // form a table row takes (ACC-NOTES-154): the notes are unescaped and
    // read as the lines they stand for.
    let tail = opening[3];
    let escaped = '';
    if (split < 0) {
      const at = tail.search(INLINE_NOTES);
      if (at >= 0) {
        escaped = tail.slice(at).replace(/^[ \t]+|[ \t]+$/g, '');
        tail = tail.slice(0, at);
      }
    }
    const attributes = parseAttributes(tail);
    if (!attributes) {
      continue;
    }
    found.push({
      id: opening[1],
      span: comment.span,
      content: {
        id: opening[1],
        type: opening[2],
        attributes,
        notes: parseNotes(
          split < 0 ? unescapeInline(escaped) : comment.inner.slice(split + 1)
        )
      }
    });
  }

  return found;
}

/**
 * The identifiers an opening marker carries, wherever in the source it sits.
 */
function openedIds(markers: IMarker[]): Set<string> {
  const opened = new Set<string>();
  for (const marker of markers) {
    if (marker.content) {
      opened.add(marker.id);
    }
  }
  return opened;
}

/**
 * Every mark of a source, in the order its markers appear.
 *
 * Markers are paired by identifier rather than by nesting, so two marks whose
 * passages overlap are independent pairs and neither disturbs the other.
 *
 * An identifier names one mark. A reader who copies a marked passage in the
 * editor copies its markers with it, so a document can carry the same
 * identifier twice; the mark that identifier names is the one its first
 * opening marker begins, wherever the closing marker that ends it sits, and
 * only where the identifier carries no opening marker at all is a lone
 * closing marker the mark. Every marker that is not one of the two the mark
 * is made of is left in the source exactly as it stands, the way an
 * unreadable marker is. Everything downstream finds a mark by its identifier
 * - the panel's rows and open entries, the painted passages, the rewrite that
 * adds a note - so a second mark under one identifier would be a second row
 * holding the first one's note and a write landing on the wrong marker.
 */
export function parseMarks(source: string): IMark[] {
  const markers = readMarkers(source);
  const withOpening = openedIds(markers);
  const marks: IMark[] = [];
  // The one mark each identifier names, from the marker that began it
  // onwards, so a later marker repeating that identifier can be told apart
  // from a first one.
  const byId = new Map<string, IMark>();

  for (const marker of markers) {
    const mark = byId.get(marker.id);

    if (!marker.content) {
      if (mark) {
        // A closing marker pairs with its identifier's mark while that mark
        // is still waiting for one; a further closing marker repeats a pair
        // already made and is left where it is.
        if (mark.open && !mark.close) {
          mark.close = marker.span;
          mark.passage = { start: mark.open.end, end: marker.span.start };
        }
        continue;
      }
      // A closing marker whose identifier an opening marker further down the
      // source carries belongs to that opening marker's mark: the mark is
      // read below, and this marker stays where it stands. Only an identifier
      // with no opening marker anywhere is named by a lone closing marker,
      // which is the orphan the deletion of a broken mark takes out.
      if (withOpening.has(marker.id)) {
        continue;
      }
      const orphan: IMark = {
        id: marker.id,
        type: '',
        attributes: [],
        notes: [],
        colour: DEFAULT_COLOUR,
        open: null,
        close: marker.span,
        passage: null
      };
      marks.push(orphan);
      byId.set(orphan.id, orphan);
      continue;
    }

    // An opening marker repeating an identifier the document has already used
    // opens nothing: the mark is the one already read, and this marker is a
    // copy of its own text, which stays in the source untouched.
    if (mark) {
      continue;
    }
    const opened: IMark = {
      ...marker.content,
      colour: colourOf(marker.content.attributes),
      open: marker.span,
      close: null,
      passage: null
    };
    marks.push(opened);
    byId.set(opened.id, opened);
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
 * line, unless the marker is asked inline, when the note lines are escaped
 * onto the one line. Attributes are written in the order they are held, so
 * the ones this version does not define survive the rewrite.
 */
export function serialiseOpening(mark: IMarkContent, inline = false): string {
  const attributes = mark.attributes
    .map(attribute => ` ${attribute.key}=${serialiseValue(attribute.value)}`)
    .join('');
  const head = `mark:${mark.id} ${mark.type}${attributes}`;
  const lines = noteLines(mark.notes);
  if (!lines.length) {
    return `<!-- ${head} -->`;
  }
  // Inside a table row the marker must stay on its line (ACC-NOTES-154).
  return inline
    ? `<!-- ${head} ${escapeInline(lines.join('\n'))} -->`
    : `<!-- ${head}\n${lines.join('\n')}\n-->`;
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
