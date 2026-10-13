import { expect, test } from '@jupyterlab/galata';
import * as fs from 'fs';

import {
  FILE,
  choose,
  closeMenus,
  colourLabel,
  entry,
  fileText,
  labFixtures,
  mark,
  onDisk,
  openMarkMenu,
  openMenu,
  openPreview,
  select,
  settings
} from './helpers';

/**
 * Integration test of marking while an agent streams into the same file.
 *
 * DEF-NOTES-33: a mark saved through the Context while a writer appends
 * faster than one write per 200 ms met the File Changed dialog or overwrote
 * a line the writer appended between the save's hash check and its PUT. The
 * marks go through the server's compare-and-write route instead, which holds
 * a lock over the comparison and the write; this suite is the evidence: at
 * 50 ms spacing ten marks raise no dialog and every one reaches the file.
 *
 * DEF-NOTES-33-1: the route refused a write whose file had grown since the
 * browser read it, and the browser's next attempt had to finish between two
 * appended lines, so a browser slower than the writer met the dialog after
 * three refusals. The route now writes the mark in front of what was
 * appended, so no write is refused, which both cases assert. The second case
 * slows the page until one attempt takes longer than the spacing, which is
 * the condition that raised the dialog.
 *
 * The route does not close the loss: a line the writer appends between the
 * server's read of the file and its write of the new content, a window of a
 * few milliseconds, is overwritten - measured on 0.6.36 at one or two of 120
 * lines in three runs of eight. The lost lines are counted and reported as
 * an annotation, not asserted, so the suite says what the route holds.
 *
 * The writer appends in place from the test process, the way the agent that
 * measured the bound did; the contents API has no append, so a loop inside
 * the page would rewrite the whole file and race the mark's own save from the
 * other side.
 */

test.use(labFixtures);

/** Milliseconds between two appended lines. */
const SPACING = 50;

/** How many marks are made while it streams. */
const MARKS = 10;

/** The word each mark selects, one per paragraph. */
const WORDS = [
  'apples',
  'pears',
  'oranges',
  'plums',
  'cherries',
  'figs',
  'grapes',
  'melons',
  'quinces',
  'medlars'
];

/**
 * A document with one paragraph per word to mark, ending on a blank line so
 * the appended lines form a paragraph of their own.
 */
const DOC = [
  '# Report',
  '',
  ...WORDS.map(word => `The paragraph about ${word} is unchanged.\n`),
  ''
].join('\n');

/** The line the writer appends for its nth write. */
const line = (n: number): string =>
  `Line ${String(n).padStart(4, '0')} written by the agent.\n`;

/** How many opening markers the file holds. */
const markers = (apiPath: string): number =>
  (fileText(apiPath).match(/<!-- mark:/g) ?? []).length;

/** The File Changed dialog, or any other. */
const dialog = (page: any) => page.locator('.jp-Dialog');

/**
 * Mark a word while the writer streams.
 *
 * The select helper does two things by script that a reader does by hand,
 * and a render every 100 to 400 ms undoes either of them (DEF-TEST-132). It
 * makes the selection in one step, and the viewer learns of a selection from
 * the selectionchange event the browser raises afterwards: a render in
 * between replaces the selected nodes and the viewer never hears of it. It
 * scrolls the word to the middle of the view, and the viewer puts back a
 * scroll the reader did not make while a render settles, so the point the
 * helper answered is then off the word. Either way the right click lands on
 * no selection and the menu offers no Mark. The selection and the right click
 * are therefore made until the menu offers it.
 *
 * @returns how many times the selection and the right click were made
 */
async function markUnderStream(page: any, word: string): Promise<number> {
  await expect(page.locator('.jp-AdvancedMd-selecting')).toHaveCount(0);
  let attempts = 0;
  await expect(async () => {
    attempts += 1;
    await closeMenus(page);
    await openMenu(page, await select(page, word));
    await expect(entry(page, 'Mark')).toHaveCount(1, { timeout: 500 });
  }).toPass();
  await openMarkMenu(page);
  await choose(page, colourLabel('yellow'));
  return attempts;
}

test.describe('marking under a stream of writes', () => {
  test.use({ mockSettings: settings({ fadeDuration: 500, animation: false }) });

  test('DEF-NOTES-33 writes a mark through the route and not through a save', async ({
    page,
    tmpPath
  }) => {
    const target = `${tmpPath}/${FILE}`;
    await page.contents.uploadContent(DOC, 'text', target);
    await openPreview(page, target, `The paragraph about ${WORDS[0]}`);

    // Every write the page sends from here on: the route's POST, or the PUT
    // a Context save would send to the contents API.
    const writes: string[] = [];
    page.on('response', (response: any) => {
      const method = response.request().method();
      if (method === 'POST' || method === 'PUT') {
        const pathname = decodeURIComponent(new URL(response.url()).pathname);
        writes.push(`${method} ${pathname} ${response.status()}`);
      }
    });

    await mark(page, WORDS[0]);
    await expect.poll(() => markers(target)).toBe(1);

    // The file is written through the route, with the document left clean:
    // no PUT, no dialog, no tab reporting unsaved work.
    expect(writes.filter(entry => entry.endsWith('/write 200'))).toHaveLength(
      1
    );
    expect(writes.filter(entry => entry.startsWith('PUT '))).toEqual([]);
    await expect(dialog(page)).toHaveCount(0);
    await expect(page.locator('.lm-TabBar-tab.jp-mod-dirty')).toHaveCount(0);
  });

  /** Make ten marks while the writer streams, and count what happened. */
  async function tenMarks(page: any, tmpPath: string): Promise<void> {
    const target = `${tmpPath}/${FILE}`;
    await page.contents.uploadContent(DOC, 'text', target);
    await openPreview(page, target, `The paragraph about ${WORDS[0]}`);

    // What the write route answered each write the page sent it.
    const answers: number[] = [];
    page.on('response', (response: any) => {
      if (
        response.request().method() === 'POST' &&
        new URL(response.url()).pathname.endsWith('/write')
      ) {
        answers.push(response.status());
      }
    });

    // The writer appends until the last mark has been made, so every one of
    // the marks is made under the stream on a machine of any speed.
    let written = 0;
    const timer = setInterval(() => {
      written += 1;
      fs.appendFileSync(onDisk(target), line(written));
    }, SPACING);

    // Each mark is followed by the wait for its save: the marker on disk, or
    // the dialog that stopped it. A dialog is counted and answered with
    // Revert, which keeps the agent's lines, so the run reaches its end and
    // the counts below say what happened rather than a timeout.
    let dialogs = 0;
    const attempts: number[] = [];
    try {
      for (const word of WORDS.slice(0, MARKS)) {
        const before = markers(target);
        attempts.push(await markUnderStream(page, word));
        await expect
          .poll(
            async () =>
              (await dialog(page).count()) > 0 || markers(target) > before,
            { timeout: 15000 }
          )
          .toBe(true);
        if ((await dialog(page).count()) > 0) {
          dialogs += 1;
          await dialog(page).locator('button', { hasText: 'Revert' }).click();
          await expect(dialog(page)).toHaveCount(0);
        }
      }
    } finally {
      clearInterval(timer);
    }

    const text = fileText(target);
    const lost = Array.from({ length: written }, (_, i) => i + 1).filter(
      n => !text.includes(line(n))
    );
    test.info().annotations.push(
      {
        type: 'lost lines',
        description: `${lost.length} of ${written}: ${lost.join(' ') || 'none'}`
      },
      {
        // How often a selection made by script had to be made again
        // (DEF-TEST-132): one per mark where none was undone.
        type: 'selections per mark',
        description: attempts.join(' ')
      }
    );
    // The marker of the last mark is on disk before the page has the answer
    // to its write, so the answer is waited for.
    await expect.poll(() => answers.length).toBeGreaterThanOrEqual(MARKS);
    // No write was refused: each mark landed at its first attempt, in front
    // of what the writer had appended since the browser read the file
    // (ACC-NOTES-204). A refused write would be answered 409.
    expect({ dialogs, marks: markers(target), answers }).toEqual({
      dialogs: 0,
      marks: MARKS,
      answers: Array(MARKS).fill(200)
    });
    await expect(dialog(page)).toHaveCount(0);
  }

  test(`DEF-NOTES-33 ten marks under a ${SPACING} ms stream raise no dialog and reach the file`, async ({
    page,
    tmpPath
  }) => {
    await tenMarks(page, tmpPath);
  });

  test(`DEF-NOTES-33-1 ten marks under a ${SPACING} ms stream raise no dialog on a page four times slower`, async ({
    page,
    tmpPath
  }) => {
    // Galata hands out a wrapper; the browser's own page is the first of
    // the context.
    const client = await page
      .context()
      .newCDPSession(page.context().pages()[0]);
    await client.send('Emulation.setCPUThrottlingRate', { rate: 4 });
    await tenMarks(page, tmpPath);
  });
});
