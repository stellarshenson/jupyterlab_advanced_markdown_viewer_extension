/**
 * The README screenshots, taken in the Galaxa Dark Theme - Steel with dates in
 * en-GB, and written to docs/images.
 *
 * Every shot is the window below JupyterLab's top bar, which carries the menu
 * and the lab's branding, at 2560 by 1440 pixels: the window is made taller by
 * the bar's height, so the 1280 by 720 area below it, drawn at twice the pixel
 * density, is a 16:9 picture of the lab at its usual size. The theme comes
 * from the galaxalabs_jupyterlab_steel_dark_theme extension, which has to be
 * installed in the lab the suite starts.
 *
 * Not a test of the extension: the file runs only with SCREENSHOTS set, so
 * the suite proper is untouched by it. Run from ui-tests with
 * `SCREENSHOTS=1 JUPYTER_TEST_PORT=8911 jlpm playwright test tests/screenshots.spec.ts`.
 */
import { expect, test } from '@jupyterlab/galata';
import * as path from 'path';

import { openPreview, settings } from './helpers';

const THEME = 'Galaxa Dark Theme - Steel';
const WIDTH = 1280;
const HEIGHT = 720;
const WINDOW = {
  viewport: { width: WIDTH, height: HEIGHT },
  deviceScaleFactor: 2,
  locale: 'en-GB'
};

const IMAGES = path.join(__dirname, '..', '..', 'docs', 'images');

/** The bottom edge of JupyterLab's top bar, in whole pixels. */
async function topBarBottom(page: any): Promise<number> {
  const bar = (await page.locator('#jp-top-panel').boundingBox())!;
  return Math.ceil(bar.y + bar.height);
}

/** Make the window taller by the top bar, so the area below it is 16:9. */
async function makeRoomForTopBar(page: any): Promise<void> {
  await page.setViewportSize({
    width: WIDTH,
    height: HEIGHT + (await topBarBottom(page))
  });
}

/** Write the area below the top bar to docs/images. */
async function shot(page: any, name: string): Promise<void> {
  const top = await topBarBottom(page);
  await page.screenshot({
    path: path.join(IMAGES, `${name}.png`),
    clip: { x: 0, y: top, width: WIDTH, height: HEIGHT }
  });
}

const FILE = 'report.md';
const ONE = '0d4b0d0a-4a4e-4f6a-9d8c-1d6b0a3c2e11';
const TWO = '7f2c9c58-3b8a-4b8f-8f7d-2e1a5b6c7d80';
const THREE = 'c1a2b3c4-d5e6-4f70-8123-456789abcdef';
const FOUR = '5e6f7a8b-9c0d-4e1f-a234-56789abcdef0';

const DOC = [
  `<!-- mark:${FOUR} document`,
  '@kj 2026-09-08T09:02:00Z: Second draft; the figures in the third section are still the old ones.',
  '-->',
  '# Quarterly report',
  '',
  'The first section summarises the quarter. Revenue grew in every region and ' +
    `the <!-- mark:${ONE} note colour=yellow\n@kj 2026-09-08T09:05:00Z: Needs a source.\n-->forecast for the next quarter was raised<!-- /mark:${ONE} --> in March.`,
  '',
  '## Costs',
  '',
  `Costs rose with headcount. <!-- mark:${TWO} note colour=blue -->The hiring plan was ` +
    `completed a month early<!-- /mark:${TWO} -->, and the office move is on schedule.`,
  '',
  '## Outlook',
  '',
  `The outlook is unchanged. <!-- mark:${THREE} note colour=pink\n@kj 2026-09-08T09:07:00Z: Check against the board deck.\n-->Demand in the north remains ` +
    `above plan<!-- /mark:${THREE} --> and the pipeline is full for the next two quarters.`,
  '',
  'The appendix lists the assumptions behind the forecast and the sources of the figures.',
  ''
].join('\n');

const WEEKLY = [
  '# Weekly report',
  '',
  'The build pipeline is stable and the release went out on Monday.',
  '',
  'Open items:',
  '',
  '- review the onboarding guide',
  '- publish the metrics dashboard',
  ''
].join('\n');

/** The weekly report with one word replaced, a list item and a line added. */
const WEEKLY_REWRITTEN = [
  '# Weekly report',
  '',
  'The build pipeline is stable and the release went out on Tuesday.',
  '',
  'Open items:',
  '',
  '- review the onboarding guide',
  '- publish the metrics dashboard',
  '- schedule the retrospective',
  '',
  'The team closed twelve tickets this week.',
  ''
].join('\n');

test.describe('README screenshots of the marks and notes', () => {
  test.skip(!process.env.SCREENSHOTS, 'run with SCREENSHOTS=1');
  test.use(WINDOW);

  test.beforeEach(async ({ page, tmpPath }) => {
    await page.theme.setTheme(THEME);
    await makeRoomForTopBar(page);
    await page.contents.uploadContent(DOC, 'text', `${tmpPath}/${FILE}`);
    await openPreview(page, `${tmpPath}/${FILE}`, 'The first section');
    await page.sidebar.close('left');
    await expect(page.locator('.jp-AdvancedMd-notes:visible')).toBeVisible();
  });

  test('the notes panel', async ({ page }) => {
    const panel = page.locator('.jp-AdvancedMd-notes:visible');

    // The expanded panel: the document note listed first, collapsed, and the
    // yellow passage row open with its note and controls.
    await panel
      .locator('.jp-AdvancedMd-notesRow')
      .nth(1)
      .locator('.jp-AdvancedMd-notesHead')
      .click();
    await page.waitForTimeout(2200);
    await page.mouse.move(5, 5);
    await shot(page, 'notes-01-panel');
  });
});

test.describe('README screenshots of a change', () => {
  test.skip(!process.env.SCREENSHOTS, 'run with SCREENSHOTS=1');
  test.use({ ...WINDOW, mockSettings: settings({ animationSpeed: 25 }) });

  test.beforeEach(async ({ page }) => {
    await page.theme.setTheme(THEME);
    await makeRoomForTopBar(page);
    await page.sidebar.close('left');
  });

  test('a change part way through', async ({ page, tmpPath }) => {
    const file = `${tmpPath}/${FILE}`;
    await page.contents.uploadContent(WEEKLY, 'text', file);
    await openPreview(page, file, 'The build pipeline');
    await page.contents.uploadContent(WEEKLY_REWRITTEN, 'text', file);

    // Taken while the added lines are still typing and the removed word is
    // still on screen, before it is deleted.
    await page.waitForFunction(
      () => {
        const typing = document.querySelectorAll(
          '.jp-AdvancedMd-added.jp-AdvancedMd-typing'
        );
        const last = typing[typing.length - 1];
        return (
          (last?.textContent ?? '').length >= 10 &&
          document.querySelector('.jp-AdvancedMd-removed') !== null
        );
      },
      undefined,
      { polling: 'raf', timeout: 20000 }
    );
    await shot(page, 'animation-01');
  });
});
