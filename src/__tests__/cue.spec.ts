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

import { MessageLoop } from '@lumino/messaging';
import { Signal } from '@lumino/signaling';
import { Title, Widget } from '@lumino/widgets';

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
  TAB_FRAME_CLASS_PREFIX,
  TAB_MISSING_CLASS,
  TAB_UNREAD_CLASS,
  TAB_UPDATED_CLASS,
  frameFor
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
    // The controller hooks the messages of the widget; a message sent to the
    // stand-in ends here once the hooks have run.
    processMessage: () => undefined,
    context: { path: CAPTION },
    content: Object.assign(content, {
      rendered: new Signal<any, void>(content),
      renderer: {
        node: root,
        markdownParser: null,
        setFragment: () => undefined
      },
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
  /** The tab is selected, as the dock panel does it: the widget is shown. */
  const toFront = () => {
    widget.isVisible = true;
    MessageLoop.sendMessage(widget, Widget.Msg.AfterShow);
  };

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

    it('drops the marker a fade duration after a tab left behind comes to the front', () => {
      // ACC-CUE-29: the reader who selects the tab has seen the marker, and
      // need not click in the document to be rid of it.
      widget.isVisible = false;
      applied();
      jest.advanceTimersByTime(life + 1000);
      expect(tabClasses()).toContain(TAB_UPDATED_CLASS);
      toFront();
      jest.advanceTimersByTime(settings.fadeDuration - 1);
      expect(tabClasses()).toContain(TAB_UPDATED_CLASS);
      jest.advanceTimersByTime(1);
      expect(tabClasses()).not.toContain(TAB_UPDATED_CLASS);
    });

    it('keeps the longer period when the tab comes to the front while changes arrive', () => {
      widget.isVisible = false;
      applied();
      jest.advanceTimersByTime(1000);
      toFront();
      // The period the last change set ends later than a fade duration from
      // now, and it stands.
      jest.advanceTimersByTime(life - 1000 - 1);
      expect(tabClasses()).toContain(TAB_UPDATED_CLASS);
      jest.advanceTimersByTime(1);
      expect(tabClasses()).not.toContain(TAB_UPDATED_CLASS);
    });

    it('leaves a tab the reader opened, even when it goes behind again before the fade duration ends', () => {
      // Opening the tab is looking at it: the marker has done its work.
      widget.isVisible = false;
      applied();
      jest.advanceTimersByTime(life);
      toFront();
      jest.advanceTimersByTime(settings.fadeDuration - 1);
      widget.isVisible = false;
      expect(tabClasses()).toContain(TAB_UPDATED_CLASS);
      jest.advanceTimersByTime(1);
      expect(tabClasses()).toEqual([]);
    });

    it('leaves a change held back on a tab that comes to the front', () => {
      widget.isVisible = false;
      watcher.blocked.emit('dirty');
      toFront();
      jest.advanceTimersByTime(settings.fadeDuration * 2);
      expect(tabClasses()).toEqual([TAB_BLOCKED_CLASS]);
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

  describe('the unread marker', () => {
    // ACC-CUE-201: a change the reader has not looked at stands on its tab
    // as the unread marker.
    it('turns the marker into the unread marker when changes stop on a tab behind another', () => {
      widget.isVisible = false;
      applied();
      jest.advanceTimersByTime(QUIET_MS - 1);
      expect(tabClasses()).toContain(TAB_ACTIVE_CLASS);
      expect(tabClasses()).not.toContain(TAB_UNREAD_CLASS);
      jest.advanceTimersByTime(1);
      expect(tabClasses()).toEqual([TAB_UPDATED_CLASS, TAB_UNREAD_CLASS]);
    });

    it('keeps the half circle on a tab in front', () => {
      applied();
      jest.advanceTimersByTime(QUIET_MS);
      expect(tabClasses()).toEqual([TAB_UPDATED_CLASS]);
    });

    it('never marks a change the reader watched as unread, and takes its marker away on time', () => {
      // DEF-CUE-130. The tab was in front while the change arrived; the
      // reader then selects another tab before the fade duration ends.
      applied();
      jest.advanceTimersByTime(QUIET_MS);
      widget.isVisible = false;
      jest.advanceTimersByTime(settings.fadeDuration - 1);
      expect(tabClasses()).toEqual([TAB_UPDATED_CLASS]);
      jest.advanceTimersByTime(1);
      expect(tabClasses()).toEqual([]);
    });

    it('does the same when the reader leaves while the marker still alternates', () => {
      applied();
      jest.advanceTimersByTime(1000);
      widget.isVisible = false;
      jest.advanceTimersByTime(QUIET_MS - 1000);
      expect(tabClasses()).toEqual([TAB_UPDATED_CLASS]);
      jest.advanceTimersByTime(settings.fadeDuration);
      expect(tabClasses()).toEqual([]);
    });

    it('marks unread a change that arrives after the reader left the tab', () => {
      applied();
      widget.isVisible = false;
      applied();
      jest.advanceTimersByTime(QUIET_MS);
      expect(tabClasses()).toEqual([TAB_UPDATED_CLASS, TAB_UNREAD_CLASS]);
    });

    it('counts a tab brought to the front as looked at', () => {
      widget.isVisible = false;
      applied();
      toFront();
      // The reader is on the tab when the changes stop: no unread marker.
      jest.advanceTimersByTime(QUIET_MS);
      expect(tabClasses()).toEqual([TAB_UPDATED_CLASS]);
    });

    it('says in the tooltip that the file changed while the tab was behind', () => {
      // ACC-CUE-202.
      widget.isVisible = false;
      applied();
      expect(widget.title.caption).toMatch(/highlighted/);
      jest.advanceTimersByTime(QUIET_MS);
      expect(widget.title.caption).toMatch(/while this tab was behind another/);
      expect(widget.title.caption).not.toMatch(/highlighted/);
      // The document's own caption stays under the words.
      expect(widget.title.caption).toContain(CAPTION);
      // A new change brings back the words of an arriving change.
      applied();
      expect(widget.title.caption).toMatch(/highlighted/);
      attention();
      expect(widget.title.caption).toBe(CAPTION);
    });

    it('alternates again when a change arrives, and is the unread marker again once it stops', () => {
      widget.isVisible = false;
      applied();
      jest.advanceTimersByTime(QUIET_MS);
      applied();
      expect(tabClasses()).toEqual([TAB_UPDATED_CLASS, TAB_ACTIVE_CLASS]);
      jest.advanceTimersByTime(QUIET_MS);
      expect(tabClasses()).toEqual([TAB_UPDATED_CLASS, TAB_UNREAD_CLASS]);
    });

    it('takes the unread marker off a tab brought to the front, and does not put it back when the tab goes behind again', () => {
      widget.isVisible = false;
      applied();
      jest.advanceTimersByTime(QUIET_MS + settings.fadeDuration);
      toFront();
      expect(tabClasses()).toEqual([TAB_UPDATED_CLASS]);
      widget.isVisible = false;
      jest.advanceTimersByTime(settings.fadeDuration - 1);
      expect(tabClasses()).toEqual([TAB_UPDATED_CLASS]);
      jest.advanceTimersByTime(1);
      expect(tabClasses()).toEqual([]);
    });

    it('gives way to a change held back', () => {
      widget.isVisible = false;
      applied();
      jest.advanceTimersByTime(QUIET_MS);
      watcher.blocked.emit('dirty');
      expect(tabClasses()).toEqual([TAB_BLOCKED_CLASS]);
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

  describe('the speed of the updated marker', () => {
    // ACC-CUE-200: each frame shows for the mean time between the latest
    // changes, from 1 s down to 0.25 s.
    const frameClasses = () =>
      tabClasses().filter((name: string) =>
        name.startsWith(TAB_FRAME_CLASS_PREFIX)
      );

    /** Changes the given number of milliseconds apart. */
    const changesEvery = (gap: number, count: number) => {
      for (let i = 0; i < count; i++) {
        jest.advanceTimersByTime(gap);
        applied();
      }
    };

    it('turns at 1 s a frame for a single change and for a change a second', () => {
      applied();
      expect(tabClasses()).toContain(TAB_ACTIVE_CLASS);
      expect(frameClasses()).toEqual([]);
      changesEvery(1000, 4);
      expect(tabClasses()).toContain(TAB_ACTIVE_CLASS);
      expect(frameClasses()).toEqual([]);
    });

    it.each([
      [750, 'jp-AdvancedMd-tabFrame750'],
      [500, 'jp-AdvancedMd-tabFrame500'],
      [250, 'jp-AdvancedMd-tabFrame250'],
      [100, 'jp-AdvancedMd-tabFrame250']
    ])('turns faster for changes %i ms apart', (gap, name) => {
      changesEvery(gap, 5);
      expect(frameClasses()).toEqual([name]);
    });

    it('takes the speed from the five latest changes', () => {
      changesEvery(1000, 5);
      changesEvery(250, 4);
      expect(frameClasses()).toEqual(['jp-AdvancedMd-tabFrame250']);
    });

    it('goes back to 1 s a frame once the writer goes quiet, and measures the next burst afresh', () => {
      changesEvery(250, 5);
      jest.advanceTimersByTime(QUIET_MS);
      expect(tabClasses()).toContain(TAB_UPDATED_CLASS);
      expect(frameClasses()).toEqual([]);
      applied();
      expect(frameClasses()).toEqual([]);
    });

    it('drops the speed with the marker', () => {
      changesEvery(250, 5);
      watcher.blocked.emit('dirty');
      expect(tabClasses()).toEqual([TAB_BLOCKED_CLASS]);
    });

    it('rounds the mean gap to a quarter second, between 0.25 s and 1 s', () => {
      expect(frameFor([])).toBe(1000);
      expect(frameFor([0])).toBe(1000);
      expect(frameFor([0, 5000])).toBe(1000);
      expect(frameFor([0, 870])).toBe(750);
      expect(frameFor([0, 300, 600])).toBe(250);
      expect(frameFor([0, 10])).toBe(250);
    });
  });

  describe('the stylesheet', () => {
    const markerRule = (className: string) =>
      ruleFor(`.lm-TabBar-tab.${className} .lm-TabBar-tabLabel::before`);

    it('alternates two characters, neither of them turned or moved', () => {
      // DEF-CUE-128. One character turned half a turn about the centre of
      // its box moved by twice the distance the font draws the circle from
      // that centre. The second frame is the second character, drawn where
      // the font draws it.
      expect(glyphOf(markerRule(TAB_UPDATED_CLASS))).toBe('\\25D0');
      const frames = /@keyframes jp-AdvancedMd-tab-turn \{([^@]*?)\n\}/.exec(
        stylesheet
      );
      expect(frames).not.toBeNull();
      expect((frames as RegExpExecArray)[1]).toMatch(
        /^\s*50% \{\s*content: '\\25D1';\s*\}\s*$/
      );
    });

    it('draws the unread marker as one character that stands still, one text colour level above the label', () => {
      // ACC-CUE-201.
      const unread = markerRule(TAB_UNREAD_CLASS);
      expect(glyphOf(unread)).toBe('\\273B');
      expect(unread).toMatch(/color: var\(--jp-ui-font-color0\);/);
      expect(unread).not.toContain('animation');
      for (const other of [
        TAB_UPDATED_CLASS,
        TAB_BLOCKED_CLASS,
        TAB_MISSING_CLASS
      ]) {
        expect(glyphOf(unread)).not.toBe(glyphOf(markerRule(other)));
      }
    });

    it('moves the marker only while changes arrive', () => {
      // ACC-CUE-71. The animation is on the arriving state, so the marker
      // stands still as its first character once the writer is quiet.
      expect(markerRule(TAB_ACTIVE_CLASS)).toMatch(
        /animation: jp-AdvancedMd-tab-turn 2s step-end infinite;/
      );
      expect(markerRule(TAB_UPDATED_CLASS)).not.toContain('animation');
    });

    it('gives each frame class a turn of two of its frames', () => {
      // ACC-CUE-200. The base turn is 2 s, two frames of 1 s.
      for (const frame of [750, 500, 250]) {
        expect(markerRule(`${TAB_FRAME_CLASS_PREFIX}${frame}`)).toMatch(
          new RegExp(`animation-duration: ${(2 * frame) / 1000}s;`)
        );
      }
    });

    it('gives the missing marker a shape of its own that never moves', () => {
      const missing = markerRule(TAB_MISSING_CLASS);
      expect(glyphOf(missing)).not.toBe(glyphOf(markerRule(TAB_UPDATED_CLASS)));
      expect(glyphOf(missing)).not.toBe(glyphOf(markerRule(TAB_BLOCKED_CLASS)));
      // The arriving change alternates and the held change nudges. The
      // missing one declares no animation at all, rather than only a
      // different one - the nudge of the held change would read as something
      // waiting to land, and nothing is waiting behind a file that is gone.
      expect(markerRule(TAB_ACTIVE_CLASS)).toContain('animation');
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
    // A change has just arrived, so the tab says changes are arriving.
    expect(tabClasses()).toContain(TAB_ACTIVE_CLASS);

    // The writer has gone quiet: the tab stops saying so and the marker
    // stays.
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
