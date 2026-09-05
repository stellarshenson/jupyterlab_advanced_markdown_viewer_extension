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
import { Signal } from '@lumino/signaling';

import { changeRanges, diffWords } from './diff';
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
 * Class marking a tab whose document is receiving changes right now.
 *
 * Set on every applied change and cleared after a quiet period, so the tab
 * icon animates while an external writer is at work and settles when it stops.
 */
export const TAB_ACTIVE_CLASS = 'jp-AdvancedMd-tabActive';

/**
 * Shortest quiet period before an active tab settles to its static marker.
 */
const MIN_QUIET_MS = 3000;

/**
 * How long a decoration takes to appear. Matches the stylesheet.
 */
const FADE_IN_MS = 300;

/**
 * How long the switch-tab scrolling fix holds the scroll position after a tab
 * is activated. Restoring scroll inside that window would fight it, so the
 * controller stays passive until it has finished.
 */
const FOREIGN_SCROLL_GUARD_MS = 3000;

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
 * Settings the controller reads.
 */
export interface ILiveViewSettings {
  enabled: boolean;
  pollInterval: number;
  fadeDuration: number;
  highlight: boolean;
  tabCue: boolean;
}

/**
 * The values used when the settings registry has nothing to say.
 */
export const DEFAULT_SETTINGS: ILiveViewSettings = {
  enabled: true,
  pollInterval: 2,
  fadeDuration: 4000,
  highlight: true,
  tabCue: true
};

/**
 * Options for {@link LiveViewController}.
 */
export interface ILiveViewControllerOptions {
  widget: MarkdownDocument;
  contents: Contents.IManager;
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
      interval: options.settings.pollInterval * 1000,
      enabled: options.settings.enabled
    });
    this._watcher.applied.connect(this._onApplied, this);
    this._watcher.blocked.connect(this._onBlocked, this);
    this._watcher.unblocked.connect(this._onUnblocked, this);

    this._widget.content.rendered.connect(this._onRendered, this);
    this._widget.disposed.connect(this._onWidgetDisposed, this);

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
   * Record that the document tab was just brought to the front.
   *
   * Another extension takes ownership of the scroll position for a few seconds
   * after that happens, and this controller yields to it.
   */
  noteActivated(): void {
    this._activatedAt = Date.now();
  }

  /**
   * Apply changed settings without reopening the document.
   */
  updateSettings(settings: ILiveViewSettings): void {
    this._settings = settings;
    this._watcher.interval = settings.pollInterval * 1000;
    this._watcher.enabled = settings.enabled;
    if (!settings.enabled || !settings.highlight) {
      this._endFade();
    }
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
    if (this._settings.tabCue) {
      this._setTabState(TAB_UPDATED_CLASS, true);
      this._resetQuietTimer();
    }
  }

  /**
   * Keep the tab animating while changes keep arriving, and settle it once
   * they stop.
   */
  private _resetQuietTimer(): void {
    if (this._quietTimer !== null) {
      window.clearTimeout(this._quietTimer);
    }
    const quiet = Math.max(MIN_QUIET_MS, this._settings.pollInterval * 2000);
    this._quietTimer = window.setTimeout(() => {
      this._quietTimer = null;
      this._setActive(false);
    }, quiet);
  }

  private _onBlocked(_: unknown, reason: BlockedReason): void {
    if (!this._settings.enabled || !this._settings.tabCue) {
      return;
    }
    if (reason === 'dirty') {
      this._setTabState(TAB_BLOCKED_CLASS);
    }
  }

  /**
   * The change the blocked marker reported is no longer waiting on disk.
   */
  private _onUnblocked(): void {
    if (this._hasTabClass(TAB_BLOCKED_CLASS)) {
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

    const snapshot: ITextSnapshot = captureText(root);
    const previous = this._previousText;
    const last = this._lastRendered;
    this._lastRendered = snapshot.text;

    const shouldDecorate =
      this._pending &&
      this._settings.enabled &&
      this._settings.highlight &&
      previous !== null &&
      previous !== snapshot.text;
    this._pending = false;

    if (shouldDecorate) {
      const ranges = changeRanges(diffWords(previous as string, snapshot.text));
      if (hasVisibleChange(ranges)) {
        // The renderer replaced the DOM, so decorations are always created
        // anew. While a fade is pending, only what this render changed fades
        // in; text tinted by an earlier render of the same fade keeps its
        // tint without flashing.
        const fresh =
          this._fadeTimer !== null && last !== null
            ? changeRanges(diffWords(last, snapshot.text))
            : undefined;
        this._clearDecorations();
        this._decorations = decorate(
          root,
          snapshot,
          ranges,
          this._settings.fadeDuration,
          fresh
        );
        this._scheduleFade();
      }
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
   * another extension scrolls to a heading anchor on this same signal. Neither
   * runs while the switch-tab scrolling fix owns the scroll position, and both
   * stand down as soon as the reader scrolls for themselves.
   */
  private _restoreScroll(root: HTMLElement): void {
    const target = this._scrollTop;
    // A document nobody has acted in yet yields to whatever navigation the
    // first render brings; a reader who scrolled back to the top keeps it.
    if (target <= 0 && this._lastInputAt === 0) {
      return;
    }
    if (Date.now() - this._activatedAt < FOREIGN_SCROLL_GUARD_MS) {
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
   * Take the decoration markup back out once the fade has run, so the DOM
   * returns to exactly what the renderer produced.
   */
  private _scheduleFade(): void {
    if (this._fadeTimer !== null) {
      window.clearTimeout(this._fadeTimer);
    }
    this._fadeTimer = window.setTimeout(() => {
      this._endFade();
      if (this._widget.isVisible) {
        this._clearUpdatedCue();
      }
    }, this._settings.fadeDuration + FADE_IN_MS);
  }

  /**
   * A fade is over, early or on time: the decorations go and the baseline
   * advances to what is on screen, so the next change is diffed alone.
   */
  private _endFade(): void {
    this._clearDecorations();
    const root = this._root;
    if (root) {
      this._previousText = captureText(root).text;
    }
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
    if (!this._hasTabClass(TAB_BLOCKED_CLASS)) {
      this._setTabState(null);
    }
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
          name !== TAB_ACTIVE_CLASS
      );
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
  private _pending = false;
  private _disposed = false;
  private _fadeTimer: number | null = null;
  private _lateScrollTimer: number | null = null;
  private _quietTimer: number | null = null;
  private _activatedAt = 0;
  private _scrollTop = 0;
  private _restoreTarget: number | null = null;
  private _lastInputAt = 0;
  private _userScrolledDuringRestore = false;
}
