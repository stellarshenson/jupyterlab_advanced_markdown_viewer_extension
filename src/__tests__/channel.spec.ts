import { ServerConnection } from '@jupyterlab/services';

import { ChangeChannel, IChange } from '../channel';

/**
 * A WebSocket the test opens, feeds and drops by hand.
 */
class FakeSocket {
  static instances: FakeSocket[] = [];
  static OPEN = 1;

  constructor(url: string) {
    this.url = url;
    FakeSocket.instances.push(this);
  }

  url: string;
  sent: string[] = [];
  closed = false;
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;

  send(data: string): void {
    this.sent.push(data);
  }

  close(): void {
    this.closed = true;
    this.onclose?.();
  }

  /** The server accepted the connection. */
  open(): void {
    this.onopen?.();
  }

  /** The server sent a message. */
  message(body: unknown): void {
    this.onmessage?.({ data: JSON.stringify(body) });
  }

  /** The connection went away on the server side. */
  drop(): void {
    this.onclose?.();
  }

  /** The messages sent so far, parsed. */
  get messages(): { type: string; paths: string[] }[] {
    return this.sent.map(text => JSON.parse(text));
  }
}

interface IStat {
  mtime: number;
  size: number;
}

/**
 * The server side: a status answer, a stat table the test edits, and the
 * contents API the lab itself serves.
 *
 * `missing` is a lab without the server extension: every route of the
 * extension is gone, the status route and the batched stat route alike, and
 * only the contents API answers.
 */
function makeServer() {
  const server = {
    events: true,
    missing: false,
    readMissing: false,
    readFails: false,
    stats: {} as Record<string, IStat | null>,
    statRequests: [] as string[][],
    readRequests: [] as string[],
    contentsRequests: [] as string[]
  };
  const fetch = jest.fn(async (request: Request) => {
    if (request.url.includes('/api/contents/')) {
      const path = decodeURIComponent(
        request.url.split('/api/contents/')[1].split('?')[0]
      );
      server.contentsRequests.push(path);
      const stat = server.stats[path] ?? null;
      if (!stat) {
        return new Response('Not Found', { status: 404 });
      }
      return new Response(
        JSON.stringify({
          name: path,
          path,
          type: 'file',
          last_modified: new Date(stat.mtime * 1000).toISOString(),
          size: stat.size
        })
      );
    }
    if (server.missing) {
      return new Response('Not Found', { status: 404 });
    }
    if (request.url.includes('/status')) {
      return new Response(JSON.stringify({ events: server.events }));
    }
    if (request.url.includes('/read')) {
      const path = new URL(request.url).searchParams.get('path') as string;
      server.readRequests.push(path);
      if (server.readMissing) {
        return new Response('Not Found', { status: 404 });
      }
      if (server.readFails) {
        return new Response(JSON.stringify({ message: 'Unhandled error' }), {
          status: 500
        });
      }
      // As the stat route: nothing for a path the server cannot serve, and a
      // 404 with a JSON body for a file that is not there.
      if (path.split('/')[0].includes(':')) {
        return new Response(JSON.stringify({}));
      }
      if (!server.stats[path]) {
        return new Response(JSON.stringify({ message: 'no such file' }), {
          status: 404
        });
      }
      return new Response(
        JSON.stringify({
          model: { name: path, path, type: 'file', content: `text of ${path}` }
        })
      );
    }
    if (request.url.includes('/stat')) {
      const { paths } = JSON.parse(await request.text()) as { paths: string[] };
      server.statRequests.push(paths);
      const answer: Record<string, IStat | null> = {};
      for (const path of paths) {
        // A path the server cannot serve - one naming another drive among
        // them - is left out of the answer rather than answered null, which
        // is the answer for a file that is not there.
        if (path.split('/')[0].includes(':')) {
          continue;
        }
        answer[path] = server.stats[path] ?? null;
      }
      return new Response(JSON.stringify({ paths: answer }));
    }
    return new Response('Not Found', { status: 404 });
  });
  const settings = ServerConnection.makeSettings({
    baseUrl: 'http://lab.test/',
    wsUrl: 'ws://lab.test/',
    token: 'secret',
    appendToken: true,
    fetch: fetch as unknown as typeof window.fetch,
    WebSocket: FakeSocket as unknown as typeof WebSocket
  });
  return Object.assign(server, { settings, fetch });
}

describe('ChangeChannel', () => {
  let server: ReturnType<typeof makeServer>;
  let channel: ChangeChannel;
  let changes: IChange[];
  let warn: jest.SpyInstance;

  // A response travels through several promise hops after the last timer.
  const advance = async (ms: number) => {
    await jest.advanceTimersByTimeAsync(ms);
    for (let i = 0; i < 20; i++) {
      await Promise.resolve();
    }
  };
  const settle = () => advance(1);
  const socket = () => FakeSocket.instances[FakeSocket.instances.length - 1];

  /**
   * Register paths and bring the socket up, as a lab session opening previews.
   *
   * The first reading of each path is taken while the socket is still
   * opening, and asks for one check of it (DEF-DETECT-129). Those checks are
   * asserted in their own tests and dropped here, so every other test counts
   * from a session that has settled.
   */
  const connect = async (...paths: string[]) => {
    for (const path of paths) {
      channel.register(path);
    }
    await settle();
    socket().open();
    await settle();
    changes.length = 0;
  };

  /** The server confirms registrations, as it does for every register message. */
  const confirm = (...paths: string[]) =>
    socket().message({ type: 'registered', paths, events: true });

  beforeEach(() => {
    jest.useFakeTimers();
    FakeSocket.instances.length = 0;
    server = makeServer();
    server.stats = {
      'a.md': { mtime: 1, size: 10 },
      'b.md': { mtime: 1, size: 20 }
    };
    channel = new ChangeChannel(server.settings);
    changes = [];
    channel.changed.connect((_, change) => changes.push(change));
    warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    channel.dispose();
    warn.mockRestore();
    jest.useRealTimers();
  });

  it('opens one authenticated connection for many registrations', async () => {
    await connect('a.md', 'b.md', 'b.md', 'c.md');
    expect(FakeSocket.instances).toHaveLength(1);
    expect(socket().url).toBe(
      'ws://lab.test/jupyterlab-advanced-markdown-viewer-extension/events?token=secret'
    );
    expect(socket().messages).toEqual([
      { type: 'register', paths: ['a.md', 'b.md', 'c.md'] }
    ]);
    expect(warn).not.toHaveBeenCalled();
  });

  it('tells the server about a path on its first registration and last release only', async () => {
    await connect('a.md');
    channel.register('b.md');
    channel.register('b.md');
    channel.register('a.md');
    channel.release('a.md');
    channel.release('b.md');
    expect(socket().messages.slice(1)).toEqual([
      { type: 'register', paths: ['b.md'] }
    ]);
    channel.release('b.md');
    channel.release('a.md');
    expect(socket().messages.slice(2)).toEqual([
      { type: 'release', paths: ['b.md'] },
      { type: 'release', paths: ['a.md'] }
    ]);
    expect(FakeSocket.instances).toHaveLength(1);
  });

  it('reports a change message as the event it carries', async () => {
    await connect('a.md');
    socket().message({ type: 'change', path: 'a.md', event: 'changed' });
    socket().message({ type: 'change', path: 'a.md', event: 'deleted' });
    socket().message({ type: 'change', path: 'other.md', event: 'changed' });
    expect(changes).toEqual([
      { path: 'a.md', event: 'changed' },
      { path: 'a.md', event: 'deleted' }
    ]);
  });

  describe('a write made before the watch took effect (DEF-DETECT-129)', () => {
    // The watcher reads the file when it registers, and the server watches
    // the path only once the registration reaches it. A write in between
    // raises no event, and the first reading takes its revision for the
    // baseline. One check, asked for once the registration is in effect,
    // reads what was written before.
    it('is found by the check asked for when the server confirms the registration', async () => {
      await connect('a.md');
      // A second preview opens on the standing connection.
      channel.register('b.md');
      await settle();
      server.stats['b.md'] = { mtime: 2, size: 21 };
      confirm('b.md');
      expect(changes).toEqual([{ path: 'b.md', event: 'changed' }]);
      // The first reading of the path asks once more: a write made after the
      // confirmation's check raises no event on a filesystem without them.
      await advance(10_000);
      expect(changes).toEqual([
        { path: 'b.md', event: 'changed' },
        { path: 'b.md', event: 'changed' }
      ]);
    });

    it('asks once for each registration, and not again when a reconnect confirms it', async () => {
      await connect('a.md', 'b.md');
      confirm('a.md', 'b.md');
      expect(changes).toEqual([
        { path: 'a.md', event: 'changed' },
        { path: 'b.md', event: 'changed' }
      ]);
      confirm('a.md', 'b.md');
      socket().drop();
      await advance(1000);
      socket().open();
      await settle();
      confirm('a.md', 'b.md');
      // The stat on reconnect is what finds a write made during the gap.
      expect(changes).toHaveLength(2);
    });

    it('asks again for a path released and registered anew', async () => {
      await connect('a.md');
      confirm('a.md');
      channel.release('a.md');
      channel.register('a.md');
      await settle();
      confirm('a.md');
      expect(changes).toEqual([
        { path: 'a.md', event: 'changed' },
        { path: 'a.md', event: 'changed' }
      ]);
    });

    it('asks nothing for a path this session does not hold', async () => {
      await connect('a.md');
      confirm('other.md');
      socket().message({ type: 'registered', events: true });
      socket().message({ type: 'registered', paths: 'a.md', events: true });
      expect(changes).toEqual([]);
    });

    it('is found at the first reading while the socket is still opening', async () => {
      channel.register('a.md');
      // The reading is taken before the socket is up, so no confirmation
      // has come: it is the first thing that can vouch for the path.
      await settle();
      expect(changes).toEqual([{ path: 'a.md', event: 'changed' }]);
      // The confirmation that follows the socket asks once more, because
      // only from then on does the server report a write.
      socket().open();
      await settle();
      confirm('a.md');
      expect(changes).toEqual([
        { path: 'a.md', event: 'changed' },
        { path: 'a.md', event: 'changed' }
      ]);
    });

    it('is found at the first reading where the server raises no events', async () => {
      server.events = false;
      channel.register('a.md');
      await settle();
      expect(changes).toEqual([{ path: 'a.md', event: 'changed' }]);
      // Later readings report a file only when it moved.
      await advance(10_000);
      expect(changes).toEqual([{ path: 'a.md', event: 'changed' }]);
    });

    it('asks at the first reading of a path registered on a standing connection', async () => {
      await connect('a.md');
      channel.register('b.md');
      await settle();
      // No confirmation came: the first reading is what asks, a fallback
      // interval later at most.
      await advance(10_000);
      expect(changes).toEqual([{ path: 'b.md', event: 'changed' }]);
      // Later readings report the file only when it moved.
      await advance(10_000);
      expect(changes).toEqual([{ path: 'b.md', event: 'changed' }]);
    });
  });

  it('reconnects with backoff, registers again and checks the files once', async () => {
    await connect('a.md', 'b.md');
    const statsBefore = server.statRequests.length;
    socket().drop();
    await advance(999);
    expect(FakeSocket.instances).toHaveLength(1);
    await advance(1);
    expect(FakeSocket.instances).toHaveLength(2);
    // The second attempt fails: the next one waits twice as long.
    socket().drop();
    await advance(1999);
    expect(FakeSocket.instances).toHaveLength(2);
    await advance(1);
    expect(FakeSocket.instances).toHaveLength(3);
    // A write during the gap raised no message.
    server.stats['a.md'] = { mtime: 2, size: 11 };
    socket().open();
    await settle();
    expect(socket().messages).toEqual([
      { type: 'register', paths: ['a.md', 'b.md'] }
    ]);
    expect(server.statRequests.slice(statsBefore)).toEqual([['a.md', 'b.md']]);
    expect(changes).toEqual([{ path: 'a.md', event: 'changed' }]);
    // The delay is back at its floor after a successful open.
    socket().drop();
    await advance(1000);
    expect(FakeSocket.instances).toHaveLength(4);
  });

  it('catches up a write made while the socket was down after an earlier event', async () => {
    await connect('a.md');
    socket().message({ type: 'change', path: 'a.md', event: 'changed' });
    socket().drop();
    // The write during the gap raised no message of its own, so only the
    // stat on reconnect can find it. The message before the gap said nothing
    // about it and must not consume it.
    server.stats['a.md'] = { mtime: 2, size: 11 };
    await advance(1000);
    socket().open();
    await settle();
    expect(changes).toEqual([
      { path: 'a.md', event: 'changed' },
      { path: 'a.md', event: 'changed' }
    ]);
  });

  it('warns once when the connection is refused again and again', async () => {
    channel.register('a.md');
    await settle();
    // One refused connection is a server restart and says nothing.
    socket().drop();
    await advance(1000);
    expect(warn).not.toHaveBeenCalled();
    // A second one in a row is a proxy that carries no WebSocket, which only
    // this warning names.
    socket().drop();
    await advance(2000);
    expect(warn).toHaveBeenCalledTimes(1);
    socket().drop();
    await advance(4000);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(FakeSocket.instances.length).toBeGreaterThan(3);
  });

  it('checks the files through the contents API when the server extension is missing', async () => {
    server.missing = true;
    channel.interval = 3;
    channel.register('a.md');
    channel.register('b.md');
    await settle();
    expect(FakeSocket.instances).toHaveLength(0);
    expect(warn).toHaveBeenCalledTimes(1);
    // The extension's own stat route is gone with the rest of it, so the
    // comparison is made from the contents API. The first check is the
    // baseline, and asks for one check of each path (DEF-DETECT-129).
    expect(server.statRequests).toEqual([]);
    expect(server.contentsRequests).toEqual(['a.md', 'b.md']);
    expect(changes).toEqual([
      { path: 'a.md', event: 'changed' },
      { path: 'b.md', event: 'changed' }
    ]);
    changes.length = 0;
    server.stats['b.md'] = { mtime: 2, size: 21 };
    // The poll started at time zero; settling took one millisecond.
    await advance(2998);
    expect(server.contentsRequests).toHaveLength(2);
    await advance(1);
    expect(server.contentsRequests).toHaveLength(4);
    expect(changes).toEqual([{ path: 'b.md', event: 'changed' }]);
    // A file that disappeared is reported from the same answer.
    server.stats['b.md'] = null;
    await advance(3000);
    expect(changes).toEqual([
      { path: 'b.md', event: 'changed' },
      { path: 'b.md', event: 'deleted' }
    ]);
  });

  it('falls back to the batched check when the server reports no events', async () => {
    server.events = false;
    channel.register('a.md');
    await settle();
    expect(FakeSocket.instances).toHaveLength(0);
    expect(warn).toHaveBeenCalledTimes(1);
    changes.length = 0;
    server.stats['a.md'] = { mtime: 2, size: 11 };
    await advance(10_000);
    expect(changes).toEqual([{ path: 'a.md', event: 'changed' }]);
  });

  it('sends one batched request per interval with every registered path', async () => {
    server.events = false;
    channel.interval = 3;
    channel.register('a.md');
    channel.register('b.md');
    await settle();
    await advance(9000);
    expect(server.statRequests).toEqual([
      ['a.md', 'b.md'],
      ['a.md', 'b.md'],
      ['a.md', 'b.md'],
      ['a.md', 'b.md']
    ]);
  });

  it('marks a path whose change came without an event as eventless and checks it every second', async () => {
    await connect('a.md', 'b.md');
    const statsBefore = server.statRequests.length;
    server.stats['a.md'] = { mtime: 2, size: 11 };
    await advance(10_000);
    expect(changes).toEqual([{ path: 'a.md', event: 'changed' }]);
    // The verdict waits one second for a message that may still be on its
    // way, so nothing is checked at one second yet.
    expect(server.statRequests.slice(statsBefore)).toEqual([['a.md', 'b.md']]);
    await advance(1000);
    server.stats['a.md'] = { mtime: 3, size: 12 };
    await advance(1000);
    expect(changes).toEqual([
      { path: 'a.md', event: 'changed' },
      { path: 'a.md', event: 'changed' }
    ]);
    // Only the eventless path rides the one second check.
    expect(server.statRequests.slice(statsBefore)).toEqual([
      ['a.md', 'b.md'],
      ['a.md'],
      ['a.md']
    ]);
  });

  it('does not mark a path eventless when the socket went away before the verdict', async () => {
    await connect('a.md');
    server.stats['a.md'] = { mtime: 2, size: 11 };
    await advance(10_000);
    expect(changes).toHaveLength(1);
    const statsBefore = server.statRequests.length;
    // The connection went away inside the second the verdict waits: the
    // message the server was about to send could not arrive over it, which
    // says nothing about the filesystem, so the path is not checked every
    // second from here on.
    socket().drop();
    await advance(5000);
    expect(server.statRequests.slice(statsBefore)).toEqual([]);
  });

  it('does not mark a path eventless when the event follows the check', async () => {
    await connect('a.md');
    const statsBefore = server.statRequests.length;
    server.stats['a.md'] = { mtime: 2, size: 11 };
    await advance(10_000);
    expect(changes).toHaveLength(1);
    // The write landed just before the check, so its message arrives just
    // after it: the path raises events and is not checked every second.
    await advance(80);
    socket().message({ type: 'change', path: 'a.md', event: 'changed' });
    await advance(3000);
    expect(changes).toHaveLength(2);
    expect(server.statRequests.slice(statsBefore)).toEqual([['a.md']]);
    // That message consumed no later check either: the next silent change is
    // still reported.
    server.stats['a.md'] = { mtime: 3, size: 12 };
    await advance(10_000);
    expect(changes).toHaveLength(3);
  });

  it('leaves the one second check to the poll at a one second interval', async () => {
    channel.interval = 1;
    await connect('a.md');
    server.stats['a.md'] = { mtime: 2, size: 11 };
    await advance(1000);
    expect(changes).toHaveLength(1);
    // The path is eventless from here on; the poll already carries it every
    // second, so no second request asks the same question.
    await advance(1000);
    const before = server.statRequests.length;
    await advance(5000);
    expect(server.statRequests.length - before).toBe(5);
  });

  it('does not mark a path eventless when its change arrived as an event', async () => {
    await connect('a.md');
    const statsBefore = server.statRequests.length;
    socket().message({ type: 'change', path: 'a.md', event: 'changed' });
    server.stats['a.md'] = { mtime: 2, size: 11 };
    await advance(10_000);
    expect(changes).toEqual([{ path: 'a.md', event: 'changed' }]);
    await advance(5000);
    expect(server.statRequests.slice(statsBefore)).toEqual([['a.md']]);
  });

  it('reports a file that disappeared once, and its return as a change', async () => {
    await connect('a.md');
    server.stats['a.md'] = null;
    await advance(10_000);
    await advance(10_000);
    expect(changes).toEqual([{ path: 'a.md', event: 'deleted' }]);
    server.stats['a.md'] = { mtime: 5, size: 5 };
    await advance(10_000);
    expect(changes).toEqual([
      { path: 'a.md', event: 'deleted' },
      { path: 'a.md', event: 'changed' }
    ]);
  });

  it('reports a file deleted between its registration and the first check', async () => {
    await connect('a.md');
    // A second preview opens while the socket already stands: the
    // registration is sent and no check is made for it.
    channel.register('b.md');
    await settle();
    // The file goes inside the interval and its event does not arrive.
    server.stats['b.md'] = null;
    await advance(10_000);
    expect(changes).toEqual([{ path: 'b.md', event: 'deleted' }]);
    // The first check of a file that is there is still the baseline, and the
    // deletion is reported once.
    await advance(10_000);
    expect(changes).toEqual([{ path: 'b.md', event: 'deleted' }]);
  });

  it('reports a file deleted right after its registration once when its event arrived', async () => {
    await connect('a.md');
    channel.register('b.md');
    await settle();
    server.stats['b.md'] = null;
    socket().message({ type: 'change', path: 'b.md', event: 'deleted' });
    await advance(10_000);
    expect(changes).toEqual([{ path: 'b.md', event: 'deleted' }]);
  });

  it('leaves a path the server cannot serve out of the comparison', async () => {
    // jupyter-collaboration gives every document it manages a drive prefix,
    // which does not resolve under the server root, so the server answers
    // nothing at all for it. That is not a file that disappeared.
    await connect('RTC:a.md', 'b.md');
    server.stats['b.md'] = null;
    await advance(10_000);
    await advance(10_000);
    expect(changes).toEqual([{ path: 'b.md', event: 'deleted' }]);
  });

  it('leaves a drive path out of the contents comparison too', async () => {
    // Where the server extension is absent the comparison runs through the
    // contents API, which knows nothing of drives: it looks a drive path up
    // as a file name under the server root and answers 404 for it, the same
    // answer it gives for a file that is gone. The two cannot be told apart
    // there, so the drive path is left out of the comparison rather than
    // reported as a deletion.
    server.missing = true;
    server.stats['dir/RTC:a.md'] = { mtime: 1, size: 30 };
    channel.register('RTC:a.md');
    channel.register('b.md');
    channel.register('dir/RTC:a.md');
    await settle();
    changes.length = 0;
    server.stats['b.md'] = null;
    // A colon in a later segment is part of a file name and names no drive,
    // so that file is compared as any other.
    server.stats['dir/RTC:a.md'] = { mtime: 2, size: 31 };
    await advance(10_000);
    await advance(10_000);
    expect(changes).toEqual([
      { path: 'b.md', event: 'deleted' },
      { path: 'dir/RTC:a.md', event: 'changed' }
    ]);
    // Left out of the comparison means not asked about at all.
    expect(server.contentsRequests).not.toContain('RTC:a.md');
  });

  describe('reading a document (DEF-APPLY-131)', () => {
    it('reads through the read route of the server extension', async () => {
      await connect('dir/a b.md');
      server.stats['dir/a b.md'] = { mtime: 1, size: 10 };
      await expect(channel.read('dir/a b.md')).resolves.toEqual({
        name: 'dir/a b.md',
        path: 'dir/a b.md',
        type: 'file',
        content: 'text of dir/a b.md'
      });
      expect(server.readRequests).toEqual(['dir/a b.md']);
    });

    it('answers nothing for a path the server does not serve', async () => {
      await connect('RTC:a.md');
      await expect(channel.read('RTC:a.md')).resolves.toBeUndefined();
    });

    it('rejects for a file that is not there', async () => {
      await connect('a.md');
      server.stats['a.md'] = null;
      await expect(channel.read('a.md')).rejects.toBeInstanceOf(
        ServerConnection.ResponseError
      );
    });

    it('answers nothing where the server has no read route, and asks once', async () => {
      // A server not restarted since the upgrade the browser has loaded: its
      // other routes answer, and this one is not there.
      await connect('a.md');
      server.readMissing = true;
      await expect(channel.read('a.md')).resolves.toBeUndefined();
      await expect(channel.read('a.md')).resolves.toBeUndefined();
      expect(server.readRequests).toEqual(['a.md']);
    });

    it('answers nothing when the route fails, so the contents API says what the reader is told', async () => {
      await connect('a.md');
      server.readFails = true;
      await expect(channel.read('a.md')).resolves.toBeUndefined();
    });

    it('asks nothing of a lab known to have no server extension', async () => {
      server.missing = true;
      channel.register('a.md');
      await settle();
      await expect(channel.read('a.md')).resolves.toBeUndefined();
      // Such a lab answers every route of the extension with its own 404, so
      // the request itself is what must not have been made.
      expect(
        server.fetch.mock.calls.filter(([request]) =>
          request.url.includes('/read')
        )
      ).toEqual([]);
    });
  });

  it('does not let an event before the first check consume the change after it', async () => {
    await connect('a.md');
    channel.register('b.md');
    await settle();
    // The event arrives before the first check of this path, so the check
    // records a revision the event has already reported.
    socket().message({ type: 'change', path: 'b.md', event: 'changed' });
    server.stats['b.md'] = { mtime: 2, size: 21 };
    await advance(10_000);
    // The event, then the one check the first reading of a path asks for.
    expect(changes).toEqual([
      { path: 'b.md', event: 'changed' },
      { path: 'b.md', event: 'changed' }
    ]);
    // The write after it raises no event of its own: the check must report
    // it rather than take it for the one the event already carried.
    server.stats['b.md'] = { mtime: 3, size: 22 };
    await advance(10_000);
    expect(changes).toEqual([
      { path: 'b.md', event: 'changed' },
      { path: 'b.md', event: 'changed' },
      { path: 'b.md', event: 'changed' }
    ]);
  });

  it('closes the connection on dispose and does not reconnect', async () => {
    await connect('a.md');
    channel.dispose();
    expect(socket().closed).toBe(true);
    await advance(60_000);
    expect(FakeSocket.instances).toHaveLength(1);
  });
});
