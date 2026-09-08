/**
 * The README screenshots of the marks and notes, taken in the JupyterLab
 * Dark theme and written to docs/images.
 *
 * Not a test of the extension: the file runs only with SCREENSHOTS set, so
 * the suite proper is untouched by it. Run from ui-tests with
 * `SCREENSHOTS=1 JUPYTER_TEST_PORT=8911 jlpm playwright test tests/screenshots.spec.ts`.
 */
import { expect, test } from '@jupyterlab/galata';
import * as path from 'path';

import { choose, openMenu, openMarkMenu, openPreview, select } from './helpers';

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

const IMAGES = path.join(__dirname, '..', '..', 'docs', 'images');
const shot = (name: string) => path.join(IMAGES, `notes-${name}.png`);

test.describe('README screenshots', () => {
  test.skip(!process.env.SCREENSHOTS, 'run with SCREENSHOTS=1');
  test.use({ viewport: { width: 1000, height: 560 } });

  test.beforeEach(async ({ page, tmpPath }) => {
    await page.theme.setDarkTheme();
    await page.contents.uploadContent(DOC, 'text', `${tmpPath}/${FILE}`);
    await openPreview(page, `${tmpPath}/${FILE}`, 'The first section');
    await page.sidebar.close('left');
    await expect(page.locator('.jp-AdvancedMd-notes:visible')).toBeVisible();
  });

  test('the panel, the minimap, the badge and the Mark submenu', async ({
    page
  }) => {
    const dock = page.locator('#jp-main-dock-panel');
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
    await dock.screenshot({ path: shot('01-panel') });

    // The minimap strip: the hide control, the plus and the expand caret over
    // the ticks.
    await page.mouse.click(300, 300);
    await page.mouse.click(300, 300, { button: 'right' });
    await choose(page, 'Show notes minimap');
    await expect(panel).toHaveClass(/jp-AdvancedMd-notes-minimap/);
    await page.waitForTimeout(400);
    await page.mouse.move(5, 5);
    await dock.screenshot({ path: shot('02-minimap') });

    // The badge over the preview while the panel is hidden.
    await page.mouse.click(300, 300, { button: 'right' });
    await choose(page, 'Hide minimap');
    await expect(
      page.locator('.jp-AdvancedMd-notesBadge:visible')
    ).toBeVisible();
    await page.waitForTimeout(400);
    await page.mouse.move(5, 5);
    await dock.screenshot({ path: shot('03-badge') });

    // The Mark submenu over a selection.
    await openMenu(page, await select(page, 'The appendix', 'assumptions'));
    await openMarkMenu(page);
    await page.waitForTimeout(300);
    await page.mouse.move(5, 5);
    await dock.screenshot({ path: shot('04-mark-menu') });
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');
  });
});
