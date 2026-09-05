import { changeRanges, diffWords, MAX_LCS_TOKENS, tokenize } from '../diff';
import {
  ADDED_CLASS,
  captureText,
  decorate,
  GAP_CLASS,
  hasVisibleChange,
  REMOVED_CLASS,
  undecorate
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
    const root = render('<p>alpha</p><p>beta</p>');
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
    expect(captureText(root).text).toBe('beforehtml');
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

  it('holds a ghost an earlier render already showed', () => {
    const root = render('<p>alpha gamma</p>');
    const snapshot = captureText(root);
    const ranges = changeRanges(diffWords('alpha beta gamma', snapshot.text));
    const fresh = changeRanges(diffWords('alpha gamma', snapshot.text));
    const [ghost] = decorate(root, snapshot, ranges, 1000, fresh);
    expect(ghost.classList.contains(REMOVED_CLASS)).toBe(true);
    expect(ghost.style.getPropertyValue('--jp-AdvancedMd-fade-in')).toBe('0ms');
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
