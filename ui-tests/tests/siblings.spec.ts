import { expect, test } from '@jupyterlab/galata';
import * as fs from 'fs';

import {
  FILE,
  INITIAL,
  labFixtures,
  openPreview,
  settings,
  typeInEditor
} from './helpers';

/**
 * Integration tests against the sibling Markdown extensions of this lab.
 *
 * The lab these tests run in has the whole family installed - the GitHub
 * alerts renderer, the colourful tabs, the table-of-contents fix, the
 * switch-tab scrolling fix, edit at content - so these are the siblings
 * themselves rather than a stand-in for them. Only the motion of the
 * table-of-contents fix is stood in for, and for the reason the live-view
 * suite already gives: its trigger is the URL hash, which this lab rewrites
 * within seconds of opening.
 */

test.use(labFixtures);

/**
 * A document whose middle block is a GitHub alert, long enough to scroll.
 */
const ALERT = [
  '# Report',
  '',
  '> [!NOTE]',
  '> The note says apples.',
  '',
  ...Array.from(
    { length: 60 },
    (_, i) =>
      `Paragraph ${i + 1} of the report, written to make the view scroll.\n`
  )
].join('\n');

/**
 * The same document with the sentence inside the alert rewritten and a
 * paragraph added after it.
 */
const ALERT_REWRITTEN = ALERT.replace(
  '> The note says apples.\n',
  '> The note says oranges.\n>\n> A second line joined the note.\n'
);

/**
 * Record every source the Markdown parser is asked to render from now on.
 *
 * The alerts sibling works by wrapping that parser, so a change that does not
 * pass through it cannot come out as an alert; counting what the parser was
 * given is what says which path a change took.
 */
async function watchParser(page: any): Promise<void> {
  await page.evaluate(() => {
    const w = window as any;
    const parser =
      w.jupyterapp.shell.currentWidget.content.renderer.markdownParser;
    w.__sources = [];
    const original = parser.render.bind(parser);
    parser.render = (source: string) => {
      w.__sources.push(source);
      return original(source);
    };
  });
}

const parsedSources = (page: any): Promise<string[]> =>
  page.evaluate(() => (window as any).__sources as string[]);

const previewScrollTop = (page: any): Promise<number> =>
  page.evaluate(
    () => document.querySelector('.jp-RenderedMarkdown')?.scrollTop ?? -1
  );

test.describe('the GitHub alerts sibling', () => {
  test.use({ mockSettings: settings() });

  test('renders a changed alert block through the Markdown parser again', async ({
    page,
    tmpPath
  }) => {
    const path = `${tmpPath}/${FILE}`;
    await page.contents.uploadContent(ALERT, 'text', path);
    await openPreview(page, path, 'The note says apples.');

    const alert = page.locator('.jp-RenderedMarkdown .markdown-alert');
    await expect(alert).toHaveCount(1);
    await watchParser(page);

    await page.contents.uploadContent(ALERT_REWRITTEN, 'text', path);
    await expect(page.locator('.jp-RenderedMarkdown')).toContainText(
      'A second line joined the note.',
      { timeout: 20000 }
    );
    // Both renders of the change are over.
    await page.waitForTimeout(2000);

    // The alert is still an alert, and the change is inside it. The whole
    // sentence is not asserted against: the struck-out word the change
    // replaced stands beside the new one for the length of the fade.
    await expect(alert).toHaveCount(1);
    await expect(alert).toContainText('oranges');
    await expect(alert).toContainText('A second line joined the note.');
    await expect(alert.locator('.markdown-alert-title')).toContainText('Note');
    await expect(
      page.locator('.markdown-alert .jp-AdvancedMd-added').first()
    ).toBeVisible();

    // No render path bypasses the parser: the new text reached it, which is
    // the only way the sibling that wraps it can see a change at all.
    const sources = await parsedSources(page);
    expect(
      sources.filter(source => source.includes('The note says oranges.')).length
    ).toBeGreaterThan(0);
    expect(
      sources.filter(source => source.includes('The note says apples.')).length
    ).toBe(0);
  });
});

test.describe('the colourful tab sibling', () => {
  test.use({ mockSettings: settings() });

  test('keeps the colour it gave the tab while the marker shows', async ({
    page,
    tmpPath
  }) => {
    const path = `${tmpPath}/${FILE}`;
    await page.contents.uploadContent(INITIAL, 'text', path);
    await openPreview(page, path);

    // The sibling colours the tab the reader right-clicked, so the right-click
    // is what tells it which tab this is.
    const tab = page.locator('#jp-main-dock-panel .lm-TabBar-tab').first();
    await tab.click({ button: 'right' });
    await page.keyboard.press('Escape');
    await page.evaluate(async () => {
      await (window as any).jupyterapp.commands.execute(
        'colourful-tab:set-mint'
      );
    });
    const coloured = await tab.evaluate(
      (element: Element) => getComputedStyle(element).backgroundColor
    );
    expect(await tab.getAttribute('class')).toContain('jp-colourful-tab-mint');

    await page.contents.uploadContent(
      INITIAL.replace('apples', 'oranges'),
      'text',
      path
    );
    await expect(
      page.locator('.lm-TabBar-tab.jp-AdvancedMd-tabUpdated')
    ).toHaveCount(1, { timeout: 20000 });
    // Past the tab rebuild the marker causes, so what is read is the state
    // the two extensions settle on rather than a moment inside it.
    await page.waitForTimeout(1500);

    // The colour is still the sibling's, and the marker is on the same tab.
    expect(await tab.getAttribute('class')).toContain('jp-colourful-tab-mint');
    expect(
      await tab.evaluate(
        (element: Element) => getComputedStyle(element).backgroundColor
      )
    ).toBe(coloured);
    expect(await tab.getAttribute('class')).toContain(
      'jp-AdvancedMd-tabUpdated'
    );
    const marker = await tab.evaluate((element: Element) => {
      const label = element.querySelector('.lm-TabBar-tabLabel');
      return getComputedStyle(label as Element, '::before').content;
    });
    expect(marker).toBe('"◐"');
  });
});

test.describe('the forced render', () => {
  test.use({ mockSettings: settings() });

  test('runs every listener twice for one change without a sibling misbehaving', async ({
    page,
    tmpPath
  }) => {
    const path = `${tmpPath}/${FILE}`;
    await page.contents.uploadContent(ALERT, 'text', path);
    await openPreview(page, path, 'The note says apples.');

    const failures: string[] = [];
    page.on('pageerror', (error: Error) => failures.push(String(error)));

    // Two listeners on the rendered signal: a plain counter, and the motion
    // of the table-of-contents fix, which scrolls to the heading in the URL
    // hash 100 ms after every render. The second render must not take the
    // reader back to the anchor they scrolled away from.
    await page.evaluate(() => {
      const w = window as any;
      const content = w.jupyterapp.shell.currentWidget.content;
      w.__renders = 0;
      w.__anchorScrolls = 0;
      content.rendered.connect(() => {
        w.__renders += 1;
        setTimeout(() => {
          const root = document.querySelector('.jp-RenderedMarkdown');
          // By tag, not by id: the headings this lab renders carry no id, so
          // a lookup by anchor name finds nothing and the stand-in would sit
          // still while claiming to have scrolled.
          const heading = root?.querySelector('h1') as HTMLElement | null;
          if (root && heading) {
            w.__anchorScrolls += 1;
            root.scrollTo({ top: heading.offsetTop, behavior: 'smooth' });
          }
        }, 100);
      });
    });

    await page.locator('.jp-RenderedMarkdown').hover();
    await page.mouse.wheel(0, 2000);
    await expect.poll(() => previewScrollTop(page)).toBeGreaterThan(500);
    const before = await previewScrollTop(page);
    // Past the window in which the switch-tab scrolling fix owns the position.
    await page.waitForTimeout(3500);
    const renders = await page.evaluate(() => (window as any).__renders);

    await page.contents.uploadContent(ALERT_REWRITTEN, 'text', path);
    await expect(page.locator('.jp-RenderedMarkdown')).toContainText(
      'A second line joined the note.',
      { timeout: 20000 }
    );
    // Long enough for the viewer's own render, about a second behind the
    // forced one, and for the anchor scroll that follows it.
    await page.waitForTimeout(2500);

    // One change, two renders: the forced one that puts it on screen at once
    // and the viewer's own that follows.
    expect(await page.evaluate(() => (window as any).__renders)).toBe(
      renders + 2
    );
    // The stand-in found its heading and scrolled to the anchor after each of
    // them: the counter counts scrolls made, not callbacks run.
    expect(await page.evaluate(() => (window as any).__anchorScrolls)).toBe(
      renders + 2
    );
    // Neither render moved the reader.
    expect(Math.abs((await previewScrollTop(page)) - before)).toBeLessThan(50);
    // The alerts sibling rebuilt its markup on both renders rather than
    // losing it on the second.
    await expect(page.locator('.markdown-alert')).toHaveCount(1);
    await expect(page.locator('.markdown-alert')).toContainText('oranges');
    // Nothing threw while the two renders ran.
    expect(failures).toEqual([]);
  });
});

/**
 * The document widget of the tab in front, and what it says about itself.
 */
const currentWidgetState = (
  page: any
): Promise<{
  scrollTop: number;
  guarded: boolean;
  dirty: boolean;
}> =>
  page.evaluate(() => {
    const widget = (window as any).jupyterapp.shell.currentWidget;
    const root = widget.node.querySelector('.jp-RenderedMarkdown');
    return {
      scrollTop: root ? root.scrollTop : -1,
      guarded: widget.node.hasAttribute('data-jp-scroll-guard'),
      dirty: Boolean(widget.context?.model?.dirty)
    };
  });

/**
 * Bring an already open document to the front by clicking its tab, which is
 * the activation the switch-tab scrolling fix listens for.
 */
async function activateTab(page: any, label: string): Promise<void> {
  await page
    .locator(`#jp-main-dock-panel .lm-TabBar-tab:has-text("${label}")`)
    .first()
    .click();
  await expect(
    page.locator('.jp-RenderedMarkdown:visible').first()
  ).toBeVisible();
}

test.describe('the refresh view sibling', () => {
  test.use({ mockSettings: settings() });

  const UNSAVED = 'A sentence nobody saved.';

  test('asks before it discards unsaved edits, and reverts only when told to', async ({
    page,
    tmpPath
  }) => {
    const path = `${tmpPath}/${FILE}`;
    await page.contents.uploadContent(INITIAL, 'text', path);
    await typeInEditor(page, path, `\n${UNSAVED}\n`);
    const editor = page.locator('.jp-FileEditor .cm-content');
    await expect(editor).toContainText(UNSAVED);
    expect((await currentWidgetState(page)).dirty).toBe(true);

    // The command is not awaited: it does not settle until the dialog does.
    const refresh = () =>
      page.evaluate(() => {
        const w = window as any;
        w.__refresh = w.jupyterapp.commands.execute(
          'jupyterlab_refresh_view:refresh'
        );
      });
    const dialog = page.locator('.jp-Dialog');

    await refresh();
    await expect(dialog).toContainText('Discard unsaved changes?');
    await expect(dialog).toContainText(`${FILE} has unsaved changes.`);
    await dialog.locator('button:has-text("Cancel")').click();
    await expect(dialog).toHaveCount(0);
    await page.evaluate(() => (window as any).__refresh);

    // Cancelled: the edits are still there and still unsaved.
    await expect(editor).toContainText(UNSAVED);
    expect((await currentWidgetState(page)).dirty).toBe(true);

    // Accepted: the revert happens, which is the command's own work.
    await refresh();
    await expect(dialog).toContainText('Discard unsaved changes?');
    await dialog.locator('button:has-text("Discard")').click();
    await expect(dialog).toHaveCount(0);
    await page.evaluate(() => (window as any).__refresh);
    await expect(editor).not.toContainText(UNSAVED);
    await expect(editor).toContainText('The second paragraph mentions apples.');
    // JupyterLab's own revert leaves the flag set once the content changed;
    // the sibling clears it, because the document now equals the file. So a
    // second Refresh has nothing to ask about and reverts at once.
    expect((await currentWidgetState(page)).dirty).toBe(false);
    await refresh();
    await page.evaluate(() => (window as any).__refresh);
    await expect(dialog).toHaveCount(0);
    expect((await currentWidgetState(page)).dirty).toBe(false);
  });
});

test.describe('the export sibling', () => {
  test.use({ mockSettings: settings() });

  const UNSAVED = 'A sentence nobody saved.';

  /**
   * Ask the export server extension for the HTML of a path directly, which is
   * the request the sibling makes. The server reads the file from disk, so
   * what comes back is what is on disk at that moment and nothing else.
   */
  const exportedFromDisk = (page: any, target: string): Promise<string> =>
    page.evaluate(async (apiPath: string) => {
      const base = (window as any).jupyterapp.serviceManager.serverSettings
        .baseUrl;
      const response = await fetch(
        `${base}jupyterlab-export-markdown-extension/export/html`,
        {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ path: apiPath })
        }
      );
      return response.text();
    }, target);

  /**
   * The bytes on disk and the time they were written, through the contents
   * API the export server reads the same file from.
   */
  const fileState = (
    page: any,
    target: string
  ): Promise<{ content: string; lastModified: string }> =>
    page.evaluate(async (apiPath: string) => {
      const base = (window as any).jupyterapp.serviceManager.serverSettings
        .baseUrl;
      // type and format are named because jupytext is installed here: asked
      // for a .md file without them, the contents API returns a notebook.
      const response = await fetch(
        `${base}api/contents/${apiPath}?type=file&format=text&content=1`,
        { credentials: 'same-origin' }
      );
      const model = await response.json();
      return { content: model.content, lastModified: model.last_modified };
    }, target);

  /**
   * Run one export command and hand back what the browser was given to save.
   */
  const exportHtml = async (page: any): Promise<string> => {
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.evaluate(async () => {
        await (window as any).jupyterapp.commands.execute(
          'export-markdown:html'
        );
      })
    ]);
    return fs.readFileSync(await download.path(), 'utf8');
  };

  test('saves a dirty document so the export carries the text on screen', async ({
    page,
    tmpPath
  }) => {
    const path = `${tmpPath}/${FILE}`;
    await page.contents.uploadContent(INITIAL, 'text', path);
    await typeInEditor(page, path, `\n${UNSAVED}\n`);
    await expect(page.locator('.jp-FileEditor .cm-content')).toContainText(
      UNSAVED
    );
    expect((await currentWidgetState(page)).dirty).toBe(true);

    // What the export would carry without the save: the server reads the
    // file, and the file is still the text before the typing.
    const stale = await exportedFromDisk(page, path);
    expect(stale).toContain('The second paragraph mentions apples.');
    expect(stale).not.toContain(UNSAVED);

    const exported = await exportHtml(page);
    expect(exported).toContain(UNSAVED);
    expect(exported).toContain('The second paragraph mentions apples.');

    // The save the export made is a real save: the document is clean and the
    // file holds the typed text.
    expect((await currentWidgetState(page)).dirty).toBe(false);
    const saved = await fileState(page, path);
    expect(saved.content).toContain(UNSAVED);

    // A clean document is exported as it is, with no extra write: the file is
    // untouched by the second export.
    const secondExport = await exportHtml(page);
    expect(secondExport).toContain(UNSAVED);
    const after = await fileState(page, path);
    expect(after.lastModified).toBe(saved.lastModified);
    expect((await currentWidgetState(page)).dirty).toBe(false);
  });

  test('asks about a file changed on disk before any spinner, and exports nothing when that save is cancelled', async ({
    page,
    tmpPath
  }) => {
    const path = `${tmpPath}/${FILE}`;
    await page.contents.uploadContent(INITIAL, 'text', path);
    await typeInEditor(page, path, `\n${UNSAVED}\n`);
    expect((await currentWidgetState(page)).dirty).toBe(true);
    // The file moves on disk while the edits are unsaved. The viewer holds
    // that change back, so the document's record of the file is now stale
    // and the save the export makes first raises JupyterLab's own dialog.
    await page.contents.uploadContent(
      `${INITIAL}\nRewritten outside the lab.\n`,
      'text',
      path
    );
    await page.waitForTimeout(1500);

    const exports: string[] = [];
    page.on('request', (request: any) => {
      if (request.url().includes('jupyterlab-export-markdown-extension/')) {
        exports.push(request.url());
      }
    });
    const run = () =>
      page.evaluate(() => {
        const w = window as any;
        w.__export = w.jupyterapp.commands.execute('export-markdown:html');
      });
    const dialog = page.locator('.jp-Dialog');

    await run();
    // One dialog, the save's own, and no spinner queued behind it.
    await expect(dialog).toHaveCount(1);
    await expect(dialog).toContainText('File Changed');
    await expect(
      page.locator('.jp-Dialog', { hasText: 'Exporting' })
    ).toHaveCount(0);
    await dialog.locator('button:has-text("Cancel")').click();
    await page.evaluate(() => (window as any).__export);
    // A cancel the user chose ends the command quietly: no error, no export.
    await expect(dialog).toHaveCount(0);
    expect(exports).toEqual([]);
    expect((await currentWidgetState(page)).dirty).toBe(true);

    // Overwrite: the save lands, then the export carries the typed text.
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      (async () => {
        await run();
        await dialog.locator('button:has-text("Overwrite")').click();
        await page.evaluate(() => (window as any).__export);
      })()
    ]);
    expect(fs.readFileSync(await download.path(), 'utf8')).toContain(UNSAVED);
    expect((await currentWidgetState(page)).dirty).toBe(false);
  });
});

test.describe('the switch-tab scrolling fix sibling', () => {
  test.use({ mockSettings: settings() });

  /**
   * A 600 by 180 pixel block of colour. That sibling guards a document only
   * when the rendered view holds an image, because images are what move the
   * text under the reader while they load.
   */
  const PICTURE =
    'iVBORw0KGgoAAAANSUhEUgAAAlgAAAC0CAIAAADHHcVbAAACwklEQVR4nO3VQQEAEADAQIQTQhLxxfDYXYL9Nve5AwCq1u8AAPjJCAFIM0IA0owQgDQjBCDNCAFIM0IA0owQgDQjBCDNCAFIM0IA0owQgDQjBCDNCAFIM0IA0owQgDQjBCDNCAFIM0IA0owQgDQjBCDNCAFIM0IA0owQgDQjBCDNCAFIM0IA0owQgDQjBCDNCAFIM0IA0owQgDQjBCDNCAFIM0IA0owQgDQjBCDNCAFIM0IA0owQgDQjBCDNCAFIM0IA0owQgDQjBCDNCAFIM0IA0owQgDQjBCDNCAFIM0IA0owQgDQjBCDNCAFIM0IA0owQgDQjBCDNCAFIM0IA0owQgDQjBCDNCAFIM0IA0owQgDQjBCDNCAFIM0IA0owQgDQjBCDNCAFIM0IA0owQgDQjBCDNCAFIM0IA0owQgDQjBCDNCAFIM0IA0owQgDQjBCDNCAFIM0IA0owQgDQjBCDNCAFIM0IA0owQgDQjBCDNCAFIM0IA0owQgDQjBCDNCAFIM0IA0owQgDQjBCDNCAFIM0IA0owQgDQjBCDNCAFIM0IA0owQgDQjBCDNCAFIM0IA0owQgDQjBCDNCAFIM0IA0owQgDQjBCDNCAFIM0IA0owQgDQjBCDNCAFIM0IA0owQgDQjBCDNCAFIM0IA0owQgDQjBCDNCAFIM0IA0owQgDQjBCDNCAFIM0IA0owQgDQjBCDNCAFIM0IA0owQgDQjBCDNCAFIM0IA0owQgDQjBCDNCAFIM0IA0owQgDQjBCDNCAFIM0IA0owQgDQjBCDNCAFIM0IA0owQgDQjBCDNCAFIM0IA0owQgDQjBCDNCAFIM0IA0h7kegKAjN8fnQAAAABJRU5ErkJggg==';

  /**
   * A document that opens with a picture and runs long enough to scroll.
   */
  const IMAGED = [
    '# Report',
    '',
    '![A picture](picture.png)',
    '',
    ...Array.from(
      { length: 60 },
      (_, i) => `Paragraph ${i + 1} of the report, written to make it scroll.\n`
    )
  ].join('\n');

  const FIRST_MARKER = 'The first change arrived.';
  const SECOND_MARKER = 'The second change arrived.';

  interface ISample {
    t: number;
    top: number;
    guarded: boolean;
    changed: boolean;
  }

  /**
   * Sample the scroll position of one document, whether the sibling is
   * holding it, and whether a change has reached the screen. The document is
   * found by its path rather than by which tab is in front, so sampling can
   * start before the tab it watches is activated.
   */
  async function startSampling(
    page: any,
    apiPath: string,
    marker: string
  ): Promise<void> {
    await page.evaluate(
      ([target, needle]: string[]) => {
        const w = window as any;
        const widget = Array.from(w.jupyterapp.shell.widgets('main')).find(
          (candidate: any) => candidate.context?.path === target
        ) as any;
        const root = widget.node.querySelector('.jp-RenderedMarkdown');
        const started = Date.now();
        w.__samples = [];
        w.__sampler = window.setInterval(() => {
          w.__samples.push({
            t: Date.now() - started,
            top: root.scrollTop,
            guarded: widget.node.hasAttribute('data-jp-scroll-guard'),
            changed: (root.textContent || '').includes(needle)
          });
        }, 50);
      },
      [apiPath, marker]
    );
  }

  const stopSampling = (page: any): Promise<ISample[]> =>
    page.evaluate(() => {
      const w = window as any;
      window.clearInterval(w.__sampler);
      return w.__samples as ISample[];
    });

  /**
   * The bundle path every script of this extension is served from, which is
   * what a stack trace names when one of its functions made the call.
   */
  const VIEWER_BUNDLE = 'jupyterlab_advanced_markdown_viewer_extension';

  interface IScrollWrite {
    t: number;
    value: number;
    guarded: boolean;
    viewer: boolean;
  }

  /**
   * Record every write to the scroll position of one document: what was
   * written, whether the sibling was holding at the time, and whether this
   * extension made it.
   *
   * The position alone cannot say whether this extension yielded to the
   * guard, because its own restore target is the position the sibling holds:
   * a viewer that ignored the guard would put the reader back exactly where
   * the sibling wants them. What differs is whether it writes at all, and the
   * stack of the write names the bundle the call came from.
   */
  async function startWriteWatch(page: any, apiPath: string): Promise<void> {
    await page.evaluate(
      ([target, bundle]: string[]) => {
        const w = window as any;
        const widget = Array.from(w.jupyterapp.shell.widgets('main')).find(
          (candidate: any) => candidate.context?.path === target
        ) as any;
        const root = widget.node.querySelector('.jp-RenderedMarkdown');
        const property = Object.getOwnPropertyDescriptor(
          Element.prototype,
          'scrollTop'
        ) as PropertyDescriptor;
        const started = Date.now();
        w.__writes = [];
        Object.defineProperty(root, 'scrollTop', {
          configurable: true,
          get() {
            return (property.get as () => number).call(this);
          },
          set(value: number) {
            w.__writes.push({
              t: Date.now() - started,
              value,
              guarded: widget.node.hasAttribute('data-jp-scroll-guard'),
              viewer: String(new Error().stack).includes(bundle)
            });
            (property.set as (to: number) => void).call(this, value);
          }
        });
      },
      [apiPath, VIEWER_BUNDLE]
    );
  }

  const scrollWrites = (page: any): Promise<IScrollWrite[]> =>
    page.evaluate(() => (window as any).__writes as IScrollWrite[]);

  /**
   * How long the anchor stand-in below keeps the position it scrolled to,
   * which is about as long as a smooth anchor scroll of that distance runs.
   */
  const ANCHOR_HOLD_MS = 300;

  /**
   * Stand in for the table-of-contents fix, holding the anchor rather than
   * scrolling to it once: scroll to the heading 100 ms after every render and
   * put the position back on the heading for the next 300 ms whenever the
   * sibling guard takes it away.
   *
   * The hold is what gives this extension something to correct - while the
   * anchor is held, a restore of the reader's own position is a write this
   * extension has to make itself, rather than a write nobody can tell from
   * the sibling's. It ends with the guard so the sibling gets its position
   * back and its own release is not held up.
   */
  async function holdAnchorAfterRender(page: any): Promise<void> {
    await page.evaluate((holdMs: number) => {
      const w = window as any;
      const widget = w.jupyterapp.shell.currentWidget;
      const root = widget.node.querySelector('.jp-RenderedMarkdown');
      const anchor = () => (root.querySelector('h1') as HTMLElement).offsetTop;
      let heldUntil = 0;
      root.addEventListener('scroll', () => {
        if (
          Date.now() < heldUntil &&
          widget.node.hasAttribute('data-jp-scroll-guard') &&
          root.scrollTop !== anchor()
        ) {
          root.scrollTop = anchor();
        }
      });
      widget.content.rendered.connect(() => {
        window.setTimeout(() => {
          heldUntil = Date.now() + holdMs;
          root.scrollTop = anchor();
        }, 100);
      });
    }, ANCHOR_HOLD_MS);
  }

  /**
   * The longest unbroken run of samples away from one position, in samples.
   */
  function longestDeviation(samples: ISample[], top: number): number {
    let longest = 0;
    let run = 0;
    for (const sample of samples) {
      run = Math.abs(sample.top - top) > 5 ? run + 1 : 0;
      longest = Math.max(longest, run);
    }
    return longest;
  }

  /**
   * Open the imaged document beside a second one and park the reader in the
   * middle of it, handing back its path and the position they are parked at.
   *
   * The wheel releases the guard belonging to this activation and the wait
   * outruns the three seconds it may hold for, so what follows starts from a
   * document nobody is holding.
   */
  async function openAndPark(
    page: any,
    tmpPath: string
  ): Promise<{ path: string; parked: number }> {
    const path = `${tmpPath}/${FILE}`;
    await page.contents.uploadContent(
      PICTURE,
      'base64',
      `${tmpPath}/picture.png`
    );
    await page.contents.uploadContent(IMAGED, 'text', path);
    await page.contents.uploadContent(INITIAL, 'text', `${tmpPath}/other.md`);
    await openPreview(page, path, 'Paragraph 1 of the report');
    await openPreview(page, `${tmpPath}/other.md`);
    await activateTab(page, FILE);

    await page.locator('.jp-RenderedMarkdown:visible').hover();
    await page.mouse.wheel(0, 1000);
    await expect
      .poll(async () => (await currentWidgetState(page)).scrollTop)
      .toBeGreaterThan(500);
    await page.waitForTimeout(3500);
    return { path, parked: (await currentWidgetState(page)).scrollTop };
  }

  /**
   * Take the switch-tab scrolling fix out of the lab: its bundle is refused,
   * so JupyterLab starts without that plugin and nothing marks a widget.
   */
  async function withoutSibling(page: any): Promise<void> {
    await page.route(
      /jupyterlab_markdown_switch_tab_scrolling_fix\/static\/.*\.js/,
      (route: any) => route.abort()
    );
    await page.reload();
    await page.locator('#jupyterlab-splash').waitFor({ state: 'detached' });
    await page.locator('#main').waitFor();
  }

  test('DEF-COMPAT-43 restores the scroll of an unguarded image document however recently its tab came to the front', async ({
    page,
    tmpPath
  }) => {
    await withoutSibling(page);
    const path = `${tmpPath}/${FILE}`;
    await page.contents.uploadContent(
      PICTURE,
      'base64',
      `${tmpPath}/picture.png`
    );
    await page.contents.uploadContent(IMAGED, 'text', path);
    await page.contents.uploadContent(INITIAL, 'text', `${tmpPath}/other.md`);
    await openPreview(page, path, 'Paragraph 1 of the report');
    await openPreview(page, `${tmpPath}/other.md`);
    await activateTab(page, FILE);
    await page.locator('.jp-RenderedMarkdown:visible').hover();
    await page.mouse.wheel(0, 1000);
    await expect
      .poll(async () => (await currentWidgetState(page)).scrollTop)
      .toBeGreaterThan(500);
    await page.waitForTimeout(3500);
    const parked = (await currentWidgetState(page)).scrollTop;

    // Back to the tab and a change straight after it. Nobody holds the
    // position: the render reloads the picture and the text collapses under
    // the reader for a moment, and the viewer must put them back rather
    // than stand aside on a timer because the tab just came to the front.
    await activateTab(page, 'other.md');
    await activateTab(page, FILE);
    expect((await currentWidgetState(page)).guarded).toBe(false);
    await page.contents.uploadContent(
      `${IMAGED}\n${FIRST_MARKER}\n`,
      'text',
      path
    );
    await expect(page.locator('.jp-RenderedMarkdown:visible')).toContainText(
      FIRST_MARKER,
      { timeout: 20000 }
    );
    await expect
      .poll(async () => (await currentWidgetState(page)).scrollTop, {
        timeout: 3000
      })
      .toBe(parked);
    // And it stays there once the viewer's own render has run as well.
    await page.waitForTimeout(2500);
    expect((await currentWidgetState(page)).scrollTop).toBe(parked);
  });

  test('holds its scroll restore exactly as long as the sibling guard holds', async ({
    page,
    tmpPath
  }) => {
    const { path, parked } = await openAndPark(page, tmpPath);

    // A change that arrives while the guard is holding the position.
    await startSampling(page, path, FIRST_MARKER);
    await activateTab(page, 'other.md');
    await activateTab(page, FILE);
    expect((await currentWidgetState(page)).guarded).toBe(true);
    await page.contents.uploadContent(
      `${IMAGED}\n${FIRST_MARKER}\n`,
      'text',
      path
    );
    await expect(page.locator('.jp-RenderedMarkdown:visible')).toContainText(
      FIRST_MARKER,
      { timeout: 20000 }
    );
    // Long enough for the viewer's own render, about a second behind the
    // forced one, and for anything either extension does after it.
    await page.waitForTimeout(2500);
    const held = await stopSampling(page);

    // The change did arrive while the sibling was holding the position, which
    // is what the rest of this reads against.
    const arrived = held.find(sample => sample.changed);
    expect(arrived).toBeDefined();
    expect(arrived?.guarded).toBe(true);
    // One position throughout: the render moves it for a moment and the guard
    // puts it back within its own 100 ms tick, and it ends where it began.
    expect(longestDeviation(held, parked)).toBeLessThanOrEqual(5);
    expect(held[held.length - 1].top).toBe(parked);

    // The table-of-contents fix scrolls to the heading in the URL hash after
    // every render. It is stood in for here, for the reason this suite gives
    // above, and it is what makes the viewer's own scroll restore visible:
    // whoever moves last decides where the reader ends up.
    await page.evaluate(() => {
      const w = window as any;
      const content = w.jupyterapp.shell.currentWidget.content;
      content.rendered.connect(() => {
        setTimeout(() => {
          const root = w.jupyterapp.shell.currentWidget.node.querySelector(
            '.jp-RenderedMarkdown'
          );
          const heading = root?.querySelector('h1');
          if (root && heading) {
            root.scrollTop = heading.offsetTop;
          }
        }, 100);
      });
    });

    // A change that arrives after the guard let go, still inside the three
    // seconds it may hold for.
    await startSampling(page, path, SECOND_MARKER);
    await activateTab(page, 'other.md');
    await activateTab(page, FILE);
    expect((await currentWidgetState(page)).guarded).toBe(true);
    await expect
      .poll(async () => (await currentWidgetState(page)).guarded, {
        timeout: 5000
      })
      .toBe(false);
    const before = (await currentWidgetState(page)).scrollTop;
    expect(before).toBe(parked);
    await page.contents.uploadContent(
      `${IMAGED}\n${SECOND_MARKER}\n`,
      'text',
      path
    );
    await expect(page.locator('.jp-RenderedMarkdown:visible')).toContainText(
      SECOND_MARKER,
      { timeout: 20000 }
    );
    await page.waitForTimeout(2500);
    const released = await stopSampling(page);

    const activated = released.find(sample => sample.guarded);
    const changed = released.find(sample => sample.changed);
    expect(activated).toBeDefined();
    expect(changed).toBeDefined();
    // The guard let go before the change, and the change landed soon after
    // the activation: inside the window a viewer that waited out a tab
    // activation on its own would still have sat out, which is what tells
    // this viewer from one.
    const lastGuarded = released.filter(sample => sample.guarded).pop();
    expect(lastGuarded!.t).toBeLessThan(changed!.t);
    expect(changed!.t - activated!.t).toBeLessThan(3000);
    // With the guard gone the viewer restores again, so the reader is put
    // back where they were rather than left at the heading.
    expect(released[released.length - 1].top).toBe(parked);
  });

  test('writes no scroll position of its own while the sibling guard holds', async ({
    page,
    tmpPath
  }) => {
    const { path, parked } = await openAndPark(page, tmpPath);

    // With the anchor held for as long as the guard holds, the position the
    // viewer would restore to is not the position on screen, so a restore it
    // made during the guard would be a write of its own rather than a write
    // nobody can tell from the sibling's.
    await holdAnchorAfterRender(page);
    await startWriteWatch(page, path);
    await startSampling(page, path, FIRST_MARKER);
    await activateTab(page, 'other.md');
    await activateTab(page, FILE);
    expect((await currentWidgetState(page)).guarded).toBe(true);
    await page.contents.uploadContent(
      `${IMAGED}\n${FIRST_MARKER}\n`,
      'text',
      path
    );
    await expect(page.locator('.jp-RenderedMarkdown:visible')).toContainText(
      FIRST_MARKER,
      { timeout: 20000 }
    );
    // Long enough for the viewer's own render, about a second behind the
    // forced one, and for the anchor scroll and the restore that follow it.
    await page.waitForTimeout(2500);
    const samples = await stopSampling(page);
    const writes = await scrollWrites(page);

    // The change did arrive while the sibling was holding the position, which
    // is what the rest of this reads against.
    const arrived = samples.find(sample => sample.changed);
    expect(arrived).toBeDefined();
    expect(arrived?.guarded).toBe(true);
    // The sibling and the anchor both wrote inside that window, so the watch
    // was live and the window was not empty.
    expect(writes.filter(write => write.guarded).length).toBeGreaterThan(0);
    // This extension wrote nothing in it.
    expect(writes.filter(write => write.viewer && write.guarded)).toEqual([]);
    // Once the guard let go it put the reader back over an anchor scroll
    // nobody holds any more, which is what says a write of its own is visible
    // to the watch at all.
    const restored = writes.filter(write => write.viewer && !write.guarded);
    expect(restored.length).toBeGreaterThan(0);
    expect(restored[restored.length - 1].value).toBe(parked);
    expect((await currentWidgetState(page)).scrollTop).toBe(parked);
  });
});
