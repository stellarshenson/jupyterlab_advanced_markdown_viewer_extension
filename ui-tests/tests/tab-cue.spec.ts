import { expect, test } from '@jupyterlab/galata';
import * as fs from 'fs';
import * as path from 'path';

import {
  FILE,
  INITIAL,
  REWRITTEN,
  labFixtures,
  markerStyle,
  openPreview,
  settings,
  typeInEditor
} from './helpers';

/**
 * Integration tests of the marker itself on the document tab.
 *
 * Every marker is generated content on the tab label, so the class on the tab
 * says only that a state was set: what the reader sees is the computed style
 * of the `::before` of the label, and that is what these tests read. The three
 * states have to be told apart by shape, by colour and by movement, because a
 * reader who cannot tell two colours apart still has the other two.
 */

test.use(labFixtures);

const UPDATED = 'jp-AdvancedMd-tabUpdated';
const ACTIVE = 'jp-AdvancedMd-tabActive';
const BLOCKED = 'jp-AdvancedMd-tabBlocked';
const MISSING = 'jp-AdvancedMd-tabMissing';

/**
 * The glyphs the stylesheet writes: a half-filled circle for a change that
 * arrived, a filled square for one held back, a cross for a file gone from
 * disk.
 */
const CIRCLE = '"◐"';
const SQUARE = '"◼"';
const CROSS = '"✕"';

/**
 * Where the test server keeps a contents-API path on disk. A file removed
 * there is removed behind the lab's back, which is what a file gone from disk
 * means to this extension.
 */
const onDisk = (apiPath: string): string =>
  path.join(__dirname, '..', ...apiPath.split('/'));

/**
 * The blocked colour of the light theme, which the lab opens in.
 */
const BLOCKED_COLOUR = 'rgb(218, 54, 51)';

/**
 * Open one preview holding unsaved edits, so the change written under it is
 * held back, and a second preview that takes its change at once. The tab bar
 * then carries both markers at the same time and they can be compared.
 */
async function twoStates(page: any, tmpPath: string): Promise<void> {
  const held = `${tmpPath}/${FILE}`;
  const arriving = `${tmpPath}/arriving.md`;
  await page.contents.uploadContent(INITIAL, 'text', held);
  await page.contents.uploadContent(INITIAL, 'text', arriving);
  await openPreview(page, held);
  await openPreview(page, arriving);

  await typeInEditor(page, held, 'UNSAVED WORK');
  await page.contents.uploadContent(REWRITTEN, 'text', held);
  await page.contents.uploadContent(REWRITTEN, 'text', arriving);

  await expect(page.locator(`.lm-TabBar-tab.${BLOCKED}`)).toHaveCount(1, {
    timeout: 20000
  });
  await expect(page.locator(`.lm-TabBar-tab.${UPDATED}`)).toHaveCount(1, {
    timeout: 20000
  });
}

/**
 * Open a third preview and take its file away from under it, so the tab bar
 * carries the third marker beside the two above.
 */
async function alsoGone(page: any, tmpPath: string): Promise<void> {
  const gone = `${tmpPath}/gone.md`;
  await page.contents.uploadContent(INITIAL, 'text', gone);
  // A rendered preview does not mean the document has finished opening: the
  // context resolves and renders first and writes the checkpoint JupyterLab
  // takes of a file it opens afterwards. A file taken away inside that window
  // fails that request, and JupyterLab closes the document it could not open
  // rather than marking it, so there is no tab left to carry a marker. The
  // deletion therefore waits for the checkpoint to have been answered.
  const checkpointed = page.waitForResponse(
    (response: any) =>
      response.url().includes(`${gone}/checkpoints`) &&
      response.request().method() === 'POST'
  );
  await openPreview(page, gone);
  await checkpointed;
  fs.unlinkSync(onDisk(gone));

  await expect(page.locator(`.lm-TabBar-tab.${MISSING}`)).toHaveCount(1, {
    timeout: 20000
  });
}

test.describe('the marker of a change that arrived', () => {
  test.use({ mockSettings: settings() });

  test.beforeEach(async ({ page, tmpPath }) => {
    await page.contents.uploadContent(INITIAL, 'text', `${tmpPath}/${FILE}`);
    await openPreview(page, `${tmpPath}/${FILE}`);
  });

  test('is a half-filled circle in the tab own text colour, with a tooltip', async ({
    page,
    tmpPath
  }) => {
    await page.contents.uploadContent(REWRITTEN, 'text', `${tmpPath}/${FILE}`);
    await expect(page.locator(`.lm-TabBar-tab.${UPDATED}`)).toHaveCount(1, {
      timeout: 20000
    });

    const marker = await markerStyle(page, UPDATED);
    expect(marker.content).toBe(CIRCLE);
    // Written in currentColor, so a colour another extension gave the tab is
    // what the marker shows too.
    expect(marker.color).toBe(marker.labelColor);

    // The commonest marker names its state in words as well, so it does not
    // read as a loading glyph to a first-time reader (DEF-CUE-30). Read past
    // the caption the document manager writes once the applied change has
    // reached the Context, so the words are shown to hold through it.
    await page.waitForTimeout(1500);
    const tooltip = await page
      .locator(`.lm-TabBar-tab.${UPDATED}`)
      .getAttribute('title');
    expect(tooltip).toContain('changed on disk');
  });

  test('turns a quarter at a time, faster while changes keep arriving', async ({
    page,
    tmpPath
  }) => {
    const path = `${tmpPath}/${FILE}`;

    // A writer at work: five writes a second apart.
    for (let i = 1; i <= 5; i++) {
      await page.contents.uploadContent(
        `${REWRITTEN}\nWrite ${i}.\n`,
        'text',
        path
      );
      await expect(page.locator('.jp-RenderedMarkdown')).toContainText(
        `Write ${i}.`,
        { timeout: 20000 }
      );
      const turning = await markerStyle(page, UPDATED);
      expect(turning.content).toBe(CIRCLE);
      expect(turning.animationName).toBe('jp-AdvancedMd-tab-turn');
      // A quarter of a turn at a time rather than a smooth spin.
      expect(turning.timingFunction).toMatch(/steps\(4/);
      expect(turning.animationDuration).toBe('0.8s');
      await expect(page.locator(`.lm-TabBar-tab.${ACTIVE}`)).toHaveCount(1);
      await page.waitForTimeout(1000);
    }

    // The writer has gone quiet: the tab settles to the slower turn within a
    // few seconds and keeps the marker, which is still the reader's to clear.
    await expect(page.locator(`.lm-TabBar-tab.${ACTIVE}`)).toHaveCount(0, {
      timeout: 10000
    });
    const settled = await markerStyle(page, UPDATED);
    expect(settled.content).toBe(CIRCLE);
    expect(settled.animationName).toBe('jp-AdvancedMd-tab-turn');
    expect(settled.animationDuration).toBe('2s');
  });
});

test.describe('the marker of a change held back', () => {
  test.use({ mockSettings: settings() });

  test('is a still red square with a tooltip, telling itself apart from the arriving circle', async ({
    page,
    tmpPath
  }) => {
    await twoStates(page, tmpPath);

    const blocked = await markerStyle(page, BLOCKED);
    const arriving = await markerStyle(page, UPDATED);

    expect(blocked.content).toBe(SQUARE);
    expect(blocked.color).toBe(BLOCKED_COLOUR);
    // It stands still and nudges once every eight seconds rather than turning.
    expect(blocked.animationName).toBe('jp-AdvancedMd-tab-nudge');
    expect(blocked.animationDuration).toBe('8s');

    // The two states differ in all three: shape, colour and motion.
    expect(blocked.content).not.toBe(arriving.content);
    expect(blocked.color).not.toBe(arriving.color);
    expect(blocked.animationName).not.toBe(arriving.animationName);

    // Lumino writes the caption of the widget title onto the tab, so the
    // tooltip names the state and what it asks the reader for.
    const tooltip = await page
      .locator(`.lm-TabBar-tab.${BLOCKED}`)
      .getAttribute('title');
    expect(tooltip).toContain('unsaved edits');
    // Reload from Disk takes the held change (DEF-CUE-79, DEF-CUE-85); a save
    // drops it (DEF-CUE-74), and the File menu's Revert to Checkpoint writes
    // the checkpoint over it (DEF-CUE-75), so neither is named.
    expect(tooltip).toContain('choose Reload Markdown File from Disk');
    expect(tooltip).not.toContain('Revert');
  });
});

/**
 * The text of every rendered preview on the page, whether its tab is in front
 * or behind, so a write to a document that is not in front can be waited for.
 */
const renderedText = (page: any): Promise<string> =>
  page.evaluate(() =>
    Array.from(document.querySelectorAll('.jp-RenderedMarkdown'))
      .map(node => node.textContent ?? '')
      .join(' ')
  );

test.describe('the markers under reduced motion', () => {
  test.use({ mockSettings: settings() });

  test('DEF-CUE-68 keep turning and keep their shapes', async ({
    page,
    tmpPath
  }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    expect(
      await page.evaluate(
        () => matchMedia('(prefers-reduced-motion: reduce)').matches
      )
    ).toBe(true);

    await twoStates(page, tmpPath);

    // A writer at work on a machine reporting the preference: the marker of
    // the arriving change turns at the fast speed on every write. The browser
    // preference is not this extension's switch, because a Windows host
    // reports it to every page whenever its own animation switch is off.
    const arrivingPath = `${tmpPath}/arriving.md`;
    for (let i = 1; i <= 3; i++) {
      await page.contents.uploadContent(
        `${REWRITTEN}\nWrite ${i}.\n`,
        'text',
        arrivingPath
      );
      await expect
        .poll(() => renderedText(page), { timeout: 20000 })
        .toContain(`Write ${i}.`);
      const turning = await markerStyle(page, UPDATED);
      expect(turning.content).toBe(CIRCLE);
      expect(turning.animationName).toBe('jp-AdvancedMd-tab-turn');
      expect(turning.timingFunction).toMatch(/steps\(4/);
      expect(turning.animationDuration).toBe('0.8s');
    }

    await alsoGone(page, tmpPath);

    const arriving = await markerStyle(page, UPDATED);
    const blocked = await markerStyle(page, BLOCKED);
    const gone = await markerStyle(page, MISSING);

    // Each marker keeps its own shape, and its own amount of movement: the
    // arriving circle turns, the held square nudges, the cross of a file gone
    // from disk stands still because nothing is waiting behind it.
    expect(arriving.content).toBe(CIRCLE);
    expect(blocked.content).toBe(SQUARE);
    expect(gone.content).toBe(CROSS);
    expect(arriving.animationName).toBe('jp-AdvancedMd-tab-turn');
    expect(blocked.animationName).toBe('jp-AdvancedMd-tab-nudge');
    expect(gone.animationName).toBe('none');
    expect(blocked.color).toBe(BLOCKED_COLOUR);
    expect(gone.color).toBe(BLOCKED_COLOUR);
  });
});
