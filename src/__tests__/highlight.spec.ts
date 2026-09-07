import { changeRanges, diffWords, MAX_LCS_TOKENS, tokenize } from '../diff';
import {
  ADDED_CLASS,
  captureText,
  decorate,
  GAP_CLASS,
  hasVisibleChange,
  REMOVED_CLASS,
  undecorate,
  wasShownBefore
} from '../highlight';

/**
 * Build a stand-in for the rendered Markdown host.
 */
function render(html: string): HTMLElement {
  const root = document.createElement('div');
  root.className = 'jp-RenderedMarkdown';
  root.innerHTML = html;
  document.body.appendChild(root);
  return root;
}

afterEach(() => {
  document.body.innerHTML = '';
});

describe('captureText', () => {
  it('reads text in document order', () => {
    const root = render('<p>alpha</p>\n<p>beta</p>');
    expect(captureText(root).text).toBe('alpha\nbeta');
  });

  it('breaks between two blocks the renderer left nothing between', () => {
    // The renderer puts no whitespace between a fenced block and the
    // paragraph after it. Without a break the two words abut and the diff
    // reads them as one token.
    const root = render('<pre><code>x = 1</code></pre><p>After.</p>');
    expect(captureText(root).text).toBe('x = 1\nAfter.');
  });

  it('keeps the text of one block whole across the elements inside it', () => {
    const root = render('<p>alpha<strong>beta</strong></p>');
    expect(captureText(root).text).toBe('alphabeta');
  });

  it('maps every span back to a node holding that text', () => {
    const root = render('<p>alpha</p><p>beta</p>');
    const snapshot = captureText(root);
    for (const span of snapshot.spans) {
      expect(span.node.nodeValue).toBe(
        snapshot.text.slice(span.start, span.end)
      );
    }
  });

  it('skips script and style content', () => {
    const root = render('<p>keep</p><style>.x{color:red}</style>');
    expect(captureText(root).text).toBe('keep');
  });

  it('reads past text inside SVG but reads HTML inside a foreignObject', () => {
    const root = render(
      '<p>before</p><svg><text>label</text>' +
        '<foreignObject><div xmlns="http://www.w3.org/1999/xhtml">html</div>' +
        '</foreignObject></svg>'
    );
    expect(captureText(root).text).toBe('before\nhtml');
  });

  it('skips decorations left from an earlier change', () => {
    const root = render(
      `<p>keep<span class="jp-AdvancedMd-decoration ${REMOVED_CLASS}">ghost</span></p>`
    );
    expect(captureText(root).text).toBe('keep');
  });
});

describe('decorate', () => {
  it('wraps added text in an added decoration', () => {
    const root = render('<p>the quick brown fox</p>');
    const snapshot = captureText(root);
    const ranges = changeRanges(diffWords('the quick fox', snapshot.text));
    decorate(root, snapshot, ranges, 1000);
    const added = root.querySelectorAll(`.${ADDED_CLASS}`);
    expect(added.length).toBeGreaterThan(0);
    expect(
      Array.from(added)
        .map(el => el.textContent)
        .join('')
    ).toContain('brown');
  });

  it('leaves the reader-visible text unchanged when only adding', () => {
    const root = render('<p>the quick brown fox</p>');
    const snapshot = captureText(root);
    const ranges = changeRanges(diffWords('the quick fox', snapshot.text));
    decorate(root, snapshot, ranges, 1000);
    expect(root.textContent).toBe('the quick brown fox');
  });

  it('inserts removed text as a removed decoration', () => {
    const root = render('<p>the quick fox</p>');
    const snapshot = captureText(root);
    const ranges = changeRanges(
      diffWords('the quick brown fox', snapshot.text)
    );
    decorate(root, snapshot, ranges, 1000);
    const removed = root.querySelectorAll(`.${REMOVED_CLASS}`);
    expect(removed.length).toBeGreaterThan(0);
    expect(
      Array.from(removed)
        .map(el => el.textContent)
        .join('')
    ).toContain('brown');
  });

  it('never adds a direct child to the render root', () => {
    const root = render('<p>alpha</p>\n<p>gamma</p>');
    const beforeCount = root.children.length;
    const snapshot = captureText(root);
    const ranges = changeRanges(diffWords('alpha\nbeta\ngamma', snapshot.text));
    decorate(root, snapshot, ranges, 1000);
    expect(root.children.length).toBe(beforeCount);
  });

  it('never wraps the whitespace between blocks when a block was added', () => {
    const root = render('<p>alpha</p>\n<p>beta</p>\n');
    const snapshot = captureText(root);
    const ranges = changeRanges(diffWords('alpha\n', snapshot.text));
    decorate(root, snapshot, ranges, 1000);
    expect(root.children.length).toBe(2);
    expect(root.querySelectorAll(`.${ADDED_CLASS}`).length).toBeGreaterThan(0);
  });

  it('shows no ghost for a removal past the diff token bound', () => {
    const root = render('<p>replacement text</p>');
    const snapshot = captureText(root);
    const removed = 'old '.repeat(MAX_LCS_TOKENS / 2 + 1);
    const ranges = changeRanges(diffWords(removed, snapshot.text));
    expect(tokenize(ranges.removed[0].text).length).toBeGreaterThan(
      MAX_LCS_TOKENS
    );
    decorate(root, snapshot, ranges, 1000);
    expect(root.querySelectorAll(`.${REMOVED_CLASS}`).length).toBe(0);
    expect(root.querySelectorAll(`.${ADDED_CLASS}`).length).toBeGreaterThan(0);
  });

  it('leaves a changed SVG label untouched', () => {
    const root = render('<p>text</p><svg><text>new label</text></svg>');
    const snapshot = captureText(root);
    const ranges = changeRanges(diffWords('text', snapshot.text));
    decorate(root, snapshot, ranges, 1000);
    expect(root.querySelector('svg text')?.innerHTML).toBe('new label');
    expect(root.querySelectorAll(`.${ADDED_CLASS}`).length).toBe(0);
  });

  it('puts a gap after a ghost that would touch its replacement', () => {
    const root = render('<p>mentions oranges.</p>');
    const snapshot = captureText(root);
    const ranges = changeRanges(diffWords('mentions apples.', snapshot.text));
    decorate(root, snapshot, ranges, 1000);
    const ghost = root.querySelector(`.${REMOVED_CLASS}`) as HTMLElement;
    expect(ghost.textContent).toBe('apples.');
    expect(ghost.classList.contains(GAP_CLASS)).toBe(true);
  });

  it('puts no gap after a ghost already followed by whitespace', () => {
    const root = render('<p>alpha gamma</p>');
    const snapshot = captureText(root);
    const ranges = changeRanges(diffWords('alpha beta gamma', snapshot.text));
    decorate(root, snapshot, ranges, 1000);
    const ghost = root.querySelector(`.${REMOVED_CLASS}`) as HTMLElement;
    expect(ghost.textContent).toBe('beta ');
    expect(ghost.classList.contains(GAP_CLASS)).toBe(false);
  });

  it('fades in only what this render changed when told what is fresh', () => {
    const root = render('<p>alpha beta gamma</p>');
    const snapshot = captureText(root);
    const ranges = changeRanges(diffWords('alpha', snapshot.text));
    const fresh = changeRanges(diffWords('alpha beta', snapshot.text));
    const created = decorate(root, snapshot, ranges, 1000, fresh);
    const fadeIn = created.map(element => [
      element.textContent,
      element.style.getPropertyValue('--jp-AdvancedMd-fade-in')
    ]);
    expect(fadeIn).toEqual([
      [' beta', '0ms'],
      [' gamma', '']
    ]);
  });

  it('tells a decoration an earlier render already showed from a fresh one', () => {
    const root = render('<p>alpha beta gamma</p>');
    const snapshot = captureText(root);
    const ranges = changeRanges(diffWords('alpha', snapshot.text));
    const fresh = changeRanges(diffWords('alpha beta', snapshot.text));
    const created = decorate(root, snapshot, ranges, 1000, fresh);
    expect(created.map(wasShownBefore)).toEqual([true, false]);
  });

  it('holds a ghost an earlier render already showed', () => {
    const root = render('<p>alpha gamma</p>');
    const snapshot = captureText(root);
    const ranges = changeRanges(diffWords('alpha beta gamma', snapshot.text));
    const fresh = changeRanges(diffWords('alpha gamma', snapshot.text));
    const [ghost] = decorate(root, snapshot, ranges, 1000, fresh);
    expect(ghost.classList.contains(REMOVED_CLASS)).toBe(true);
    expect(ghost.style.getPropertyValue('--jp-AdvancedMd-fade-in')).toBe('0ms');
  });

  it('shows a merged removal as one held ghost when an earlier render showed part of it', () => {
    const root = render('<p>alpha epsilon</p>');
    const snapshot = captureText(root);
    const ranges = changeRanges(
      diffWords('alpha beta gamma delta epsilon', snapshot.text)
    );
    const fresh = changeRanges(diffWords('alpha gamma epsilon', snapshot.text));
    const ghosts = decorate(root, snapshot, ranges, 1000, fresh);
    expect(ghosts.map(ghost => ghost.textContent)).toEqual([
      'beta gamma delta '
    ]);
    expect(ghosts.map(wasShownBefore)).toEqual([true]);
    expect(root.textContent).toBe('alpha beta gamma delta epsilon');
  });

  it('holds a ghost already on screen when the word at its offset is replaced again', () => {
    const root = render('<p>mentions pears.</p>');
    const snapshot = captureText(root);
    const ranges = changeRanges(diffWords('mentions apples.', snapshot.text));
    const fresh = changeRanges(diffWords('mentions oranges.', snapshot.text));
    const ghosts = decorate(root, snapshot, ranges, 1000, fresh).filter(
      element => element.classList.contains(REMOVED_CLASS)
    );
    expect(ghosts.map(ghost => ghost.textContent)).toEqual(['apples.']);
    expect(ghosts.map(wasShownBefore)).toEqual([true]);
  });

  it('fades in a ghost of text this render removed', () => {
    const root = render('<p>mentions pears.</p>');
    const snapshot = captureText(root);
    const ranges = changeRanges(diffWords('mentions apples.', snapshot.text));
    const ghosts = decorate(root, snapshot, ranges, 1000, ranges).filter(
      element => element.classList.contains(REMOVED_CLASS)
    );
    expect(ghosts.map(ghost => ghost.textContent)).toEqual(['apples.']);
    expect(ghosts.map(wasShownBefore)).toEqual([false]);
  });

  it('places the ghosts it is given at their offsets, in their order', () => {
    const root = render('<p>alpha delta</p>');
    const snapshot = captureText(root);
    const ranges = changeRanges(
      diffWords('alpha beta gamma delta', snapshot.text)
    );
    const fresh = changeRanges(diffWords('alpha gamma delta', snapshot.text));
    const ghosts = decorate(root, snapshot, ranges, 1000, fresh, undefined, [
      { at: 6, text: 'beta ', fresh: false },
      { at: 6, text: 'gamma ', fresh: true }
    ]);
    expect(ghosts.map(ghost => ghost.textContent)).toEqual(['beta ', 'gamma ']);
    expect(ghosts.map(wasShownBefore)).toEqual([true, false]);
    expect(root.textContent).toBe('alpha beta gamma delta');
  });

  it('places a given ghost where this render removed the text, not where the baseline puts it', () => {
    const inserted = `${Array.from({ length: 20 }, () => 'very').join(' ')} `;
    const root = render(`<p>The ${inserted}sat.</p>`);
    const snapshot = captureText(root);
    const ranges = changeRanges(diffWords('The cat sat.', snapshot.text));
    const fresh = changeRanges(
      diffWords(`The ${inserted}cat sat.`, snapshot.text)
    );
    expect(ranges.removed).toEqual([{ at: 4, text: 'cat' }]);
    expect(fresh.removed).toEqual([{ at: 104, text: 'cat ' }]);
    const created = decorate(root, snapshot, ranges, 1000, fresh, undefined, [
      { ...fresh.removed[0], fresh: true }
    ]);
    const ghosts = created.filter(el => el.classList.contains(REMOVED_CLASS));
    expect(ghosts.map(ghost => ghost.textContent)).toEqual(['cat ']);
    expect(ghosts.map(wasShownBefore)).toEqual([false]);
    expect(root.textContent).toBe(`The ${inserted}cat sat.`);
  });

  it('moves a given ghost out of a heading like any other', () => {
    const root = render('<h2 id="r">Summary</h2>\n<p>Body</p>');
    const snapshot = captureText(root);
    const ranges = changeRanges(diffWords('Report\nBody', snapshot.text));
    const created = decorate(root, snapshot, ranges, 1000, ranges, undefined, [
      { at: 0, text: 'Report', fresh: false }
    ]);
    const ghost = created.find(element =>
      element.classList.contains(REMOVED_CLASS)
    ) as HTMLElement;
    expect(ghost.textContent).toBe('Report');
    expect(wasShownBefore(ghost)).toBe(true);
    expect(ghost.parentElement).toBe(root.querySelector('p'));
    const heading = root.querySelector('h2') as HTMLElement;
    expect(heading.textContent).toBe('Summary');
    expect(heading.id).toBe('r');
  });

  it('cuts a slice shown before where the carried runs it spans meet', () => {
    const root = render('<p>alpha aaa bbb ccc</p>');
    const snapshot = captureText(root);
    const ranges = changeRanges(diffWords('alpha', snapshot.text));
    const fresh = changeRanges(diffWords('alpha aaa bbb', snapshot.text));
    const created = decorate(root, snapshot, ranges, 1000, fresh, {
      added: [' aaa', ' bbb']
    });
    expect(created.map(element => element.textContent)).toEqual([
      ' aaa',
      ' bbb',
      ' ccc'
    ]);
    expect(created.map(wasShownBefore)).toEqual([true, true, false]);
    expect(root.textContent).toBe('alpha aaa bbb ccc');
  });

  it('moves a removal inside a heading to the block after it', () => {
    const root = render(
      '<h2 id="r">Summary<a class="jp-InternalAnchorLink">¶</a></h2>\n<p>Body</p>'
    );
    const snapshot = captureText(root);
    const ranges = changeRanges(diffWords('Report¶\nBody', snapshot.text));
    const created = decorate(root, snapshot, ranges, 1000);
    const ghost = created.find(element =>
      element.classList.contains(REMOVED_CLASS)
    ) as HTMLElement;
    expect(ghost.textContent).toBe('Report¶');
    expect(ghost.parentElement).toBe(root.querySelector('p'));
    const heading = root.querySelector('h2') as HTMLElement;
    expect(heading.textContent).toBe('Summary¶');
    expect(heading.id).toBe('r');
  });

  it('shows no ghost when only headings could hold it', () => {
    const root = render('<h1 id="a">A</h1>\n<h1 id="b">B</h1>');
    const snapshot = captureText(root);
    const ranges = changeRanges(diffWords('A\nGone\nB', snapshot.text));
    decorate(root, snapshot, ranges, 1000);
    expect(root.querySelectorAll(`.${REMOVED_CLASS}`).length).toBe(0);
    expect(root.textContent).toBe('A\nB');
  });

  it('puts a paragraph removed before a heading at the end of the block before it', () => {
    const root = render('<p>Alpha.</p>\n<h2 id="c">Gamma</h2>');
    const snapshot = captureText(root);
    const ranges = changeRanges(
      diffWords('Alpha.\nBeta gone.\nGamma', snapshot.text)
    );
    const [ghost] = decorate(root, snapshot, ranges, 1000);
    expect(ghost.textContent).toBe('Beta gone.\n');
    expect(ghost.parentElement).toBe(root.querySelector('p'));
    const heading = root.querySelector('h2') as HTMLElement;
    expect(heading.textContent).toBe('Gamma');
    expect(heading.id).toBe('c');
  });

  it('shows no ghost when only the added side of a replacement passes the bound', () => {
    const root = render(`<p>a ${'new '.repeat(600)}</p>`);
    const snapshot = captureText(root);
    const ranges = changeRanges(
      diffWords(`a ${'old '.repeat(400)}`, snapshot.text)
    );
    expect(tokenize(ranges.removed[0].text).length).toBeLessThanOrEqual(
      MAX_LCS_TOKENS
    );
    const added = ranges.added[0];
    expect(
      tokenize(snapshot.text.slice(added.start, added.end)).length
    ).toBeGreaterThan(MAX_LCS_TOKENS);
    decorate(root, snapshot, ranges, 1000);
    expect(root.querySelectorAll(`.${REMOVED_CLASS}`).length).toBe(0);
    expect(root.querySelectorAll(`.${ADDED_CLASS}`).length).toBeGreaterThan(0);
  });

  it('shows a short ghost when only the addition beside it passes the bound', () => {
    const root = render(
      `<p>${'para '.repeat(200)}The new closing sentence here.</p><p>${'appended '.repeat(600)}</p>`
    );
    const snapshot = captureText(root);
    const ranges = changeRanges(
      diffWords(
        `${'para '.repeat(200)}The old closing sentence here.`,
        snapshot.text
      )
    );
    expect(ranges.removed.map(removal => removal.text)).toEqual([
      'old closing sentence here.'
    ]);
    const added = ranges.added[0];
    expect(added.start).toBe(ranges.removed[0].at);
    expect(
      tokenize(snapshot.text.slice(added.start, added.end)).length
    ).toBeGreaterThan(MAX_LCS_TOKENS);
    decorate(root, snapshot, ranges, 1000);
    const ghosts = root.querySelectorAll(`.${REMOVED_CLASS}`);
    expect(ghosts.length).toBe(1);
    expect(ghosts[0].textContent).toBe('old closing sentence here.');
  });

  it('carries the fade duration onto the decoration', () => {
    const root = render('<p>alpha beta</p>');
    const snapshot = captureText(root);
    const ranges = changeRanges(diffWords('alpha', snapshot.text));
    const created = decorate(root, snapshot, ranges, 2500);
    expect(created.length).toBeGreaterThan(0);
    expect(
      created[0].style.getPropertyValue('--jp-AdvancedMd-fade-duration')
    ).toBe('2500ms');
  });

  it('decorates a change inside a fenced code block without losing the code', () => {
    const root = render('<pre><code>let x = 2;</code></pre>');
    const snapshot = captureText(root);
    const ranges = changeRanges(diffWords('let x = 1;', snapshot.text));
    decorate(root, snapshot, ranges, 1000);
    expect(root.querySelector('pre code')).not.toBeNull();
    expect(root.textContent).toContain('let x =');
  });

  it('keeps a ghost inside a fenced block clear of the paragraph after it', () => {
    // The rendered view of the document this stands in for holds no
    // whitespace between the fenced block and the paragraph: the code element
    // ends at 'second = 2' and the next text is 'After the block.'.
    const root = render(
      '<h1 id="Report">Report</h1><p>Before the block.</p>' +
        '<pre><code class="language-python">first = 1\nsecond = 33</code></pre>' +
        '<p>After the block.</p>'
    );
    const snapshot = captureText(root);
    const previous = snapshot.text.replace('second = 33', 'second = 2');
    const ranges = changeRanges(diffWords(previous, snapshot.text));
    decorate(root, snapshot, ranges, 1000);
    const texts = (selector: string) =>
      Array.from(root.querySelectorAll(selector)).map(
        element => element.textContent
      );
    expect(texts(`.${REMOVED_CLASS}`)).toEqual(['2']);
    expect(texts(`.${ADDED_CLASS}`)).toEqual(['33']);
    // The block reads as its own code for the whole fade.
    expect(root.querySelector('code')?.textContent).toBe(
      'first = 1\nsecond = 233'
    );
    expect(root.querySelector('p:last-of-type')?.textContent).toBe(
      'After the block.'
    );
  });

  it('shows no ghost when the change left the render with no block', () => {
    // Nothing survived the change, so the only place a ghost could go is a new
    // direct child of the render root, which another extension counts. The
    // reader sees an empty page and the tab cue instead.
    const root = render('');
    const snapshot = captureText(root);
    const ranges = changeRanges(diffWords('gone words here', snapshot.text));
    expect(decorate(root, snapshot, ranges, 1000)).toEqual([]);
    expect(root.childNodes.length).toBe(0);
  });

  it('puts the ghost of all the text in the block that survived it', () => {
    const root = render('<p><img src="a.png"></p>');
    const snapshot = captureText(root);
    const ranges = changeRanges(diffWords('gone words here', snapshot.text));
    const created = decorate(root, snapshot, ranges, 1000);
    expect(created.map(element => element.textContent)).toEqual([
      'gone words here'
    ]);
    expect(created[0].parentElement).toBe(root.querySelector('p'));
    expect(root.children.length).toBe(1);
  });

  it('passes over a heading when only headings and a block survived', () => {
    const root = render(
      '<h1 id="a"><img src="a.png"></h1><p><img src="b.png"></p>'
    );
    const snapshot = captureText(root);
    const ranges = changeRanges(diffWords('gone words here', snapshot.text));
    const created = decorate(root, snapshot, ranges, 1000);
    expect(created.map(element => element.parentElement?.tagName)).toEqual([
      'P'
    ]);
    const heading = root.querySelector('h1') as HTMLElement;
    expect(heading.textContent).toBe('');
    expect(heading.id).toBe('a');
  });
});

describe('undecorate', () => {
  it('restores the rendered markup exactly', () => {
    const root = render('<p>the quick brown fox</p>');
    const original = root.innerHTML;
    const snapshot = captureText(root);
    const ranges = changeRanges(diffWords('the quick fox', snapshot.text));
    const created = decorate(root, snapshot, ranges, 1000);
    expect(root.innerHTML).not.toBe(original);
    undecorate(created);
    expect(root.innerHTML).toBe(original);
  });

  it('deletes removed ghosts rather than unwrapping them', () => {
    const root = render('<p>the quick fox</p>');
    const snapshot = captureText(root);
    const ranges = changeRanges(
      diffWords('the quick brown fox', snapshot.text)
    );
    const created = decorate(root, snapshot, ranges, 1000);
    undecorate(created);
    expect(root.textContent).toBe('the quick fox');
  });
});

describe('hasVisibleChange', () => {
  it('is false when nothing changed', () => {
    expect(hasVisibleChange(changeRanges(diffWords('same', 'same')))).toBe(
      false
    );
  });

  it('is true when text was added', () => {
    expect(hasVisibleChange(changeRanges(diffWords('a', 'a b')))).toBe(true);
  });
});
