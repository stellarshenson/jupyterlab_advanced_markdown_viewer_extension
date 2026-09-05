import { Signal } from '@lumino/signaling';

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
  TAB_BLOCKED_CLASS,
  TAB_UPDATED_CLASS
} from '../controller';
import { ADDED_CLASS, DECORATION_CLASS } from '../highlight';

const watcherModule = jest.requireMock('../watcher') as { __instances: any[] };

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
    title: { className: '' },
    isVisible: true,
    context: { path: 'live.md' },
    content: Object.assign(content, {
      rendered: new Signal<any, void>(content)
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

  beforeEach(() => {
    jest.useFakeTimers();
    watcherModule.__instances.length = 0;
    ({ widget, root } = makeWidget());
    controller = new LiveViewController({
      widget,
      contents: {} as any,
      settings: { ...DEFAULT_SETTINGS, pollInterval: 1, fadeDuration: 4000 }
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
    controller.updateSettings({ ...DEFAULT_SETTINGS, highlight: false });
    expect(root.querySelectorAll(`.${DECORATION_CLASS}`).length).toBe(0);
    controller.updateSettings({ ...DEFAULT_SETTINGS });
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
    jest.advanceTimersByTime(4300);
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
});
