import { expect, test } from '@jupyterlab/galata';

import {
  FILE,
  INITIAL,
  REWRITTEN,
  highlightAlphas,
  labFixtures,
  openPreview,
  settings,
  shippedSettings,
  typeInEditor,
  typeInEditorAfter
} from './helpers';

/**
 * Integration tests for the live Markdown preview.
 *
 * Each test writes the fixture through the contents API, which is external as
 * far as the extension is concerned: the bytes on disk move without anything
 * telling the open document, which is exactly what an agentic tool does.
 */

test.use(labFixtures);

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
 * The fixture with its second paragraph rewritten and nothing added, so a
 * change that stays away from the end of the document.
 */
const MIDDLE = INITIAL.replace('apples', 'oranges');

/**
 * The fixture with its heading and its second paragraph rewritten: two
 * hunks, so one can land while the other meets the reader's edit.
 */
const CONFLICTING = MIDDLE.replace('# Report', '# Report, revised');

/**
 * The fixture with its heading rewritten and its second paragraph rewritten
 * word for word, so that paragraph's hunks cover the whole line the reader is
 * editing rather than one word of it.
 */
const LINE_REWRITTEN = CONFLICTING.replace(
  'The second paragraph mentions oranges.',
  'The second section lists oranges and pears.'
);

/**
 * The fixture with two lines put in above it.
 */
const ABOVE = `A preface line.\n\n${INITIAL}`;

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
    // The two settings are independent: the cue still says which document
    // moved when the highlighting is off.
    await expect(
      page.locator('.lm-TabBar-tab.jp-AdvancedMd-tabUpdated')
    ).toHaveCount(1);
  });
});

test.describe('the tab cue turned off', () => {
  test.use({
    mockSettings: settings({ tabCue: false })
  });

  test('still updates the content but marks no tab', async ({
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
    // The live update is unaffected: the change landed and is highlighted.
    await expect(
      page.locator('.jp-AdvancedMd-decoration').first()
    ).toBeVisible();
    // Neither marker: not the arriving one, and not either of the two the
    // reader has to act on.
    await expect(
      page.locator('.lm-TabBar-tab.jp-AdvancedMd-tabUpdated')
    ).toHaveCount(0);
    await expect(
      page.locator('.lm-TabBar-tab.jp-AdvancedMd-tabBlocked')
    ).toHaveCount(0);
    await expect(
      page.locator('.lm-TabBar-tab.jp-AdvancedMd-tabMissing')
    ).toHaveCount(0);
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

  test('ACC-APPLY-10 merges the change on disk around unsaved edits and keeps them', async ({
    page,
    tmpPath
  }) => {
    const path = `${tmpPath}/${FILE}`;
    await typeInEditor(page, path, 'UNSAVED WORK');
    await page.contents.uploadContent(MIDDLE, 'text', path);

    // The change lands around the reader's text: both are in the document,
    // the preview shows the change, and the document stays unsaved.
    await expect(page.locator('.jp-RenderedMarkdown')).toContainText(
      'oranges',
      { timeout: 20000 }
    );
    const source = await page.evaluate(() => {
      const app = (window as any).jupyterapp;
      return app.shell.currentWidget?.context?.model?.toString?.() ?? '';
    });
    expect(source).toContain('UNSAVED WORK');
    expect(source).toContain('oranges');
    expect(source).not.toContain('apples');
    await expect(
      page.locator('.lm-TabBar-tab.jp-AdvancedMd-tabUpdated')
    ).toHaveCount(1);
    await expect(
      page.locator('.lm-TabBar-tab.jp-AdvancedMd-tabBlocked')
    ).toHaveCount(0);
    expect(
      await page.evaluate(
        () =>
          (window as any).jupyterapp.shell.currentWidget?.context?.model?.dirty
      )
    ).toBe(true);
    // Nothing was saved on the reader's behalf.
    expect(await readDisk(page, path)).not.toContain('UNSAVED WORK');
  });

  test('ACC-APPLY-13 keeps the editor cursor on its text when lines are added above it', async ({
    page,
    tmpPath
  }) => {
    const path = `${tmpPath}/${FILE}`;
    await typeInEditor(page, path, 'UNSAVED WORK');
    const cursor = () =>
      page.evaluate((target: string) => {
        const app = (window as any).jupyterapp;
        for (const widget of app.shell.widgets('main')) {
          if (widget.context?.path === target && widget.content?.editor) {
            return widget.content.editor.getCursorPosition();
          }
        }
        return null;
      }, path);
    const before = await cursor();
    expect(before).toEqual({ line: 5, column: 12 });

    await page.contents.uploadContent(ABOVE, 'text', path);
    await expect(page.locator('.jp-RenderedMarkdown')).toContainText(
      'A preface line.',
      { timeout: 20000 }
    );
    // Two lines went in above: the cursor is on the same text, two lines
    // down, and stays where the reader types.
    expect(await cursor()).toEqual({ line: 7, column: 12 });
    await page.keyboard.type(' AND MORE');
    const source = await page.evaluate(() => {
      const app = (window as any).jupyterapp;
      return app.shell.currentWidget?.context?.model?.toString?.() ?? '';
    });
    expect(source).toContain('UNSAVED WORK AND MORE');
    expect(source.startsWith('A preface line.')).toBe(true);
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

    // The applied change marked the tab and drew decorations. The reader
    // takes the marker back by acting on the document, so from here on
    // anything on the tab or in the text came from the save.
    await page.locator('.jp-RenderedMarkdown').click();
    await expect(
      page.locator('.lm-TabBar-tab.jp-AdvancedMd-tabUpdated')
    ).toHaveCount(0);
    // Every change this extension applies from disk is one shared-model
    // transaction carrying its origin; a save taken for an external change
    // would add one.
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

    // The document holds the disk revision now, so an edit on top of it is
    // an ordinary edit and saves as one.
    await typeInEditor(page, path, 'EDIT AFTER APPLY');
    await startSave(page);

    await expect
      .poll(() => readDisk(page, path), { timeout: 10000 })
      .toContain('EDIT AFTER APPLY');
    await expect(page.locator('.jp-Dialog')).toHaveCount(0);
    expect(await readDisk(page, path)).toContain('A third paragraph appeared.');

    // The save is this session's own write. The file event it raises is
    // answered by a read that finds the file holding what the document holds,
    // so nothing is applied, nothing is highlighted and no marker returns.
    await page.waitForTimeout(3000);
    expect(await page.evaluate(() => (window as any).__applies)).toBe(0);
    await expect(page.locator('.jp-AdvancedMd-decoration')).toHaveCount(0);
    await expect(
      page.locator('.lm-TabBar-tab.jp-AdvancedMd-tabUpdated')
    ).toHaveCount(0);
    await expect(
      page.locator('.lm-TabBar-tab.jp-AdvancedMd-tabBlocked')
    ).toHaveCount(0);
  });

  test('ACC-APPLY-11 keeps the unsaved text where the change overlaps it, applies the rest, and saves without a dialog', async ({
    page,
    tmpPath
  }) => {
    const path = `${tmpPath}/${FILE}`;
    await typeInEditorAfter(page, path, 'apples', ' UNSAVED WORK');
    await page.contents.uploadContent(CONFLICTING, 'text', path);

    // The heading's change lands; the second paragraph is the reader's, and
    // the marker of a change held back names the conflict.
    const blockedTab = page.locator('.lm-TabBar-tab.jp-AdvancedMd-tabBlocked');
    await expect(blockedTab).toHaveCount(1, { timeout: 20000 });
    await expect(page.locator('.jp-RenderedMarkdown')).toContainText(
      'Report, revised'
    );
    const source = await page.evaluate(() => {
      const app = (window as any).jupyterapp;
      return app.shell.currentWidget?.context?.model?.toString?.() ?? '';
    });
    expect(source).toContain('apples UNSAVED WORK.');
    expect(source).not.toContain('oranges');
    const tooltip = await blockedTab.getAttribute('title');
    expect(tooltip).toContain('unsaved edits');
    expect(tooltip).toContain('Your text is kept');

    // Looking at the preview does not make the conflict go away.
    await blockedTab.click();
    await page.locator('.jp-RenderedMarkdown').click();
    await page.waitForTimeout(1500);
    await expect(blockedTab).toHaveCount(1);

    // A save keeps the reader's version. The document holds the file's
    // revision under their edits, so the save raises no File Changed dialog
    // and the marker comes down.
    await startSave(page);
    await expect(blockedTab).toHaveCount(0, { timeout: 10000 });
    await expect(page.locator('.jp-Dialog')).toHaveCount(0);
    const disk = await readDisk(page, path);
    expect(disk).toContain('apples UNSAVED WORK.');
    expect(disk).toContain('Report, revised');
    expect(disk).not.toContain('oranges');
  });

  test("ACC-APPLY-11 keeps the reader's line whole when the change rewrites that line around their text", async ({
    page,
    tmpPath
  }) => {
    const path = `${tmpPath}/${FILE}`;
    await typeInEditorAfter(page, path, 'apples', ' UNSAVED WORK');
    await page.contents.uploadContent(LINE_REWRITTEN, 'text', path);

    // The heading's change lands. The rewrite of the reader's own line is one
    // place the writer put a cursor, so it is dropped whole rather than woven
    // word by word into the sentence they are typing in.
    const blockedTab = page.locator('.lm-TabBar-tab.jp-AdvancedMd-tabBlocked');
    await expect(blockedTab).toHaveCount(1, { timeout: 20000 });
    const source = await page.evaluate(() => {
      const app = (window as any).jupyterapp;
      return app.shell.currentWidget?.context?.model?.toString?.() ?? '';
    });
    expect(source).toContain(
      'The second paragraph mentions apples UNSAVED WORK.'
    );
    expect(source).not.toContain('section');
    expect(source).not.toContain('pears');
    expect(source).toContain('Report, revised');
  });

  test('takes the change on Reload from Disk, drops the blocked marker and follows the next write', async ({
    page,
    tmpPath
  }) => {
    const path = `${tmpPath}/${FILE}`;
    // The edit sits in the passage the file rewrites: a conflict.
    await typeInEditorAfter(page, path, 'apples', ' UNSAVED WORK');
    await page.contents.uploadContent(REWRITTEN, 'text', path);

    const blockedTab = page.locator('.lm-TabBar-tab.jp-AdvancedMd-tabBlocked');
    await expect(blockedTab).toHaveCount(1, { timeout: 20000 });

    // The reader brings the preview to the front and chooses File, Reload
    // Markdown File from Disk. With unsaved edits JupyterLab asks first.
    await blockedTab.click();
    await page.locator('.lm-MenuBar-itemLabel', { hasText: /^File$/ }).click();
    await page
      .locator('.lm-Menu-content')
      .first()
      .locator('.lm-Menu-item', { hasText: 'Reload Markdown File from Disk' })
      .click();
    const dialog = page.locator('.jp-Dialog');
    await expect(dialog).toContainText(
      'Are you sure you want to reload the Markdown File from the disk?'
    );
    await dialog.locator('button', { hasText: 'Reload' }).click();
    await expect(dialog).toHaveCount(0);

    await expect(page.locator('.jp-RenderedMarkdown')).toContainText(
      'A third paragraph appeared.',
      { timeout: 10000 }
    );
    // The document holds what the file holds: no marker and nothing unsaved.
    await expect(blockedTab).toHaveCount(0, { timeout: 10000 });
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            (window as any).jupyterapp.shell.currentWidget?.context?.model
              ?.dirty
        )
      )
      .toBe(false);
    await expect(page.locator('.lm-TabBar-tab.jp-mod-dirty')).toHaveCount(0);

    // The next write is applied live, as on a document that was never held.
    await page.contents.uploadContent(
      `${REWRITTEN}\nA fourth paragraph appeared.\n`,
      'text',
      path
    );
    await expect(page.locator('.jp-RenderedMarkdown')).toContainText(
      'A fourth paragraph appeared.',
      { timeout: 20000 }
    );
    await expect(
      page.locator('.lm-TabBar-tab.jp-AdvancedMd-tabUpdated')
    ).toHaveCount(1);
    await expect(blockedTab).toHaveCount(0);
    expect(await readDisk(page, path)).not.toContain('UNSAVED WORK');
  });

  test('takes the next write after Reload from Disk over typed text with nothing held (DEF-CUE-85)', async ({
    page,
    tmpPath
  }) => {
    const path = `${tmpPath}/${FILE}`;
    await typeInEditor(page, path, 'UNSAVED WORK');
    // The preview shares the document, so its text is what brings it to the
    // front. Nothing is held: the file has not changed since it was opened.
    await openPreview(page, path, 'UNSAVED WORK');
    await page.locator('.lm-MenuBar-itemLabel', { hasText: /^File$/ }).click();
    await page
      .locator('.lm-Menu-content')
      .first()
      .locator('.lm-Menu-item', { hasText: 'Reload Markdown File from Disk' })
      .click();
    const dialog = page.locator('.jp-Dialog');
    await expect(dialog).toContainText(
      'Are you sure you want to reload the Markdown File from the disk?'
    );
    await dialog.locator('button', { hasText: 'Reload' }).click();
    await expect(dialog).toHaveCount(0);
    await expect(
      page.locator('.jp-RenderedMarkdown:visible')
    ).not.toContainText('UNSAVED WORK');

    // JupyterLab leaves the document flagged after the reload; the document
    // holds what the file holds, so the next write is shown live and not
    // held behind that flag.
    await page.contents.uploadContent(REWRITTEN, 'text', path);
    await expect(page.locator('.jp-RenderedMarkdown:visible')).toContainText(
      'A third paragraph appeared.',
      { timeout: 20000 }
    );
    await expect(
      page.locator('.lm-TabBar-tab.jp-AdvancedMd-tabBlocked')
    ).toHaveCount(0);
    await expect(
      page.locator('.lm-TabBar-tab.jp-AdvancedMd-tabUpdated')
    ).toHaveCount(1);
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            (window as any).jupyterapp.shell.currentWidget?.context?.model
              ?.dirty
        )
      )
      .toBe(false);
    expect(await readDisk(page, path)).not.toContain('UNSAVED WORK');
  });
});

test.describe('a preview opened over unsaved edits', () => {
  test.use({ mockSettings: settings() });

  test('DEF-APPLY-90 merges the first write over text typed before the preview was opened', async ({
    page,
    tmpPath
  }) => {
    const path = `${tmpPath}/${FILE}`;
    await page.contents.uploadContent(INITIAL, 'text', path);
    // The reader types in the editor before any preview exists, then opens
    // one: its watcher is built over a document that differs from the file.
    // The file is still the revision the editor loaded, so it is the text
    // the reader typed over, and the first write merges around their text.
    await typeInEditor(page, path, 'UNSAVED WORK');
    await openPreview(page, path, 'UNSAVED WORK');
    const blockedTab = page.locator('.lm-TabBar-tab.jp-AdvancedMd-tabBlocked');
    await page.waitForTimeout(2500);
    await expect(blockedTab).toHaveCount(0);

    await page.contents.uploadContent(MIDDLE, 'text', path);
    await expect(page.locator('.jp-RenderedMarkdown:visible')).toContainText(
      'oranges',
      { timeout: 20000 }
    );
    await expect(page.locator('.jp-RenderedMarkdown:visible')).toContainText(
      'UNSAVED WORK'
    );
    await expect(blockedTab).toHaveCount(0);
    expect(await readDisk(page, path)).not.toContain('UNSAVED WORK');
  });

  test('DEF-APPLY-90 holds the first write when the file moved on before the preview was opened', async ({
    page,
    tmpPath
  }) => {
    const path = `${tmpPath}/${FILE}`;
    await page.contents.uploadContent(INITIAL, 'text', path);
    // The file changes while only the editor is open, then the preview is
    // opened: the text the reader typed over is not on disk any more, so
    // there is nothing to merge over and the file's text is held back.
    await typeInEditor(page, path, 'UNSAVED WORK');
    await page.contents.uploadContent(REWRITTEN, 'text', path);
    await openPreview(page, path, 'UNSAVED WORK');
    const blockedTab = page.locator('.lm-TabBar-tab.jp-AdvancedMd-tabBlocked');
    await expect(blockedTab).toHaveCount(1, { timeout: 20000 });
    const tooltip = await blockedTab.getAttribute('title');
    expect(tooltip).toContain('held back');

    await page.contents.uploadContent(
      `${REWRITTEN}\nA fourth paragraph appeared.\n`,
      'text',
      path
    );
    await page.waitForTimeout(2500);
    // The reader's text is still in the document, the writes are not shown,
    // and nothing was saved on their behalf.
    await expect(page.locator('.jp-RenderedMarkdown:visible')).toContainText(
      'UNSAVED WORK'
    );
    await expect(
      page.locator('.jp-RenderedMarkdown:visible')
    ).not.toContainText('A third paragraph appeared.');
    await expect(blockedTab).toHaveCount(1);
    expect(await readDisk(page, path)).not.toContain('UNSAVED WORK');

    // Saving over a file that moved on is the editor's own conflict: the
    // dialog stays, and Overwrite settles it. Nothing then waits on disk.
    await startSave(page);
    const dialog = page.locator('.jp-Dialog');
    await expect(dialog).toContainText('File Changed');
    await dialog.locator('button', { hasText: 'Overwrite' }).click();
    await expect(blockedTab).toHaveCount(0, { timeout: 10000 });
    expect(await readDisk(page, path)).toContain('UNSAVED WORK');
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

    // A change renders twice: at once when it is applied, and again when the
    // viewer's own render timeout runs; the stand-in fires on both.
    expect(await page.evaluate(() => (window as any).__anchorScrolls)).toBe(2);
    const after = await previewScrollTop(page);
    expect(Math.abs(after - before)).toBeLessThan(50);
  });
});

test.describe('change animation', () => {
  // 20 characters per second: the third paragraph (27 characters) types for
  // 1350 ms and the ghost 'apples.' is held for its 500 ms rise then deleted
  // over 350 ms, both long enough to sample every 20 ms.
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

  test('ACC-HILITE-156 holds the ghost for its rise while the added text types, then deletes it beside the typing', async ({
    page,
    tmpPath
  }) => {
    // An observer in the page clocks the ghost from the frame it appears to
    // the frame it first loses a letter, and reads how much of the added
    // paragraph had typed by then.
    await page.evaluate(() => {
      const w = window as any;
      w.__ghost = null;
      const observer = new MutationObserver(() => {
        const ghost = document.querySelector('.jp-AdvancedMd-removed');
        if (!ghost) {
          return;
        }
        const now = performance.now();
        const length = (ghost.textContent ?? '').length;
        if (w.__ghost === null) {
          w.__ghost = {
            created: now,
            whole: length,
            shrank: null,
            typed: null
          };
          return;
        }
        if (w.__ghost.shrank === null && length < w.__ghost.whole) {
          const added = document.querySelectorAll('.jp-AdvancedMd-added');
          const last = added[added.length - 1];
          w.__ghost.shrank = now;
          w.__ghost.typed = last ? (last.textContent ?? '').length : 0;
          observer.disconnect();
        }
      });
      observer.observe(document.body, {
        childList: true,
        characterData: true,
        subtree: true
      });
    });
    await page.contents.uploadContent(REWRITTEN, 'text', `${tmpPath}/${FILE}`);
    await expect
      .poll(
        () => page.evaluate(() => (window as any).__ghost?.shrank ?? null),
        {
          timeout: 20000
        }
      )
      .not.toBeNull();

    const ghost = await page.evaluate(() => (window as any).__ghost);
    expect(ghost.whole).toBe('apples.'.length);
    // Whole for the 500 ms rise, a frame or two either way; the 750 ms hold
    // of earlier builds falls outside.
    expect(ghost.shrank - ghost.created).toBeGreaterThanOrEqual(450);
    expect(ghost.shrank - ghost.created).toBeLessThan(650);
    // The paragraph was still typing when the ghost began to go: side by
    // side, not one after the other.
    expect(ghost.typed).toBeGreaterThan(0);
    expect(ghost.typed).toBeLessThan(THIRD.length);
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

    // Sampling starts some way into the 500 ms hold, after the two polls
    // above returned. Without a hold the 7 characters would be gone within
    // 350 ms at 20 cps, so five full-length samples (100 ms) prove the ghost
    // stood before its deletion started; the hold's length is measured by
    // the ACC-HILITE-156 case above.
    const samples = await sampleLength(page, '.jp-AdvancedMd-removed', 100, 20);
    expect(samples[0]).toBe('apples.'.length);
    let held = 0;
    while (held < samples.length && samples[held] === 'apples.'.length) {
      held += 1;
    }
    expect(held).toBeGreaterThanOrEqual(5);
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

/**
 * A computed colour as numbers: red, green, blue and alpha.
 */
const parseColour = (colour: string): number[] =>
  (colour.match(/[\d.]+/g) ?? []).map(Number);

/**
 * The alpha of a computed colour. A colour that is not there reads as 0.
 */
const alphaOf = (colour: string | null): number => {
  if (!colour) {
    return 0;
  }
  const parts = parseColour(colour);
  return parts.length > 3 ? parts[3] : 1;
};

/**
 * One semi-transparent colour laid over an opaque one.
 */
const over = (top: number[], bottom: number[]): number[] => {
  const alpha = top.length > 3 ? top[3] : 1;
  return [0, 1, 2].map(i => top[i] * alpha + bottom[i] * (1 - alpha));
};

/**
 * WCAG relative luminance of an opaque colour.
 */
const luminance = (rgb: number[]): number => {
  const [r, g, b] = rgb.map(value => {
    const channel = value / 255;
    return channel <= 0.03928
      ? channel / 12.92
      : Math.pow((channel + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};

/**
 * What a reader sees on a highlight: the text colour against the highlight
 * colour, both laid over the background of the page behind them.
 */
interface IHighlightColours {
  background: string;
  page: string;
  color: string;
}

/**
 * WCAG contrast ratio of the text on a highlight.
 */
const contrastOf = (sample: IHighlightColours): number => {
  const behind = parseColour(sample.page);
  const background = over(parseColour(sample.background), behind);
  const text = over(parseColour(sample.color), background);
  const light = Math.max(luminance(background), luminance(text));
  const dark = Math.min(luminance(background), luminance(text));
  return (light + 0.05) / (dark + 0.05);
};

/**
 * Read the colours of the first added highlight, with the first opaque
 * background behind it, which is what its own transparent colour is seen on.
 */
const readHighlight = (page: any): Promise<IHighlightColours> =>
  page.evaluate(() => {
    const span = document.querySelector('.jp-AdvancedMd-added') as HTMLElement;
    let node: HTMLElement | null = span;
    let behind = 'rgb(255, 255, 255)';
    while (node) {
      const colour = getComputedStyle(node).backgroundColor;
      const parts = (colour.match(/[\d.]+/g) ?? []).map(Number);
      if (parts.length > 0 && (parts.length < 4 || parts[3] > 0.99)) {
        behind = colour;
        break;
      }
      node = node.parentElement;
    }
    return {
      background: getComputedStyle(span).backgroundColor,
      page: behind,
      color: getComputedStyle(span).color
    };
  });

/**
 * Sample the colour of the first added highlight, and the position of the
 * last block of the document, at a fixed interval inside the page. Sampling
 * starts at the first sighting of a highlight, so every sample is placed
 * against the moment the decoration appeared.
 */
const sampleFade = (
  page: any,
  everyMs: number,
  count: number
): Promise<Array<{ at: number; bg: string | null; top: number }>> =>
  page.evaluate(
    ([every, wanted]: [number, number]) =>
      new Promise<Array<{ at: number; bg: string | null; top: number }>>(
        resolve => {
          const samples: Array<{
            at: number;
            bg: string | null;
            top: number;
          }> = [];
          let started: number | null = null;
          const timer = setInterval(() => {
            const span = document.querySelector('.jp-AdvancedMd-added');
            const now = performance.now();
            if (started === null) {
              if (!span) {
                return;
              }
              started = now;
            }
            const last = document.querySelector('.jp-RenderedMarkdown')
              ?.lastElementChild as HTMLElement | null;
            samples.push({
              at: Math.round(now - (started as number)),
              bg: span ? getComputedStyle(span).backgroundColor : null,
              top: last ? Math.round(last.getBoundingClientRect().top) : -1
            });
            if (samples.length >= wanted) {
              clearInterval(timer);
              resolve(samples);
            }
          }, every);
        }
      ),
    [everyMs, count]
  );

test.describe('the fade over the life of a highlight', () => {
  // The fade duration is the schema default. The change animation is off, so
  // the whole change is on screen at once and the colour is the only thing
  // that moves.
  test.use({
    mockSettings: settings({ fadeDuration: 3000, animation: false })
  });

  test('rises, holds, then drains over the last part of its life without moving the text', async ({
    page,
    tmpPath
  }) => {
    const path = `${tmpPath}/${FILE}`;
    await page.contents.uploadContent(INITIAL, 'text', path);
    await openPreview(page, path);

    // Sampling is started before the write, so the first sample is taken
    // within 20 ms of the decoration appearing.
    const sampling = sampleFade(page, 20, 220);
    await page.contents.uploadContent(REWRITTEN, 'text', path);
    const samples = await sampling;

    const peak = Math.max(...samples.map(sample => alphaOf(sample.bg)));
    expect(peak).toBeGreaterThan(0.2);

    // The rise: the first sighting is well under the settled colour, and the
    // colour has arrived by the 500 ms the stylesheet gives the rise.
    expect(alphaOf(samples[0].bg)).toBeLessThan(peak * 0.6);
    const risen = samples.find(sample => sample.at >= 600);
    expect(alphaOf((risen as { bg: string | null }).bg)).toBe(peak);

    // The hold: between the rise and the drain the colour does not move. A
    // sample taken while the viewer was replacing the DOM sees no decoration
    // at all and says nothing about the colour, so it is left out.
    const held = samples.filter(
      sample => sample.at >= 600 && sample.at <= 2500 && sample.bg !== null
    );
    expect(held.length).toBeGreaterThan(80);
    for (const sample of held) {
      expect(alphaOf(sample.bg)).toBe(peak);
    }

    // The drain: the colour leaves over the last stretch of the life, and the
    // decorations are taken out only once it has gone.
    let gone = samples.length;
    while (gone > 0 && samples[gone - 1].bg === null) {
      gone--;
    }
    expect(samples.length - gone).toBeGreaterThan(20);
    const last = samples[gone - 1];
    expect(alphaOf(last.bg)).toBeLessThan(peak * 0.25);
    const draining = samples.find(
      sample =>
        sample.at > 600 && sample.bg !== null && alphaOf(sample.bg) < peak
    );
    const drainMs = last.at - (draining as { at: number }).at;
    expect(drainMs).toBeGreaterThan(500);
    expect(drainMs).toBeLessThan(1000);

    // Nothing jumps when the decorations leave: the block after the change
    // stays where it was for the whole life of the highlight, the removal of
    // the struck-out text included.
    const tops = samples.map(sample => sample.top).filter(top => top >= 0);
    expect(Math.max(...tops) - Math.min(...tops)).toBeLessThanOrEqual(1);
  });
});

test.describe('the highlights under reduced motion', () => {
  test.use({ mockSettings: settings() });

  test('keep their colour ramps, the ghost fading out before it is taken out', async ({
    page,
    tmpPath
  }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const path = `${tmpPath}/${FILE}`;
    await page.contents.uploadContent(INITIAL, 'text', path);
    await openPreview(page, path);
    await page.contents.uploadContent(REWRITTEN, 'text', path);
    await expect(page.locator('.jp-AdvancedMd-removed').first()).toBeVisible({
      timeout: 20000
    });

    // Colour and opacity ramps are not motion: the ghost's fade to invisible
    // is what keeps the reflow at its removal off screen, so it runs under
    // reduced motion as well (DEF-HILITE-31).
    const names = await page.evaluate(() => {
      const nameOf = (selector: string) =>
        getComputedStyle(document.querySelector(selector) as Element)
          .animationName;
      return {
        removed: nameOf('.jp-AdvancedMd-removed'),
        added: nameOf('.jp-AdvancedMd-added')
      };
    });
    expect(names.removed).toContain('jp-AdvancedMd-ghost-out');
    expect(names.added).not.toBe('none');
  });
});

test.describe('the highlight colours in each theme', () => {
  test.use({ mockSettings: settings() });

  test('differ between the light and the dark theme and stay readable in both', async ({
    page,
    tmpPath
  }) => {
    const path = `${tmpPath}/${FILE}`;
    await page.contents.uploadContent(INITIAL, 'text', path);
    await openPreview(page, path);
    await page.contents.uploadContent(REWRITTEN, 'text', path);
    await expect(page.locator('.jp-AdvancedMd-added').first()).toBeVisible({
      timeout: 20000
    });
    // Past the 500 ms rise, so the colour read is the settled one.
    await page.waitForTimeout(800);

    const light = await readHighlight(page);
    await page.theme.setDarkTheme();
    await expect
      .poll(async () => (await readHighlight(page)).background)
      .not.toBe(light.background);
    const dark = await readHighlight(page);

    // The variables carry a value of their own for each theme.
    expect(dark.page).not.toBe(light.page);
    expect(dark.background).not.toBe(light.background);
    // The text on the highlight stays at or above the contrast WCAG asks of
    // body text in both.
    expect(contrastOf(light)).toBeGreaterThanOrEqual(4.5);
    expect(contrastOf(dark)).toBeGreaterThanOrEqual(4.5);
  });
});

/**
 * A document whose middle block is a fenced block of code the renderer
 * colours, so a change inside it can be seen against the token markup.
 */
const CODE = [
  '# Report',
  '',
  'Before the block.',
  '',
  '```python',
  'first = 1',
  'second = 2',
  '```',
  '',
  'After the block.',
  ''
].join('\n');

const CODE_REWRITTEN = CODE.replace('second = 2', 'second = 33');

/**
 * The class names of the token elements inside the fenced block, which the
 * renderer generates, and the count of decorations among them.
 */
const codeTokens = (
  page: any
): Promise<{ tokens: string[]; decorations: number }> =>
  page.evaluate(() => {
    const code = document.querySelector('.jp-RenderedMarkdown pre code');
    const spans = Array.from(code?.querySelectorAll('span') ?? []);
    return {
      tokens: spans
        .filter(span => !span.className.includes('jp-AdvancedMd'))
        .map(span => span.className),
      decorations: spans.filter(span =>
        span.className.includes('jp-AdvancedMd')
      ).length
    };
  });

test.describe('a change inside a fenced code block', () => {
  test.use({ mockSettings: settings() });

  test('is highlighted while the colouring of the block survives', async ({
    page,
    tmpPath
  }) => {
    const path = `${tmpPath}/${FILE}`;
    await page.contents.uploadContent(CODE, 'text', path);
    await openPreview(page, path, 'Before the block.');

    const before = await codeTokens(page);
    // The renderer colours the block, so there is something to lose.
    expect(before.tokens.length).toBeGreaterThan(0);
    expect(before.decorations).toBe(0);

    await page.contents.uploadContent(CODE_REWRITTEN, 'text', path);

    // The change is highlighted inside the block itself. The text of the block
    // is not asserted against here: the struck-out text the change replaced
    // stands in it for the whole fade, which this suite makes long.
    const added = page.locator(
      '.jp-RenderedMarkdown pre code .jp-AdvancedMd-added'
    );
    await expect(added.first()).toBeVisible({ timeout: 20000 });
    // Both renders of the change are over.
    await page.waitForTimeout(2000);
    expect((await added.allTextContents()).join('')).toContain('33');

    // The colouring is still there, and it is the same colouring: every class
    // the renderer used before the change is still in use after it.
    const after = await codeTokens(page);
    expect(after.decorations).toBeGreaterThan(0);
    for (const token of new Set(before.tokens)) {
      expect(after.tokens).toContain(token);
    }
    // The decoration sets a background and no colour of its own, so whatever
    // colour the renderer gave the text around it shows through it.
    const colours = await page.evaluate(() => {
      const span = document.querySelector(
        '.jp-RenderedMarkdown pre code .jp-AdvancedMd-added'
      ) as HTMLElement;
      return {
        background: getComputedStyle(span).backgroundColor,
        color: getComputedStyle(span).color,
        around: getComputedStyle(span.parentElement as HTMLElement).color
      };
    });
    expect(colours.background).not.toBe('rgba(0, 0, 0, 0)');
    expect(colours.color).toBe(colours.around);
  });
});

/**
 * A sentence of exactly sixty characters, so how long it takes to type says
 * what the speed is.
 */
const SIXTY = 'The fox jumped over the lazy brown dogs and ran home to rest';

/**
 * Sample the total length of the added highlights at a fixed interval,
 * timestamped from the frame the first one appeared on, so a sample is placed
 * against the moment the typing started rather than against the write.
 */
const sampleTyping = (
  page: any,
  everyMs: number,
  count: number,
  waitMs: number
): Promise<Array<{ at: number; length: number }>> =>
  page.evaluate(
    ([every, wanted, wait]: [number, number, number]) =>
      new Promise<Array<{ at: number; length: number }>>((resolve, reject) => {
        const samples: Array<{ at: number; length: number }> = [];
        const deadline = performance.now() + wait;
        let started: number | null = null;
        const timer = setInterval(() => {
          const spans = Array.from(
            document.querySelectorAll('.jp-AdvancedMd-added')
          );
          const now = performance.now();
          if (started === null) {
            if (!spans.length) {
              if (now > deadline) {
                clearInterval(timer);
                reject(new Error('no added highlight appeared'));
              }
              return;
            }
            started = now;
          }
          samples.push({
            at: Math.round(now - (started as number)),
            length: spans.reduce(
              (total, span) => total + (span.textContent ?? '').length,
              0
            )
          });
          if (samples.length >= wanted) {
            clearInterval(timer);
            resolve(samples);
          }
        }, every);
      }),
    [everyMs, count, waitMs]
  );

test.describe('a fresh install with no setting touched', () => {
  // Nothing of this extension is written to the settings store, so the speed
  // in force is the one the schema declares.
  test.use({ mockSettings: shippedSettings() });

  test('ACC-ANIM-143 types a change in at 75 characters per second, its timing jittered (ACC-ANIM-158)', async ({
    page,
    tmpPath
  }) => {
    expect(SIXTY.length).toBe(60);
    const path = `${tmpPath}/${FILE}`;
    await page.contents.uploadContent(INITIAL, 'text', path);
    await openPreview(page, path);

    // Sampling is started before the write, so the first sample is taken
    // within 50 ms of the highlight appearing.
    const sampling = sampleTyping(page, 50, 50, 30000);
    await page.contents.uploadContent(`${INITIAL}\n${SIXTY}\n`, 'text', path);
    const samples = await sampling;

    const whole = Math.max(...samples.map(sample => sample.length));
    expect(whole).toBeGreaterThanOrEqual(SIXTY.length);

    // Four hundred milliseconds in, a sixty character sentence at 75
    // characters a second is half way through; with every draw of the
    // quarter jitter at its bottom it would still need 600 ms.
    const early = samples.filter(sample => sample.at <= 400);
    expect(early.length).toBeGreaterThan(4);
    expect(early[early.length - 1].length).toBeLessThan(whole);

    // And it is complete inside 1.1 seconds: 800 ms on average, a second
    // with every draw at its top. At the 50 characters a second of the
    // earlier 1.0.9 builds the same sentence would take 1.2 s even.
    const done = samples.find(sample => sample.length === whole);
    expect((done as { at: number }).at).toBeLessThanOrEqual(1100);
  });
});

test.describe('the strength of the change highlights', () => {
  test.use({ mockSettings: settings() });

  test('ACC-HILITE-141 is the shipped pair of each theme', async ({
    page,
    tmpPath
  }) => {
    const path = `${tmpPath}/${FILE}`;
    await page.contents.uploadContent(INITIAL, 'text', path);
    await openPreview(page, path);
    await page.contents.uploadContent(REWRITTEN, 'text', path);
    await expect(page.locator('.jp-AdvancedMd-removed').first()).toBeVisible({
      timeout: 20000
    });
    // Past the 500 ms rise, so the colour read is the settled one.
    await page.waitForTimeout(800);

    const light = await highlightAlphas(page);
    expect(light.added).toBeCloseTo(0.35, 2);
    expect(light.removed).toBeCloseTo(0.31, 2);

    await page.theme.setDarkTheme();
    await expect
      .poll(async () => (await highlightAlphas(page)).added)
      .not.toBe(light.added);
    const dark = await highlightAlphas(page);
    expect(dark.added).toBeCloseTo(0.31, 2);
    expect(dark.removed).toBeCloseTo(0.29, 2);
  });
});

test.describe('the change animation under reduced motion', () => {
  test.use({ mockSettings: settings({ animationSpeed: 25 }) });

  test('DEF-CUE-68 types the added text in rather than landing it at once', async ({
    page,
    tmpPath
  }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    expect(
      await page.evaluate(
        () => matchMedia('(prefers-reduced-motion: reduce)').matches
      )
    ).toBe(true);

    const path = `${tmpPath}/${FILE}`;
    await page.contents.uploadContent(INITIAL, 'text', path);
    await openPreview(page, path);

    const sampling = sampleTyping(page, 50, 40, 30000);
    await page.contents.uploadContent(REWRITTEN, 'text', path);
    const samples = await sampling;

    // The reader on a machine reporting the preference sees the change typed
    // in, because the browser preference is not this extension's switch: the
    // animation setting and a speed of 0 are.
    const whole = Math.max(...samples.map(sample => sample.length));
    expect(whole).toBeGreaterThan(10);
    expect(samples[0].length).toBeLessThan(whole);
    expect(new Set(samples.map(sample => sample.length)).size).toBeGreaterThan(
      3
    );
  });
});

test.describe('two edits far apart in a long document', () => {
  test.use({ mockSettings: settings() });

  test('DEF-HILITE-88 tints the two edits alone, a line pushed in at the top and a word changed at the end', async ({
    page,
    tmpPath
  }) => {
    // A hundred and twenty paragraphs, well past the diff's token bound once
    // the first edit ends the common prefix and the last ends the suffix.
    const paragraphs = Array.from(
      { length: 120 },
      (_, i) =>
        `Paragraph ${i + 1} of the report carries a few ordinary words in it.`
    );
    const path = `${tmpPath}/${FILE}`;
    await page.contents.uploadContent(
      `# Report\n\n${paragraphs.join('\n\n')}\n`,
      'text',
      path
    );
    await openPreview(page, path, 'Paragraph 1 of');

    const pushed =
      `# Report\n\nA new first line.\n\n${paragraphs.join('\n\n')}\n`.replace(
        /words in it\.\n$/,
        'words in it now.\n'
      );
    await page.contents.uploadContent(pushed, 'text', path);

    const added = page.locator(
      '.jp-RenderedMarkdown:visible .jp-AdvancedMd-added'
    );
    await expect(added).toHaveCount(2, { timeout: 20000 });
    await expect(added.nth(0)).toHaveText('A new first line.');
    await expect(added.nth(1)).toHaveText('it now.');
    // A paragraph between the two edits is neither tinted nor rebuilt.
    await expect(
      page
        .locator('.jp-RenderedMarkdown:visible p', {
          hasText: 'Paragraph 60 of'
        })
        .locator('.jp-AdvancedMd-added')
    ).toHaveCount(0);
  });
});

test.describe('a heading that wraps', () => {
  test.use({ mockSettings: settings() });

  test('DEF-NOTES-89 keeps the box of its second line clear of the first, so a selection over it covers no letters', async ({
    page,
    tmpPath
  }) => {
    // Long enough to wrap in the preview at the test viewport.
    const title =
      'OSTATECZNE PRZEDSĄDOWE WEZWANIE DO WYDANIA KOPII DOKUMENTU (BRAK ODPOWIEDZI PLACÓWKI) W TERMINIE SIEDMIU DNI OD DORĘCZENIA';
    const path = `${tmpPath}/${FILE}`;
    await page.contents.uploadContent(
      `### ${title}\n\nA paragraph below the title.\n`,
      'text',
      path
    );
    await openPreview(page, path, 'A paragraph below');

    const heading = page.locator('.jp-RenderedMarkdown:visible h3', {
      hasText: 'OSTATECZNE'
    });
    // The box of each line of the heading's own text, as the browser lays
    // them out and as a selection over the heading is painted; the anchor
    // link JupyterLab appends to a heading is left out.
    const lines = await heading.evaluate((node: Element) => {
      const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
      const rects: Array<{ top: number; bottom: number }> = [];
      let text = walker.nextNode();
      while (text) {
        if (!(text.parentElement as HTMLElement).closest('a')) {
          const range = document.createRange();
          range.selectNodeContents(text);
          for (const rect of Array.from(range.getClientRects())) {
            if (rect.width > 0) {
              rects.push({ top: rect.top, bottom: rect.bottom });
            }
          }
        }
        text = walker.nextNode();
      }
      return { rects, html: node.innerHTML };
    });
    expect(lines.rects.length, lines.html).toBeGreaterThanOrEqual(2);
    // The second line's box starts no higher than the first line's box ends,
    // so a selection painted over the second line covers nothing of the
    // first; at JupyterLab's own heading line height of 1 the boxes overlap.
    expect(lines.rects[1].top).toBeGreaterThanOrEqual(
      lines.rects[0].bottom - 0.5
    );
  });
});
