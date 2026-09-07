import {
  IPassage,
  IRenderedRange,
  ISelectionRange,
  ISourceRange,
  locate,
  passageToRendered,
  renderedWords,
  selectionToSource,
  tokeniseSource
} from '../anchor';
import { captureText } from '../highlight';

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
  const opening = `<!-- mark:${id} note -->${range.startOwnLine ? '\n' : ''}`;
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
