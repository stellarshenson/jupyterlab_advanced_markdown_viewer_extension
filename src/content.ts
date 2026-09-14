/**
 * The rendered preview as basic HTML, for pasting into a mail client.
 *
 * A copy made with the browser's own Copy carries JupyterLab's classes, the
 * theme's colours and the paint this extension puts on a change or a mark, and
 * an email written from it inherits all three. This module hands over the same
 * words with their structure and nothing of their look: the tags a mail client
 * renders, the few attributes that carry meaning, and no class, style, colour
 * or identifier.
 */

import { GAP_CLASS, REMOVED_CLASS } from './highlight';

/**
 * What a copied element says as itself, and keeps; every other attribute goes.
 *
 * A title is not among them: this extension writes a mark's notes into the
 * tooltip of the painted passage, and the reader's own notes have no place in
 * a copy made for somebody else. A tooltip an author wrote on a link goes with
 * them, which is the price of that.
 */
const KEPT_ATTRIBUTES = new Set([
  'alt',
  'checked',
  'colspan',
  'height',
  'href',
  'rowspan',
  'src',
  'start',
  'type',
  'width'
]);

/**
 * Elements dropped with their text: the ghost of text a change is deleting is
 * not in the document, the paragraph mark JupyterLab puts on a heading is a
 * control of the page, and a control, a stylesheet or a script is not content.
 * What the preview hides goes with them, since the copy carries what the
 * reader sees: the source JupyterLab keeps beside a drawn diagram (it shows
 * that source instead when the diagram failed, and then so does the copy,
 * while the parser's message, which the preview folds away, does not go with
 * it), a caption written for a screen reader, and anything marked hidden.
 */
const DROPPED = [
  'style',
  'script',
  'button',
  '.jp-InternalAnchorLink',
  '.anchor-link',
  '.jp-RenderedMermaid:not(.jp-mod-warning) pre',
  '.jp-RenderedMermaid-Details > pre',
  '.jp-sr-only',
  '[hidden]',
  `.${REMOVED_CLASS}`,
  `.${GAP_CLASS}`
].join(', ');

/**
 * Inline elements that carry a look alone: their children take their place. A
 * block element stays, so the line the reader sees survives the copy.
 */
const UNWRAPPED = new Set(['FONT', 'SPAN']);

/**
 * Tags whose meaning lives in a parent the copy never emits, each named with
 * the parent that carries it. A row, or a section of rows, keeps its words and
 * loses every cell around them when a paste target hosts it alone; a fenced
 * block's code carries no white-space rule of its own, so without its `pre` the
 * program arrives on one line. A shell that is one of these is framed in a
 * shallow clone of that parent before it travels. The parent is named per tag
 * rather than looked for as a group, since a code phrase inside a table cell
 * has a table above it and a table is not its frame.
 */
const FRAMED = new Map([
  ['TR', 'table'],
  ['TBODY', 'table'],
  ['THEAD', 'table'],
  ['TFOOT', 'table'],
  ['CODE', 'pre']
]);

/** Tags whose content stands on a line of its own in the text flavour. */
const LINES = new Set([
  'ARTICLE',
  'BLOCKQUOTE',
  'DD',
  'DIV',
  'DL',
  'DT',
  'FIGCAPTION',
  'FIGURE',
  'H1',
  'H2',
  'H3',
  'H4',
  'H5',
  'H6',
  'HR',
  'LI',
  'OL',
  'P',
  'PRE',
  'TABLE',
  'TR',
  'UL'
]);

/** The content in the two forms a paste reads. */
export interface ICopiedContent {
  /** The tags and the words, with nothing that sets a look. */
  html: string;
  /** The same words, for a target that takes no HTML. */
  text: string;
}

/**
 * The rendered content as basic HTML and as plain text.
 *
 * @param root - the rendered view; it is read, never changed, since the copy
 * is taken from a clone of it
 */
export function copiedContent(root: HTMLElement): ICopiedContent {
  const clone = root.cloneNode(true) as HTMLElement;
  for (const element of Array.from(clone.querySelectorAll(DROPPED))) {
    element.remove();
  }
  // An icon is a look, and goes; the drawing MathJax makes is the formula
  // itself, and stays as the one thing it can be copied as.
  for (const drawing of Array.from(clone.querySelectorAll('svg'))) {
    if (!drawing.closest('mjx-container')) {
      drawing.remove();
    }
  }
  clean(clone);
  return {
    html: clone.innerHTML.trim(),
    text: asText(clone)
      .replace(/\n{3,}/g, '\n\n')
      .trim()
  };
}

/**
 * Drop every comment, every attribute that is a look rather than a meaning,
 * and every element then left with nothing but its tag to say.
 *
 * The children are cleaned first, so an element unwrapped into its parent is
 * already clean when it lands there.
 */
function clean(element: Element): void {
  for (const child of Array.from(element.childNodes)) {
    if (child.nodeType === Node.COMMENT_NODE) {
      (child as ChildNode).remove();
    } else if (child.nodeType === Node.ELEMENT_NODE) {
      clean(child as Element);
    }
  }
  for (const name of element.getAttributeNames()) {
    if (!KEPT_ATTRIBUTES.has(name)) {
      element.removeAttribute(name);
    }
  }
  if (UNWRAPPED.has(element.tagName) && element.attributes.length === 0) {
    element.replaceWith(...Array.from(element.childNodes));
  }
}

/**
 * The text of a cleaned tree: a block on its own line, a table cell parted
 * from the next by a tab, a line break where the document has one.
 */
function asText(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) {
    return node.textContent ?? '';
  }
  if (node.nodeType !== Node.ELEMENT_NODE) {
    return '';
  }
  const element = node as Element;
  if (element.tagName === 'BR') {
    return '\n';
  }
  // Only cells are content inside a row: the line breaks a renderer writes
  // between them would otherwise land after the tab that parts them and read
  // as a row of one cell each.
  const children =
    element.tagName === 'TR'
      ? Array.from(element.children)
      : Array.from(element.childNodes);
  let written = '';
  for (const child of children) {
    written += asText(child);
    // Between the cells of a row, never after the last of them.
    if (
      (child.nodeName === 'TD' || child.nodeName === 'TH') &&
      (child as Element).nextElementSibling
    ) {
      written += '\t';
    }
  }
  return LINES.has(element.tagName) ? `\n${written}\n` : written;
}

/**
 * What the reader selected inside `root`, as a detached element holding a copy
 * of it, or null when they selected nothing there.
 *
 * The common ancestor is cloned shallow around the selected fragment and that
 * shell sits inside a clone of the root, because the copy is serialised from
 * the returned element's `innerHTML` and the outermost tag is never emitted.
 * So the selection keeps the one level of context that names it: a list its
 * `ul`, a whole table its `table`, an emphasised phrase its `strong`. A shell
 * whose meaning lives in a parent tag the copy never emits gets that parent
 * back as well - a row its table, a fenced block's code its `pre` - since
 * neither is something a paste target can host on its own. A phrase dragged
 * inside one cell is the case this does not reach: it arrives as text, without
 * the cell it came from.
 *
 * A selection the reader made outside the preview, in the notes panel or in
 * another document, is not theirs to copy from here and reads as none. So does
 * one the copy leaves neither words nor a picture in - a drag over the ghost of
 * deleted words, or over a heading's anchor - so the caller falls back to the
 * whole document rather than putting an empty clipboard in the reader's hands.
 */
export function selectedContent(root: HTMLElement): HTMLElement | null {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0 || selection.isCollapsed) {
    return null;
  }
  const range = selection.getRangeAt(0);
  if (!root.contains(range.commonAncestorContainer)) {
    return null;
  }
  return contentOfRange(root, range);
}

/**
 * The content of one range inside `root`, held the way
 * {@link selectedContent} describes, or null when the copy would leave it
 * empty.
 *
 * Taken apart from the window's own selection so a caller holding a range of
 * its own can ask - the copy does, when the browser has lost the selection the
 * reader made and only the recorded offsets say where it was.
 */
export function contentOfRange(
  root: HTMLElement,
  range: Range
): HTMLElement | null {
  const ancestor = range.commonAncestorContainer;
  const context =
    ancestor.nodeType === Node.ELEMENT_NODE
      ? (ancestor as Element)
      : (ancestor.parentElement ?? root);
  const shell = context.cloneNode(false) as HTMLElement;
  shell.appendChild(range.cloneContents());
  const holder = root.cloneNode(false) as HTMLElement;
  // The frame is the nearest ancestor that carries the shell's meaning, and an
  // ancestor the copy dissolves carries none - the paint on a change, a mark's
  // colour - so the walk passes through those to the tag that does. Without it
  // a fenced block dragged inside its own paint loses the `pre` that says its
  // line breaks are the content (DEF-COPY-105).
  let framing: Element | null = context;
  while (framing && UNWRAPPED.has(framing.tagName)) {
    framing = framing.parentElement;
  }
  const wanted = framing ? FRAMED.get(framing.tagName) : undefined;
  const parent = wanted && framing ? framing.closest(wanted) : null;
  if (parent) {
    const frame = parent.cloneNode(false) as HTMLElement;
    frame.appendChild(shell);
    holder.appendChild(frame);
  } else {
    holder.appendChild(shell);
  }
  // What the copy would leave decides, and a picture counts although it
  // carries no words: an image, a drawn formula or a diagram is the thing the
  // reader dragged over, and answering with the whole document gives them far
  // more than they asked for (DEF-COPY-104). A drag across whitespace, and one
  // over text the copy sweeps out - the ghost of deleted words, a heading's
  // anchor - leave neither words nor picture, and the whole document is the
  // answer then rather than an empty clipboard. Only the finished copy knows:
  // the selection's own element is what the reader dragged inside, not what
  // the filter will leave.
  const copied = copiedContent(holder);
  const keeps =
    copied.text.trim() !== '' || /<(?:img|svg)\b/i.test(copied.html);
  return keeps ? holder : null;
}
