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
 * Class on a removal ghost that would otherwise touch the word after it.
 */
export const GAP_CLASS = 'jp-AdvancedMd-gap';

const SVG_NS = 'http://www.w3.org/2000/svg';

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
 * Build the decoration element for a run of text.
 *
 * @param fresh - whether the text was changed by this render; text tinted by
 * an earlier render of the same fade keeps its tint and does not fade in again
 */
function makeDecoration(
  className: string,
  text: string,
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
  return span;
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
 * Find the element a removal ghost may be placed inside.
 *
 * A ghost must not become a direct child of the render root, so a removal that
 * lands in the whitespace between two blocks is redirected into the block
 * beside it.
 *
 * @returns the node to insert before, and its parent, or null when there is
 * nowhere safe to put the ghost
 */
function ghostAnchor(
  node: Text,
  root: HTMLElement
): { parent: Node; before: Node | null } | null {
  if (node.parentElement !== root) {
    return { parent: node.parentNode!, before: node };
  }
  let sibling: Node | null = node.nextSibling;
  while (sibling) {
    if (sibling.nodeType === Node.ELEMENT_NODE) {
      return { parent: sibling, before: sibling.firstChild };
    }
    sibling = sibling.nextSibling;
  }
  sibling = node.previousSibling;
  while (sibling) {
    if (sibling.nodeType === Node.ELEMENT_NODE) {
      return { parent: sibling, before: null };
    }
    sibling = sibling.previousSibling;
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
 * @returns the decoration elements that were inserted
 */
export function decorate(
  root: HTMLElement,
  snapshot: ITextSnapshot,
  ranges: IChangeRanges,
  fadeMs: number,
  fresh?: IChangeRanges
): HTMLElement[] {
  const work = new Map<Text, INodeWork>();
  const created: HTMLElement[] = [];

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
  // arrives as one removal and one addition at the same offset. Placing that
  // removal inline would put the old document inside the first block and shift
  // everything below it when the ghost is taken out, so such a removal is not
  // shown; the added text is still marked and the tab cue fires.
  const pastBound = (text: string) => tokenize(text).length > MAX_LCS_TOKENS;
  const deferredGhosts: Array<{ span: ITextSpan; removal: IRemoval }> = [];
  for (const removal of ranges.removed) {
    if (
      pastBound(removal.text) ||
      ranges.added.some(
        range =>
          range.start === removal.at &&
          pastBound(snapshot.text.slice(range.start, range.end))
      )
    ) {
      continue;
    }
    const span = spanAt(snapshot.spans, removal.at);
    if (!span) {
      continue;
    }
    if (span.node.parentElement === root) {
      deferredGhosts.push({ span, removal });
    } else {
      workFor(span).removed.push({
        at: Math.min(
          Math.max(removal.at - span.start, 0),
          span.end - span.start
        ),
        text: removal.text,
        fresh: isFreshRemoval(removal, fresh),
        gap: needsGap(removal, snapshot)
      });
    }
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
    const points = Array.from(cuts).sort((a, b) => a - b);

    const fragment = document.createDocumentFragment();
    for (let i = 0; i < points.length; i++) {
      const at = points[i];
      for (const ghost of entry.removed) {
        if (ghost.at === at) {
          const element = makeDecoration(
            REMOVED_CLASS,
            ghost.text,
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
      const isAdded = entry.added.some(
        range => range.start <= at && range.end >= next
      );
      if (isAdded) {
        const element = makeDecoration(
          ADDED_CLASS,
          slice,
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

  for (const { span, removal } of deferredGhosts) {
    const anchor = ghostAnchor(span.node, root);
    if (!anchor) {
      continue;
    }
    const element = makeDecoration(
      REMOVED_CLASS,
      removal.text,
      fadeMs,
      isFreshRemoval(removal, fresh)
    );
    if (needsGap(removal, snapshot)) {
      element.classList.add(GAP_CLASS);
    }
    anchor.parent.insertBefore(element, anchor.before);
    created.push(element);
  }

  return created;
}

/**
 * Whether a removal was made by this render rather than shown already.
 */
function isFreshRemoval(removal: IRemoval, fresh?: IChangeRanges): boolean {
  return (
    fresh === undefined || fresh.removed.some(other => other.at === removal.at)
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
