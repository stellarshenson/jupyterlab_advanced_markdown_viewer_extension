/**
 * Per-document coordination of watching, decorating and signalling.
 *
 * One controller is attached to each open Markdown preview. It owns the file
 * watcher, remembers the text of the previous render so the next one can be
 * compared against it, restores the scroll position the render destroys, and
 * marks the document tab when something arrives.
 */

import { DocumentRegistry } from '@jupyterlab/docregistry';
import { MarkdownDocument } from '@jupyterlab/markdownviewer';
import { Contents } from '@jupyterlab/services';
import { IDisposable } from '@lumino/disposable';
import { ISignal, Signal } from '@lumino/signaling';
import { Title, Widget } from '@lumino/widgets';

import { ChangeAnimator } from './animate';
import { ChangeChannel } from './channel';
import {
  changeRanges,
  diffWords,
  mapOffsets,
  MAX_LCS_TOKENS,
  tokenize
} from './diff';
import {
  captureText,
  decorate,
  hasVisibleChange,
  ITextSnapshot,
  undecorate
} from './highlight';
import { BlockedReason, FileWatcher } from './watcher';

/**
 * Class marking a tab whose document received an external change.
 */
export const TAB_UPDATED_CLASS = 'jp-AdvancedMd-tabUpdated';

/**
 * Class marking a tab holding unsaved edits that blocked an external change.
 */
export const TAB_BLOCKED_CLASS = 'jp-AdvancedMd-tabBlocked';

/**
 * Class marking a tab whose file is gone from disk.
 *
 * A removed file and a change held behind unsaved edits both leave the view
 * behind the disk, but they ask the reader for opposite things: restore or
 * close the file, against save or revert the document. They therefore carry
 * different markers.
 */
export const TAB_MISSING_CLASS = 'jp-AdvancedMd-tabMissing';

/**
 * Class marking a tab whose document is receiving changes right now.
 *
 * Set on every applied change and cleared after a quiet period, so the tab
 * icon animates while an external writer is at work and settles when it stops.
 */
export const TAB_ACTIVE_CLASS = 'jp-AdvancedMd-tabActive';

/**
 * Tooltip for each marker, so the tab says in words which state it shows.
 */
const TAB_CAPTIONS: { [className: string]: string | undefined } = {
  [TAB_UPDATED_CLASS]:
    'The file changed on disk and the preview shows the new content; added and removed text is highlighted.',
  [TAB_BLOCKED_CLASS]:
    'A change on disk is held back by unsaved edits in this document. To take the change, save and choose Revert in the File Changed dialog; Overwrite keeps your version and drops the change.',
  [TAB_MISSING_CLASS]:
    'The file is gone from disk. This view keeps the last content that was read.'
};

/**
 * Quiet period before an active tab settles to its static marker.
 *
 * Changes arrive as file events, within a fraction of a second of the write,
 * so how long the tab keeps animating after the last one is a fixed period
 * and not derived from the fallback interval.
 *
 * Exported so the tests measure the periods the code uses rather than restate
 * them, which would hide a change to this value instead of reporting it.
 */
export const QUIET_MS = 3000;

/**
 * How long a decoration takes to appear. Matches the stylesheet.
 */
const FADE_IN_MS = 500;

/**
 * Attribute the switch-tab scrolling fix puts on the document widget while it
 * holds the scroll position. While it is there, that extension owns the
 * position and this controller stays passive.
 */
const FOREIGN_SCROLL_GUARD_ATTRIBUTE = 'data-jp-scroll-guard';

/**
 * Delay of the second scroll restore, chosen to land after the Markdown viewer
 * table-of-contents fix scrolls to a heading anchor on the same signal.
 */
const LATE_SCROLL_RESTORE_MS = 150;

/**
 * How long after a wheel, pointer or key event a scroll still counts as the
 * reader's own. A scroll event later than that, while a restore is in flight,
 * came from script: this controller's own restore or another extension.
 */
const INPUT_SCROLL_WINDOW_MS = 500;

/**
 * How opaque the two change highlights are, low being the faintest.
 */
export type HighlightVisibility = 'low' | 'medium' | 'high';

/**
 * The choices the highlight visibility setting offers, in the order the
 * schema declares them. Named here rather than in the schema alone so the
 * plugin refuses a value the editor never saw and the schema test compares
 * the two lists.
 */
export const HIGHLIGHT_VISIBILITIES: HighlightVisibility[] = [
  'low',
  'medium',
  'high'
];

/**
 * Attribute the visibility choice is written on, on the document widget node.
 *
 * The stylesheet keys the two highlight colour variables off it, so a change
 * of the setting recolours what is already on screen: the decorations are
 * inside the node and take the new value on the next style pass, with nothing
 * rebuilt and no render. It is never written on the render root, whose
 * attributes and direct children sibling extensions read.
 */
export const VISIBILITY_ATTRIBUTE = 'data-jp-advancedmd-visibility';

/**
 * Settings the extension reads.
 *
 * The first eight are this controller's own. The last two belong to the notes
 * controller, which is created beside this one and handed the same object, so
 * the extension has one settings shape and the schema test one list to check
 * the declaration against.
 */
export interface ILiveViewSettings {
  enabled: boolean;
  pollInterval: number;
  fadeDuration: number;
  animation: boolean;
  animationSpeed: number;
  highlight: boolean;
  highlightVisibility: HighlightVisibility;
  tabCue: boolean;
  notes: boolean;
  author: string;
}

/**
 * The values used when the settings registry has nothing to say.
 */
export const DEFAULT_SETTINGS: ILiveViewSettings = {
  enabled: true,
  pollInterval: 10,
  fadeDuration: 3000,
  animation: true,
  animationSpeed: 25,
  highlight: true,
  highlightVisibility: 'medium',
  tabCue: true,
  notes: true,
  author: ''
};

/**
 * Options for {@link LiveViewController}.
 */
export interface ILiveViewControllerOptions {
  widget: MarkdownDocument;
  contents: Contents.IManager;
  channel: ChangeChannel;
  settings: ILiveViewSettings;
}

/**
 * Keeps one open Markdown preview current with its file.
 */
export class LiveViewController implements IDisposable {
  constructor(options: ILiveViewControllerOptions) {
    this._widget = options.widget;
    this._settings = options.settings;

    this._watcher = new FileWatcher({
      // A Markdown preview is built by the text model factory, so its model is
      // always a code model and its shared model always a shared file.
      context: options.widget
        .context as DocumentRegistry.IContext<DocumentRegistry.ICodeModel>,
      contents: options.contents,
      channel: options.channel,
      enabled: options.settings.enabled
    });
    this._watcher.applied.connect(this._onApplied, this);
    this._watcher.blocked.connect(this._onBlocked, this);
    this._watcher.unblocked.connect(this._onUnblocked, this);

    this._widget.content.rendered.connect(this._onRendered, this);
    this._widget.disposed.connect(this._onWidgetDisposed, this);
    this._widget.title.changed.connect(this._onTitleChanged, this);

    this._applyVisibility();

    const node = this._widget.node;
    node.addEventListener('pointerdown', this._onAttention, true);
    node.addEventListener('keydown', this._onAttention, true);
    node.addEventListener('wheel', this._onAttention, true);
    node.addEventListener('scroll', this._onScroll, true);
  }

  get isDisposed(): boolean {
    return this._disposed;
  }

  /**
   * The document this controller is attached to.
   */
  get widget(): MarkdownDocument {
    return this._widget;
  }

  /**
   * Emitted when the decorations of a change are complete: the fade has run,
   * the decoration markup is out and the rendered DOM is again exactly what
   * the renderer produced.
   *
   * Anything else reading the rendered text waits for this. A decoration
   * holds the text it wraps out of the text capture while it is on screen,
   * and the change animation replaces text nodes as it types, so a passage
   * inside a change can only be found once both are over.
   */
  get settled(): ISignal<this, void> {
    return this._settled;
  }

  /**
   * Read the file now and apply whatever changed on disk.
   *
   * The notes controller calls this before every marker write, so a change
   * already written by another process is in the document before the save
   * that follows and the save cannot report the file as changed. With live
   * updates turned off the watcher reads nothing here, as on every other
   * entrance.
   */
  async refresh(): Promise<void> {
    await this._watcher.refresh();
  }

  /**
   * Apply changed settings without reopening the document.
   */
  updateSettings(settings: ILiveViewSettings): void {
    const speedChanged =
      settings.animationSpeed !== this._settings.animationSpeed ||
      settings.animation !== this._settings.animation;
    this._settings = settings;
    this._watcher.enabled = settings.enabled;
    if (!settings.enabled || !settings.highlight) {
      this._endFade();
    }
    if (speedChanged) {
      this._applySpeed();
    }
    // Written on every settings change: the attribute is what the stylesheet
    // reads, so the highlights already on screen take the new strength on the
    // next style pass without being rebuilt.
    this._applyVisibility();
    if (!settings.enabled || !settings.tabCue) {
      this._setTabState(null);
    }
  }

  dispose(): void {
    if (this._disposed) {
      return;
    }
    this._disposed = true;
    if (this._lateScrollTimer !== null) {
      window.clearTimeout(this._lateScrollTimer);
      this._lateScrollTimer = null;
    }
    if (this._quietTimer !== null) {
      window.clearTimeout(this._quietTimer);
      this._quietTimer = null;
    }
    if (this._cueTimer !== null) {
      window.clearTimeout(this._cueTimer);
      this._cueTimer = null;
    }
    const node = this._widget.node;
    node.removeEventListener('pointerdown', this._onAttention, true);
    node.removeEventListener('keydown', this._onAttention, true);
    node.removeEventListener('wheel', this._onAttention, true);
    node.removeEventListener('scroll', this._onScroll, true);
    this._clearDecorations();
    this._setTabState(null);
    this._watcher.dispose();
    Signal.clearData(this);
  }

  /**
   * The element the renderer writes into, which is also the scrolling element.
   */
  private get _root(): HTMLElement | null {
    return this._widget.node.querySelector('.jp-RenderedMarkdown');
  }

  private _onWidgetDisposed(): void {
    this.dispose();
  }

  /**
   * The reader acted on the document, so an updated marker has done its job.
   */
  private _onAttention = (): void => {
    this._lastInputAt = Date.now();
    this._clearUpdatedCue();
  };

  /**
   * Track where the reader is, because the render replaces the content and
   * takes the scroll position with it.
   *
   * Scroll events arrive after the assignment that caused them, so the
   * controller's own restore is recognised by where it lands rather than by
   * a flag around the assignment. While a restore is in flight, a scroll that
   * no input preceded is another extension's - the late pass overrides it.
   */
  private _onScroll = (event: Event): void => {
    const target = event.target as HTMLElement | null;
    if (!target || !target.classList?.contains('jp-RenderedMarkdown')) {
      return;
    }
    if (
      this._restoreTarget !== null &&
      target.scrollTop === this._restoreTarget
    ) {
      this._restoreTarget = null;
      return;
    }
    const restoring = this._lateScrollTimer !== null;
    if (restoring && Date.now() - this._lastInputAt > INPUT_SCROLL_WINDOW_MS) {
      return;
    }
    this._scrollTop = target.scrollTop;
    if (restoring) {
      this._userScrolledDuringRestore = true;
    }
  };

  private _onApplied(): void {
    if (!this._settings.enabled) {
      return;
    }
    this._pending = true;
    // The viewer re-renders on its own only once its render timeout has run,
    // a second by default; asking for the render now is what puts the change
    // on screen within half a second of the write. The viewer's own render
    // follows later and is taken as a re-render of the same text.
    this._widget.content.update();
    if (this._settings.tabCue) {
      this._setTabState(TAB_UPDATED_CLASS, true);
      this._resetQuietTimer();
      this._resetCueTimer();
    }
  }

  /**
   * Take the updated marker back a fade duration after the tab has settled,
   * but only while the tab is the one in front.
   *
   * A reader looking at the document has seen the change by the time its
   * highlight has gone, so the marker has done its work. A tab behind another
   * one keeps its marker until the reader comes to it and acts, which is what
   * the marker is for.
   *
   * The period is measured from the end of the quiet period rather than from
   * the change, so the settled turn always has a window to be seen in. Both
   * timers are armed on the same change, and at the shipped defaults the fade
   * duration and the quiet period are the same 3000 ms, so a period measured
   * from the change would take the marker away in the tick the tab settled
   * and the slower turn ACC-CUE-71 asks for would never appear.
   */
  private _resetCueTimer(): void {
    if (this._cueTimer !== null) {
      window.clearTimeout(this._cueTimer);
    }
    this._cueTimer = window.setTimeout(() => {
      this._cueTimer = null;
      if (this._widget.isVisible) {
        this._clearUpdatedCue();
      }
    }, QUIET_MS + this._settings.fadeDuration);
  }

  /**
   * Keep the tab animating while changes keep arriving, and settle it once
   * they stop.
   */
  private _resetQuietTimer(): void {
    if (this._quietTimer !== null) {
      window.clearTimeout(this._quietTimer);
    }
    this._quietTimer = window.setTimeout(() => {
      this._quietTimer = null;
      this._setActive(false);
    }, QUIET_MS);
  }

  /**
   * A change was found and not applied: held behind unsaved edits, or the
   * file is gone from disk. Either way the marker says the preview is behind,
   * and which marker says what the reader has to do about it.
   */
  private _onBlocked(_: unknown, reason: BlockedReason): void {
    if (!this._settings.enabled || !this._settings.tabCue) {
      return;
    }
    this._setTabState(
      reason === 'missing' ? TAB_MISSING_CLASS : TAB_BLOCKED_CLASS
    );
  }

  /**
   * The change the blocked marker reported is no longer waiting on disk.
   */
  private _onUnblocked(): void {
    if (this._isBlocked()) {
      this._setTabState(null);
    }
  }

  /**
   * A render finished. Compare it against the previous one, decorate the
   * difference, and put the scroll position back.
   */
  private _onRendered(): void {
    if (this._disposed) {
      return;
    }
    const root = this._root;
    if (!root) {
      return;
    }
    // Every render detaches the text nodes the animator was writing to. The
    // runs are kept only for the decorations this render creates, which
    // continue them, and are forgotten when it creates none.
    this._animator.stop();

    const snapshot: ITextSnapshot = captureText(root);
    const previous = this._previousText;
    const last = this._lastRendered;
    this._lastRendered = snapshot.text;

    // A render of the text already on screen while decorations are showing,
    // the viewer's own render after an applied change or another extension's
    // re-render, only replaced the DOM: the same decorations are made again
    // and the runs continue, without the fade starting over.
    const redo =
      !this._pending && this._fadeTimer !== null && snapshot.text === last;
    const shouldDecorate =
      (this._pending || redo) &&
      this._settings.enabled &&
      this._settings.highlight &&
      previous !== null &&
      previous !== snapshot.text;
    this._pending = false;

    let decorated = false;
    if (shouldDecorate) {
      const ranges = changeRanges(diffWords(previous as string, snapshot.text));
      if (hasVisibleChange(ranges)) {
        decorated = true;
        // The renderer replaced the DOM, so decorations are always created
        // anew. While a fade is pending, only what this render changed fades
        // in; text tinted by an earlier render of the same fade keeps its
        // tint without flashing.
        const freshOps =
          this._fadeTimer !== null && last !== null
            ? diffWords(last, snapshot.text)
            : null;
        const fresh = freshOps ? changeRanges(freshOps) : undefined;
        const offsets = freshOps ? mapOffsets(freshOps) : undefined;
        // Past the diff's token bound on either side, the changed middle
        // arrives as one removal and one addition with the unchanged text
        // inside the addition. Typing that would take text the reader had
        // away and bring it back, so such a change lands at once, tinted as
        // without animation. The diff this render made decides: what an
        // earlier coarse write of the same fade showed stays complete anyway,
        // and a small write after it is typed.
        const scope = fresh ?? ranges;
        const past = (text: string) => tokenize(text).length > MAX_LCS_TOKENS;
        const coarse =
          scope.added.some(range =>
            past(snapshot.text.slice(range.start, range.end))
          ) || scope.removed.some(removal => past(removal.text));
        const speed = coarse ? 0 : this._speed();
        // While a fade is pending and this render animates, the ghosts are
        // what this render removed and what is still on its way out, so a
        // ghost already taken out never comes back. Otherwise every removal
        // against the held baseline is shown, as without animation.
        const ghosts =
          freshOps && offsets && speed > 0
            ? this._animator.ghosts(freshOps, offsets)
            : undefined;
        if (redo) {
          // The elements the last render made are detached already, and the
          // fade timer they were given stands.
          undecorate(this._decorations);
        } else {
          this._clearDecorations();
        }
        this._decorations = decorate(
          root,
          snapshot,
          ranges,
          this._settings.fadeDuration,
          fresh,
          this._animator.carried(),
          ghosts
        );
        const animationMs = this._animator.start(
          this._decorations,
          speed,
          offsets
        );
        if (redo) {
          // The stylesheet places the drain from the element's own creation,
          // and this render built its elements again in the middle of a fade
          // the first render timed. Each one is given the life it has left,
          // less the time its typing holds the fade-out paused, so the colour
          // still drains over the last part of the life rather than being cut
          // off part-way through by the decorations being taken out.
          const life = Math.max(0, this._fadeEndsAt - Date.now() - animationMs);
          for (const element of this._decorations) {
            element.style.setProperty(
              '--jp-AdvancedMd-fade-duration',
              `${life}ms`
            );
          }
        } else {
          this._scheduleFade(animationMs);
        }
      }
    }
    if (!decorated) {
      this._animator.clear();
    }

    // While a fade is pending the baseline is held, so a change arriving
    // before the previous one has faded is highlighted together with it
    // rather than replacing it. Tested after decorating, so the timer this
    // render started counts. The baseline advances when the fade completes.
    if (this._fadeTimer === null) {
      this._previousText = snapshot.text;
    }

    this._restoreScroll(root);
  }

  /**
   * Put the scroll position back after the renderer replaced the content.
   *
   * Two attempts: one on the next frame, and one after a short delay, because
   * another extension scrolls to a heading anchor on this same signal. Both
   * stand down as soon as the reader scrolls for themselves. Neither is armed
   * while the switch-tab scrolling fix owns the scroll position; the guard is
   * read once here, so a guard that goes up after that still leaves the two
   * attempts of this render to run, and a timer an earlier render armed is
   * not cleared at either early return above and fires with that render's
   * target. ACC-COMPAT-108 records both as declined.
   */
  private _restoreScroll(root: HTMLElement): void {
    const target = this._scrollTop;
    // A document nobody has acted in yet yields to whatever navigation the
    // first render brings; a reader who scrolled back to the top keeps it.
    if (target <= 0 && this._lastInputAt === 0) {
      return;
    }
    if (this._foreignScrollGuard()) {
      return;
    }
    this._userScrolledDuringRestore = false;
    this._restoreTarget = null;
    const restore = () => {
      if (this._disposed || this._userScrolledDuringRestore) {
        return;
      }
      if (root.scrollTop !== target && root.scrollHeight > root.clientHeight) {
        root.scrollTop = target;
        this._restoreTarget = root.scrollTop;
      }
    };
    requestAnimationFrame(restore);
    if (this._lateScrollTimer !== null) {
      window.clearTimeout(this._lateScrollTimer);
    }
    this._lateScrollTimer = window.setTimeout(() => {
      this._lateScrollTimer = null;
      restore();
    }, LATE_SCROLL_RESTORE_MS);
  }

  /**
   * Whether another extension owns the scroll position right now.
   *
   * The switch-tab scrolling fix marks the widget while its guard is live and
   * takes the marker off as soon as it releases. The marker alone decides: a
   * widget nobody marked is nobody's but the reader's, however recently its
   * tab came to the front.
   */
  private _foreignScrollGuard(): boolean {
    return this._widget.node.hasAttribute(FOREIGN_SCROLL_GUARD_ATTRIBUTE);
  }

  /**
   * Put the visibility choice on the document widget node, where the
   * stylesheet reads it.
   */
  private _applyVisibility(): void {
    this._widget.node.setAttribute(
      VISIBILITY_ATTRIBUTE,
      this._settings.highlightVisibility
    );
  }

  /**
   * The animation speed in force: the setting, and nothing else.
   *
   * The operating system's reduced-motion preference is deliberately not read
   * here (DEF-CUE-68). A Windows host reports it to every page whenever its
   * own animation switch is off, which readers turn off for performance, and
   * that is not a request for this extension to stop saying what changed. The
   * switches that stop the motion are this extension's own: animation off, or
   * a speed of 0.
   */
  private _speed(): number {
    return this._settings.animation ? this._settings.animationSpeed : 0;
  }

  /**
   * The speed in force changed: the runs in progress take it on their next
   * frame, and the fade waits for the time they still need.
   */
  private _applySpeed = (): void => {
    this._animator.speed = this._speed();
    if (this._fadeTimer !== null) {
      this._scheduleFade(this._animator.remainingMs());
    }
  };

  /**
   * Take the decoration markup back out once the fade has run, so the DOM
   * returns to exactly what the renderer produced.
   *
   * The fade runs after the longest typing or deletion is over, so the
   * baseline is held until the last decoration is complete.
   *
   * @param animationMs - how long the change animation still needs
   */
  private _scheduleFade(animationMs = 0): void {
    if (this._fadeTimer !== null) {
      window.clearTimeout(this._fadeTimer);
    }
    const life = animationMs + this._settings.fadeDuration + FADE_IN_MS;
    // When the decorations go, which is what a re-render of the same text
    // aligns its drain against.
    this._fadeEndsAt = Date.now() + life;
    this._fadeTimer = window.setTimeout(() => this._endFade(), life);
  }

  /**
   * A fade is over, early or on time: the decorations go and the baseline
   * advances to what is on screen, so the next change is diffed alone.
   */
  private _endFade(): void {
    this._clearDecorations();
    this._animator.clear();
    const root = this._root;
    if (root) {
      this._previousText = captureText(root).text;
    }
    this._settled.emit();
  }

  /**
   * Take the decorations out, and the fade timer with them; a timer without
   * decorations would hold the baseline for nothing.
   */
  private _clearDecorations(): void {
    if (this._fadeTimer !== null) {
      window.clearTimeout(this._fadeTimer);
      this._fadeTimer = null;
    }
    // Typed text is completed before the decorations are unwrapped, so the
    // document that comes back is the whole one.
    this._animator.stop();
    if (!this._decorations.length) {
      return;
    }
    undecorate(this._decorations);
    this._decorations = [];
  }

  /**
   * Clear the updated marker. A blocked marker stays: the change it reports
   * is still on disk, whatever the reader did.
   */
  private _clearUpdatedCue(): void {
    if (!this._isBlocked()) {
      this._setTabState(null);
    }
  }

  /**
   * Whether the tab carries either of the markers the reader has to act on.
   */
  private _isBlocked(): boolean {
    return (
      this._hasTabClass(TAB_BLOCKED_CLASS) ||
      this._hasTabClass(TAB_MISSING_CLASS)
    );
  }

  private _hasTabClass(name: string): boolean {
    return (this._widget.title.className ?? '').split(/\s+/).includes(name);
  }

  /**
   * Set or clear the marker on the document tab.
   *
   * Written through the widget title so tab styling from other extensions
   * reconciles rather than being overwritten.
   *
   * @param state - the marker class, or null to clear every marker
   * @param active - whether the tab should also animate
   */
  private _setTabState(state: string | null, active = false): void {
    const title = this._widget.title;
    const classes = (title.className ?? '')
      .split(/\s+/)
      .filter(
        name =>
          name &&
          name !== TAB_UPDATED_CLASS &&
          name !== TAB_BLOCKED_CLASS &&
          name !== TAB_MISSING_CLASS &&
          name !== TAB_ACTIVE_CLASS
      );
    this._setCaption(state ? TAB_CAPTIONS[state] : undefined);
    if (state) {
      classes.push(state);
      if (active) {
        classes.push(TAB_ACTIVE_CLASS);
      }
    }
    const next = classes.join(' ');
    if (next !== title.className) {
      title.className = next;
    }
    if (!state && this._quietTimer !== null) {
      window.clearTimeout(this._quietTimer);
      this._quietTimer = null;
    }
  }

  /**
   * Put a state's tooltip on the tab, or take it back off.
   *
   * The state's words go first and the document's own caption follows,
   * because other extensions read that caption from the tab: the colourful
   * tab sibling finds a file tab by the Path line of its tooltip. The
   * caption the tab carried before the first marker is kept, so a tab that
   * stops being blocked says again whatever the document gave it.
   *
   * @param text - the tooltip, or undefined for the state having no tooltip
   */
  private _setCaption(text: string | undefined): void {
    const title = this._widget.title;
    this._stateCaption = text ?? null;
    if (text === undefined) {
      if (this._documentCaption !== null) {
        title.caption = this._documentCaption;
        this._documentCaption = null;
      }
      return;
    }
    if (this._documentCaption === null) {
      this._documentCaption = title.caption;
    }
    title.caption = this._composedCaption();
  }

  /** The state's words over the document's own caption. */
  private _composedCaption(): string {
    const text = this._stateCaption ?? '';
    const document = this._documentCaption;
    return document ? `${text}\n\n${document}` : text;
  }

  /**
   * Keep a state's tooltip on the tab while the document manager rewrites
   * the caption underneath it.
   *
   * An applied change moves the Context's record of the file, and the
   * document manager answers the file-changed signal with a fresh caption a
   * moment later, once it has listed the checkpoints. The fresh caption is
   * kept, to be given back and to stand under the state's words meanwhile.
   */
  private _onTitleChanged(title: Title<Widget>): void {
    if (
      this._stateCaption === null ||
      title.caption === this._composedCaption()
    ) {
      return;
    }
    this._documentCaption = title.caption;
    title.caption = this._composedCaption();
  }

  /**
   * Start or stop the tab animation without touching the marker itself.
   */
  private _setActive(active: boolean): void {
    const title = this._widget.title;
    const classes = (title.className ?? '')
      .split(/\s+/)
      .filter(name => name && name !== TAB_ACTIVE_CLASS);
    if (active && classes.includes(TAB_UPDATED_CLASS)) {
      classes.push(TAB_ACTIVE_CLASS);
    }
    const next = classes.join(' ');
    if (next !== title.className) {
      title.className = next;
    }
  }

  private _widget: MarkdownDocument;
  private _watcher: FileWatcher;
  private _settings: ILiveViewSettings;
  private _previousText: string | null = null;
  private _lastRendered: string | null = null;
  private _decorations: HTMLElement[] = [];
  private _animator = new ChangeAnimator();
  private _pending = false;
  private _disposed = false;
  private _fadeTimer: number | null = null;
  private _fadeEndsAt = 0;
  private _lateScrollTimer: number | null = null;
  private _quietTimer: number | null = null;
  private _cueTimer: number | null = null;
  private _documentCaption: string | null = null;
  private _stateCaption: string | null = null;
  private _scrollTop = 0;
  private _restoreTarget: number | null = null;
  private _lastInputAt = 0;
  private _userScrolledDuringRestore = false;
  private _settled = new Signal<this, void>(this);
}
