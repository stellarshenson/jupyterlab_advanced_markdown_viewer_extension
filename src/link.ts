import { PageConfig, URLExt } from '@jupyterlab/coreutils';

/**
 * The address a link in a Markdown preview opens, as Copy link address puts
 * it on the clipboard (ACC-COPY-163).
 *
 * JupyterLab has rewritten the link by the time a menu can open on it: the
 * render sets the HTML and resolves its links without waiting on anything a
 * click could come in between, so a link to a file already holds the
 * download address of that file.
 *
 * @param link - The link the context menu was opened on.
 * @param path - The path of the previewed document, without a drive prefix.
 */
export function linkAddress(link: HTMLAnchorElement, path: string): string {
  const written = link.getAttribute('href') ?? '';
  // A link to a heading of this document, the paragraph mark JupyterLab hangs
  // on every heading among them, is a bare hash, which the browser resolves
  // against the page address; that address names another document or none.
  if (written.startsWith('#')) {
    const tree = URLExt.join(PageConfig.getTreeUrl(), URLExt.encodeParts(path));
    return new URL(written, tree).href;
  }
  const address = new URL(link.href);
  // The download address carries the session's _xsrf token. Deleting a
  // parameter writes the whole query out again, turning %20 into +, so an
  // address without the token is left exactly as it is.
  if (address.searchParams.has('_xsrf')) {
    address.searchParams.delete('_xsrf');
  }
  return address.href;
}
