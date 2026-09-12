import { changeRanges, diffWords, mapOffsets } from '../diff';
import { ChangeAnimator, GHOST_HOLD_MS, TYPING_CLASS } from '../animate';
import { ADDED_CLASS, captureText, decorate, undecorate } from '../highlight';

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

/**
 * Decorate a root against the text it held before.
 *
 * @param shown - the text of the previous render of the same fade, when there
 * was one; its ghosts then come from the animator
 */
function decorateFrom(
  root: HTMLElement,
  before: string,
  shown?: string,
  animator?: ChangeAnimator
): HTMLElement[] {
  const snapshot = captureText(root);
  const ranges = changeRanges(diffWords(before, snapshot.text));
  if (shown === undefined) {
    return decorate(root, snapshot, ranges, 1000);
  }
  const ops = diffWords(shown, snapshot.text);
  const ghosts = animator?.ghosts(ops, mapOffsets(ops));
  return decorate(
    root,
    snapshot,
    ranges,
    1000,
    changeRanges(ops),
    animator?.carried(),
    ghosts
  );
}

const texts = (elements: HTMLElement[]) =>
  elements.map(element => element.textContent);

describe('ChangeAnimator', () => {
  let animator: ChangeAnimator;

  beforeEach(() => {
    jest.useFakeTimers();
    animator = new ChangeAnimator();
  });

  afterEach(() => {
    animator.clear();
    document.body.innerHTML = '';
    jest.useRealTimers();
  });

  it('stop restores the full text so undecorate returns the markup', () => {
    const root = render('<p>the quick brown fox</p>');
    const original = root.innerHTML;
    const created = decorateFrom(root, 'the quick fox');
    animator.start(created, 100);
    jest.advanceTimersByTime(20);
    expect(root.textContent).not.toBe('the quick brown fox');
    animator.stop();
    undecorate(created);
    expect(root.innerHTML).toBe(original);
  });

  describe('jitter (ACC-ANIM-158)', () => {
    // Forty characters at 100 a second: 400 ms even, in 16 ms frames.
    const SENTENCE = 'the quick brown fox jumped over a dog!!!';
    const typed = (jitter: number, random: () => number, ms: number) => {
      const root = render(`<p>${SENTENCE}</p>`);
      const created = decorateFrom(root, '');
      animator.jitter = jitter;
      animator.random = random;
      animator.start(created, 100);
      jest.advanceTimersByTime(ms);
      return root.textContent!.length;
    };

    it('types evenly at jitter 0', () => {
      expect(typed(0, () => 0.9, 208)).toBe(20);
      expect(typed(0, () => 0.9, 400)).toBe(40);
    });

    it('takes one and a quarter times the even time with every draw at its top', () => {
      expect(typed(0.25, () => 1, 400)).toBe(32);
      expect(typed(0.25, () => 1, 512)).toBe(40);
    });

    it('takes three quarters of the even time with every draw at its bottom', () => {
      expect(typed(0.25, () => 0, 288)).toBe(38);
      expect(typed(0.25, () => 0, 304)).toBe(40);
    });

    it('keeps the speed on average over many characters', () => {
      // A thousand characters at 100 a second: ten seconds even. Draws that
      // alternate far around the middle keep the mean where the setting says.
      const root = render(`<p>${'x'.repeat(1000)}</p>`);
      const created = decorateFrom(root, '');
      animator.jitter = 1;
      let i = 0;
      animator.random = () => (i++ % 2 ? 0.95 : 0.05);
      animator.start(created, 100);
      jest.advanceTimersByTime(9792);
      expect(root.textContent!.length).toBeLessThan(1000);
      jest.advanceTimersByTime(224);
      expect(root.textContent!.length).toBe(1000);
    });

    it('drives every run of a render from the one draw, so runs stay in step', () => {
      const root = render('<p>first para</p><p>other para</p>');
      const created = decorateFrom(root, '');
      animator.jitter = 0.5;
      animator.random = () => 1;
      animator.start(created, 100);
      // Ten characters each at 15 ms a character.
      jest.advanceTimersByTime(144);
      expect(texts(created).map(text => text!.length)).toEqual([9, 9]);
      jest.advanceTimersByTime(32);
      expect(texts(created)).toEqual(['first para', 'other para']);
    });
  });

  it('records nothing at speed 0', () => {
    const root = render('<p>the quick brown fox</p>');
    const created = decorateFrom(root, 'the quick fox');
    const decorated = root.innerHTML;
    expect(animator.start(created, 0)).toBe(0);
    expect(root.querySelectorAll(`.${TYPING_CLASS}`).length).toBe(0);
    expect(root.textContent).toBe('the quick brown fox');
    expect(root.innerHTML).toBe(decorated);
  });

  it('leaves a decoration inside a heading complete', () => {
    const root = render('<h2 id="r">Report card</h2>\n<p>x y</p>');
    const created = decorateFrom(root, 'Report\nx');
    animator.start(created, 100);
    const heading = root.querySelector('h2') as HTMLElement;
    const [inHeading, inParagraph] = created;
    expect(inHeading.classList.contains(TYPING_CLASS)).toBe(false);
    expect(inHeading.textContent).toBe(' card');
    expect(heading.textContent).toBe('Report card');
    expect(heading.id).toBe('r');
    expect(inParagraph.classList.contains(TYPING_CLASS)).toBe(true);
    expect(inParagraph.textContent).toBe('');
  });

  it('reports the time until the longest run is done', () => {
    const root = render(`<p>alpha gamma ${'x'.repeat(19)}</p>`);
    const created = decorateFrom(root, 'alpha beta gamma');
    expect(created.map(element => element.textContent)).toEqual([
      'beta ',
      ` ${'x'.repeat(19)}`
    ]);
    expect(animator.start(created, 100)).toBe(
      Math.max(200, GHOST_HOLD_MS + 50)
    );
  });

  it('does not re-create a ghost already deleted', () => {
    const first = render('<p>alpha gamma</p>');
    const [ghost] = decorateFrom(first, 'alpha beta gamma');
    animator.start([ghost], 100);
    jest.advanceTimersByTime(GHOST_HOLD_MS + 100);
    expect(ghost.parentNode).toBeNull();
    animator.stop();

    const ops = diffWords('alpha gamma', 'alpha gamma delta');
    expect(animator.ghosts(ops, mapOffsets(ops))).toEqual([]);
    const second = render('<p>alpha gamma delta</p>');
    const created = decorateFrom(
      second,
      'alpha beta gamma',
      'alpha gamma',
      animator
    );
    expect(texts(created)).toEqual([' delta']);
  });

  describe('ghosts', () => {
    it('re-creates a live ghost where the mapping puts it and continues it there', () => {
      const first = render('<p>one</p>\n<p>alpha gamma</p>');
      const [ghost] = decorateFrom(first, 'one\nalpha beta gamma');
      animator.start([ghost], 100);
      jest.advanceTimersByTime(300);
      animator.stop();

      const ops = diffWords('one\nalpha gamma', 'one two\nalpha gamma');
      const offsets = mapOffsets(ops);
      expect(animator.ghosts(ops, offsets)).toEqual([
        { at: 14, text: 'beta ', fresh: false }
      ]);
      const second = render('<p>one two</p>\n<p>alpha gamma</p>');
      const created = decorateFrom(
        second,
        'one\nalpha beta gamma',
        'one\nalpha gamma',
        animator
      );
      expect(texts(created)).toEqual([' two', 'beta ']);
      expect(second.textContent).toBe('one two\nalpha beta gamma');
      // The rest of the warning pause, then the deletion, as one run.
      const remaining = animator.start(created, 100, offsets);
      expect(remaining).toBeGreaterThan(GHOST_HOLD_MS - 300);
      expect(remaining).toBeLessThan(GHOST_HOLD_MS + 50 - 250);
    });

    it('puts a carried ghost before a fresh one at the same offset', () => {
      const first = render('<p>alpha gamma delta</p>');
      const [ghost] = decorateFrom(first, 'alpha beta gamma delta');
      animator.start([ghost], 100);
      jest.advanceTimersByTime(100);
      animator.stop();

      const ops = diffWords('alpha gamma delta', 'alpha delta');
      expect(animator.ghosts(ops, mapOffsets(ops))).toEqual([
        { at: 6, text: 'beta ', fresh: false },
        { at: 6, text: 'gamma ', fresh: true }
      ]);
    });

    it('clips a removal inside a run still typing to what the run had shown', () => {
      const first = render('<p>The quick brown fox jumps</p>');
      const created = decorateFrom(first, '');
      animator.start(created, 100);
      jest.advanceTimersByTime(100);
      const shown = (created[0].textContent as string).length;
      expect(shown).toBeGreaterThan('The '.length);
      expect(shown).toBeLessThan('The quick brown'.length);
      animator.stop();

      // 'quick brown ' straddles the typed edge; ' jumps' was never shown.
      const ops = diffWords('The quick brown fox jumps', 'The fox');
      expect(animator.ghosts(ops, mapOffsets(ops))).toEqual([
        {
          at: 4,
          text: 'quick brown '.slice(0, shown - 'The '.length),
          fresh: true
        }
      ]);
    });

    it('leaves a removal outside any run whole', () => {
      const first = render('<p>alpha</p>\n<p>The quick brown fox</p>');
      const created = decorateFrom(first, 'alpha');
      animator.start(created, 100);
      jest.advanceTimersByTime(20);
      animator.stop();

      const ops = diffWords(
        'alpha\nThe quick brown fox',
        '\nThe quick brown fox'
      );
      expect(animator.ghosts(ops, mapOffsets(ops))).toEqual([
        { at: 0, text: 'alpha', fresh: true }
      ]);
    });
  });

  describe('typing order', () => {
    const added = (root: HTMLElement) =>
      Array.from(root.querySelectorAll<HTMLElement>(`.${ADDED_CLASS}`)).map(
        element => element.textContent ?? ''
      );

    it('types the text nodes of one added range in document order', () => {
      const root = render(
        '<p>The quick <strong>brown</strong> fox jumps over the lazy dog</p>'
      );
      const created = decorateFrom(root, '');
      expect(created.length).toBe(3);
      animator.start(created, 100);
      let previous = ['', '', ''];
      for (let t = 0; t < 500; t += 16) {
        jest.advanceTimersByTime(16);
        const now = added(root);
        // A node shows nothing until every node before it is complete.
        if (now[1].length > 0) {
          expect(now[0]).toBe('The quick ');
        }
        if (now[2].length > 0) {
          expect(now[1]).toBe('brown');
        }
        for (let i = 0; i < 3; i++) {
          expect(now[i].length).toBeGreaterThanOrEqual(previous[i].length);
        }
        previous = now;
      }
      expect(added(root)).toEqual([
        'The quick ',
        'brown',
        ' fox jumps over the lazy dog'
      ]);
      expect(root.querySelectorAll(`.${TYPING_CLASS}`).length).toBe(0);
    });

    it('takes as long as a plain paragraph of the same length', () => {
      const plain = render(
        '<p>The quick brown fox jumps over the lazy dog</p>'
      );
      const marked = render(
        '<p>The <em>quick</em> <strong>brown</strong> fox <code>jumps</code> over the lazy dog</p>'
      );
      const plainRun = decorateFrom(plain, '');
      const markedRun = decorateFrom(marked, '');
      expect(animator.start(plainRun, 100)).toBe(430);
      animator.clear();
      expect(animator.start(markedRun, 100)).toBe(430);
    });

    it('types separate blocks at the same time', () => {
      const root = render(`<p>${'a'.repeat(30)}</p>\n<p>${'b'.repeat(30)}</p>`);
      const created = decorateFrom(root, '');
      animator.start(created, 100);
      jest.advanceTimersByTime(100);
      const [first, second] = added(root);
      expect(first.length).toBeGreaterThan(0);
      expect(first.length).toBe(second.length);
    });

    it('does not retype a run the next render continues', () => {
      const root = render(
        '<p>The quick <strong>brown</strong> fox jumps over the lazy dog</p>'
      );
      const created = decorateFrom(root, '');
      animator.start(created, 100);
      jest.advanceTimersByTime(130);
      const shown = added(root);
      expect(shown[0]).toBe('The quick ');
      expect(shown[1].length).toBeGreaterThan(0);
      expect(shown[1].length).toBeLessThan(5);
      animator.stop();

      const again = render(
        '<p>The quick <strong>brown</strong> fox jumps over the lazy dog</p>'
      );
      const before = 'The quick brown fox jumps over the lazy dog';
      const ops = diffWords(before, before);
      const continued = decorateFrom(again, '', before, animator);
      animator.start(continued, 100, mapOffsets(ops));
      // Each part keeps its own progress; nothing typed is typed again.
      expect(added(again)).toEqual(shown);
      jest.advanceTimersByTime(16);
      const next = added(again);
      expect(next[0]).toBe('The quick ');
      expect(next[1].length).toBeGreaterThan(shown[1].length);
      // The part after the bold word waits until the bold word is complete.
      for (let frame = 0; frame < 8 && added(again)[1] !== 'brown'; frame++) {
        expect(added(again)[2]).toBe('');
        jest.advanceTimersByTime(16);
      }
      expect(added(again)[1]).toBe('brown');
    });
  });
});
