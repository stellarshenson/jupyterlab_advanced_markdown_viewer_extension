import { PageConfig } from '@jupyterlab/coreutils';

import { linkAddress } from '../link';

/** A link as the preview holds it once JupyterLab has rendered it. */
const link = (href: string): HTMLAnchorElement => {
  const anchor = document.createElement('a');
  anchor.setAttribute('href', href);
  return anchor;
};

describe('linkAddress (ACC-COPY-163)', () => {
  beforeAll(() => {
    PageConfig.setOption('treeUrl', 'lab/tree');
  });

  it('copies a web link as the address it opens, its query untouched', () => {
    expect(
      linkAddress(link('https://example.com/a?q=two%20words#top'), 'spec.md')
    ).toBe('https://example.com/a?q=two%20words#top');
  });

  it('copies a link to a file as its download address without the _xsrf token', () => {
    expect(
      linkAddress(
        link('http://localhost/files/docs/notes.md?_xsrf=2%7Cabc%7C1#setup'),
        'docs/spec.md'
      )
    ).toBe('http://localhost/files/docs/notes.md#setup');
  });

  it('copies a link to a heading as the tree address of the previewed document', () => {
    // The page address names another document, as it does once the reader
    // has opened a second one.
    window.history.replaceState(null, '', '/lab/tree/other.md');
    expect(linkAddress(link('#Hard-criteria'), 'docs/spec one.md')).toBe(
      'http://localhost/lab/tree/docs/spec%20one.md#Hard-criteria'
    );
  });
});
