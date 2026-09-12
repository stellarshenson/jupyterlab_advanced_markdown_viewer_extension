/**
 * Typing and deleting the text of a change, one frame at a time.
 *
 * The rendered text really grows and shrinks: an added decoration starts with
 * an empty text node and receives a few more characters on every painted
 * frame, a removal ghost stands complete for a warning pause and then loses
 * characters from its end until it is taken out. The decorations of one
 * contiguous added range type one after another, in document order, however
 * many text nodes the renderer split it into; ranges in different blocks type
 * at the same time. All writes for all decorations of a document happen in one
 * animation frame callback with no layout read, so the browser runs one style,
 * layout and paint pass per frame however many places a write changed.
 *
 * The animator edits only the text child of a decoration span. It never adds
 * or removes a child of the render root, never touches a decoration inside a
 * heading, and sets no style on any element.
 */

import { IDiffOp, IOffsetMap } from './diff';
import {
  HEADINGS,
  ICarriedRuns,
  IGhost,
  offsetOf,
  REMOVED_CLASS,
  wasShownBefore
} from './highlight';

/**
 * Class on a decoration whose typing or deletion is in progress. The
 * stylesheet holds the fade-out while it is present.
 */
export const TYPING_CLASS = 'jp-AdvancedMd-typing';

/**
 * How long a decoration takes to rise to its colour. Matches the stylesheet.
 */
export const FADE_IN_MS = 500;

/**
 * How long a removal ghost stands complete before its deletion starts: its
 * own rise, the time the added text beside it takes to reach its colour, so
 * the ghost is seen whole before it goes. The deletion then runs beside the
 * typing, the one the inverse of the other (ACC-HILITE-156).
 */
export const GHOST_HOLD_MS = FADE_IN_MS;

/**
 * One decoration being typed or deleted.
 */
interface IRun {
  element: HTMLElement;
  node: Text;
  text: string;
  kind: 'added' | 'removed';
  /** Where the decoration sat in the text of the render that made it. */
  at: number;
  /**
   * Characters on screen right now; fractional between frames. Negative while
   * an added run waits for the runs before it in the same range to finish.
   */
  shown: number;
  /** Warning pause left before a ghost starts deleting, in milliseconds. */
  holdLeft: number;
  done: boolean;
}

/**
 * Offsets left as they are, for a render with no earlier one to map from.
 */
const SAME_OFFSETS: IOffsetMap = {
  toEarlier: offset => offset,
  toLater: offset => offset
};

/**
 * Drives the change animation of one document.
 */
export class ChangeAnimator {
  /**
   * Characters per second, read on every frame so a change takes effect at
   * once. 0 ends every run on the next frame: added text is completed and a
   * ghost still whole is left to the fade.
   */
  speed = 0;

  /**
   * How far the time of a character may stray from the even time at the
   * speed, as a share of it, drawn evenly either way: 0 types like a clock,
   * 0.25 lets a character take between three quarters and one and a quarter
   * of its time, and the mean stays the speed (ACC-ANIM-158).
   */
  jitter = 0;

  /**
   * The draw behind the jitter, replaceable by a test that needs a run to
   * take a known time.
   */
  random: () => number = Math.random;

  /**
   * Begin animating the decorations of a render.
   *
   * A decoration built for text an earlier render already showed continues
   * from where that render's run stopped. An added decoration continues the
   * run that sat at the same place in the previous render's text, found
   * through the mapping between the two texts, holding the decoration's text;
   * the next write may cut that run into pieces, so a decoration whose text is
   * part of a previous run's text continues that run from its own place in it,
   * and {@link decorate} cuts a slice spanning several runs where they meet,
   * so each part finds its own. A ghost continues the run {@link ghosts}
   * re-created it from, the one with its offset and text. Without a match an
   * added decoration is complete on arrival and a ghost stands without a
   * second warning, so nothing is retyped and no ghost warns twice.
   *
   * A fresh added decoration that starts where the previous added run of this
   * render ends waits for that run: it starts in debt by the characters the
   * run still has to type, so one added range types in document order across
   * the text nodes it was rendered into. A continued run keeps its own
   * progress and starts a new chain. Decorations inside headings are never
   * animated, and at speed 0 nothing is.
   *
   * @param elements - the decorations {@link decorate} returned
   * @param speed - characters per second
   * @param offsets - the mapping between the previous render's text and this
   * one's; omitted when there is nothing to continue
   * @returns how long the longest run will take, in milliseconds
   */
  start(
    elements: HTMLElement[],
    speed: number,
    offsets: IOffsetMap = SAME_OFFSETS
  ): number {
    this.speed = speed;
    this._cancelFrame();
    const carry = this._runs;
    const cursor = { added: 0 };
    const continued = new Set<IRun>();
    const runs: IRun[] = [];
    let chain: IRun | null = null;
    for (const element of elements) {
      const node = element.firstChild;
      if (
        speed <= 0 ||
        !(node instanceof Text) ||
        element.closest(HEADINGS) !== null
      ) {
        continue;
      }
      const text = node.data;
      const kind = element.classList.contains(REMOVED_CLASS)
        ? 'removed'
        : 'added';
      const at = offsetOf(element);
      let shown = kind === 'added' ? 0 : text.length;
      let holdLeft = kind === 'added' ? 0 : GHOST_HOLD_MS;
      if (wasShownBefore(element)) {
        const match =
          kind === 'added'
            ? this._find(carry, text, at, offsets, cursor)
            : this._findGhost(carry, text, at, offsets, continued);
        if (match) {
          const { run: previous, offset } = match;
          // A continued run keeps its matched shown, a negative value
          // included, so it still waits for the node before it. When the
          // second write deletes that node, the node directly after the
          // deletion finds no carried run, because the mapping resolves its
          // offset to the end of the unchanged text before the deletion
          // (diff.ts toEarlier), and is complete on arrival; the nodes after
          // it wait out their remaining debt before typing.
          shown = Math.min(previous.shown - offset, text.length);
          holdLeft = previous.holdLeft;
        } else if (kind === 'added') {
          continue;
        } else {
          holdLeft = 0;
        }
      } else if (
        kind === 'added' &&
        chain !== null &&
        at === chain.at + chain.text.length
      ) {
        shown = Math.min(0, chain.shown - chain.text.length);
      }
      const run: IRun = {
        element,
        node,
        text,
        kind,
        at,
        shown,
        holdLeft,
        done: false
      };
      element.classList.add(TYPING_CLASS);
      this._write(run);
      runs.push(run);
      if (kind === 'added') {
        chain = run;
      }
    }
    this._runs = runs;
    this._lastTick = Date.now();
    if (runs.some(run => !run.done)) {
      this._frame = requestAnimationFrame(this._tick);
    }
    return this.remainingMs();
  }

  /**
   * Stop driving the decorations. Added text is completed first, so
   * {@link undecorate} puts the whole document back; the runs are kept so a
   * later render can continue them.
   */
  stop(): void {
    this._cancelFrame();
    for (const run of this._runs) {
      if (!run.done && run.kind === 'added') {
        run.node.data = run.text;
      }
    }
  }

  /**
   * Stop and forget the runs, when the fade they belong to is over.
   */
  clear(): void {
    this.stop();
    this._runs = [];
  }

  /**
   * The texts of the added runs held from the previous render, for
   * {@link decorate} to cut a slice shown before where the runs it spans meet.
   */
  carried(): ICarriedRuns {
    return {
      added: this._runs.filter(run => run.kind === 'added').map(run => run.text)
    };
  }

  /**
   * The ghosts a render made during a pending fade shows, for
   * {@link decorate}.
   *
   * The removals this render made are fresh ghosts at their own offsets. The
   * ghosts of the previous render that are still on their way out are
   * re-created where the mapping puts them, with their own text, and continue
   * in {@link start} by that offset and text; a ghost already taken out is not
   * re-created, so text that left the view never comes back. Where a carried
   * ghost and a fresh one share an offset, the carried one comes first. A
   * removal inside an added run still typing is clipped to what the run had
   * shown, and one inside text the run had not shown yet gets no ghost, so
   * nothing the reader never saw is struck out.
   *
   * @param ops - the edit script from the previous render's text to this one's
   * @param offsets - the mapping built from `ops`
   */
  ghosts(ops: IDiffOp[], offsets: IOffsetMap): IGhost[] {
    const result: IGhost[] = [];
    for (const run of this._runs) {
      if (run.kind === 'removed' && !run.done) {
        result.push({
          at: offsets.toLater(run.at),
          text: run.text,
          fresh: false
        });
      }
    }
    let earlier = 0;
    let later = 0;
    for (const op of ops) {
      if (op.kind === 'delete') {
        const text = this._shownOf(earlier, op.text);
        if (text) {
          result.push({ at: later, text, fresh: true });
        }
      }
      if (op.kind !== 'insert') {
        earlier += op.text.length;
      }
      if (op.kind !== 'delete') {
        later += op.text.length;
      }
    }
    return result.sort((a, b) => a.at - b.at);
  }

  /**
   * How long until the last run is done at the current speed, in
   * milliseconds.
   */
  remainingMs(): number {
    if (this.speed <= 0) {
      return 0;
    }
    let longest = 0;
    for (const run of this._runs) {
      if (run.done) {
        continue;
      }
      const left =
        run.kind === 'added'
          ? ((run.text.length - run.shown) / this.speed) * 1000
          : run.holdLeft + (run.shown / this.speed) * 1000;
      longest = Math.max(longest, left);
    }
    return longest;
  }

  /**
   * Find the carried run an added decoration continues, and where in it its
   * text starts: the run that held its place in the previous text, mapped
   * back through the unchanged text, whose text at that place is the
   * decoration's. Decorations arrive in document order, so the search resumes
   * at the previous match.
   */
  private _find(
    carry: IRun[],
    text: string,
    at: number,
    offsets: IOffsetMap,
    cursor: { added: number }
  ): { run: IRun; offset: number } | null {
    const earlier = offsets.toEarlier(at);
    for (let i = 0; i < carry.length; i++) {
      const index = (cursor.added + i) % carry.length;
      const run = carry[index];
      const offset = earlier - run.at;
      if (
        run.kind === 'added' &&
        offset >= 0 &&
        run.text.startsWith(text, offset)
      ) {
        cursor.added = index;
        return { run, offset };
      }
    }
    return null;
  }

  /**
   * Find the carried run a ghost was re-created from: the live removed run
   * whose mapped offset and text are the ghost's, both as {@link ghosts} set
   * them. Each run continues one ghost.
   */
  private _findGhost(
    carry: IRun[],
    text: string,
    at: number,
    offsets: IOffsetMap,
    continued: Set<IRun>
  ): { run: IRun; offset: number } | null {
    for (const run of carry) {
      if (
        run.kind === 'removed' &&
        !run.done &&
        !continued.has(run) &&
        run.text === text &&
        offsets.toLater(run.at) === at
      ) {
        continued.add(run);
        return { run, offset: 0 };
      }
    }
    return null;
  }

  /**
   * The characters of a removal the reader has seen: all of them except
   * those inside the unshown part of an added run still typing.
   *
   * @param earlier - where the removal sat in the previous render's text
   */
  private _shownOf(earlier: number, text: string): string {
    let result = '';
    for (let i = 0; i < text.length; i++) {
      const offset = earlier + i;
      const unshown = this._runs.some(
        run =>
          run.kind === 'added' &&
          !run.done &&
          offset >= run.at + Math.max(0, Math.floor(run.shown)) &&
          offset < run.at + run.text.length
      );
      if (!unshown) {
        result += text[i];
      }
    }
    return result;
  }

  private _tick = (): void => {
    this._frame = null;
    const now = Date.now();
    const dt = now - this._lastTick;
    this._lastTick = now;
    const budget = this._budget(dt);
    let pending = false;
    for (const run of this._runs) {
      if (run.done) {
        continue;
      }
      if (run.kind === 'added') {
        run.shown = Math.min(run.shown + budget, run.text.length);
      } else if (this.speed <= 0 && run.shown >= run.text.length) {
        // Speed 0 ends the animation: a ghost still whole stands and leaves
        // with the fade, as without animation. One already shortened is taken
        // out below.
        run.element.classList.remove(TYPING_CLASS);
        run.done = true;
        continue;
      } else {
        run.holdLeft -= dt;
        if (run.holdLeft <= 0) {
          run.shown = Math.max(run.shown - budget, 0);
        }
      }
      this._write(run);
      pending = pending || !run.done;
    }
    if (pending) {
      this._frame = requestAnimationFrame(this._tick);
    }
  };

  /**
   * Put a run's current progress on screen, and finish it when it is there.
   */
  private _write(run: IRun): void {
    if (run.kind === 'added') {
      const slice = run.text.slice(0, Math.max(0, Math.floor(run.shown)));
      if (run.node.data !== slice) {
        run.node.data = slice;
      }
      if (run.shown >= run.text.length) {
        run.element.classList.remove(TYPING_CLASS);
        run.done = true;
      }
      return;
    }
    if (run.shown <= 0) {
      run.element.parentNode?.removeChild(run.element);
      run.done = true;
      return;
    }
    const slice = run.text.slice(0, Math.ceil(run.shown));
    if (run.node.data !== slice) {
      run.node.data = slice;
    }
  }

  /**
   * How many characters a frame's time buys at the speed, walked one
   * character at a time: each character has a time of its own, the even time
   * scaled by a factor drawn once for it, and the one draw serves every run,
   * so runs that follow one another keep in step.
   */
  private _budget(dt: number): number {
    if (this.speed <= 0) {
      return Infinity;
    }
    const even = 1000 / this.speed;
    let budget = 0;
    let left = dt;
    while (left > 0) {
      if (this._charLeft <= 0) {
        this._charLeft = 1;
        this._factor = 1 + this.jitter * (2 * this.random() - 1);
      }
      const time = even * this._factor;
      const need = this._charLeft * time;
      if (left < need) {
        const part = left / time;
        budget += part;
        this._charLeft -= part;
        break;
      }
      budget += this._charLeft;
      left -= need;
      this._charLeft = 0;
    }
    return budget;
  }

  private _cancelFrame(): void {
    if (this._frame !== null) {
      cancelAnimationFrame(this._frame);
      this._frame = null;
    }
  }

  private _runs: IRun[] = [];
  private _frame: number | null = null;
  private _lastTick = 0;
  private _factor = 1;
  private _charLeft = 0;
}
