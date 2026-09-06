import { expect, galata, test } from '@jupyterlab/galata';

/**
 * Integration tests for the live Markdown preview.
 *
 * Each test writes the fixture through the contents API, which is external as
 * far as the extension is concerned: the bytes on disk move without anything
 * telling the open document, which is exactly what an agentic tool does.
 */

const PLUGIN_ID = 'jupyterlab_advanced_markdown_viewer_extension:plugin';
const FILE = 'live.md';

/**
 * Galata's stock readiness wait expects a Launcher tab in the main area. The
 * lab this suite runs against opens with an empty main area, so the wait
 * times out before any test body runs. Readiness here is the splash gone and
 * the shell mounted, which is all the tests need.
 */
test.use({
  waitForApplication: async ({ baseURL }, use) => {
    await use(async (page: any) => {
      await page.locator('#jupyterlab-splash').waitFor({ state: 'detached' });
      await page.locator('#main').waitFor();
    });
  }
});

const INITIAL = [
  '# Report',
  '',
  'The first paragraph is unchanged.',
  '',
  'The second paragraph mentions apples.',
  ''
].join('\n');

/**
 * Same document with the second paragraph rewritten and a third added.
 */
const REWRITTEN = [
  '# Report',
  '',
  'The first paragraph is unchanged.',
  '',
  'The second paragraph mentions oranges.',
  '',
  'A third paragraph appeared.',
  ''
].join('\n');

/**
 * A document long enough to scroll, with a heading anchor at the top.
 */
const LONG = [
  '# Report',
  '',
  ...Array.from(
    { length: 80 },
    (_, i) =>
      `Paragraph ${i + 1} of the long report, written to make the preview scroll.\n`
  )
].join('\n');

const LONG_REWRITTEN = `${LONG}\nA final paragraph appeared.\n`;

/**
 * Settings that make the feature observable within a test: poll every second,
 * hold the highlight long enough to assert on it, and show a change at once so
 * the text read after a decoration appears is complete; the change animation
 * describe sets its own speed.
 */
function settings(overrides: Record<string, unknown> = {}) {
  return {
    ...galata.DEFAULT_SETTINGS,
    [PLUGIN_ID]: {
      enabled: true,
      pollInterval: 1,
      fadeDuration: 30000,
      animation: true,
      animationSpeed: 0,
      highlight: true,
      tabCue: true,
      ...overrides
    }
  };
}

/**
 * Open the Markdown preview for a path and wait for its first render.
 */
async function openPreview(
  page: any,
  path: string,
  firstText = 'The first paragraph is unchanged.'
): Promise<void> {
  await page.evaluate(async (target: string) => {
    await (window as any).jupyterapp.commands.execute('docmanager:open', {
      path: target,
      factory: 'Markdown Preview'
    });
  }, path);
  await expect(page.locator('.jp-RenderedMarkdown')).toContainText(firstText);
}

/**
 * Open the same file in the text editor and type into it, which leaves the
 * shared document dirty. The editor tab is current afterwards.
 */
async function typeInEditor(
  page: any,
  path: string,
  text: string
): Promise<void> {
  await page.evaluate(async (target: string) => {
    await (window as any).jupyterapp.commands.execute('docmanager:open', {
      path: target,
      factory: 'Editor'
    });
  }, path);
  const editor = page.locator('.jp-FileEditor .cm-content');
  await expect(editor).toBeVisible();
  await editor.click();
  await page.keyboard.press('Control+End');
  await page.keyboard.type(text);
}

/**
 * Save the current document without waiting: a File Changed dialog, when one
 * appears, holds the save promise until it is answered.
 */
async function startSave(page: any): Promise<void> {
  await page.evaluate(() => {
    void (window as any).jupyterapp.commands.execute('docmanager:save');
  });
}

/**
 * The file as the server holds it now.
 */
async function readDisk(page: any, path: string): Promise<string> {
  return page.evaluate(async (target: string) => {
    const model = await (window as any).jupyterapp.serviceManager.contents.get(
      target,
      {
        content: true,
        format: 'text',
        type: 'file'
      }
    );
    return model.content as string;
  }, path);
}

const previewScrollTop = (page: any): Promise<number> =>
  page.evaluate(
    () => document.querySelector('.jp-RenderedMarkdown')?.scrollTop ?? -1
  );

/**
 * Sample the text length of the last element matching a selector at a fixed
 * interval, inside the page so the samples are evenly spaced. A sample is
 * null when nothing matches.
 */
const sampleLength = (
  page: any,
  selector: string,
  count: number,
  everyMs: number
): Promise<Array<number | null>> =>
  page.evaluate(
    ([target, n, every]: [string, number, number]) =>
      new Promise<Array<number | null>>(resolve => {
        const samples: Array<number | null> = [];
        const timer = setInterval(() => {
          const matches = document.querySelectorAll(target);
          const last = matches[matches.length - 1];
          samples.push(last ? (last.textContent ?? '').length : null);
          if (samples.length >= n) {
            clearInterval(timer);
            resolve(samples);
          }
        }, every);
      }),
    [selector, count, everyMs]
  );

test.describe('live preview with a long highlight', () => {
  test.use({ mockSettings: settings() });

  test.beforeEach(async ({ page, tmpPath }) => {
    await page.contents.uploadContent(INITIAL, 'text', `${tmpPath}/${FILE}`);
    await openPreview(page, `${tmpPath}/${FILE}`);
  });

  test('shows content another process wrote, without a reload', async ({
    page,
    tmpPath
  }) => {
    await page.contents.uploadContent(REWRITTEN, 'text', `${tmpPath}/${FILE}`);

    await expect(page.locator('.jp-RenderedMarkdown')).toContainText(
      'A third paragraph appeared.',
      { timeout: 20000 }
    );
    await expect(page.locator('.jp-RenderedMarkdown')).toContainText('oranges');
  });

  test('highlights the text the change added', async ({ page, tmpPath }) => {
    await page.contents.uploadContent(REWRITTEN, 'text', `${tmpPath}/${FILE}`);

    const added = page.locator('.jp-AdvancedMd-added');
    await expect(added.first()).toBeVisible({ timeout: 20000 });
    await expect(added.first()).toHaveCSS(
      'background-color',
      /rgba?\(\s*\d+\s*,\s*\d+\s*,\s*\d+/
    );
    const text = (await added.allTextContents()).join(' ');
    expect(text).toContain('oranges');
  });

  test('shows the text the change removed', async ({ page, tmpPath }) => {
    await page.contents.uploadContent(REWRITTEN, 'text', `${tmpPath}/${FILE}`);

    const removed = page.locator('.jp-AdvancedMd-removed');
    await expect(removed.first()).toBeVisible({ timeout: 20000 });
    const text = (await removed.allTextContents()).join(' ');
    expect(text).toContain('apples');
  });

  test('separates a struck word from its replacement', async ({
    page,
    tmpPath
  }) => {
    await page.contents.uploadContent(REWRITTEN, 'text', `${tmpPath}/${FILE}`);

    const ghost = page.locator('.jp-AdvancedMd-removed', {
      hasText: 'apples.'
    });
    await expect(ghost).toBeVisible({ timeout: 20000 });
    // The gap is generated content after the ghost, so the struck word and
    // the word that replaced it do not read as one token.
    const gap = await ghost.evaluate(
      (element: Element) => getComputedStyle(element, '::after').content
    );
    expect(gap).toContain('\u00a0');
  });

  test('marks the document tab', async ({ page, tmpPath }) => {
    await page.contents.uploadContent(REWRITTEN, 'text', `${tmpPath}/${FILE}`);

    await expect(
      page.locator('.lm-TabBar-tab.jp-AdvancedMd-tabUpdated')
    ).toHaveCount(1, { timeout: 20000 });
  });

  test('adds no direct child to the render root', async ({ page, tmpPath }) => {
    const countChildren = () =>
      page.evaluate(
        () =>
          document.querySelector('.jp-RenderedMarkdown')?.children.length ?? -1
      );
    const before = await countChildren();
    expect(before).toBeGreaterThan(0);

    await page.contents.uploadContent(REWRITTEN, 'text', `${tmpPath}/${FILE}`);
    await expect(page.locator('.jp-AdvancedMd-added').first()).toBeVisible({
      timeout: 20000
    });

    // One block was appended by the rewrite itself; nothing beyond that may
    // come from the decorations, which another extension counts against the
    // Markdown block count.
    expect(await countChildren()).toBe(before + 1);
  });

  test('leaves the reader-visible text free of decoration markup', async ({
    page,
    tmpPath
  }) => {
    await page.contents.uploadContent(REWRITTEN, 'text', `${tmpPath}/${FILE}`);
    await expect(page.locator('.jp-AdvancedMd-added').first()).toBeVisible({
      timeout: 20000
    });

    const source = await page.evaluate(async () => {
      const app = (window as any).jupyterapp;
      const widget = app.shell.currentWidget;
      return widget?.context?.model?.toString?.() ?? '';
    });
    expect(source).not.toContain('jp-AdvancedMd');
    expect(source).toContain('oranges');
  });
});

test.describe('fading', () => {
  test.use({
    mockSettings: settings({ fadeDuration: 1000 })
  });

  test('takes the decorations back out once the fade has run', async ({
    page,
    tmpPath
  }) => {
    await page.contents.uploadContent(INITIAL, 'text', `${tmpPath}/${FILE}`);
    await openPreview(page, `${tmpPath}/${FILE}`);
    await page.contents.uploadContent(REWRITTEN, 'text', `${tmpPath}/${FILE}`);

    await expect(page.locator('.jp-AdvancedMd-decoration').first()).toBeVisible(
      {
        timeout: 20000
      }
    );
    await expect(page.locator('.jp-AdvancedMd-decoration')).toHaveCount(0, {
      timeout: 20000
    });
    // The document itself is untouched by the decorations coming and going.
    await expect(page.locator('.jp-RenderedMarkdown')).toContainText(
      'A third paragraph appeared.'
    );
    await expect(page.locator('.jp-RenderedMarkdown')).not.toContainText(
      'apples'
    );
  });
});

test.describe('highlighting turned off', () => {
  test.use({
    mockSettings: settings({ highlight: false })
  });

  test('still updates the content but draws no decoration', async ({
    page,
    tmpPath
  }) => {
    await page.contents.uploadContent(INITIAL, 'text', `${tmpPath}/${FILE}`);
    await openPreview(page, `${tmpPath}/${FILE}`);
    await page.contents.uploadContent(REWRITTEN, 'text', `${tmpPath}/${FILE}`);

    await expect(page.locator('.jp-RenderedMarkdown')).toContainText(
      'A third paragraph appeared.',
      { timeout: 20000 }
    );
    await expect(page.locator('.jp-AdvancedMd-decoration')).toHaveCount(0);
  });
});

test.describe('the extension turned off', () => {
  test.use({
    mockSettings: settings({ enabled: false })
  });

  test('does not update the preview at all', async ({ page, tmpPath }) => {
    await page.contents.uploadContent(INITIAL, 'text', `${tmpPath}/${FILE}`);
    await openPreview(page, `${tmpPath}/${FILE}`);
    await page.contents.uploadContent(REWRITTEN, 'text', `${tmpPath}/${FILE}`);

    await page.waitForTimeout(6000);
    await expect(page.locator('.jp-RenderedMarkdown')).not.toContainText(
      'A third paragraph appeared.'
    );
  });
});

test.describe('a document open in the editor as well', () => {
  test.use({ mockSettings: settings() });

  test.beforeEach(async ({ page, tmpPath }) => {
    await page.contents.uploadContent(INITIAL, 'text', `${tmpPath}/${FILE}`);
    await openPreview(page, `${tmpPath}/${FILE}`);
  });

  test('is never overwritten by the change on disk while edits are unsaved', async ({
    page,
    tmpPath
  }) => {
    await typeInEditor(page, `${tmpPath}/${FILE}`, 'UNSAVED WORK');

    await page.contents.uploadContent(REWRITTEN, 'text', `${tmpPath}/${FILE}`);
    await page.waitForTimeout(8000);

    const source = await page.evaluate(() => {
      const app = (window as any).jupyterapp;
      return app.shell.currentWidget?.context?.model?.toString?.() ?? '';
    });
    expect(source).toContain('UNSAVED WORK');
    expect(source).not.toContain('A third paragraph appeared.');
  });

  test('saves from the editor after an applied change without a File Changed dialog', async ({
    page,
    tmpPath
  }) => {
    const path = `${tmpPath}/${FILE}`;
    await page.contents.uploadContent(REWRITTEN, 'text', path);
    await expect(page.locator('.jp-RenderedMarkdown')).toContainText(
      'A third paragraph appeared.',
      { timeout: 20000 }
    );

    // The document holds the disk revision now, so an edit on top of it is
    // an ordinary edit and saves as one.
    await typeInEditor(page, path, 'EDIT AFTER APPLY');
    await startSave(page);

    await expect
      .poll(() => readDisk(page, path), { timeout: 10000 })
      .toContain('EDIT AFTER APPLY');
    await expect(page.locator('.jp-Dialog')).toHaveCount(0);
    expect(await readDisk(page, path)).toContain('A third paragraph appeared.');
  });

  test('keeps the blocked marker while the reader looks, and drops it once the edits are saved', async ({
    page,
    tmpPath
  }) => {
    const path = `${tmpPath}/${FILE}`;
    await typeInEditor(page, path, 'UNSAVED WORK');
    await page.contents.uploadContent(REWRITTEN, 'text', path);

    const blockedTab = page.locator('.lm-TabBar-tab.jp-AdvancedMd-tabBlocked');
    await expect(blockedTab).toHaveCount(1, { timeout: 20000 });

    // Looking at the stale preview does not make the change on disk go away.
    await blockedTab.click();
    await page.locator('.jp-RenderedMarkdown').click();
    await page.mouse.wheel(0, 40);
    await page.waitForTimeout(1500);
    await expect(blockedTab).toHaveCount(1);

    // Saving over unsaved edits is the editor's own conflict: the dialog
    // stays, and Overwrite settles it. Nothing then waits on disk.
    await startSave(page);
    const dialog = page.locator('.jp-Dialog');
    await expect(dialog).toContainText('File Changed');
    await dialog.locator('button', { hasText: 'Overwrite' }).click();

    await expect(blockedTab).toHaveCount(0, { timeout: 10000 });
    expect(await readDisk(page, path)).toContain('UNSAVED WORK');
  });

  test('takes the change on Revert and drops the blocked marker', async ({
    page,
    tmpPath
  }) => {
    const path = `${tmpPath}/${FILE}`;
    await typeInEditor(page, path, 'UNSAVED WORK');
    await page.contents.uploadContent(REWRITTEN, 'text', path);

    const blockedTab = page.locator('.lm-TabBar-tab.jp-AdvancedMd-tabBlocked');
    await expect(blockedTab).toHaveCount(1, { timeout: 20000 });

    await startSave(page);
    const dialog = page.locator('.jp-Dialog');
    await expect(dialog).toContainText('File Changed');
    await dialog.locator('button', { hasText: 'Revert' }).click();

    await expect(page.locator('.jp-RenderedMarkdown')).toContainText(
      'A third paragraph appeared.',
      { timeout: 10000 }
    );
    await expect(blockedTab).toHaveCount(0, { timeout: 10000 });
    expect(await readDisk(page, path)).not.toContain('UNSAVED WORK');
  });
});

test.describe('the reader position', () => {
  test.use({ mockSettings: settings() });

  test('stays where the reader scrolled to when another extension scrolls to the URL hash', async ({
    page,
    tmpPath
  }) => {
    const path = `${tmpPath}/${FILE}`;
    await page.contents.uploadContent(LONG, 'text', path);
    await openPreview(page, path, 'Paragraph 1 of the long report');

    // The table-of-contents fix smooth-scrolls the rendered view to the
    // heading in the URL hash 100 ms after every render. This lab's URL
    // carries the reset query, which JupyterLab rewrites within seconds and
    // the hash goes with it, so the trigger is stood in for here: the same
    // motion, 100 ms after the same signal, on the same element. The scroll
    // is made directly rather than through setFragment, whose stock version
    // re-renders the document and would re-arm this trigger on every render.
    // The reader then scrolls well away from the heading.
    await page.evaluate(() => {
      const w = window as any;
      const content = w.jupyterapp.shell.currentWidget.content;
      w.__anchorScrolls = 0;
      content.rendered.connect(() => {
        setTimeout(() => {
          w.__anchorScrolls += 1;
          const root = document.querySelector('.jp-RenderedMarkdown');
          const heading = root?.querySelector('#Report') as HTMLElement | null;
          if (root && heading) {
            root.scrollTo({ top: heading.offsetTop, behavior: 'smooth' });
          }
        }, 100);
      });
    });
    await page.locator('.jp-RenderedMarkdown').hover();
    await page.mouse.wheel(0, 3000);
    await expect.poll(() => previewScrollTop(page)).toBeGreaterThan(1000);
    const before = await previewScrollTop(page);
    // Past the window in which the switch-tab scrolling fix owns the position.
    await page.waitForTimeout(3500);

    await page.contents.uploadContent(LONG_REWRITTEN, 'text', path);
    await expect(page.locator('.jp-AdvancedMd-added').first()).toBeAttached({
      timeout: 20000
    });
    await page.waitForTimeout(1500);

    expect(await page.evaluate(() => (window as any).__anchorScrolls)).toBe(1);
    const after = await previewScrollTop(page);
    expect(Math.abs(after - before)).toBeLessThan(50);
  });
});

test.describe('change animation', () => {
  // 20 characters per second: the third paragraph (27 characters) types for
  // 1350 ms and the ghost 'apples.' is held for 750 ms then deleted over
  // 350 ms, both long enough to sample every 20 ms.
  test.use({ mockSettings: settings({ animationSpeed: 20 }) });

  const THIRD = 'A third paragraph appeared.';

  test.beforeEach(async ({ page, tmpPath }) => {
    await page.contents.uploadContent(INITIAL, 'text', `${tmpPath}/${FILE}`);
    await openPreview(page, `${tmpPath}/${FILE}`);
  });

  test('types added text in letter by letter on its green background', async ({
    page,
    tmpPath
  }) => {
    await page.contents.uploadContent(REWRITTEN, 'text', `${tmpPath}/${FILE}`);

    const typing = page.locator('.jp-AdvancedMd-added.jp-AdvancedMd-typing');
    await expect(typing.first()).toBeAttached({ timeout: 20000 });
    // A transparent background would match a colour pattern too, so the
    // assertion names the one value that means no tint.
    await expect(typing.last()).not.toHaveCSS(
      'background-color',
      'rgba(0, 0, 0, 0)'
    );

    const samples = await sampleLength(page, '.jp-AdvancedMd-added', 80, 20);
    expect(samples[0]).toBeLessThan(THIRD.length);
    for (let i = 1; i < samples.length; i++) {
      expect(samples[i]).toBeGreaterThanOrEqual(samples[i - 1] as number);
    }
    expect(new Set(samples).size).toBeGreaterThan(5);
    expect(samples[samples.length - 1]).toBe(THIRD.length);
    // At the default speed of 200 the same text would type in 135 ms, which
    // is seven samples; the low speed set here is what makes it slow.
    const growing = samples.filter(length => (length as number) < THIRD.length);
    expect(growing.length).toBeGreaterThanOrEqual(40);

    await expect(page.locator('.jp-AdvancedMd-typing')).toHaveCount(0, {
      timeout: 20000
    });
    expect(
      await page.locator('.jp-AdvancedMd-added').last().textContent()
    ).toBe(THIRD);
  });

  test('holds removed text, deletes it from the end, then takes it out', async ({
    page,
    tmpPath
  }) => {
    await page.contents.uploadContent(REWRITTEN, 'text', `${tmpPath}/${FILE}`);

    const ghost = page.locator('.jp-AdvancedMd-removed');
    await expect(ghost.first()).toBeAttached({ timeout: 20000 });
    await expect(ghost.first()).toHaveCSS(
      'text-decoration-line',
      'line-through'
    );

    // Sampling starts a few hundred milliseconds into the 750 ms hold, after
    // the two polls above returned. Without a hold the 7 characters would be
    // gone within 350 ms at 20 cps, so ten full-length samples (200 ms) prove
    // the ghost stood before its deletion started.
    const samples = await sampleLength(page, '.jp-AdvancedMd-removed', 100, 20);
    expect(samples[0]).toBe('apples.'.length);
    let held = 0;
    while (held < samples.length && samples[held] === 'apples.'.length) {
      held += 1;
    }
    expect(held).toBeGreaterThanOrEqual(10);
    for (let i = 1; i < samples.length; i++) {
      const previous = samples[i - 1];
      const current = samples[i];
      if (previous !== null && current !== null) {
        expect(current).toBeLessThanOrEqual(previous);
      }
    }
    const last = samples[samples.length - 1];
    expect(last === null || last === 0).toBe(true);

    // The fade is 30 s, so the ghost left by deletion, not by the fade: the
    // added text is still decorated.
    await expect(ghost).toHaveCount(0, { timeout: 20000 });
    await expect(page.locator('.jp-RenderedMarkdown')).toContainText('oranges');
    await expect(page.locator('.jp-RenderedMarkdown')).not.toContainText(
      'apples'
    );
    expect(await page.locator('.jp-AdvancedMd-added').count()).toBeGreaterThan(
      0
    );
  });
});

test.describe('animation turned off', () => {
  test.use({ mockSettings: settings({ animation: false }) });

  test('shows the whole change at once', async ({ page, tmpPath }) => {
    await page.contents.uploadContent(INITIAL, 'text', `${tmpPath}/${FILE}`);
    await openPreview(page, `${tmpPath}/${FILE}`);
    await page.contents.uploadContent(REWRITTEN, 'text', `${tmpPath}/${FILE}`);

    await expect(page.locator('.jp-AdvancedMd-added').first()).toBeVisible({
      timeout: 20000
    });
    const added = await page.evaluate(() =>
      Array.from(document.querySelectorAll('.jp-AdvancedMd-added')).map(
        element => ({
          typing: element.classList.contains('jp-AdvancedMd-typing'),
          text: element.textContent ?? ''
        })
      )
    );
    expect(added.some(span => span.typing)).toBe(false);
    const text = added.map(span => span.text).join(' ');
    expect(text).toContain('A third paragraph appeared.');
    expect(text).toContain('oranges');
  });
});
