/**
 * Reading and decorating the rendered Markdown DOM.
 *
 * The rendered view is rebuilt from scratch on every render, so the extension
 * compares the text of one render against the text of the previous one and
 * decorates the difference. Working on rendered text rather than on Markdown
 * source keeps the extension independent of the parser, so anything other
 * extensions inject during rendering is diffed as the reader sees it.
 *
 * Two invariants hold every decoration in place, both required by neighbouring
 * extensions in this repository:
 *
 * - decorations are inline elements inside blocks that the renderer produced,
 *   never new direct children of the render root, whose count another
 *   extension matches against the Markdown block count
 * - heading text and heading identifiers are never touched, because anchor and
 *   table-of-contents navigation resolve through them
 */

import {
  IAddedRange,
  IChangeRanges,
  IRemoval,
  MAX_LCS_TOKENS,
  tokenize
} from './diff';

/**
 * Class marking text an external change added.
 */
export const ADDED_CLASS = 'jp-AdvancedMd-added';

/**
 * Class marking text an external change removed.
 */
export const REMOVED_CLASS = 'jp-AdvancedMd-removed';

/**
 * Class marking a decoration that is on its way out.
 */
export const DECORATION_CLASS = 'jp-AdvancedMd-decoration';

/**
 * The longest removal, in tokens, still shown as a ghost when the diff took
 * its coarse branch because of the addition beside it. A sentence or two
 * reads as a struck phrase; the lumped middle of a rewritten document does
 * not.
 */
export const MAX_GHOST_TOKENS = 50;

/**
 * Class on a removal ghost that would otherwise touch the word after it.
 */
export const GAP_CLASS = 'jp-AdvancedMd-gap';

const SVG_NS = 'http://www.w3.org/2000/svg';

/**
 * Selector for the heading elements, whose text and ids stay as rendered.
 */
export const HEADINGS = 'h1,h2,h3,h4,h5,h6';

/**
 * One text node and the range of the captured text it holds.
 */
interface ITextSpan {
  node: Text;
  start: number;
  end: number;
}

/**
 * The text of one render, with the nodes it came from.
 */
export interface ITextSnapshot {
  text: string;
  spans: ITextSpan[];
}

/**
 * Read the text of a rendered subtree, in document order.
 *
 * Decorations left over from an earlier change are skipped, so a snapshot
 * always describes the document rather than the extension's own markup.
 *
 * @param root - the rendered Markdown host
 */
export function captureText(root: HTMLElement): ITextSnapshot {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode: (node: Node) => {
      const parent = node.parentElement;
      if (!parent) {
        return NodeFilter.FILTER_REJECT;
      }
      const tag = parent.tagName;
      if (tag === 'SCRIPT' || tag === 'STYLE') {
        return NodeFilter.FILTER_REJECT;
      }
      // An HTML span inside SVG text is not painted, so a diagram label is
      // read past rather than decorated. HTML inside a foreignObject is fine.
      if (parent.namespaceURI === SVG_NS) {
        return NodeFilter.FILTER_REJECT;
      }
      if (parent.closest(`.${DECORATION_CLASS}`)) {
        return NodeFilter.FILTER_REJECT;
      }
      return NodeFilter.FILTER_ACCEPT;
    }
  });

  const spans: ITextSpan[] = [];
  let text = '';
  let current = walker.nextNode();
  while (current) {
    const value = current.nodeValue ?? '';
    if (value.length) {
      spans.push({
        node: current as Text,
        start: text.length,
        end: text.length + value.length
      });
      text += value;
    }
    current = walker.nextNode();
  }
  return { text, spans };
}

/**
 * Work queued against a single text node.
 */
interface INodeWork {
  /** Offset of the node's text in the snapshot. */
  base: number;
  /** Ranges within the node, in node-local offsets, to wrap as added. */
  added: Array<{ start: number; end: number }>;
  /** Node-local offsets at which removed text should be shown. */
  removed: Array<{ at: number; text: string; fresh: boolean; gap: boolean }>;
  /** Node-local offsets where a fresh run starts or ends. */
  cuts: number[];
}

/**
 * Where in the snapshot text each decoration sits, kept off the element so the
 * markup carries nothing but its classes and fade variables.
 */
const offsets = new WeakMap<HTMLElement, number>();

/**
 * Build the decoration element for a run of text.
 *
 * @param at - offset in the snapshot text: where an added slice starts, or
 * where a removal was taken from
 * @param fresh - whether the text was changed by this render; text tinted by
 * an earlier render of the same fade keeps its tint and does not fade in again
 */
function makeDecoration(
  className: string,
  text: string,
  at: number,
  fadeMs: number,
  fresh: boolean
): HTMLElement {
  const span = document.createElement('span');
  span.className = `${DECORATION_CLASS} ${className}`;
  span.style.setProperty('--jp-AdvancedMd-fade-duration', `${fadeMs}ms`);
  if (!fresh) {
    span.style.setProperty('--jp-AdvancedMd-fade-in', '0ms');
  }
  span.textContent = text;
  offsets.set(span, at);
  return span;
}

/**
 * Where a decoration sits in the text of the render that made it: the offset
 * an added slice starts at, or the offset a removal was taken from. The change
 * animator matches a decoration to the run it continues by this offset, so two
 * runs of the same text in different places stay apart.
 */
export function offsetOf(element: HTMLElement): number {
  return offsets.get(element) ?? 0;
}

/**
 * Whether a decoration was built for text an earlier render of the same fade
 * already showed.
 *
 * {@link makeDecoration} records that on the element by turning its fade-in
 * off; the change animator reads it to decide what still has to be typed.
 */
export function wasShownBefore(element: HTMLElement): boolean {
  return element.style.getPropertyValue('--jp-AdvancedMd-fade-in') === '0ms';
}

/**
 * Texts of the added runs the change animator still holds from the previous
 * render, in the order it holds them.
 *
 * A decoration built for text an earlier render already showed continues one
 * of those runs. The next diff may merge what were several runs into one
 * slice, so {@link decorate} cuts such a slice where the runs meet and every
 * part continues its own run.
 */
export interface ICarriedRuns {
  added: string[];
}

/**
 * A removal shown as a ghost: where it sits in the snapshot text, its text,
 * and whether this render made it rather than an earlier render of the same
 * fade.
 */
export interface IGhost extends IRemoval {
  fresh: boolean;
}

/**
 * Build the function that tells where a slice shown before must be cut so
 * that every part lies within one carried run: the edges between the runs the
 * slice spans, as offsets into the slice. Slices arrive in document order, so
 * the search continues from the previous match and starts over when nothing
 * follows it.
 */
function carriedCutter(runs: string[]): (text: string) => number[] {
  const joined = runs.join('');
  const edges: number[] = [];
  let end = 0;
  for (const run of runs) {
    end += run.length;
    edges.push(end);
  }
  let cursor = 0;
  return text => {
    let at = joined.indexOf(text, cursor);
    if (at < 0) {
      at = joined.indexOf(text);
    }
    if (at < 0) {
      return [];
    }
    cursor = at + text.length;
    return edges
      .filter(edge => edge > at && edge < at + text.length)
      .map(edge => edge - at);
  };
}

/**
 * Whether a removal ghost needs a gap after it: the removed text ends in a
 * word and the text it sits in front of starts with one, so without a gap
 * the struck word and its replacement read as one token.
 */
function needsGap(removal: IRemoval, snapshot: ITextSnapshot): boolean {
  return (
    !/\s$/.test(removal.text) && /^\S/.test(snapshot.text.charAt(removal.at))
  );
}

function overlaps(
  ranges: IAddedRange[] | undefined,
  start: number,
  end: number
): boolean {
  return (
    ranges === undefined ||
    ranges.some(range => range.start < end && range.end > start)
  );
}

/**
 * Whether a removal at this text node is shown as a ghost right there.
 *
 * A ghost must not become a direct child of the render root, and must not sit
 * inside a heading, whose text it would change and whose content the change
 * animator leaves alone. Such a removal is placed by {@link ghostAnchor}.
 */
function holdsGhost(node: Text, root: HTMLElement): boolean {
  const parent = node.parentElement;
  return (
    parent !== null && parent !== root && parent.closest(HEADINGS) === null
  );
}

/**
 * The direct child of the render root a text node sits in: the block a
 * removal belongs to, or the whitespace between blocks itself. Read before the
 * text nodes are rebuilt, because a heading's text node may be replaced while
 * the heading stays.
 */
function blockOf(node: Text, root: HTMLElement): Element | Text {
  let block: Element | Text = node;
  while (block.parentNode && block.parentNode !== root) {
    block = block.parentNode as Element;
  }
  return block;
}

/**
 * Find the element a removal ghost is placed inside when its own text node
 * cannot hold it.
 *
 * The ghost goes to the start of the block after the one the removal belongs
 * to, or to the end of the nearest previous block when the next one is a
 * heading, headings being passed over in both directions. A document with no
 * other block shows no ghost, so heading text stays as rendered.
 *
 * @param block - the block the removal belongs to, or the whitespace between
 * blocks it sits in
 * @returns the node to insert before, and its parent, or null when there is
 * nowhere safe to put the ghost
 */
function ghostAnchor(
  block: Element | Text
): { parent: Node; before: Node | null } | null {
  const isHeading = (element: Element) => element.matches(HEADINGS);
  const into = (element: Element) => ({
    parent: element,
    before: element.firstChild
  });
  const next = block.nextElementSibling;
  if (next && !isHeading(next)) {
    return into(next);
  }
  for (
    let el = block.previousElementSibling;
    el;
    el = el.previousElementSibling
  ) {
    if (!isHeading(el)) {
      return { parent: el, before: null };
    }
  }
  for (let el = next; el; el = el.nextElementSibling) {
    if (!isHeading(el)) {
      return into(el);
    }
  }
  return null;
}

/**
 * Locate the captured span holding an offset.
 */
function spanAt(spans: ITextSpan[], offset: number): ITextSpan | null {
  for (const span of spans) {
    if (offset >= span.start && offset <= span.end) {
      return span;
    }
  }
  return spans.length ? spans[spans.length - 1] : null;
}

/**
 * Decorate the changes of a render.
 *
 * Each affected text node is rebuilt once, from its own slices, so no offset
 * computed against the snapshot is invalidated by an earlier edit.
 *
 * @param root - the rendered Markdown host
 * @param snapshot - text captured from `root` before decorating
 * @param ranges - the changes, positioned against the snapshot text
 * @param fadeMs - how long a decoration takes to fade out
 * @param fresh - the subset of the changes this render made, positioned the
 * same way, when an earlier render of the same fade already showed the rest;
 * omitted when every change is new
 * @param carried - the added runs the change animator still holds from the
 * previous render, so a slice shown before is cut where the runs it spans meet
 * @param ghosts - the ghosts to show in place of the removals in `ranges`,
 * when this render animates during a pending fade: the change animator builds
 * them from what this render removed and what is still on its way out;
 * omitted when every removal against the baseline is shown, fresh unless
 * `fresh` places none at its offset
 * @returns the decoration elements that were inserted
 */
export function decorate(
  root: HTMLElement,
  snapshot: ITextSnapshot,
  ranges: IChangeRanges,
  fadeMs: number,
  fresh?: IChangeRanges,
  carried?: ICarriedRuns,
  ghosts?: IGhost[]
): HTMLElement[] {
  const work = new Map<Text, INodeWork>();
  const created: HTMLElement[] = [];
  const cutAdded = carriedCutter(carried?.added ?? []);

  const workFor = (span: ITextSpan): INodeWork => {
    let entry = work.get(span.node);
    if (!entry) {
      entry = { base: span.start, added: [], removed: [], cuts: [] };
      work.set(span.node, entry);
    }
    return entry;
  };

  for (const range of ranges.added) {
    for (const span of snapshot.spans) {
      if (span.end <= range.start || span.start >= range.end) {
        continue;
      }
      // Whitespace between blocks sits directly under the root. Wrapping it
      // would add a direct child, and it carries nothing a reader can see.
      if (span.node.parentElement === root) {
        continue;
      }
      const start = Math.max(range.start, span.start) - span.start;
      const end = Math.min(range.end, span.end) - span.start;
      if (end > start) {
        const entry = workFor(span);
        entry.added.push({ start, end });
        // A run added over two renders is cut where the fresh part begins,
        // so each part carries its own fade-in.
        for (const run of fresh?.added ?? []) {
          for (const edge of [run.start, run.end]) {
            if (edge > span.start + start && edge < span.start + end) {
              entry.cuts.push(edge - span.start);
            }
          }
        }
      }
    }
  }

  // Ghosts are placed after the added ranges are known, so a removal that sits
  // inside a rebuilt node is rebuilt with it rather than against a stale offset.
  //
  // Past the diff's own token bound, on either side, the whole changed middle
  // arrives as one removal and one addition at the same offset. A long removal
  // of that kind is not a phrase the reader can take in but the old document
  // lumped together, so it is not shown; the added text is still marked and
  // the tab cue fires. A short one is exactly the text that went, and its
  // ghost is the warning the reader expects, whatever the size of the addition
  // beside it.
  const pastBound = (text: string) => tokenize(text).length > MAX_LCS_TOKENS;
  const readable = (text: string) => tokenize(text).length <= MAX_GHOST_TOKENS;
  const deferredGhosts: Array<{ block: Element | Text; ghost: IGhost }> = [];
  const shown =
    ghosts ??
    ranges.removed.map(removal => ({
      ...removal,
      fresh: isFreshRemoval(removal, fresh)
    }));
  for (const ghost of shown) {
    if (
      pastBound(ghost.text) ||
      (!readable(ghost.text) &&
        ranges.added.some(
          range =>
            range.start === ghost.at &&
            pastBound(snapshot.text.slice(range.start, range.end))
        ))
    ) {
      continue;
    }
    const span = spanAt(snapshot.spans, ghost.at);
    if (!span) {
      continue;
    }
    if (!holdsGhost(span.node, root)) {
      deferredGhosts.push({ block: blockOf(span.node, root), ghost });
      continue;
    }
    workFor(span).removed.push({
      at: Math.min(Math.max(ghost.at - span.start, 0), span.end - span.start),
      text: ghost.text,
      fresh: ghost.fresh,
      gap: needsGap(ghost, snapshot)
    });
  }

  for (const [node, entry] of work) {
    const value = node.nodeValue ?? '';
    const cuts = new Set<number>([0, value.length]);
    for (const range of entry.added) {
      cuts.add(range.start);
      cuts.add(range.end);
    }
    for (const ghost of entry.removed) {
      cuts.add(ghost.at);
    }
    for (const cut of entry.cuts) {
      cuts.add(cut);
    }
    const addedAt = (at: number, next: number) =>
      entry.added.some(range => range.start <= at && range.end >= next);
    let points = Array.from(cuts).sort((a, b) => a - b);
    // A slice an earlier render showed may span several carried runs when
    // this diff merged them; it is cut where they meet.
    if (fresh) {
      for (let i = 0; i + 1 < points.length; i++) {
        const [at, next] = [points[i], points[i + 1]];
        if (
          addedAt(at, next) &&
          !overlaps(fresh.added, entry.base + at, entry.base + next)
        ) {
          for (const cut of cutAdded(value.slice(at, next))) {
            cuts.add(at + cut);
          }
        }
      }
      points = Array.from(cuts).sort((a, b) => a - b);
    }

    const fragment = document.createDocumentFragment();
    for (let i = 0; i < points.length; i++) {
      const at = points[i];
      for (const ghost of entry.removed) {
        if (ghost.at === at) {
          const element = makeDecoration(
            REMOVED_CLASS,
            ghost.text,
            entry.base + at,
            fadeMs,
            ghost.fresh
          );
          if (ghost.gap) {
            element.classList.add(GAP_CLASS);
          }
          fragment.appendChild(element);
          created.push(element);
        }
      }
      const next = points[i + 1];
      if (next === undefined || next === at) {
        continue;
      }
      const slice = value.slice(at, next);
      if (addedAt(at, next)) {
        const element = makeDecoration(
          ADDED_CLASS,
          slice,
          entry.base + at,
          fadeMs,
          overlaps(fresh?.added, entry.base + at, entry.base + next)
        );
        fragment.appendChild(element);
        created.push(element);
      } else {
        fragment.appendChild(document.createTextNode(slice));
      }
    }
    node.parentNode?.replaceChild(fragment, node);
  }

  for (const { block, ghost } of deferredGhosts) {
    const anchor = ghostAnchor(block);
    if (!anchor) {
      continue;
    }
    const element = makeDecoration(
      REMOVED_CLASS,
      ghost.text,
      ghost.at,
      fadeMs,
      ghost.fresh
    );
    if (needsGap(ghost, snapshot)) {
      element.classList.add(GAP_CLASS);
    }
    anchor.parent.insertBefore(element, anchor.before);
    created.push(element);
  }

  return created;
}

/**
 * Whether a removal was made by this render rather than shown already.
 *
 * The offset alone does not tell: a word replaced twice within one fade puts
 * a different removal at the same offset while the ghost of the first
 * replacement is still on screen, so the text has to match as well.
 */
function isFreshRemoval(removal: IRemoval, fresh?: IChangeRanges): boolean {
  return (
    fresh === undefined ||
    fresh.removed.some(
      other => other.at === removal.at && other.text === removal.text
    )
  );
}

/**
 * Remove decorations, putting the text they wrapped back as it was.
 *
 * Added text is unwrapped so the rendered DOM returns to what the renderer
 * produced. Removed text is deleted outright, because it is not in the
 * document.
 *
 * @param elements - decorations returned by {@link decorate}
 */
export function undecorate(elements: Iterable<HTMLElement>): void {
  for (const element of elements) {
    const parent = element.parentNode;
    if (!parent) {
      continue;
    }
    if (element.classList.contains(REMOVED_CLASS)) {
      parent.removeChild(element);
    } else {
      parent.replaceChild(
        document.createTextNode(element.textContent ?? ''),
        element
      );
    }
    parent.normalize();
  }
}

/**
 * Whether a set of changes is worth showing.
 *
 * @param ranges - the changes to weigh
 */
export function hasVisibleChange(ranges: IChangeRanges): boolean {
  return ranges.added.length > 0 || ranges.removed.length > 0;
}

export type { IAddedRange, IRemoval };
