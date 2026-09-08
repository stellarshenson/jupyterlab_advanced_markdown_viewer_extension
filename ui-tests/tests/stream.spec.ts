import { expect, test } from '@jupyterlab/galata';
import * as fs from 'fs';

import {
  FILE,
  fileText,
  labFixtures,
  mark,
  onDisk,
  openPreview,
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

/** How long the writer streams. */
const DURATION = 6000;

/** How many lines the writer appends. */
const LINES = DURATION / SPACING;

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

  test(`DEF-NOTES-33 ten marks under a ${SPACING} ms stream raise no dialog and reach the file`, async ({
    page,
    tmpPath
  }) => {
    const target = `${tmpPath}/${FILE}`;
    await page.contents.uploadContent(DOC, 'text', target);
    await openPreview(page, target, `The paragraph about ${WORDS[0]}`);

    // The writer runs on its own timer for the whole DURATION whatever the
    // marks do, and the test waits for its last line before reading the file.
    let written = 0;
    const streamed = new Promise<void>(resolve => {
      const timer = setInterval(() => {
        written += 1;
        fs.appendFileSync(onDisk(target), line(written));
        if (written === LINES) {
          clearInterval(timer);
          resolve();
        }
      }, SPACING);
    });

    // Each mark is followed by the wait for its save: the marker on disk, or
    // the dialog that stopped it. A dialog is counted and answered with
    // Revert, which keeps the agent's lines, so the run reaches its end and
    // the counts below say what happened rather than a timeout.
    let dialogs = 0;
    for (const word of WORDS.slice(0, MARKS)) {
      const before = markers(target);
      await mark(page, word);
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
    await streamed;

    const text = fileText(target);
    const lost = Array.from({ length: LINES }, (_, i) => i + 1).filter(
      n => !text.includes(line(n))
    );
    test.info().annotations.push({
      type: 'lost lines',
      description: `${lost.length} of ${LINES}: ${lost.join(' ') || 'none'}`
    });
    expect({ dialogs, marks: markers(target) }).toEqual({
      dialogs: 0,
      marks: MARKS
    });
    await expect(dialog(page)).toHaveCount(0);
  });
});
