/**
 * The tab cue: when the updated marker goes by itself, and how the two states
 * the reader has to act on are told apart.
 *
 * Covers the second clause of ACC-CUE-29, the tooltip of ACC-CUE-30,
 * DEF-CUE-13 and DEF-CUE-30. The stylesheet is
 * read as text because jsdom computes nothing for a ::before, so the shapes
 * themselves are asserted here only against the class names the controller
 * sets; the rendered glyphs are a browser test.
 */

import { Signal } from '@lumino/signaling';
import { Title } from '@lumino/widgets';

// The test compiler options carry the jest types alone, so the two things
// this file needs from the module system are declared where they are used.
declare const __dirname: string;
const { readFileSync } = jest.requireActual('fs') as {
  readFileSync(file: string, encoding: string): string;
};

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
  ILiveViewSettings,
  LiveViewController,
  QUIET_MS,
  TAB_ACTIVE_CLASS,
  TAB_BLOCKED_CLASS,
  TAB_MISSING_CLASS,
  TAB_UPDATED_CLASS
} from '../controller';

const watcherModule = jest.requireMock('../watcher') as { __instances: any[] };

/**
 * The caption a document gives its own tab, which the markers borrow and give
 * back.
 */
const CAPTION = 'live.md';

const stylesheet = readFileSync(`${__dirname}/../../style/base.css`, 'utf8');

/**
 * The declarations of the stylesheet rule written for one selector.
 *
 * The selector is matched whole, so a rule written for a list of selectors,
 * such as the panel's icon controls, is never taken for the rule of one
 * marker.
 */
function ruleFor(selector: string): string {
  const block = stylesheet.split('}').find((part: string) => {
    const head = part.split('{')[0].trim().split('\n');
    return head[head.length - 1].trim() === selector;
  });
  expect(block).toBeDefined();
  return (block as string).split('{')[1];
}

/**
 * The character a marker rule puts before the tab label.
 */
function glyphOf(rule: string): string {
  const match = /content:\s*'([^']*)'/.exec(rule);
  expect(match).not.toBeNull();
  return (match as RegExpExecArray)[1];
}

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
    title: new Title({ owner: {}, label: CAPTION, caption: CAPTION }),
    isVisible: true,
    context: { path: CAPTION },
    content: Object.assign(content, {
      rendered: new Signal<any, void>(content),
      update: () => undefined
    })
  };
  widget.disposed = new Signal<any, void>(widget);
  return widget;
}

/**
 * Put a controller over a fresh stand-in widget and hand back everything a
 * test drives it with, so a describe that needs other settings builds its own
 * rather than reaching into the one before it.
 */
function start(settings: ILiveViewSettings) {
  watcherModule.__instances.length = 0;
  const widget = makeWidget();
  const controller = new LiveViewController({
    widget,
    contents: {} as any,
    channel: {} as any,
    settings
  });
  return { controller, widget, watcher: watcherModule.__instances[0] };
}

describe('tab cue', () => {
  let controller: LiveViewController;
  let widget: any;
  let watcher: any;

  const settings = { ...DEFAULT_SETTINGS, fadeDuration: 4000 };

  const applied = () => watcher.applied.emit(undefined);
  const tabClasses = () => widget.title.className.split(/\s+/).filter(Boolean);
  const attention = () =>
    widget.node.dispatchEvent(new Event('pointerdown', { bubbles: true }));

  beforeEach(() => {
    jest.useFakeTimers();
    ({ controller, widget, watcher } = start(settings));
  });

  afterEach(() => {
    controller.dispose();
    widget.node.remove();
    jest.useRealTimers();
  });

  describe('the updated marker', () => {
    /**
     * How long the marker stays on a tab in front after the last change: the
     * quiet period the tab takes to settle, then a fade duration of the
     * settled marker.
     */
    const life = QUIET_MS + settings.fadeDuration;

    it('clears itself a fade duration after the tab settles while it is in front', () => {
      applied();
      expect(tabClasses()).toContain(TAB_UPDATED_CLASS);
      jest.advanceTimersByTime(life - 1);
      expect(tabClasses()).toContain(TAB_UPDATED_CLASS);
      jest.advanceTimersByTime(1);
      expect(tabClasses()).not.toContain(TAB_UPDATED_CLASS);
    });

    it('measures the period from the last change', () => {
      applied();
      jest.advanceTimersByTime(2000);
      applied();
      jest.advanceTimersByTime(life - 1);
      expect(tabClasses()).toContain(TAB_UPDATED_CLASS);
      jest.advanceTimersByTime(1);
      expect(tabClasses()).not.toContain(TAB_UPDATED_CLASS);
    });

    it('keeps the marker while another tab is in front, until the reader acts', () => {
      widget.isVisible = false;
      applied();
      jest.advanceTimersByTime(settings.fadeDuration * 2);
      expect(tabClasses()).toContain(TAB_UPDATED_CLASS);
      attention();
      expect(tabClasses()).not.toContain(TAB_UPDATED_CLASS);
    });

    it('names the change in words for as long as it stands, then gives the caption back', () => {
      applied();
      expect(widget.title.caption).toMatch(/changed on disk/);
      // The document's own caption stays on the tab under the words, because
      // other extensions read it there: the colourful tab sibling finds a
      // file tab by the Path line of its tooltip.
      expect(widget.title.caption).toContain(CAPTION);
      jest.advanceTimersByTime(life - 1);
      expect(widget.title.caption).toMatch(/changed on disk/);
      jest.advanceTimersByTime(1);
      expect(widget.title.caption).toBe(CAPTION);
    });

    it('keeps the change in words when the document manager rewrites the caption, and gives that caption back', () => {
      applied();
      // The applied change reaches the Context, whose file-changed signal
      // makes the document manager write a fresh caption onto the tab a
      // moment later; the marker's words stay, and the fresh caption is what
      // comes back when the marker goes.
      widget.title.caption = 'Name: live.md\nPath: later\nLast Saved: later';
      expect(widget.title.caption).toMatch(/changed on disk/);
      expect(widget.title.caption).toContain('Path: later');
      jest.advanceTimersByTime(life);
      expect(widget.title.caption).toBe(
        'Name: live.md\nPath: later\nLast Saved: later'
      );
    });
  });

  describe('a change the reader has to act on', () => {
    it('marks a file gone from disk apart from a change held over unsaved edits', () => {
      watcher.blocked.emit('missing');
      expect(tabClasses()).toEqual([TAB_MISSING_CLASS]);
      watcher.unblocked.emit(undefined);
      watcher.blocked.emit('dirty');
      expect(tabClasses()).toEqual([TAB_BLOCKED_CLASS]);
    });

    it('keeps the missing marker whatever the reader does', () => {
      watcher.blocked.emit('missing');
      attention();
      widget.node.dispatchEvent(new Event('wheel', { bubbles: true }));
      jest.advanceTimersByTime(settings.fadeDuration * 2);
      expect(tabClasses()).toEqual([TAB_MISSING_CLASS]);
    });

    it('drops the missing marker once the file is back', () => {
      watcher.blocked.emit('missing');
      watcher.unblocked.emit(undefined);
      expect(tabClasses()).toEqual([]);
    });

    it('names the held change on the tab, and the change that landed once it does', () => {
      watcher.blocked.emit('dirty');
      expect(widget.title.caption).not.toBe(CAPTION);
      expect(widget.title.caption).toMatch(/unsaved edits/);
      applied();
      expect(widget.title.caption).toMatch(/changed on disk/);
    });

    it('names a missing file in words of its own', () => {
      watcher.blocked.emit('dirty');
      const held = widget.title.caption;
      watcher.unblocked.emit(undefined);
      watcher.blocked.emit('missing');
      expect(widget.title.caption).toMatch(/gone from disk/);
      expect(widget.title.caption).not.toBe(held);
      watcher.unblocked.emit(undefined);
      expect(widget.title.caption).toBe(CAPTION);
    });
  });

  describe('the stylesheet', () => {
    const markerRule = (className: string) =>
      ruleFor(`.lm-TabBar-tab.${className} .lm-TabBar-tabLabel::before`);

    it('gives the missing marker a shape of its own that never moves', () => {
      const missing = markerRule(TAB_MISSING_CLASS);
      expect(glyphOf(missing)).not.toBe(glyphOf(markerRule(TAB_UPDATED_CLASS)));
      expect(glyphOf(missing)).not.toBe(glyphOf(markerRule(TAB_BLOCKED_CLASS)));
      // The three markers carry three amounts of movement: continuous,
      // occasional, none. The still one therefore declares no animation at
      // all, rather than only a different one from the turn - the nudge of
      // the held change would read as something waiting to land, and nothing
      // is waiting behind a file that is gone.
      expect(markerRule(TAB_UPDATED_CLASS)).toContain('animation');
      expect(markerRule(TAB_BLOCKED_CLASS)).toContain('animation');
      expect(missing).not.toContain('animation');
    });

    it('silences no marker for the operating system reduced-motion preference', () => {
      // DEF-CUE-68. A Windows host reports that preference to every page
      // whenever its own animation switch is off, which readers turn off for
      // performance, and a marker held still says nothing about what happened
      // to the file. The switch that stops this motion is the extension's own
      // tabCue setting, which takes the marker away altogether - the Hide
      // WCAG 2.2.2 asks for.
      expect(stylesheet).not.toContain('prefers-reduced-motion');
    });
  });
});

/**
 * The tab at the settings the extension ships with, where the fade duration
 * and the quiet period are the same 3000 ms. The two periods are measured
 * from the same change, so the settled marker only exists at all because the
 * cue timer waits for the quiet period before its own.
 */
describe('the settled marker at the shipped defaults', () => {
  let controller: LiveViewController;
  let widget: any;
  let watcher: any;

  const tabClasses = () => widget.title.className.split(/\s+/).filter(Boolean);

  beforeEach(() => {
    jest.useFakeTimers();
    ({ controller, widget, watcher } = start({ ...DEFAULT_SETTINGS }));
  });

  afterEach(() => {
    controller.dispose();
    widget.node.remove();
    jest.useRealTimers();
  });

  it('stands on the tab for a fade duration of its own before it goes', () => {
    watcher.applied.emit(undefined);
    // A change has just arrived, so the marker turns at the fast speed.
    expect(tabClasses()).toContain(TAB_ACTIVE_CLASS);

    // The writer has gone quiet: the fast turn stops and the marker stays,
    // which is the settled state ACC-CUE-71 asks to be tellable from the one
    // above it.
    jest.advanceTimersByTime(QUIET_MS);
    expect(tabClasses()).toContain(TAB_UPDATED_CLASS);
    expect(tabClasses()).not.toContain(TAB_ACTIVE_CLASS);

    // It is still settled a whole fade duration later, one tick before the
    // cue timer takes it, so the window is the fade duration and not zero.
    jest.advanceTimersByTime(DEFAULT_SETTINGS.fadeDuration - 1);
    expect(tabClasses()).toContain(TAB_UPDATED_CLASS);
    expect(tabClasses()).not.toContain(TAB_ACTIVE_CLASS);

    jest.advanceTimersByTime(1);
    expect(tabClasses()).toEqual([]);
  });
});
