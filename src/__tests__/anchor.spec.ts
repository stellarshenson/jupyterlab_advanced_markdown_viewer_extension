import {
  IPassage,
  inTableRow,
  IRenderedRange,
  ISelectionRange,
  ISourceRange,
  locate,
  markerToRendered,
  passageToRendered,
  renderedToSource,
  renderedWords,
  selectionOffsets,
  tokeniseSource
} from '../anchor';
import { captureText } from '../highlight';

/**
 * The two reads a mark is written through, taken together over one live
 * selection: the offsets when it is made, the source range when it is
 * written. Production takes them at different moments (src/notes.ts), so
 * the composition lives only here.
 */
function selectionToSource(
  selection: ISelectionRange,
  root: HTMLElement,
  source: string
): ISourceRange | null {
  const range = selectionOffsets(selection, root);
  return range ? renderedToSource(range, root, source) : null;
}

/**
 * Build a stand-in for the rendered Markdown host.
 *
 * The HTML of each case is what the viewer's renderer produces for the
 * Markdown source beside it.
 */
function render(html: string): HTMLElement {
  const root = document.createElement('div');
  root.className = 'jp-RenderedMarkdown';
  root.innerHTML = html;
  document.body.appendChild(root);
  return root;
}

/**
 * Every text node of a render, in document order.
 */
function textNodes(root: HTMLElement): Text[] {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const nodes: Text[] = [];
  let node = walker.nextNode();
  while (node) {
    nodes.push(node as Text);
    node = walker.nextNode();
  }
  return nodes;
}

/**
 * Select from the first occurrence of `from` to the end of the first
 * occurrence of `to` at or after it.
 *
 * JupyterLab's jest shim replaces `document.createRange` with a stub that
 * holds no boundaries, so the selection is built as the four members
 * `selectionToSource` reads of a range.
 */
function selectText(
  root: HTMLElement,
  from: string,
  to: string
): ISelectionRange {
  const nodes = textNodes(root);
  let start: { node: Text; offset: number } | null = null;
  for (const node of nodes) {
    const value = node.nodeValue ?? '';
    if (!start) {
      const at = value.indexOf(from);
      if (at < 0) {
        continue;
      }
      start = { node, offset: at };
      const after = value.indexOf(to, at + from.length);
      if (after >= 0) {
        return selection(start, { node, offset: after + to.length });
      }
      continue;
    }
    const at = value.indexOf(to);
    if (at >= 0) {
      return selection(start, { node, offset: at + to.length });
    }
  }
  throw new Error(`no range from ${from} to ${to}`);
}

/**
 * Assemble a selection from its two ends.
 */
function selection(
  start: { node: Node; offset: number },
  end: { node: Node; offset: number }
): ISelectionRange {
  return {
    startContainer: start.node,
    startOffset: start.offset,
    endContainer: end.node,
    endOffset: end.offset
  };
}

/**
 * Write the two markers of a mark into the source at the range found.
 */
function applyMarkers(source: string, range: ISourceRange, id = 'm'): string {
  const opening = `${range.startPrefix}<!-- mark:${id} note -->${range.startOwnLine ? '\n' : ''}`;
  const closing = `${range.endOwnLine ? '\n' : ''}<!-- /mark:${id} -->`;
  return (
    source.slice(0, range.start) +
    opening +
    source.slice(range.start, range.end) +
    closing +
    source.slice(range.end)
  );
}

/**
 * The range a selection produces, failing the test when there is none.
 */
function sourceRange(
  root: HTMLElement,
  source: string,
  from: string,
  to: string
): ISourceRange {
  const range = selectionToSource(selectText(root, from, to), root, source);
  if (!range) {
    throw new Error('the selection was not found in the source');
  }
  return range;
}

afterEach(() => {
  document.body.innerHTML = '';
});

describe('tokeniseSource', () => {
  it('reads the words of a paragraph with their offsets', () => {
    const source = 'Alpha beta gamma.';
    const { tokens } = tokeniseSource(source);
    expect(tokens.map(token => token.text)).toEqual([
      'Alpha',
      'beta',
      'gamma.'
    ]);
    for (const token of tokens) {
      expect(source.slice(token.start, token.end)).toBe(token.text);
    }
  });

  it('ends a word at a br element written in the source, as the render does (DEF-NOTES-86)', () => {
    // The render shows a br as a line break, so the words either side of it
    // are two words there; the source reads them the same way.
    // The end-tag spelling is a br to the HTML parser as well.
    for (const br of ['<br>', '<br/>', '<br />', '<BR>', '</br>']) {
      const { tokens } = tokeniseSource(`Alpha${br}Beta and more.`);
      expect(tokens.map(token => token.text)).toEqual([
        'Alpha',
        'Beta',
        'and',
        'more.'
      ]);
    }
    // Any other inline tag still joins what it sits inside.
    expect(
      tokeniseSource('al<span>pha</span> beta').tokens.map(token => token.text)
    ).toEqual(['alpha', 'beta']);
    // A br inside a table cell likewise.
    expect(
      tokeniseSource('| head | tail |\n|---|---|\n| one<br>two | three |')
        .tokens.map(token => token.text)
        .slice(2)
    ).toEqual(['one', 'two', 'three']);
  });

  it('numbers the blocks blank lines separate', () => {
    const { tokens } = tokeniseSource('One two.\n\nThree four.\n\nFive.');
    expect(tokens.map(token => token.block)).toEqual([0, 0, 1, 1, 2]);
  });

  it('keeps a blank line inside a fence in the same block', () => {
    const source = 'Intro.\n\n```\nfirst\n\nsecond\n```\n\nTail.';
    const { tokens } = tokeniseSource(source);
    const blocks = new Map(tokens.map(token => [token.text, token.block]));
    expect(blocks.get('first')).toBe(1);
    expect(blocks.get('second')).toBe(1);
    expect(blocks.get('Tail.')).toBe(2);
  });

  it('strips emphasis and strong delimiters', () => {
    const source = 'Delta **epsilon** and *zeta* end.';
    const { tokens, protectedSpans } = tokeniseSource(source);
    expect(tokens.map(token => token.text)).toEqual([
      'Delta',
      'epsilon',
      'and',
      'zeta',
      'end.'
    ]);
    expect(protectedSpans).toContainEqual({
      kind: 'emphasis',
      start: source.indexOf('**epsilon**'),
      end: source.indexOf('**epsilon**') + '**epsilon**'.length
    });
  });

  it('joins a word split by delimiters into one token', () => {
    const source = 'a f**oo**bar b';
    const { tokens } = tokeniseSource(source);
    expect(tokens.map(token => token.text)).toEqual(['a', 'foobar', 'b']);
    expect(tokens[1].start).toBe(source.indexOf('f**oo**bar'));
    expect(tokens[1].end).toBe(source.length - 2);
  });

  it('leaves an underscore inside a word alone', () => {
    const { tokens } = tokeniseSource('the snake_case name');
    expect(tokens.map(token => token.text)).toEqual([
      'the',
      'snake_case',
      'name'
    ]);
  });

  it('keeps the text of a link and the alt of an image', () => {
    const source =
      'See [the docs](http://example.com/x) and ![a chart](c.png).';
    const { tokens, protectedSpans } = tokeniseSource(source);
    expect(tokens.map(token => token.text)).toEqual([
      'See',
      'the',
      'docs',
      'and',
      'a',
      'chart.'
    ]);
    expect(protectedSpans).toContainEqual({
      kind: 'link',
      start: source.indexOf('[the docs]'),
      end: source.indexOf(') and') + 1
    });
    expect(protectedSpans).toContainEqual({
      kind: 'image',
      start: source.indexOf('![a chart]'),
      end: source.length - 1
    });
  });

  it('keeps the text of an autolink without its brackets', () => {
    const source = 'Go to <http://example.com/x> now.';
    const { tokens, protectedSpans } = tokeniseSource(source);
    expect(tokens.map(token => token.text)).toEqual([
      'Go',
      'to',
      'http://example.com/x',
      'now.'
    ]);
    expect(protectedSpans).toContainEqual({
      kind: 'link',
      start: source.indexOf('<http'),
      end: source.indexOf('> now') + 1
    });
  });

  it('keeps the text of an inline code span without its backticks', () => {
    const source = 'Run `npm test` now.';
    const { tokens, protectedSpans } = tokeniseSource(source);
    expect(tokens.map(token => token.text)).toEqual([
      'Run',
      'npm',
      'test',
      'now.'
    ]);
    expect(protectedSpans).toContainEqual({
      kind: 'code',
      start: source.indexOf('`npm'),
      end: source.indexOf('` now') + 1
    });
  });

  it('strips heading hashes and protects the heading line', () => {
    const source = '# The title here\n\nBody text follows.';
    const { tokens, protectedSpans } = tokeniseSource(source);
    expect(tokens.map(token => token.text)).toEqual([
      'The',
      'title',
      'here',
      'Body',
      'text',
      'follows.'
    ]);
    expect(protectedSpans).toContainEqual({
      kind: 'heading',
      start: 0,
      end: '# The title here'.length
    });
  });

  it('keeps the text of a fenced block and protects the whole block', () => {
    const source = 'Intro.\n\n```js\nconst x = 1;\n```\n\nTail.';
    const { tokens, protectedSpans } = tokeniseSource(source);
    expect(tokens.map(token => token.text)).toEqual([
      'Intro.',
      'const',
      'x',
      '=',
      '1;',
      'Tail.'
    ]);
    expect(protectedSpans).toContainEqual({
      kind: 'code-block',
      start: source.indexOf('```js'),
      end: source.indexOf('```\n\nTail') + 3
    });
  });

  it('protects an indented code block', () => {
    const source = 'Intro.\n\n    const x = 1;\n    const y = 2;\n\nTail.';
    const { protectedSpans } = tokeniseSource(source);
    expect(protectedSpans).toContainEqual({
      kind: 'code-block',
      start: source.indexOf('    const x'),
      end: source.indexOf('\n\nTail')
    });
  });

  it('strips list bullets and numbers', () => {
    const { tokens } = tokeniseSource(
      '- one item\n- two item\n\n1. first\n2. second'
    );
    expect(tokens.map(token => token.text)).toEqual([
      'one',
      'item',
      'two',
      'item',
      'first',
      'second'
    ]);
  });

  it('strips blockquote markers and an alert line', () => {
    const { tokens } = tokeniseSource('> [!NOTE]\n> Mind the gap.');
    expect(tokens.map(token => token.text)).toEqual(['Mind', 'the', 'gap.']);
  });

  it('strips table pipes and the separator row', () => {
    const { tokens } = tokeniseSource(
      '| head | tail |\n| --- | --- |\n| one | two |'
    );
    expect(tokens.map(token => token.text)).toEqual([
      'head',
      'tail',
      'one',
      'two'
    ]);
  });

  it('drops a thematic break', () => {
    const { tokens } = tokeniseSource('One.\n\n---\n\nTwo.');
    expect(tokens.map(token => token.text)).toEqual(['One.', 'Two.']);
  });

  it('drops an HTML comment and protects it, over several lines', () => {
    const source =
      'Alpha <!-- mark:x note\n@kj 2026-09-06T16:00:00Z: hi\n-->beta gamma.';
    const { tokens, protectedSpans } = tokeniseSource(source);
    expect(tokens.map(token => token.text)).toEqual([
      'Alpha',
      'beta',
      'gamma.'
    ]);
    expect(protectedSpans).toContainEqual({
      kind: 'comment',
      start: source.indexOf('<!--'),
      end: source.indexOf('-->') + 3
    });
  });

  it('drops an HTML tag but keeps the text around it', () => {
    const source = 'Alpha <b>beta</b> gamma.';
    const { tokens, protectedSpans } = tokeniseSource(source);
    expect(tokens.map(token => token.text)).toEqual([
      'Alpha',
      'beta',
      'gamma.'
    ]);
    expect(protectedSpans).toContainEqual({
      kind: 'html',
      start: source.indexOf('<b>'),
      end: source.indexOf('<b>') + 3
    });
  });

  it('reads an unterminated fence to the end of the document', () => {
    const source = 'Intro.\n\n```\nconst x = 1;\n';
    const { protectedSpans } = tokeniseSource(source);
    expect(protectedSpans).toContainEqual({
      kind: 'code-block',
      start: source.indexOf('```'),
      end: source.length
    });
  });

  it('reads garbage without throwing', () => {
    for (const source of ['', '```', '[](', '<!--', '**', '<a', '|', '#']) {
      expect(() => tokeniseSource(source)).not.toThrow();
    }
  });
});

describe('locate', () => {
  const hay = 'the cat sat on the mat and the cat sat again'.split(' ');

  it('finds a sequence that occurs once', () => {
    expect(locate(['on', 'the', 'mat'], hay, 0)).toBe(3);
  });

  it('picks the occurrence nearest the hint', () => {
    expect(locate(['the', 'cat', 'sat'], hay, 0)).toBe(0);
    expect(locate(['the', 'cat', 'sat'], hay, 9)).toBe(7);
  });

  it('falls back to the first two words of the sequence', () => {
    expect(locate(['on', 'the', 'roof', 'today'], hay, 0)).toBe(3);
  });

  it('falls back to the last two words of the sequence', () => {
    expect(locate(['nothing', 'like', 'the', 'mat'], hay, 0)).toBe(2);
  });

  it('reports nothing found', () => {
    expect(locate(['dog', 'barked'], hay, 0)).toBe(-1);
    expect(locate([], hay, 0)).toBe(-1);
    expect(locate(['the'], [], 0)).toBe(-1);
  });
});

describe('selectionToSource', () => {
  it('snaps the boundaries outward to whole words', () => {
    const source = 'Alpha beta gamma delta.';
    const root = render('<p>Alpha beta gamma delta.</p>');
    const range = sourceRange(root, source, 'eta', 'gam');
    expect(applyMarkers(source, range)).toBe(
      'Alpha <!-- mark:m note -->beta gamma<!-- /mark:m --> delta.'
    );
  });

  it('widens a boundary inside emphasis to the whole span', () => {
    const source = 'Delta **epsilon** zeta.';
    const root = render('<p>Delta <strong>epsilon</strong> zeta.</p>');
    const range = sourceRange(root, source, 'silon', 'zeta.');
    expect(applyMarkers(source, range)).toBe(
      'Delta <!-- mark:m note -->**epsilon** zeta.<!-- /mark:m -->'
    );
  });

  it('finds the words before a hard line break, which the render shows with no newline (DEF-NOTES-84)', () => {
    const source =
      '3. **Ostateczny rygor:**  \n   W przypadku niewydania dokumentu:';
    const root = render(
      '<ol start="3"><li><p><strong>Ostateczny rygor:</strong><br>' +
        'W przypadku niewydania dokumentu:</p></li></ol>'
    );
    const range = sourceRange(root, source, 'Ostateczny', 'rygor:');
    expect(applyMarkers(source, range)).toBe(
      '<!-- mark:m note -->\n3. **Ostateczny rygor:**<!-- /mark:m -->  \n' +
        '   W przypadku niewydania dokumentu:'
    );
  });

  it('finds the word before a br element written in the source (DEF-NOTES-86)', () => {
    const source = 'One Alpha<br>Beta and more words here.';
    const root = render('<p>One Alpha<br>Beta and more words here.</p>');
    // The one word, selected from its first four letters to its last.
    const range = sourceRange(root, source, 'Alph', 'a');
    expect(applyMarkers(source, range)).toBe(
      'One <!-- mark:m note -->Alpha<!-- /mark:m --><br>Beta and more words here.'
    );
  });

  it('widens a boundary inside a link to the whole link', () => {
    const source = 'See [the docs](http://example.com/x) now.';
    const root = render(
      '<p>See <a href="http://example.com/x">the docs</a> now.</p>'
    );
    const range = sourceRange(root, source, 'docs', 'now.');
    expect(applyMarkers(source, range)).toBe(
      'See <!-- mark:m note -->[the docs](http://example.com/x) now.' +
        '<!-- /mark:m -->'
    );
  });

  it('widens a boundary inside inline code to the whole span', () => {
    const source = 'Run `npm test` now please.';
    const root = render('<p>Run <code>npm test</code> now please.</p>');
    const range = sourceRange(root, source, 'test', 'now');
    expect(applyMarkers(source, range)).toBe(
      'Run <!-- mark:m note -->`npm test` now<!-- /mark:m --> please.'
    );
  });

  it('widens a boundary inside a heading to the whole line, on its own line', () => {
    const source = '# The title here\n\nBody text follows.';
    const root = render('<h1>The title here</h1>\n<p>Body text follows.</p>');
    const range = sourceRange(root, source, 'title', 'follows.');
    expect(range.startOwnLine).toBe(true);
    expect(range.endOwnLine).toBe(false);
    expect(applyMarkers(source, range)).toBe(
      '<!-- mark:m note -->\n# The title here\n\nBody text follows.' +
        '<!-- /mark:m -->'
    );
  });

  it('marks a heading of one or two words past the anchor link JupyterLab appends to it (DEF-NOTES-84-1)', () => {
    // The link follows the last word with no space, so read as text it would
    // make that word another word than the source holds.
    const link = (id: string) =>
      `<a class="jp-InternalAnchorLink" href="#${id}">¶</a>`;
    const source = '### Hard criteria\n\nAll hard criteria are confirmed.';
    const root = render(
      `<h3 id="Hard-criteria">Hard criteria${link('Hard-criteria')}</h3>\n` +
        '<p>All hard criteria are confirmed.</p>'
    );
    expect(
      applyMarkers(source, sourceRange(root, source, 'Hard', 'criteria'))
    ).toBe(
      '<!-- mark:m note -->\n### Hard criteria\n<!-- /mark:m -->\n\n' +
        'All hard criteria are confirmed.'
    );

    const single = '## Notes\n\nOrder one model.';
    const one = render(
      `<h2 id="Notes">Notes${link('Notes')}</h2>\n<p>Order one model.</p>`
    );
    // The one word, selected from its first three letters to its last two.
    expect(applyMarkers(single, sourceRange(one, single, 'Not', 'es'))).toBe(
      '<!-- mark:m note -->\n## Notes\n<!-- /mark:m -->\n\nOrder one model.'
    );
  });

  it('ends a triple-click on a block before the block below it (DEF-NOTES-109)', () => {
    // Chromium reports a triple-click on a block as a range from the start of
    // its text to offset 0 of the next block element, which is before any of
    // that element's text.
    const source = '### Hard criteria\n\nAll hard criteria are confirmed.';
    const root = render(
      '<h3 id="Hard-criteria">Hard criteria' +
        '<a class="jp-InternalAnchorLink" href="#Hard-criteria">¶</a></h3>\n' +
        '<p>All hard criteria are confirmed.</p>'
    );
    const heading = selectionToSource(
      selection(
        { node: root.querySelector('h3')!.firstChild!, offset: 0 },
        { node: root.querySelector('p')!, offset: 0 }
      ),
      root,
      source
    );
    expect(heading).not.toBeNull();
    expect(applyMarkers(source, heading!)).toBe(
      '<!-- mark:m note -->\n### Hard criteria\n<!-- /mark:m -->\n\n' +
        'All hard criteria are confirmed.'
    );

    const paragraphs = 'First paragraph here.\n\nSecond paragraph here.';
    const two = render(
      '<p>First paragraph here.</p>\n<p>Second paragraph here.</p>'
    );
    const [first, second] = Array.from(two.querySelectorAll('p'));
    const paragraph = selectionToSource(
      selection(
        { node: first.firstChild!, offset: 0 },
        { node: second, offset: 0 }
      ),
      two,
      paragraphs
    );
    expect(paragraph).not.toBeNull();
    expect(applyMarkers(paragraphs, paragraph!)).toBe(
      '<!-- mark:m note -->\nFirst paragraph here.<!-- /mark:m -->\n\n' +
        'Second paragraph here.'
    );
  });

  it('takes the whole line of a heading that interrupts a paragraph', () => {
    // The line is a continuation line of its block, so only the heading being
    // a block of its own puts the marker on a line of its own.
    const source = 'Intro text here.\n# The title here\n\nBody text follows.';
    const root = render(
      '<p>Intro text here.</p>\n<h1>The title here</h1>\n' +
        '<p>Body text follows.</p>'
    );
    const range = sourceRange(root, source, 'title', 'follows.');
    expect(range.startOwnLine).toBe(true);
    expect(applyMarkers(source, range)).toBe(
      'Intro text here.\n<!-- mark:m note -->\n# The title here\n\n' +
        'Body text follows.<!-- /mark:m -->'
    );
  });

  it('widens a boundary inside a fence to the whole block, on its own line', () => {
    const source = 'Intro text here.\n\n```js\nconst x = 1;\n```\n\nTail.';
    const root = render(
      '<p>Intro text here.</p>\n' +
        '<pre><code class="language-js">const x = 1;\n</code></pre>\n' +
        '<p>Tail.</p>'
    );
    const range = sourceRange(root, source, 'text', 'const');
    expect(range.startOwnLine).toBe(false);
    expect(range.endOwnLine).toBe(true);
    expect(applyMarkers(source, range)).toBe(
      'Intro <!-- mark:m note -->text here.\n\n```js\nconst x = 1;\n```\n' +
        '<!-- /mark:m -->\n\nTail.'
    );
  });

  it('closes an indented block on its own line, not inside the code', () => {
    // An indented block ends at the end of its last content line, which is
    // also where the last word ends, so the closing boundary sits exactly on
    // the bound of the span rather than inside it. A marker left there is
    // printed as a line of the reader's own code.
    const source =
      'Prose before it.\n\n    total = one + two\n    print(total)\n\n' +
      'Prose after it.\n';
    const root = render(
      '<p>Prose before it.</p>\n' +
        '<pre><code>total = one + two\nprint(total)\n</code></pre>\n' +
        '<p>Prose after it.</p>'
    );
    const range = sourceRange(root, source, 'total', 'print(total)');
    expect(range.startOwnLine).toBe(true);
    expect(range.endOwnLine).toBe(true);
    expect(applyMarkers(source, range)).toBe(
      'Prose before it.\n\n<!-- mark:m note -->\n' +
        '    total = one + two\n    print(total)\n<!-- /mark:m -->\n\n' +
        'Prose after it.\n'
    );
  });

  it('never starts a continuation line with the opening marker', () => {
    const source = 'First line of the paragraph\nsecond line continues here.';
    const root = render(
      '<p>First line of the paragraph\nsecond line continues here.</p>'
    );
    const range = sourceRange(root, source, 'second', 'here.');
    expect(range.startOwnLine).toBe(false);
    expect(applyMarkers(source, range)).toBe(
      'First line of the paragraph<!-- mark:m note -->\n' +
        'second line continues here.<!-- /mark:m -->'
    );
  });

  it('puts the opening marker on its own line before the block it starts', () => {
    const source = 'Alpha beta.\n\nGamma delta.';
    const root = render('<p>Alpha beta.</p>\n<p>Gamma delta.</p>');
    const range = sourceRange(root, source, 'Gamma', 'delta.');
    expect(range.startOwnLine).toBe(true);
    expect(applyMarkers(source, range)).toBe(
      'Alpha beta.\n\n<!-- mark:m note -->\nGamma delta.<!-- /mark:m -->'
    );
  });

  it('places the marker at the end of the previous list item', () => {
    const source = '- one item\n- two item';
    const root = render('<ul>\n<li>one item</li>\n<li>two item</li>\n</ul>');
    const range = sourceRange(root, source, 'two', 'item');
    expect(range.startOwnLine).toBe(false);
    expect(applyMarkers(source, range)).toBe(
      '- one item<!-- mark:m note -->\n- two item<!-- /mark:m -->'
    );
  });

  it('keeps the opening marker inline on a table row, even at the first word of a cell (ACC-NOTES-154)', () => {
    const source =
      'Intro line.\n\n| Fruit | Count |\n| --- | --- |\n| apples and pears | 3 |\n| plums | 4 |';
    // The table as marked writes it, a newline between every tag.
    const root = render(
      '<p>Intro line.</p>\n<table>\n<thead>\n<tr>\n<th>Fruit</th>\n<th>Count</th>\n</tr>\n</thead>\n<tbody>\n<tr>\n<td>apples and pears</td>\n<td>3</td>\n</tr>\n<tr>\n<td>plums</td>\n<td>4</td>\n</tr>\n</tbody>\n</table>'
    );
    const range = sourceRange(root, source, 'apples', 'pears');
    expect(range.startOwnLine).toBe(false);
    expect(range.endOwnLine).toBe(false);
    expect(applyMarkers(source, range)).toBe(
      'Intro line.\n\n| Fruit | Count |\n| --- | --- |\n| <!-- mark:m note -->apples and pears<!-- /mark:m --> | 3 |\n| plums | 4 |'
    );
  });

  it('says which offsets sit on a table row (ACC-NOTES-154)', () => {
    const source =
      'Intro line.\n\n| Fruit | Count |\n| --- | --- |\n| apples | 3 |\n\nAfter the table.\n\n| not | a table |\n| no separator | here |';
    expect(inTableRow(source, source.indexOf('Intro'))).toBe(false);
    expect(inTableRow(source, source.indexOf('Fruit'))).toBe(true);
    expect(inTableRow(source, source.indexOf('apples'))).toBe(true);
    expect(inTableRow(source, source.indexOf('After'))).toBe(false);
    expect(inTableRow(source, source.indexOf('separator'))).toBe(false);
  });

  it('sees a table inside a blockquote and one that follows a text line (ACC-NOTES-154)', () => {
    const quoted =
      '> [!NOTE]\n> | Fruit | Count |\n> | --- | --- |\n> | apples | 3 |';
    expect(inTableRow(quoted, quoted.indexOf('NOTE'))).toBe(false);
    expect(inTableRow(quoted, quoted.indexOf('apples'))).toBe(true);
    const after =
      'Fruit stock:\n| Fruit | Count |\n| --- | --- |\n| apples | 3 |';
    expect(inTableRow(after, after.indexOf('stock'))).toBe(false);
    expect(inTableRow(after, after.indexOf('Fruit |'))).toBe(true);
    expect(inTableRow(after, after.indexOf('apples'))).toBe(true);
  });

  it('ends the table run where the blockquote depth changes (ACC-NOTES-154)', () => {
    const table = '| a | b |\n| --- | --- |\n| c | d |\n';
    const quoted = '> | a | b |\n> | --- | --- |\n> | c | d |\n';
    const after = table + '> quoted line';
    expect(inTableRow(after, after.indexOf('quoted'))).toBe(false);
    const plain = quoted + 'plain text';
    expect(inTableRow(plain, plain.indexOf('plain'))).toBe(false);
    const deeper = quoted + '> > deeper';
    expect(inTableRow(deeper, deeper.indexOf('deeper'))).toBe(false);
    // '>' and '> ' are one depth.
    const uneven = '> | a | b |\n>| --- | --- |\n> | c | d |';
    expect(inTableRow(uneven, uneven.indexOf('c |'))).toBe(true);
  });

  it('writes a leading pipe ahead of a marker at the first word of a row without one (ACC-NOTES-154)', () => {
    const source = 'Fruit | Count\n--- | ---\napples and pears | 3\nplums | 4';
    const root = render(
      '<table>\n<thead>\n<tr>\n<th>Fruit</th>\n<th>Count</th>\n</tr>\n</thead>\n<tbody>\n<tr>\n<td>apples and pears</td>\n<td>3</td>\n</tr>\n<tr>\n<td>plums</td>\n<td>4</td>\n</tr>\n</tbody>\n</table>'
    );
    const range = sourceRange(root, source, 'apples', 'pears');
    expect(range.startOwnLine).toBe(false);
    expect(range.startPrefix).toBe('| ');
    expect(applyMarkers(source, range)).toBe(
      'Fruit | Count\n--- | ---\n| <!-- mark:m note -->apples and pears<!-- /mark:m --> | 3\nplums | 4'
    );
    const later = sourceRange(root, source, 'and', 'pears');
    expect(later.startPrefix).toBe('');
  });

  it('writes the leading pipe on a row of a table inside a list item (ACC-NOTES-154)', () => {
    const source = '- Fruit | Count\n  --- | ---\n  apples | 3\n  plums | 4\n';
    const root = render(
      '<ul>\n<li>\n<table>\n<thead>\n<tr>\n<th>Fruit</th>\n<th>Count</th>\n</tr>\n</thead>\n<tbody>\n<tr>\n<td>apples</td>\n<td>3</td>\n</tr>\n<tr>\n<td>plums</td>\n<td>4</td>\n</tr>\n</tbody>\n</table>\n</li>\n</ul>'
    );
    const range = sourceRange(root, source, 'app', 'les');
    expect(range.startPrefix).toBe('| ');
    expect(applyMarkers(source, range)).toBe(
      '- Fruit | Count\n  --- | ---\n  | <!-- mark:m note -->apples<!-- /mark:m --> | 3\n  plums | 4\n'
    );
    const head = sourceRange(root, source, 'Fru', 'it');
    expect(applyMarkers(source, head)).toBe(
      '- | <!-- mark:m note -->Fruit<!-- /mark:m --> | Count\n  --- | ---\n  apples | 3\n  plums | 4\n'
    );
  });

  it('places the marker before a blockquote it starts, not after its marker', () => {
    const source = '> quoted text here';
    const root = render('<blockquote><p>quoted text here</p></blockquote>');
    const range = sourceRange(root, source, 'quoted', 'here');
    expect(range.startOwnLine).toBe(true);
    expect(applyMarkers(source, range)).toBe(
      '<!-- mark:m note -->\n> quoted text here<!-- /mark:m -->'
    );
  });

  it('anchors a selection spanning several blocks in the first and the last', () => {
    const source = 'Alpha beta gamma.\n\nDelta epsilon zeta.';
    const root = render('<p>Alpha beta gamma.</p>\n<p>Delta epsilon zeta.</p>');
    const range = sourceRange(root, source, 'beta', 'epsilon');
    expect(range.startOwnLine).toBe(false);
    expect(range.endOwnLine).toBe(false);
    expect(applyMarkers(source, range)).toBe(
      'Alpha <!-- mark:m note -->beta gamma.\n\nDelta epsilon' +
        '<!-- /mark:m --> zeta.'
    );
  });

  it('keeps the markers of an existing mark intact when a new one overlaps it', () => {
    const source =
      'Alpha <!-- mark:a note -->beta gamma.<!-- /mark:a -->\n\nDelta zeta.';
    const root = render('<p>Alpha beta gamma.</p>\n<p>Delta zeta.</p>');
    const range = sourceRange(root, source, 'gamma.', 'Delta');
    const marked = applyMarkers(source, range, 'b');
    expect(marked).toBe(
      'Alpha <!-- mark:a note -->beta <!-- mark:b note -->gamma.' +
        '<!-- /mark:a -->\n\nDelta<!-- /mark:b --> zeta.'
    );
    for (const marker of [
      '<!-- mark:a note -->',
      '<!-- /mark:a -->',
      '<!-- mark:b note -->',
      '<!-- /mark:b -->'
    ]) {
      expect(marked.split(marker).length - 1).toBe(1);
    }
  });

  it('reports nothing when the selected words are not in the source', () => {
    const root = render('<p>Words the source never had.</p>');
    const range = selectText(root, 'Words', 'had.');
    expect(selectionToSource(range, root, 'Alpha beta gamma.')).toBeNull();
  });

  it('reports nothing for an empty selection', () => {
    const source = 'Alpha beta gamma.';
    const root = render('<p>Alpha beta gamma.</p>');
    const node = textNodes(root)[0];
    const range = selection({ node, offset: 6 }, { node, offset: 6 });
    expect(selectionToSource(range, root, source)).toBeNull();
  });

  it('takes a boundary on an element to the text beside it', () => {
    const source = 'Alpha beta.\n\nGamma delta.';
    const root = render('<p>Alpha beta.</p><p>Gamma delta.</p>');
    const block = root.children[1];
    const range = selection(
      { node: block, offset: 0 },
      { node: block, offset: block.childNodes.length }
    );
    const found = selectionToSource(range, root, source);
    expect(found && applyMarkers(source, found)).toBe(
      'Alpha beta.\n\n<!-- mark:m note -->\nGamma delta.<!-- /mark:m -->'
    );
  });
});

/**
 * Find a passage the way the notes controller does, scanning the source and
 * the render for this one call.
 */
function inRender(
  passage: IPassage,
  source: string,
  root: HTMLElement
): IRenderedRange | null {
  return passageToRendered(
    passage,
    tokeniseSource(source),
    renderedWords(captureText(root).text)
  );
}

describe('passageToRendered', () => {
  it('finds the passage of a mark in the rendered text', () => {
    const source =
      'Alpha <!-- mark:a note -->beta gamma<!-- /mark:a --> delta.';
    const root = render('<p>Alpha beta gamma delta.</p>');
    const passage = {
      start: source.indexOf('-->') + 3,
      end: source.indexOf('<!-- /mark:a -->')
    };
    const found = inRender(passage, source, root);
    const text = 'Alpha beta gamma delta.';
    expect(found).toEqual({
      start: text.indexOf('beta'),
      end: text.indexOf('gamma') + 'gamma'.length
    });
  });

  it('finds the passage of a mark over a br element written in the source (DEF-NOTES-86)', () => {
    const source =
      'One <!-- mark:a note -->Alpha<br>Beta<!-- /mark:a --> and more.';
    const root = render('<p>One Alpha<br>Beta and more.</p>');
    const passage = {
      start: source.indexOf('-->') + 3,
      end: source.indexOf('<!-- /mark:a -->')
    };
    // The captured text breaks at the br, so the offsets are read from it.
    const text = captureText(root).text;
    expect(inRender(passage, source, root)).toEqual({
      start: text.indexOf('Alpha'),
      end: text.indexOf('Beta') + 'Beta'.length
    });
  });

  it('finds the passage of a mark on a heading of two words, past its anchor link (DEF-NOTES-84-1)', () => {
    const source =
      '<!-- mark:a note -->\n### Hard criteria\n<!-- /mark:a -->\n\n' +
      'All hard criteria are confirmed.';
    const root = render(
      '<!-- mark:a note -->\n<h3 id="Hard-criteria">Hard criteria' +
        '<a class="jp-InternalAnchorLink" href="#Hard-criteria">¶</a></h3>\n' +
        '<!-- /mark:a -->\n<p>All hard criteria are confirmed.</p>'
    );
    const passage = {
      start: source.indexOf('-->') + 3,
      end: source.indexOf('<!-- /mark:a -->')
    };
    const text = captureText(root).text;
    expect(inRender(passage, source, root)).toEqual({
      start: text.indexOf('Hard'),
      end: text.indexOf('criteria') + 'criteria'.length
    });
  });

  it('finds the passage through emphasis and a link', () => {
    const source =
      'One <!-- mark:a note -->**two** [three](http://x)<!-- /mark:a --> four.';
    const root = render(
      '<p>One <strong>two</strong> <a href="http://x">three</a> four.</p>'
    );
    const passage = {
      start: source.indexOf('-->') + 3,
      end: source.indexOf('<!-- /mark:a -->')
    };
    const text = 'One two three four.';
    expect(inRender(passage, source, root)).toEqual({
      start: text.indexOf('two'),
      end: text.indexOf('three') + 'three'.length
    });
  });

  it('picks the occurrence of a repeated passage nearest the mark', () => {
    const source =
      'the cat sat\n\nthe dog ran\n\n<!-- mark:a note -->the cat sat' +
      '<!-- /mark:a -->';
    const root = render(
      '<p>the cat sat</p>\n<p>the dog ran</p>\n<p>the cat sat</p>'
    );
    const passage = {
      start: source.lastIndexOf('-->') === -1 ? 0 : source.indexOf('-->') + 3,
      end: source.indexOf('<!-- /mark:a -->')
    };
    const found = inRender(passage, source, root);
    const text = captured(root);
    expect(found).toEqual({
      start: text.lastIndexOf('the cat sat'),
      end: text.length
    });
  });

  it('paints to the whole word when a closing marker splits one', () => {
    const source =
      'We ate <!-- mark:a note -->apples and pears<!-- /mark:a -->.';
    const root = render('<p>We ate apples and pears.</p>');
    const passage = {
      start: source.indexOf('-->') + 3,
      end: source.indexOf('<!-- /mark:a -->')
    };
    const text = 'We ate apples and pears.';
    expect(inRender(passage, source, root)).toEqual({
      start: text.indexOf('apples'),
      end: text.length
    });
  });

  it('paints to the whole word when an opening marker splits one', () => {
    const source =
      'We ate ap<!-- mark:a note -->ples and pears<!-- /mark:a --> today.';
    const root = render('<p>We ate apples and pears today.</p>');
    const passage = {
      start: source.indexOf('-->') + 3,
      end: source.indexOf('<!-- /mark:a -->')
    };
    const text = 'We ate apples and pears today.';
    expect(inRender(passage, source, root)).toEqual({
      start: text.indexOf('apples'),
      end: text.indexOf('pears') + 'pears'.length
    });
  });

  it('reports nothing when the passage is not in the render', () => {
    const source = 'Alpha <!-- mark:a note -->beta gamma<!-- /mark:a -->.';
    const root = render('<p>Nothing of the kind here.</p>');
    const passage = {
      start: source.indexOf('-->') + 3,
      end: source.indexOf('<!-- /mark:a -->')
    };
    expect(inRender(passage, source, root)).toBeNull();
  });

  it('reports nothing for a passage holding no words', () => {
    const source = 'Alpha <!-- mark:a note --><!-- /mark:a --> beta.';
    const root = render('<p>Alpha beta.</p>');
    const passage = {
      start: source.indexOf('-->') + 3,
      end: source.indexOf('<!-- /mark:a -->')
    };
    expect(inRender(passage, source, root)).toBeNull();
  });
});

/**
 * The text of a render as the extension reads it, for the expectations that
 * are offsets into it.
 */
function captured(root: HTMLElement): string {
  return textNodes(root)
    .map(node => node.nodeValue ?? '')
    .join('');
}

/**
 * Where the markers of a mark sit in the rendered text, the way `_paint`
 * asks: both scans taken once over the source and the render.
 */
function placeOf(
  open: number,
  close: number,
  source: string,
  root: HTMLElement
): number | null {
  return markerToRendered(
    open,
    close,
    tokeniseSource(source),
    renderedWords(captureText(root).text)
  );
}

/** The offsets of a mark's two markers in a source that holds both. */
function markersOf(source: string, id = 'a'): { open: number; close: number } {
  const closing = `<!-- /mark:${id} -->`;
  return {
    open: source.indexOf(`<!-- mark:${id}`),
    close: source.indexOf(closing) + closing.length
  };
}

describe('markerToRendered', () => {
  it('puts the place at the end of the words before the opening marker', () => {
    const source =
      'Alpha beta gamma <!-- mark:a note -->delta epsilon<!-- /mark:a --> zeta eta.';
    // The rewrite that took the passage away left the words around it.
    const root = render('<p>Alpha beta gamma zeta eta.</p>');
    const { open, close } = markersOf(source);
    const text = captureText(root).text;

    expect(placeOf(open, close, source, root)).toBe(
      text.indexOf('gamma') + 'gamma'.length
    );
  });

  it('puts the place at the start of the words after the closing marker where the mark opens the document', () => {
    const source =
      '<!-- mark:a note -->Alpha beta<!-- /mark:a --> gamma delta epsilon.';
    const root = render('<p>gamma delta epsilon.</p>');
    const { open, close } = markersOf(source);
    const text = captureText(root).text;

    expect(placeOf(open, close, source, root)).toBe(text.indexOf('gamma'));
  });

  it('falls back to the words after the marker where the ones before it went too', () => {
    const source =
      'One two three four five six seven eight nine ten eleven ' +
      '<!-- mark:a note -->passage<!-- /mark:a --> alpha beta gamma delta.';
    const root = render('<p>alpha beta gamma delta.</p>');
    const { open, close } = markersOf(source);
    const text = captureText(root).text;

    expect(placeOf(open, close, source, root)).toBe(text.indexOf('alpha'));
  });

  it('reports nothing where neither side of the marker is in the render', () => {
    const source =
      'Alpha beta <!-- mark:a note -->gamma<!-- /mark:a --> delta epsilon.';
    const root = render('<p>Nothing of that document is here.</p>');
    const { open, close } = markersOf(source);

    expect(placeOf(open, close, source, root)).toBeNull();
  });

  it('reads the place off the opening marker for a mark whose closing marker is gone', () => {
    const source = 'Alpha beta gamma <!-- mark:a note -->delta epsilon zeta.';
    const root = render('<p>Alpha beta gamma delta epsilon zeta.</p>');
    const open = source.indexOf('<!-- mark:a');
    const close = source.indexOf('-->') + '-->'.length;
    const text = captureText(root).text;

    expect(placeOf(open, close, source, root)).toBe(
      text.indexOf('gamma') + 'gamma'.length
    );
  });

  it('takes the place from the other side where the words before the marker matched only in part', () => {
    // locate answers a needle it cannot find whole with the place of its
    // first two words, and the walk on from there ends in an unrelated
    // clause. Here The quarterly survived the rewrite and the rest of that
    // side did not, while the whole of the other side stands in the render.
    const source =
      'The quarterly report shows that revenue in the northern region ' +
      '<!-- mark:a note -->rose sharply<!-- /mark:a --> over the period, ' +
      'which the board will review next month.';
    const root = render(
      '<p>The quarterly figures are attached as a separate spreadsheet for ' +
        'the finance team, over the period, which the board will review ' +
        'next month.</p>'
    );
    const { open, close } = markersOf(source);
    const text = captureText(root).text;

    expect(placeOf(open, close, source, root)).toBe(
      text.indexOf('over the period')
    );
  });

  it('reports nothing where each side of the marker matched only in part', () => {
    const source =
      'alpha bravo charlie delta echo foxtrot golf hotel northern region ' +
      '<!-- mark:a note -->passage here<!-- /mark:a --> and nothing else.';
    // The tail pair of the window before the marker is here and the rest of
    // it is not, and none of the window after it is here at all.
    const root = render(
      '<p>northern region is all that is left of that sentence now.</p>'
    );
    const { open, close } = markersOf(source);

    expect(placeOf(open, close, source, root)).toBeNull();
  });

  it('reports nothing where the words after the marker matched only at their tail', () => {
    // The tail pair of that window is in the render and its head is not, so
    // locate answers with the tail's place walked back to the start of the
    // render, which is a place the mark has nothing to do with.
    const source =
      '<!-- mark:a note -->passage<!-- /mark:a --> alpha bravo charlie ' +
      'delta echo foxtrot golf hotel india juliet.';
    const root = render(
      '<p>zulu yankee xray whisky victor uniform tango sierra india ' +
        'juliet.</p>'
    );
    const { open, close } = markersOf(source);

    expect(placeOf(open, close, source, root)).toBeNull();
  });

  it('reports nothing where the words before the marker matched only at their tail', () => {
    // The tail pair of that window stands in the render and its head does
    // not, so the location answers with the tail's place walked back, which
    // lands the end of the walk exactly on the window's own last word. One
    // word of the answer therefore says nothing; the run of them does.
    const source =
      'One two three four five six seven eight group last ' +
      '<!-- mark:a note -->passage<!-- /mark:a --> nothing here.';
    const root = render(
      '<p>Everything else is new text now. A working group last met in ' +
        'April.</p>'
    );
    const { open, close } = markersOf(source);

    expect(placeOf(open, close, source, root)).toBeNull();
  });

  it('reports nothing where the words after the marker matched only at their head', () => {
    const source =
      '<!-- mark:a note -->passage<!-- /mark:a --> The shipment was ' +
      'cancelled and then nothing happened for weeks.';
    const root = render(
      '<p>A wholly different opening. The shipment arrived on time and ' +
        'everyone went home early.</p>'
    );
    const { open, close } = markersOf(source);

    expect(placeOf(open, close, source, root)).toBeNull();
  });

  it('reports nothing where the words around the marker stand whole in another part of the document', () => {
    // A templated document repeats a sentence, and the rewrite took away
    // the copy the mark belongs to. The words of the other copy are the
    // window's words one for one, so only how far off it falls says that it
    // is a place the mark has nothing to do with.
    const repeated = 'Fixed a bug where the export dialog would not close on';
    const source = [
      '## Release 1.2',
      '',
      `${repeated} cancel.`,
      '',
      '## Release 1.3',
      '',
      `${repeated} <!-- mark:a note -->cancel again<!-- /mark:a --> today.`
    ].join('\n');
    const root = render(
      '<h2>Release 1.2</h2>' +
        `<p>${repeated} cancel.</p>` +
        '<h2>Release 1.3</h2>' +
        '<p>Rewritten entirely with nothing of the old sentence left here ' +
        'at all.</p>'
    );
    const { open, close } = markersOf(source);

    expect(placeOf(open, close, source, root)).toBeNull();
  });

  it('still reports nothing where that document also carries words the render does not write', () => {
    // The same document with one image in it. The words of its alt text are
    // in the file and in no text node, and a tolerance that answers to the
    // count of such words over the whole document widens by them here, where
    // they are nowhere near the marker - far enough to take in the copy of
    // the sentence the case above rejects.
    const repeated = 'Fixed a bug where the export dialog would not close on';
    const source = [
      '## Release 1.2',
      '',
      `${repeated} cancel.`,
      '',
      '![dialog](f.png)',
      '',
      '## Release 1.3',
      '',
      `${repeated} <!-- mark:a note -->cancel again<!-- /mark:a --> today.`
    ].join('\n');
    const root = render(
      '<h2>Release 1.2</h2>' +
        `<p>${repeated} cancel.</p>` +
        '<p><img alt="dialog" src="f.png" /></p>' +
        '<h2>Release 1.3</h2>' +
        '<p>Rewritten entirely with nothing of the old sentence left here ' +
        'at all.</p>'
    );
    const { open, close } = markersOf(source);

    expect(placeOf(open, close, source, root)).toBeNull();
  });

  it('stands the place where the words the render never writes are all ahead of the marker', () => {
    // A report opening with a cover figure. Its alt words are source tokens
    // and no text node, and they all stand before a mark near the top, so
    // the render is short of the source by the whole of them by the time
    // the marker is reached. A bound that gives the marker a share of them
    // in proportion to how far through the document it sits gives an early
    // marker almost none, and refuses a run standing in the render once and
    // word for word.
    const alt = Array.from({ length: 17 }, (_, i) => `cover${i}`).join(' ');
    const paragraph = (n: number): string =>
      `Paragraph ${n} of the report carries a sentence worth reading here.`;
    const rest = Array.from({ length: 20 }, (_, i) => paragraph(i + 1));
    const marked =
      'The opening line of the report itself stands here and it reads';
    const source = [
      `![${alt}](cover.png)`,
      `${marked} <!-- mark:a note -->deleted passage<!-- /mark:a --> and ends here.`,
      ...rest
    ].join('\n\n');
    const root = render(
      ['<p><img alt="cover" src="cover.png" /></p>']
        .concat([`<p>${marked} and ends here.</p>`])
        .concat(rest.map(line => `<p>${line}</p>`))
        .join('')
    );
    const { open, close } = markersOf(source);
    const text = captureText(root).text;

    const at = placeOf(open, close, source, root);

    expect(at).not.toBeNull();
    expect(text.slice(at! - 'reads'.length, at!)).toBe('reads');
  });

  it('stands the place on a document whose source carries far more words than the render shows', () => {
    // The render is short of the source by every token it does not write,
    // and a marked passage an agent rewrote into an image is exactly that:
    // its alt words are in the file and in no text node. The place is
    // expected in proportion, so the further through such a document the
    // marker sits the further that estimate drifts. A tolerance that does
    // not answer to the drift loses the place on a document of any ordinary
    // length, which is every document this feature is for.
    const alt = Array.from({ length: 30 }, (_, i) => `word${i}`).join(' ');
    const paragraph = (n: number): string =>
      `Paragraph ${n} of the report carries a sentence worth reading here.`;
    const ahead = Array.from({ length: 20 }, (_, i) => paragraph(i));
    const behind = Array.from({ length: 20 }, (_, i) => paragraph(i + 21));
    const marked = 'The marked line reads';
    const source = [
      ...ahead,
      `${marked} <!-- mark:a note -->![${alt}](m.png)` +
        '<!-- /mark:a --> and ends here.',
      ...behind
    ].join('\n\n');
    const root = render(
      [...ahead, `${marked} and ends here.`, ...behind]
        .map(line => `<p>${line}</p>`)
        .join('')
    );
    const { open, close } = markersOf(source);
    const text = captureText(root).text;

    const at = placeOf(open, close, source, root);

    expect(at).not.toBeNull();
    expect(text.slice(at! - 'reads'.length, at!)).toBe('reads');
  });

  it('takes the copy of a repeated run nearest where the marker belongs', () => {
    const run = 'repeat words here alpha bravo charlie delta echo foxtrot golf';
    const source = [
      run,
      '',
      'filler',
      '',
      `${run} <!-- mark:a note -->passage<!-- /mark:a --> tail.`
    ].join('\n');
    const root = render(`<p>${run}</p><p>filler</p><p>${run} tail.</p>`);
    const { open, close } = markersOf(source);
    const text = captureText(root).text;

    // The marker sits beside the second copy, so that is the one taken; the
    // first is further from where the run belongs than the run is long.
    expect(placeOf(open, close, source, root)).toBe(
      text.lastIndexOf('golf') + 'golf'.length
    );
  });

  it('stands the place where the render lost words before the marker and gained as many after', () => {
    // The render is the same length as the source here, so what it leaves
    // out says nothing about how far the estimate is off: a rewrite that
    // drops three words ahead of the marker and adds four behind it moves
    // the run without changing either count. The run's own span is what
    // covers that.
    const words =
      'alpha beta gamma delta epsilon zeta eta theta iota kappa lambda mu ' +
      'nu xi omicron';
    const source = `${words} <!-- mark:a note -->passage<!-- /mark:a --> end.`;
    const root = render(
      '<p>delta epsilon zeta eta theta iota kappa lambda mu nu xi omicron ' +
        'end. and four words more.</p>'
    );
    const { open, close } = markersOf(source);
    const text = captureText(root).text;

    expect(placeOf(open, close, source, root)).toBe(
      text.indexOf('omicron') + 'omicron'.length
    );
  });

  it('stands the place where the render both drops and adds many words (ACC-NOTES-180)', () => {
    // Two lengths give the net of the two counts and neither of them.
    // Thirty words gone from the head and thirty arrived at the foot leave
    // the counts one apart while the run before the marker has moved
    // thirty places, so a distance read off the lengths refuses a run that
    // stands in the render once and word for word.
    const gone = Array.from({ length: 30 }, (_, i) => `gone${i}`).join(' ');
    const kept =
      'alpha beta gamma delta epsilon zeta eta theta iota kappa lambda mu';
    const extra = Array.from({ length: 30 }, (_, i) => `extra${i}`).join(' ');
    const source = `${gone}\n\n${kept} <!-- mark:a note -->passage<!-- /mark:a --> end.`;
    const root = render(`<p>${kept} end.</p><p>${extra}</p>`);
    const { open, close } = markersOf(source);
    const text = captureText(root).text;

    expect(placeOf(open, close, source, root)).toBe(
      text.indexOf(' mu') + ' mu'.length
    );
  });

  it('reports nothing for a marker in a source of no words at all', () => {
    const source = '<!-- mark:a note --><!-- /mark:a -->';
    const root = render('<p>Alpha beta.</p>');
    const { open, close } = markersOf(source);

    expect(placeOf(open, close, source, root)).toBeNull();
  });
});
