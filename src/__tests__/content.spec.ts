/**
 * The copy made for a mail client: the words and their structure, with
 * nothing of the look the theme and this extension put on them.
 */

import { copiedContent, selectedContent } from '../content';

/** A rendered view holding `html`, as JupyterLab builds it. */
function rendered(html: string): HTMLElement {
  const root = document.createElement('div');
  root.className = 'jp-RenderedHTMLCommon jp-RenderedMarkdown';
  root.innerHTML = html;
  return root;
}

describe('copiedContent (ACC-COPY-160)', () => {
  it('keeps the tags and the words and drops every class, style and identifier', () => {
    const root = rendered(
      '<h1 class="heading" id="report" style="color: red">Report</h1>' +
        '<p class="first">The first paragraph.</p>'
    );

    expect(copiedContent(root).html).toBe(
      '<h1>Report</h1><p>The first paragraph.</p>'
    );
  });

  it('drops the paragraph mark JupyterLab hangs on a heading', () => {
    const root = rendered(
      '<h2>Findings<a class="jp-InternalAnchorLink" href="#findings">¶</a></h2>'
    );

    expect(copiedContent(root).html).toBe('<h2>Findings</h2>');
  });

  it('keeps what a link, an image and a table cell mean', () => {
    const root = rendered(
      '<p><a href="https://example.org" class="link">the source</a>' +
        '<img src="figure.png" alt="the figure" class="jp-needs-light-background"></p>' +
        '<table><tbody><tr><td colspan="2" style="text-align: right">both</td></tr></tbody></table>'
    );

    expect(copiedContent(root).html).toBe(
      '<p><a href="https://example.org">the source</a>' +
        '<img src="figure.png" alt="the figure"></p>' +
        '<table><tbody><tr><td colspan="2">both</td></tr></tbody></table>'
    );
  });

  it('keeps the words of a marked passage and of a change, without their paint', () => {
    const root = rendered(
      '<p>The first <span class="jp-AdvancedMd-mark jp-AdvancedMd-yellow" ' +
        'data-mark="7f2c">paragraph mentions apples</span> and ' +
        '<span class="jp-AdvancedMd-added">pears</span>.</p>'
    );

    expect(copiedContent(root).html).toBe(
      '<p>The first paragraph mentions apples and pears.</p>'
    );
  });

  it('leaves out the note the reader wrote beside the passage', () => {
    // The paint carries the note as its tooltip, which is the reader's own
    // writing and has no place in a copy made for someone else.
    const root = rendered(
      '<p>The first <span class="jp-AdvancedMd-mark jp-AdvancedMd-yellow" ' +
        'data-mark="7f2c" title="kj: ask them about this one">paragraph</span>.</p>'
    );

    const copied = copiedContent(root);
    expect(copied.html).toBe('<p>The first paragraph.</p>');
    expect(copied.text).not.toContain('ask them');
  });

  it('parts the cells of a row the renderer wrote a line break between', () => {
    // Every renderer writes a table over several lines; the text between the
    // cells is its own layout, and a tab before it would read as a line break.
    const root = rendered(
      '<table>\n<thead>\n<tr>\n<th>left</th>\n<th>right</th>\n</tr>\n</thead>\n' +
        '<tbody>\n<tr>\n<td>one</td>\n<td>two</td>\n</tr>\n</tbody>\n</table>'
    );

    expect(copiedContent(root).text).toBe('left\tright\n\none\ttwo');
  });

  it('leaves out the ghost of text a change is deleting', () => {
    const root = rendered(
      '<p>The first paragraph mentions ' +
        '<span class="jp-AdvancedMd-removed">plums</span>' +
        '<span class="jp-AdvancedMd-removed jp-AdvancedMd-gap"> </span>apples.</p>'
    );

    const copied = copiedContent(root);
    expect(copied.html).toBe('<p>The first paragraph mentions apples.</p>');
    expect(copied.text).not.toContain('plums');
  });

  it('leaves out the markers of a mark, an icon and a control of the page', () => {
    const root = rendered(
      '<p><!-- mark:7f2c note colour=yellow -->apples<!-- /mark:7f2c --></p>' +
        '<div class="markdown-alert"><svg class="octicon"><path d="M0"></path></svg>' +
        '<p>Watch out.</p></div>' +
        '<pre><button class="jp-CodeBlock-copyButton">Copy</button>' +
        '<code class="language-ts"><span class="cm-keyword">const</span> x = 1;</code></pre>'
    );

    expect(copiedContent(root).html).toBe(
      '<p>apples</p><div><p>Watch out.</p></div>' +
        '<pre><code>const x = 1;</code></pre>'
    );
  });

  it('drops what the preview hides: a mermaid source, a caption for a screen reader and a hidden block', () => {
    // JupyterLab renders a mermaid fence as a picture with its source beside
    // it, hidden by its own rule, and writes captions no one sees; a copy that
    // carried either would put in the email text the reader cannot see.
    const root = rendered(
      '<div class="jp-RenderedMermaid"><figure>' +
        '<img src="data:image/svg+xml,%3Csvg%3E%3C%2Fsvg%3E" alt="flow">' +
        '<pre><code class="mermaid">graph TD;</code></pre>' +
        '<figcaption class="jp-sr-only">a diagram</figcaption>' +
        '</figure></div>' +
        '<p hidden>Not for the reader.</p>' +
        '<p>The first paragraph.</p>'
    );

    const copied = copiedContent(root);
    expect(copied.html).not.toContain('graph TD;');
    expect(copied.html).not.toContain('a diagram');
    expect(copied.html).not.toContain('Not for the reader.');
    expect(copied.html).toContain(
      '<img src="data:image/svg+xml,%3Csvg%3E%3C%2Fsvg%3E" alt="flow">'
    );
    expect(copied.text).toBe('The first paragraph.');
  });

  it('keeps the source of a diagram the preview could not draw, and not the error it folds away', () => {
    // A failed diagram is shown as its source, with the parser's message
    // folded into a details the reader has to open; the copy carries what
    // they see and not what the fold holds.
    const root = rendered(
      '<div class="jp-RenderedMermaid jp-mod-warning">' +
        '<details class="jp-RenderedMermaid-Details">' +
        '<summary><pre><code class="mermaid">graph TD;</code></pre></summary>' +
        '<pre>Error: Parse error on line 1</pre>' +
        '</details></div>'
    );

    const copied = copiedContent(root);
    expect(copied.html).toContain('graph TD;');
    expect(copied.html).not.toContain('Parse error');
    expect(copied.text).not.toContain('Parse error');
  });

  it('ends a table row after its last cell, with no trailing tab', () => {
    const root = rendered(
      '<table><tbody><tr><td>left</td><td>right</td></tr>' +
        '<tr><td>a</td><td>b</td></tr></tbody></table><p>after</p>'
    );

    expect(copiedContent(root).text).toBe('left\tright\n\na\tb\n\nafter');
  });

  it('writes the text flavour with a line for each block and a tab between cells', () => {
    const root = rendered(
      '<h1>Report</h1>\n<p>The first line.<br>The second line.</p>\n' +
        '<ul><li>apples</li><li>pears</li></ul>\n' +
        '<table><tbody><tr><td>left</td><td>right</td></tr></tbody></table>'
    );

    expect(copiedContent(root).text).toBe(
      'Report\n\nThe first line.\nThe second line.\n\napples\n\npears\n\nleft\tright'
    );
  });

  it('keeps two raw HTML lines of the source on two lines', () => {
    // A div the author wrote is a block the reader sees as its own line; the
    // copy keeps the tag, stripped of everything that sets a look.
    const root = rendered(
      '<h1>Report</h1><div><b>Name:</b> Alice</div><div>Date: today</div>'
    );

    const copied = copiedContent(root);
    expect(copied.html).toContain('<div><b>Name:</b> Alice</div>');
    expect(copied.text).toContain('Name: Alice\n\nDate: today');
  });

  it('keeps the size an image was given', () => {
    // A picture sized in the document arrives in the email at that size; with
    // the size stripped a mail client draws it at its full pixel width.
    const root = rendered(
      '<p><img src="figure.png" alt="the figure" width="320" height="180" class="jp-needs-light-background"></p>'
    );

    expect(copiedContent(root).html).toBe(
      '<p><img src="figure.png" alt="the figure" width="320" height="180"></p>'
    );
  });

  it('leaves the rendered view as it was', () => {
    const root = rendered('<p class="first">The first paragraph.</p>');
    const before = root.innerHTML;

    copiedContent(root);

    expect(root.innerHTML).toBe(before);
  });
});

describe('selectedContent (ACC-COPY-160)', () => {
  /**
   * Hold `range` as the reader's selection.
   *
   * Under this project's jest DOM the `Range` constructor and
   * `document.createRange` both give an object with no `cloneContents`, so the
   * selection is described rather than built.
   * What the browser really extracts is judged in ui-tests/tests/copy.spec.ts.
   */
  function selecting(
    commonAncestorContainer: Node,
    contents: () => DocumentFragment
  ): void {
    const range = {
      commonAncestorContainer,
      cloneContents: contents
    } as unknown as Range;
    jest.spyOn(window, 'getSelection').mockReturnValue({
      rangeCount: 1,
      isCollapsed: false,
      getRangeAt: () => range
    } as unknown as Selection);
  }

  /** The children of `element`, detached, as a range's contents would be. */
  function fragmentOf(element: Element): DocumentFragment {
    const fragment = document.createDocumentFragment();
    for (const child of Array.from(element.childNodes)) {
      fragment.appendChild(child.cloneNode(true));
    }
    return fragment;
  }

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('keeps the element the selection sits in, inside the root', () => {
    const root = rendered('<ul><li>alpha</li><li>beta</li></ul>');
    const list = root.querySelector('ul') as HTMLElement;
    selecting(list, () => fragmentOf(list));

    const held = selectedContent(root);

    expect(held).not.toBeNull();
    // The list's own tag reaches the copy, so the items are not loose.
    expect(copiedContent(held as HTMLElement).html).toContain('<ul>');
    expect(copiedContent(held as HTMLElement).html).toContain('<li>alpha</li>');
  });

  it('gives a selected row its table back, so the cells survive the paste', () => {
    // A row on its own is not a fragment a paste target can host: setting
    // '<tr><td>one</td><td>1</td></tr>' as innerHTML leaves the words and no
    // cells at all, so the reader's two cells arrive run together.
    const root = rendered(
      '<table><tbody><tr><td>one</td><td>1</td></tr></tbody></table>'
    );
    const row = root.querySelector('tr') as HTMLElement;
    selecting(row, () => fragmentOf(row));

    const held = selectedContent(root);

    expect(held).not.toBeNull();
    expect(copiedContent(held as HTMLElement).html).toContain('<table>');
    expect(copiedContent(held as HTMLElement).html).toContain('<td>one</td>');
  });

  it('gives a selected fenced block its pre back, so the lines survive the paste', () => {
    // A code element on its own carries no white-space rule in any browser's
    // own stylesheet, so a paste target joins the lines of the block and the
    // reader's program arrives as one line. Only the pre around it says the
    // line breaks are the content.
    const root = rendered(
      '<pre><code class="language-python">one = 1\ntwo = 2\n</code></pre>'
    );
    const code = root.querySelector('code') as HTMLElement;
    selecting(code, () => fragmentOf(code));

    const held = selectedContent(root);

    expect(held).not.toBeNull();
    expect(copiedContent(held as HTMLElement).html).toContain('<pre>');
    expect(copiedContent(held as HTMLElement).html).toContain(
      'one = 1\ntwo = 2'
    );
  });

  it('frames a code phrase in nothing when it has no pre, even inside a table', () => {
    // The frame is the one parent that carries the shell's meaning, so it is
    // named per tag rather than looked for as a group: an inline code phrase
    // in a cell has a table above it, and a table around a bare code phrase
    // is foster-parented out by the receiving parser.
    const root = rendered(
      '<table><tbody><tr><td>run <code>make install</code></td></tr></tbody></table>'
    );
    const code = root.querySelector('code') as HTMLElement;
    selecting(code, () => fragmentOf(code));

    const held = selectedContent(root);

    expect(held).not.toBeNull();
    expect(copiedContent(held as HTMLElement).html).toBe(
      '<code>make install</code>'
    );
  });

  it('reads a selection holding only a picture as a selection (DEF-COPY-104)', () => {
    // An image has no text of its own, so a drag that lands on it and nothing
    // else leaves the copy wordless; it is still the thing the reader asked
    // for, and answering with the whole document gives them far more.
    const root = rendered('<p><img src="figure.png" alt="the figure"></p>');
    const paragraph = root.querySelector('p') as HTMLElement;
    selecting(paragraph, () => fragmentOf(paragraph));

    const held = selectedContent(root);

    expect(held).not.toBeNull();
    expect(copiedContent(held as HTMLElement).html).toContain('<img');
  });

  it('frames a fenced block dragged inside its painted words (DEF-COPY-105)', () => {
    // The green paint on added text is a span the copy dissolves, so it
    // carries no meaning of its own; the frame is the nearest ancestor that
    // does, which is still the pre the lines belong to.
    const root = rendered(
      '<pre><code><span class="jp-AdvancedMd-added">one = 1\ntwo = 2\n</span></code></pre>'
    );
    const painted = root.querySelector('span') as HTMLElement;
    selecting(painted, () => fragmentOf(painted));

    const held = selectedContent(root);

    expect(held).not.toBeNull();
    expect(copiedContent(held as HTMLElement).html).toContain('<pre>');
    expect(copiedContent(held as HTMLElement).html).toContain(
      'one = 1\ntwo = 2'
    );
  });

  it('reads a selection the copy would empty as no selection', () => {
    // A drag that starts in the ghost of deleted words and ends past it: the
    // common ancestor is the paragraph, so the shell is not itself dropped,
    // and only the finished copy shows there is nothing left to put on the
    // clipboard. The caller falls back to the whole document.
    const root = rendered(
      '<p><span class="jp-AdvancedMd-removed">deleted</span> </p>'
    );
    const paragraph = root.querySelector('p') as HTMLElement;
    selecting(paragraph, () => fragmentOf(paragraph));

    expect(selectedContent(root)).toBeNull();
  });

  it('reads a drag across whitespace alone as no selection', () => {
    const root = rendered('<p>   </p>');
    const paragraph = root.querySelector('p') as HTMLElement;
    selecting(paragraph, () => fragmentOf(paragraph));

    expect(selectedContent(root)).toBeNull();
  });

  it('reads a selection made outside the rendered view as none', () => {
    const root = rendered('<p>Alpha.</p>');
    const elsewhere = document.createElement('p');
    elsewhere.textContent = 'In the notes panel.';
    selecting(elsewhere, () => fragmentOf(elsewhere));

    expect(selectedContent(root)).toBeNull();
  });
});
