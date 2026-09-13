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
