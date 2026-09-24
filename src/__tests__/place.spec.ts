import { measure, ReadingPlace } from '../place';

/**
 * jsdom lays nothing out and its ResizeObserver reports nothing, so this spec
 * brings both: every block of the preview has the height its `data-h` names,
 * stacked from the top of the content, and a frame is every size observer
 * called once, as the browser calls them after layout and before paint.
 */
const VIEW = 300;
const observers: (() => void)[] = [];
const originalObserver = (window as any).ResizeObserver;
const originalRect = Element.prototype.getBoundingClientRect;

class FrameObserver {
  constructor(callback: () => void) {
    observers.push(callback);
  }
  observe(): void {
    // Every observed size is reported at every frame here.
  }
  unobserve(): void {
    // As above.
  }
  disconnect(): void {
    // As above.
  }
}

const frame = () => observers.forEach(callback => callback());
const flush = () => new Promise(resolve => setTimeout(resolve, 0));

function makePreview() {
  const widgetNode = document.createElement('div');
  const host = document.createElement('div');
  host.className = 'jp-RenderedMarkdown';
  widgetNode.appendChild(host);
  document.body.appendChild(widgetNode);
  let top = 0;
  const content = () =>
    Array.from(host.children).reduce(
      (sum, block) => sum + Number((block as HTMLElement).dataset.h ?? 0),
      0
    );
  Object.defineProperty(host, 'scrollTop', {
    configurable: true,
    // Read after a layout, it is clamped to the content, as the browser does.
    get: () => Math.max(0, Math.min(top, content() - VIEW)),
    // The browser clamps to the content and, at a device pixel ratio of 1,
    // rounds to a whole pixel.
    set: (value: number) => {
      top = Math.round(Math.max(0, Math.min(value, content() - VIEW)));
    }
  });
  Object.defineProperty(host, 'clientHeight', { get: () => VIEW });
  Object.defineProperty(host, 'scrollHeight', {
    get: () => Math.max(content(), VIEW)
  });
  const parser = { render: jest.fn(async (source: string) => source) };
  const setFragment = jest.fn();
  const renderer = {
    node: host,
    markdownParser: parser as any,
    setFragment
  };
  let busy = false;
  const place = new ReadingPlace({
    widgetNode,
    renderer,
    busy: () => busy
  });
  return {
    widgetNode,
    host,
    renderer,
    parser,
    setFragment,
    place,
    setBusy: (value: boolean) => {
      busy = value;
    },
    /** What the renderer does: the whole content replaced at once. */
    render: async (blocks: [string, number][], images = '') => {
      host.innerHTML =
        blocks.map(([words, h]) => `<p data-h="${h}">${words}</p>`).join('') +
        images;
      await flush();
    },
    /** A scroll whose event the browser delivers. */
    scrollTo: (value: number) => {
      host.scrollTop = value;
      host.dispatchEvent(new Event('scroll'));
    },
    /** Where the block with those words sits, from the top of the view. */
    offsetOf: (words: string) =>
      Array.from(host.children)
        .find(block => block.textContent === words)!
        .getBoundingClientRect().top
  };
}

type Preview = ReturnType<typeof makePreview>;

/**
 * Four blocks; the reader scrolled 450 px in, so the first block whose top is
 * in view is "two", 50 px below the top of the view.
 */
const BLOCKS: [string, number][] = [
  ['zero', 200],
  ['one', 300],
  ['two', 100],
  ['three', 500]
];

describe('ReadingPlace', () => {
  let p: Preview;

  beforeEach(async () => {
    observers.length = 0;
    (window as any).ResizeObserver = FrameObserver;
    Element.prototype.getBoundingClientRect = function (this: Element) {
      const host = this.closest('.jp-RenderedMarkdown') as HTMLElement | null;
      if (!host || this === host) {
        return { top: 0, bottom: VIEW, height: VIEW } as DOMRect;
      }
      let y = -host.scrollTop;
      for (const block of Array.from(host.children)) {
        const h = Number((block as HTMLElement).dataset.h ?? 0);
        if (block === this || block.contains(this)) {
          return { top: y, bottom: y + h, height: h } as DOMRect;
        }
        y += h;
      }
      return { top: 0, bottom: 0, height: 0 } as DOMRect;
    };
    p = makePreview();
    await p.render(BLOCKS);
    p.scrollTo(450);
  });

  afterEach(() => {
    p.place.dispose();
    document.body.innerHTML = '';
    (window as any).ResizeObserver = originalObserver;
    Element.prototype.getBoundingClientRect = originalRect;
  });

  it('keeps the block in view at its place when the content above it grows (ACC-APPLY-185)', async () => {
    expect(p.offsetOf('two')).toBe(50);
    await p.render([
      ['zero', 200],
      ['one', 350],
      ['two', 100],
      ['three', 500]
    ]);
    frame();
    expect(p.offsetOf('two')).toBe(50);
    expect(p.host.scrollTop).toBe(500);
  });

  it('keeps the place when the content above it shrinks', async () => {
    await p.render([
      ['zero', 200],
      ['one', 100],
      ['two', 100],
      ['three', 500]
    ]);
    frame();
    expect(p.offsetOf('two')).toBe(50);
  });

  it('finds the block by its words when blocks were added above it', async () => {
    await p.render([['new', 80], ...BLOCKS]);
    frame();
    expect(p.offsetOf('two')).toBe(50);
  });

  it('puts back a scroll no input came before while a render settles', async () => {
    p.setBusy(true);
    await p.render(BLOCKS, '<img data-h="0">');
    frame();
    p.scrollTo(0);
    expect(p.offsetOf('two')).toBe(50);
  });

  it("takes a scroll the reader makes during a render as the reader's place (ACC-APPLY-194)", async () => {
    p.setBusy(true);
    await p.render(BLOCKS, '<img data-h="0">');
    frame();
    p.widgetNode.dispatchEvent(new Event('wheel'));
    p.scrollTo(250);
    frame();
    expect(p.host.scrollTop).toBe(250);
    // The next render keeps the place the reader chose.
    p.setBusy(false);
    await p.render(BLOCKS);
    frame();
    expect(p.host.scrollTop).toBe(250);
  });

  it('keeps a gesture the reader started before a render, putting back only what the render moved (DEF-APPLY-119)', async () => {
    // A wheel turn, then the scroll events of a drag or a smooth scroll that
    // go on with no input of their own while the render lands.
    p.widgetNode.dispatchEvent(new Event('wheel'));
    p.scrollTo(460);
    p.setBusy(true);
    await p.render(
      [
        ['zero', 200],
        ['one', 350],
        ['two', 100],
        ['three', 500]
      ],
      '<img data-h="0">'
    );
    frame();
    // The render grew the content above by 50: that is put back.
    expect(p.host.scrollTop).toBe(510);
    // The gesture goes on, and is not pulled back.
    p.scrollTo(570);
    frame();
    expect(p.host.scrollTop).toBe(570);
    // The browser's own anchoring is off while the phase is open, and back on
    // once it settles.
    expect(p.host.style.overflowAnchor).toBe('none');
    p.setBusy(false);
    p.place.checked();
    expect(p.host.style.overflowAnchor).toBe('');
  });

  it('keeps a gesture pressed before a render and moved after it (DEF-APPLY-119)', async () => {
    // A press on the text, then a render, then the view moving with no input
    // of its own, as a selection running past the edge of the view does.
    p.host.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    p.setBusy(true);
    await p.render(BLOCKS, '<img data-h="0">');
    frame();
    p.scrollTo(560);
    frame();
    expect(p.host.scrollTop).toBe(560);
  });

  it('keeps the place at the end of the document when a carried render shortens the content above', async () => {
    const tail: [string, number][] = [
      ['a', 200],
      ['b', 300],
      ['c', 100],
      ['d', 400],
      ['e', 100]
    ];
    await p.render(tail);
    frame();
    p.scrollTo(800);
    expect(p.offsetOf('e')).toBe(200);
    document.body.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    await p.render([['a', 200], ['b', 250], ...tail.slice(2)]);
    frame();
    p.host.dispatchEvent(new Event('scroll'));
    frame();
    expect(p.offsetOf('e')).toBe(200);
    expect(p.host.scrollTop).toBe(750);
  });

  it('puts back a scroll no input came before once the render a gesture ran into has settled', async () => {
    p.widgetNode.dispatchEvent(new Event('wheel'));
    p.scrollTo(460);
    await p.render(BLOCKS);
    frame();
    p.setBusy(true);
    await p.render(BLOCKS, '<img data-h="0">');
    frame();
    p.scrollTo(0);
    expect(p.host.scrollTop).toBe(460);
  });

  it('counts a click outside the preview, but not typing in an editor (ACC-APPLY-196)', async () => {
    const editor = document.createElement('div');
    editor.className = 'cm-editor';
    const panel = document.createElement('div');
    document.body.append(editor, panel);
    p.setBusy(true);
    await p.render(BLOCKS, '<img data-h="0">');
    frame();
    editor.dispatchEvent(new Event('keydown', { bubbles: true }));
    p.scrollTo(0);
    expect(p.offsetOf('two')).toBe(50);
    panel.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    p.scrollTo(0);
    expect(p.host.scrollTop).toBe(0);
  });

  it('takes a scroll whose event has not come when the render begins (ACC-APPLY-195)', async () => {
    // The browser has moved the view, but its scroll event is still to come.
    p.host.scrollTop = 570;
    await p.renderer.markdownParser.render('text');
    await p.render(BLOCKS);
    frame();
    expect(p.host.scrollTop).toBe(570);
  });

  it('puts back that same scroll when the parser did not see it', async () => {
    p.host.scrollTop = 570;
    await p.render(BLOCKS);
    frame();
    expect(p.host.scrollTop).toBe(450);
  });

  it('stays passive while another extension holds the scroll position', async () => {
    p.widgetNode.setAttribute('data-jp-scroll-guard', '');
    await p.render([
      ['zero', 200],
      ['one', 350],
      ['two', 100],
      ['three', 500]
    ]);
    frame();
    expect(p.host.scrollTop).toBe(450);
  });

  it('ends the render when it scrolls to a fragment, which is navigation', async () => {
    p.setBusy(true);
    await p.render(BLOCKS, '<img data-h="0">');
    frame();
    p.renderer.setFragment('#three');
    expect(p.setFragment).toHaveBeenCalledWith('#three');
    p.scrollTo(600);
    frame();
    expect(p.host.scrollTop).toBe(600);
  });

  it('holds the place until the image layer is done, then lets it go', async () => {
    p.setBusy(true);
    await p.render(BLOCKS, '<img data-h="0">');
    frame();
    p.scrollTo(0);
    expect(p.host.scrollTop).toBe(450);
    p.setBusy(false);
    p.place.checked();
    // Settled: a scroll now is taken as the place, not put back.
    p.scrollTo(0);
    expect(p.host.scrollTop).toBe(0);
  });

  it('keeps the place across a picture handed over after the render settled (ACC-APPLY-189)', async () => {
    await p.render(BLOCKS);
    frame();
    p.place.beforeHandOver();
    (p.host.children[1] as HTMLElement).dataset.h = '352';
    p.place.handedOver();
    expect(p.offsetOf('two')).toBe(50);
  });

  it('gives the parser and the fragment handler back when disposed', () => {
    const wrapped = p.renderer.markdownParser;
    expect(wrapped).not.toBe(p.parser);
    p.place.dispose();
    expect(p.renderer.markdownParser).toBe(p.parser);
    expect(p.renderer.setFragment).toBe(p.setFragment);
  });
});

describe('measure', () => {
  const host = document.createElement('div');

  afterEach(() => {
    Element.prototype.getBoundingClientRect = originalRect;
  });

  const lay = (tops: [string, number, number][]) => {
    host.innerHTML = tops
      .map(([words]) => (words ? `<p>${words}</p>` : '<p><img></p>'))
      .join('');
    Object.defineProperty(host, 'clientHeight', {
      configurable: true,
      get: () => VIEW
    });
    Element.prototype.getBoundingClientRect = function (this: Element) {
      if (this === host) {
        return { top: 0, bottom: VIEW, height: VIEW } as DOMRect;
      }
      const i = Array.from(host.children).indexOf(this);
      const [, top, h] = tops[i];
      return { top, bottom: top + h, height: h } as DOMRect;
    };
  };

  it('takes the first block of text whose top is in view', () => {
    lay([
      ['above', -100, 150],
      ['', 60, 40],
      ['in view', 100, 20]
    ]);
    expect(measure(host)).toEqual({
      index: 2,
      signature: 't:in view',
      offset: 100
    });
  });

  it('falls back to the block of text that reaches into view', () => {
    lay([
      ['long', -100, 800],
      ['below', 700, 20]
    ]);
    expect(measure(host)?.index).toBe(0);
  });

  it('falls back to a picture when no text reaches into view', () => {
    lay([
      ['', -10, 400],
      ['', 500, 20]
    ]);
    expect(measure(host)).toEqual({ index: 0, signature: 'i:', offset: -10 });
  });
});
