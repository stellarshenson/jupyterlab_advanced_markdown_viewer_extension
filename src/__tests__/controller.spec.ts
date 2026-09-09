import { Signal } from '@lumino/signaling';
import { Title } from '@lumino/widgets';

/**
 * The watcher polls a server; here it is a pair of signals the test fires.
 */
jest.mock('../watcher', () => {
  const { Signal } = jest.requireActual(
    '@lumino/signaling'
  ) as typeof import('@lumino/signaling');
  const instances: any[] = [];
  class FileWatcher {
    applied = new Signal<any, void>(this);
    blocked = new Signal<any, string>(this);
    unblocked = new Signal<any, void>(this);
    interval = 0;
    enabled = true;
    isDisposed = false;
    constructor() {
      instances.push(this);
    }
    dispose(): void {
      this.isDisposed = true;
    }
  }
  return { FileWatcher, EXTERNAL_ORIGIN: 'test', __instances: instances };
});

import {
  DEFAULT_SETTINGS,
  LiveViewController,
  TAB_ACTIVE_CLASS,
  TAB_BLOCKED_CLASS,
  TAB_UPDATED_CLASS,
  VISIBILITY_ATTRIBUTE
} from '../controller';
import { GHOST_HOLD_MS, TYPING_CLASS } from '../animate';
import { ADDED_CLASS, DECORATION_CLASS, REMOVED_CLASS } from '../highlight';
import { MAX_LCS_TOKENS, tokenize } from '../diff';

const watcherModule = jest.requireMock('../watcher') as { __instances: any[] };

// The test compiler options carry the jest types alone, so the two things the
// stylesheet check needs from the module system are declared where they are
// used.
declare const __dirname: string;
const { readFileSync } = jest.requireActual('fs') as {
  readFileSync(file: string, encoding: string): string;
};

/**
 * A stand-in for the Markdown preview: a node holding the render root, a
 * title, and the rendered signal the controller listens to.
 */
function makeWidget() {
  const node = document.createElement('div');
  const root = document.createElement('div');
  root.className = 'jp-RenderedMarkdown';
  node.appendChild(root);
  document.body.appendChild(node);
  const content = {};
  const widget: any = {
    node,
    title: new Title({ owner: {} }),
    isVisible: true,
    context: { path: 'live.md' },
    content: Object.assign(content, {
      rendered: new Signal<any, void>(content),
      update: () => undefined
    })
  };
  widget.disposed = new Signal<any, void>(widget);
  return { widget, root };
}

const addedText = (root: HTMLElement): string[] =>
  Array.from(root.querySelectorAll(`.${ADDED_CLASS}`)).map(
    element => element.textContent ?? ''
  );

const fadeIn = (root: HTMLElement): string[] =>
  Array.from(root.querySelectorAll<HTMLElement>(`.${ADDED_CLASS}`)).map(
    element => element.style.getPropertyValue('--jp-AdvancedMd-fade-in')
  );

describe('LiveViewController', () => {
  let controller: LiveViewController;
  let root: HTMLElement;
  let widget: any;
  let watcher: any;

  const render = (html: string) => {
    root.innerHTML = html;
    widget.content.rendered.emit(undefined);
  };
  const applied = () => watcher.applied.emit(undefined);

  // These tests read the added text right after the render and describe the
  // instant path; the change animation describe sets its own speed.
  const settings = {
    ...DEFAULT_SETTINGS,
    pollInterval: 1,
    fadeDuration: 4000,
    animation: true,
    animationSpeed: 0
  };

  beforeEach(() => {
    jest.useFakeTimers();
    watcherModule.__instances.length = 0;
    ({ widget, root } = makeWidget());
    controller = new LiveViewController({
      widget,
      contents: {} as any,
      channel: {} as any,
      settings
    });
    watcher = watcherModule.__instances[0];
  });

  afterEach(() => {
    controller.dispose();
    document.body.innerHTML = '';
    jest.useRealTimers();
  });

  it('decorates the difference between two renders after an applied change', () => {
    render('<p>alpha</p>');
    applied();
    render('<p>alpha beta</p>');
    expect(addedText(root)).toEqual([' beta']);
    expect(fadeIn(root)).toEqual(['']);
  });

  it('keeps earlier changes highlighted while writes arrive faster than the fade', () => {
    render('<p>alpha</p>');
    applied();
    render('<p>alpha beta</p>');
    jest.advanceTimersByTime(1000);
    applied();
    render('<p>alpha beta gamma</p>');
    // The part tinted a second ago is re-created without a fade-in; only the
    // part this write added fades in.
    expect(addedText(root)).toEqual([' beta', ' gamma']);
    expect(fadeIn(root)).toEqual(['0ms', '']);
  });

  it('fades in a change to a block nothing tinted before, even during a fade', () => {
    render('<p>alpha</p>\n<p>one</p>');
    applied();
    render('<p>alpha beta</p>\n<p>one</p>');
    jest.advanceTimersByTime(1000);
    applied();
    render('<p>alpha beta</p>\n<p>one two</p>');
    expect(addedText(root)).toEqual([' beta', ' two']);
    expect(fadeIn(root)).toEqual(['0ms', '']);
  });

  it('forgets the fade when a settings change clears the decorations', () => {
    render('<p>alpha</p>');
    applied();
    render('<p>alpha beta</p>');
    jest.advanceTimersByTime(1000);
    controller.updateSettings({ ...settings, highlight: false });
    expect(root.querySelectorAll(`.${DECORATION_CLASS}`).length).toBe(0);
    controller.updateSettings({ ...settings });
    applied();
    render('<p>alpha beta gamma</p>');
    // Diffed against the text on screen when the fade ended, not against the
    // text before the first change, and with a fade-in of its own.
    expect(addedText(root)).toEqual([' gamma']);
    expect(fadeIn(root)).toEqual(['']);
  });

  it('takes the decorations out after the fade and diffs the next change alone', () => {
    render('<p>alpha</p>');
    applied();
    render('<p>alpha beta</p>');
    jest.advanceTimersByTime(1000);
    applied();
    render('<p>alpha beta gamma</p>');
    jest.advanceTimersByTime(4500);
    expect(root.querySelectorAll(`.${DECORATION_CLASS}`).length).toBe(0);
    applied();
    render('<p>alpha beta gamma delta</p>');
    expect(addedText(root)).toEqual([' delta']);
  });

  it('does not decorate a render nothing external caused', () => {
    render('<p>alpha</p>');
    render('<p>alpha beta</p>');
    expect(addedText(root)).toEqual([]);
  });

  describe('tab cue', () => {
    const tabClasses = () =>
      widget.title.className.split(/\s+/).filter(Boolean);
    const attention = () =>
      widget.node.dispatchEvent(new Event('pointerdown', { bubbles: true }));

    it('clears the updated marker when the reader acts on the document', () => {
      applied();
      expect(tabClasses()).toContain(TAB_UPDATED_CLASS);
      attention();
      expect(tabClasses()).not.toContain(TAB_UPDATED_CLASS);
    });

    it('keeps the blocked marker whatever the reader does', () => {
      watcher.blocked.emit('dirty');
      attention();
      widget.node.dispatchEvent(new Event('wheel', { bubbles: true }));
      expect(tabClasses()).toEqual([TAB_BLOCKED_CLASS]);
    });

    it('drops the blocked marker once the change no longer waits', () => {
      watcher.blocked.emit('dirty');
      watcher.unblocked.emit(undefined);
      expect(tabClasses()).toEqual([]);
    });

    it('replaces the blocked marker when the change lands', () => {
      watcher.blocked.emit('dirty');
      applied();
      expect(tabClasses()).toContain(TAB_UPDATED_CLASS);
      expect(tabClasses()).not.toContain(TAB_BLOCKED_CLASS);
    });

    it('settles the animating marker a fixed period after the last change', () => {
      // Changes arrive as events, so how long the icon keeps animating after
      // the last one does not follow the fallback interval.
      controller.updateSettings({ ...settings, pollInterval: 60 });
      applied();
      expect(tabClasses()).toContain(TAB_ACTIVE_CLASS);
      jest.advanceTimersByTime(2999);
      expect(tabClasses()).toContain(TAB_ACTIVE_CLASS);
      jest.advanceTimersByTime(1);
      expect(tabClasses()).not.toContain(TAB_ACTIVE_CLASS);
      expect(tabClasses()).toContain(TAB_UPDATED_CLASS);
    });
  });

  describe('scroll position', () => {
    let scrollTop: number;

    /**
     * jsdom lays nothing out, so the render root is given a scroll position
     * that behaves like a browser's: settable, clamped, and reported back.
     */
    beforeEach(() => {
      scrollTop = 0;
      Object.defineProperty(root, 'scrollTop', {
        configurable: true,
        get: () => scrollTop,
        set: (value: number) => {
          scrollTop = Math.max(0, Math.min(value, 1500));
        }
      });
      Object.defineProperty(root, 'scrollHeight', { value: 2000 });
      Object.defineProperty(root, 'clientHeight', { value: 500 });
    });

    const scrollEvent = () =>
      root.dispatchEvent(new Event('scroll', { bubbles: true }));
    const readerScrollsTo = (value: number) => {
      root.dispatchEvent(new Event('wheel', { bubbles: true }));
      scrollTop = value;
      scrollEvent();
    };

    it('overrides a scroll another extension made on the same render', () => {
      render('<p>alpha</p>');
      readerScrollsTo(800);
      jest.advanceTimersByTime(1000);
      applied();
      render('<p>alpha beta</p>');
      // Another extension scrolls to an anchor shortly after the render.
      jest.advanceTimersByTime(100);
      scrollTop = 0;
      scrollEvent();
      jest.advanceTimersByTime(100);
      expect(scrollTop).toBe(800);
      // The restore's own scroll event is not taken for the reader's.
      scrollEvent();
      jest.advanceTimersByTime(1000);
      expect(scrollTop).toBe(800);
    });

    it('keeps a reader who scrolled back to the top at the top', () => {
      render('<p>alpha</p>');
      readerScrollsTo(800);
      readerScrollsTo(0);
      jest.advanceTimersByTime(1000);
      applied();
      render('<p>alpha beta</p>');
      jest.advanceTimersByTime(100);
      scrollTop = 600;
      scrollEvent();
      jest.advanceTimersByTime(100);
      expect(scrollTop).toBe(0);
      scrollEvent();
      jest.advanceTimersByTime(1000);
      applied();
      render('<p>alpha beta gamma</p>');
      jest.advanceTimersByTime(300);
      expect(scrollTop).toBe(0);
    });

    it('stands down when the reader scrolls during the restore', () => {
      render('<p>alpha</p>');
      readerScrollsTo(800);
      jest.advanceTimersByTime(1000);
      applied();
      render('<p>alpha beta</p>');
      jest.advanceTimersByTime(50);
      readerScrollsTo(300);
      jest.advanceTimersByTime(200);
      expect(scrollTop).toBe(300);
    });
  });

  describe('change animation', () => {
    const SPEED = 100;
    const SENTENCE =
      'The quick brown fox jumps over the lazy dog by the old river';

    /**
     * Replace the outer controller with one that animates at a speed.
     */
    const setup = (overrides: Partial<typeof settings> = {}) => {
      controller.dispose();
      document.body.innerHTML = '';
      watcherModule.__instances.length = 0;
      ({ widget, root } = makeWidget());
      controller = new LiveViewController({
        widget,
        contents: {} as any,
        channel: {} as any,
        settings: { ...settings, animationSpeed: SPEED, ...overrides }
      });
      watcher = watcherModule.__instances[0];
      return { controller, root, watcher };
    };

    /**
     * Read a value, advance the clock, and repeat; the first sample is taken
     * before any time passes.
     */
    const sample = <T>(fn: () => T, everyMs: number, count: number): T[] => {
      const samples: T[] = [];
      for (let i = 0; i < count; i++) {
        samples.push(fn());
        jest.advanceTimersByTime(everyMs);
      }
      return samples;
    };
    const typingCount = (host: HTMLElement) =>
      host.querySelectorAll(`.${TYPING_CLASS}`).length;
    const ghostText = (host: HTMLElement) =>
      host.querySelector(`.${REMOVED_CLASS}`)?.textContent ?? null;
    const ghosts = () =>
      Array.from(root.querySelectorAll(`.${REMOVED_CLASS}`)).map(
        element => element.textContent
      );
    const decorationCount = (host: HTMLElement) =>
      host.querySelectorAll(`.${DECORATION_CLASS}`).length;

    beforeEach(() => {
      setup();
    });

    it('types added text in letter by letter', () => {
      expect(SENTENCE.length).toBe(60);
      render('<p>alpha</p>');
      applied();
      render(`<p>alpha</p>\n<p>${SENTENCE}</p>`);
      const samples = sample(() => addedText(root)[0].length, 20, 40);
      expect(samples[0]).toBe(0);
      for (let i = 1; i < samples.length; i++) {
        expect(samples[i]).toBeGreaterThanOrEqual(samples[i - 1]);
      }
      expect(new Set(samples).size).toBeGreaterThan(2);
      expect(samples[samples.length - 1]).toBe(60);
      expect(typingCount(root)).toBe(0);
      expect(root.textContent?.endsWith(SENTENCE)).toBe(true);
    });

    it('keeps the green background while typing', () => {
      render('<p>alpha</p>');
      applied();
      render(`<p>alpha</p>\n<p>${SENTENCE}</p>`);
      jest.advanceTimersByTime(100);
      const span = root.querySelector(`.${ADDED_CLASS}`) as HTMLElement;
      expect(span.classList.contains(TYPING_CLASS)).toBe(true);
      const shown = span.textContent ?? '';
      expect(shown.length).toBeGreaterThan(0);
      expect(shown.length).toBeLessThan(SENTENCE.length);
      expect(SENTENCE.startsWith(shown)).toBe(true);
      jest.advanceTimersByTime(1000);
      expect(span.textContent).toBe(SENTENCE);
      expect(span.classList.contains(TYPING_CLASS)).toBe(false);
    });

    it('holds removed text, deletes it from the end, then takes it out', () => {
      render('<p>alpha beta gamma</p>');
      applied();
      render('<p>alpha gamma</p>');
      expect(ghostText(root)).toBe('beta ');
      const every = 20;
      const samples = sample(
        () => ghostText(root),
        every,
        Math.ceil((GHOST_HOLD_MS + 50 + 32) / every) + 1
      );
      let previous = 'beta ';
      samples.forEach((text, i) => {
        if (i * every < GHOST_HOLD_MS) {
          expect(text).toBe('beta ');
          return;
        }
        if (text === null) {
          return;
        }
        expect('beta '.startsWith(text)).toBe(true);
        expect(text.length).toBeLessThanOrEqual(previous.length);
        previous = text;
      });
      expect(samples[samples.length - 1]).toBeNull();
      expect(root.textContent).toBe('alpha gamma');
      // The fade timer still holds the baseline: the next change is diffed
      // together with this one.
      applied();
      render('<p>alpha gamma delta</p>');
      jest.advanceTimersByTime(100);
      expect(addedText(root)).toEqual([' delta']);
    });

    it('shows no ghost and lands the replacement at once past the diff token bound', () => {
      render(`<p>${'old '.repeat(MAX_LCS_TOKENS / 2 + 1)}</p>`);
      applied();
      render('<p>replacement text</p>');
      // Past the bound on the removed side the diff reports one replacement
      // whose added side may hold unchanged text, so it is tinted, not typed.
      expect(root.querySelectorAll(`.${REMOVED_CLASS}`).length).toBe(0);
      const span = root.querySelector(`.${ADDED_CLASS}`) as HTMLElement;
      expect(span.classList.contains(TYPING_CLASS)).toBe(false);
      expect(span.textContent).toBe('replacement text');
    });

    it('types distant changes at the same time', () => {
      const a = 'a'.repeat(30);
      const b = 'b'.repeat(30);
      render('<p>one</p>\n<p>two</p>');
      applied();
      render(`<p>one ${a}</p>\n<p>two ${b}</p>`);
      const samples = sample(
        () => addedText(root).map(text => text.length),
        20,
        20
      );
      for (const [first, second] of samples) {
        expect(first).toBe(second);
      }
      expect(samples[samples.length - 1]).toEqual([31, 31]);
      expect(decorationCount(root)).toBe(2);
      expect(jest.getTimerCount()).toBeGreaterThan(0);
    });

    it('shows the whole change at once when the speed is 0', () => {
      setup({ animationSpeed: 0 });
      render('<p>alpha</p>');
      applied();
      render(`<p>alpha</p>\n<p>${SENTENCE}</p>`);
      expect(addedText(root)).toEqual([SENTENCE]);
      expect(typingCount(root)).toBe(0);
      jest.advanceTimersByTime(4500);
      expect(decorationCount(root)).toBe(0);
    });

    it('types faster at a higher speed', () => {
      const addition = 'x'.repeat(40);
      const run = (speed: number) => {
        setup({ animationSpeed: speed });
        render('<p>alpha</p>');
        applied();
        render(`<p>alpha</p>\n<p>${addition}</p>`);
        jest.advanceTimersByTime(200);
        const at200 = addedText(root)[0].length;
        jest.advanceTimersByTime(16);
        const at216 = addedText(root)[0].length;
        jest.advanceTimersByTime(184);
        const at400 = addedText(root)[0].length;
        return { at200, at216, at400 };
      };
      const slow = run(50);
      const fast = run(200);
      expect(fast.at200).toBeGreaterThan(slow.at200);
      expect(fast.at216).toBe(40);
      expect(slow.at400).toBeLessThan(40);
    });

    it('a speed of 0 mid-typing completes every run on the next frame', () => {
      const addition = 'x'.repeat(40);
      render('<p>alpha</p>');
      applied();
      render(`<p>alpha</p>\n<p>${addition}</p>`);
      jest.advanceTimersByTime(20);
      expect(addedText(root)[0].length).toBeLessThan(40);
      controller.updateSettings({
        ...settings,
        animationSpeed: 0
      });
      jest.advanceTimersByTime(16);
      expect(addedText(root)).toEqual([addition]);
      expect(typingCount(root)).toBe(0);
      // The fade was re-armed when the speed changed, 20 ms in, for the fade
      // duration plus the fade-in.
      jest.advanceTimersByTime(4500 - 16 - 1);
      expect(decorationCount(root)).toBe(1);
      jest.advanceTimersByTime(1);
      expect(decorationCount(root)).toBe(0);
    });

    it('lands the change at once when the animation is turned off', () => {
      setup({ animation: false });
      render('<p>alpha</p>');
      applied();
      render(`<p>alpha</p>\n<p>${'x'.repeat(40)}</p>`);
      expect(addedText(root)).toEqual(['x'.repeat(40)]);
      expect(typingCount(root)).toBe(0);
    });

    it('turning the animation off mid-typing completes every run on the next frame', () => {
      const addition = 'x'.repeat(40);
      render('<p>alpha</p>');
      applied();
      render(`<p>alpha</p>\n<p>${addition}</p>`);
      jest.advanceTimersByTime(20);
      expect(addedText(root)[0].length).toBeLessThan(40);
      controller.updateSettings({
        ...settings,
        animationSpeed: SPEED,
        animation: false
      });
      jest.advanceTimersByTime(16);
      expect(addedText(root)).toEqual([addition]);
      expect(typingCount(root)).toBe(0);
    });

    it('holds the baseline until typing and fade are over', () => {
      setup({ fadeDuration: 1000 });
      const addition = ` ${'x'.repeat(299)}`;
      render('<p>alpha</p>');
      applied();
      render(`<p>alpha${addition}</p>`);
      jest.advanceTimersByTime(1300);
      expect(decorationCount(root)).toBe(1);
      const shown = addedText(root)[0];
      expect(shown.length).toBeLessThan(300);
      expect(addition.startsWith(shown)).toBe(true);
      jest.advanceTimersByTime(3200 + 16);
      expect(decorationCount(root)).toBe(0);
      expect(root.textContent).toBe(`alpha${addition}`);
      applied();
      render(`<p>alpha${addition} delta</p>`);
      jest.advanceTimersByTime(100);
      expect(addedText(root)).toEqual([' delta']);
    });

    it('restores the full text when highlighting turns off mid-typing', () => {
      render('<p>alpha</p>');
      applied();
      render(`<p>alpha</p>\n<p>${SENTENCE}</p>`);
      jest.advanceTimersByTime(20);
      controller.updateSettings({
        ...settings,
        animationSpeed: SPEED,
        highlight: false
      });
      expect(decorationCount(root)).toBe(0);
      expect(root.textContent).toBe(`alpha\n${SENTENCE}`);
      controller.updateSettings({ ...settings, animationSpeed: SPEED });
      applied();
      render(`<p>alpha</p>\n<p>${SENTENCE} More</p>`);
      jest.advanceTimersByTime(100);
      expect(addedText(root)).toEqual([' More']);
    });

    /**
     * DEF-CUE-68. The operating system's reduced-motion preference is not this
     * extension's switch. A Windows host reports it to every page whenever its
     * own animation switch is off, which readers turn off for performance, and
     * that is not a request for the preview to stop showing how a change
     * arrived. The switches are the extension's own: the animation setting and
     * a speed of 0.
     */
    describe('with the operating system asking for reduced motion', () => {
      const original = window.matchMedia;
      let asked: string[];

      beforeEach(() => {
        asked = [];
        (window as any).matchMedia = jest.fn((query: string) => {
          asked.push(query);
          return {
            matches: true,
            addEventListener: jest.fn(),
            removeEventListener: jest.fn()
          };
        });
        setup();
      });

      afterEach(() => {
        (window as any).matchMedia = original;
      });

      it('types the change in all the same', () => {
        render('<p>alpha</p>');
        applied();
        render(`<p>alpha</p>\n<p>${SENTENCE}</p>`);
        const samples = sample(() => addedText(root)[0].length, 20, 40);
        expect(samples[0]).toBe(0);
        expect(new Set(samples).size).toBeGreaterThan(2);
        expect(samples[samples.length - 1]).toBe(SENTENCE.length);
        expect(typingCount(root)).toBe(0);
      });

      it('never asks the browser what the operating system prefers', () => {
        render('<p>alpha</p>');
        applied();
        render(`<p>alpha</p>\n<p>${SENTENCE}</p>`);
        jest.advanceTimersByTime(1000);
        expect(asked).toEqual([]);
      });
    });

    it('continues typing where the previous render stopped', () => {
      render('<p>alpha</p>');
      applied();
      render('<p>alpha beta gamma</p>');
      jest.advanceTimersByTime(50);
      const shown = addedText(root)[0].length;
      expect(shown).toBeGreaterThan(0);
      expect(shown).toBeLessThan(11);
      applied();
      render('<p>alpha beta gamma delta</p>');
      expect(addedText(root).map(text => text.length)).toEqual([shown, 0]);
      expect(fadeIn(root)).toEqual(['0ms', '']);
      const samples = sample(() => addedText(root)[0].length, 20, 10);
      for (let i = 1; i < samples.length; i++) {
        expect(samples[i]).toBeGreaterThanOrEqual(samples[i - 1]);
      }
      expect(addedText(root)[0]).toBe(' beta gamma');
      expect(addedText(root)[1].length).toBeGreaterThan(0);
    });

    it('continues typing when the next write edits inside the run still typing', () => {
      render('<p>alpha</p>');
      applied();
      render(`<p>alpha</p>\n<p>${SENTENCE}</p>`);
      jest.advanceTimersByTime(200);
      const shown = addedText(root)[0].length;
      expect(shown).toBeGreaterThan(0);
      expect(shown).toBeLessThan(35);
      applied();
      render(`<p>alpha</p>\n<p>${SENTENCE.replace('lazy', 'sleepy')}</p>`);
      // The run is cut at the edited word: the part before it keeps its
      // progress, the word and the part after it type from their start.
      expect(addedText(root).map(text => text.length)).toEqual([shown, 0, 0]);
      expect(typingCount(root)).toBe(3);
      const samples = sample(
        () => addedText(root).map(text => text.length),
        20,
        25
      );
      for (let i = 1; i < samples.length; i++) {
        for (let j = 0; j < 3; j++) {
          expect(samples[i][j]).toBeGreaterThanOrEqual(samples[i - 1][j]);
        }
      }
      expect(addedText(root)).toEqual([
        'The quick brown fox jumps over the ',
        'sleepy',
        ' dog by the old river'
      ]);
      expect(typingCount(root)).toBe(0);
    });

    it('a second removal beside a ghost being deleted continues the deletion', () => {
      render('<p>alpha beta gamma delta</p>');
      applied();
      render('<p>alpha gamma delta</p>');
      jest.advanceTimersByTime(GHOST_HOLD_MS + 32);
      const [partial] = ghosts() as string[];
      expect(partial.length).toBeGreaterThan(0);
      expect(partial.length).toBeLessThan('beta '.length);
      applied();
      render('<p>alpha delta</p>');
      // The ghost already being deleted keeps its length; only the text this
      // write removed stands whole and warns.
      expect(ghosts()).toEqual([partial, 'gamma ']);
      jest.advanceTimersByTime(100);
      expect(ghosts()).toEqual(['gamma ']);
      jest.advanceTimersByTime(GHOST_HOLD_MS);
      expect(ghosts()).toEqual([]);
      expect(root.textContent).toBe('alpha delta');
    });

    it('a speed of 0 during the warning hold leaves the ghost to the fade', () => {
      render('<p>alpha beta gamma</p>');
      applied();
      render('<p>alpha gamma</p>');
      jest.advanceTimersByTime(100);
      controller.updateSettings({ ...settings, animationSpeed: 0 });
      jest.advanceTimersByTime(16);
      const ghost = root.querySelector(`.${REMOVED_CLASS}`) as HTMLElement;
      expect(ghost.textContent).toBe('beta ');
      expect(ghost.classList.contains(TYPING_CLASS)).toBe(false);
      // The fade was re-armed when the speed changed, 100 ms in.
      jest.advanceTimersByTime(4500 - 16 - 1);
      expect(ghostText(root)).toBe('beta ');
      jest.advanceTimersByTime(1);
      expect(decorationCount(root)).toBe(0);
    });

    it('deletes a paragraph removed before a heading from the block before it', () => {
      render('<p>Alpha.</p>\n<p>Beta gone.</p>\n<h2 id="c">Gamma</h2>');
      applied();
      render('<p>Alpha.</p>\n<h2 id="c">Gamma</h2>');
      const heading = root.querySelector('h2') as HTMLElement;
      const ghost = root.querySelector(`.${REMOVED_CLASS}`) as HTMLElement;
      expect(ghost.textContent).toBe('Beta gone.\n');
      expect(ghost.parentElement).toBe(root.querySelector('p'));
      expect(ghost.classList.contains(TYPING_CLASS)).toBe(true);
      expect(heading.textContent).toBe('Gamma');
      expect(heading.id).toBe('c');
      jest.advanceTimersByTime(GHOST_HOLD_MS + 50);
      expect((ghostText(root) ?? '').length).toBeLessThan(
        'Beta gone.\n'.length
      );
      jest.advanceTimersByTime(200);
      expect(ghostText(root)).toBeNull();
      expect(root.textContent).toBe('Alpha.\nGamma');
    });

    it('a ghost re-created by the next render does not warn twice', () => {
      render('<p>alpha beta gamma</p>');
      applied();
      render('<p>alpha gamma</p>');
      jest.advanceTimersByTime(400);
      expect(ghostText(root)).toBe('beta ');
      applied();
      render('<p>alpha gamma delta</p>');
      expect(ghostText(root)).toBe('beta ');
      expect(addedText(root)).toEqual(['']);
      jest.advanceTimersByTime(400);
      const ghost = ghostText(root);
      expect(ghost === null || ghost.length < 'beta '.length).toBe(true);
      expect(addedText(root)[0].length).toBeGreaterThan(0);
    });

    it('never animates a heading', () => {
      render('<h1 id="report">Report</h1>\n<p>x</p>');
      applied();
      render('<h1 id="report">Report two</h1>\n<p>x y</p>');
      const heading = root.querySelector('h1') as HTMLElement;
      expect(heading.textContent).toBe('Report two');
      expect(heading.id).toBe('report');
      const [inHeading, inParagraph] = Array.from(
        root.querySelectorAll<HTMLElement>(`.${ADDED_CLASS}`)
      );
      expect(inHeading.closest('h1')).toBe(heading);
      expect(inHeading.classList.contains(TYPING_CLASS)).toBe(false);
      expect(inHeading.textContent).toBe(' two');
      expect(inParagraph.classList.contains(TYPING_CLASS)).toBe(true);
      expect(inParagraph.textContent).toBe('');
    });

    it('continues every run when a later write merges them into one slice', () => {
      const a = ` ${'a'.repeat(40)}`;
      const b = ` ${'b'.repeat(40)}`;
      const c = ` ${'c'.repeat(40)}`;
      render('<p>alpha</p>');
      applied();
      render(`<p>alpha${a}</p>`);
      jest.advanceTimersByTime(100);
      applied();
      render(`<p>alpha${a}${b}</p>`);
      jest.advanceTimersByTime(100);
      const shown = addedText(root).map(text => text.length);
      // The second run starts where the first ends, so it waits for it.
      expect(shown[0]).toBeGreaterThan(0);
      expect(shown[0]).toBeLessThan(a.length);
      expect(shown[1]).toBe(0);
      applied();
      render(`<p>alpha${a}${b}${c}</p>`);
      // The diff of this write against the held baseline hands the first two
      // runs over as one slice; it is cut where they met and each part goes on.
      expect(addedText(root).map(text => text.length)).toEqual([...shown, 0]);
      expect(typingCount(root)).toBe(3);
    });

    it('continues typing when the renderer merges the text nodes of a run', () => {
      render('<p>alpha</p>');
      applied();
      render(
        '<p>alpha</p>\n<p>The quick <strong>brown</strong> fox jumps over the lazy dog</p>'
      );
      jest.advanceTimersByTime(100);
      const shown = addedText(root).map(text => text.length);
      // The three text nodes of one added range type in document order.
      expect(shown[0]).toBeGreaterThan(0);
      expect(shown[0]).toBeLessThan(10);
      expect(shown[1]).toBe(0);
      expect(shown[2]).toBe(0);
      applied();
      // Without the bold the renderer gives one text node for the three runs;
      // nothing typed is retyped and nothing untyped lands at once.
      render(
        '<p>alpha</p>\n<p>The quick brown fox jumps over the lazy dog</p>'
      );
      expect(addedText(root).map(text => text.length)).toEqual(shown);
      expect(typingCount(root)).toBe(3);
    });

    it('keeps a complete span whose word also occurs in a run cut by the next write', () => {
      render('<p>alpha</p>\n<p>beta</p>');
      applied();
      render(`<p>alpha ${SENTENCE}</p>\n<p>beta dog</p>`);
      jest.advanceTimersByTime(200);
      expect(addedText(root)[1]).toBe(' dog');
      applied();
      render(
        `<p>alpha ${SENTENCE.replace('lazy', 'sleepy')}</p>\n<p>beta dog</p>`
      );
      expect(addedText(root)[3]).toBe(' dog');
      expect(typingCount(root)).toBe(3);
    });

    it('keeps ghosts already deleted out of a removal the next write merges them into', () => {
      render('<p>alpha beta gamma delta epsilon</p>');
      applied();
      render('<p>alpha gamma epsilon</p>');
      expect(ghosts()).toEqual(['beta ', ' delta']);
      jest.advanceTimersByTime(GHOST_HOLD_MS + 200);
      expect(ghosts()).toEqual([]);
      applied();
      render('<p>alpha epsilon</p>');
      // The diff hands all three removals over as one; only the text this
      // write removed stands and warns.
      expect(ghosts()).toEqual(['gamma ']);
      jest.advanceTimersByTime(GHOST_HOLD_MS - 50);
      expect(ghosts()).toEqual(['gamma ']);
    });

    it('keeps a ghost gone and one half deleted when a third removal joins them', () => {
      render('<p>alpha beta gamma delta epsilon</p>');
      applied();
      render('<p>alpha gamma delta epsilon</p>');
      jest.advanceTimersByTime(GHOST_HOLD_MS + 32);
      applied();
      render('<p>alpha delta epsilon</p>');
      jest.advanceTimersByTime(GHOST_HOLD_MS + 32);
      const [partial] = ghosts() as string[];
      expect(ghosts()).toEqual([partial]);
      expect('gamma '.startsWith(partial)).toBe(true);
      expect(partial.length).toBeLessThan('gamma '.length);
      applied();
      render('<p>alpha epsilon</p>');
      expect(ghosts()).toEqual([partial, 'delta ']);
    });

    it('lands a change past the diff token bound at once', () => {
      const middle = Array.from(
        { length: 20 },
        (_, i) =>
          `<p>${Array.from({ length: 30 }, (__, j) => `word${i}x${j}`).join(' ')}</p>`
      ).join('\n');
      render(`<p>first</p>\n${middle}\n<p>last</p>`);
      const paragraph = root.querySelectorAll('p')[5].textContent;
      applied();
      render(`<p>first plus</p>\n${middle}\n<p>last also</p>`);
      // Two small changes 600 words apart go through the coarse diff branch,
      // which reports the unchanged text between them as added; that text is
      // tinted, not taken away and typed back.
      expect(root.querySelectorAll('p')[5].textContent).toBe(paragraph);
      expect(addedText(root).length).toBeGreaterThan(2);
      expect(typingCount(root)).toBe(0);
    });

    it('keeps typing when the operating system turns reduced motion on', () => {
      const original = window.matchMedia;
      const listeners: Array<() => void> = [];
      let reduce = false;
      (window as any).matchMedia = jest.fn(() => ({
        matches: reduce,
        addEventListener: (_: string, listener: () => void) => {
          listeners.push(listener);
        },
        removeEventListener: jest.fn()
      }));
      try {
        setup();
        render('<p>alpha</p>');
        applied();
        render(`<p>alpha</p>\n<p>${SENTENCE}</p>`);
        jest.advanceTimersByTime(100);
        const shown = addedText(root)[0].length;
        expect(shown).toBeLessThan(SENTENCE.length);
        // The preference turns on while the text is being typed. Nothing here
        // listens for it (DEF-CUE-68), so any listener that was registered is
        // fired, to show that the change reaches nothing.
        reduce = true;
        for (const listener of listeners) {
          listener();
        }
        jest.advanceTimersByTime(100);
        const later = addedText(root)[0].length;
        expect(later).toBeGreaterThan(shown);
        expect(later).toBeLessThan(SENTENCE.length);
        expect(typingCount(root)).toBeGreaterThan(0);
      } finally {
        (window as any).matchMedia = original;
      }
    });

    it('shows a heading renamed by a write complete on the first frame', () => {
      const heading = (text: string) =>
        `<h2 id="Report">${text}<a class="jp-InternalAnchorLink">¶</a></h2>`;
      render(`${heading('Report')}\n<p>Body text here.</p>`);
      applied();
      render(`${heading('Summary')}\n<p>Body text here.</p>`);
      const h2 = root.querySelector('h2') as HTMLElement;
      expect(h2.textContent).toBe('Summary¶');
      expect(h2.id).toBe('Report');
      // The struck old text is shown in the paragraph below, where it is
      // deleted like any other ghost.
      const ghost = root.querySelector(`.${REMOVED_CLASS}`) as HTMLElement;
      expect(ghost.textContent).toBe('Report¶');
      expect(ghost.parentElement).toBe(root.querySelector('p'));
      jest.advanceTimersByTime(GHOST_HOLD_MS + 200);
      expect(ghostText(root)).toBeNull();
      expect(h2.textContent).toBe('Summary¶');
    });

    it('lands a rewrite past the diff token bound on the removed side at once', () => {
      const paragraph = (i: number, words: number) =>
        `<p>${Array.from({ length: words }, (_, j) => `w${i}x${j}`).join(' ')}</p>`;
      const body = Array.from({ length: 13 }, (_, i) => paragraph(i, 40));
      expect(tokenize(body.join(' ')).length).toBeGreaterThan(MAX_LCS_TOKENS);
      render(body.join('\n'));
      const second = root.querySelectorAll('p')[1].textContent;
      applied();
      // Dropping the first paragraph and editing the last word puts only the
      // removed side past the bound; the unchanged body is tinted, not taken
      // away and typed back.
      const after = body.slice(1);
      after[after.length - 1] = after[after.length - 1].replace(
        'w12x39</p>',
        'changed</p>'
      );
      render(after.join('\n'));
      expect(root.querySelectorAll('p')[0].textContent).toBe(second);
      expect(typingCount(root)).toBe(0);
      expect(addedText(root).length).toBeGreaterThan(0);
    });

    it('lands two distant removals whose removed middle passes the bound at once', () => {
      const paragraph = (i: number, words: number) =>
        `<p>${Array.from({ length: words }, (_, j) => `w${i}x${j}`).join(' ')}</p>`;
      const middle = Array.from({ length: 15 }, (_, i) => paragraph(i, 30));
      render([paragraph(100, 60), ...middle, paragraph(101, 60)].join('\n'));
      const fifth = root.querySelectorAll('p')[5].textContent;
      applied();
      render(middle.join('\n'));
      expect(root.querySelectorAll('p')[4].textContent).toBe(fifth);
      expect(typingCount(root)).toBe(0);
    });

    it('types a small write made while an earlier coarse write still stands', () => {
      const paragraph = (i: number) =>
        `<p>${Array.from({ length: 50 }, (_, j) => `w${i}x${j}`).join(' ')}</p>`;
      const body = Array.from({ length: 25 }, (_, i) => paragraph(i));
      render(body.join('\n'));
      applied();
      const edited = [...body];
      edited[0] = edited[0].replace('w0x0 ', 'w0x0 plus ');
      edited[24] = edited[24].replace('w24x49</p>', 'w24x49 also</p>');
      render(edited.join('\n'));
      expect(typingCount(root)).toBe(0);
      jest.advanceTimersByTime(1000);
      applied();
      render(`${edited.join('\n')}\n<p>${SENTENCE}</p>`);
      // The diff against the held baseline is still coarse; the diff this
      // render made is one small addition, and that one is typed.
      const spans = addedText(root);
      expect(spans[spans.length - 1]).toBe('');
      expect(typingCount(root)).toBe(1);
      jest.advanceTimersByTime(SENTENCE.length * 10 + 32);
      expect(addedText(root)[spans.length - 1]).toBe(SENTENCE);
    });

    it('holds a removal made during a pending fade when the diff moves its whitespace', () => {
      render('<p>The quick brown fox jumps over the lazy dog</p>');
      applied();
      render('<p>The quick brown high fox jumps over the lazy dog</p>');
      jest.advanceTimersByTime(1000);
      applied();
      render('<p>The quick brown high fox jumps over the dog</p>');
      // The ghost is the removal this write made, whichever side of the word
      // the diff against the held baseline hands the whitespace to.
      const samples = sample(() => ghosts(), 50, 14);
      for (const held of samples) {
        expect(held).toEqual(['lazy ']);
      }
      jest.advanceTimersByTime(GHOST_HOLD_MS - 700 + 50 + 32);
      expect(ghosts()).toEqual([]);
      expect(root.textContent).toBe(
        'The quick brown high fox jumps over the dog'
      );
    });

    it('holds a word removed right after a run still typing', () => {
      const inserted = `${Array.from({ length: 20 }, () => 'very').join(' ')} `;
      render('<p>The cat sat.</p>');
      applied();
      render(`<p>The ${inserted}cat sat.</p>`);
      jest.advanceTimersByTime(300);
      const typed = addedText(root)[0].length;
      expect(typed).toBeGreaterThan(0);
      applied();
      render(`<p>The ${inserted}sat.</p>`);
      // The ghost stands where the word was, after the run, not where the
      // diff against the held baseline puts the removal.
      const samples = sample(() => ghosts(), 50, 14);
      for (const held of samples) {
        expect(held).toEqual(['cat ']);
      }
      const ghost = root.querySelector(`.${REMOVED_CLASS}`) as HTMLElement;
      const run = root.querySelector(`.${ADDED_CLASS}`) as HTMLElement;
      expect(
        run.compareDocumentPosition(ghost) & Node.DOCUMENT_POSITION_FOLLOWING
      ).toBeTruthy();
      expect(addedText(root)[0].length).toBeGreaterThan(typed);
    });

    it('keeps a run complete when the same text is removed from another place', () => {
      const text = Array.from({ length: 20 }, () => 'more').join(' ');
      render('<p>one</p>\n<p>two</p>');
      applied();
      render(`<p>one</p>\n<p>two ${text}</p>`);
      jest.advanceTimersByTime(300);
      applied();
      render(`<p>one ${text}</p>\n<p>two ${text}</p>`);
      jest.advanceTimersByTime(text.length * 10 + 32);
      expect(addedText(root)[1]).toBe(` ${text}`);
      applied();
      render(`<p>one</p>\n<p>two ${text}</p>`);
      // The run in the second paragraph continues its own progress, not that
      // of the run the write removed from the first paragraph; the removed
      // text, complete on screen, leaves through a ghost that warns.
      expect(addedText(root)).toEqual([` ${text}`]);
      expect(
        root.querySelectorAll(`.${ADDED_CLASS}.${TYPING_CLASS}`).length
      ).toBe(0);
      expect(ghosts()).toEqual([` ${text}`]);
      expect(root.querySelector(`.${REMOVED_CLASS}`)?.parentElement).toBe(
        root.querySelector('p')
      );
    });

    it('keeps a departed ghost gone when the same text is restored elsewhere', () => {
      const text = ' gone gone gone gone gone gone';
      render(`<p>one${text}</p>\n<p>two${text}</p>`);
      applied();
      render(`<p>one${text}</p>\n<p>two</p>`);
      jest.advanceTimersByTime(GHOST_HOLD_MS + text.length * 10 + 32);
      expect(ghosts()).toEqual([]);
      applied();
      render('<p>one</p>\n<p>two</p>');
      expect(ghosts()).toEqual([text]);
      jest.advanceTimersByTime(300);
      applied();
      render(`<p>one${text}</p>\n<p>two</p>`);
      // The second paragraph's ghost was deleted already and does not come
      // back; the first paragraph's, still in its warning pause, stands on
      // beside the text this write put back, then leaves.
      expect(ghosts()).toEqual([text]);
      jest.advanceTimersByTime(GHOST_HOLD_MS - 300 - 50);
      expect(ghosts()).toEqual([text]);
      jest.advanceTimersByTime(50 + text.length * 10 + 32);
      expect(ghosts()).toEqual([]);
    });

    it('never brings back a ghost already deleted when the next write inserts where it stood', () => {
      render('<p>w0 w1 w2 w3 w4</p>');
      applied();
      render('<p>w2 w3 w4</p>');
      expect(ghosts()).toEqual(['w0 w1 ']);
      jest.advanceTimersByTime(1200);
      expect(ghosts()).toEqual([]);
      applied();
      render('<p>w5 w2 w3 w4</p>');
      // The diff against the held baseline still reports the first removal;
      // the ghost that left is not re-created for it.
      for (const held of sample(() => ghosts(), 16, 6)) {
        expect(held).toEqual([]);
      }
      expect(root.textContent).toBe('w5 w2 w3 w4');
    });

    it('keeps the rest of the warning pause when the next write inserts where a ghost stands', () => {
      render('<p>w0 w1 w2 w3 w4</p>');
      applied();
      render('<p>w2 w3 w4</p>');
      jest.advanceTimersByTime(300);
      applied();
      render('<p>w5 w2 w3 w4</p>');
      // The ghost stands whole for the 450 ms left of its pause.
      for (const held of sample(() => ghosts(), 50, 9)) {
        expect(held).toEqual(['w0 w1 ']);
      }
      jest.advanceTimersByTime(50 + 'w0 w1 '.length * 10 + 32);
      expect(ghosts()).toEqual([]);
    });

    it('holds a removal the second write made across an earlier addition', () => {
      render('<p>alpha beta gamma delta epsilon zeta eta</p>');
      applied();
      render('<p>alpha beta gamma theta delta eta</p>');
      jest.advanceTimersByTime(1200);
      expect(ghosts()).toEqual([]);
      applied();
      render('<p>iota theta delta eta</p>');
      // Against the held baseline the removal arrives in two fragments around
      // the first write's addition; the ghost is what this write removed.
      for (const held of sample(() => ghosts(), 50, 15)) {
        expect(held).toEqual(['alpha beta gamma']);
      }
      jest.advanceTimersByTime('alpha beta gamma'.length * 10 + 32);
      expect(ghosts()).toEqual([]);
      expect(root.textContent).toBe('iota theta delta eta');
    });

    it('shows every removal against the held baseline as one ghost at speed 0', () => {
      setup({ animationSpeed: 0 });
      render('<p>alpha beta gamma delta epsilon</p>');
      applied();
      render('<p>alpha gamma epsilon</p>');
      jest.advanceTimersByTime(1000);
      applied();
      render('<p>alpha epsilon</p>');
      // Without animation the merged removal is one ghost, held because an
      // earlier render of the same fade already showed a ghost at its offset.
      const spans = Array.from(
        root.querySelectorAll<HTMLElement>(`.${REMOVED_CLASS}`)
      );
      expect(spans.map(span => span.textContent)).toEqual([
        'beta gamma delta '
      ]);
      expect(
        spans.map(span =>
          span.style.getPropertyValue('--jp-AdvancedMd-fade-in')
        )
      ).toEqual(['0ms']);
      expect(typingCount(root)).toBe(0);
    });

    it('strikes out only the part of a removed run the reader had seen', () => {
      render('<p>alpha</p>');
      applied();
      render('<p>alpha</p>\n<p>The quick brown fox jumps</p>');
      jest.advanceTimersByTime(100);
      const shown = addedText(root)[0].length;
      expect(shown).toBeGreaterThan('The '.length);
      expect(shown).toBeLessThan('The quick brown'.length);
      applied();
      // 'quick brown ' straddles the typed edge; ' jumps' was never shown.
      render('<p>alpha</p>\n<p>The fox</p>');
      expect(ghosts()).toEqual([
        'quick brown '.slice(0, shown - 'The '.length)
      ]);
      jest.advanceTimersByTime(GHOST_HOLD_MS + shown * 10 + 32);
      expect(ghosts()).toEqual([]);
      expect(root.textContent).toBe('alpha\nThe fox');
    });

    it('carries the typing across a render nothing external caused', () => {
      render('<p>alpha</p>');
      applied();
      const html = `<p>alpha</p>\n<p>${SENTENCE}</p>`;
      render(html);
      jest.advanceTimersByTime(20);
      const shown = addedText(root)[0].length;
      // The viewer's own render after the change, or another extension's,
      // replaced the DOM with the same text: the decorations are made again
      // and the run goes on from where it was, nothing lands at once.
      render(html);
      jest.advanceTimersByTime(200);
      expect(decorationCount(root)).toBeGreaterThan(0);
      const later = addedText(root)[0].length;
      expect(later).toBeGreaterThan(shown);
      expect(later).toBeLessThan(SENTENCE.length);
      // The fade timer this change started still fires on time, once, and
      // takes the decorations out.
      const timers = jest.getTimerCount();
      jest.advanceTimersByTime(600 + 4500);
      expect(root.textContent).toBe(`alpha\n${SENTENCE}`);
      expect(decorationCount(root)).toBe(0);
      expect(jest.getTimerCount()).toBeLessThan(timers);
    });

    it('forgets a ghost when a write puts the removed text back exactly', () => {
      render('<p>alpha beta gamma</p>');
      applied();
      render('<p>alpha gamma</p>');
      expect(ghosts()).toEqual(['beta ']);
      jest.advanceTimersByTime(300);
      applied();
      render('<p>alpha beta gamma</p>');
      jest.advanceTimersByTime(300);
      applied();
      render('<p>alpha beta gamma delta</p>');
      // The revert made no decoration, so the ghost it threw away is not
      // re-created beside the word it put back.
      expect(ghosts()).toEqual([]);
      expect(root.textContent?.startsWith('alpha beta gamma')).toBe(true);
    });

    it('forgets a ghost a render nothing external caused threw away', () => {
      render('<p>alpha beta gamma</p>');
      applied();
      render('<p>alpha gamma</p>');
      expect(ghosts()).toEqual(['beta ']);
      jest.advanceTimersByTime(300);
      render('<p>alpha beta gamma</p>');
      jest.advanceTimersByTime(300);
      applied();
      render('<p>alpha beta gamma delta</p>');
      expect(ghosts()).toEqual([]);
      expect(root.textContent?.startsWith('alpha beta gamma')).toBe(true);
    });

    it('strikes out only what stood on screen of a removal straddling the typed edge', () => {
      render('<p>alpha jumps over</p>');
      applied();
      render('<p>alpha The quick brown fox jumps over</p>');
      jest.advanceTimersByTime(100);
      expect(addedText(root)).toEqual(['The quick']);
      applied();
      // The removal reaches from inside the typed part of the run, across
      // its unshown part, into the unchanged text after it.
      render('<p>alpha The over</p>');
      expect(ghosts()).toEqual(['quickjumps ']);
      jest.advanceTimersByTime(GHOST_HOLD_MS + 'quickjumps '.length * 10 + 32);
      expect(ghosts()).toEqual([]);
      expect(root.textContent).toBe('alpha The over');
    });
  });

  /**
   * ACC-HILITE-140. The choice is written where the stylesheet can key the two
   * change colours off it, and nowhere the marks, the flash on a selected mark
   * or the tab marker can reach.
   */
  describe('highlight visibility', () => {
    // jsdom computes nothing for a custom property, so the two blocks are read
    // as text here and what a browser makes of them is a Galata test.
    const stylesheet = readFileSync(
      `${__dirname}/../../style/base.css`,
      'utf8'
    );

    /** The declarations of every block keyed on one choice. */
    const blocksFor = (choice: string): string[] =>
      stylesheet
        .split('}')
        .filter(part => part.includes(`${VISIBILITY_ATTRIBUTE}='${choice}'`))
        .map(part => part.split('{')[1].trim());

    it('writes the choice on the document widget, never on the render root', () => {
      expect(widget.node.getAttribute(VISIBILITY_ATTRIBUTE)).toBe('medium');
      // Sibling extensions count the direct children of the rendered Markdown
      // and read its attributes, so nothing of this is written there.
      expect(root.hasAttribute(VISIBILITY_ATTRIBUTE)).toBe(false);
    });

    it('rewrites the choice without rebuilding the highlights on screen', () => {
      render('<p>alpha</p>');
      applied();
      render('<p>alpha beta</p>');
      const before = Array.from(root.querySelectorAll(`.${DECORATION_CLASS}`));
      expect(before.length).toBeGreaterThan(0);

      controller.updateSettings({ ...settings, highlightVisibility: 'high' });

      expect(widget.node.getAttribute(VISIBILITY_ATTRIBUTE)).toBe('high');
      // The same elements: the new colour reaches them through the attribute,
      // so nothing is taken out and made again and no render is asked for.
      expect(Array.from(root.querySelectorAll(`.${DECORATION_CLASS}`))).toEqual(
        before
      );
    });

    it('moves the two change colours and nothing else', () => {
      for (const choice of ['low', 'high']) {
        // One block per theme, and each declares those two variables alone,
        // so no choice can reach a mark, the mark flash or the tab marker.
        const blocks = blocksFor(choice);
        expect(blocks).toHaveLength(2);
        for (const block of blocks) {
          expect(block.split(';').filter(line => line.trim())).toHaveLength(2);
          expect(block).toContain('--jp-AdvancedMd-added-bg');
          expect(block).toContain('--jp-AdvancedMd-removed-bg');
        }
      }
      // Medium is the pair at the top of the file, so a preview at the default
      // carries no rule of its own.
      expect(blocksFor('medium')).toHaveLength(0);
    });
  });
});
