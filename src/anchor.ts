/**
 * Alignment between the Markdown source and the rendered text.
 *
 * A mark is stored in the source but made by selecting rendered text, so the
 * extension has to translate between the two. Both sides are reduced to the
 * same thing, a sequence of words, and matched: the rendered words come from
 * the captured render, the source words from a light stripper that drops what
 * the renderer does not show. Matching words rather than offsets keeps the
 * translation independent of the parser, the same reason the change highlight
 * works on rendered text.
 *
 * The stripper also records the spans a marker must never be placed inside -
 * a code block, a heading, a link, an emphasis span, inline code, an HTML tag
 * or another marker - so a selection boundary that falls in one is widened to
 * the outer bound of that span.
 *
 * Two placement rules follow from how CommonMark reads a comment, and both
 * were confirmed against the renderer the viewer uses:
 *
 * - an opening marker at the start of a line makes the rest of that line an
 *   HTML block, which splits the paragraph in two, so the marker goes at the
 *   end of the previous line instead, or on its own line when the line is the
 *   first of its block
 * - a marker alone on its own line is an HTML block that renders to a comment
 *   node, which the sibling extension counting rendered children against
 *   source blocks skips, so it costs no block
 *
 * Nothing here writes to the document or the DOM: the caller inserts the
 * markers at the offsets returned.
 */

import { tokenize } from './diff';
import { captureText, ITextSnapshot } from './highlight';

/**
 * One text node and its range in the captured text.
 *
 * `src/highlight.ts` keeps the type internal, so it is read off the snapshot.
 */
type ITextSpan = ITextSnapshot['spans'][number];

/**
 * One word of the source as the renderer shows it.
 */
export interface ISourceToken {
  /** The word without the syntax that produced it. */
  text: string;
  /** Offset in the source of the word's first kept character. */
  start: number;
  /** Offset in the source just past the word's last kept character. */
  end: number;
  /** Index of the top-level block, blocks being separated by blank lines. */
  block: number;
}

/**
 * A kind of source span a marker is never placed inside.
 */
export type ProtectedKind =
  | 'code-block'
  | 'heading'
  | 'link'
  | 'image'
  | 'emphasis'
  | 'code'
  | 'html'
  | 'comment';

/**
 * A span of the source a marker is never placed inside, with its outer
 * bounds: a boundary that falls in one is widened to them.
 */
export interface IProtectedSpan {
  kind: ProtectedKind;
  /** Offset of the span's first character. */
  start: number;
  /** Offset just past the span's last character. */
  end: number;
}

/**
 * The words of a source and the spans a marker must stay out of.
 */
export interface ISourceScan {
  tokens: ISourceToken[];
  protectedSpans: IProtectedSpan[];
}

/**
 * Where the two markers of a mark are inserted in the source.
 *
 * `start` and `end` are insertion points, not a slice: the opening marker goes
 * at `start`, the closing marker at `end`, and the closing one is inserted
 * first so `start` stays valid. A marker that goes on its own line carries its
 * own newline - the opening marker is written as `<marker>\n` at `start`, the
 * closing one as `\n<marker>` at `end`.
 */
export interface ISourceRange {
  start: number;
  end: number;
  /** Whether the opening marker goes on its own line before the block. */
  startOwnLine: boolean;
  /**
   * Text written ahead of the opening marker: a leading pipe when the marker
   * would start a table row that has none.
   */
  startPrefix: string;
  /** Whether the closing marker goes on its own line after the block. */
  endOwnLine: boolean;
}

/**
 * A range of a mark's passage in the captured rendered text, `[start, end)`.
 */
export interface IRenderedRange {
  start: number;
  end: number;
}

/**
 * One word of a captured rendered text, with its offsets in that text.
 */
export interface IRenderedWord {
  text: string;
  start: number;
  end: number;
}

/**
 * A mark's passage, the source between its two markers.
 */
export interface IPassage {
  start: number;
  end: number;
}

/**
 * What {@link selectionOffsets} reads of a selection.
 *
 * A DOM `Range` has these four members, so the caller passes the range of the
 * live selection; nothing else about it is used.
 */
export interface ISelectionRange {
  startContainer: Node;
  startOffset: number;
  endContainer: Node;
  endOffset: number;
}

/**
 * Spans whose outer bound is the whole block, so the marker cannot stay
 * inline: it goes on its own line before or after the block.
 */
const OWN_LINE: ReadonlySet<ProtectedKind> = new Set<ProtectedKind>([
  'code-block',
  'heading'
]);

const BLANK = /^[ \t]*$/;
const FENCE = /^[ \t]{0,3}(`{3,}|~{3,})/;
const INDENT = /^(?: {4}|\t)/;
const THEMATIC = /^[ \t]{0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/;
const QUOTE = /^(?:[ \t]{0,3}>[ \t]?)+/;
const HEADING = /^[ \t]{0,3}#{1,6}(?:[ \t]+|$)/;
const CLOSING_HASHES = /[ \t]+#+[ \t]*$/;
const BULLET = /^[ \t]{0,3}(?:[-+*]|\d{1,9}[.)])[ \t]+/;
const ALERT = /^\[![A-Za-z]+\][ \t]*$/;
const SEPARATOR = /^[\s|:-]+$/;
const AUTOLINK = /^<([A-Za-z][A-Za-z0-9+.-]*:[^<>\s]*|[^<>\s@]+@[^<>\s]+)>/;
const TAG = /^<\/?[A-Za-z][^<>]*>/;
const PUNCTUATION = /[!-/:-@[-`{-~]/;
const DELIMITER = /[*_~]/;
const WORD = /[A-Za-z0-9]/;
const SPACE = /\s/;

/**
 * The lines of a source, as offset ranges that exclude the line break.
 */
function lineRanges(source: string): Array<{ start: number; end: number }> {
  const lines: Array<{ start: number; end: number }> = [];
  let start = 0;
  for (let i = 0; i <= source.length; i++) {
    if (i === source.length || source[i] === '\n') {
      let end = i;
      if (end > start && source[end - 1] === '\r') {
        end--;
      }
      lines.push({ start, end });
      start = i + 1;
    }
  }
  return lines;
}

/**
 * Whether a line closes an open fence.
 */
function closesFence(raw: string, char: string, length: number): boolean {
  const match = /^[ \t]{0,3}(`{3,}|~{3,})[ \t]*$/.exec(raw);
  return match !== null && match[1][0] === char && match[1].length >= length;
}

/**
 * Whether a line is the dashes-and-pipes row under a table header.
 */
function isSeparator(raw: string): boolean {
  return SEPARATOR.test(raw) && raw.includes('|') && raw.includes('-');
}

/**
 * Read the words of a Markdown source, with the spans a marker must stay out
 * of.
 *
 * The stripper is deliberately light: it removes fences, heading hashes, list
 * bullets, blockquote markers, table pipes and separator rows, emphasis and
 * strong delimiters, inline code backticks, link and image syntax (keeping
 * the text and the alt), autolink brackets, HTML tags, HTML comments and the
 * alert line of a GitHub alert. What remains is what the reader sees, so its
 * words match the words of the render.
 *
 * @param source - the Markdown source
 */
export function tokeniseSource(source: string): ISourceScan {
  const tokens: ISourceToken[] = [];
  const spans: IProtectedSpan[] = [];

  let block = -1;
  let open = false;
  let word = '';
  let wordStart = 0;
  let wordEnd = 0;

  const flush = (): void => {
    if (word) {
      tokens.push({ text: word, start: wordStart, end: wordEnd, block });
      word = '';
    }
  };

  const keep = (at: number, char: string): void => {
    if (!word) {
      wordStart = at;
    }
    word += char;
    wordEnd = at + 1;
  };

  // Text of a code block or of a link's destination-free run: kept as it is,
  // with no inline syntax read out of it.
  const plain = (from: number, to: number): void => {
    for (let i = from; i < to; i++) {
      if (SPACE.test(source[i])) {
        flush();
      } else {
        keep(i, source[i]);
      }
    }
  };

  // Every scanner below returns the offset past what it read, or -1 when the
  // character it started on is ordinary text after all. A return past `to`
  // means the construct ran on to a later line, which only an HTML comment
  // does.

  const angle = (i: number, to: number): number => {
    if (source.startsWith('<!--', i)) {
      const close = source.indexOf('-->', i + 4);
      const stop = close < 0 ? source.length : close + 3;
      spans.push({ kind: 'comment', start: i, end: stop });
      return stop;
    }
    const rest = source.slice(i, to);
    const auto = AUTOLINK.exec(rest);
    if (auto) {
      spans.push({ kind: 'link', start: i, end: i + auto[0].length });
      for (let j = 0; j < auto[1].length; j++) {
        keep(i + 1 + j, auto[1][j]);
      }
      return i + auto[0].length;
    }
    const tag = TAG.exec(rest);
    if (tag) {
      // A br is a line break in the render, where the words either side of
      // it are two words, so it ends the word here too; any other tag sits
      // inside the word it interrupts (DEF-NOTES-86). The parser makes a br
      // of the end-tag spelling as well.
      if (/^<\/?br\b/i.test(tag[0])) {
        flush();
      }
      spans.push({ kind: 'html', start: i, end: i + tag[0].length });
      return i + tag[0].length;
    }
    return -1;
  };

  const codeSpan = (i: number, to: number): number => {
    let run = i;
    while (run < to && source[run] === '`') {
      run++;
    }
    const length = run - i;
    let j = run;
    while (j < to) {
      if (source[j] !== '`') {
        j++;
        continue;
      }
      let k = j;
      while (k < to && source[k] === '`') {
        k++;
      }
      if (k - j === length) {
        spans.push({ kind: 'code', start: i, end: k });
        plain(run, j);
        return k;
      }
      j = k;
    }
    return -1;
  };

  const emphasis = (i: number, to: number): number => {
    const char = source[i];
    // An underscore between word characters is not a delimiter, so
    // snake_case names keep their underscores.
    if (char === '_' && i > 0 && WORD.test(source[i - 1])) {
      return -1;
    }
    let run = i;
    while (run < to && source[run] === char) {
      run++;
    }
    const length = run - i;
    if (length > 3) {
      return -1;
    }
    let j = run;
    while (j < to) {
      if (source[j] !== char) {
        j++;
        continue;
      }
      let k = j;
      while (k < to && source[k] === char) {
        k++;
      }
      if (k - j >= length) {
        spans.push({ kind: 'emphasis', start: i, end: j + length });
        inline(run, j, false);
        return j + length;
      }
      j = k;
    }
    return -1;
  };

  const link = (i: number, to: number, image: boolean): number => {
    const from = i + (image ? 2 : 1);
    let depth = 1;
    let j = from;
    while (j < to && depth > 0) {
      const char = source[j];
      if (char === '\\') {
        j += 2;
        continue;
      }
      if (char === '[') {
        depth++;
      } else if (char === ']') {
        depth--;
      }
      j++;
    }
    if (depth > 0) {
      return -1;
    }
    const textEnd = j - 1;
    const after = source[j];
    // A shortcut reference renders with its brackets, so it is ordinary text.
    if (after !== '(' && after !== '[') {
      return -1;
    }
    const close = source.indexOf(after === '(' ? ')' : ']', j);
    if (close < 0 || close >= to) {
      return -1;
    }
    spans.push({ kind: image ? 'image' : 'link', start: i, end: close + 1 });
    inline(from, textEnd, false);
    return close + 1;
  };

  const inline = (from: number, to: number, pipes: boolean): number => {
    let i = from;
    while (i < to) {
      const char = source[i];
      if (char === '\\' && i + 1 < to && PUNCTUATION.test(source[i + 1])) {
        keep(i + 1, source[i + 1]);
        i += 2;
        continue;
      }
      let next = -1;
      if (char === '<') {
        next = angle(i, to);
      } else if (char === '`') {
        next = codeSpan(i, to);
      } else if (char === '!' && source[i + 1] === '[') {
        next = link(i, to, true);
      } else if (char === '[') {
        next = link(i, to, false);
      } else if (DELIMITER.test(char)) {
        next = emphasis(i, to);
      }
      if (next >= 0) {
        i = next;
        if (i > to) {
          return i;
        }
        continue;
      }
      if (char === '|' && pipes) {
        flush();
      } else if (SPACE.test(char)) {
        flush();
      } else {
        keep(i, char);
      }
      i++;
    }
    return i;
  };

  let fence: { char: string; length: number; start: number } | null = null;
  let indented: { start: number; end: number } | null = null;
  let skipTo = 0;

  for (const line of lineRanges(source)) {
    // A comment that began on an earlier line runs through this one.
    if (skipTo > line.start) {
      if (skipTo >= line.end) {
        continue;
      }
      skipTo = inline(skipTo, line.end, false);
      flush();
      continue;
    }

    const raw = source.slice(line.start, line.end);

    if (fence) {
      if (closesFence(raw, fence.char, fence.length)) {
        spans.push({ kind: 'code-block', start: fence.start, end: line.end });
        fence = null;
      } else {
        plain(line.start, line.end);
      }
      flush();
      continue;
    }

    if (BLANK.test(raw)) {
      flush();
      open = false;
      if (indented) {
        spans.push({
          kind: 'code-block',
          start: indented.start,
          end: indented.end
        });
        indented = null;
      }
      continue;
    }

    const started = !open;
    if (started) {
      block++;
      open = true;
    }

    const fenced = FENCE.exec(raw);
    if (fenced) {
      fence = {
        char: fenced[1][0],
        length: fenced[1].length,
        start: line.start
      };
      flush();
      continue;
    }

    // An indented code block only starts a block; the same indentation inside
    // one is a continuation line of a list item and reads as ordinary text.
    if (INDENT.test(raw) && (indented || started)) {
      indented = indented ?? { start: line.start, end: line.end };
      indented.end = line.end;
      plain(line.start, line.end);
      flush();
      continue;
    }
    if (indented) {
      spans.push({
        kind: 'code-block',
        start: indented.start,
        end: indented.end
      });
      indented = null;
    }

    if (THEMATIC.test(raw) || isSeparator(raw)) {
      flush();
      continue;
    }

    let at = line.start;
    const quote = QUOTE.exec(raw);
    if (quote) {
      at += quote[0].length;
    }
    const rest = source.slice(at, line.end);

    if (ALERT.test(rest)) {
      flush();
      continue;
    }

    const heading = HEADING.exec(rest);
    if (heading) {
      spans.push({ kind: 'heading', start: line.start, end: line.end });
      at += heading[0].length;
      const closing = CLOSING_HASHES.exec(source.slice(at, line.end));
      skipTo = inline(at, closing ? at + closing.index : line.end, false);
      flush();
      continue;
    }

    const bullet = BULLET.exec(rest);
    if (bullet) {
      at += bullet[0].length;
    }
    skipTo = inline(at, line.end, /^[ \t]*\|/.test(rest));
    flush();
  }

  if (fence) {
    spans.push({ kind: 'code-block', start: fence.start, end: source.length });
  }
  if (indented) {
    spans.push({
      kind: 'code-block',
      start: indented.start,
      end: indented.end
    });
  }
  flush();

  return { tokens, protectedSpans: spans };
}

/**
 * Start indices of every occurrence of a token sequence.
 */
function occurrences(needle: string[], hay: string[]): number[] {
  const found: number[] = [];
  const last = hay.length - needle.length;
  for (let i = 0; i <= last; i++) {
    let all = true;
    for (let j = 0; j < needle.length; j++) {
      if (hay[i + j] !== needle[j]) {
        all = false;
        break;
      }
    }
    if (all) {
      found.push(i);
    }
  }
  return found;
}

/**
 * The occurrence closest to a hint, or -1 when there is none.
 */
function nearest(found: number[], hint: number): number {
  let best = -1;
  let distance = Number.POSITIVE_INFINITY;
  for (const at of found) {
    const gap = Math.abs(at - hint);
    if (gap < distance) {
      best = at;
      distance = gap;
    }
  }
  return best;
}

/**
 * Find a sequence of words in another sequence.
 *
 * The same words often appear several times in a document, so the occurrence
 * nearest the hint wins. When the whole sequence is absent - the render and
 * the source disagree somewhere in the middle, an extension having changed
 * what is shown - the first two and then the last two words are tried, which
 * still pins the passage down to a word.
 *
 * @param needle - the words to find
 * @param hay - the words to find them in
 * @param hint - the index in `hay` the answer is expected near
 * @returns the index in `hay` where the sequence starts, or -1
 */
export function locate(needle: string[], hay: string[], hint: number): number {
  if (!needle.length || !hay.length) {
    return -1;
  }
  const exact = nearest(occurrences(needle, hay), hint);
  if (exact >= 0) {
    return exact;
  }
  if (needle.length <= 2) {
    return -1;
  }
  const head = nearest(occurrences(needle.slice(0, 2), hay), hint);
  if (head >= 0) {
    return head;
  }
  const tail = nearest(
    occurrences(needle.slice(-2), hay),
    hint + needle.length - 2
  );
  return tail >= 0 ? Math.max(tail - (needle.length - 2), 0) : -1;
}

/**
 * Move an offset out of every protected span it falls inside.
 *
 * @param spans - the protected spans of the source
 * @param offset - the boundary to widen
 * @param side - which end of the mark the boundary is
 * @returns the widened offset, and whether it reached the bound of a whole
 * block, where the marker can only go on its own line
 */
function widen(
  spans: IProtectedSpan[],
  offset: number,
  side: 'start' | 'end'
): { at: number; ownLine: boolean } {
  let at = offset;
  let ownLine = false;
  let moved = true;
  while (moved) {
    moved = false;
    for (const span of spans) {
      // A closing boundary that sits exactly on the end of a span is on the
      // bound of that span, not past it: an indented block ends where its
      // last word ends, so a strict test would leave the marker in the code.
      const inside =
        side === 'end'
          ? span.start < at && at <= span.end
          : span.start < at && at < span.end;
      if (inside) {
        const to = side === 'start' ? span.start : span.end;
        moved = moved || to !== at;
        at = to;
        ownLine = ownLine || OWN_LINE.has(span.kind);
      }
    }
  }
  return { at, ownLine };
}

/**
 * Everything a line may hold before its text without being text itself.
 */
const LINE_PREFIX = /^[ \t>]*(?:(?:[-+*]|\d{1,9}[.)])[ \t]+)?$/;

/**
 * Whether an offset sits on a row of a table: a run of lines without a blank
 * one, holding a separator row with a line of pipes before it, from that
 * header line on. The table can sit in a blockquote, and can follow a text
 * line with no blank between; the run ends where the quote depth changes.
 */
export function inTableRow(source: string, offset: number): boolean {
  const lines = lineRanges(source).map(range => {
    const raw = source.slice(range.start, range.end);
    return {
      ...range,
      quote: (raw.match(QUOTE)?.[0] ?? '').replace(/[ \t]/g, ''),
      text: raw.replace(QUOTE, '')
    };
  });
  let first = 0;
  for (let i = 0; i < lines.length; i++) {
    // A change of quote depth ends the block, and the table with it.
    if (i > 0 && lines[i].quote !== lines[i - 1].quote) {
      first = i;
    }
    if (BLANK.test(lines[i].text)) {
      first = i + 1;
      continue;
    }
    if (lines[i].start <= offset && offset <= lines[i].end) {
      const last = Math.min(i + 1, lines.length - 1);
      for (let j = first + 1; j <= last; j++) {
        if (isSeparator(lines[j].text) && lines[j - 1].text.includes('|')) {
          return true;
        }
      }
      return false;
    }
  }
  return false;
}

/**
 * Place the opening marker so it never starts a line.
 *
 * CommonMark reads `<!--` at the start of a line as an HTML block and takes
 * the rest of the line into it, which splits the paragraph. A marker that
 * would land there goes at the end of the previous line, or, when the line is
 * the first of its block and has no previous line to go to, on a line of its
 * own before the block.
 *
 * @param source - the Markdown source
 * @param offset - where the marker would go
 * @param ownLine - whether the widening already put it on its own line
 */
function placeOpening(
  source: string,
  offset: number,
  ownLine: boolean
): { at: number; ownLine: boolean; prefix: string } {
  if (ownLine) {
    return { at: offset, ownLine, prefix: '' };
  }
  const lineStart = source.lastIndexOf('\n', offset - 1) + 1;
  const before = source.slice(lineStart, offset);
  if (!LINE_PREFIX.test(before)) {
    return { at: offset, ownLine: false, prefix: '' };
  }
  // A line of its own inside a table would end the table, and so would a
  // marker at the start of a row without a leading pipe, which opens an HTML
  // block: that row gets the pipe, which changes no cell (ACC-NOTES-154).
  // LINE_PREFIX has already excluded a pipe from what precedes the marker, so
  // the row never has one.
  if (inTableRow(source, offset)) {
    return { at: offset, ownLine: false, prefix: '| ' };
  }
  if (lineStart === 0) {
    return { at: lineStart, ownLine: true, prefix: '' };
  }
  const previousStart = source.lastIndexOf('\n', lineStart - 2) + 1;
  const previous = source.slice(previousStart, lineStart - 1);
  if (BLANK.test(previous)) {
    return { at: lineStart, ownLine: true, prefix: '' };
  }
  return { at: lineStart - 1, ownLine: false, prefix: '' };
}

/**
 * The words of a rendered text, with their offsets in it.
 *
 * Exported because a caller translating several passages of one render scans
 * that render once and passes the words to {@link passageToRendered}.
 */
export function renderedWords(text: string): IRenderedWord[] {
  const words: IRenderedWord[] = [];
  let at = 0;
  for (const token of tokenize(text)) {
    if (/\S/.test(token)) {
      words.push({ text: token, start: at, end: at + token.length });
    }
    at += token.length;
  }
  return words;
}

/**
 * Whether one node is another or comes after it in document order.
 */
function atOrAfter(node: Node, reference: Node): boolean {
  return (
    node === reference ||
    (reference.compareDocumentPosition(node) &
      Node.DOCUMENT_POSITION_FOLLOWING) !==
      0
  );
}

/**
 * Whether one node is another, is inside it, or comes before it.
 */
function atOrBefore(node: Node, reference: Node): boolean {
  const where = reference.compareDocumentPosition(node);
  return (
    node === reference ||
    (where &
      (Node.DOCUMENT_POSITION_PRECEDING |
        Node.DOCUMENT_POSITION_CONTAINED_BY)) !==
      0
  );
}

/**
 * Offset in the captured text of one end of a selection.
 *
 * A boundary usually sits in a text node the capture read, and then the
 * answer is exact. A boundary on an element, or in a node the capture skipped
 * such as a decoration left by a change, is answered with the nearest
 * captured text on the side the boundary faces; the caller snaps to whole
 * words afterwards, so the small imprecision is absorbed.
 */
function boundaryOffset(
  snapshot: ITextSnapshot,
  node: Node,
  offset: number,
  side: 'start' | 'end'
): number | null {
  const direct = snapshot.spans.find(span => span.node === node);
  if (direct) {
    const length = direct.end - direct.start;
    return direct.start + Math.min(Math.max(offset, 0), length);
  }
  const children = node.childNodes;
  const element = node.nodeType !== Node.TEXT_NODE && children.length > 0;
  const past = element && offset >= children.length;
  const reference = element
    ? children[Math.min(offset, children.length - 1)]
    : node;
  if (side === 'start' && !past) {
    const first = snapshot.spans.find(span => atOrAfter(span.node, reference));
    return first ? first.start : null;
  }
  let last: ITextSpan | null = null;
  for (const span of snapshot.spans) {
    if (atOrBefore(span.node, past ? node : reference)) {
      last = span;
    }
  }
  return last ? last.end : null;
}

/**
 * Where a selection sits in the captured text of the rendered view.
 *
 * Exported apart from {@link renderedToSource} because the two are read at
 * different moments: the offsets are taken when the selection is made, and
 * the source range only when the mark is written, by which time the render
 * may have been replaced and the live selection with it.
 *
 * @param selection - the selected range of the rendered view, usually
 * `window.getSelection()!.getRangeAt(0)`
 * @param root - the rendered Markdown host
 * @returns the range `[start, end)` of the selection in the text
 * {@link captureText} reads from `root`, or null when it holds nothing
 */
export function selectionOffsets(
  selection: ISelectionRange,
  root: HTMLElement
): IRenderedRange | null {
  const snapshot = captureText(root);
  const from = boundaryOffset(
    snapshot,
    selection.startContainer,
    selection.startOffset,
    'start'
  );
  const to = boundaryOffset(
    snapshot,
    selection.endContainer,
    selection.endOffset,
    'end'
  );
  return from === null || to === null || to <= from
    ? null
    : { start: from, end: to };
}

/**
 * Translate a range of the rendered text into the source range a mark's
 * markers are written at.
 *
 * The range is snapped outward to whole words, matched against the words of
 * the source, and each boundary widened out of any span a marker may not sit
 * inside. A range crossing block boundaries anchors from the first word of the
 * first block to the last word of the last, so the markers stay inline in
 * those two blocks.
 *
 * @param range - offsets into the text {@link captureText} reads from `root`
 * @param root - the rendered Markdown host
 * @param source - the Markdown source behind that render
 * @returns where the two markers go, or null when the words in the range
 * cannot be found in the source
 */
export function renderedToSource(
  range: IRenderedRange,
  root: HTMLElement,
  source: string
): ISourceRange | null {
  const words = renderedWords(captureText(root).text);
  if (!words.length) {
    return null;
  }
  const first = words.findIndex(word => word.end > range.start);
  let last = -1;
  for (let i = words.length - 1; i >= 0; i--) {
    if (words[i].start < range.end) {
      last = i;
      break;
    }
  }
  if (first < 0 || last < first) {
    return null;
  }

  const scan = tokeniseSource(source);
  const hay = scan.tokens.map(token => token.text);
  const needle = words.slice(first, last + 1).map(word => word.text);
  const hint = Math.round((first / words.length) * hay.length);
  const at = locate(needle, hay, hint);
  if (at < 0) {
    return null;
  }
  const startToken = scan.tokens[at];
  const endToken =
    scan.tokens[Math.min(at + needle.length - 1, scan.tokens.length - 1)];

  const opening = widen(scan.protectedSpans, startToken.start, 'start');
  const closing = widen(scan.protectedSpans, endToken.end, 'end');
  const placed = placeOpening(source, opening.at, opening.ownLine);
  if (closing.at <= placed.at) {
    return null;
  }
  return {
    start: placed.at,
    end: closing.at,
    startOwnLine: placed.ownLine,
    startPrefix: placed.prefix,
    endOwnLine: closing.ownLine
  };
}

/**
 * Find a mark's passage in the rendered text.
 *
 * Takes the passage rather than the mark so this module stays free of the
 * marker grammar; the caller passes `mark.passage`.
 *
 * A word the passage covers only in part counts as a word of the passage.
 * The extension writes its markers at word boundaries, but a marker written
 * by hand or by an agent can sit between a word and its punctuation, which
 * leaves one source word straddling the passage bound. That word is taken
 * whole, the outward snap to word boundaries a selection gets as well:
 * dropping it leaves the rendered word unpainted and shortens the sequence to
 * match, which on a longer passage sends {@link locate} into its two-word
 * fallback and ends the highlight several words early.
 *
 * Both scans are the caller's, because they are the same for every passage of
 * one document and one render: a caller with several marks scans once and
 * translates each of them against the same two sequences.
 *
 * @param passage - the source range between the two markers
 * @param scan - {@link tokeniseSource} of the source the passage is an offset
 * range in
 * @param words - {@link renderedWords} of the text {@link captureText} read
 * from the rendered host
 * @returns the range `[start, end)` of the passage in that captured text, or
 * null when the passage cannot be found there
 */
export function passageToRendered(
  passage: IPassage,
  scan: ISourceScan,
  words: IRenderedWord[]
): IRenderedRange | null {
  const inside: ISourceToken[] = [];
  let firstIndex = -1;
  scan.tokens.forEach((token, index) => {
    // Overlap, not containment: a word the passage cuts through belongs to it.
    if (token.end > passage.start && token.start < passage.end) {
      if (firstIndex < 0) {
        firstIndex = index;
      }
      inside.push(token);
    }
  });
  if (!inside.length || !words.length) {
    return null;
  }
  const needle = inside.map(token => token.text);
  const hint = Math.round((firstIndex / scan.tokens.length) * words.length);
  const at = locate(
    needle,
    words.map(word => word.text),
    hint
  );
  if (at < 0) {
    return null;
  }
  const last = Math.min(at + needle.length - 1, words.length - 1);
  return { start: words[at].start, end: words[last].end };
}
