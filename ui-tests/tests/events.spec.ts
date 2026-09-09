import { expect, test } from '@jupyterlab/galata';
import * as fs from 'fs';
import * as path from 'path';

import {
  FILE,
  INITIAL,
  REWRITTEN,
  labFixtures,
  openPreview,
  settings
} from './helpers';

/**
 * Integration tests of change detection by file events.
 *
 * The fallback check interval is left at its default of ten seconds, so
 * within the few seconds a test takes only the event channel can carry a
 * change. Writes made through the filesystem land in `ui-tests/`, the root
 * of the test server, at the same path the contents API addresses.
 *
 * Three describes below take the event channel away instead, each in the way
 * one criterion names: a write through a second name for the same file stands
 * for a filesystem that raises no events, a socket closed mid-test stands for
 * a dropped connection, and a 404 on every route of the server extension
 * stands for a lab whose server side is not installed. They shorten the
 * fallback interval through the settings so the wait is seconds rather than
 * the ten of the default.
 */

const NAMESPACE = 'jupyterlab-advanced-markdown-viewer-extension';

/**
 * The prefix every warning of this package carries.
 *
 * It is the Yjs transaction origin, not the route namespace: the two are
 * spelled differently, one with underscores and one with hyphens, and a
 * warning filtered on the wrong one silently matches nothing.
 */
const WARNING_PREFIX = 'jupyterlab_advanced_markdown_viewer_extension';
const THIRD = 'A third paragraph appeared.';
const FOURTH = 'A fourth paragraph appeared.';

/**
 * The document once more, so a reopened preview has something new to show.
 */
const EXTENDED = `${REWRITTEN}\n${FOURTH}\n`;

/**
 * The event WebSocket of this extension, for Playwright's socket routing.
 */
const EVENTS_SOCKET = new RegExp(`/${NAMESPACE}/events`);

test.use(labFixtures);

/**
 * Where the server keeps a contents-API path on disk.
 */
const onDisk = (apiPath: string): string =>
  path.join(__dirname, '..', ...apiPath.split('/'));

/**
 * The ids of the widgets currently in the main area, in tab order.
 */
const mainWidgetIds = (page: any): Promise<string[]> =>
  page.evaluate(() =>
    Array.from((window as any).jupyterapp.shell.widgets('main')).map(
      (widget: any) => widget.id
    )
  );

/**
 * Close one main-area widget by id and wait for it to be gone.
 */
async function closeWidget(page: any, id: string): Promise<void> {
  await page.evaluate((target: string) => {
    for (const widget of (window as any).jupyterapp.shell.widgets('main')) {
      if (widget.id === target) {
        widget.close();
      }
    }
  }, id);
  await expect
    .poll(async () => (await mainWidgetIds(page)).includes(id))
    .toBe(false);
}

test.describe('file events', () => {
  test.use({ mockSettings: settings({ pollInterval: 10 }) });

  test.beforeEach(async ({ page, tmpPath }) => {
    await page.contents.uploadContent(INITIAL, 'text', `${tmpPath}/${FILE}`);
    await openPreview(page, `${tmpPath}/${FILE}`);
  });

  test('shows a change within half a second of the write', async ({
    page,
    tmpPath
  }) => {
    // Timed inside the page: the clock starts before the write is sent and
    // the rendered text is sampled every 50 ms until the new paragraph is in
    // it. -1 means it never came.
    const elapsed = await page.evaluate(
      ([apiPath, text, needle]: [string, string, string]) =>
        new Promise<number>(resolve => {
          const contents = (window as any).jupyterapp.serviceManager.contents;
          const started = performance.now();
          void contents
            .save(apiPath, { content: text, format: 'text', type: 'file' })
            .then(() => {
              const timer = setInterval(() => {
                const at = performance.now() - started;
                const root = document.querySelector('.jp-RenderedMarkdown');
                if ((root?.textContent ?? '').includes(needle)) {
                  clearInterval(timer);
                  resolve(at);
                } else if (at > 5000) {
                  clearInterval(timer);
                  resolve(-1);
                }
              }, 50);
            });
        }),
      [`${tmpPath}/${FILE}`, REWRITTEN, THIRD]
    );
    expect(elapsed).toBeGreaterThanOrEqual(0);
    expect(elapsed).toBeLessThanOrEqual(500);
  });

  test('applies two writes fifty milliseconds apart as one change', async ({
    page,
    tmpPath
  }) => {
    const target = onDisk(`${tmpPath}/${FILE}`);
    const first = INITIAL.replace('apples', 'pears');
    // Every change this extension applies is one shared-model transaction
    // tagged with its origin; counting those counts the applies.
    await page.evaluate((origin: string) => {
      const w = window as any;
      const model = w.jupyterapp.shell.currentWidget.context.model;
      w.__applies = 0;
      model.sharedModel.ysource.observe((event: any) => {
        if (event.transaction.origin === origin) {
          w.__applies += 1;
        }
      });
    }, 'jupyterlab_advanced_markdown_viewer_extension');

    // Written from here rather than through the contents API: two saves put a
    // full HTTP round trip inside the gap, and on a loaded machine that pushes
    // the second write past the hundred milliseconds the criterion names, so
    // the test would fail on timing rather than on behaviour.
    fs.writeFileSync(target, first);
    await new Promise(resolve => setTimeout(resolve, 50));
    fs.writeFileSync(target, REWRITTEN);

    const rendered = page.locator('.jp-RenderedMarkdown');
    await expect(rendered).toContainText(THIRD, { timeout: 5000 });
    // Long enough for a second read and apply to have landed, had one run.
    await page.waitForTimeout(2000);
    expect(await page.evaluate(() => (window as any).__applies)).toBe(1);
    await expect(rendered).toContainText('oranges');
    await expect(rendered).not.toContainText('pears');
  });

  test('applies a write made by temporary file and rename', async ({
    page,
    tmpPath
  }) => {
    const target = onDisk(`${tmpPath}/${FILE}`);
    fs.writeFileSync(`${target}.tmp`, REWRITTEN);
    fs.renameSync(`${target}.tmp`, target);

    await expect(page.locator('.jp-RenderedMarkdown')).toContainText(THIRD, {
      timeout: 5000
    });
  });

  test('applies nothing for a touch or a rewrite with the same bytes', async ({
    page,
    tmpPath
  }) => {
    const target = `${tmpPath}/${FILE}`;
    const now = new Date();
    fs.utimesSync(onDisk(target), now, now);
    await page.contents.uploadContent(INITIAL, 'text', target);
    await page.waitForTimeout(2000);

    await expect(page.locator('.jp-AdvancedMd-decoration')).toHaveCount(0);
    await expect(
      page.locator('.lm-TabBar-tab.jp-AdvancedMd-tabUpdated')
    ).toHaveCount(0);

    // The channel is alive: a real change still lands.
    await page.contents.uploadContent(REWRITTEN, 'text', target);
    await expect(
      page.locator('.lm-TabBar-tab.jp-AdvancedMd-tabUpdated')
    ).toHaveCount(1, { timeout: 5000 });
  });

  test('marks a deleted file and applies it once it is recreated', async ({
    page,
    tmpPath
  }) => {
    const target = onDisk(`${tmpPath}/${FILE}`);
    fs.unlinkSync(target);

    // A file gone from disk carries its own marker: it asks the reader to
    // restore or close the file, not to save or revert the document, which is
    // what the held-change marker asks for.
    const blockedTab = page.locator('.lm-TabBar-tab.jp-AdvancedMd-tabMissing');
    await expect(blockedTab).toHaveCount(1, { timeout: 5000 });
    await expect(
      page.locator('.lm-TabBar-tab.jp-AdvancedMd-tabBlocked')
    ).toHaveCount(0);
    await expect(page.locator('.jp-RenderedMarkdown')).toContainText('apples');
    await expect(page.locator('.jp-Dialog')).toHaveCount(0);

    fs.writeFileSync(target, REWRITTEN);
    await expect(page.locator('.jp-RenderedMarkdown')).toContainText(THIRD, {
      timeout: 5000
    });
    await expect(blockedTab).toHaveCount(0);
  });

  test('keeps the watch while a second preview holds it, and asks for it back after both are closed', async ({
    page,
    tmpPath
  }) => {
    const target = `${tmpPath}/${FILE}`;
    const rendered = page.locator('.jp-RenderedMarkdown');
    const [first] = await mainWidgetIds(page);

    // A second view of the same document, which is what JupyterLab's own New
    // View for File command makes: a second preview sharing one file.
    await page.evaluate(() =>
      (window as any).jupyterapp.commands.execute('docmanager:clone')
    );
    await expect(rendered).toHaveCount(2);
    const clone = (await mainWidgetIds(page)).find(id => id !== first);
    expect(clone).toBeDefined();

    // The clone gives its registration back; the first preview still holds one,
    // so the server must keep watching.
    await closeWidget(page, clone as string);
    await expect(rendered).toHaveCount(1);
    await page.contents.uploadContent(REWRITTEN, 'text', target);
    await expect(rendered).toContainText(THIRD, { timeout: 5000 });

    // The last registration goes, so the server drops the watch. Opening the
    // file again has to ask for a new one.
    await closeWidget(page, first);
    await expect(rendered).toHaveCount(0);
    await openPreview(page, target, THIRD);
    await page.contents.uploadContent(EXTENDED, 'text', target);
    await expect(rendered).toContainText(FOURTH, { timeout: 5000 });
  });

  test('follows the document to its new path after a rename', async ({
    page,
    tmpPath
  }) => {
    const renamed = `${tmpPath}/renamed.md`;
    await page.evaluate(
      async ([from, to]: [string, string]) => {
        await (window as any).jupyterapp.serviceManager.contents.rename(
          from,
          to
        );
      },
      [`${tmpPath}/${FILE}`, renamed]
    );
    await expect
      .poll(async () =>
        page.evaluate(
          () => (window as any).jupyterapp.shell.currentWidget?.context?.path
        )
      )
      .toBe(renamed);

    await page.contents.uploadContent(REWRITTEN, 'text', renamed);
    await expect(page.locator('.jp-RenderedMarkdown')).toContainText(THIRD, {
      timeout: 5000
    });
    // The rename raises a removal of the old name, which may reach the browser
    // before the document knows its new path; the change under the new name
    // takes that report back. A removal is reported by the missing marker,
    // so that is the one this asserts against, and neither is left behind.
    await expect(
      page.locator('.lm-TabBar-tab.jp-AdvancedMd-tabMissing')
    ).toHaveCount(0);
    await expect(
      page.locator('.lm-TabBar-tab.jp-AdvancedMd-tabBlocked')
    ).toHaveCount(0);
  });
});

test.describe('ten quiet previews', () => {
  test.use({ mockSettings: settings({ pollInterval: 60 }) });

  test('share one connection and send no request while nothing changes', async ({
    page,
    tmpPath
  }) => {
    const sockets: string[] = [];
    page.on('websocket', (ws: any) => sockets.push(ws.url()));

    const paths = Array.from({ length: 10 }, (_, i) => `${tmpPath}/doc${i}.md`);
    for (const apiPath of paths) {
      await page.contents.uploadContent(INITIAL, 'text', apiPath);
    }
    for (const apiPath of paths) {
      await page.evaluate(async (target: string) => {
        await (window as any).jupyterapp.commands.execute('docmanager:open', {
          path: target,
          factory: 'Markdown Preview'
        });
      }, apiPath);
    }
    await expect(page.locator('.jp-RenderedMarkdown')).toHaveCount(10);
    // The channel opens on the first registration, stats every path once the
    // socket is up and reads each document once as it registers; all of that
    // is over well within this.
    await page.waitForTimeout(3000);

    const requests: string[] = [];
    page.on('request', (request: any) => requests.push(request.url()));
    await page.waitForTimeout(10000);

    const watched = new Set(paths.map(apiPath => `/api/contents/${apiPath}`));
    const offending = requests.filter(url => {
      const pathname = decodeURIComponent(new URL(url).pathname);
      return watched.has(pathname) || pathname.includes(`/${NAMESPACE}/`);
    });
    expect(offending).toEqual([]);
    expect(
      sockets.filter(url => url.includes(`/${NAMESPACE}/events`))
    ).toHaveLength(1);
  });
});

test.describe('a filesystem that raises no events', () => {
  test.use({ mockSettings: settings({ pollInterval: 3 }) });

  test('finds the change by the fallback and checks that path every second', async ({
    page,
    tmpPath
  }) => {
    const target = `${tmpPath}/${FILE}`;
    await page.contents.uploadContent(INITIAL, 'text', target);
    await openPreview(page, target);
    // The registration and the first batched check are the baseline the write
    // below is compared against.
    await page.waitForTimeout(1000);

    const stats: number[] = [];
    page.on('request', (request: any) => {
      if (request.url().includes(`/${NAMESPACE}/stat`)) {
        stats.push(Date.now());
      }
    });

    // A second name for the same file in the same directory. Writing through
    // it changes the very bytes the document holds while the file event names
    // the other entry, so the watch reports nothing and only the stat of the
    // document's own path moves: the silence a network or bind-mounted
    // filesystem produces, without needing one.
    const second = onDisk(`${tmpPath}/second-name.md`);
    fs.linkSync(onDisk(target), second);
    fs.writeFileSync(second, REWRITTEN);

    await expect(page.locator('.jp-RenderedMarkdown')).toContainText(THIRD, {
      timeout: 4500
    });

    // A change the check found that no event announced marks the path, one
    // second after the check, as one whose events do not arrive; from then on
    // it is checked every second. The batched poll alone would send at most
    // two requests in the four seconds counted below.
    await page.waitForTimeout(1500);
    const before = stats.length;
    await page.waitForTimeout(4000);
    expect(stats.length - before).toBeGreaterThanOrEqual(3);
  });
});

test.describe('a dropped event connection', () => {
  test.use({ mockSettings: settings({ pollInterval: 60 }) });

  test('applies a write made while the connection was down', async ({
    page,
    tmpPath
  }) => {
    const target = `${tmpPath}/${FILE}`;
    const routes: any[] = [];
    await page.routeWebSocket(EVENTS_SOCKET, (ws: any) => {
      ws.connectToServer();
      routes.push(ws);
    });
    // Socket routing is installed into a document as it loads, so the lab has
    // to be loaded again for it to see any of this.
    await page.reload();
    await page.contents.uploadContent(INITIAL, 'text', target);
    await openPreview(page, target);
    await expect.poll(() => routes.length).toBe(1);
    await page.waitForTimeout(1000);

    // The fallback interval is a minute, so nothing but the check the channel
    // makes when it has reconnected can find this write.
    await routes[0].close();
    await page.contents.uploadContent(REWRITTEN, 'text', target);

    await expect(page.locator('.jp-RenderedMarkdown')).toContainText(THIRD, {
      timeout: 15000
    });
    expect(routes.length).toBeGreaterThanOrEqual(2);
  });

  test('applies a write made while the connection was down after an earlier change', async ({
    page,
    tmpPath
  }) => {
    const target = `${tmpPath}/${FILE}`;
    const routes: any[] = [];
    await page.routeWebSocket(EVENTS_SOCKET, (ws: any) => {
      ws.connectToServer();
      routes.push(ws);
    });
    await page.reload();
    await page.contents.uploadContent(INITIAL, 'text', target);
    await openPreview(page, target);
    await expect.poll(() => routes.length).toBe(1);
    await page.waitForTimeout(1000);

    // One change carried by an event before the drop. What the channel learns
    // from an event holds only for the connection that carried it, so this
    // must not stop the check made after the reconnect from finding the write
    // below.
    await page.contents.uploadContent(REWRITTEN, 'text', target);
    await expect(page.locator('.jp-RenderedMarkdown')).toContainText(THIRD, {
      timeout: 15000
    });

    await routes[0].close();
    await page.contents.uploadContent(EXTENDED, 'text', target);
    // The write has to be inside the gap for this test to say anything: a
    // socket already back up would have carried an event for it, and the
    // check the channel makes on reconnect - the thing under test - would
    // never be reached. A second route by now means the reconnect won the
    // race, and the test fails rather than passing for the wrong reason. The
    // margin is the one-second reconnect floor against one contents-API
    // request.
    expect(routes.length).toBe(1);

    await expect(page.locator('.jp-RenderedMarkdown')).toContainText(FOURTH, {
      timeout: 15000
    });
    expect(routes.length).toBeGreaterThanOrEqual(2);
  });
});

test.describe('the server extension absent', () => {
  test.use({ mockSettings: settings({ pollInterval: 3 }) });

  test('warns once and keeps the preview current through the contents API', async ({
    page,
    tmpPath
  }) => {
    const target = `${tmpPath}/${FILE}`;
    const warnings: string[] = [];
    page.on('console', (message: any) => {
      if (
        message.type() === 'warning' &&
        message.text().includes(WARNING_PREFIX)
      ) {
        warnings.push(message.text());
      }
    });
    // Every route of the server extension answers 404, which is what a lab
    // without it answers: the batched stat route belongs to the same
    // extension as the status route, so both are gone together.
    await page.route(`**/${NAMESPACE}/**`, (route: any) =>
      route.fulfill({
        status: 404,
        contentType: 'text/plain',
        body: 'not found'
      })
    );
    await page.contents.uploadContent(INITIAL, 'text', target);
    await openPreview(page, target);
    await page.waitForTimeout(1000);

    await page.contents.uploadContent(REWRITTEN, 'text', target);
    await expect(page.locator('.jp-RenderedMarkdown')).toContainText(THIRD, {
      timeout: 6000
    });
    expect(warnings).toHaveLength(1);
  });
});
