/**
 * Keeps the reader's place in a Markdown preview across a render.
 *
 * A render replaces every element of the preview, so the browser's own scroll
 * anchoring has nothing left to hold, and a pixel offset put back afterwards
 * lands on whatever moved into it (DEF-APPLY-116). The place is kept by
 * content instead: the first block of text in view and its distance from the
 * top of the view.
 *
 * The place is read from the layout the reader was shown: at every scroll
 * event and at every size change of the preview outside a render. A render
 * starts a phase when its content goes in. During a phase the block is put
 * back at its distance whenever the layout moves it - at every size change,
 * which a ResizeObserver reports after layout and before paint, at every
 * image hand-over and image load, and at a scroll the reader did not make -
 * until every image of the render is complete and the image layer is done
 * with it, the reader acts, or the next render starts. Nothing here waits on
 * a timer.
 */

import { IRenderMime } from '@jupyterlab/rendermime-interfaces';
import { IDisposable } from '@lumino/disposable';

import { IImageListener } from './imagereuse';

/**
 * Attribute the switch-tab scrolling fix puts on the document widget while it
 * holds the scroll position. While it is there, that extension owns the
 * position and the place is neither kept nor corrected (ACC-COMPAT-42).
 */
const FOREIGN_SCROLL_GUARD_ATTRIBUTE = 'data-jp-scroll-guard';

/**
 * How many characters of a block's text tell it from its neighbours.
 */
const SIGNATURE_LENGTH = 48;

/**
 * A displacement below this is none. Any larger one is written to scrollTop,
 * which the browser may round to a whole pixel.
 */
const EPSILON_PX = 0.01;

/**
 * A block still this far from its place when a phase settles could not be put
 * back - the content below it is too short - so what is on screen is the
 * place from then on.
 */
const REST_PX = 1;

/**
 * Where text is entered. A key press or a click there is writing, not moving
 * the view, and typing in the same file is what re-renders the preview.
 */
const TEXT_ENTRY = 'input, textarea, [contenteditable], .cm-editor';

/**
 * The renderer of a Markdown preview, as far as the place needs it.
 */
export interface IPlaceRenderer {
  readonly node: HTMLElement;
  markdownParser: IRenderMime.IMarkdownParser | null;
  setFragment(fragment: string): void;
}

/**
 * Options for {@link ReadingPlace}.
 */
export interface IReadingPlaceOptions {
  /**
   * The node of the document widget: the reader's input and another
   * extension's guard are read on it.
   */
  widgetNode: HTMLElement;
  /**
   * The renderer of the preview. Its node is the scrolling element and the
   * render host.
   */
  renderer: IPlaceRenderer;
  /**
   * Whether the image layer may still change the picture of that image.
   */
  busy: (img: HTMLImageElement) => boolean;
}

/**
 * The reader's place: a block of the preview and its distance from the top of
 * the view.
 */
interface IAnchor {
  index: number;
  signature: string;
  offset: number;
}

/**
 * A render in progress, from its content going in until it settles.
 */
interface IPhase {
  images: HTMLImageElement[];
  input: number;
  block: Element | null;
  /**
   * Whether the render landed while the reader may still be moving the view:
   * an input of theirs came since the last render settled. The scroll events
   * of that motion - a scrollbar drag, a selection running past the edge, a
   * smooth scroll a key started - come with no input of their own, some of
   * them only after the render has landed, so in this phase
   * a scroll the layer did not make is the reader's motion and is kept; only
   * what the layout did to the block is put back (DEF-APPLY-119). The
   * browser's own scroll anchoring is off for the phase: the shift it makes
   * when a picture above grows would read as the reader's motion, and the
   * layer puts the block back itself.
   */
  carried: boolean;
}

/**
 * Keeps one preview's reader at the same text while it renders.
 */
export class ReadingPlace implements IDisposable, IImageListener {
  constructor(options: IReadingPlaceOptions) {
    this._widgetNode = options.widgetNode;
    this._renderer = options.renderer;
    this._host = options.renderer.node;
    this._busy = options.busy;

    this._renders = new MutationObserver(this._onRecords);
    this._renders.observe(this._host, { childList: true });
    this._sizes = new ResizeObserver(this._onResize);

    this._parser = this._renderer.markdownParser;
    if (this._parser) {
      const original = this._parser;
      const wrapped: IRenderMime.IMarkdownParser = Object.create(original);
      wrapped.render = async (source: string) => {
        const html = await original.render(source);
        this._onParsed();
        return html;
      };
      this._renderer.markdownParser = wrapped;
    }
    this._setFragment = this._renderer.setFragment;
    this._renderer.setFragment = (fragment: string) => {
      // A render carrying a fragment scrolls to it: that is navigation, and
      // the place is where it lands.
      if (fragment) {
        this._endPhase();
      }
      this._setFragment.call(this._renderer, fragment);
    };

    this._widgetNode.addEventListener('scroll', this._onScroll, true);
    this._widgetNode.addEventListener('load', this._onImage, true);
    this._widgetNode.addEventListener('error', this._onImage, true);
    for (const type of ['wheel', 'touchstart']) {
      this._widgetNode.addEventListener(type, this._onInput, {
        capture: true,
        passive: true
      });
    }
    // A click or a key press anywhere else can move this view too - a heading
    // chosen in the table of contents panel, a command - so those count
    // wherever they land, text entry apart.
    for (const type of ['pointerdown', 'keydown']) {
      document.addEventListener(type, this._onInput, {
        capture: true,
        passive: true
      });
    }
  }

  get isDisposed(): boolean {
    return this._disposed;
  }

  dispose(): void {
    if (this._disposed) {
      return;
    }
    this._disposed = true;
    this._renders.disconnect();
    this._sizes.disconnect();
    if (this._parser) {
      this._renderer.markdownParser = this._parser;
    }
    this._renderer.setFragment = this._setFragment;
    this._widgetNode.removeEventListener('scroll', this._onScroll, true);
    this._widgetNode.removeEventListener('load', this._onImage, true);
    this._widgetNode.removeEventListener('error', this._onImage, true);
    for (const type of ['wheel', 'touchstart']) {
      this._widgetNode.removeEventListener(type, this._onInput, true);
    }
    for (const type of ['pointerdown', 'keydown']) {
      document.removeEventListener(type, this._onInput, true);
    }
    this._endPhase();
  }

  /**
   * A picture is about to change size outside a render: a scroll whose event
   * has not come yet is the reader's place, read from the layout the
   * hand-over is about to change.
   */
  beforeHandOver(): void {
    if (!this._phase && this._anchor && !this._guarded() && this._moved()) {
      this._record();
    }
  }

  /**
   * Pictures changed size. Outside a render this starts a phase from the
   * place last read, the layout the reader was shown; either way the place
   * is kept at once, before the next frame.
   */
  handedOver(): void {
    if (!this._phase && this._anchor && !this._guarded()) {
      this._beginPhase();
    }
    this._correct();
    this._settle();
  }

  checked(): void {
    this._settle();
  }

  /**
   * The parser returned, just before the render puts its content in. A
   * scroll whose event has not come yet is the reader's place. Nothing else
   * is read here: the layout may already have changed in this task, before
   * the reader saw it.
   */
  private _onParsed(): void {
    if (!this._disposed && !this._phase && this._moved()) {
      this._record();
    }
  }

  /**
   * The render put its content in. Its record is the render's first, so this
   * runs before the image layer sees an address, and before any frame of the
   * new content is painted. No layout is read here.
   */
  private _onRecords = (records: MutationRecord[]): void => {
    if (!records.some(record => record.addedNodes.length)) {
      return;
    }
    this._endPhase();
    this._observe();
    if (this._anchor && !this._guarded()) {
      this._beginPhase();
    }
  };

  /**
   * Observe the size of the host, of every block and of every image, so each
   * change is reported in the frame that lays it out.
   */
  private _observe(): void {
    this._sizes.disconnect();
    this._sizes.observe(this._host);
    for (const element of Array.from(this._host.children)) {
      this._sizes.observe(element);
    }
    for (const img of Array.from(this._host.querySelectorAll('img'))) {
      this._sizes.observe(img);
    }
  }

  private _onResize = (): void => {
    if (this._disposed || this._guarded()) {
      return;
    }
    if (this._phase) {
      this._correct();
      this._settle();
    } else if (this._anchor) {
      // The layout the reader is shown changed without a render, the window
      // resized or a picture arrived late: what is on screen is the place.
      this._record();
    }
  };

  /**
   * A scroll this layer did not make. Outside a phase, or after the reader
   * acted, it is the reader's place; inside a phase it is another party's,
   * and the place is put back.
   */
  private _onScroll = (event: Event): void => {
    if (event.target !== this._host) {
      return;
    }
    if (this._written !== null && this._host.scrollTop === this._written) {
      this._written = null;
      return;
    }
    this._written = null;
    if (!this._phase || this._guarded()) {
      this._record();
      return;
    }
    if (this._phase.input !== this._input) {
      this._endPhase();
      this._record();
      return;
    }
    this._correct();
  };

  private _onImage = (event: Event): void => {
    const img = event.target as HTMLImageElement;
    if (!this._phase || !this._phase.images.includes(img)) {
      return;
    }
    this._correct();
    this._settle();
  };

  /**
   * The reader acted. An input event is dispatched before the scroll it
   * causes, so the scroll is known to be theirs when it comes.
   */
  private _onInput = (event: Event): void => {
    const target = event.target as Element | null;
    if (
      (event.type === 'keydown' || event.type === 'pointerdown') &&
      target?.closest?.(TEXT_ENTRY)
    ) {
      return;
    }
    this._input += 1;
  };

  private _beginPhase(): void {
    this._phase = {
      images: Array.from(this._host.querySelectorAll('img')),
      input: this._input,
      block: null,
      carried: this._input !== this._settledInput
    };
    if (this._phase.carried) {
      this._host.style.overflowAnchor = 'none';
    }
  }

  private _endPhase(): void {
    if (this._phase?.carried) {
      this._host.style.overflowAnchor = '';
    }
    this._phase = null;
  }

  /**
   * End the phase once every image of the render is complete and the image
   * layer is done with it. A block that could not be put back leaves what is
   * on screen as the place.
   */
  private _settle(): void {
    const phase = this._phase;
    if (!phase) {
      return;
    }
    const settled = phase.images.every(img => img.complete && !this._busy(img));
    if (!settled) {
      return;
    }
    this._correct();
    if (this._phase !== phase) {
      return;
    }
    const rest = this._displacement();
    this._endPhase();
    this._settledInput = this._input;
    if (Math.abs(rest) > REST_PX) {
      this._record();
    }
  }

  /**
   * Put the block back at its distance from the top of the view.
   */
  private _correct(): void {
    const phase = this._phase;
    if (!phase || !this._anchor || this._guarded()) {
      return;
    }
    if (phase.input !== this._input) {
      // The reader acted since the render began: a correction now could undo
      // the scroll their input is about to cause.
      this._endPhase();
      return;
    }
    const top = this._host.scrollTop;
    if (phase.carried && top !== this._known) {
      // The reader's motion moved the block as far as it moved the view: the
      // place goes with it. A view that dropped to the end of shorter content
      // was clamped by the browser, which the displacement already counts.
      const known = this._known ?? 0;
      const clamped =
        top < known &&
        top >= this._host.scrollHeight - this._host.clientHeight - 1;
      if (!clamped) {
        this._anchor.offset -= top - known;
      }
      this._known = top;
    }
    const delta = this._displacement();
    if (Math.abs(delta) < EPSILON_PX) {
      return;
    }
    const before = this._host.scrollTop;
    this._host.scrollTop = before + delta;
    const after = this._host.scrollTop;
    if (after !== before) {
      this._written = after;
      this._known = after;
    }
  }

  /**
   * How far the block now is from where the reader had it.
   */
  private _displacement(): number {
    const block = this._block();
    if (!block || !this._anchor) {
      return 0;
    }
    const top = this._host.getBoundingClientRect().top;
    return block.getBoundingClientRect().top - top - this._anchor.offset;
  }

  /**
   * The block of the place in the current content: at the same index if it
   * reads the same, else the nearest one that does, else the same index.
   */
  private _block(): Element | null {
    const phase = this._phase;
    const anchor = this._anchor;
    if (!anchor) {
      return null;
    }
    if (phase?.block && phase.block.parentNode === this._host) {
      return phase.block;
    }
    const blocks = this._host.children;
    let found: Element | null = null;
    if (!blocks.length) {
      found = null;
    } else if (
      anchor.index < blocks.length &&
      signature(blocks[anchor.index]) === anchor.signature
    ) {
      found = blocks[anchor.index];
    } else {
      for (let d = 1; d < blocks.length && !found; d++) {
        for (const i of [anchor.index - d, anchor.index + d]) {
          if (
            i >= 0 &&
            i < blocks.length &&
            signature(blocks[i]) === anchor.signature
          ) {
            found = blocks[i];
            break;
          }
        }
      }
      found ??= blocks[Math.min(anchor.index, blocks.length - 1)];
    }
    if (phase) {
      phase.block = found;
    }
    return found;
  }

  /**
   * Read the place from the layout on screen now.
   */
  private _record(): void {
    this._anchor = measure(this._host);
    this._known = this._host.scrollTop;
  }

  /**
   * Whether the view scrolled since the place was last read or written: a
   * scroll whose event has not come yet.
   */
  private _moved(): boolean {
    return this._known === null
      ? this._host.scrollTop !== 0
      : this._host.scrollTop !== this._known;
  }

  private _guarded(): boolean {
    return this._widgetNode.hasAttribute(FOREIGN_SCROLL_GUARD_ATTRIBUTE);
  }

  private _widgetNode: HTMLElement;
  private _renderer: IPlaceRenderer;
  private _host: HTMLElement;
  private _busy: (img: HTMLImageElement) => boolean;
  private _renders: MutationObserver;
  private _sizes: ResizeObserver;
  private _parser: IRenderMime.IMarkdownParser | null;
  private _setFragment: (fragment: string) => void;
  private _anchor: IAnchor | null = null;
  private _phase: IPhase | null = null;
  private _known: number | null = null;
  private _written: number | null = null;
  private _input = 0;
  private _settledInput = 0;
  private _disposed = false;
}

/**
 * The text of a block, with runs of white space as one space.
 */
function text(block: Element): string {
  return (block.textContent ?? '').replace(/\s+/g, ' ').trim();
}

/**
 * What tells a block from its neighbours: the start of its text, or the file
 * of its picture, or its tag.
 */
function signature(block: Element): string {
  const words = text(block);
  if (words) {
    return `t:${words.slice(0, SIGNATURE_LENGTH)}`;
  }
  const img = block.localName === 'img' ? block : block.querySelector('img');
  if (img) {
    return `i:${(img.getAttribute('src') ?? '').replace(/[?&]\d{10,}$/, '')}`;
  }
  return `e:${block.localName}`;
}

/**
 * The place on screen now: the first block of text whose top is in view;
 * failing that the first block of text that reaches into view, then the first
 * block of any kind that does.
 */
export function measure(host: HTMLElement): IAnchor | null {
  const top = host.getBoundingClientRect().top;
  const bottom = top + host.clientHeight;
  const blocks = Array.from(host.children);
  const boxes = blocks.map(block => block.getBoundingClientRect());
  const at = (i: number): IAnchor => ({
    index: i,
    signature: signature(blocks[i]),
    offset: boxes[i].top - top
  });
  const rules: ((i: number) => boolean)[] = [
    i =>
      boxes[i].height > 0 &&
      boxes[i].top >= top &&
      boxes[i].top < bottom &&
      !!text(blocks[i]),
    i => boxes[i].height > 0 && boxes[i].bottom > top && !!text(blocks[i]),
    i => boxes[i].height > 0 && boxes[i].bottom > top
  ];
  for (const rule of rules) {
    const i = blocks.findIndex((_, index) => rule(index));
    if (i >= 0) {
      return at(i);
    }
  }
  return null;
}
