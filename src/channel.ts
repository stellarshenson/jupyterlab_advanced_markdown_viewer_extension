/**
 * The change channel: one connection per browser session carrying file
 * change events for every open preview.
 *
 * The server watches the directory of every registered path with operating
 * system file events and pushes a message over one WebSocket when a file is
 * written or removed. Opening more documents adds registrations, never
 * connections or timers. A slow batched stat request stands in where events
 * cannot arrive: while the socket is down, and for files on filesystems that
 * raise no events, which the stat finds moved without an event and which are
 * polled at one second from then on. Where the server extension is absent
 * altogether its batched route is absent with it, so the same comparison is
 * made from JupyterLab's own contents API, one request per path.
 */

import { URLExt } from '@jupyterlab/coreutils';
import { ServerConnection } from '@jupyterlab/services';
import { IDisposable } from '@lumino/disposable';
import { Poll } from '@lumino/polling';
import { ISignal, Signal } from '@lumino/signaling';

import { requestAPI } from './request';
import { EXTERNAL_ORIGIN } from './watcher';

/**
 * The server extension's API namespace.
 */
const NAMESPACE = 'jupyterlab-advanced-markdown-viewer-extension';

/**
 * Fallback interval before the settings say otherwise, in milliseconds.
 */
const DEFAULT_INTERVAL_MS = 10_000;

/**
 * How often a path whose events do not arrive is checked.
 */
const EVENTLESS_INTERVAL_MS = 1000;

/**
 * Reconnect delay bounds.
 */
const RECONNECT_MIN_MS = 1000;
const RECONNECT_MAX_MS = 30_000;

/**
 * A change reported for one registered path.
 */
export interface IChange {
  path: string;
  event: 'changed' | 'deleted';
}

/**
 * What the server reports about a file without reading it.
 */
interface IStat {
  mtime: number;
  size: number;
}

/**
 * Whether two stats describe the same revision, a missing file included.
 */
function sameStat(a: IStat | null, b: IStat | null): boolean {
  return a === null || b === null
    ? a === b
    : a.mtime === b.mtime && a.size === b.size;
}

/**
 * What the channel keeps per registered path.
 *
 * The stat is `undefined` until the first batched request answered, `null`
 * while the file is missing. Both connection numbers are the socket
 * connection something was taken on, 0 for none, and both are read through
 * `_sameConnection`: a change the stat found without an event proves the
 * filesystem silent only when the same connection stood the whole time, and
 * an event carried a revision only for as long as its own connection stands,
 * since a write made while the socket was down raises no message at all.
 * `eventConnection` is the connection an event arrived on since the last
 * stat, so a moved stat that event already carried is not reported twice.
 * `connection` is the connection the stat was taken on. `silent` is the timer
 * running while a change the stat found waits for the event that may still be
 * on its way.
 */
interface IPathState {
  count: number;
  stat: IStat | null | undefined;
  eventConnection: number;
  connection: number;
  silent: ReturnType<typeof setTimeout> | null;
}

/**
 * Carries file change events for every registered path.
 */
export class ChangeChannel implements IDisposable {
  constructor(serverSettings: ServerConnection.ISettings) {
    this._settings = serverSettings;
    this._poll = new Poll({
      auto: false,
      factory: () => this._stat([...this._paths.keys()]),
      frequency: {
        interval: DEFAULT_INTERVAL_MS,
        backoff: false,
        max: DEFAULT_INTERVAL_MS
      },
      name: `${NAMESPACE}:stat`,
      standby: 'when-hidden'
    });
    this._eventlessPoll = new Poll({
      auto: false,
      // At a fallback interval of one second the main poll already carries
      // every path that often, and a second request would answer the same.
      factory: () =>
        this._intervalMs <= EVENTLESS_INTERVAL_MS
          ? Promise.resolve()
          : this._stat(
              [...this._eventless].filter(path => this._paths.has(path))
            ),
      frequency: {
        interval: EVENTLESS_INTERVAL_MS,
        backoff: false,
        max: EVENTLESS_INTERVAL_MS
      },
      name: `${NAMESPACE}:eventless`,
      standby: 'when-hidden'
    });
  }

  /**
   * Emitted when a registered file changed or disappeared on disk.
   */
  get changed(): ISignal<this, IChange> {
    return this._changed;
  }

  get isDisposed(): boolean {
    return this._disposed;
  }

  /**
   * The fallback interval in seconds.
   */
  set interval(seconds: number) {
    const ms = seconds * 1000;
    this._intervalMs = ms;
    this._poll.frequency = { interval: ms, backoff: false, max: ms };
  }

  /**
   * Ask for changes of a path. The server is told on the first registration
   * of a path only; later ones share it.
   */
  register(path: string): void {
    const state = this._paths.get(path);
    if (state) {
      state.count++;
      return;
    }
    this._paths.set(path, {
      count: 1,
      stat: undefined,
      eventConnection: 0,
      connection: 0,
      silent: null
    });
    if (this._mode === 'idle') {
      this._mode = 'starting';
      void this._start();
      return;
    }
    this._send({ type: 'register', paths: [path] });
  }

  /**
   * Give a registration back. The server is told when the last one goes.
   */
  release(path: string): void {
    const state = this._paths.get(path);
    if (!state) {
      return;
    }
    if (--state.count > 0) {
      return;
    }
    if (state.silent !== null) {
      clearTimeout(state.silent);
      state.silent = null;
    }
    this._paths.delete(path);
    this._send({ type: 'release', paths: [path] });
  }

  dispose(): void {
    if (this._disposed) {
      return;
    }
    this._disposed = true;
    if (this._reconnectTimer !== null) {
      clearTimeout(this._reconnectTimer);
      this._reconnectTimer = null;
    }
    for (const state of this._paths.values()) {
      if (state.silent !== null) {
        clearTimeout(state.silent);
        state.silent = null;
      }
    }
    const ws = this._ws;
    this._ws = null;
    ws?.close();
    this._poll.dispose();
    this._eventlessPoll.dispose();
    Signal.clearData(this);
  }

  /**
   * Find out whether the server raises events, then open the socket or fall
   * back to the poll. Either way the poll runs: with events it is what finds
   * the files whose events never come.
   */
  private async _start(): Promise<void> {
    let reason: string | null = null;
    try {
      const status = await requestAPI<{ events?: boolean }>(
        'status',
        this._settings
      );
      if (status.events !== true) {
        reason = 'the server reports no file event support';
      }
    } catch {
      reason = 'the server extension did not answer';
      // Its batched stat route did not answer either: the files are compared
      // through the contents API from now on.
      this._serverAbsent = true;
    }
    if (this._disposed) {
      return;
    }
    if (reason === null) {
      this._mode = 'events';
      this._connect();
    } else {
      this._mode = 'poll';
      console.warn(
        `${EXTERNAL_ORIGIN}: ${reason}; open Markdown files are checked by a batched request at the fallback interval instead`
      );
    }
    void this._poll.start();
  }

  private _connect(): void {
    if (this._disposed) {
      return;
    }
    let url = URLExt.join(this._settings.wsUrl, NAMESPACE, 'events');
    const token = this._settings.token;
    if (this._settings.appendToken && token !== '') {
      url += `?token=${encodeURIComponent(token)}`;
    }
    const ws = new this._settings.WebSocket(url);
    this._ws = ws;
    ws.onopen = () => {
      if (this._ws !== ws) {
        return;
      }
      this._open = true;
      this._connection++;
      this._reconnectDelay = RECONNECT_MIN_MS;
      this._send({ type: 'register', paths: [...this._paths.keys()] });
      // A write during the gap raised no message; the stat finds it.
      void this._stat([...this._paths.keys()]);
    };
    ws.onmessage = event => this._onMessage(event);
    ws.onclose = () => this._onClose(ws);
    ws.onerror = () => this._onClose(ws);
  }

  /**
   * The socket went away: try again after a delay that doubles up to a
   * ceiling. The fallback poll covers the gap.
   */
  private _onClose(ws: WebSocket): void {
    if (this._ws !== ws) {
      return;
    }
    const wasOpen = this._open;
    this._ws = null;
    this._open = false;
    if (this._disposed) {
      return;
    }
    this._failures = wasOpen ? 0 : this._failures + 1;
    // A single refused connection is a server restart. A second one in a row
    // is a proxy that does not carry WebSockets, which no other message names.
    if (this._failures > 1 && !this._socketWarned) {
      this._socketWarned = true;
      console.warn(
        `${EXTERNAL_ORIGIN}: the event connection could not be opened; open Markdown files are checked by a batched request at the fallback interval instead`
      );
    }
    this._reconnectTimer = setTimeout(() => {
      this._reconnectTimer = null;
      this._connect();
    }, this._reconnectDelay);
    this._reconnectDelay = Math.min(this._reconnectDelay * 2, RECONNECT_MAX_MS);
  }

  private _onMessage(event: MessageEvent): void {
    let message: { type?: string; path?: string; event?: string };
    try {
      message = JSON.parse(String(event.data));
    } catch {
      return;
    }
    if (message.type !== 'change' || typeof message.path !== 'string') {
      return;
    }
    const state = this._paths.get(message.path);
    if (!state) {
      return;
    }
    if (state.silent !== null) {
      // The stat found this revision a moment before the event and reported
      // it: the path raises events after all, and nothing waits to be marked.
      clearTimeout(state.silent);
      state.silent = null;
    } else {
      state.eventConnection = this._connection;
    }
    this._changed.emit({
      path: message.path,
      event: message.event === 'deleted' ? 'deleted' : 'changed'
    });
  }

  private _send(message: { type: string; paths: string[] }): void {
    if (this._ws && this._open && message.paths.length) {
      this._ws.send(JSON.stringify(message));
    }
  }

  /**
   * Compare every path against the revision last seen and report what moved.
   *
   * A path the request could not answer for is left out of the comparison
   * rather than counted as missing.
   */
  private async _stat(paths: string[]): Promise<void> {
    if (!paths.length || this._disposed) {
      return;
    }
    const stats = this._serverAbsent
      ? await this._statContents(paths)
      : await this._statBatched(paths);
    if (stats === null || this._disposed) {
      return;
    }
    for (const path of paths) {
      const state = this._paths.get(path);
      if (!state) {
        continue;
      }
      const next = stats[path];
      if (next === undefined) {
        continue;
      }
      const previous = state.stat;
      const connection = state.connection;
      state.stat = next;
      state.connection = this._open ? this._connection : 0;
      if (previous === undefined) {
        // The first stat is the baseline - unless it found nothing. A path is
        // registered for a document that has loaded from that file, so the
        // file was there at the registration and a first reading of nothing
        // is a deletion. Taking that for the baseline would lose it for
        // good, because nothing tells one reading of nothing from the next.
        if (next !== null) {
          // An event that arrived before this reading reported the revision
          // this reading has just taken as the baseline, so it must not also
          // consume the change the reading after this one finds.
          state.eventConnection = 0;
          continue;
        }
      } else if (sameStat(previous, next)) {
        continue;
      }
      if (this._sameConnection(state.eventConnection)) {
        // The event already caused a read of this revision.
        state.eventConnection = 0;
        continue;
      }
      if (next === null) {
        this._changed.emit({ path, event: 'deleted' });
        continue;
      }
      if (
        this._sameConnection(connection) &&
        !this._eventless.has(path) &&
        state.silent === null
      ) {
        // The file moved and the server has said nothing yet. An event a
        // fraction of a second behind the write is normal, so the verdict
        // waits: only a path still silent when the timer fires has a
        // filesystem that raises no events, and is checked every second. A
        // connection that went away inside that second took the message with
        // it and proves nothing, so the connection is tested again there.
        const armed = this._connection;
        state.silent = setTimeout(() => {
          state.silent = null;
          if (this._sameConnection(armed)) {
            this._markEventless(path);
          }
        }, EVENTLESS_INTERVAL_MS);
      }
      this._changed.emit({ path, event: 'changed' });
    }
  }

  /**
   * Whether that connection is the one standing now. An event or a stat taken
   * on a connection that has since gone says nothing about what happened
   * while the socket was down.
   */
  private _sameConnection(connection: number): boolean {
    return this._open && this._connection === connection;
  }

  /**
   * No event came for a change the stat found: check this path every second.
   */
  private _markEventless(path: string): void {
    if (this._disposed || !this._paths.has(path)) {
      return;
    }
    this._eventless.add(path);
    void this._eventlessPoll.start();
  }

  /**
   * One request to the server extension: every path in, a stat per path out.
   */
  private async _statBatched(
    paths: string[]
  ): Promise<Record<string, IStat | null> | null> {
    let result: { paths?: Record<string, IStat | null> };
    try {
      result = await requestAPI('stat', this._settings, {
        method: 'POST',
        body: JSON.stringify({ paths })
      });
    } catch {
      return null;
    }
    const served = result.paths ?? {};
    const answer: Record<string, IStat | null> = {};
    for (const path of paths) {
      // The server answers null for a file that is not there and nothing at
      // all for a path it cannot serve - a document on another drive, as
      // jupyter-collaboration spells every document it manages. Only the
      // first is a deletion; the second is left out of the comparison.
      if (Object.prototype.hasOwnProperty.call(served, path)) {
        answer[path] = served[path];
      }
    }
    return answer;
  }

  /**
   * The same comparison from JupyterLab's own contents API, for a lab whose
   * server extension is not installed: the batched route is part of that
   * extension, so a missing server side takes it away too. One request per
   * path, without content, which is what the per-document poll did before
   * file events.
   */
  private async _statContents(
    paths: string[]
  ): Promise<Record<string, IStat | null>> {
    const answer: Record<string, IStat | null> = {};
    await Promise.all(
      paths.map(async path => {
        // This API knows nothing of drives: it looks a path naming one up as
        // a file name under the server root and answers 404 for it, which is
        // also its answer for a file that is gone, so the two cannot be told
        // apart here. A path whose first segment carries a colon names a
        // drive - jupyter-collaboration spells every document it manages
        // RTC:doc.md - and is left out of the comparison, as the server
        // leaves out what it cannot serve.
        if (path.split('/')[0].includes(':')) {
          return;
        }
        const url =
          URLExt.join(
            this._settings.baseUrl,
            'api/contents',
            URLExt.encodeParts(path)
          ) + URLExt.objectToQueryString({ content: 0 });
        try {
          const response = await ServerConnection.makeRequest(
            url,
            {},
            this._settings
          );
          if (response.status === 404) {
            answer[path] = null;
            return;
          }
          if (!response.ok) {
            return;
          }
          const model = (await response.json()) as {
            last_modified: string;
            size: number | null;
          };
          answer[path] = {
            mtime: Date.parse(model.last_modified),
            size: model.size ?? 0
          };
        } catch {
          // The request failed: this path is left out of the comparison.
        }
      })
    );
    return answer;
  }

  private _settings: ServerConnection.ISettings;
  private _paths = new Map<string, IPathState>();
  private _eventless = new Set<string>();
  private _poll: Poll;
  private _eventlessPoll: Poll;
  private _mode: 'idle' | 'starting' | 'events' | 'poll' = 'idle';
  private _intervalMs = DEFAULT_INTERVAL_MS;
  private _serverAbsent = false;
  private _ws: WebSocket | null = null;
  private _open = false;
  private _connection = 0;
  private _failures = 0;
  private _socketWarned = false;
  private _reconnectDelay = RECONNECT_MIN_MS;
  private _reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private _disposed = false;
  private _changed = new Signal<this, IChange>(this);
}
